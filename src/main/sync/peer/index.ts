import { createHash, randomBytes } from 'node:crypto'
import type { AutomaticSync, SyncConnection } from '../replica/automatic'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, rename, rm, stat, statfs } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import {
  SYNC_HOST_HANDSHAKE_PATH,
  SYNC_HOST_PAIR_PATH,
  SYNC_HOST_PREPARE_PATH,
  SYNC_HOST_PROTOCOL_VERSION,
  SYNC_HOST_STATUS_PATH,
  SYNC_HOST_SNAPSHOT_PATH,
  SYNC_HOST_SNAPSHOT_ID_HEADER,
  SYNC_HOST_SNAPSHOT_HASH_HEADER,
  SyncHostHandshakeSchema,
  SyncHostPairResponseSchema,
  SyncHostStatusSchema,
  type SyncHostSnapshotInfo
} from '@shared/contracts/syncHost'
import type { SyncPeerStatus } from '@shared/contracts/routes/syncPeer.routes'
import type { SyncImportResult } from '../index'

const PairingSchema = z.object({
  hostUrl: z.string(),
  hostId: z.string(),
  deviceId: z.string(),
  deviceName: z.string(),
  wrappedToken: z.string(),
  lastSuccessAt: z.number().nullable(),
  bidirectional: z.boolean().default(false)
})
type Pairing = z.infer<typeof PairingSchema>

export interface SyncPeerDeps {
  directory: string
  replicaId?(): string
  protectToken(token: string): string
  revealToken(wrapped: string): string
  isLocalDatabaseEncrypted(): boolean
  importSnapshot(filePath: string, mode: 'increment' | 'overwrite'): Promise<SyncImportResult>
  fetch?: typeof fetch
}

function fail(code: string): never {
  throw new Error(`sync.tunnel.error.${code}`)
}

/** One paired host and one transfer per profile; private staging never enters cloud backups. */
export class SyncPeerService {
  automatic?: AutomaticSync
  private readonly fetch: typeof fetch
  private controller: AbortController | null = null
  private task: Promise<void> | null = null
  private pairingTask: Promise<SyncPeerStatus> | null = null
  private pairingBusy = false
  private stopping = false
  private cancelled = false
  private progress: Pick<SyncPeerStatus, 'phase' | 'received' | 'total' | 'error'> = {
    phase: 'idle',
    received: 0,
    total: 0,
    error: null
  }

  constructor(private readonly deps: SyncPeerDeps) {
    this.fetch = deps.fetch ?? fetch
  }

  private file(name: string): string {
    return path.join(this.deps.directory, name)
  }

  private async readPairing(): Promise<Pairing | null> {
    try {
      return PairingSchema.parse(JSON.parse(await readFile(this.file('pairing.json'), 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      fail('credentialsUnavailable')
    }
  }

  private async writePrivate(name: string, value: unknown): Promise<void> {
    await mkdir(this.deps.directory, { recursive: true, mode: 0o700 })
    const temporary = this.file(`${name}.${randomBytes(6).toString('hex')}.tmp`)
    try {
      const file = await open(temporary, 'wx', 0o600)
      try {
        await file.writeFile(JSON.stringify(value))
        await file.sync()
      } finally {
        await file.close()
      }
      await rename(temporary, this.file(name))
    } finally {
      await rm(temporary, { force: true })
    }
  }

  async connection(): Promise<SyncConnection | null> {
    const pairing = await this.readPairing()
    if (!pairing) return null
    if (!pairing.bidirectional) throw new Error('sync.tunnel.error.writeConsentRequired')
    return {
      hostUrl: pairing.hostUrl,
      hostId: pairing.hostId,
      token: this.deps.revealToken(pairing.wrappedToken)
    }
  }

  async setAutomatic(enabled: boolean): Promise<SyncPeerStatus> {
    this.assertIdle()
    if (!this.automatic) fail('automaticUnsupported')
    await this.automatic.setEnabled(enabled)
    return this.getStatus()
  }

  async syncNow(): Promise<SyncPeerStatus> {
    this.assertIdle()
    if (!this.automatic?.status().enabled) fail('automaticDisabled')
    this.automatic.request(true)
    return this.getStatus()
  }

  async getStatus(): Promise<SyncPeerStatus> {
    const pairing = await this.readPairing()
    return {
      automatic: this.automatic?.status(),
      paired: pairing !== null,
      requestedWrite: pairing?.bidirectional ?? false,
      hostUrl: pairing?.hostUrl ?? '',
      hostId: pairing?.hostId ?? '',
      deviceName: pairing?.deviceName ?? '',
      lastSuccessAt: pairing?.lastSuccessAt ?? null,
      ...this.progress
    }
  }

  private assertIdle(): void {
    if (this.stopping || this.task || this.pairingBusy) fail('busy')
  }

  pair(input: {
    hostUrl: string
    hostId: string
    code: string
    deviceName: string
    bidirectional?: boolean
  }): Promise<SyncPeerStatus> {
    this.assertIdle()
    this.pairingTask = this.pairInternal(input).finally(() => {
      this.pairingTask = null
    })
    return this.pairingTask
  }

  private async pairInternal(input: {
    hostUrl: string
    hostId: string
    code: string
    deviceName: string
    bidirectional?: boolean
  }): Promise<SyncPeerStatus> {
    this.pairingBusy = true
    this.controller = new AbortController()
    this.progress = { phase: 'pairing', received: 0, total: 0, error: null }
    try {
      await this.automatic?.setEnabled(false)
      let url: URL
      try {
        url = new URL(input.hostUrl)
      } catch {
        fail('invalidUrl')
      }
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/'
      )
        fail('invalidUrl')
      const hostUrl = url.origin
      const replicaId = input.bidirectional ? this.deps.replicaId?.() : undefined
      if (input.bidirectional && !replicaId) fail('automaticUnsupported')
      // Fail before consuming a one-time code when the OS cannot protect a token.
      this.deps.protectToken('availability-check')
      await this.checkHost(hostUrl, input.hostId, this.controller.signal)
      const response = SyncHostPairResponseSchema.parse(
        await this.json(hostUrl + SYNC_HOST_PAIR_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code: input.code,
            deviceName: input.deviceName,
            bidirectional: input.bidirectional,
            replicaId
          }),
          signal: this.controller.signal
        })
      )
      await this.writePrivate('pairing.json', {
        hostUrl,
        hostId: input.hostId,
        deviceId: response.deviceId,
        deviceName: response.deviceName,
        wrappedToken: this.deps.protectToken(response.token),
        lastSuccessAt: null,
        bidirectional: input.bidirectional === true
      } satisfies Pairing)
      await this.clearPartial()
      this.progress.phase = 'idle'
    } catch (error) {
      this.progress.phase = 'failed'
      this.progress.error = this.errorKey(error)
      throw new Error(this.progress.error)
    } finally {
      this.pairingBusy = false
      this.controller = null
    }
    return this.getStatus()
  }

  async forget(): Promise<SyncPeerStatus> {
    await this.automatic?.setEnabled(false)
    this.assertIdle()
    this.pairingBusy = true
    try {
      await rm(this.file('pairing.json'), { force: true })
      await this.clearPartial()
      this.progress = { phase: 'idle', received: 0, total: 0, error: null }
    } finally {
      this.pairingBusy = false
    }
    return this.getStatus()
  }

  async pull(mode: 'increment' | 'overwrite', confirmOverwrite = false): Promise<SyncPeerStatus> {
    this.assertIdle()
    if ((await this.readPairing())?.bidirectional) fail('fullBackupIncompatible')
    if (this.automatic?.status().enabled) fail('busy')
    if (mode === 'overwrite' && !confirmOverwrite) fail('overwriteConfirmation')
    this.cancelled = false
    this.controller = new AbortController()
    this.progress = { phase: 'downloading', received: 0, total: 0, error: null }
    this.task = this.transfer(mode, this.controller.signal)
      .catch((error) => {
        this.progress.phase = this.cancelled ? 'cancelled' : 'failed'
        this.progress.error = this.cancelled ? null : this.errorKey(error)
      })
      .finally(() => {
        this.task = null
        this.controller = null
      })
    return this.getStatus()
  }

  async cancel(): Promise<SyncPeerStatus> {
    if (this.progress.phase !== 'importing' && this.controller) {
      this.cancelled = true
      this.controller.abort()
    }
    return this.getStatus()
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.progress.phase !== 'importing') {
      this.cancelled = true
      this.controller?.abort()
    }
    await this.task
    await this.pairingTask?.catch(() => undefined)
  }

  private async checkHost(hostUrl: string, hostId: string, signal: AbortSignal) {
    const handshake = SyncHostHandshakeSchema.parse(
      await this.json(hostUrl + SYNC_HOST_HANDSHAKE_PATH, { signal })
    )
    if (handshake.hostId !== hostId) fail('hostChanged')
    if (
      handshake.protocolVersion !== SYNC_HOST_PROTOCOL_VERSION ||
      !handshake.capabilities.includes('snapshot')
    )
      fail('unsupportedHost')
    return handshake
  }

  private async json(url: string, init: RequestInit): Promise<unknown> {
    const response = await this.fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.any([
        init.signal ?? new AbortController().signal,
        AbortSignal.timeout(30_000)
      ])
    })
    if (!response.ok) {
      await response.body?.cancel()
      if (response.status === 409 && url.endsWith(SYNC_HOST_PAIR_PATH)) fail('duplicateReplica')
      this.httpError(response.status)
    }
    if (!response.body) fail('invalidResponse')
    const chunks: Uint8Array[] = []
    let size = 0
    const reader = response.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > 64 * 1024) fail('invalidResponse')
        chunks.push(value)
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  }

  private httpError(status: number): never {
    if (status === 401 || status === 403) fail('unauthorized')
    if (status === 404) fail('noSnapshot')
    if (status === 405) fail('automaticUnsupported')
    if (status === 429) fail('rateLimited')
    fail('connectionFailed')
  }

  private errorKey(error: unknown): string {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'ENOSPC') return 'sync.tunnel.error.diskFull'
    if (['EACCES', 'EPERM', 'EROFS', 'EIO'].includes(code ?? ''))
      return 'sync.tunnel.error.storageFailed'
    const message = error instanceof Error ? error.message : ''
    return message.startsWith('sync.') ? message : 'sync.tunnel.error.connectionFailed'
  }

  private async clearPartial(): Promise<void> {
    await rm(this.file('snapshot.part'), { force: true })
    await rm(this.file('snapshot.json'), { force: true })
  }

  private async transfer(mode: 'increment' | 'overwrite', signal: AbortSignal): Promise<void> {
    const pairing = await this.readPairing()
    if (!pairing) fail('notPaired')
    await this.checkHost(pairing.hostUrl, pairing.hostId, signal)
    let token: string
    try {
      token = this.deps.revealToken(pairing.wrappedToken)
    } catch {
      fail('credentialsUnavailable')
    }
    if (!token) fail('credentialsUnavailable')
    const headers = { authorization: `Bearer ${token}` }
    let status = SyncHostStatusSchema.parse(
      await this.json(pairing.hostUrl + SYNC_HOST_STATUS_PATH, { headers, signal })
    )
    let existing = ''
    try {
      existing = await readFile(this.file('snapshot.json'), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const resumable =
      status.snapshot &&
      existing ===
        JSON.stringify({
          hostUrl: pairing.hostUrl,
          hostId: pairing.hostId,
          snapshot: status.snapshot
        }) &&
      (await stat(this.file('snapshot.part'))
        .then((value) => value.size > 0 && value.size <= status.snapshot!.size)
        .catch(() => false))
    if (!resumable) {
      let preparing = false
      try {
        await this.json(pairing.hostUrl + SYNC_HOST_PREPARE_PATH, {
          method: 'POST',
          headers,
          signal
        })
        preparing = true
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        if (
          message !== 'sync.tunnel.error.noSnapshot' &&
          message !== 'sync.tunnel.error.automaticUnsupported'
        )
          throw error
      }
      if (preparing) {
        this.progress.phase = 'preparing'
        const deadline = Date.now() + 10 * 60_000
        do {
          status = SyncHostStatusSchema.parse(
            await this.json(pairing.hostUrl + SYNC_HOST_STATUS_PATH, { headers, signal })
          )
          if (!status.preparing) break
          if (Date.now() > deadline) fail('prepareFailed')
          await delay(1000, undefined, { signal })
        } while (status.preparing)
        if (status.preparationError) fail('prepareFailed')
      }
    }
    this.progress.phase = 'downloading'
    const { snapshot } = status
    if (!snapshot) fail('noSnapshot')
    if (snapshot.databaseEncrypted) fail('encryptedSnapshot')
    if (mode === 'overwrite' && this.deps.isLocalDatabaseEncrypted())
      throw new Error('sync.error.overwriteEncryptionMismatch')
    if (
      !/^backup-\d+\.zip$/.test(snapshot.fileName) ||
      !/^[a-f0-9]{64}$/.test(snapshot.sha256) ||
      !Number.isSafeInteger(snapshot.size) ||
      snapshot.size < 1 ||
      snapshot.size > 64 * 1024 ** 3 ||
      snapshot.backupFormatVersion === null
    )
      fail('invalidResponse')
    const identity = JSON.stringify({ hostUrl: pairing.hostUrl, hostId: pairing.hostId, snapshot })
    if (existing !== identity) {
      await this.clearPartial()
      await this.writePrivate('snapshot.json', JSON.parse(identity))
    }
    let offset = await stat(this.file('snapshot.part'))
      .then((value) => value.size)
      .catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
        throw error
      })
    if (offset > snapshot.size) {
      await this.clearPartial()
      fail('integrityFailed')
    }
    this.progress.total = snapshot.size
    this.progress.received = offset
    const disk = await statfs(this.deps.directory)
    if (disk.bavail * disk.bsize < snapshot.size - offset + 16 * 1024 ** 2) fail('diskFull')
    if (offset < snapshot.size) {
      await this.download(pairing.hostUrl, headers, snapshot, offset, signal)
    }
    signal.throwIfAborted()
    this.progress.phase = 'verifying'
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(this.file('snapshot.part'), { signal }))
      hash.update(chunk)
    if (hash.digest('hex') !== snapshot.sha256) {
      await this.clearPartial()
      fail('integrityFailed')
    }
    signal.throwIfAborted()
    this.progress.phase = 'importing'
    const result = await this.deps.importSnapshot(this.file('snapshot.part'), mode)
    if (!result.success) throw new Error(result.message)
    try {
      await this.writePrivate('pairing.json', { ...pairing, lastSuccessAt: Date.now() })
      await this.clearPartial()
    } catch {
      // Import has committed: never report a failed import just because local bookkeeping failed.
      this.progress.error = 'sync.tunnel.error.cleanupFailed'
    }
    this.progress.phase = 'completed'
  }

  private async download(
    hostUrl: string,
    headers: Record<string, string>,
    snapshot: SyncHostSnapshotInfo,
    offset: number,
    signal: AbortSignal
  ): Promise<void> {
    const timeout = new AbortController()
    const headerTimer = setTimeout(() => timeout.abort(), 30_000)
    let response: Response
    try {
      response = await this.fetch(hostUrl + SYNC_HOST_SNAPSHOT_PATH, {
        headers: { ...headers, ...(offset ? { range: `bytes=${offset}-` } : {}) },
        redirect: 'error',
        signal: AbortSignal.any([signal, timeout.signal])
      })
    } finally {
      clearTimeout(headerTimer)
    }
    if (response.status !== 200 && response.status !== 206) {
      await response.body?.cancel()
      this.httpError(response.status)
    }
    if (response.status === 200) offset = 0
    const expectedRange = `bytes ${offset}-${snapshot.size - 1}/${snapshot.size}`
    if (
      !response.body ||
      response.headers.get(SYNC_HOST_SNAPSHOT_HASH_HEADER) !== snapshot.sha256 ||
      response.headers.get(SYNC_HOST_SNAPSHOT_ID_HEADER) !== snapshot.fileName ||
      response.headers.get('content-length') !== String(snapshot.size - offset) ||
      (response.status === 206 && response.headers.get('content-range') !== expectedRange)
    ) {
      await response.body?.cancel()
      fail('snapshotChanged')
    }
    const reader = response.body.getReader()
    const file = await open(this.file('snapshot.part'), offset ? 'a' : 'w', 0o600)
    this.progress.received = offset
    try {
      while (true) {
        const idleTimer = setTimeout(() => timeout.abort(), 60_000)
        let read: ReadableStreamReadResult<Uint8Array>
        try {
          read = await reader.read()
        } finally {
          clearTimeout(idleTimer)
        }
        if (read.done) break
        signal.throwIfAborted()
        if (this.progress.received + read.value.length > snapshot.size) fail('integrityFailed')
        await file.writeFile(read.value)
        this.progress.received += read.value.length
      }
      await file.sync()
      if (this.progress.received !== snapshot.size) fail('connectionFailed')
    } finally {
      await file.close()
      await reader.cancel().catch(() => undefined)
    }
  }
}
