import http from 'node:http'
import { SYNC_REPLICA_PREFIX } from '@shared/contracts/syncReplica'
import type { SyncReplicaEndpoint } from '../replica/endpoint'
import type net from 'node:net'
import fs from 'node:fs'
import {
  SYNC_HOST_AUDIT_LIMIT,
  SYNC_HOST_DEVICE_HEADER,
  SYNC_HOST_EVENTS_PATH,
  SYNC_HOST_HANDSHAKE_PATH,
  SYNC_HOST_MAX_CONNECTIONS,
  SYNC_HOST_MAX_HEADER_BYTES,
  SYNC_HOST_PAIR_BODY_MAX_BYTES,
  SYNC_HOST_PAIR_FAILURE_MAX_KEYS,
  SYNC_HOST_PAIR_FAILURE_WINDOW_MS,
  SYNC_HOST_PAIR_MAX_FAILURES_PER_WINDOW,
  SYNC_HOST_PAIR_PATH,
  SYNC_HOST_PROTOCOL_NAME,
  SYNC_HOST_PROTOCOL_VERSION,
  SYNC_HOST_PUSH_PATH,
  SYNC_HOST_PREPARE_PATH,
  SYNC_HOST_RATE_LIMIT_MAX_KEYS,
  SYNC_HOST_RATE_LIMIT_REQUESTS_PER_WINDOW,
  SYNC_HOST_RATE_LIMIT_WINDOW_MS,
  SYNC_HOST_REQUEST_RECEIVE_TIMEOUT_MS,
  SYNC_HOST_SNAPSHOT_HASH_HEADER,
  SYNC_HOST_SNAPSHOT_ID_HEADER,
  SYNC_HOST_SNAPSHOT_PATH,
  SYNC_HOST_STATUS_PATH,
  SyncHostHandshakeSchema,
  SyncHostPairRequestSchema,
  SyncHostPairResponseSchema,
  SyncHostStatusSchema,
  type SyncHostAuditEntry,
  type SyncHostCapability
} from '@shared/contracts/syncHost'
import type { IssuedSyncHostDevice, SyncHostDeviceStore } from './devices'
import type { SyncHostPairingAuthority } from './pairing'
import type { SyncHostSnapshotSource } from './snapshot'

/** Capabilities this build actually serves; the handshake must not advertise more. */
const HOST_CAPABILITIES: SyncHostCapability[] = ['snapshot', 'range']
const HANDLED_PATHS = new Set([
  SYNC_HOST_HANDSHAKE_PATH,
  SYNC_HOST_PAIR_PATH,
  SYNC_HOST_STATUS_PATH,
  SYNC_HOST_SNAPSHOT_PATH,
  SYNC_HOST_PUSH_PATH,
  SYNC_HOST_PREPARE_PATH,
  SYNC_HOST_EVENTS_PATH
])

export interface SyncHostEndpointLogger {
  warn(message: string, meta?: unknown): void
}

export interface SyncHostEndpointDeps {
  changed?: () => void
  replica?: SyncReplicaEndpoint
  allowWrites?: () => boolean
  prepare?: () => void
  preparation?: () => { preparing: boolean; preparationError: string | null }
  devices: SyncHostDeviceStore
  pairing: SyncHostPairingAuthority
  snapshotSource: SyncHostSnapshotSource
  getHostId: () => string
  getAppVersion: () => string
  logger?: SyncHostEndpointLogger
  /** Overridable for tests; production uses the shared contract default. */
  requestReceiveTimeoutMs?: number
}

interface RangeSelection {
  start: number
  end: number
}

/**
 * Loopback-only HTTP endpoint served through the user's Cloudflare Tunnel.
 *
 * Binding is hard-coded to `127.0.0.1`: the tunnel connector dials this listener from the same
 * machine, so no other interface must ever be reachable. Only `handshake` is unauthenticated.
 */
export class SyncHostEndpoint {
  private server: http.Server | null = null
  private boundPort = 0
  private readonly sockets = new Map<net.Socket, { streaming: boolean }>()
  private readonly auditEntries: SyncHostAuditEntry[] = []
  private readonly anonymousAudit = new Map<string, SyncHostAuditEntry>()
  private readonly rateWindows = new Map<string, { windowStart: number; count: number }>()
  private readonly requestGuards = new Map<net.Socket, NodeJS.Timeout>()
  private readonly pairFailures = new Map<string, { windowStart: number; count: number }>()

  private readonly requestReceiveTimeoutMs: number

  constructor(private readonly deps: SyncHostEndpointDeps) {
    this.requestReceiveTimeoutMs =
      deps.requestReceiveTimeoutMs ?? SYNC_HOST_REQUEST_RECEIVE_TIMEOUT_MS
  }

  isRunning(): boolean {
    return this.server !== null
  }

  getPort(): number {
    return this.boundPort
  }

  getAuditEntries(): SyncHostAuditEntry[] {
    return [...this.auditEntries]
  }

  async start(input: { port?: number } = {}): Promise<{ port: number }> {
    if (this.server) return { port: this.boundPort }
    const server = http.createServer(
      { maxHeaderSize: SYNC_HOST_MAX_HEADER_BYTES, requestTimeout: this.requestReceiveTimeoutMs },
      (request, response) => {
        void this.handle(request, response)
      }
    )
    server.headersTimeout = 15_000

    server.on('connection', (socket) => {
      if (this.sockets.size >= SYNC_HOST_MAX_CONNECTIONS) {
        // Refusing the newcomer would let anyone who learns the hostname hold every slot with
        // stalled connections and deny the legitimate device — including the user's own pairing.
        // Drop the oldest connection that is not streaming a response instead: an in-flight
        // download is never sacrificed, and the newcomer always gets in.
        const victim = this.oldestNonStreamingSocket()
        if (!victim) {
          socket.destroy()
          return
        }
        this.sockets.delete(victim)
        victim.destroy()
      }
      this.sockets.set(socket, { streaming: false })
      socket.on('close', () => this.sockets.delete(socket))
    })

    const port = input.port ?? 0
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve()
      })
    })

    // A post-listen server error (accept failure: EMFILE/ENFILE/ECONNABORTED) would otherwise be an
    // unhandled EventEmitter error and take down the main process.
    server.on('error', (error) => {
      this.deps.logger?.warn('[SyncHost] Endpoint server error', {
        error: error instanceof Error ? error.message : String(error)
      })
      if (!server.listening) void this.stop()
    })

    const address = server.address()
    if (!address || typeof address === 'string') {
      await this.closeServer(server)
      throw new Error('Sync host endpoint did not bind to a TCP port')
    }
    this.server = server
    this.boundPort = address.port
    this.deps.logger?.warn('[SyncHost] Endpoint listening', { port: this.boundPort })
    return { port: this.boundPort }
  }

  async stop(): Promise<void> {
    const server = this.server
    this.rateWindows.clear()
    this.pairFailures.clear()
    this.anonymousAudit.clear()
    if (!server) {
      this.boundPort = 0
      return
    }
    for (const guard of this.requestGuards.values()) clearTimeout(guard)
    this.requestGuards.clear()
    for (const socket of this.sockets.keys()) socket.destroy()
    this.sockets.clear()
    const closed = await this.closeServer(server)
    // `server.listening` is already false the moment close() is called, even with connections still
    // open, so the only honest signal that the listener survived the deadline is the close callback.
    if (!closed) {
      this.deps.logger?.warn('[SyncHost] Listener did not close within the deadline')
    }
    this.server = null
    this.boundPort = 0
  }

  /** Resolves true when the listener actually closed, false when the deadline was reached first. */
  private async closeServer(server: http.Server): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      let settled = false
      let closed = false
      const done = (): void => {
        if (settled) return
        settled = true
        clearTimeout(escalation)
        clearTimeout(giveUp)
        resolve(closed)
      }
      const escalation = setTimeout(() => {
        server.closeAllConnections?.()
      }, 1_000)
      escalation.unref?.()
      const giveUp = setTimeout(done, 5_000)
      giveUp.unref?.()
      server.close(() => {
        closed = true
        done()
      })
    })
  }

  private async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): Promise<void> {
    const url = request.url ?? '/'
    const path = url.split('?')[0]
    const method = request.method ?? 'GET'
    const clientIp = this.resolveClientIp(request)
    const socket = request.socket
    let authenticatedDeviceId: string | null = null
    this.armRequestGuard(socket)
    if (request.complete) {
      this.clearRequestGuard(socket)
    } else {
      const clear = (): void => this.clearRequestGuard(socket)
      request.once('end', clear)
      request.once('aborted', clear)
      request.once('error', clear)
      request.once('close', clear)
    }

    try {
      if (path === SYNC_HOST_HANDSHAKE_PATH && method === 'GET') {
        if (!this.consumeRateLimit(`anon:${clientIp ?? 'unknown'}`)) {
          this.respondJson(response, 429, { error: 'rate_limited' })
          this.auditAnonymous({ method, path, status: 429, bytes: 0, deviceId: null, clientIp })
          return
        }
        const payload = SyncHostHandshakeSchema.parse({
          protocol: SYNC_HOST_PROTOCOL_NAME,
          protocolVersion: SYNC_HOST_PROTOCOL_VERSION,
          hostId: this.deps.getHostId(),
          appVersion: this.deps.getAppVersion(),
          capabilities: this.deps.prepare ? [...HOST_CAPABILITIES, 'prepare'] : HOST_CAPABILITIES,
          encryption: { payload: 'none', transport: 'tls' }
        })
        const bytes = this.respondJson(response, 200, payload)
        this.auditAnonymous({ method, path, status: 200, bytes, deviceId: null, clientIp })
        return
      }

      if (path === SYNC_HOST_PAIR_PATH) {
        await this.handlePair(request, response, method, path, clientIp)
        return
      }

      // Authentication comes before path and method handling: an unauthenticated caller must not be
      // able to tell which routes exist, or which methods they accept, from the response.
      const device = this.authenticate(request)
      if (!device) {
        if (!this.consumeRateLimit(`anon:${clientIp ?? 'unknown'}`)) {
          this.respondJson(response, 429, { error: 'rate_limited' })
          this.auditAnonymous({ method, path, status: 429, bytes: 0, deviceId: null, clientIp })
          return
        }
        this.respondJson(response, 401, { error: 'unauthorized' })
        this.auditAnonymous({ method, path, status: 401, bytes: 0, deviceId: null, clientIp })
        return
      }
      authenticatedDeviceId = device.deviceId
      response.setHeader(SYNC_HOST_DEVICE_HEADER, device.deviceId)

      // The limiter runs before path and method handling: a paired device hammering unknown paths
      // would otherwise never be charged, and every 404 it earns evicts a legitimate audit entry.
      if (!this.consumeRateLimit(device.deviceId)) {
        this.respondJson(response, 429, { error: 'rate_limited' })
        this.audit({ method, path, status: 429, bytes: 0, deviceId: device.deviceId, clientIp })
        return
      }

      if (path.startsWith(SYNC_REPLICA_PREFIX + '/') && this.deps.replica) {
        const socket = this.sockets.get(request.socket)
        if (socket) socket.streaming = true
        response.once('close', () => {
          if (socket) socket.streaming = false
        })
        await this.deps.replica.handle(
          request,
          response,
          device.deviceId,
          this.deps.devices.replicaId(device.deviceId),
          () => this.deps.allowWrites?.() === true && this.deps.devices.canWrite(device.deviceId)
        )
        return
      }

      if (!HANDLED_PATHS.has(path)) {
        this.respondJson(response, 404, { error: 'not_found' })
        this.audit({ method, path, status: 404, bytes: 0, deviceId: device.deviceId, clientIp })
        return
      }
      if (method !== 'GET' && method !== 'POST') {
        this.respondJson(response, 405, { error: 'method_not_allowed' })
        this.audit({ method, path, status: 405, bytes: 0, deviceId: device.deviceId, clientIp })
        return
      }

      if (path === SYNC_HOST_PREPARE_PATH) {
        if (method !== 'POST' || !this.deps.prepare) {
          this.respondJson(response, 405, { error: 'method_not_allowed' })
          return
        }
        const read = await this.readBody(request, 0)
        if (!read.ok) {
          this.respondJson(response, 413, { error: 'payload_too_large' })
          return
        }
        this.deps.prepare()
        const bytes = this.respondJson(response, 202, { accepted: true })
        this.audit({ method, path, status: 202, bytes, deviceId: device.deviceId, clientIp })
        return
      }

      if (path === SYNC_HOST_STATUS_PATH) {
        if (method !== 'GET') {
          this.respondJson(response, 405, { error: 'method_not_allowed' })
          this.audit({ method, path, status: 405, bytes: 0, deviceId: device.deviceId, clientIp })
          return
        }
        await this.handleStatus(response, method, path, device.deviceId, clientIp)
        return
      }

      if (path === SYNC_HOST_SNAPSHOT_PATH) {
        if (method !== 'GET') {
          this.respondJson(response, 405, { error: 'method_not_allowed' })
          this.audit({ method, path, status: 405, bytes: 0, deviceId: device.deviceId, clientIp })
          return
        }
        await this.handleSnapshot(request, response, method, path, device.deviceId, clientIp)
        return
      }

      // Declared by the protocol but not served by this build yet (push, events).
      this.respondJson(response, 501, { error: 'not_implemented' })
      this.audit({ method, path, status: 501, bytes: 0, deviceId: device.deviceId, clientIp })
    } catch (error) {
      this.deps.logger?.warn('[SyncHost] Request failed', {
        method,
        path,
        error: error instanceof Error ? error.message : String(error)
      })
      if (!response.headersSent) this.respondJson(response, 500, { error: 'internal_error' })
      else response.destroy()
      this.audit({ method, path, status: 500, bytes: 0, deviceId: authenticatedDeviceId, clientIp })
    }
  }

  private async handlePair(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    method: string,
    path: string,
    clientIp: string | null
  ): Promise<void> {
    if (method !== 'POST') {
      this.respondJson(response, 405, { error: 'method_not_allowed' })
      this.auditAnonymous({ method, path, status: 405, bytes: 0, deviceId: null, clientIp })
      return
    }
    if (!this.consumeRateLimit(`pair:${clientIp ?? 'unknown'}`)) {
      this.respondJson(response, 429, { error: 'rate_limited' })
      this.auditAnonymous({ method, path, status: 429, bytes: 0, deviceId: null, clientIp })
      return
    }

    const read = await this.readBody(request, SYNC_HOST_PAIR_BODY_MAX_BYTES)
    if (!read.ok) {
      const status = read.reason === 'overflow' ? 413 : 400
      const error = read.reason === 'overflow' ? 'payload_too_large' : 'invalid_request'
      this.respondJson(response, status, { error })
      this.auditAnonymous({ method, path, status, bytes: 0, deviceId: null, clientIp })
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(read.body)
    } catch {
      this.respondJson(response, 400, { error: 'invalid_request' })
      this.auditAnonymous({ method, path, status: 400, bytes: 0, deviceId: null, clientIp })
      return
    }
    const validation = SyncHostPairRequestSchema.safeParse(parsed)
    if (!validation.success) {
      this.respondJson(response, 400, { error: 'invalid_request' })
      this.auditAnonymous({ method, path, status: 400, bytes: 0, deviceId: null, clientIp })
      return
    }

    const failureKey = clientIp ?? 'unknown'
    if (!this.consumePairFailureBudget(failureKey, false)) {
      this.respondJson(response, 429, { error: 'rate_limited' })
      this.auditAnonymous({ method, path, status: 429, bytes: 0, deviceId: null, clientIp })
      return
    }

    // Captured before consuming so a failure after the code was spent can hand it back.
    const outstanding = this.deps.pairing.current()
    const outcome = this.deps.pairing.consume(validation.data.code)
    // Invalid and expired codes share one response so a caller cannot probe code state. Repeated
    // failures cost the caller's own budget, never the user's code.
    if (outcome !== 'accepted') {
      this.consumePairFailureBudget(failureKey, true)
      this.respondJson(response, 401, { error: 'pairing_failed' })
      this.auditAnonymous({ method, path, status: 401, bytes: 0, deviceId: null, clientIp })
      return
    }

    this.pairFailures.delete(failureKey)
    let issued: IssuedSyncHostDevice
    try {
      issued = await this.deps.devices.issue({
        name: validation.data.deviceName,
        requestedWrite:
          validation.data.bidirectional === true && Boolean(validation.data.replicaId),
        replicaId: validation.data.replicaId
      })
    } catch (error) {
      // The code was spent but no device exists. Burning it would force the user to generate a new
      // one for a failure that was not theirs, so it is restored and the error still surfaces.
      if (outstanding) this.deps.pairing.restore(outstanding.code, outstanding.expiresAt)
      if (error instanceof Error && error.message === 'sync.tunnel.error.duplicateReplica') {
        const bytes = this.respondJson(response, 409, { error: 'duplicateReplica' })
        this.auditAnonymous({ method, path, status: 409, bytes, deviceId: null, clientIp })
        return
      }
      throw error
    }
    const payload = SyncHostPairResponseSchema.parse({
      deviceId: issued.device.deviceId,
      deviceName: issued.device.name,
      token: issued.token
    })
    const bytes = this.respondJson(response, 200, payload)
    this.audit({ method, path, status: 200, bytes, deviceId: issued.device.deviceId, clientIp })
    this.deps.changed?.()
  }

  private async handleStatus(
    response: http.ServerResponse,
    method: string,
    path: string,
    deviceId: string,
    clientIp: string | null
  ): Promise<void> {
    const snapshot = await this.deps.snapshotSource.current()
    const payload = SyncHostStatusSchema.parse({
      snapshot: snapshot
        ? {
            fileName: snapshot.fileName,
            size: snapshot.size,
            sha256: snapshot.sha256,
            backupFormatVersion: snapshot.backupFormatVersion,
            databaseEncrypted: snapshot.databaseEncrypted
          }
        : null,
      ...this.deps.preparation?.(),
      serverTime: Date.now()
    })
    const bytes = this.respondJson(response, 200, payload)
    this.audit({ method, path, status: 200, bytes, deviceId, clientIp })
  }

  private async handleSnapshot(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    method: string,
    path: string,
    deviceId: string,
    clientIp: string | null
  ): Promise<void> {
    // The abort hook must be attached before the first await. Resolving the snapshot can take
    // seconds on a large package, and if the client disconnects in that window the response's
    // `close` has already fired: a listener attached afterwards never runs, so the handler would
    // hang forever, leak the read stream and never audit the request.
    let gone = this.isResponseGone(response)
    const markGone = (): void => {
      gone = true
    }
    response.once('close', markGone)

    const snapshot = await this.deps.snapshotSource.current()
    if (gone) {
      this.audit({ method, path, status: 499, bytes: 0, deviceId, clientIp })
      return
    }
    if (!snapshot) {
      this.respondJson(response, 404, { error: 'no_snapshot' })
      this.audit({ method, path, status: 404, bytes: 0, deviceId, clientIp })
      return
    }

    const rangeHeader = request.headers.range
    let selection: RangeSelection | null = null
    let status = 200
    if (typeof rangeHeader === 'string' && rangeHeader.trim()) {
      selection = this.parseRange(rangeHeader, snapshot.size)
      if (!selection) {
        response.writeHead(416, {
          'content-range': `bytes */${snapshot.size}`,
          'accept-ranges': 'bytes'
        })
        response.end()
        this.audit({ method, path, status: 416, bytes: 0, deviceId, clientIp })
        return
      }
      status = 206
    }

    if (snapshot.size === 0) {
      // An empty package cannot be streamed with a range; report it as an empty body rather than
      // letting createReadStream reject on a negative end offset.
      const bytes = this.respondJson(response, 409, { error: 'empty_snapshot' })
      this.audit({ method, path, status: 409, bytes, deviceId, clientIp })
      return
    }

    const start = selection?.start ?? 0
    const end = selection?.end ?? snapshot.size - 1
    const headers: http.OutgoingHttpHeaders = {
      'content-type': 'application/octet-stream',
      'content-length': String(end - start + 1),
      'accept-ranges': 'bytes',
      [SYNC_HOST_SNAPSHOT_ID_HEADER]: snapshot.fileName,
      [SYNC_HOST_SNAPSHOT_HASH_HEADER]: snapshot.sha256,
      'cache-control': 'no-store'
    }
    if (status === 206) {
      headers['content-range'] = `bytes ${start}-${end}/${snapshot.size}`
    }
    response.writeHead(status, headers)
    if (this.isResponseGone(response)) {
      // The peer vanished while the headers were being written; nothing below would ever settle.
      this.audit({ method, path, status: 499, bytes: 0, deviceId, clientIp })
      return
    }

    let bytesWritten = 0
    let completed = false
    response.once('finish', () => {
      completed = true
    })
    try {
      await new Promise<void>((resolve) => {
        const stream = fs.createReadStream(snapshot.filePath, { start, end })
        const finish = (): void => {
          stream.destroy()
          resolve()
        }
        response.on('close', finish)
        stream.on('data', (chunk) => {
          bytesWritten += chunk.length
        })
        stream.on('error', () => {
          // Headers and Content-Length are already sent, so the body cannot be completed honestly.
          // Abort the connection instead of leaving the client to wait for the request timeout.
          response.destroy()
          finish()
        })
        stream.on('end', () => {
          response.end()
        })
        // Protect this connection from slot eviction for as long as the body is being written.
        this.markStreaming(request.socket)
        stream.pipe(response)
      })
    } finally {
      // The socket outlives the response on keep-alive: leaving it marked streaming would make it
      // unevictable, and 32 such sockets would turn the ceiling into a wall for every newcomer.
      this.clearStreaming(request.socket)
    }

    this.audit({
      method,
      path,
      // 499 (client closed request) records an aborted transfer rather than claiming success.
      status: completed ? status : 499,
      bytes: bytesWritten,
      deviceId,
      clientIp
    })
  }

  private parseRange(header: string, size: number): RangeSelection | null {
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
    if (!match) return null
    const [, rawStart, rawEnd] = match
    if (rawStart === '' && rawEnd === '') return null

    if (rawStart === '') {
      const suffixLength = Number(rawEnd)
      if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null
      const start = Math.max(0, size - suffixLength)
      return { start, end: size - 1 }
    }

    const start = Number(rawStart)
    const end = rawEnd === '' ? size - 1 : Number(rawEnd)
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null
    if (start > end || start >= size) return null
    return { start, end: Math.min(end, size - 1) }
  }

  /**
   * Cloudflare sets `cf-connecting-ip` on tunneled requests; a loopback peer may also spoof it, so
   * only an IP-literal shaped value is trusted as a limiter/audit key.
   */
  private resolveClientIp(request: http.IncomingMessage): string | null {
    const header = request.headers['cf-connecting-ip']
    if (typeof header === 'string' && /^[0-9a-fA-F:.]{3,45}$/.test(header.trim())) {
      return header.trim()
    }
    return request.socket.remoteAddress ?? null
  }

  private authenticate(request: http.IncomingMessage) {
    const header = request.headers.authorization
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null
    return this.deps.devices.authenticate(header.slice('Bearer '.length))
  }

  private consumeRateLimit(key: string): boolean {
    const now = Date.now()
    this.boundWindowMap(
      this.rateWindows,
      SYNC_HOST_RATE_LIMIT_MAX_KEYS,
      SYNC_HOST_RATE_LIMIT_WINDOW_MS,
      now
    )
    const window = this.rateWindows.get(key)
    if (!window || now - window.windowStart >= SYNC_HOST_RATE_LIMIT_WINDOW_MS) {
      this.rateWindows.set(key, { windowStart: now, count: 1 })
      return true
    }
    window.count += 1
    return window.count <= SYNC_HOST_RATE_LIMIT_REQUESTS_PER_WINDOW
  }

  /**
   * Per-source pairing failure budget. `charge` records a failure; without it the call is a
   * read-only check. A successful pairing clears the budget.
   */
  private consumePairFailureBudget(key: string, charge: boolean): boolean {
    const now = Date.now()
    this.boundWindowMap(
      this.pairFailures,
      SYNC_HOST_PAIR_FAILURE_MAX_KEYS,
      SYNC_HOST_PAIR_FAILURE_WINDOW_MS,
      now
    )
    const entry = this.pairFailures.get(key)
    if (charge) {
      if (!entry || now - entry.windowStart >= SYNC_HOST_PAIR_FAILURE_WINDOW_MS) {
        this.pairFailures.set(key, { windowStart: now, count: 1 })
        return true
      }
      entry.count += 1
      return entry.count <= SYNC_HOST_PAIR_MAX_FAILURES_PER_WINDOW
    }
    if (!entry || now - entry.windowStart >= SYNC_HOST_PAIR_FAILURE_WINDOW_MS) return true
    return entry.count < SYNC_HOST_PAIR_MAX_FAILURES_PER_WINDOW
  }

  /**
   * Keeps a windowed limiter map bounded: expired windows are dropped first, and if the map is still
   * full the oldest entry is evicted. Pruning alone is not enough — inside one window nothing is
   * expired, so a caller could otherwise grow the map without bound.
   */
  private boundWindowMap<K, V extends { windowStart: number }>(
    map: Map<K, V>,
    limit: number,
    windowMs: number,
    now: number
  ): void {
    if (map.size < limit) return
    for (const [key, value] of map) {
      if (now - value.windowStart >= windowMs) map.delete(key)
    }
    while (map.size >= limit) {
      const oldest = map.keys().next().value
      if (oldest === undefined) break
      map.delete(oldest)
    }
  }

  /** Oldest connection that is not currently streaming a response body, or null if all are busy. */
  private oldestNonStreamingSocket(): net.Socket | null {
    for (const [socket, state] of this.sockets) {
      if (!state.streaming) return socket
    }
    return null
  }

  private markStreaming(socket: net.Socket): void {
    const state = this.sockets.get(socket)
    if (state) state.streaming = true
  }

  private clearStreaming(socket: net.Socket): void {
    const state = this.sockets.get(socket)
    if (state) state.streaming = false
  }

  /**
   * Reads a bounded body. An oversized body is drained but not buffered, so the caller can still
   * send a real 413 instead of resetting the connection under the client.
   */
  private readBody(
    request: http.IncomingMessage,
    limit: number
  ): Promise<{ ok: true; body: string } | { ok: false; reason: 'overflow' | 'invalid' }> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      let total = 0
      let settled = false
      const done = (
        result: { ok: true; body: string } | { ok: false; reason: 'overflow' | 'invalid' }
      ): void => {
        if (settled) return
        settled = true
        resolve(result)
      }
      request.on('data', (chunk: Buffer) => {
        if (settled) return
        total += chunk.length
        if (total > limit) {
          done({ ok: false, reason: 'overflow' })
          return
        }
        chunks.push(chunk)
      })
      request.on('end', () => done({ ok: true, body: Buffer.concat(chunks).toString('utf8') }))
      request.on('error', () => done({ ok: false, reason: 'invalid' }))
      request.on('aborted', () => done({ ok: false, reason: 'invalid' }))
    })
  }

  /**
   * Enforces the request-receive deadline per request.
   *
   * Node's own `requestTimeout` is only evaluated on the connections-checking interval (default
   * 30 s), so a stalled body could keep a connection slot for far longer than the configured
   * budget. This guard destroys the socket on the deadline; it is cleared once the request has
   * been fully received, so it never interferes with a long response stream.
   */
  private armRequestGuard(socket: net.Socket): void {
    this.clearRequestGuard(socket)
    const guard = setTimeout(() => {
      this.requestGuards.delete(socket)
      socket.destroy()
    }, this.requestReceiveTimeoutMs)
    guard.unref?.()
    this.requestGuards.set(socket, guard)
  }

  private clearRequestGuard(socket: net.Socket): void {
    const guard = this.requestGuards.get(socket)
    if (!guard) return
    clearTimeout(guard)
    this.requestGuards.delete(socket)
  }

  /**
   * True when the peer is already gone, so nothing written below could reach it or settle.
   *
   * `destroyed`/`writableEnded` are checked together with the underlying socket because an aborted
   * request can leave the response object alive but unwritable.
   */
  private isResponseGone(response: http.ServerResponse): boolean {
    return (
      response.destroyed ||
      response.writableEnded ||
      response.socket === null ||
      response.socket?.destroyed === true
    )
  }

  private respondJson(response: http.ServerResponse, status: number, body: unknown): number {
    if (response.destroyed || response.writableEnded) return 0
    const payload = JSON.stringify(body)
    response.writeHead(status, {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(payload)),
      'cache-control': 'no-store'
    })
    response.end(payload)
    return Buffer.byteLength(payload)
  }

  private audit(entry: Omit<SyncHostAuditEntry, 'at' | 'suppressed'>): void {
    this.auditEntries.push({ at: Date.now(), suppressed: 0, ...entry })
    this.trimAudit()
  }

  /**
   * Records unauthenticated traffic, coalescing repeats from the same source into one entry.
   *
   * Anyone who learns the tunnel hostname can generate these (handshake included), and at the anon
   * request budget a single source would otherwise evict the whole ring in minutes — erasing the
   * evidence of earlier probes. One entry per source keeps the signal and bounds the noise.
   */
  private auditAnonymous(entry: Omit<SyncHostAuditEntry, 'at' | 'suppressed'>): void {
    const key = entry.clientIp ?? 'unknown'
    const existing = this.anonymousAudit.get(key)
    if (existing && this.auditEntries.includes(existing)) {
      existing.suppressed += 1
      existing.status = entry.status
      existing.at = Date.now()
      return
    }
    const created: SyncHostAuditEntry = { at: Date.now(), suppressed: 0, ...entry }
    this.auditEntries.push(created)
    this.anonymousAudit.set(key, created)
    this.trimAudit()
  }

  private trimAudit(): void {
    if (this.auditEntries.length <= SYNC_HOST_AUDIT_LIMIT) return
    const removed = this.auditEntries.splice(0, this.auditEntries.length - SYNC_HOST_AUDIT_LIMIT)
    for (const entry of removed) {
      const key = entry.clientIp ?? 'unknown'
      if (this.anonymousAudit.get(key) === entry) this.anonymousAudit.delete(key)
    }
  }
}
