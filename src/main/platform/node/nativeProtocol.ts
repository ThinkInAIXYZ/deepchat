import { Buffer } from 'node:buffer'
import type { NativeCaller } from './nativeWindowProtocol'

export const NATIVE_PROTOCOL_BEGIN_ROUTE = 'native.protocol.begin'
export const NATIVE_PROTOCOL_READ_ROUTE = 'native.protocol.read'
export const NATIVE_PROTOCOL_CANCEL_ROUTE = 'native.protocol.cancel'

export const NATIVE_PROTOCOL_SCHEMES = new Set([
  'deepcdn',
  'imgcache',
  'workspace-preview',
  'mcp-app'
])

const MAX_CHUNK_BYTES = 256 * 1024
const MAX_HEADER_BYTES = 64 * 1024
const MAX_URL_LENGTH = 64 * 1024
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
])

type ProtocolRequest = {
  url: string
  method: string
  headers: Record<string, string>
}

type ProtocolHandler = (request: ProtocolRequest) => Response | Promise<Response>

type ProtocolStream = {
  id: string
  scheme: string
  owner: NativeCaller
  reader: ReadableStreamDefaultReader<Uint8Array>
  pending: Uint8Array | null
  offset: number
  sourceDone: boolean
  closed: boolean
}

type ProtocolMetadata = {
  status: number
  headers: Array<[string, string]>
  body: boolean
}

type PendingProtocolBegin = {
  scheme: string
  owner: NativeCaller
  cancelled: boolean
}

type CancelledProtocolBegin = {
  owner: NativeCaller
  createdAt: number
}

const handlers = new Map<string, ProtocolHandler>()
const streams = new Map<string, ProtocolStream>()
const pendingBegins = new Map<string, PendingProtocolBegin>()
const cancelledBegins = new Map<string, CancelledProtocolBegin>()
const CANCELLED_BEGIN_TTL_MS = 5 * 60 * 1000
const MAX_CANCELLED_BEGINS = 4096

function inputRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('native protocol input is invalid')
  }
  return value as Record<string, unknown>
}

function callerRecord(value: NativeCaller | undefined): NativeCaller {
  if (
    !value ||
    !Number.isSafeInteger(value.windowId) ||
    value.windowId <= 0 ||
    typeof value.documentUrl !== 'string' ||
    !value.documentUrl
  ) {
    throw new Error('native protocol caller is invalid')
  }
  return { windowId: value.windowId, documentUrl: value.documentUrl }
}

function streamId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) {
    throw new Error('native protocol stream ID is invalid')
  }
  return value
}

function parseRequest(value: unknown): { streamId: string; request: ProtocolRequest } {
  const input = inputRecord(value)
  const method = input.method
  if (method !== 'GET' && method !== 'HEAD') {
    throw new Error('native protocol only supports GET and HEAD')
  }
  if (typeof input.url !== 'string' || input.url.length > MAX_URL_LENGTH) {
    throw new Error('native protocol request URL is invalid')
  }
  const headersInput = inputRecord(input.headers ?? {})
  const headers: Record<string, string> = {}
  let headerBytes = 0
  for (const [name, value] of Object.entries(headersInput)) {
    if (typeof value !== 'string' || /[\r\n\0]/.test(name) || /[\r\n\0]/.test(value)) {
      throw new Error('native protocol request header is invalid')
    }
    headerBytes += Buffer.byteLength(name) + Buffer.byteLength(value)
    if (headerBytes > MAX_HEADER_BYTES) {
      throw new Error('native protocol request headers are too large')
    }
    headers[name] = value
  }
  return {
    streamId: streamId(input.streamId),
    request: { url: input.url, method, headers }
  }
}

function responseHeaders(response: Response): Array<[string, string]> {
  const connectionNominated = new Set<string>()
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'connection') return
    for (const token of value.split(',')) {
      const normalized = token.trim().toLowerCase()
      if (normalized) connectionNominated.add(normalized)
    }
  })
  const headers: Array<[string, string]> = []
  let headerBytes = 0
  response.headers.forEach((value, name) => {
    const normalized = name.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(normalized) || connectionNominated.has(normalized)) return
    if (/[\r\n\0]/.test(name) || /[\r\n\0]/.test(value)) {
      throw new Error('native protocol response header is invalid')
    }
    if (normalized === 'content-length' && !/^\d+$/.test(value)) {
      throw new Error('native protocol content length is invalid')
    }
    headerBytes += Buffer.byteLength(name) + Buffer.byteLength(value)
    if (headerBytes > MAX_HEADER_BYTES) {
      throw new Error('native protocol response headers are too large')
    }
    headers.push([name, value])
  })
  return headers
}

async function destroyStream(stream: ProtocolStream, cancel: boolean): Promise<void> {
  if (stream.closed) return
  stream.closed = true
  if (streams.get(stream.id) === stream) {
    streams.delete(stream.id)
  }
  try {
    if (cancel) await stream.reader.cancel()
  } finally {
    stream.reader.releaseLock()
  }
}

function registerStream(
  id: string,
  scheme: string,
  owner: NativeCaller,
  reader: ReadableStreamDefaultReader<Uint8Array>
): ProtocolStream {
  const stream: ProtocolStream = {
    id,
    scheme,
    owner,
    reader,
    pending: null,
    offset: 0,
    sourceDone: false,
    closed: false
  }
  streams.set(id, stream)
  return stream
}

function pruneCancelledBegins(): void {
  const now = Date.now()
  for (const [id, record] of cancelledBegins) {
    if (now - record.createdAt >= CANCELLED_BEGIN_TTL_MS) cancelledBegins.delete(id)
  }
  while (cancelledBegins.size >= MAX_CANCELLED_BEGINS) {
    const oldest = cancelledBegins.keys().next().value
    if (oldest === undefined) break
    cancelledBegins.delete(oldest)
  }
}

function rememberCancelledBegin(id: string, owner: NativeCaller): void {
  pruneCancelledBegins()
  cancelledBegins.delete(id)
  cancelledBegins.set(id, { owner, createdAt: Date.now() })
}

function assertPendingOwner(pending: PendingProtocolBegin, caller: NativeCaller): void {
  if (pending.owner.windowId !== caller.windowId) {
    throw new Error('native protocol stream owner does not match')
  }
  if (pending.owner.documentUrl !== caller.documentUrl) {
    throw new Error('native protocol stream document is no longer current')
  }
}

function consumeCancelledBegin(id: string, caller: NativeCaller): void {
  const cancelled = cancelledBegins.get(id)
  if (!cancelled) return
  if (
    cancelled.owner.windowId !== caller.windowId ||
    cancelled.owner.documentUrl !== caller.documentUrl
  ) {
    throw new Error('native protocol stream owner does not match')
  }
  cancelledBegins.delete(id)
  throw new Error('native protocol stream was cancelled')
}

async function cancelResponseBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!body) return
  try {
    await body.cancel()
  } catch {
    // Preserve the handler or validation error that caused the cleanup.
  }
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel()
  } catch {
    // Preserve the handler or validation error that caused the cleanup.
  } finally {
    reader.releaseLock()
  }
}

function assertStreamOwner(stream: ProtocolStream, caller: NativeCaller): void {
  if (stream.owner.windowId !== caller.windowId) {
    throw new Error('native protocol stream owner does not match')
  }
  if (stream.owner.documentUrl !== caller.documentUrl) {
    void destroyStream(stream, true)
    throw new Error('native protocol stream document is no longer current')
  }
}

async function readChunk(
  caller: NativeCaller,
  id: string
): Promise<{ done: boolean; data: string }> {
  const stream = streams.get(id)
  if (!stream || stream.closed) throw new Error('native protocol stream is not available')
  assertStreamOwner(stream, caller)
  try {
    for (;;) {
      if (stream.pending) {
        const end = Math.min(stream.offset + MAX_CHUNK_BYTES, stream.pending.byteLength)
        const data = Buffer.from(
          stream.pending.buffer,
          stream.pending.byteOffset + stream.offset,
          end - stream.offset
        ).toString('base64')
        stream.offset = end
        if (end === stream.pending.byteLength) {
          stream.pending = null
          stream.offset = 0
        }
        return { done: false, data }
      }
      if (stream.sourceDone) {
        await destroyStream(stream, false)
        return { done: true, data: '' }
      }
      const result = await stream.reader.read()
      if (stream.closed) throw new Error('native protocol stream is not available')
      if (result.done) {
        stream.sourceDone = true
        if (result.value === undefined) continue
      }
      if (!(result.value instanceof Uint8Array) || result.value.byteLength === 0) {
        throw new Error('native protocol response chunk is invalid')
      }
      stream.pending = result.value
      stream.offset = 0
    }
  } catch (error) {
    await destroyStream(stream, true)
    throw error
  }
}

async function beginRequest(caller: NativeCaller, value: unknown): Promise<ProtocolMetadata> {
  const { streamId: id, request } = parseRequest(value)
  let parsedUrl: URL
  try {
    parsedUrl = new URL(request.url)
  } catch {
    throw new Error('native protocol request URL is invalid')
  }
  const scheme = parsedUrl.protocol.slice(0, -1).toLowerCase()
  if (
    parsedUrl.username ||
    parsedUrl.password ||
    !NATIVE_PROTOCOL_SCHEMES.has(scheme) ||
    parsedUrl.href !== request.url
  ) {
    throw new Error('native protocol request URL is not allowed')
  }
  if (streams.has(id) || pendingBegins.has(id)) {
    throw new Error('native protocol stream ID is already in use')
  }
  pruneCancelledBegins()
  consumeCancelledBegin(id, caller)

  const pending: PendingProtocolBegin = { scheme, owner: caller, cancelled: false }
  pendingBegins.set(id, pending)
  let response: Response | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const handler = handlers.get(scheme)
    response = handler
      ? await handler(request)
      : new Response('Protocol handler is not registered', {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        })
    if (!response || typeof response.status !== 'number' || !response.headers) {
      throw new Error('native protocol handler returned an invalid response')
    }
    if (pending.cancelled) throw new Error('native protocol stream was cancelled')

    const metadata: ProtocolMetadata = {
      status: response.status,
      headers: responseHeaders(response),
      body: response.body !== null && request.method === 'GET'
    }
    if (metadata.status < 200 || metadata.status > 599) {
      throw new Error('native protocol response status is invalid')
    }
    if (request.method === 'HEAD') {
      if (response.body) await response.body.cancel()
      if (pending.cancelled) throw new Error('native protocol stream was cancelled')
      return metadata
    }
    if (response.body === null) {
      if (pending.cancelled) throw new Error('native protocol stream was cancelled')
      return metadata
    }
    if (pending.cancelled) throw new Error('native protocol stream was cancelled')

    try {
      reader = response.body.getReader()
    } catch {
      throw new Error('native protocol response body is unavailable')
    }
    if (pending.cancelled) throw new Error('native protocol stream was cancelled')
    registerStream(id, scheme, caller, reader)
    return metadata
  } catch (error) {
    if (reader) {
      await cancelReader(reader)
    } else {
      await cancelResponseBody(response?.body ?? null)
    }
    throw error
  } finally {
    pendingBegins.delete(id)
  }
}

export function handleNativeProtocol(scheme: string, handler: ProtocolHandler): boolean {
  if (typeof handler !== 'function') throw new TypeError('protocol handler must be a function')
  const normalized = scheme.toLowerCase()
  if (!NATIVE_PROTOCOL_SCHEMES.has(normalized)) return false
  handlers.set(normalized, handler)
  return true
}

export function unhandleNativeProtocol(scheme: string): void {
  const normalized = scheme.toLowerCase()
  handlers.delete(normalized)
  for (const pending of pendingBegins.values()) {
    if (pending.scheme === normalized) pending.cancelled = true
  }
  const cancellations: Promise<void>[] = []
  for (const stream of streams.values()) {
    if (stream.scheme === normalized) cancellations.push(destroyStream(stream, true))
  }
  void Promise.all(cancellations).catch((error) => {
    console.error('[sidecar] native protocol cancellation failed', error)
  })
}

export function isNativeProtocolHandled(scheme: string): boolean {
  return handlers.has(scheme.toLowerCase())
}

export async function handleNativeProtocolRoute(
  route: string,
  input: unknown,
  source?: NativeCaller
): Promise<unknown> {
  const caller = callerRecord(source)
  if (route === NATIVE_PROTOCOL_BEGIN_ROUTE) return beginRequest(caller, input)
  const id = streamId(inputRecord(input).streamId)
  if (route === NATIVE_PROTOCOL_READ_ROUTE) return readChunk(caller, id)
  if (route === NATIVE_PROTOCOL_CANCEL_ROUTE) {
    const stream = streams.get(id)
    if (stream) {
      assertStreamOwner(stream, caller)
      await destroyStream(stream, true)
      return { done: true }
    }
    const pending = pendingBegins.get(id)
    if (pending) {
      assertPendingOwner(pending, caller)
      pending.cancelled = true
      return { done: true }
    }
    rememberCancelledBegin(id, caller)
    return { done: true }
  }
  throw new Error('unsupported native protocol route')
}
