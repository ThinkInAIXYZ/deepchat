import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, unlink, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import type { IncomingMessage } from 'node:http'
import { CliRequestError } from './errors'

const DEFAULT_MAX_JSON_DEPTH = 64
const DEFAULT_MAX_JSON_KEYS = 10_000
const DEFAULT_MAX_JSON_NODES = 50_000
const UNSAFE_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export type BoundedRequestBody =
  | Readonly<{
      kind: 'memory'
      bytes: Buffer
      size: number
      sha256: string
      cleanup(): Promise<void>
    }>
  | Readonly<{
      kind: 'file'
      path: string
      size: number
      sha256: string
      cleanup(): Promise<void>
    }>

export type BoundedBodyOptions = Readonly<{
  maxBytes: number
  memoryThresholdBytes: number
  tempDirectory: string
  requireContentLength: boolean
  consumeBytes?: (bytes: number) => void
}>

export function readDeclaredBodyLength(request: IncomingMessage): number | null {
  const distinctValues = request.headersDistinct['content-length']
  if (distinctValues && distinctValues.length !== 1) {
    throw new CliRequestError('invalid_request', 'Content-Length must be singular')
  }

  const rawValue = distinctValues?.[0] ?? request.headers['content-length']
  if (rawValue === undefined) return null
  if (Array.isArray(rawValue) || !/^(0|[1-9][0-9]*)$/.test(rawValue)) {
    throw new CliRequestError('invalid_request', 'Content-Length is invalid')
  }

  const parsed = Number(rawValue)
  if (!Number.isSafeInteger(parsed)) {
    throw new CliRequestError('invalid_request', 'Content-Length is too large')
  }
  return parsed
}

async function removeFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function writeAll(handle: FileHandle, bytes: Buffer, position: number): Promise<number> {
  let offset = 0
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.length - offset,
      position + offset
    )
    if (bytesWritten === 0) throw new Error('Failed to persist request body')
    offset += bytesWritten
  }
  return position + bytes.length
}

export async function readBoundedRequestBody(
  request: IncomingMessage,
  options: BoundedBodyOptions
): Promise<BoundedRequestBody> {
  if (
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes <= 0 ||
    !Number.isSafeInteger(options.memoryThresholdBytes) ||
    options.memoryThresholdBytes < 0 ||
    options.memoryThresholdBytes > options.maxBytes
  ) {
    throw new Error('Invalid bounded-body limits')
  }

  if (request.headers['content-encoding'] !== undefined) {
    throw new CliRequestError('invalid_request', 'Content-Encoding is not supported')
  }

  const declaredLength = readDeclaredBodyLength(request)
  if (options.requireContentLength && declaredLength === null) {
    throw new CliRequestError('invalid_request', 'Content-Length is required', {
      httpStatus: 411
    })
  }
  if (declaredLength !== null && declaredLength > options.maxBytes) {
    throw new CliRequestError('body_too_large', 'Request body exceeds its byte limit', {
      httpStatus: 413
    })
  }

  const chunks: Buffer[] = []
  const sha256 = createHash('sha256')
  let size = 0
  let filePosition = 0
  let fileHandle: FileHandle | undefined
  let tempPath: string | undefined

  const cleanupPartial = async (): Promise<void> => {
    const cleanupErrors: unknown[] = []
    if (fileHandle) {
      await fileHandle.close().catch((error: unknown) => cleanupErrors.push(error))
      fileHandle = undefined
    }
    if (tempPath) {
      await removeFile(tempPath).catch((error: unknown) => cleanupErrors.push(error))
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Failed to clean up partial request body')
    }
  }

  try {
    for await (const rawChunk of request) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk)
      size += chunk.length
      if (size > options.maxBytes) {
        request.pause()
        throw new CliRequestError('body_too_large', 'Request body exceeds its byte limit', {
          httpStatus: 413
        })
      }
      options.consumeBytes?.(chunk.length)

      sha256.update(chunk)

      if (!fileHandle && size > options.memoryThresholdBytes) {
        await mkdir(options.tempDirectory, { recursive: true, mode: 0o700 })
        tempPath = path.join(options.tempDirectory, `body-${randomUUID()}.tmp`)
        fileHandle = await open(tempPath, 'wx', 0o600)
        for (const buffered of chunks) {
          filePosition = await writeAll(fileHandle, buffered, filePosition)
        }
        chunks.length = 0
      }

      if (fileHandle) filePosition = await writeAll(fileHandle, chunk, filePosition)
      else chunks.push(chunk)
    }

    if (declaredLength !== null && size !== declaredLength) {
      throw new CliRequestError('invalid_request', 'Request body length does not match')
    }

    const digest = sha256.digest('hex')

    if (fileHandle && tempPath) {
      await fileHandle.close()
      fileHandle = undefined
      const persistedPath = tempPath
      let cleaned = false
      return {
        kind: 'file',
        path: persistedPath,
        size,
        sha256: digest,
        cleanup: async () => {
          if (cleaned) return
          await removeFile(persistedPath)
          cleaned = true
        }
      }
    }

    return {
      kind: 'memory',
      bytes: Buffer.concat(chunks, size),
      size,
      sha256: digest,
      cleanup: async () => undefined
    }
  } catch (error) {
    try {
      await cleanupPartial()
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Request body failed and cleanup was incomplete'
      )
    }
    throw error
  }
}

function assertBoundedJsonShape(value: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let keys = 0
  let nodes = 0

  while (pending.length > 0) {
    const current = pending.pop()!
    nodes += 1
    if (nodes > DEFAULT_MAX_JSON_NODES) {
      throw new CliRequestError('invalid_request', 'JSON body has too many values')
    }
    if (current.depth > DEFAULT_MAX_JSON_DEPTH) {
      throw new CliRequestError('invalid_request', 'JSON body is nested too deeply')
    }
    if (Array.isArray(current.value)) {
      for (const entry of current.value) {
        pending.push({ value: entry, depth: current.depth + 1 })
      }
      continue
    }
    if (!current.value || typeof current.value !== 'object') continue

    for (const [key, entry] of Object.entries(current.value)) {
      keys += 1
      if (keys > DEFAULT_MAX_JSON_KEYS) {
        throw new CliRequestError('invalid_request', 'JSON body has too many keys')
      }
      if (UNSAFE_JSON_KEYS.has(key)) {
        throw new CliRequestError('invalid_request', `JSON key is not allowed: ${key}`)
      }
      pending.push({ value: entry, depth: current.depth + 1 })
    }
  }
}

export function parseBoundedJsonBytes(bytes: Uint8Array): unknown {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new CliRequestError('invalid_request', 'Request body is not valid UTF-8')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new CliRequestError('invalid_request', 'Request body is not valid JSON')
  }
  assertBoundedJsonShape(parsed)
  return parsed
}

export async function parseBoundedJsonBody(body: BoundedRequestBody): Promise<unknown> {
  try {
    const bytes = body.kind === 'memory' ? body.bytes : await readFile(body.path)
    return parseBoundedJsonBytes(bytes)
  } finally {
    await body.cleanup()
  }
}
