import { beforeEach, describe, expect, it, vi } from 'vitest'

const publishDeepchatEvent = vi.hoisted(() => vi.fn())

import { SyncSettings } from '@/sync/settings'
import { SecretStore } from '@/config/secretStore'

function createSettings(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    get: vi.fn((key: string) => values.get(key)),
    set: vi.fn((key: string, value: unknown) => values.set(key, value)),
    delete: vi.fn((key: string) => values.delete(key))
  }
}

describe('SyncSettings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the supplied home root until an explicit sync folder is selected', () => {
    const settings = createSettings()
    const service = new SyncSettings(
      settings as never,
      {} as never,
      publishDeepchatEvent,
      '/home/test'
    )
    expect(service.getFolderPath()).toMatch(/[/\\]home[/\\]test[/\\]DeepchatSync$/)
    service.setFolderPath('/selected/sync')
    expect(service.getFolderPath()).toBe('/selected/sync')
  })

  it('owns local sync settings and publishes their current state', () => {
    const settings = createSettings({ syncFolderPath: '/sync' })
    const secrets = { get: vi.fn(() => ''), isAvailable: vi.fn(() => true) }
    const syncSettings = new SyncSettings(
      settings as never,
      secrets as never,
      publishDeepchatEvent,
      '/home/test'
    )

    syncSettings.setEnabled(true)

    expect(settings.values.get('syncEnabled')).toBe(true)
    expect(publishDeepchatEvent).toHaveBeenCalledWith('config.syncSettings.changed', {
      enabled: true,
      folderPath: '/sync',
      version: expect.any(Number)
    })
  })

  it('restores the previous wrapped secret when writing cloud settings fails', async () => {
    const settings = createSettings()
    settings.set.mockImplementationOnce(() => {
      throw new Error('write failed')
    })
    const secrets = {
      captureOperation: () => () => {},
      getWrapped: vi.fn(() => 'old-wrapped'),
      wrap: vi.fn(async () => 'new-wrapped'),
      setWrapped: vi.fn(),
      restoreWrapped: vi.fn(),
      get: vi.fn(() => 'secret'),
      isAvailable: vi.fn(() => true)
    }
    const syncSettings = new SyncSettings(
      settings as never,
      secrets as never,
      publishDeepchatEvent,
      '/home/test'
    )

    await expect(syncSettings.setCloudConfig({ secretAccessKey: 'new-secret' })).rejects.toThrow(
      'write failed'
    )
    expect(secrets.restoreWrapped).toHaveBeenCalledWith('cloudSyncSecret', 'old-wrapped')
  })

  it('serializes cloud updates across native encryption without losing unrelated fields', async () => {
    const settings = createSettings()
    const pending = Promise.withResolvers<string>()
    const encrypt = vi.fn(() => pending.promise)
    const secrets = new SecretStore(settings as never, {
      isAvailable: async () => true,
      encrypt,
      decrypt: async (wrapped) => wrapped.slice('wrapped:'.length)
    })
    const service = new SyncSettings(settings as never, secrets, publishDeepchatEvent, '/home/test')
    const first = service.setCloudConfig({
      endpoint: 'https://cloud.example',
      accessKeyId: 'access',
      secretAccessKey: 'key'
    })
    const second = service.setCloudConfig({ bucket: 'backups' })
    await vi.waitFor(() => expect(encrypt).toHaveBeenCalledOnce())
    expect(settings.values.size).toBe(0)
    pending.resolve('wrapped:key')
    await first
    expect(await second).toMatchObject({
      endpoint: 'https://cloud.example',
      bucket: 'backups',
      hasSecret: true
    })
    expect(await service.getResolvedCloudConfig()).toMatchObject({
      endpoint: 'https://cloud.example',
      bucket: 'backups',
      accessKeyId: 'access',
      secretAccessKey: 'key'
    })
    expect(settings.values.get('cloudSyncSecret')).toBe('wrapped:key')
  })

  it('fences both pending and queued cloud writes when maintenance changes the profile', async () => {
    const settings = createSettings()
    const pending = Promise.withResolvers<string>()
    const encrypt = vi.fn(() => pending.promise)
    const secrets = new SecretStore(settings as never, {
      isAvailable: async () => true,
      encrypt,
      decrypt: async () => ''
    })
    const service = new SyncSettings(settings as never, secrets, publishDeepchatEvent, '/home/test')
    const first = expect(service.setCloudConfig({ secretAccessKey: 'key' })).rejects.toThrow(
      'interrupted'
    )
    const second = expect(service.setCloudConfig({ bucket: 'stale' })).rejects.toThrow(
      'interrupted'
    )
    await vi.waitFor(() => expect(encrypt).toHaveBeenCalledOnce())
    secrets.pause()
    secrets.resume()
    pending.resolve('wrapped:key')
    await Promise.all([first, second])
    expect(settings.values.size).toBe(0)
    expect(await service.setCloudConfig({ bucket: 'current' })).toMatchObject({ bucket: 'current' })
  })

  it('rechecks the owner immediately before publishing an already wrapped secret', async () => {
    const settings = createSettings()
    const secrets = new SecretStore(settings as never, {
      isAvailable: async () => true,
      encrypt: async () => 'wrapped:key',
      decrypt: async () => ''
    })
    const wrap = secrets.wrap.bind(secrets)
    vi.spyOn(secrets, 'wrap').mockImplementation(async (value) => {
      const wrapped = await wrap(value)
      secrets.pause()
      secrets.resume()
      return wrapped
    })
    const service = new SyncSettings(settings as never, secrets, publishDeepchatEvent, '/home/test')
    await expect(service.setCloudConfig({ secretAccessKey: 'key' })).rejects.toThrow('interrupted')
    expect(settings.values.size).toBe(0)
  })
})
