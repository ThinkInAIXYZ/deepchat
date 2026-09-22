import { describe, expect, it, vi } from 'vitest'
import { createRendererRouteContext } from '@/routes/routeRegistry'
import {
  syncHostCreatePairingCodeRoute,
  syncHostGetAuditRoute,
  syncHostGetStatusRoute,
  syncHostListDevicesRoute,
  syncHostRenameDeviceRoute,
  syncHostRevokeDeviceRoute,
  syncHostSetEnabledRoute,
  syncHostPublishRoute
} from '@shared/contracts/routes'
import {
  SyncHostAuditEntrySchema,
  type SyncHostAuditEntry,
  type SyncHostDeviceView
} from '@shared/contracts/syncHost'
import { createSyncHostRoutes, type SyncHostRoutePort } from '@/sync/host/routes'

const STATUS = {
  enabled: true,
  running: true,
  port: 43117,
  hostId: 'host-abc',
  deviceCount: 2,
  hasSnapshot: true,
  configuredPort: 43117,
  publishedAt: 1_700_000_000_000,
  preparing: false,
  tunnelConfig: { mode: 'external' as const, publicUrl: '' },
  hasTunnelToken: false,
  tunnel: { phase: 'stopped' as const, publicUrl: '', error: null }
}

const PAIRING = {
  code: 'ABCD2345',
  hostId: 'host-abc',
  expiresAt: 1_700_000_300_000
}

const DEVICE: SyncHostDeviceView = {
  deviceId: 'device-1',
  name: 'Laptop',
  createdAt: 1_700_000_000_000,
  expiresAt: null,
  lastSeenAt: 1_700_000_100_000,
  revoked: false
}

/** Built through the contract so an evolving audit schema cannot leave the fixture malformed. */
function auditEntry(overrides: Partial<SyncHostAuditEntry> = {}): SyncHostAuditEntry {
  return SyncHostAuditEntrySchema.parse({
    at: 1_700_000_000_000,
    method: 'POST',
    path: '/sync/v1/pair',
    status: 401,
    bytes: 42,
    deviceId: null,
    clientIp: '203.0.113.9',
    suppressed: 0,
    ...overrides
  })
}

function createHostPort(overrides: Partial<SyncHostRoutePort> = {}): SyncHostRoutePort {
  return {
    publishSnapshot: vi.fn(async () => STATUS),
    getStatus: vi.fn(async () => STATUS),
    getPairingCode: vi.fn(() => null),
    setEnabled: vi.fn(async () => STATUS),
    createPairingCode: vi.fn(() => null),
    listDevices: vi.fn(() => []),
    revokeDevice: vi.fn(async () => true),
    renameDevice: vi.fn(async () => true),
    getAuditEntries: vi.fn(() => []),
    ...overrides
  }
}

const context = createRendererRouteContext(1, null)

describe('sync host routes', () => {
  it('exposes exactly the eight renderer-facing routes as handlers', () => {
    const routes = createSyncHostRoutes({ host: createHostPort() })

    expect([...routes.keys()].sort()).toEqual(
      [
        syncHostCreatePairingCodeRoute.name,
        syncHostGetAuditRoute.name,
        syncHostGetStatusRoute.name,
        syncHostListDevicesRoute.name,
        syncHostRenameDeviceRoute.name,
        syncHostRevokeDeviceRoute.name,
        syncHostPublishRoute.name,
        syncHostSetEnabledRoute.name
      ].sort()
    )
    expect(routes.size).toBe(8)
    for (const handler of routes.values()) {
      expect(typeof handler).toBe('function')
    }
  })

  it('returns the host status with the current pairing code', async () => {
    const host = createHostPort({ getPairingCode: () => PAIRING })
    const handler = createSyncHostRoutes({ host }).get(syncHostGetStatusRoute.name)!

    await expect(handler({}, context)).resolves.toEqual({ status: STATUS, pairing: PAIRING })
  })

  it('reports a null pairing when no code is outstanding', async () => {
    const host = createHostPort({ getPairingCode: () => null })
    const handler = createSyncHostRoutes({ host }).get(syncHostGetStatusRoute.name)!

    await expect(handler({}, context)).resolves.toEqual({ status: STATUS, pairing: null })
  })

  it('passes the enabled flag through and returns the resulting status', async () => {
    const setEnabled = vi.fn(async () => ({ ...STATUS, enabled: false }))
    const host = createHostPort({ setEnabled })
    const handler = createSyncHostRoutes({ host }).get(syncHostSetEnabledRoute.name)!

    await expect(handler({ enabled: false }, context)).resolves.toEqual({
      status: { ...STATUS, enabled: false }
    })
    expect(setEnabled).toHaveBeenCalledWith(false, {
      port: undefined,
      consent: undefined,
      tunnel: undefined
    })
  })

  it('surfaces a setEnabled failure instead of reporting a status', async () => {
    const host = createHostPort({
      setEnabled: async () => {
        throw new Error('sync host bind failed')
      }
    })
    const handler = createSyncHostRoutes({ host }).get(syncHostSetEnabledRoute.name)!

    await expect(handler({ enabled: true }, context)).rejects.toThrow('sync host bind failed')
  })

  it('returns the freshly created pairing code', async () => {
    const host = createHostPort({
      createPairingCode: () => PAIRING,
      getPairingCode: () => ({ ...PAIRING, code: 'STALE234' })
    })
    const handler = createSyncHostRoutes({ host }).get(syncHostCreatePairingCodeRoute.name)!

    await expect(handler({}, context)).resolves.toEqual({ pairing: PAIRING })
  })

  it('falls back to the current pairing code when creation returns null', async () => {
    const host = createHostPort({ createPairingCode: () => null, getPairingCode: () => PAIRING })
    const handler = createSyncHostRoutes({ host }).get(syncHostCreatePairingCodeRoute.name)!

    await expect(handler({}, context)).resolves.toEqual({ pairing: PAIRING })
  })

  it('lists device views without token material', async () => {
    const storedDevice = {
      ...DEVICE,
      tokenHash: 'sha256:deadbeef',
      token: 'device-token-secret'
    }
    const host = createHostPort({ listDevices: () => [storedDevice] })
    const handler = createSyncHostRoutes({ host }).get(syncHostListDevicesRoute.name)!

    const result = (await handler({}, context)) as { devices: Record<string, unknown>[] }

    expect(result.devices).toEqual([DEVICE])
    expect(Object.keys(result.devices[0])).not.toContain('tokenHash')
    expect(Object.keys(result.devices[0])).not.toContain('token')
  })

  it('passes the device id through and returns the revoke result', async () => {
    const revokeDevice = vi.fn(async () => true)
    const host = createHostPort({ revokeDevice })
    const handler = createSyncHostRoutes({ host }).get(syncHostRevokeDeviceRoute.name)!

    await expect(handler({ deviceId: DEVICE.deviceId }, context)).resolves.toEqual({
      revoked: true
    })
    expect(revokeDevice).toHaveBeenCalledWith(DEVICE.deviceId)
  })

  it('passes the device id and name through and returns the rename result', async () => {
    const renameDevice = vi.fn(async () => false)
    const host = createHostPort({ renameDevice })
    const handler = createSyncHostRoutes({ host }).get(syncHostRenameDeviceRoute.name)!

    await expect(
      handler({ deviceId: DEVICE.deviceId, name: 'Workstation' }, context)
    ).resolves.toEqual({ renamed: false })
    expect(renameDevice).toHaveBeenCalledWith(DEVICE.deviceId, 'Workstation')
  })

  it('rejects empty device ids and names at the route boundary', async () => {
    const revokeDevice = vi.fn(async () => true)
    const renameDevice = vi.fn(async () => true)
    const host = createHostPort({ revokeDevice, renameDevice })
    const routes = createSyncHostRoutes({ host })

    await expect(
      routes.get(syncHostRevokeDeviceRoute.name)!({ deviceId: '' }, context)
    ).rejects.toThrow()
    await expect(
      routes.get(syncHostRenameDeviceRoute.name)!({ deviceId: '', name: 'Workstation' }, context)
    ).rejects.toThrow()
    await expect(
      routes.get(syncHostRenameDeviceRoute.name)!({ deviceId: DEVICE.deviceId, name: '' }, context)
    ).rejects.toThrow()
    expect(revokeDevice).not.toHaveBeenCalled()
    expect(renameDevice).not.toHaveBeenCalled()
  })

  it('returns the audit entries without token or payload fields', async () => {
    const entry = auditEntry()
    const storedEntry = { ...entry, token: 'device-token-secret', payload: { code: PAIRING.code } }
    const host = createHostPort({ getAuditEntries: () => [storedEntry] })
    const handler = createSyncHostRoutes({ host }).get(syncHostGetAuditRoute.name)!

    const result = (await handler({}, context)) as { entries: Record<string, unknown>[] }

    expect(result.entries).toEqual([entry])
    expect(Object.keys(result.entries[0])).not.toContain('token')
    expect(Object.keys(result.entries[0])).not.toContain('payload')
  })
})
