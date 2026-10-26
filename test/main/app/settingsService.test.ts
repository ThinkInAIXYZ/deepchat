import { describe, expect, it, vi } from 'vitest'
import { AppSettingsService } from '@/app/settingsService'
import { DesktopSettings } from '@/desktop/settings'
import { FontSettings } from '@/desktop/fontSettings'
import { SETTINGS_KEYS } from '@shared/contracts/routes'

vi.mock('electron', () => ({
  app: { getLoginItemSettings: () => ({ openAtLogin: false }) }
}))

function setup() {
  const stored = new Map<string, unknown>([['cloudSyncSecret', 'wrapped-secret']])
  const storage = {
    get: (key: string) => stored.get(key),
    set: vi.fn((key: string, value: unknown) => {
      stored.set(key, value)
    })
  }
  const publishEvent = vi.fn()
  const desktopSettings = new DesktopSettings(
    storage as never,
    { refreshLanguage: vi.fn(), refreshTheme: vi.fn() },
    publishEvent
  )
  let version = 0
  let active = true
  const owner = new AppSettingsService({
    desktopSettings,
    fonts: new FontSettings(storage as never, publishEvent),
    agentDefaults: {
      getAutoCompactionEnabled: () => true,
      getAutoCompactionTriggerThreshold: () => 80,
      getAutoCompactionRetainRecentPairs: () => 2
    } as never,
    privacy: { isEnabled: () => true } as never,
    traceSettings: { isEnabled: () => false } as never,
    logging: { getEnabled: () => false } as never,
    ocr: { getAutomaticExtractionEnabled: () => true, getBackend: () => 'auto' } as never,
    applyContentProtection: vi.fn(),
    recordActivity: vi.fn(),
    publishEvent,
    nextVersion: () => ++version,
    assertActive: () => {
      if (!active) throw new Error('owner unavailable')
    }
  })
  return {
    owner,
    stored,
    storage,
    publishEvent,
    fence: () => {
      active = false
    }
  }
}

describe('AppSettingsService', () => {
  it('returns an allowlisted serializable snapshot and normalized mutation values', async () => {
    const { owner, publishEvent } = setup()
    const snapshot = await owner.getSnapshot()
    expect(Object.keys(snapshot.values).sort()).toEqual([...SETTINGS_KEYS].sort())
    expect(JSON.stringify(snapshot)).not.toContain('wrapped-secret')
    expect(structuredClone(snapshot)).toEqual(snapshot)

    const updated = await owner.update([{ key: 'fontFamily', value: '  Fixture; Font  ' }])
    expect(updated).toMatchObject({
      changedKeys: ['fontFamily'],
      values: { fontFamily: 'Fixture Font' }
    })
    expect(updated.version).toBeGreaterThan(snapshot.version)
    expect((await owner.getSnapshot(['fontFamily'])).values).toEqual(updated.values)
    owner.publishSnapshot()
    expect(publishEvent).toHaveBeenLastCalledWith('settings.changed', {
      changedKeys: [...SETTINGS_KEYS],
      version: expect.any(Number),
      values: (await owner.getSnapshot()).values
    })
  })

  it('returns the native owner previous value only after the mutation succeeds', async () => {
    const { owner, stored } = setup()
    expect(
      await owner.applyDisplayChange({ id: 'copyWithCotEnabled', value: false })
    ).toMatchObject({
      ok: true,
      id: 'copyWithCotEnabled',
      previousValue: true,
      value: false
    })
    expect(stored.get('copyWithCotEnabled')).toBe(false)
    expect(await owner.applyDisplayChange({ id: 'copyWithCotEnabled', value: true })).toMatchObject(
      {
        previousValue: false,
        value: true
      }
    )
  })

  it('rejects invalid and fenced commands before native writes', async () => {
    const { owner, storage, fence } = setup()
    await expect(
      owner.applyDisplayChange({ id: 'fontSizeLevel', value: 5 } as never)
    ).rejects.toThrow()
    await expect(
      owner.applyDisplayChange({ id: 'theme', value: 'light', extra: true } as never)
    ).rejects.toThrow()
    fence()
    await expect(
      owner.applyDisplayChange({ id: 'copyWithCotEnabled', value: false })
    ).rejects.toThrow('owner unavailable')
    await expect(owner.update([{ key: 'fontSizeLevel', value: 2 }])).rejects.toThrow(
      'owner unavailable'
    )
    await expect(owner.getSnapshot()).rejects.toThrow('owner unavailable')
    expect(() => owner.publishSnapshot()).toThrow('owner unavailable')
    expect(storage.set).not.toHaveBeenCalled()
  })

  it('does not acknowledge or publish a failed persistent mutation', async () => {
    const { owner, storage, publishEvent } = setup()
    storage.set.mockImplementationOnce(() => {
      throw new Error('storage unavailable')
    })
    await expect(
      owner.applyDisplayChange({ id: 'copyWithCotEnabled', value: false })
    ).rejects.toThrow('storage unavailable')
    expect(publishEvent).not.toHaveBeenCalled()
    expect((await owner.getSnapshot(['copyWithCotEnabled'])).values.copyWithCotEnabled).toBe(true)
  })
})
