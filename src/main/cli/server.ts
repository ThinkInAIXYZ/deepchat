import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import { ArtifactIdSchema, artifactsReadRoute } from '@shared/contracts/routes'
import { JsonValueSchema, TimestampMsSchema, type JsonValue } from '@shared/contracts/common'
import {
  LOCAL_CONTROL_DESCRIPTOR_FILENAME,
  LOCAL_CONTROL_ARTIFACT_PATH_PREFIX,
  LOCAL_CONTROL_MAX_REQUEST_TIMEOUT_MS,
  LOCAL_CONTROL_METHOD_HEADER,
  LOCAL_CONTROL_PROTOCOL_VERSION,
  LOCAL_CONTROL_RPC_PATH,
  LOCAL_CONTROL_SCOPES,
  LOCAL_CONTROL_STREAM_PATH,
  LOCAL_CONTROL_SURFACE_VERSION,
  LOCAL_CONTROL_UPLOAD_PATH,
  LOCAL_CONTROL_UPLOAD_REQUEST_HEADER,
  LOCAL_CONTROL_MAX_JSON_RESPONSE_BYTES,
  LOCAL_CONTROL_MAX_STREAM_RECORD_BYTES,
  LOCAL_CONTROL_MAX_UPLOAD_REQUEST_HEADER_BYTES,
  LocalControlEventEnvelopeSchema,
  LocalControlMethodSchema,
  LocalControlScopesSchema,
  LocalControlTokenSchema,
  LocalControlRpcRequestSchema,
  LocalControlUploadRequestSchema,
  createLocalControlFailure,
  createLocalControlSuccess,
  type LocalControlDescriptor,
  type LocalControlRpcRequest,
  type LocalControlUploadBinding,
  type LocalControlStreamRecord
} from '@shared/contracts/localControl'
import type { CliRouteCaller } from '@/routes/routeRegistry'
import type { CliRequestAdmission, CliRequestPolicyInput } from './policy'
import {
  parseBoundedJsonBody,
  parseBoundedJsonBytes,
  readBoundedRequestBody,
  readDeclaredBodyLength
} from './body'
import {
  cleanupLocalControlLayout,
  createLocalControlLayout,
  createLocalControlToken,
  prepareLocalControlLayout,
  protectUnixSocket,
  writeLocalControlDescriptor,
  type CliControlLayout
} from './descriptor'
import { CliRequestError } from './errors'
import { CLI_SURFACE_V2 } from './surface'
import type { CliSurfaceEntry } from './surface'
import type { CliRuntimeStatus } from './routes'
import type { ArtifactSpool } from './artifactSpool'
import type { AgentCliRequestBeginResult, AgentCliRequestGrant } from './agentTokenAuthority'

const MAX_HEADER_BYTES = 8 * 1024
const MAX_CONNECTIONS = 64
const MAX_PENDING_REQUESTS = 64
const MAX_PENDING_PER_CONNECTION = 8
const MAX_IN_MEMORY_BODY_BYTES = 256 * 1024
const REQUEST_TIMEOUT_GRACE_MS = 5_000
const SHUTDOWN_GRACE_MS = 2_000
const UNKNOWN_REQUEST_ID = 'unknown'
const emptyAdmission: CliRequestAdmission = Object.freeze({ release: () => undefined })

const AgentCliTokenSchema = z
  .object({
    tokenId: z
      .string()
      .min(16)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    conversationId: z.string().min(1).max(128),
    expiresAt: TimestampMsSchema.max(Number.MAX_SAFE_INTEGER),
    scopes: LocalControlScopesSchema
  })
  .strict()

export type CliStreamEmitter = (
  event: string,
  data: JsonValue,
  context?: Readonly<{ runId?: string; cursor?: string }>
) => Promise<void>

export type CliUploadedInputFile = Readonly<{
  path: string
  size: number
}>

export type CliServerDependencies = Readonly<{
  userDataPath: string
  appVersion: string
  dispatch(
    method: string,
    input: unknown,
    caller: CliRouteCaller,
    signal: AbortSignal
  ): Promise<unknown>
  dispatchStream?(
    method: string,
    input: unknown,
    caller: CliRouteCaller,
    requestId: string,
    signal: AbortSignal,
    emit: CliStreamEmitter
  ): Promise<unknown>
  dispatchUpload?(
    method: string,
    input: unknown,
    upload: CliUploadedInputFile,
    caller: CliRouteCaller,
    signal: AbortSignal
  ): Promise<unknown>
  authorize?(input: CliRequestPolicyInput): Promise<CliRequestAdmission>
  surface?: ReadonlyMap<string, CliSurfaceEntry>
  beginAgentRequest?(token: string): AgentCliRequestBeginResult
  artifactSpool?: ArtifactSpool
  now?: () => number
  platform?: NodeJS.Platform
  pid?: number
  log?: Pick<Console, 'warn' | 'error'>
}>

type AuthenticationResult =
  | Readonly<{
      ok: true
      caller: CliRouteCaller
      agentGrant?: AgentCliRequestGrant
    }>
  | Readonly<{ ok: false; quotaExhausted: boolean }>

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

function tokensEqual(left: string, right: string): boolean {
  return timingSafeEqual(hashToken(left), hashToken(right))
}

function readSingularRequestHeader(request: IncomingMessage, name: string): string | null {
  const distinctValues = request.headersDistinct[name]
  if (distinctValues && distinctValues.length !== 1) return null
  const value = distinctValues?.[0] ?? request.headers[name]
  return typeof value === 'string' ? value : null
}

function readBearerToken(request: IncomingMessage): string | null {
  const authorization = readSingularRequestHeader(request, 'authorization')
  if (!authorization) return null
  const match = /^Bearer (\S+)$/.exec(authorization)
  if (!match) return null
  const token = LocalControlTokenSchema.safeParse(match[1])
  return token.success ? token.data : null
}

function requestContentTypeIsJson(request: IncomingMessage): boolean {
  const contentType = readSingularRequestHeader(request, 'content-type')
  if (!contentType) return false
  const [mediaType, ...parameters] = contentType.split(';').map((part) => part.trim().toLowerCase())
  if (mediaType !== 'application/json') return false
  return parameters.every((parameter) => parameter === 'charset=utf-8')
}

function requestContentTypeIsBinary(request: IncomingMessage): boolean {
  const contentType = readSingularRequestHeader(request, 'content-type')
  if (!contentType) return false
  return contentType.trim().toLowerCase() === 'application/octet-stream'
}

function parseUploadRequestHeader(request: IncomingMessage): unknown {
  const distinctValues = request.headersDistinct[LOCAL_CONTROL_UPLOAD_REQUEST_HEADER]
  if (distinctValues && distinctValues.length !== 1) {
    throw new CliRequestError('invalid_request', 'Upload request header must be singular')
  }
  const rawValue = distinctValues?.[0] ?? request.headers[LOCAL_CONTROL_UPLOAD_REQUEST_HEADER]
  if (
    typeof rawValue !== 'string' ||
    rawValue.length === 0 ||
    Buffer.byteLength(rawValue, 'ascii') > LOCAL_CONTROL_MAX_UPLOAD_REQUEST_HEADER_BYTES ||
    !/^[A-Za-z0-9_-]+$/.test(rawValue)
  ) {
    throw new CliRequestError('invalid_request', 'Upload request header is invalid')
  }

  const decoded = Buffer.from(rawValue, 'base64url')
  if (decoded.toString('base64url') !== rawValue) {
    throw new CliRequestError('invalid_request', 'Upload request header is not canonical')
  }
  return parseBoundedJsonBytes(decoded)
}

function readRequestMethodHeader(request: IncomingMessage): string {
  const parsed = LocalControlMethodSchema.safeParse(
    readSingularRequestHeader(request, LOCAL_CONTROL_METHOD_HEADER)
  )
  if (!parsed.success) {
    throw new CliRequestError('invalid_request', 'Method header is missing or invalid')
  }
  return parsed.data
}

function requestExpectsContinue(request: IncomingMessage): boolean {
  return readSingularRequestHeader(request, 'expect')?.trim().toLowerCase() === '100-continue'
}

function toSafeRequestId(value: unknown): string {
  if (typeof value !== 'string') return UNKNOWN_REQUEST_ID
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : UNKNOWN_REQUEST_ID
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function artifactContentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_')
  const wellFormedFilename = Buffer.from(filename, 'utf8').toString('utf8')
  const encoded = encodeURIComponent(wellFormedFilename).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

function requestAbortError(signal: AbortSignal): CliRequestError {
  return signal.reason instanceof CliRequestError
    ? signal.reason
    : new CliRequestError('cancelled', 'Request was cancelled', { retriable: true })
}

function abortRequest(controller: AbortController, error: CliRequestError): void {
  if (!controller.signal.aborted) controller.abort(error)
}

async function runAbortable<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw requestAbortError(signal)

  return await new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => finish(() => reject(requestAbortError(signal)))
    signal.addEventListener('abort', onAbort, { once: true })

    void Promise.resolve()
      .then(() => {
        if (signal.aborted) throw requestAbortError(signal)
        return action()
      })
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error))
      )
  })
}

export class CliServer {
  private readonly now: () => number
  private readonly platform: NodeJS.Platform
  private readonly pid: number
  private readonly log: Pick<Console, 'warn' | 'error'>
  private readonly surface: ReadonlyMap<string, CliSurfaceEntry>
  private readonly sockets = new Set<Socket>()
  private readonly connectionIds = new WeakMap<Socket, string>()
  private readonly pendingByConnection = new Map<string, number>()
  private readonly requestControllers = new Set<AbortController>()
  private server: Server | undefined
  private layout: CliControlLayout | undefined
  private token = ''
  private startedAt = 0
  private descriptorReady = false
  private pendingRequests = 0
  private startPromise: Promise<LocalControlDescriptor> | undefined
  private stopPromise: Promise<void> | undefined

  constructor(private readonly dependencies: CliServerDependencies) {
    this.now = dependencies.now ?? Date.now
    this.platform = dependencies.platform ?? process.platform
    this.pid = dependencies.pid ?? process.pid
    this.log = dependencies.log ?? console
    this.surface = new Map(dependencies.surface ?? CLI_SURFACE_V2)
  }

  getStatus(): CliRuntimeStatus {
    const running = this.server?.listening === true
    return {
      running,
      pid: this.pid,
      startedAt: this.startedAt,
      uptimeMs: running ? Math.max(0, this.now() - this.startedAt) : 0,
      endpointKind: this.platform === 'win32' ? 'pipe' : 'unix',
      activeConnections: this.sockets.size,
      pendingRequests: this.pendingRequests,
      descriptorReady: this.descriptorReady
    }
  }

  getDescriptorPath(): string {
    return path.join(
      this.dependencies.userDataPath,
      'local-control',
      LOCAL_CONTROL_DESCRIPTOR_FILENAME
    )
  }

  async start(): Promise<LocalControlDescriptor> {
    if (this.stopPromise) await this.stopPromise
    if (this.startPromise) return await this.startPromise

    this.startPromise = this.startInternal()
    try {
      return await this.startPromise
    } catch (error) {
      this.startPromise = undefined
      throw error
    }
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return await this.stopPromise
    this.stopPromise = (async () => {
      if (this.startPromise) await this.startPromise.catch(() => undefined)
      await this.stopInternal()
    })()
    try {
      await this.stopPromise
    } finally {
      this.stopPromise = undefined
      this.startPromise = undefined
    }
  }

  private async startInternal(): Promise<LocalControlDescriptor> {
    const layout = createLocalControlLayout(this.dependencies.userDataPath, this.platform)
    const token = createLocalControlToken()
    const startedAt = this.now()
    await prepareLocalControlLayout(layout, this.platform)

    const serveRequest = (request: IncomingMessage, response: ServerResponse) => {
      void this.handleRequest(request, response).catch((error) => {
        this.log.error('[CLI] Unhandled request failure', error)
        if (!response.headersSent && !response.destroyed) {
          this.sendFailure(
            response,
            500,
            UNKNOWN_REQUEST_ID,
            new CliRequestError('internal_error', 'Internal local-control error', {
              httpStatus: 500
            })
          )
        } else if (!response.destroyed) {
          response.destroy()
        }
      })
    }
    const server = createServer({ maxHeaderSize: MAX_HEADER_BYTES }, serveRequest)
    server.on('checkContinue', serveRequest)
    server.maxConnections = MAX_CONNECTIONS
    server.headersTimeout = 10_000
    server.requestTimeout = LOCAL_CONTROL_MAX_REQUEST_TIMEOUT_MS + REQUEST_TIMEOUT_GRACE_MS
    server.keepAliveTimeout = 5_000
    server.on('connection', (socket) => {
      this.sockets.add(socket)
      this.connectionIds.set(socket, randomUUID())
      socket.once('close', () => {
        const connectionId = this.connectionIds.get(socket)
        this.sockets.delete(socket)
        if (connectionId) this.pendingByConnection.delete(connectionId)
      })
    })
    server.on('clientError', (_error, socket) => {
      if (!socket.destroyed) {
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      }
    })
    server.on('error', (error) => {
      this.log.error('[CLI] Server error', error)
    })

    this.layout = layout
    this.token = token
    this.startedAt = startedAt
    this.server = server

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error)
        server.once('error', onError)
        server.listen(
          layout.endpoint.kind === 'unix' ? layout.endpoint.path : layout.endpoint.name,
          () => {
            server.off('error', onError)
            resolve()
          }
        )
      })
      if (layout.endpoint.kind === 'unix') await protectUnixSocket(layout.endpoint.path)
      const descriptor = await writeLocalControlDescriptor(
        layout,
        {
          appVersion: this.dependencies.appVersion,
          endpoint: layout.endpoint,
          pid: this.pid,
          token,
          startedAt
        },
        this.platform
      )
      this.descriptorReady = true
      return descriptor
    } catch (error) {
      await this.closeServer(server)
      await cleanupLocalControlLayout(layout, token).catch(() => undefined)
      this.resetRuntimeState()
      throw error
    }
  }

  private async stopInternal(): Promise<void> {
    for (const controller of this.requestControllers) {
      abortRequest(
        controller,
        new CliRequestError('unavailable', 'CLI server is stopping', {
          httpStatus: 503,
          retriable: true
        })
      )
    }
    const server = this.server
    const layout = this.layout
    const token = this.token
    this.descriptorReady = false

    if (server) await this.closeServer(server)
    if (layout && token) await cleanupLocalControlLayout(layout, token)
    this.resetRuntimeState()
  }

  private resetRuntimeState(): void {
    this.server = undefined
    this.layout = undefined
    this.token = ''
    this.startedAt = 0
    this.descriptorReady = false
    this.pendingRequests = 0
    this.pendingByConnection.clear()
    this.requestControllers.clear()
    this.sockets.clear()
  }

  private async closeServer(server: Server): Promise<void> {
    if (!server.listening) return
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(forceTimer)
        clearTimeout(fallbackTimer)
        resolve()
      }
      const forceTimer = setTimeout(() => {
        for (const socket of this.sockets) socket.destroy()
        server.closeAllConnections()
      }, SHUTDOWN_GRACE_MS)
      forceTimer.unref()
      const fallbackTimer = setTimeout(finish, SHUTDOWN_GRACE_MS + 1_000)
      fallbackTimer.unref()
      server.close(finish)
      server.closeIdleConnections()
    })
  }

  private authenticate(request: IncomingMessage, connectionId: string): AuthenticationResult {
    const token = readBearerToken(request)
    if (!token) return { ok: false, quotaExhausted: false }
    if (this.token && tokensEqual(token, this.token)) {
      return {
        ok: true,
        caller: {
          kind: 'cli',
          principal: 'human',
          connectionId,
          scopes: LOCAL_CONTROL_SCOPES
        }
      }
    }

    const beginResult = this.dependencies.beginAgentRequest?.(token)
    if (beginResult && beginResult.status !== 'granted') {
      return { ok: false, quotaExhausted: beginResult.status === 'quota-exhausted' }
    }
    const grant = beginResult?.status === 'granted' ? beginResult.grant : undefined
    const agent = AgentCliTokenSchema.safeParse(grant?.claims)
    if (!agent.success || agent.data.expiresAt <= this.now()) {
      grant?.release()
      return { ok: false, quotaExhausted: false }
    }
    return {
      ok: true,
      caller: {
        kind: 'cli',
        principal: 'agent',
        connectionId,
        scopes: agent.data.scopes,
        tokenId: agent.data.tokenId,
        conversationId: agent.data.conversationId,
        expiresAt: agent.data.expiresAt
      },
      ...(grant ? { agentGrant: grant } : {})
    }
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')

    const connectionId = this.connectionIds.get(request.socket) ?? randomUUID()
    const isRpcRequest = request.method === 'POST' && request.url === LOCAL_CONTROL_RPC_PATH
    const isStreamRequest = request.method === 'POST' && request.url === LOCAL_CONTROL_STREAM_PATH
    const isUploadRequest = request.method === 'POST' && request.url === LOCAL_CONTROL_UPLOAD_PATH
    const isArtifactRequest =
      request.method === 'GET' && request.url?.startsWith(LOCAL_CONTROL_ARTIFACT_PATH_PREFIX)
    if (!isRpcRequest && !isStreamRequest && !isUploadRequest && !isArtifactRequest) {
      this.sendFailure(
        response,
        404,
        UNKNOWN_REQUEST_ID,
        new CliRequestError('not_found', 'Local-control endpoint was not found', {
          httpStatus: 404
        })
      )
      return
    }
    const expectsContinue = requestExpectsContinue(request)
    if (request.headers.expect !== undefined && (!isUploadRequest || !expectsContinue)) {
      this.sendFailure(
        response,
        417,
        UNKNOWN_REQUEST_ID,
        new CliRequestError('invalid_request', 'Expect is not supported', {
          httpStatus: 417
        })
      )
      return
    }

    const authentication = this.authenticate(request, connectionId)
    if (!authentication.ok) {
      this.sendFailure(
        response,
        authentication.quotaExhausted ? 429 : 401,
        UNKNOWN_REQUEST_ID,
        authentication.quotaExhausted
          ? new CliRequestError('rate_limited', 'Agent CLI token quota is exhausted', {
              httpStatus: 429
            })
          : new CliRequestError('authentication_failed', 'Authentication failed', {
              httpStatus: 401
            })
      )
      return
    }
    const { caller, agentGrant } = authentication
    if (agentGrant) {
      let released = false
      const releaseAgentGrant = () => {
        if (released) return
        released = true
        agentGrant.release()
      }
      response.once('finish', releaseAgentGrant)
      response.once('close', releaseAgentGrant)
    }
    if (isArtifactRequest) {
      await this.handleArtifactDownload(request, response, caller)
      return
    }
    const requestTransport = isUploadRequest ? 'upload' : isStreamRequest ? 'stream' : 'rpc'
    if (
      (requestTransport === 'upload' && !requestContentTypeIsBinary(request)) ||
      (requestTransport !== 'upload' && !requestContentTypeIsJson(request))
    ) {
      this.sendFailure(
        response,
        415,
        UNKNOWN_REQUEST_ID,
        new CliRequestError(
          'invalid_request',
          requestTransport === 'upload'
            ? 'Content-Type must be application/octet-stream'
            : 'Content-Type must be application/json',
          { httpStatus: 415 }
        )
      )
      return
    }

    const connectionPending = this.pendingByConnection.get(connectionId) ?? 0
    if (
      this.pendingRequests >= MAX_PENDING_REQUESTS ||
      connectionPending >= MAX_PENDING_PER_CONNECTION
    ) {
      this.sendFailure(
        response,
        429,
        UNKNOWN_REQUEST_ID,
        new CliRequestError('rate_limited', 'Too many pending local-control requests', {
          httpStatus: 429,
          retriable: true
        })
      )
      return
    }

    this.pendingRequests += 1
    this.pendingByConnection.set(connectionId, connectionPending + 1)
    const controller = new AbortController()
    this.requestControllers.add(controller)
    const abort = () => {
      abortRequest(controller, new CliRequestError('cancelled', 'Request was cancelled'))
    }
    const abortRevokedAgentRequest = () => {
      abortRequest(
        controller,
        new CliRequestError('authentication_failed', 'Agent CLI token is no longer valid', {
          httpStatus: 401
        })
      )
    }
    request.once('aborted', abort)
    agentGrant?.signal.addEventListener('abort', abortRevokedAgentRequest, { once: true })
    if (agentGrant?.signal.aborted) abortRevokedAgentRequest()
    response.once('close', () => {
      if (!response.writableEnded) abort()
    })

    let requestId = UNKNOWN_REQUEST_ID
    let routeMethod = 'unknown'
    try {
      let rawRequest: unknown
      let transportBinding: LocalControlUploadBinding | undefined
      let declaredMethod: string | undefined
      let entry: CliSurfaceEntry | undefined
      if (requestTransport === 'upload') {
        rawRequest = parseUploadRequestHeader(request)
      } else {
        declaredMethod = readRequestMethodHeader(request)
        routeMethod = declaredMethod
        entry = this.surface.get(declaredMethod)
        if (!entry || entry.transport !== requestTransport) {
          throw new CliRequestError('not_found', 'Method is not exposed by the CLI surface', {
            httpStatus: 404
          })
        }
        const body = await readBoundedRequestBody(request, {
          maxBytes: entry.limits.maxBodyBytes,
          memoryThresholdBytes: Math.min(entry.limits.maxBodyBytes, MAX_IN_MEMORY_BODY_BYTES),
          tempDirectory: this.layout?.tempDirectory ?? this.dependencies.userDataPath,
          requireContentLength: true,
          ...(agentGrant
            ? { consumeBytes: (bytes: number) => this.consumeAgentBytes(agentGrant, bytes) }
            : {})
        })
        rawRequest = await parseBoundedJsonBody(body)
      }
      if (isRecord(rawRequest)) requestId = toSafeRequestId(rawRequest.id)
      if (
        isRecord(rawRequest) &&
        (rawRequest.protocolVersion !== LOCAL_CONTROL_PROTOCOL_VERSION ||
          rawRequest.surfaceVersion !== LOCAL_CONTROL_SURFACE_VERSION)
      ) {
        throw new CliRequestError(
          'unsupported_version',
          `Expected protocol ${LOCAL_CONTROL_PROTOCOL_VERSION} and surface ${LOCAL_CONTROL_SURFACE_VERSION}`,
          { httpStatus: 409 }
        )
      }

      let rpcRequest: LocalControlRpcRequest
      if (requestTransport === 'upload') {
        const parsedRequest = LocalControlUploadRequestSchema.safeParse(rawRequest)
        if (!parsedRequest.success) {
          throw new CliRequestError('invalid_request', 'Request does not match the upload contract')
        }
        rpcRequest = parsedRequest.data
        transportBinding = parsedRequest.data.upload
      } else {
        const parsedRequest = LocalControlRpcRequestSchema.safeParse(rawRequest)
        if (!parsedRequest.success) {
          throw new CliRequestError('invalid_request', 'Request does not match the RPC contract')
        }
        rpcRequest = parsedRequest.data
      }
      requestId = rpcRequest.id
      routeMethod = rpcRequest.method
      if (declaredMethod && rpcRequest.method !== declaredMethod) {
        throw new CliRequestError(
          'invalid_request',
          'Method header does not match the request body'
        )
      }
      entry ??= this.surface.get(rpcRequest.method)
      if (!entry || entry.transport !== requestTransport) {
        throw new CliRequestError('not_found', 'Method is not exposed by the CLI surface', {
          httpStatus: 404
        })
      }
      if (transportBinding && transportBinding.size > entry.limits.maxBodyBytes) {
        throw new CliRequestError('body_too_large', 'Upload body exceeds method limit', {
          httpStatus: 413
        })
      }
      if (transportBinding) {
        const declaredLength = readDeclaredBodyLength(request)
        if (declaredLength !== null && declaredLength !== transportBinding.size) {
          throw new CliRequestError(
            'invalid_request',
            'Content-Length does not match the upload binding'
          )
        }
      }
      const parsedInput = entry.contract.input.safeParse(rpcRequest.params)
      if (!parsedInput.success) {
        throw new CliRequestError('invalid_request', 'Request does not match the route contract')
      }
      const input = parsedInput.data
      const timeout = setTimeout(() => {
        abortRequest(
          controller,
          new CliRequestError('timeout', 'Request timed out', {
            httpStatus: 504,
            retriable: true
          })
        )
      }, entry.limits.timeoutMs)
      timeout.unref()
      let admission: CliRequestAdmission | undefined
      let rawOutput: unknown
      try {
        admission = await this.authorizeRequest({
          entry,
          input,
          caller,
          requestId,
          signal: controller.signal,
          ...(transportBinding ? { transportBinding } : {})
        })
        this.assertSurfaceAccess(entry, caller)
        if (controller.signal.aborted) throw requestAbortError(controller.signal)
        if (requestTransport === 'stream') {
          await this.dispatchStreamResponse(
            response,
            entry,
            input,
            caller,
            requestId,
            controller.signal,
            agentGrant
          )
          return
        }
        if (requestTransport === 'upload') {
          const dispatchUpload = this.dependencies.dispatchUpload
          if (!dispatchUpload) {
            throw new CliRequestError('unavailable', 'Upload service is unavailable', {
              httpStatus: 503,
              retriable: true
            })
          }
          if (expectsContinue) response.writeContinue()
          const uploadBody = await readBoundedRequestBody(request, {
            maxBytes: entry.limits.maxBodyBytes,
            memoryThresholdBytes: 0,
            tempDirectory: this.layout?.tempDirectory ?? this.dependencies.userDataPath,
            requireContentLength: false,
            ...(agentGrant
              ? { consumeBytes: (bytes: number) => this.consumeAgentBytes(agentGrant, bytes) }
              : {})
          })
          try {
            if (
              !transportBinding ||
              uploadBody.size !== transportBinding.size ||
              uploadBody.sha256 !== transportBinding.sha256
            ) {
              throw new CliRequestError('invalid_request', 'Upload body does not match its binding')
            }
            if (uploadBody.kind !== 'file') {
              throw new CliRequestError('internal_error', 'Upload body was not persisted', {
                httpStatus: 500
              })
            }
            rawOutput = await runAbortable(controller.signal, async () =>
              dispatchUpload(
                entry.contract.name,
                input,
                { path: uploadBody.path, size: uploadBody.size },
                caller,
                controller.signal
              )
            )
          } finally {
            await uploadBody.cleanup()
          }
        } else {
          rawOutput = await runAbortable(controller.signal, async () =>
            this.dependencies.dispatch(entry.contract.name, input, caller, controller.signal)
          )
        }
      } finally {
        admission?.release()
        clearTimeout(timeout)
      }
      if (controller.signal.aborted) {
        throw requestAbortError(controller.signal)
      }
      const result = this.parseRouteOutput(entry, rawOutput, routeMethod)
      this.sendJson(response, 200, createLocalControlSuccess(requestId, result), agentGrant)
    } catch (error) {
      if (error instanceof CliRequestError) {
        this.sendFailure(response, error.httpStatus, requestId, error)
      } else {
        this.log.warn('[CLI] Route dispatch failed', { method: routeMethod }, error)
        this.sendFailure(
          response,
          500,
          requestId,
          new CliRequestError('internal_error', 'Internal local-control error', {
            httpStatus: 500
          })
        )
      }
    } finally {
      request.off('aborted', abort)
      agentGrant?.signal.removeEventListener('abort', abortRevokedAgentRequest)
      this.requestControllers.delete(controller)
      this.pendingRequests = Math.max(0, this.pendingRequests - 1)
      const remaining = (this.pendingByConnection.get(connectionId) ?? 1) - 1
      if (remaining > 0) this.pendingByConnection.set(connectionId, remaining)
      else this.pendingByConnection.delete(connectionId)
    }
  }

  private assertSurfaceAccess(entry: CliSurfaceEntry, caller: CliRouteCaller): void {
    if (!entry.callers.includes(caller.principal)) {
      throw new CliRequestError('permission_denied', 'Caller is not allowed for method', {
        httpStatus: 403
      })
    }
    if (!entry.scopes.every((scope) => caller.scopes.includes(scope))) {
      throw new CliRequestError('permission_denied', 'Required scope is missing', {
        httpStatus: 403
      })
    }
  }

  private async authorizeRequest(input: CliRequestPolicyInput): Promise<CliRequestAdmission> {
    return this.dependencies.authorize ? await this.dependencies.authorize(input) : emptyAdmission
  }

  private parseRouteOutput(
    entry: CliSurfaceEntry,
    rawOutput: unknown,
    routeMethod: string
  ): JsonValue {
    const fail = (stage: 'route' | 'json', error: z.ZodError): never => {
      this.log.error('[CLI] Route returned invalid output', {
        method: routeMethod,
        stage,
        issueCount: error.issues.length,
        issueCodes: Array.from(new Set(error.issues.slice(0, 16).map((issue) => issue.code)))
      })
      throw new CliRequestError('internal_error', 'Route returned an invalid result', {
        httpStatus: 500
      })
    }

    const parsedOutput = entry.contract.output.safeParse(rawOutput)
    if (!parsedOutput.success) return fail('route', parsedOutput.error)

    const parsedResult = JsonValueSchema.safeParse(parsedOutput.data)
    if (!parsedResult.success) return fail('json', parsedResult.error)

    return parsedResult.data
  }

  private async dispatchStreamResponse(
    response: ServerResponse,
    entry: CliSurfaceEntry,
    input: unknown,
    caller: CliRouteCaller,
    requestId: string,
    signal: AbortSignal,
    agentGrant?: AgentCliRequestGrant
  ): Promise<void> {
    const dispatchStream = this.dependencies.dispatchStream
    if (!dispatchStream) {
      throw new CliRequestError('unavailable', 'Streaming service is unavailable', {
        httpStatus: 503,
        retriable: true
      })
    }

    response.statusCode = 200
    response.shouldKeepAlive = false
    response.setHeader('Connection', 'close')
    response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    response.flushHeaders()
    let sequence = 0
    const emit: CliStreamEmitter = async (event, data, context) => {
      if (signal.aborted) throw requestAbortError(signal)
      const parsed = LocalControlEventEnvelopeSchema.safeParse({
        protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
        surfaceVersion: LOCAL_CONTROL_SURFACE_VERSION,
        sequence,
        timestamp: this.now(),
        requestId,
        ...(context?.runId ? { runId: context.runId } : {}),
        ...(context?.cursor ? { cursor: context.cursor } : {}),
        event,
        data
      })
      if (!parsed.success) {
        throw new CliRequestError('internal_error', 'Stream emitted an invalid event', {
          httpStatus: 500
        })
      }
      sequence += 1
      await this.writeStreamRecord(response, parsed.data, signal, agentGrant)
    }

    try {
      const rawOutput = await runAbortable(signal, async () =>
        dispatchStream(entry.contract.name, input, caller, requestId, signal, emit)
      )
      if (signal.aborted) throw requestAbortError(signal)
      const result = this.parseRouteOutput(entry, rawOutput, entry.contract.name)
      await this.writeStreamRecord(
        response,
        createLocalControlSuccess(requestId, result),
        signal,
        agentGrant
      )
    } catch (error) {
      const failure = signal.aborted
        ? requestAbortError(signal)
        : error instanceof CliRequestError
          ? error
          : new CliRequestError('internal_error', 'Streaming operation failed', {
              httpStatus: 500
            })
      if (!(error instanceof CliRequestError) && !signal.aborted) {
        this.log.warn('[CLI] Stream dispatch failed', { method: entry.contract.name }, error)
      }
      if (!response.destroyed && !response.writableEnded) {
        await this.writeStreamRecord(response, this.createFailureRecord(requestId, failure)).catch(
          () => {
            if (!response.destroyed) response.destroy()
          }
        )
      }
    } finally {
      if (!response.destroyed && !response.writableEnded) response.end()
    }
  }

  private async writeStreamRecord(
    response: ServerResponse,
    record: LocalControlStreamRecord,
    signal?: AbortSignal,
    agentGrant?: AgentCliRequestGrant
  ): Promise<void> {
    if (signal?.aborted) throw requestAbortError(signal)
    const serialized = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8')
    if (serialized.length > LOCAL_CONTROL_MAX_STREAM_RECORD_BYTES) {
      throw new CliRequestError('internal_error', 'Stream record exceeds its byte limit', {
        httpStatus: 500
      })
    }
    if (agentGrant) this.consumeAgentBytes(agentGrant, serialized.length)
    if (response.destroyed || response.writableEnded) {
      throw new CliRequestError('cancelled', 'Stream connection is closed')
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        response.off('error', onError)
        response.off('close', onClose)
        if (error) reject(error)
        else resolve()
      }
      const onAbort = () => finish(requestAbortError(signal!))
      const onError = (error: Error) => finish(error)
      const onClose = () => finish(new CliRequestError('cancelled', 'Stream connection is closed'))
      signal?.addEventListener('abort', onAbort, { once: true })
      response.once('error', onError)
      response.once('close', onClose)
      response.write(serialized, (error) => finish(error ?? undefined))
    })
  }

  private createFailureRecord(requestId: string, error: CliRequestError) {
    return createLocalControlFailure(requestId, {
      code: error.code,
      message: (error.message || 'Local-control request failed').slice(0, 4096),
      retriable: error.retriable,
      ...(error.options.details ? { details: error.options.details } : {})
    })
  }

  private async handleArtifactDownload(
    request: IncomingMessage,
    response: ServerResponse,
    caller: CliRouteCaller
  ): Promise<void> {
    const rawId = request.url?.slice(LOCAL_CONTROL_ARTIFACT_PATH_PREFIX.length) ?? ''
    const parsedId = ArtifactIdSchema.safeParse(rawId)
    const entry = this.surface.get(artifactsReadRoute.name)
    if (!parsedId.success || !entry || entry.transport !== 'download') {
      this.sendFailure(
        response,
        404,
        UNKNOWN_REQUEST_ID,
        new CliRequestError('not_found', 'Artifact endpoint was not found', { httpStatus: 404 })
      )
      return
    }
    const contentLength = request.headers['content-length']
    if (
      request.headers['transfer-encoding'] !== undefined ||
      (contentLength !== undefined && contentLength !== '0')
    ) {
      this.sendFailure(
        response,
        400,
        UNKNOWN_REQUEST_ID,
        new CliRequestError('invalid_request', 'Artifact downloads do not accept a request body')
      )
      return
    }

    const connectionPending = this.pendingByConnection.get(caller.connectionId) ?? 0
    if (
      this.pendingRequests >= MAX_PENDING_REQUESTS ||
      connectionPending >= MAX_PENDING_PER_CONNECTION
    ) {
      this.sendFailure(
        response,
        429,
        UNKNOWN_REQUEST_ID,
        new CliRequestError('rate_limited', 'Too many pending local-control requests', {
          httpStatus: 429,
          retriable: true
        })
      )
      return
    }

    this.pendingRequests += 1
    this.pendingByConnection.set(caller.connectionId, connectionPending + 1)
    const controller = new AbortController()
    this.requestControllers.add(controller)
    const abort = () => {
      abortRequest(controller, new CliRequestError('cancelled', 'Request was cancelled'))
    }
    const abortOnIncompleteResponse = () => {
      if (!response.writableEnded) abort()
    }
    request.once('aborted', abort)
    response.once('close', abortOnIncompleteResponse)
    const timeout = setTimeout(() => {
      abortRequest(
        controller,
        new CliRequestError('timeout', 'Request timed out', {
          httpStatus: 504,
          retriable: true
        })
      )
    }, entry.limits.timeoutMs)
    timeout.unref()
    let admission: CliRequestAdmission | undefined

    try {
      admission = await this.authorizeRequest({
        entry,
        input: { id: parsedId.data },
        caller,
        requestId: randomUUID(),
        signal: controller.signal
      })
      this.assertSurfaceAccess(entry, caller)
      if (controller.signal.aborted) throw requestAbortError(controller.signal)
      if (!this.dependencies.artifactSpool) {
        throw new CliRequestError('unavailable', 'Artifact service is unavailable', {
          httpStatus: 503,
          retriable: true
        })
      }
      const artifact = await this.dependencies.artifactSpool.openRead(parsedId.data, caller)
      if (controller.signal.aborted) {
        artifact.stream.destroy()
        throw requestAbortError(controller.signal)
      }
      response.statusCode = 200
      response.setHeader('Content-Type', artifact.metadata.mimeType)
      response.setHeader('Content-Length', artifact.metadata.size)
      response.setHeader(
        'Content-Disposition',
        artifactContentDisposition(artifact.metadata.filename)
      )
      response.setHeader('X-DeepChat-Artifact-Id', artifact.metadata.id)
      response.setHeader('X-Content-SHA256', artifact.metadata.sha256)
      await pipeline(artifact.stream, response, { signal: controller.signal })
    } catch (error) {
      const failure = controller.signal.aborted ? requestAbortError(controller.signal) : error
      if (failure instanceof CliRequestError && !response.headersSent) {
        this.sendFailure(response, failure.httpStatus, UNKNOWN_REQUEST_ID, failure)
        return
      }
      if (!response.headersSent) {
        this.log.warn('[CLI] Artifact download failed', failure)
        this.sendFailure(
          response,
          500,
          UNKNOWN_REQUEST_ID,
          new CliRequestError('internal_error', 'Artifact download failed', { httpStatus: 500 })
        )
        return
      }
      if (!response.destroyed) response.destroy()
    } finally {
      admission?.release()
      clearTimeout(timeout)
      request.off('aborted', abort)
      response.off('close', abortOnIncompleteResponse)
      this.requestControllers.delete(controller)
      this.pendingRequests = Math.max(0, this.pendingRequests - 1)
      const remaining = (this.pendingByConnection.get(caller.connectionId) ?? 1) - 1
      if (remaining > 0) this.pendingByConnection.set(caller.connectionId, remaining)
      else this.pendingByConnection.delete(caller.connectionId)
    }
  }

  private sendFailure(
    response: ServerResponse,
    status: number,
    requestId: string,
    error: CliRequestError
  ): void {
    this.sendJson(response, status, this.createFailureRecord(requestId, error))
  }

  private sendJson(
    response: ServerResponse,
    status: number,
    body: JsonValue,
    agentGrant?: AgentCliRequestGrant
  ): void {
    if (response.destroyed || response.writableEnded) return
    let responseStatus = status
    let serialized = Buffer.from(JSON.stringify(body), 'utf8')
    if (serialized.length > LOCAL_CONTROL_MAX_JSON_RESPONSE_BYTES) {
      responseStatus = 500
      serialized = Buffer.from(
        JSON.stringify(
          createLocalControlFailure(
            isRecord(body) ? toSafeRequestId(body.id) : UNKNOWN_REQUEST_ID,
            {
              code: 'result_too_large',
              message: 'Local-control response exceeds its byte limit',
              retriable: false
            }
          )
        ),
        'utf8'
      )
    }
    if (responseStatus < 400 && agentGrant && !agentGrant.consumeBytes(serialized.length)) {
      responseStatus = 429
      serialized = Buffer.from(
        JSON.stringify(
          createLocalControlFailure(
            isRecord(body) ? toSafeRequestId(body.id) : UNKNOWN_REQUEST_ID,
            {
              code: 'rate_limited',
              message: 'Agent CLI token byte quota is exhausted',
              retriable: false
            }
          )
        ),
        'utf8'
      )
    }
    response.statusCode = responseStatus
    if (responseStatus >= 400) {
      response.shouldKeepAlive = false
      response.setHeader('Connection', 'close')
    }
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Content-Length', serialized.length)
    response.end(serialized)
  }

  private consumeAgentBytes(grant: AgentCliRequestGrant, bytes: number): void {
    if (grant.consumeBytes(bytes)) return
    throw new CliRequestError('rate_limited', 'Agent CLI token byte quota is exhausted', {
      httpStatus: 429
    })
  }
}
