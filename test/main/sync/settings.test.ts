import { beforeEach, describe, expect, it, vi } from 'vitest'

const publishDeepchatEvent = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/home/test') }
}))

import { SyncSettings } from '@/sync/settings'

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

  it('owns local sync settings and publishes their current state', () => {
    const settings = createSettings({ syncFolderPath: '/sync' })
    const secrets = { get: vi.fn(() => ''), isAvailable: vi.fn(() => true) }
    const syncSettings = new SyncSettings(settings as never, secrets as never, publishDeepchatEvent)

    syncSettings.setEnabled(true)

    expect(settings.values.get('syncEnabled')).toBe(true)
    expect(publishDeepchatEvent).toHaveBeenCalledWith('config.syncSettings.changed', {
      enabled: true,
      folderPath: '/sync',
      version: expect.any(Number)
    })
  })

  it('restores the previous wrapped secret when writing cloud settings fails', () => {
    const settings = createSettings()
    settings.set.mockImplementationOnce(() => {
      throw new Error('write failed')
    })
    const secrets = {
      getWrapped: vi.fn(() => 'old-wrapped'),
      wrap: vi.fn(() => 'new-wrapped'),
      setWrapped: vi.fn(),
      restoreWrapped: vi.fn(),
      get: vi.fn(() => 'secret'),
      isAvailable: vi.fn(() => true)
    }
    const syncSettings = new SyncSettings(settings as never, secrets as never, publishDeepchatEvent)

    expect(() => syncSettings.setCloudConfig({ secretAccessKey: 'new-secret' })).toThrow(
      'write failed'
    )
    expect(secrets.restoreWrapped).toHaveBeenCalledWith('cloudSyncSecret', 'old-wrapped')
  })
})
