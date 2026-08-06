import { createHash, randomUUID } from 'node:crypto'
import { link, open, rename, unlink, type FileHandle } from 'node:fs/promises'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import path from 'node:path'
import {
  LOCAL_CONTROL_ARTIFACT_PATH_PREFIX,
  LocalControlRpcResponseSchema,
  type LocalControlDescriptor
} from '@shared/contracts/localControl'
import type { ArtifactMetadata } from '@shared/contracts/routes/artifacts.routes'
import { isHardlinkUnavailableError } from '@shared/utils/filesystem'
import { CLI_EXIT_CODES, CliClientError, exitCodeForRemoteError } from './errors'
import { CLI_VERSION } from './transport'

const MAX_ERROR_RESPONSE_BYTES = 64 * 1024
const PORTABLE_COPY_BUFFER_BYTES = 64 * 1024

export type ArtifactDownloadInput = Readonly<{
  descriptor: LocalControlDescriptor
  token: string
  metadata: ArtifactMetadata
  outputPath: string
  overwrite: boolean
  signal: AbortSignal
}>

function protocolFailure(message: string): CliClientError {
  return new CliClientError('internal_error', message, CLI_EXIT_CODES.internal)
}

function transportFailure(message: string): CliClientError {
  return new CliClientError('unavailable', message, CLI_EXIT_CODES.unavailable, true)
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new CliClientError('cancelled', 'CLI request was cancelled', CLI_EXIT_CODES.cancelled)
}

function singularHeader(response: IncomingMessage, name: string): string | undefined {
  const values = response.headersDistinct[name]
  if (values && values.length !== 1) {
    throw protocolFailure(`DeepChat returned multiple ${name} headers`)
  }
  const value = values?.[0] ?? response.headers[name]
  if (Array.isArray(value)) throw protocolFailure(`DeepChat returned an invalid ${name} header`)
  return value
}

async function writeAll(handle: FileHandle, chunk: Buffer, position: number): Promise<number> {
  let offset = 0
  while (offset < chunk.length) {
    const { bytesWritten } = await handle
      .write(chunk, offset, chunk.length - offset, position + offset)
      .catch((error) => {
        throw new CliClientError(
          'conflict',
          `Cannot write artifact output: ${(error as Error).message}`,
          CLI_EXIT_CODES.domain
        )
      })
    if (bytesWritten <= 0) throw new Error('Artifact output write made no progress')
    offset += bytesWritten
  }
  return offset
}

async function readRemoteFailure(response: IncomingMessage): Promise<CliClientError> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const rawChunk of response) {
    const chunk = Buffer.from(rawChunk)
    size += chunk.length
    if (size > MAX_ERROR_RESPONSE_BYTES) {
      throw protocolFailure('DeepChat artifact error response exceeds the byte limit')
    }
    chunks.push(chunk)
  }

  try {
    const parsed = LocalControlRpcResponseSchema.parse(
      JSON.parse(Buffer.concat(chunks, size).toString('utf8'))
    )
    if (parsed.ok)
      throw protocolFailure('DeepChat returned a success envelope with an error status')
    return new CliClientError(
      parsed.error.code,
      parsed.error.message,
      exitCodeForRemoteError(parsed.error),
      parsed.error.retriable
    )
  } catch (error) {
    if (error instanceof CliClientError) return error
    return protocolFailure('DeepChat returned an invalid artifact error response')
  }
}

async function receiveArtifact(input: ArtifactDownloadInput, handle: FileHandle): Promise<void> {
  if (input.signal.aborted) throw abortReason(input.signal)

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      callback()
    }
    const request = httpRequest({
      socketPath:
        input.descriptor.endpoint.kind === 'unix'
          ? input.descriptor.endpoint.path
          : input.descriptor.endpoint.name,
      path: `${LOCAL_CONTROL_ARTIFACT_PATH_PREFIX}${input.metadata.id}`,
      method: 'GET',
      agent: false,
      signal: input.signal,
      headers: {
        authorization: `Bearer ${input.token}`,
        connection: 'close',
        'user-agent': `DeepChat-CLI/${CLI_VERSION}`
      }
    })

    request.once('response', (response) => {
      void (async () => {
        if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
          throw await readRemoteFailure(response)
        }

        const contentLength = singularHeader(response, 'content-length')
        const contentType = singularHeader(response, 'content-type')
        const artifactId = singularHeader(response, 'x-deepchat-artifact-id')
        const expectedHash = singularHeader(response, 'x-content-sha256')
        if (!contentLength || !/^(0|[1-9][0-9]*)$/.test(contentLength)) {
          throw protocolFailure('DeepChat returned an invalid artifact Content-Length')
        }
        if (Number(contentLength) !== input.metadata.size) {
          throw protocolFailure('DeepChat artifact size changed after description')
        }
        if (contentType?.trim().toLowerCase() !== input.metadata.mimeType.toLowerCase()) {
          throw protocolFailure('DeepChat artifact MIME type changed after description')
        }
        if (artifactId !== input.metadata.id || expectedHash !== input.metadata.sha256) {
          throw protocolFailure('DeepChat artifact identity changed after description')
        }

        const hash = createHash('sha256')
        let bytesWritten = 0
        for await (const rawChunk of response) {
          if (input.signal.aborted) throw abortReason(input.signal)
          const chunk = Buffer.from(rawChunk)
          if (bytesWritten + chunk.length > input.metadata.size) {
            throw protocolFailure('DeepChat artifact exceeded its declared size')
          }
          hash.update(chunk)
          bytesWritten += await writeAll(handle, chunk, bytesWritten)
        }
        if (bytesWritten !== input.metadata.size) {
          throw protocolFailure('DeepChat artifact was truncated')
        }
        if (hash.digest('hex') !== input.metadata.sha256) {
          throw protocolFailure('DeepChat artifact checksum did not match')
        }
      })().then(
        () => finish(resolve),
        (error: unknown) => {
          response.destroy()
          finish(() =>
            reject(
              error instanceof CliClientError
                ? error
                : transportFailure(
                    error instanceof Error ? error.message : 'Artifact download failed'
                  )
            )
          )
        }
      )
    })
    request.once('error', (error: NodeJS.ErrnoException) => {
      if (input.signal.aborted) {
        finish(() => reject(abortReason(input.signal)))
        return
      }
      finish(() => reject(transportFailure(`Cannot download artifact: ${error.message}`)))
    })
    request.end()
  })
}

function outputAlreadyExists(outputPath: string): CliClientError {
  return new CliClientError(
    'conflict',
    `Output already exists: ${outputPath}`,
    CLI_EXIT_CODES.domain
  )
}

async function copyDownloadExclusive(tempPath: string, outputPath: string): Promise<void> {
  let output: FileHandle | undefined
  let source: FileHandle | undefined
  try {
    output = await open(outputPath, 'wx', 0o600)
    source = await open(tempPath, 'r')
    const buffer = Buffer.allocUnsafe(PORTABLE_COPY_BUFFER_BYTES)
    let position = 0
    while (true) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) break
      position += await writeAll(output, buffer.subarray(0, bytesRead), position)
    }
    await output.sync()
    await source.close()
    source = undefined
    await output.close()
    output = undefined
  } catch (error) {
    await source?.close().catch(() => undefined)
    await output?.close().catch(() => undefined)
    if (output) await unlink(outputPath).catch(() => undefined)
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw outputAlreadyExists(outputPath)
    throw error
  }
}

export async function publishArtifactDownload(
  tempPath: string,
  outputPath: string,
  overwrite: boolean,
  linkFile: typeof link = link
): Promise<void> {
  if (!overwrite) {
    try {
      await linkFile(tempPath, outputPath)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST') throw outputAlreadyExists(outputPath)
      if (!isHardlinkUnavailableError(error)) throw error
    }
    await copyDownloadExclusive(tempPath, outputPath)
    return
  }

  await rename(tempPath, outputPath)
}

export async function downloadArtifact(input: ArtifactDownloadInput): Promise<string> {
  const outputPath = path.resolve(input.outputPath)
  if (outputPath.includes('\0')) {
    throw new CliClientError('invalid_request', 'Output path contains NUL', CLI_EXIT_CODES.usage)
  }
  const tempPath = path.join(path.dirname(outputPath), `.deepchat-${randomUUID()}.tmp`)
  const handle = await open(tempPath, 'wx', 0o600).catch((error) => {
    throw new CliClientError(
      'conflict',
      `Cannot create temporary output beside ${outputPath}: ${(error as Error).message}`,
      CLI_EXIT_CODES.domain
    )
  })
  let handleOpen = true
  try {
    await receiveArtifact(input, handle)
    await handle.sync().catch((error) => {
      throw new CliClientError(
        'conflict',
        `Cannot flush artifact output: ${(error as Error).message}`,
        CLI_EXIT_CODES.domain
      )
    })
    await handle.close()
    handleOpen = false
    await publishArtifactDownload(tempPath, outputPath, input.overwrite).catch((error) => {
      if (error instanceof CliClientError) throw error
      throw new CliClientError(
        'conflict',
        `Cannot publish artifact output: ${(error as Error).message}`,
        CLI_EXIT_CODES.domain
      )
    })
    return outputPath
  } finally {
    if (handleOpen) await handle.close().catch(() => undefined)
    await unlink(tempPath).catch(() => undefined)
  }
}
