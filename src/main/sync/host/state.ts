import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  SyncTunnelConfigSchema,
  type SyncTunnelConfig
} from '@shared/contracts/routes/syncHost.routes'
import type { SyncBackupInfo } from '@shared/types/sync'

const STATE_FILENAME = 'host-state.json'

export interface SyncHostDeviceRecord {
  deviceId: string
  name: string
  /** SHA-256 of the device bearer token. The token itself is never persisted. */
  tokenHash: string
  createdAt: number
  lastSeenAt: number | null
  expiresAt: number | null
  revokedAt: number | null
  writable?: boolean
}

export interface SyncHostState {
  enabled: boolean
  allowWrites: boolean
  port: number
  consentAt: number | null
  consentVersion: number
  published: SyncBackupInfo | null
  tunnel: SyncTunnelConfig
  wrappedTunnelToken: string | null
  hostId: string | null
  devices: SyncHostDeviceRecord[]
}

const DEFAULT_STATE: SyncHostState = {
  enabled: false,
  allowWrites: false,
  port: 0,
  consentAt: null,
  consentVersion: 0,
  published: null,
  tunnel: { mode: 'external', publicUrl: '' },
  wrappedTunnelToken: null,
  hostId: null,
  devices: []
}

/**
 * Machine-local state for host mode, stored as a private file instead of a settings key.
 *
 * This is deliberate. Settings flow into backup packages (`configs/app-settings.json`), into
 * S3/R2 uploads, and into every peer that imports a package, and import merges settings wholesale.
 * Device token hashes, the host identity and the enabled flag must never travel: an imported copy
 * would let an importer accept another host's device tokens, resurrect revoked devices, and enable
 * host mode without the user's consent. Keeping them in their own file removes that path entirely.
 *
 * Reads are served from an in-memory cache so request-time authentication stays synchronous; writes
 * are serialized, atomic (temp + rename), and `0600`.
 */
export class SyncHostStateStore {
  private state: SyncHostState = { ...DEFAULT_STATE }
  private loaded = false
  private loadChain: Promise<SyncHostState> | null = null
  /**
   * Serializes whole update transactions — load, snapshot, mutation, write, rollback — not just the
   * filesystem writes. Serializing writes alone is not enough: a second update could snapshot the
   * first one's mutation before it failed, which would both block the rollback and persist the
   * change whose caller was told it failed.
   */
  private updateChain: Promise<void> = Promise.resolve()

  constructor(private readonly directory: string) {}

  get filePath(): string {
    return path.join(this.directory, STATE_FILENAME)
  }

  /**
   * Reads state from disk once. Concurrent callers share the same read.
   */
  async load(): Promise<SyncHostState> {
    if (this.loaded) return this.snapshot()
    if (!this.loadChain) this.loadChain = this.loadFromDisk()
    return this.loadChain
  }

  private async loadFromDisk(): Promise<SyncHostState> {
    let parsed: unknown = null
    try {
      parsed = JSON.parse(await fs.promises.readFile(this.filePath, 'utf8')) as unknown
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        // A read or parse failure must never degrade to the empty default state: `initialize()`
        // would then persist that default over a file that still holds every device record and the
        // enabled flag, destroying pairing because of a transient EACCES/EIO/AV lock. Fail closed,
        // keep `loaded` false, and let the next call retry.
        this.loadChain = null
        throw error
      }
    }
    this.state = this.normalize(parsed)
    this.loaded = true
    return this.snapshot()
  }

  isLoaded(): boolean {
    return this.loaded
  }

  snapshot(): SyncHostState {
    return {
      ...this.state,
      tunnel: { ...this.state.tunnel },
      devices: this.state.devices.map((record) => ({ ...record }))
    }
  }

  /**
   * Applies a mutation to the cached state and persists it atomically.
   *
   * Loading first is not an optimisation, it is a correctness requirement: a mutation that arrives
   * before the initial read (a renderer call landing between route registration and app boot) would
   * otherwise persist the empty default state over the real file, discarding every device record
   * and the enabled flag.
   */
  async update(mutator: (state: SyncHostState) => void): Promise<void> {
    const update = this.updateChain.then(async () => {
      if (!this.loaded) await this.load()
      const previous = this.state
      const next = this.snapshot()
      mutator(next)
      this.state = next
      try {
        // The caller must see write failures: a revocation that silently failed to persist would
        // come back to life after a restart.
        await this.writeAtomic(`${JSON.stringify(next, null, 2)}\n`)
      } catch (error) {
        // Roll the cache back: memory must never claim a change that is not on disk, or a later
        // successful write (a last-seen touch, a rename) would silently persist a mutation whose
        // caller was told it failed. Safe unconditionally because updates are serialized.
        this.state = previous
        throw error
      }
    })
    // Keep the chain usable after a rejection while still surfacing the failure to this caller.
    this.updateChain = update.catch(() => undefined)
    return update
  }

  /** Resolves once every queued update has settled; used by teardown and tests. */
  async flush(): Promise<void> {
    await this.updateChain
  }

  private async writeAtomic(payload: string): Promise<void> {
    await fs.promises.mkdir(this.directory, { recursive: true, mode: 0o700 })
    try {
      await fs.promises.chmod(this.directory, 0o700)
    } catch {
      // Best effort: the directory may live on a filesystem without POSIX modes.
    }
    const tempPath = `${this.filePath}.${randomBytes(6).toString('hex')}.tmp`
    try {
      const handle = await fs.promises.open(tempPath, 'wx', 0o600)
      try {
        await handle.writeFile(payload, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await fs.promises.chmod(tempPath, 0o600)
      await fs.promises.rename(tempPath, this.filePath)
    } catch (error) {
      // A failed write must not leave `.tmp` debris next to the state file.
      await fs.promises.rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private normalize(parsed: unknown): SyncHostState {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_STATE }
    const record = parsed as Partial<SyncHostState>
    return {
      enabled: record.enabled === true,
      allowWrites: record.allowWrites === true,
      tunnel: SyncTunnelConfigSchema.safeParse(record.tunnel).data ?? {
        mode: 'external',
        publicUrl: ''
      },
      wrappedTunnelToken:
        typeof record.wrappedTunnelToken === 'string' ? record.wrappedTunnelToken : null,
      port:
        Number.isInteger(record.port) && record.port! >= 1 && record.port! <= 65535
          ? record.port!
          : 0,
      consentVersion: record.consentVersion === 2 ? 2 : 0,
      consentAt: typeof record.consentAt === 'number' ? record.consentAt : null,
      published:
        record.published &&
        /^backup-\d+\.zip$/.test(record.published.fileName) &&
        Number.isFinite(record.published.createdAt) &&
        Number.isFinite(record.published.size)
          ? record.published
          : null,
      hostId: typeof record.hostId === 'string' && record.hostId.length > 0 ? record.hostId : null,
      devices: Array.isArray(record.devices)
        ? record.devices.filter(
            (device): device is SyncHostDeviceRecord =>
              Boolean(device) &&
              typeof device.deviceId === 'string' &&
              typeof device.name === 'string' &&
              typeof device.tokenHash === 'string' &&
              typeof device.createdAt === 'number'
          )
        : []
    }
  }
}
