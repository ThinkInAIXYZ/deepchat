import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http'
import {
  LOCAL_CONTROL_RPC_PATH,
  LOCAL_CONTROL_STREAM_PATH,
  LOCAL_CONTROL_UPLOAD_PATH,
  LOCAL_CONTROL_METHOD_HEADER,
  LOCAL_CONTROL_UPLOAD_REQUEST_HEADER,
  LOCAL_CONTROL_MAX_JSON_RESPONSE_BYTES,
  LOCAL_CONTROL_MAX_STREAM_RECORD_BYTES,
  LOCAL_CONTROL_MAX_UPLOAD_REQUEST_HEADER_BYTES,
  LocalControlEventEnvelopeSchema,
  LocalControlRpcRequestSchema,
  LocalControlRpcResponseSchema,
  LocalControlStreamRecordSchema,
  LocalControlUploadRequestSchema,
  type LocalControlDescriptor,
  type LocalControlEventEnvelope,
  type LocalControlRpcResponse,
  type LocalControlUploadBinding
} from '@shared/contracts/localControl'
import type { JsonValue } from '@shared/contracts/json'
import { CLI_EXIT_CODES, CliClientError } from './errors'

export const CLI_VERSION =
  typeof __DEEPCHAT_CLI_VERSION__ === 'string' ? __DEEPCHAT_CLI_VERSION__ : 'development'

export type CliRpcInvocation = Readonly<{
  descriptor: LocalControlDescriptor
  token: string
  id: string
  method: string
  params: JsonValue
  signal: AbortSignal
}>

export type CliUploadInvocation = CliRpcInvocation &
  Readonly<{
    filePath: string
    maxBytes: number
  }>

export type CliStreamEventHandler = (event: LocalControlEventEnvelope) => void | Promise<void>

function transportFailure(message: string, retriable = true): CliClientError {
  return new CliClientError('unavailable', message, CLI_EXIT_CODES.unavailable, retriable)
}

function protocolFailure(message: string): CliClientError {
  return new CliClientError('internal_error', message, CLI_EXIT_CODES.internal)
}

function declaredResponseLength(
  headers: IncomingHttpHeaders,
  distinctValues: readonly string[] | undefined
): number | null {
  if (distinctValues && distinctValues.length !== 1) {
    throw protocolFailure('DeepChat returned multiple Content-Length headers')
  }
  const raw = distinctValues?.[0] ?? headers['content-length']
  if (raw === undefined) return null
  if (Array.isArray(raw) || !/^(0|[1-9][0-9]*)$/.test(raw)) {
    throw protocolFailure('DeepChat returned an invalid Content-Length')
  }
  const length = Number(raw)
  if (!Number.isSafeInteger(length) || length > LOCAL_CONTROL_MAX_JSON_RESPONSE_BYTES) {
    throw protocolFailure('DeepChat response exceeds the CLI byte limit')
  }
  return length
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new CliClientError('cancelled', 'CLI request was cancelled', CLI_EXIT_CODES.cancelled)
}

function createInvocationBody(invocation: CliRpcInvocation): Buffer {
  return Buffer.from(
    JSON.stringify(
      LocalControlRpcRequestSchema.parse({
        protocolVersion: invocation.descriptor.protocolVersion,
        surfaceVersion: invocation.descriptor.surfaceVersion,
        id: invocation.id,
        method: invocation.method,
        params: invocation.params
      })
    ),
    'utf8'
  )
}

function createUploadInvocationHeader(
  invocation: CliRpcInvocation,
  upload: LocalControlUploadBinding
): string {
  return Buffer.from(
    JSON.stringify(
      LocalControlUploadRequestSchema.parse({
        protocolVersion: invocation.descriptor.protocolVersion,
        surfaceVersion: invocation.descriptor.surfaceVersion,
        id: invocation.id,
        method: invocation.method,
        params: invocation.params,
        upload
      })
    ),
    'utf8'
  ).toString('base64url')
}

async function readJsonResponse(
  response: IncomingMessage,
  expectedRequestId: string,
  signal: AbortSignal
): Promise<LocalControlRpcResponse> {
  try {
    const contentTypes = response.headersDistinct['content-type']
    const contentType = contentTypes?.[0] ?? response.headers['content-type']
    const [mediaType, ...parameters] =
      typeof contentType === 'string'
        ? contentType.split(';').map((part) => part.trim().toLowerCase())
        : []
    if (
      (contentTypes && contentTypes.length !== 1) ||
      mediaType !== 'application/json' ||
      !parameters.every((parameter) => parameter === 'charset=utf-8')
    ) {
      throw protocolFailure('DeepChat returned a non-JSON response')
    }
    if (response.headers['content-encoding'] !== undefined) {
      throw protocolFailure('Compressed local responses are not supported')
    }

    const expectedLength = declaredResponseLength(
      response.headers,
      response.headersDistinct['content-length']
    )
    const chunks: Buffer[] = []
    let size = 0
    for await (const rawChunk of response) {
      const chunk = Buffer.from(rawChunk)
      size += chunk.length
      if (size > LOCAL_CONTROL_MAX_JSON_RESPONSE_BYTES) {
        throw protocolFailure('DeepChat response exceeds the CLI byte limit')
      }
      chunks.push(chunk)
    }
    if (expectedLength !== null && expectedLength !== size) {
      throw protocolFailure('DeepChat response length did not match')
    }

    let parsed: LocalControlRpcResponse
    try {
      parsed = LocalControlRpcResponseSchema.parse(
        JSON.parse(Buffer.concat(chunks, size).toString('utf8'))
      )
    } catch {
      throw protocolFailure('DeepChat returned an invalid response envelope')
    }
    const isHttpSuccess = (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300
    if (parsed.ok !== isHttpSuccess) {
      throw protocolFailure('DeepChat HTTP status and response envelope disagree')
    }
    if (parsed.id !== expectedRequestId && !(!parsed.ok && parsed.id === 'unknown')) {
      throw protocolFailure('DeepChat response ID did not match the request')
    }
    return parsed
  } catch (error) {
    if (!response.destroyed) response.destroy()
    if (signal.aborted) throw abortReason(signal)
    if (error instanceof CliClientError) throw error
    throw transportFailure(error instanceof Error ? error.message : 'Local response failed')
  }
}

export async function invokeLocalControlRpc(
  invocation: CliRpcInvocation
): Promise<LocalControlRpcResponse> {
  if (invocation.signal.aborted) throw abortReason(invocation.signal)
  const body = createInvocationBody(invocation)

  return await new Promise<LocalControlRpcResponse>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      callback()
    }
    const request = httpRequest({
      socketPath:
        invocation.descriptor.endpoint.kind === 'unix'
          ? invocation.descriptor.endpoint.path
          : invocation.descriptor.endpoint.name,
      path: LOCAL_CONTROL_RPC_PATH,
      method: 'POST',
      agent: false,
      signal: invocation.signal,
      headers: {
        authorization: `Bearer ${invocation.token}`,
        'content-type': 'application/json',
        'content-length': body.length,
        [LOCAL_CONTROL_METHOD_HEADER]: invocation.method,
        connection: 'close',
        'user-agent': `DeepChat-CLI/${CLI_VERSION}`
      }
    })

    request.once('response', (response) => {
      void readJsonResponse(response, invocation.id, invocation.signal).then(
        (result) => finish(() => resolve(result)),
        (error: unknown) => finish(() => reject(error))
      )
    })
    request.once('error', (error: NodeJS.ErrnoException) => {
      if (invocation.signal.aborted) {
        finish(() => reject(abortReason(invocation.signal)))
        return
      }
      const message =
        error.code === 'ENOENT' || error.code === 'ECONNREFUSED' || error.code === 'EPIPE'
          ? 'DeepChat local control server is unavailable'
          : `Cannot connect to DeepChat: ${error.message}`
      finish(() => reject(transportFailure(message)))
    })
    request.end(body)
  })
}

function uploadFileError(message: string, code: 'invalid_request' | 'body_too_large') {
  return new CliClientError(
    code,
    message,
    code === 'invalid_request' ? CLI_EXIT_CODES.usage : CLI_EXIT_CODES.domain
  )
}

async function hashUploadFile(
  handle: Awaited<ReturnType<typeof open>>,
  size: number,
  signal: AbortSignal
): Promise<string> {
  try {
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(Math.min(size, 256 * 1024))
    let position = 0
    while (position < size) {
      if (signal.aborted) throw abortReason(signal)
      const length = Math.min(buffer.length, size - position)
      const { bytesRead } = await handle.read(buffer, 0, length, position)
      if (bytesRead === 0) {
        throw uploadFileError('Upload source changed while it was being read', 'invalid_request')
      }
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    return hash.digest('hex')
  } catch (error) {
    if (signal.aborted) throw abortReason(signal)
    if (error instanceof CliClientError) throw error
    throw uploadFileError('Upload source could not be read', 'invalid_request')
  }
}

export async function invokeLocalControlUpload(
  invocation: CliUploadInvocation
): Promise<LocalControlRpcResponse> {
  if (invocation.signal.aborted) throw abortReason(invocation.signal)
  if (!Number.isSafeInteger(invocation.maxBytes) || invocation.maxBytes <= 0) {
    throw protocolFailure('CLI upload limit is invalid')
  }

  let pathStat
  try {
    pathStat = await lstat(invocation.filePath)
  } catch {
    throw uploadFileError('Upload source is unavailable', 'invalid_request')
  }
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
    throw uploadFileError('Upload source must be a regular non-symlink file', 'invalid_request')
  }
  if (pathStat.size <= 0) {
    throw uploadFileError('Upload source is empty', 'invalid_request')
  }
  if (!Number.isSafeInteger(pathStat.size) || pathStat.size > invocation.maxBytes) {
    throw uploadFileError('Upload source exceeds the command byte limit', 'body_too_large')
  }

  const openFlags =
    process.platform === 'win32'
      ? fsConstants.O_RDONLY
      : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
  let handle
  try {
    handle = await open(invocation.filePath, openFlags)
  } catch {
    throw uploadFileError('Upload source could not be opened safely', 'invalid_request')
  }

  try {
    const openedStat = await handle.stat()
    if (
      !openedStat.isFile() ||
      openedStat.size !== pathStat.size ||
      openedStat.dev !== pathStat.dev ||
      openedStat.ino !== pathStat.ino
    ) {
      throw uploadFileError('Upload source changed before it could be read', 'invalid_request')
    }

    const sha256 = await hashUploadFile(handle, openedStat.size, invocation.signal)
    const hashedStat = await handle.stat()
    if (
      !hashedStat.isFile() ||
      hashedStat.size !== openedStat.size ||
      hashedStat.dev !== openedStat.dev ||
      hashedStat.ino !== openedStat.ino
    ) {
      throw uploadFileError('Upload source changed while it was being read', 'invalid_request')
    }
    const envelope = createUploadInvocationHeader(invocation, {
      size: openedStat.size,
      sha256
    })
    if (Buffer.byteLength(envelope, 'ascii') > LOCAL_CONTROL_MAX_UPLOAD_REQUEST_HEADER_BYTES) {
      throw uploadFileError('Upload metadata exceeds the CLI byte limit', 'invalid_request')
    }

    const uploadStream = handle.createReadStream({
      autoClose: false,
      start: 0,
      end: openedStat.size - 1,
      signal: invocation.signal
    })
    try {
      return await new Promise<LocalControlRpcResponse>((resolve, reject) => {
        let settled = false
        let responseReceived = false
        const finish = (callback: () => void) => {
          if (settled) return
          settled = true
          callback()
        }
        const request = httpRequest({
          socketPath:
            invocation.descriptor.endpoint.kind === 'unix'
              ? invocation.descriptor.endpoint.path
              : invocation.descriptor.endpoint.name,
          path: LOCAL_CONTROL_UPLOAD_PATH,
          method: 'POST',
          agent: false,
          signal: invocation.signal,
          headers: {
            authorization: `Bearer ${invocation.token}`,
            'content-type': 'application/octet-stream',
            'content-length': openedStat.size,
            expect: '100-continue',
            [LOCAL_CONTROL_UPLOAD_REQUEST_HEADER]: envelope,
            connection: 'close',
            'user-agent': `DeepChat-CLI/${CLI_VERSION}`
          }
        })

        request.once('response', (response) => {
          responseReceived = true
          void readJsonResponse(response, invocation.id, invocation.signal).then(
            (result) => finish(() => resolve(result)),
            (error: unknown) => finish(() => reject(error))
          )
        })
        request.once('error', (error: NodeJS.ErrnoException) => {
          if (responseReceived) return
          if (invocation.signal.aborted) {
            finish(() => reject(abortReason(invocation.signal)))
            return
          }
          const message =
            error.code === 'ENOENT' || error.code === 'ECONNREFUSED' || error.code === 'EPIPE'
              ? 'DeepChat local control server is unavailable'
              : `Cannot connect to DeepChat: ${error.message}`
          finish(() => reject(transportFailure(message)))
        })
        uploadStream.once('error', (error) => {
          if (responseReceived) return
          request.destroy(error)
          if (!invocation.signal.aborted) {
            finish(() => reject(transportFailure('Upload source could not be read')))
          }
        })
        request.once('continue', () => uploadStream.pipe(request))
        request.flushHeaders()
      })
    } finally {
      uploadStream.destroy()
    }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

export async function invokeLocalControlStream(
  invocation: CliRpcInvocation,
  onEvent: CliStreamEventHandler
): Promise<LocalControlRpcResponse> {
  if (invocation.signal.aborted) throw abortReason(invocation.signal)
  const body = createInvocationBody(invocation)

  return await new Promise<LocalControlRpcResponse>((resolve, reject) => {
    let settled = false
    let responseReceived = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      callback()
    }
    const request = httpRequest({
      socketPath:
        invocation.descriptor.endpoint.kind === 'unix'
          ? invocation.descriptor.endpoint.path
          : invocation.descriptor.endpoint.name,
      path: LOCAL_CONTROL_STREAM_PATH,
      method: 'POST',
      agent: false,
      signal: invocation.signal,
      headers: {
        authorization: `Bearer ${invocation.token}`,
        'content-type': 'application/json',
        'content-length': body.length,
        [LOCAL_CONTROL_METHOD_HEADER]: invocation.method,
        connection: 'close',
        'user-agent': `DeepChat-CLI/${CLI_VERSION}`
      }
    })

    request.once('response', (response) => {
      responseReceived = true
      void (async () => {
        const contentTypes = response.headersDistinct['content-type']
        const contentType = contentTypes?.[0] ?? response.headers['content-type']
        const [mediaType, ...parameters] =
          typeof contentType === 'string'
            ? contentType.split(';').map((part) => part.trim().toLowerCase())
            : []
        if (contentTypes && contentTypes.length !== 1) {
          throw protocolFailure('DeepChat returned multiple Content-Type headers')
        }
        if (response.headers['content-encoding'] !== undefined) {
          throw protocolFailure('Compressed local responses are not supported')
        }

        const isHttpSuccess = (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300
        if (!isHttpSuccess) {
          if (
            mediaType !== 'application/json' ||
            !parameters.every((parameter) => parameter === 'charset=utf-8')
          ) {
            throw protocolFailure('DeepChat returned a non-JSON error response')
          }
          const expectedLength = declaredResponseLength(
            response.headers,
            response.headersDistinct['content-length']
          )
          const chunks: Buffer[] = []
          let size = 0
          for await (const rawChunk of response) {
            const chunk = Buffer.from(rawChunk)
            size += chunk.length
            if (size > LOCAL_CONTROL_MAX_JSON_RESPONSE_BYTES) {
              throw protocolFailure('DeepChat response exceeds the CLI byte limit')
            }
            chunks.push(chunk)
          }
          if (expectedLength !== null && expectedLength !== size) {
            throw protocolFailure('DeepChat response length did not match')
          }
          const parsed = LocalControlRpcResponseSchema.parse(
            JSON.parse(Buffer.concat(chunks, size).toString('utf8'))
          )
          if (parsed.ok) {
            throw protocolFailure('DeepChat HTTP status and response envelope disagree')
          }
          if (parsed.id !== invocation.id && parsed.id !== 'unknown') {
            throw protocolFailure('DeepChat response ID did not match the request')
          }
          return parsed
        }

        if (
          mediaType !== 'application/x-ndjson' ||
          !parameters.every((parameter) => parameter === 'charset=utf-8')
        ) {
          throw protocolFailure('DeepChat returned a non-NDJSON stream')
        }

        let pendingChunks: Buffer[] = []
        let pendingLength = 0
        let expectedSequence = 0
        let terminal: LocalControlRpcResponse | undefined
        const consumeLine = async (line: Buffer): Promise<void> => {
          if (line.length === 0) throw protocolFailure('DeepChat returned an empty stream record')
          let parsed
          try {
            parsed = LocalControlStreamRecordSchema.parse(JSON.parse(line.toString('utf8')))
          } catch {
            throw protocolFailure('DeepChat returned an invalid stream record')
          }
          if ('ok' in parsed) {
            if (terminal) throw protocolFailure('DeepChat returned multiple terminal records')
            if (parsed.id !== invocation.id) {
              throw protocolFailure('DeepChat stream result ID did not match the request')
            }
            terminal = parsed
            return
          }
          if (terminal)
            throw protocolFailure('DeepChat returned an event after the terminal record')
          const event = LocalControlEventEnvelopeSchema.parse(parsed)
          if (event.requestId !== invocation.id || event.sequence !== expectedSequence) {
            throw protocolFailure('DeepChat stream event identity or order did not match')
          }
          expectedSequence += 1
          await onEvent(event)
        }

        for await (const rawChunk of response) {
          const chunk = Buffer.from(rawChunk)
          let offset = 0
          while (offset < chunk.length) {
            const newlineIndex = chunk.indexOf(0x0a, offset)
            const end = newlineIndex >= 0 ? newlineIndex : chunk.length
            if (end > offset) {
              const segment = chunk.subarray(offset, end)
              pendingChunks.push(segment)
              pendingLength += segment.length
            }
            if (pendingLength > LOCAL_CONTROL_MAX_STREAM_RECORD_BYTES) {
              throw protocolFailure('DeepChat stream record exceeds the CLI byte limit')
            }
            if (newlineIndex < 0) break
            const line =
              pendingChunks.length === 1
                ? pendingChunks[0]
                : Buffer.concat(pendingChunks, pendingLength)
            await consumeLine(line)
            pendingChunks = []
            pendingLength = 0
            offset = newlineIndex + 1
          }
        }
        if (pendingLength !== 0) {
          throw protocolFailure('DeepChat stream ended with an incomplete record')
        }
        if (!terminal) throw protocolFailure('DeepChat stream ended without a terminal record')
        return terminal
      })().then(
        (result) => finish(() => resolve(result)),
        (error: unknown) => {
          response.destroy()
          finish(() =>
            reject(
              invocation.signal.aborted
                ? abortReason(invocation.signal)
                : error instanceof CliClientError
                  ? error
                  : protocolFailure('DeepChat stream transport failed')
            )
          )
        }
      )
    })
    request.once('error', (error: NodeJS.ErrnoException) => {
      if (responseReceived) return
      if (invocation.signal.aborted) {
        finish(() => reject(abortReason(invocation.signal)))
        return
      }
      const message =
        error.code === 'ENOENT' || error.code === 'ECONNREFUSED' || error.code === 'EPIPE'
          ? 'DeepChat local control server is unavailable'
          : `Cannot connect to DeepChat: ${error.message}`
      finish(() => reject(transportFailure(message)))
    })
    request.end(body)
  })
}
