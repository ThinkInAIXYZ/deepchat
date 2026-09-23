import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  SYNC_HOST_DEVICE_NAME_MAX_LENGTH,
  SYNC_HOST_DEVICE_TOKEN_BYTES,
  type SyncHostDeviceView
} from '@shared/contracts/syncHost'
import type { SyncHostDeviceRecord, SyncHostStateStore } from './state'

const LAST_SEEN_PERSIST_INTERVAL_MS = 60_000

export interface IssuedSyncHostDevice {
  device: SyncHostDeviceView
  token: string
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function toView(record: SyncHostDeviceRecord): SyncHostDeviceView {
  return {
    deviceId: record.deviceId,
    name: record.name,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    lastSeenAt: record.lastSeenAt,
    revoked: record.revokedAt !== null,
    writable: record.writable === true,
    requestedWrite: record.requestedWrite === true
  }
}

/**
 * Owns per-device bearer tokens for the sync host endpoint: issuance, authentication, revocation
 * and expiry. Records live in the machine-local host state, never in the synced settings blob, and
 * only token hashes are stored.
 */
export class SyncHostDeviceStore {
  private readonly lastSeenPersistedAt = new Map<string, number>()

  constructor(private readonly state: SyncHostStateStore) {}

  list(): SyncHostDeviceView[] {
    return this.state
      .snapshot()
      .devices.map(toView)
      .sort((left, right) => right.createdAt - left.createdAt)
  }

  count(): number {
    return this.state.snapshot().devices.length
  }

  async issue(input: {
    name: string
    expiresAt?: number | null
    now?: number
    requestedWrite?: boolean
    replicaId?: string | null
  }): Promise<IssuedSyncHostDevice> {
    if (
      input.replicaId &&
      this.state
        .snapshot()
        .devices.some((device) => device.replicaId === input.replicaId && device.revokedAt === null)
    )
      throw new Error('sync.tunnel.error.duplicateReplica')
    const now = input.now ?? Date.now()
    const token = randomBytes(SYNC_HOST_DEVICE_TOKEN_BYTES).toString('base64url')
    const record: SyncHostDeviceRecord = {
      deviceId: `dev_${randomBytes(9).toString('hex')}`,
      name: input.name.trim().slice(0, SYNC_HOST_DEVICE_NAME_MAX_LENGTH),
      tokenHash: hashToken(token),
      createdAt: now,
      lastSeenAt: null,
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
      writable: false,
      requestedWrite: input.requestedWrite === true,
      replicaId: input.replicaId ?? null
    }
    await this.state.update((state) => {
      state.devices.push(record)
    })
    return { device: toView(record), token }
  }

  /**
   * Verifies a presented bearer token. Returns the device view on success and `null` for
   * unknown, malformed, revoked or expired tokens.
   */
  authenticate(token: string, now: number = Date.now()): SyncHostDeviceView | null {
    if (!token) return null
    const presented = Buffer.from(hashToken(token), 'hex')
    for (const record of this.state.snapshot().devices) {
      const expected = Buffer.from(record.tokenHash, 'hex')
      if (presented.length !== expected.length) continue
      if (!timingSafeEqual(presented, expected)) continue
      if (record.revokedAt !== null) return null
      if (record.expiresAt !== null && record.expiresAt <= now) return null
      this.touchLastSeen(record.deviceId, now)
      return toView(record)
    }
    return null
  }

  canWrite(deviceId: string): boolean {
    return this.state
      .snapshot()
      .devices.some(
        (device) =>
          device.deviceId === deviceId &&
          device.writable === true &&
          device.revokedAt === null &&
          (device.expiresAt === null || device.expiresAt > Date.now())
      )
  }

  replicaId(deviceId: string): string | null {
    return (
      this.state.snapshot().devices.find((device) => device.deviceId === deviceId)?.replicaId ??
      null
    )
  }

  async setWritable(deviceId: string, writable: boolean): Promise<boolean> {
    let changed = false
    await this.state.update((state) => {
      const target = state.devices.find((device) => device.deviceId === deviceId)
      if (!target || target.revokedAt !== null || !target.requestedWrite || !target.replicaId)
        return
      if (target.writable === writable) return
      target.writable = writable
      changed = true
    })
    return changed
  }

  async revoke(deviceId: string, now: number = Date.now()): Promise<boolean> {
    let revoked = false
    await this.state.update((state) => {
      const target = state.devices.find((record) => record.deviceId === deviceId)
      if (!target || target.revokedAt !== null) return
      target.revokedAt = now
      revoked = true
    })
    return revoked
  }

  async rename(deviceId: string, name: string): Promise<boolean> {
    const next = name.trim().slice(0, SYNC_HOST_DEVICE_NAME_MAX_LENGTH)
    if (!next) return false
    let renamed = false
    await this.state.update((state) => {
      const target = state.devices.find((record) => record.deviceId === deviceId)
      if (!target) return
      target.name = next
      renamed = true
    })
    return renamed
  }

  private touchLastSeen(deviceId: string, now: number): void {
    const lastPersisted = this.lastSeenPersistedAt.get(deviceId) ?? 0
    if (now - lastPersisted < LAST_SEEN_PERSIST_INTERVAL_MS) return
    this.lastSeenPersistedAt.set(deviceId, now)
    // Fire-and-forget: a failed last-seen write must never fail an authorized request.
    void this.state
      .update((state) => {
        const target = state.devices.find((record) => record.deviceId === deviceId)
        if (target) target.lastSeenAt = now
      })
      .catch(() => undefined)
  }
}
