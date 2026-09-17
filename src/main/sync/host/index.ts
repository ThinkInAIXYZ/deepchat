import { randomBytes } from 'node:crypto'
import { chmod, mkdir, open, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import {
  SYNC_HOST_BIND_FAILED_ERROR,
  SYNC_HOST_PROTOCOL_VERSION,
  type SyncHostAuditEntry,
  type SyncHostDeviceView
} from '@shared/contracts/syncHost'
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
  running: boolean
  port: number | null
  hostId: string
  deviceCount: number
  hasSnapshot: boolean
}

export interface SyncHostServiceDeps {
  listBackups: () => Promise<SyncBackupInfo[]>
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
  private lifecycle: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: SyncHostServiceDeps) {
    this.state = new SyncHostStateStore(path.join(deps.getUserDataPath(), ENDPOINT_DIRECTORY))
    this.devices = new SyncHostDeviceStore(this.state)
    this.pairing = new SyncHostPairingAuthority(() => this.getHostId())
    this.snapshotSource = new SyncHostSnapshotSource({
      listBackups: deps.listBackups,
      getFolderPath: deps.getFolderPath
    })
    this.endpoint = new SyncHostEndpoint({
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
      if (!this.state.snapshot().hostId) {
        await this.state.update((state) => {
          state.hostId = randomBytes(16).toString('hex')
        })
      }
    })
  }

  getEnabled(): boolean {
    return this.state.snapshot().enabled
  }

  getHostId(): string {
    const existing = this.state.snapshot().hostId
    if (existing) return existing
    // Before `initialize()` completes there is no persisted identity yet; generate one in memory so
    // the handshake and pairing authority never observe an empty value, then persist it.
    const created = randomBytes(16).toString('hex')
    void this.state
      .update((state) => {
        state.hostId = state.hostId ?? created
      })
      .catch(() => undefined)
    return created
  }

  async setEnabled(enabled: boolean): Promise<SyncHostServiceStatus> {
    await this.serialize(async () => {
      if (enabled) {
        // Start before persisting so a failed bind never leaves host mode marked enabled without a
        // listener, and roll the listener back if the flag itself cannot be written.
        await this.startInternal()
        try {
          await this.state.update((state) => {
            state.enabled = true
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
    await this.initialize()
    if (!this.getEnabled()) return
    await this.serialize(async () => {
      await this.startInternal()
      try {
        await this.state.update((state) => {
          state.enabled = true
        })
      } catch (error) {
        await this.stopInternal()
        throw error
      }
    })
  }

  async getStatus(): Promise<SyncHostServiceStatus> {
    const snapshot = await this.snapshotSource.current()
    return {
      enabled: this.getEnabled(),
      running: this.endpoint.isRunning(),
      port: this.endpoint.isRunning() ? this.endpoint.getPort() : null,
      hostId: this.getHostId(),
      deviceCount: this.devices.count(),
      hasSnapshot: snapshot !== null
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
    return this.devices.list()
  }

  revokeDevice(deviceId: string): Promise<boolean> {
    return this.devices.revoke(deviceId)
  }

  renameDevice(deviceId: string, name: string): Promise<boolean> {
    return this.devices.rename(deviceId, name)
  }

  getAuditEntries(): SyncHostAuditEntry[] {
    return this.endpoint.getAuditEntries()
  }

  private async startInternal(): Promise<void> {
    if (this.endpoint.isRunning()) {
      // The descriptor may be missing if a previous write failed; rewrite it before returning.
      await this.writeEndpointDescriptor()
      return
    }
    try {
      await this.endpoint.start()
    } catch (error) {
      this.deps.logger?.warn('[SyncHost] Failed to bind endpoint', {
        error: error instanceof Error ? error.message : String(error)
      })
      throw new Error(SYNC_HOST_BIND_FAILED_ERROR)
    }
    try {
      await this.writeEndpointDescriptor()
    } catch (error) {
      // A listener without a descriptor is unreachable by the tunnel and must not survive.
      await this.endpoint.stop()
      throw error
    }
  }

  private async stopInternal(): Promise<void> {
    this.pairing.clear()
    await this.endpoint.stop()
    await this.removeEndpointDescriptor()
    await this.state.flush()
  }

  private serialize<T>(step: () => Promise<T>): Promise<T> {
    const next = this.lifecycle.then(step, step)
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
  }

  private async removeEndpointDescriptor(): Promise<void> {
    try {
      await unlink(this.descriptorPath())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
