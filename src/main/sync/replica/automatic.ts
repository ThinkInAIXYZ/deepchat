import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
  SyncReplicaInfoSchema,
  SyncBatchManifestSchema,
  SYNC_REPLICA_PREFIX,
  SYNC_QUIET_MS,
  SYNC_MIN_INTERVAL_MS,
  SYNC_MAX_WAIT_MS,
  SYNC_PART_BYTES,
  type SyncAutomaticStatus
} from '@shared/contracts/syncReplica'
import { SyncBatchFiles } from './batches'
import type { SyncReplicaStore } from './store'

const Saved = z.object({ enabled: z.boolean(), lastSuccessAt: z.number().nullable() })
export interface SyncConnection {
  hostUrl: string
  hostId: string
  token: string
}

export class AutomaticSync {
  private state: SyncAutomaticStatus = {
    enabled: false,
    phase: 'off',
    lastSuccessAt: null,
    error: null
  }
  private timer: NodeJS.Timeout | null = null
  private retry: NodeJS.Timeout | null = null
  private transferRetry: NodeJS.Timeout | null = null
  private stream: AbortController | null = null
  private transfer: AbortController | null = null
  private task: Promise<void> | null = null
  private listening: Promise<void> | null = null
  private firstPending = 0
  private flushPending = false
  private lastChange = 0
  private disposed = false
  private readonly unsubscribe: () => void
  private readonly outgoing: SyncBatchFiles
  private readonly incoming: SyncBatchFiles
  private saveChain: Promise<void> = Promise.resolve()
  private pendingSaveError = false

  constructor(
    private readonly deps: {
      directory: string
      store: SyncReplicaStore
      connection(): Promise<SyncConnection | null>
      available(): boolean
      changed(): void
      fetch?: typeof fetch
    }
  ) {
    this.outgoing = new SyncBatchFiles(path.join(deps.directory, 'outgoing'))
    this.incoming = new SyncBatchFiles(path.join(deps.directory, 'incoming'))
    this.unsubscribe = deps.store.subscribe(() => this.request())
  }

  status(): SyncAutomaticStatus {
    return { ...this.state }
  }

  async start(): Promise<void> {
    try {
      const saved = Saved.parse(
        JSON.parse(await readFile(path.join(this.deps.directory, 'automatic.json'), 'utf8'))
      )
      this.state = { ...this.state, ...saved, phase: saved.enabled ? 'waiting' : 'off' }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.update('failed', 'sync.tunnel.error.storageFailed')
    }
    if (this.state.enabled) this.connect()
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      if (!this.deps.available()) throw new Error('sync.tunnel.error.unavailable')
      const connection = await this.requireConnection()
      const info = SyncReplicaInfoSchema.parse(
        await this.json(connection, '/status', AbortSignal.timeout(30_000))
      )
      if (info.hostId !== connection.hostId || !info.writable)
        throw new Error('sync.tunnel.error.writeConsentRequired')
    }
    if (!enabled) {
      this.state.enabled = false
      await this.pause()
    }
    this.state.enabled = enabled
    await this.save()
    this.update(enabled ? 'waiting' : 'off')
    if (enabled) {
      this.connect()
      this.request(true)
    }
  }

  request(immediate = false): void {
    if (!this.state.enabled || this.disposed) return
    const now = Date.now()
    this.firstPending ||= now
    this.flushPending ||= immediate
    this.lastChange = now
    if (this.transferRetry) clearTimeout(this.transferRetry)
    this.transferRetry = null
    if (this.task) return
    if (this.timer) clearTimeout(this.timer)
    const deadline = Math.max(
      this.flushPending
        ? now
        : Math.min(this.lastChange + SYNC_QUIET_MS, this.firstPending + SYNC_MAX_WAIT_MS),
      (this.deps.available() ? this.deps.store.lastStart() : now) + SYNC_MIN_INTERVAL_MS
    )
    this.update('waiting')
    this.timer = setTimeout(
      () => {
        this.timer = null
        this.firstPending = 0
        this.flushPending = false
        this.task = this.exchange()
          .catch((error) => {
            if (!this.state.enabled || this.disposed) return
            const message = error instanceof Error ? error.message : ''
            this.update(
              message === 'sync.tunnel.error.busy' ? 'busy' : 'failed',
              message.startsWith('sync.') ? message : 'sync.tunnel.error.connectionFailed'
            )
            // Retry only failed work; an idle replica has no transfer timer.
            this.transferRetry = setTimeout(() => {
              this.transferRetry = null
              this.request(true)
            }, SYNC_MIN_INTERVAL_MS)
            this.transferRetry.unref()
          })
          .finally(() => {
            this.task = null
            if (this.firstPending && this.state.enabled) this.request()
          })
      },
      Math.max(0, deadline - now)
    )
    this.timer.unref()
  }

  private update(phase: SyncAutomaticStatus['phase'], error: string | null = null): void {
    const nextError = this.pendingSaveError ? 'sync.tunnel.error.storageFailed' : error
    if (this.state.phase === phase && this.state.error === nextError) return
    this.state.phase = phase
    this.state.error = nextError
    this.deps.changed()
  }

  private async save(): Promise<void> {
    const state = { enabled: this.state.enabled, lastSuccessAt: this.state.lastSuccessAt }
    const save = this.saveChain.then(async () => {
      await mkdir(this.deps.directory, { recursive: true, mode: 0o700 })
      const target = path.join(this.deps.directory, 'automatic.json')
      await writeFile(`${target}.tmp`, JSON.stringify(state), { mode: 0o600 })
      await rename(`${target}.tmp`, target)
    })
    this.saveChain = save.catch(() => {
      this.pendingSaveError = true
    })
    await save
    this.pendingSaveError = false
  }

  private connect(): void {
    if (this.stream || this.disposed || !this.state.enabled) return
    const controller = new AbortController()
    this.stream = controller
    this.listening = this.listen(controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted)
          this.update(
            'offline',
            error instanceof Error && error.message.startsWith('sync.')
              ? error.message
              : 'sync.tunnel.error.connectionFailed'
          )
      })
      .finally(() => {
        if (this.stream === controller) this.stream = null
        if (!this.disposed && this.state.enabled && !controller.signal.aborted) {
          this.retry = setTimeout(
            () => {
              this.retry = null
              this.connect()
            },
            5000 + Math.random() * 5000
          )
          this.retry.unref()
        }
      })
  }

  private async listen(signal: AbortSignal): Promise<void> {
    const connection = await this.requireConnection()
    const info = SyncReplicaInfoSchema.parse(await this.json(connection, '/status', signal))
    if (info.hostId !== connection.hostId || !info.writable)
      throw new Error('sync.tunnel.error.writeConsentRequired')
    if (!this.task && !this.timer) this.request()
    const response = await (this.deps.fetch ?? fetch)(
      connection.hostUrl + SYNC_REPLICA_PREFIX + '/events',
      {
        headers: { authorization: `Bearer ${connection.token}` },
        signal,
        redirect: 'error'
      }
    )
    await this.check(response)
    if (!response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body)
      throw new Error('Invalid event stream')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let idle = setTimeout(() => {
      void reader.cancel()
    }, 60_000)
    try {
      while (!signal.aborted) {
        const { value, done } = await reader.read()
        if (done) break
        clearTimeout(idle)
        idle = setTimeout(() => {
          void reader.cancel()
        }, 60_000)
        buffer += decoder.decode(value, { stream: true })
        if (buffer.length > 8192) throw new Error('Event too large')
        let end: number
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end).trim()
          buffer = buffer.slice(end + 1)
          if (!line.startsWith('data:')) continue
          const event = z
            .object({ revision: z.number().int().nonnegative().safe() })
            .parse(JSON.parse(line.slice(5)))
          if (event.revision > this.deps.store.cursor(info.replicaId)) this.request()
        }
      }
      if (!signal.aborted) throw new Error('Event stream closed')
    } finally {
      clearTimeout(idle)
      await reader.cancel().catch(() => undefined)
    }
  }

  private async exchange(): Promise<void> {
    if (!this.deps.available()) throw new Error('sync.tunnel.error.busy')
    const connection = await this.requireConnection()
    const controller = new AbortController()
    this.transfer = controller
    const signal = controller.signal
    this.deps.store.started(Date.now())
    this.update('syncing')
    try {
      const info = SyncReplicaInfoSchema.parse(await this.json(connection, '/status', signal))
      if (info.hostId !== connection.hostId || !info.writable)
        throw new Error('sync.tunnel.error.writeConsentRequired')
      const { cursor } = z
        .object({ cursor: z.number().int().nonnegative().safe() })
        .parse(
          await this.json(
            connection,
            `/cursor?replica=${encodeURIComponent(this.deps.store.replicaId)}`,
            signal
          )
        )
      let outgoingThrough = cursor
      let uploadFailure: unknown = null
      try {
        const outgoing = this.deps.store.export(cursor)
        outgoingThrough = outgoing.through
        if (outgoing.units.length) {
          const manifest = await this.outgoing.prepare(outgoing)
          const { missing } = z
            .object({
              missing: z.array(
                z
                  .number()
                  .int()
                  .min(0)
                  .max(manifest.parts - 1)
              )
            })
            .parse(await this.json(connection, '/upload', signal, manifest))
          for (const part of missing) {
            const data = await this.outgoing.part(manifest.id, part)
            await this.requestHttp(connection, `/part?id=${manifest.id}&part=${part}`, signal, data)
          }
          const committed = z
            .object({ cursor: z.number().int().nonnegative().safe() })
            .parse(await this.json(connection, `/commit?id=${manifest.id}`, signal, {}))
          if (committed.cursor < outgoing.through) throw new Error('Invalid acknowledgement')
          await this.outgoing.discard(manifest.id)
        }
      } catch (error) {
        uploadFailure = error
      }
      const after = this.deps.store.cursor(info.replicaId)
      const manifest = SyncBatchManifestSchema.parse(
        await this.json(connection, `/download?after=${after}`, signal)
      )
      if (
        manifest.replicaId !== info.replicaId ||
        manifest.parts !== Math.ceil(manifest.size / SYNC_PART_BYTES)
      )
        throw new Error('Invalid manifest')
      for (const part of await this.incoming.missing(manifest)) {
        const response = await this.requestHttp(
          connection,
          `/part?id=${manifest.id}&part=${part}`,
          signal
        )
        await this.incoming.receive(manifest, part, await this.bytes(response, SYNC_PART_BYTES))
      }
      const batch = await this.incoming.assemble(manifest)
      if (!(await this.deps.store.apply(batch, () => !signal.aborted && this.state.enabled)))
        throw new Error('sync.tunnel.error.busy')
      await this.incoming.discard(manifest.id)
      if (uploadFailure) throw uploadFailure
      this.state.lastSuccessAt = Date.now()
      await this.save()
      this.update('idle')
      if (outgoingThrough < this.deps.store.revision() || batch.through < info.revision)
        this.request()
    } finally {
      if (this.transfer === controller) this.transfer = null
    }
  }

  private async requireConnection(): Promise<SyncConnection> {
    const connection = await this.deps.connection()
    if (!connection) throw new Error('sync.tunnel.error.notPaired')
    const url = new URL(connection.hostUrl)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('sync.tunnel.error.invalidUrl')
    return connection
  }

  private async check(response: Response): Promise<void> {
    if (response.ok) return
    if (response.status === 400) {
      const body = JSON.parse((await this.bytes(response, 65536)).toString()) as { error?: unknown }
      const errors = [
        'sync.tunnel.error.batchTooLarge',
        'sync.tunnel.error.diskFull',
        'sync.tunnel.error.integrityFailed',
        'sync.tunnel.error.cancelled',
        'sync.tunnel.error.clockSkew'
      ]
      if (typeof body.error === 'string' && errors.includes(body.error)) throw new Error(body.error)
      throw new Error('sync.tunnel.error.invalidResponse')
    }
    if (response.status === 403) {
      let body: { error?: unknown } = {}
      try {
        body = JSON.parse((await this.bytes(response, 65536)).toString()) as { error?: unknown }
      } catch {
        // Intermediaries can return a non-JSON 403 response.
      }
      if (body.error === 'rePairRequired' || body.error === 'replicaMismatch')
        throw new Error('sync.tunnel.error.rePairRequired')
      throw new Error('sync.tunnel.error.writeConsentRequired')
    }
    void response.body?.cancel()
    if (response.status === 401) throw new Error('sync.tunnel.error.writeConsentRequired')
    if (response.status === 429) throw new Error('sync.tunnel.error.rateLimited')
    if (response.status === 409) throw new Error('sync.tunnel.error.busy')
    if (response.status === 404) throw new Error('sync.tunnel.error.automaticUnsupported')
    throw new Error('sync.tunnel.error.connectionFailed')
  }

  private async requestHttp(
    connection: SyncConnection,
    route: string,
    signal: AbortSignal,
    body?: Buffer | object
  ): Promise<Response> {
    const response = await (this.deps.fetch ?? fetch)(
      connection.hostUrl + SYNC_REPLICA_PREFIX + route,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: `Bearer ${connection.token}`,
          'content-type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json'
        },
        body:
          body === undefined
            ? undefined
            : Buffer.isBuffer(body)
              ? new Uint8Array(body)
              : JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        redirect: 'error'
      }
    )
    await this.check(response)
    return response
  }

  private async bytes(response: Response, limit: number): Promise<Buffer> {
    if (!response.body) throw new Error('Missing response body')
    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let size = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.length
        if (size > limit) throw new Error('Response too large')
        chunks.push(Buffer.from(value))
      }
      return Buffer.concat(chunks)
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  }

  private async json(
    connection: SyncConnection,
    route: string,
    signal: AbortSignal,
    body?: object
  ): Promise<unknown> {
    return JSON.parse(
      (await this.bytes(await this.requestHttp(connection, route, signal, body), 65536)).toString()
    )
  }

  async pause(): Promise<void> {
    this.stream?.abort()
    this.transfer?.abort()
    if (this.timer) clearTimeout(this.timer)
    if (this.retry) clearTimeout(this.retry)
    if (this.transferRetry) clearTimeout(this.transferRetry)
    this.transferRetry = null
    this.timer = this.retry = null
    this.firstPending = 0
    this.flushPending = false
    await this.task
    await this.listening
  }

  async close(): Promise<void> {
    this.disposed = true
    await this.pause()
    this.unsubscribe()
    await this.saveChain
  }
}
