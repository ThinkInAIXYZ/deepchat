import { randomBytes } from 'node:crypto'
import type { SyncReplicaEndpoint } from '../replica/endpoint'
import { chmod, copyFile, mkdir, open, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import {
  SYNC_HOST_BIND_FAILED_ERROR,
  SYNC_HOST_PROTOCOL_VERSION,
  type SyncHostAuditEntry,
  type SyncHostDeviceView
} from '@shared/contracts/syncHost'
import type { SyncTunnelConfig, SyncTunnelStatus } from '@shared/contracts/routes/syncHost.routes'
import { SyncTunnel } from './tunnel'
import type { SyncBackupInfo } from '@shared/types/sync'
import { SyncHostDeviceStore } from './devices'
import { SyncHostEndpoint, type SyncHostEndpointLogger } from './endpoint'
import { SyncHostPairingAuthority, type SyncHostPairingCode } from './pairing'
import { SyncHostSnapshotSource } from './snapshot'
import { SyncHostStateStore } from './state'

const ENDPOINT_DIRECTORY = 'sync-host'
const ENDPOINT_DESCRIPTOR_FILENAME = 'endpoint.json'

export interface SyncHostServiceStatus {
  enabled: boolean
  allowWrites: boolean
  running: boolean
  port: number | null
  hostId: string
  deviceCount: number
  hasSnapshot: boolean
  configuredPort: number
  publishedAt: number | null
  preparing: boolean
  tunnelConfig: SyncTunnelConfig
  hasTunnelToken: boolean
  tunnel: SyncTunnelStatus
}

export interface SyncHostServiceDeps {
  changed?: () => void
  replica?: SyncReplicaEndpoint
  resolveCloudflared?: () => string
  protectToken?: (token: string) => string
  revealToken?: (wrapped: string) => string
  createBackup: () => Promise<SyncBackupInfo | null>
  getFolderPath: () => string
  getUserDataPath: () => string
  getAppVersion: () => string
  logger?: SyncHostEndpointLogger
  /** Overridable for tests. */
  requestReceiveTimeoutMs?: number
}

/**
 * Owns host mode: whether the endpoint runs, who may talk to it, and what a slave can fetch.
 *
 * The endpoint is deliberately loopback-only and started on demand. All host state (enabled flag,
 * host identity, device records) lives in a private machine-local file rather than the settings
 * store, because settings travel inside backup packages and are merged on import.
 *
 * Lifecycle transitions are serialized: an enable racing a disable can otherwise leave a listener
 * running while host mode reads as disabled.
 */
export class SyncHostService {
  private readonly state: SyncHostStateStore
  private readonly devices: SyncHostDeviceStore
  private readonly pairing: SyncHostPairingAuthority
  private readonly snapshotSource: SyncHostSnapshotSource
  private readonly endpoint: SyncHostEndpoint
  private readonly tunnel: SyncTunnel | null
  private preparing: Promise<unknown> | null = null
  private startError: string | null = null
  private preparationError: string | null = null
  private lastPreparedAt = 0
  private lifecycle: Promise<unknown> = Promise.resolve()
  /** Identity minted before the first load, so every caller sees the same value. */
  private pendingHostId: string | null = null

  constructor(private readonly deps: SyncHostServiceDeps) {
    this.tunnel = deps.resolveCloudflared
      ? new SyncTunnel(
          path.join(deps.getUserDataPath(), ENDPOINT_DIRECTORY),
          deps.resolveCloudflared,
          deps.changed
        )
      : null
    this.state = new SyncHostStateStore(path.join(deps.getUserDataPath(), ENDPOINT_DIRECTORY))
    this.devices = new SyncHostDeviceStore(this.state)
    this.pairing = new SyncHostPairingAuthority(() => this.getHostId())
    this.snapshotSource = new SyncHostSnapshotSource({
      listBackups: async () => {
        await this.state.load()
        const published = this.state.snapshot().published
        return published ? [published] : []
      },
      getFolderPath: () => this.publicationDirectory(),
      logger: deps.logger
    })
    this.endpoint = new SyncHostEndpoint({
      changed: deps.changed,
      getPublicUrl: () =>
        this.state.snapshot().tunnel.mode === 'quick'
          ? (this.tunnel?.status().publicUrl ?? '')
          : this.state.snapshot().tunnel.publicUrl,
      trustCloudflareClientIp: () => this.state.snapshot().tunnel.mode !== 'external',
      replica: deps.replica,
      allowWrites: () => this.state.snapshot().allowWrites,
      prepare: () => this.prepareSnapshot(),
      preparation: () => ({
        preparing: this.preparing !== null,
        preparationError: this.preparationError
      }),
      devices: this.devices,
      pairing: this.pairing,
      snapshotSource: this.snapshotSource,
      getHostId: () => this.getHostId(),
      getAppVersion: deps.getAppVersion,
      logger: deps.logger,
      requestReceiveTimeoutMs: deps.requestReceiveTimeoutMs
    })
  }

  /** Loads machine-local state. Safe to call repeatedly. */
  async initialize(): Promise<void> {
    await this.serialize(async () => {
      await this.state.load()
      if (this.state.snapshot().hostId) {
        this.pendingHostId = null
        return
      }
      // Reuse the identity a pre-initialize caller already saw, so the handshake, the pairing
      // payload and the persisted file never disagree about who the host is.
      const created = this.pendingHostId ?? randomBytes(16).toString('hex')
      await this.state.update((state) => {
        state.hostId = state.hostId ?? created
      })
      this.pendingHostId = null
    })
  }

  getEnabled(): boolean {
    return this.state.snapshot().enabled
  }

  getHostId(): string {
    const existing = this.state.snapshot().hostId
    if (existing) return existing
    // Before `initialize()` completes there is no persisted identity yet; generate one in memory so
    // the handshake and pairing authority never observe an empty value. It is memoized (two callers
    // in this window must not see two different identities) and deliberately not written here:
    // `initialize()` persists it, so a failed write surfaces to its caller instead of leaving the
    // cache and the file disagreeing about who this host is.
    const created = this.pendingHostId ?? randomBytes(16).toString('hex')
    this.pendingHostId = created
    return created
  }

  async setEnabled(
    enabled: boolean,
    options: {
      port?: number
      consent?: boolean
      bidirectional?: boolean
      tunnel?: SyncTunnelConfig & { token?: string }
    } = {}
  ): Promise<SyncHostServiceStatus> {
    await this.serialize(async () => {
      await this.state.load()
      if (enabled) {
        if (!options.consent) throw new Error('sync.tunnel.error.consentRequired')
        const port = options.port ?? this.state.snapshot().port
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error('sync.tunnel.error.invalidPort')
        }
        if (this.endpoint.isRunning() && this.endpoint.getPort() !== port) {
          throw new Error('sync.tunnel.error.disableFirst')
        }
        const config = options.tunnel ?? this.state.snapshot().tunnel
        if (options.tunnel && this.endpoint.isRunning())
          throw new Error('sync.tunnel.error.disableFirst')
        let wrappedToken = this.state.snapshot().wrappedTunnelToken
        if (config.mode !== 'quick' && (options.tunnel || config.publicUrl)) {
          let url: URL
          try {
            url = new URL(config.publicUrl)
          } catch {
            throw new Error('sync.tunnel.error.invalidUrl')
          }
          if (
            url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            url.pathname !== '/' ||
            url.search ||
            url.hash
          )
            throw new Error('sync.tunnel.error.invalidUrl')
        }
        if (options.tunnel?.token?.trim()) {
          if (!this.deps.protectToken) throw new Error('sync.tunnel.error.credentialsUnavailable')
          wrappedToken = this.deps.protectToken(options.tunnel.token.trim())
        }
        if (config.mode === 'named' && !wrappedToken)
          throw new Error('sync.tunnel.error.tokenRequired')
        if (options.tunnel)
          await this.state.update((state) => {
            state.tunnel = { mode: config.mode, publicUrl: config.publicUrl }
            state.wrappedTunnelToken = config.mode === 'named' ? wrappedToken : null
          })
        // Start before persisting so a failed bind never leaves host mode marked enabled without a
        // listener, and roll the listener back if the flag itself cannot be written.
        await this.startInternal(port)
        try {
          await this.state.update((state) => {
            state.allowWrites = options.bidirectional === true
            if (!state.allowWrites) for (const device of state.devices) device.writable = false
            state.enabled = true
            state.port = port
            state.consentAt = Date.now()
            state.consentVersion = 2
          })
        } catch (error) {
          await this.stopInternal()
          throw error
        }
        return
      }
      // Stop after persisting so a crash mid-stop cannot resurrect the listener on next boot.
      await this.state.update((state) => {
        state.enabled = false
      })
      await this.stopInternal()
    })
    return this.getStatus()
  }

  async start(): Promise<void> {
    await this.serialize(() => this.startInternal())
  }

  async stop(): Promise<void> {
    await this.serialize(() => this.stopInternal())
  }

  /** Starts the endpoint only when host mode is enabled; safe to call unconditionally at boot. */
  async startIfEnabled(): Promise<void> {
    await this.tunnel?.initialize()
    await this.initialize()
    await this.serialize(async () => {
      const state = this.state.snapshot()
      if (!state.enabled) return
      if (!state.consentAt || state.consentVersion !== 2 || !state.port) {
        await this.state.update((next) => {
          next.enabled = false
        })
        return
      }
      await this.startInternal(state.port)
    })
  }

  /** Publish only a completed export; unrelated sync-folder packages are never served. */
  async publishSnapshot(): Promise<SyncHostServiceStatus> {
    await this.serialize(async () => {
      await this.state.load()
      if (!this.state.snapshot().consentAt || !this.getEnabled()) {
        throw new Error('sync.tunnel.error.consentRequired')
      }
      const backup = await this.deps.createBackup()
      if (!backup) throw new Error('sync.tunnel.error.busy')
      if (!/^backup-\d+\.zip$/.test(backup.fileName)) throw new Error('sync.error.noValidBackup')
      const directory = this.publicationDirectory()
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const target = path.join(directory, backup.fileName)
      const temporary = `${target}.${randomBytes(6).toString('hex')}.tmp`
      const previous = this.state.snapshot().published
      try {
        await copyFile(path.join(this.deps.getFolderPath(), backup.fileName), temporary)
        await chmod(temporary, 0o600)
        await rename(temporary, target)
        await this.state.update((state) => {
          state.published = backup
        })
      } catch (error) {
        await unlink(temporary).catch(() => undefined)
        if (previous?.fileName !== backup.fileName) await unlink(target).catch(() => undefined)
        throw error
      }
      if (previous && previous.fileName !== backup.fileName) {
        await unlink(path.join(directory, previous.fileName)).catch(() => undefined)
      }
    })
    return this.getStatus()
  }

  private prepareSnapshot(): void {
    if (this.preparing || Date.now() - this.lastPreparedAt < 10_000) return
    this.preparationError = null
    this.preparing = this.publishSnapshot()
      .catch(() => {
        this.preparationError = 'sync.tunnel.error.prepareFailed'
      })
      .finally(() => {
        this.lastPreparedAt = Date.now()
        this.preparing = null
      })
  }

  private publicationDirectory(): string {
    return path.join(this.deps.getUserDataPath(), ENDPOINT_DIRECTORY, 'snapshots')
  }

  async getStatus(): Promise<SyncHostServiceStatus> {
    await this.initialize()
    const snapshot = await this.snapshotSource.current()
    return {
      enabled: this.getEnabled(),
      allowWrites: this.state.snapshot().allowWrites,
      running: this.endpoint.isRunning(),
      port: this.endpoint.isRunning() ? this.endpoint.getPort() : null,
      hostId: this.getHostId(),
      deviceCount: this.devices.count(),
      hasSnapshot: snapshot !== null,
      configuredPort: this.state.snapshot().port,
      preparing: this.preparing !== null,
      tunnelConfig: this.state.snapshot().tunnel,
      hasTunnelToken: Boolean(this.state.snapshot().wrappedTunnelToken),
      tunnel: this.startError
        ? {
            phase: 'failed',
            publicUrl: this.state.snapshot().tunnel.publicUrl,
            error: this.startError
          }
        : this.state.snapshot().tunnel.mode === 'external'
          ? {
              phase: this.endpoint.isRunning() ? 'external' : 'stopped',
              publicUrl: this.state.snapshot().tunnel.publicUrl,
              error: null
            }
          : (this.tunnel?.status() ?? { phase: 'stopped', publicUrl: '', error: null }),
      publishedAt: snapshot ? (this.state.snapshot().published?.createdAt ?? null) : null
    }
  }

  /** Creates a pairing code. Host mode must be running, otherwise there is nothing to pair with. */
  createPairingCode(): SyncHostPairingCode | null {
    if (!this.endpoint.isRunning()) return null
    return this.pairing.create()
  }

  getPairingCode(): SyncHostPairingCode | null {
    return this.pairing.current()
  }

  listDevices(): SyncHostDeviceView[] {
    const allowWrites = this.state.snapshot().allowWrites
    return this.devices.list().map((device) => ({
      ...device,
      writable: allowWrites && device.writable
    }))
  }

  async revokeDevice(deviceId: string): Promise<boolean> {
    const revoked = await this.devices.revoke(deviceId)
    this.deps.replica?.revoke(deviceId)
    return revoked
  }

  renameDevice(deviceId: string, name: string): Promise<boolean> {
    return this.devices.rename(deviceId, name)
  }

  async setDeviceWritable(deviceId: string, writable: boolean): Promise<boolean> {
    if (writable && !this.state.snapshot().allowWrites) return false
    const changed = await this.devices.setWritable(deviceId, writable)
    if (changed && !writable) this.deps.replica?.revoke(deviceId)
    if (changed) this.deps.changed?.()
    return changed
  }

  getAuditEntries(): SyncHostAuditEntry[] {
    return this.endpoint.getAuditEntries()
  }

  private async startInternal(port = this.state.snapshot().port): Promise<void> {
    if (this.endpoint.isRunning()) {
      return
    }
    this.startError = null
    try {
      await this.endpoint.start({ port })
      const state = this.state.snapshot()
      if (state.tunnel.mode !== 'external') {
        if (!this.tunnel) throw new Error('sync.tunnel.error.tunnelUnavailable')
        let token: string | undefined
        if (state.tunnel.mode === 'named' && state.wrappedTunnelToken) {
          try {
            token = this.deps.revealToken?.(state.wrappedTunnelToken)
          } catch {
            throw new Error('sync.tunnel.error.credentialsUnavailable')
          }
        }
        await this.tunnel.start(state.tunnel, port, token)
      }
    } catch (error) {
      this.startError =
        error instanceof Error && error.message.startsWith('sync.')
          ? error.message
          : SYNC_HOST_BIND_FAILED_ERROR
      this.deps.logger?.warn('[SyncHost] Failed to start sharing', {
        error: error instanceof Error ? error.message : String(error)
      })
      await this.endpoint.stop()
      throw new Error(this.startError)
    }
    try {
      await this.writeEndpointDescriptor()
    } catch (error) {
      // User-managed tunnels reach the configured port without a descriptor.
      this.deps.logger?.warn('[SyncHost] Failed to write optional endpoint descriptor', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async stopInternal(): Promise<void> {
    this.startError = null
    this.pairing.clear()
    this.deps.replica?.stop()
    try {
      await this.tunnel?.stop()
    } finally {
      await this.endpoint.stop()
      await this.removeEndpointDescriptor()
      await this.state.flush()
    }
  }

  private serialize<T>(step: () => Promise<T>): Promise<T> {
    const next = this.lifecycle.then(step, step).finally(() => this.deps.changed?.())
    this.lifecycle = next.catch(() => undefined)
    return next
  }

  private descriptorPath(): string {
    return path.join(this.deps.getUserDataPath(), ENDPOINT_DIRECTORY, ENDPOINT_DESCRIPTOR_FILENAME)
  }

  /**
   * Publishes the bound loopback port so the tunnel layer can point `cloudflared` at it without
   * guessing. The file is private to the user, like every other local endpoint descriptor.
   */
  private async writeEndpointDescriptor(): Promise<void> {
    const directory = path.dirname(this.descriptorPath())
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
    const tempPath = `${this.descriptorPath()}.${randomBytes(6).toString('hex')}.tmp`
    try {
      const handle = await open(tempPath, 'wx', 0o600)
      try {
        await handle.writeFile(
          `${JSON.stringify({
            port: this.endpoint.getPort(),
            hostId: this.getHostId(),
            protocolVersion: SYNC_HOST_PROTOCOL_VERSION,
            pid: process.pid,
            startedAt: Date.now()
          })}\n`,
          'utf8'
        )
        await handle.sync()
      } finally {
        await handle.close()
      }
      await chmod(tempPath, 0o600)
      await rename(tempPath, this.descriptorPath())
    } catch (error) {
      // A failed write must not leave `.tmp` debris next to the descriptor.
      await unlink(tempPath).catch(() => undefined)
      throw error
    }
  }

  private async removeEndpointDescriptor(): Promise<void> {
    try {
      await unlink(this.descriptorPath())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
