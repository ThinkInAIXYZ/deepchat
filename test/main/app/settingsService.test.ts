import { describe, expect, it, vi } from 'vitest'
import { AppSettingsService } from '@/app/settingsService'
import { DesktopSettings } from '@/desktop/settings'
import { FontSettings } from '@/desktop/fontSettings'
import { LoggingService } from '@/app/logging'
import { UpdateSettings } from '@/upgrade/settings'
import { SETTINGS_KEYS } from '@shared/contracts/routes'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup() {
  const stored = new Map<string, unknown>([['cloudSyncSecret', 'wrapped-secret']])
  const storage = {
    get: (key: string) => stored.get(key),
    set: vi.fn((key: string, value: unknown) => {
      stored.set(key, value)
    })
  }
  const publishEvent = vi.fn()
  let theme: 'system' | 'dark' | 'light' = 'system'
  const host = {
    systemLocale: 'en-US',
    readTheme: vi.fn(async () => ({
      theme,
      isDark: theme === 'dark'
    })),
    applyTheme: vi.fn(async (value: 'system' | 'dark' | 'light') => {
      theme = value
      return theme === 'dark'
    }),
    refreshLanguage: vi.fn(async (_locale: string): Promise<void> => undefined),
    refreshTheme: vi.fn(async (_isDark: boolean): Promise<void> => undefined),
    readLaunchAtLogin: vi.fn(async () => false),
    setLaunchAtLogin: vi.fn(async (_enabled: boolean) => false),
    applyContentProtection: vi.fn(async (_enabled: boolean): Promise<void> => undefined),
    applyFloatingButtonEnabled: vi.fn(async (_enabled: boolean): Promise<void> => undefined)
  }
  let owner!: AppSettingsService
  const nativeSnapshots = vi.fn()
  const committed = () => owner.publishNativeSnapshot()
  const desktopSettings = new DesktopSettings(storage as never, host, publishEvent, committed)
  const enumerateFonts = vi.fn(async (): Promise<string[]> => [])
  const loggingHost = {
    applyLogging: vi.fn(async (_enabled: boolean): Promise<void> => undefined),
    openLoggingFolder: vi.fn(async (): Promise<void> => undefined)
  }
  let version = 0
  let active = true
  owner = new AppSettingsService({
    ownerId: 'settings-owner',
    updateSettings: new UpdateSettings(storage as never, '1.1.4-beta.7'),
    publishNativeSnapshot: nativeSnapshots,
    desktopSettings,
    fonts: new FontSettings(storage as never, publishEvent, enumerateFonts),
    agentDefaults: {
      getAutoCompactionEnabled: () => true,
      getAutoCompactionTriggerThreshold: () => 80,
      getAutoCompactionRetainRecentPairs: () => 2
    } as never,
    privacy: { isEnabled: () => true } as never,
    traceSettings: { isEnabled: () => false } as never,
    logging: new LoggingService(storage as never, loggingHost, publishEvent, committed),
    ocr: { getAutomaticExtractionEnabled: () => true, getBackend: () => 'auto' } as never,
    recordActivity: vi.fn(),
    publishEvent,
    nextVersion: () => ++version,
    assertActive: () => {
      if (!active) throw new Error('owner unavailable')
    }
  })
  return {
    owner,
    nativeSnapshots,
    host,
    loggingHost,
    enumerateFonts,
    stored,
    storage,
    publishEvent,
    fence: () => {
      active = false
    }
  }
}

describe('AppSettingsService', () => {
  it('serializes floating presentation effects before acknowledging each change', async () => {
    const { owner, host, stored } = setup()
    const pending = Promise.withResolvers<void>()
    host.applyFloatingButtonEnabled.mockReturnValueOnce(pending.promise)
    const first = owner.setFloatingButtonEnabled(true)
    await vi.waitFor(() => expect(host.applyFloatingButtonEnabled).toHaveBeenCalledOnce())
    const second = owner.setFloatingButtonEnabled(false)
    await Promise.resolve()
    expect(stored.get('floatingButtonEnabled')).toBe(true)
    pending.resolve()
    expect(await first).toBe(true)
    expect(await second).toBe(false)
    expect(host.applyFloatingButtonEnabled.mock.calls).toEqual([[true], [false]])
    await owner.stop()
  })

  it('does not finish stopping while native floating presentation is pending', async () => {
    const { owner, host } = setup()
    const pending = Promise.withResolvers<void>()
    host.applyFloatingButtonEnabled.mockReturnValueOnce(pending.promise)
    const enabling = owner.setFloatingButtonEnabled(true)
    await vi.waitFor(() => expect(host.applyFloatingButtonEnabled).toHaveBeenCalledOnce())
    let stopped = false
    const stopping = owner.stop().then(() => {
      stopped = true
    })
    await Promise.resolve()
    expect(stopped).toBe(false)
    await expect(owner.setFloatingButtonEnabled(false)).rejects.toThrow('stopped')
    pending.resolve()
    await enabling
    await stopping
    expect(stopped).toBe(true)
  })

  it('publishes allowlisted native state at commit before ordinary settings events', async () => {
    const { owner, nativeSnapshots, publishEvent, stored } = setup()
    stored.set('shortcutKey', { privateToken: 'unexpected-secret' })
    stored.set('floatingButtonBounds', {
      x: 1,
      y: 2,
      dockSide: 'left',
      secret: 'unexpected-secret'
    })
    await owner.update([{ key: 'notificationsEnabled', value: false }])
    const committed = nativeSnapshots.mock.calls.at(-1)![0]
    expect(committed).toMatchObject({
      ownerId: 'settings-owner',
      notificationsEnabled: false,
      updateChannel: 'beta'
    })
    expect(JSON.stringify(committed)).not.toContain('wrapped-secret')
    expect(JSON.stringify(committed)).not.toContain('unexpected-secret')
    expect(nativeSnapshots.mock.invocationCallOrder[0]).toBeLessThan(
      publishEvent.mock.invocationCallOrder[0]
    )
    await owner.setFloatingButtonBounds({ x: 20, y: 30, dockSide: 'right' })
    expect(nativeSnapshots.mock.calls.at(-1)![0].floatingButtonBounds).toEqual(
      stored.get('floatingButtonBounds')
    )
    expect(await owner.setUpdateChannel('stable')).toBe('stable')
    expect(nativeSnapshots.mock.calls.at(-1)![0].updateChannel).toBe('stable')
    await expect(owner.setFloatingButtonBounds({ x: NaN, y: 0, dockSide: 'left' })).rejects.toThrow(
      'Invalid floating bounds'
    )
    await owner.stop()
    await expect(owner.setFloatingButtonBounds({ x: 0, y: 0, dockSide: 'left' })).rejects.toThrow(
      'stopped'
    )
  })

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
    await owner.publishSnapshot()
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
    await expect(owner.publishSnapshot()).rejects.toThrow('owner unavailable')
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

  it('orders native acknowledgements, display receipts and following snapshots together', async () => {
    const { owner, host, publishEvent } = setup()
    const refreshing = deferred<void>()
    host.refreshTheme.mockReturnValueOnce(refreshing.promise)
    const first = owner.setTheme('dark')
    await vi.waitFor(() => expect(host.refreshTheme).toHaveBeenCalledWith(true))
    const display = owner.applyDisplayChange({ id: 'theme', value: 'light' })
    const snapshot = owner.getTheme()
    expect(publishEvent).not.toHaveBeenCalled()
    refreshing.resolve()
    expect(await first).toEqual({ theme: 'dark', isDark: true })
    expect(await display).toMatchObject({ previousValue: 'dark', value: 'light' })
    expect(await snapshot).toEqual({ theme: 'light', isDark: false })
  })

  it('awaits normalized language refresh and recovers after a failed native command', async () => {
    const { owner, host, publishEvent, stored } = setup()
    const refreshing = deferred<void>()
    host.refreshLanguage.mockReturnValueOnce(refreshing.promise)
    const changed = owner.setLanguage('fa')
    await vi.waitFor(() => expect(host.refreshLanguage).toHaveBeenCalledWith('fa-IR'))
    expect(publishEvent).not.toHaveBeenCalled()
    refreshing.resolve()
    expect(await changed).toEqual({ requestedLanguage: 'fa-IR', locale: 'fa-IR', direction: 'rtl' })
    publishEvent.mockClear()
    host.applyTheme.mockRejectedValueOnce(new Error('native unavailable'))
    await expect(owner.setTheme('dark')).rejects.toThrow('native unavailable')
    expect(stored.has('appTheme')).toBe(false)
    expect(publishEvent).not.toHaveBeenCalled()
    expect(await owner.setTheme('light')).toEqual({ theme: 'light', isDark: false })
  })

  it('queries login state only when selected and returns the observed OS value', async () => {
    const { owner, host, stored, publishEvent } = setup()
    await owner.getSnapshot(['autoScrollEnabled'])
    await owner.update([{ key: 'fontSizeLevel', value: 2 }])
    expect(host.readLaunchAtLogin).not.toHaveBeenCalled()
    expect((await owner.getSnapshot(['launchAtLoginEnabled'])).values).toEqual({
      launchAtLoginEnabled: false
    })
    expect((await owner.update([{ key: 'launchAtLoginEnabled', value: true }])).values).toEqual({
      launchAtLoginEnabled: false
    })
    expect(host.setLaunchAtLogin).toHaveBeenCalledWith(true)
    expect(stored.has('launchAtLoginEnabled')).toBe(false)
    expect(publishEvent).toHaveBeenLastCalledWith(
      'settings.changed',
      expect.objectContaining({ values: { launchAtLoginEnabled: false } })
    )
  })

  it('fences queued commands and drains active host work before restart', async () => {
    const { owner, host, stored } = setup()
    const refreshing = deferred<void>()
    host.refreshTheme.mockReturnValueOnce(refreshing.promise)
    const started = owner.setTheme('dark')
    await vi.waitFor(() => expect(host.refreshTheme).toHaveBeenCalled())
    const queued = owner.update([{ key: 'fontSizeLevel', value: 3 }])
    const queuedRejected = expect(queued).rejects.toThrow('Settings owner is stopped')
    let drained = false
    const stopping = owner.stop().then(() => {
      drained = true
    })
    await expect(owner.getTheme()).rejects.toThrow('Settings owner is stopped')
    await expect(owner.observeSystemTheme()).rejects.toThrow('Settings owner is stopped')
    expect(() => owner.start()).toThrow('still draining')
    expect(drained).toBe(false)
    refreshing.resolve()
    await started
    await queuedRejected
    await stopping
    expect(stored.has('fontSizeLevel')).toBe(false)
    owner.start()
    expect((await owner.update([{ key: 'fontSizeLevel', value: 2 }])).values).toEqual({
      fontSizeLevel: 2
    })
  })

  it('does not release or restart an owner whose native drain timed out', async () => {
    const { owner, host } = setup()
    const refreshing = deferred<void>()
    host.refreshTheme.mockReturnValueOnce(refreshing.promise)
    const started = owner.setTheme('dark')
    await vi.waitFor(() => expect(host.refreshTheme).toHaveBeenCalled())
    vi.useFakeTimers()
    try {
      const stopped = expect(owner.stop()).rejects.toThrow('did not drain')
      await vi.advanceTimersByTimeAsync(30_000)
      await stopped
      expect(() => owner.start()).toThrow('still draining')
      refreshing.resolve()
      await started
      await owner.stop()
      owner.start()
      expect(await owner.getTheme()).toEqual({ theme: 'dark', isDark: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds pending commands while a native observation is blocked', async () => {
    const { owner, host } = setup()
    const login = deferred<boolean>()
    host.readLaunchAtLogin.mockReturnValueOnce(login.promise)
    const snapshot = owner.getSnapshot()
    await vi.waitFor(() => expect(host.readLaunchAtLogin).toHaveBeenCalled())
    const changes = Array.from({ length: 63 }, (_, index) =>
      owner.update([{ key: 'fontSizeLevel', value: (index % 4) + 1 }])
    )
    await expect(owner.update([{ key: 'fontSizeLevel', value: 1 }])).rejects.toThrow(
      'queue is full'
    )
    const observations = Array.from({ length: 100 }, () => owner.observeSystemTheme())
    login.resolve(false)
    await snapshot
    await Promise.all(changes)
    await Promise.all(observations)
    expect(host.readTheme).toHaveBeenCalledTimes(1)
    expect((await owner.getSnapshot(['fontSizeLevel'])).values).toEqual({ fontSizeLevel: 3 })
  })

  it('coalesces pending system events and observes a newer change after active native work', async () => {
    const { owner, host, publishEvent } = setup()
    const observed = deferred<{ theme: 'system'; isDark: boolean }>()
    host.readTheme.mockReturnValueOnce(observed.promise)
    host.readTheme.mockResolvedValue({ theme: 'system', isDark: true })
    const first = owner.observeSystemTheme()
    await vi.waitFor(() => expect(host.readTheme).toHaveBeenCalledTimes(1))
    const following = Array.from({ length: 100 }, () => owner.observeSystemTheme())
    observed.resolve({ theme: 'system', isDark: false })
    await first
    await Promise.all(following)
    expect(host.readTheme).toHaveBeenCalledTimes(2)
    const colors = publishEvent.mock.calls
      .filter(([name]) => name === 'config.systemTheme.changed')
      .map(([, payload]) => payload.isDark)
    expect(colors).toEqual([false, true])
    await owner.setTheme('light')
    publishEvent.mockClear()
    await owner.observeSystemTheme()
    expect(publishEvent).not.toHaveBeenCalled()
  })

  it.each(['contentProtectionEnabled', 'loggingEnabled'] as const)(
    'awaits native %s completion before its event and receipt',
    async (key) => {
      const { owner, host, loggingHost, publishEvent } = setup()
      const effect =
        key === 'contentProtectionEnabled' ? host.applyContentProtection : loggingHost.applyLogging
      const finishing = deferred<void>()
      effect.mockReturnValueOnce(finishing.promise)
      const changed = owner.update([{ key, value: true }])
      await vi.waitFor(() => expect(effect).toHaveBeenCalledWith(true))
      expect(publishEvent).not.toHaveBeenCalled()
      finishing.resolve()
      expect((await changed).values).toEqual({ [key]: true })
      expect(publishEvent).toHaveBeenCalledWith(
        'settings.changed',
        expect.objectContaining({ values: { [key]: true } })
      )
    }
  )

  it('drains actual font enumeration and fences queued folder requests before stopping', async () => {
    const { owner, enumerateFonts, loggingHost } = setup()
    const enumerated = deferred<string[]>()
    enumerateFonts.mockReturnValueOnce(enumerated.promise)
    const fonts = owner.listSystemFonts()
    await vi.waitFor(() => expect(enumerateFonts).toHaveBeenCalledOnce())
    const folder = expect(owner.openLoggingFolder()).rejects.toThrow('Settings owner is stopped')
    let drained = false
    const stopping = owner.stop().then(() => {
      drained = true
    })
    expect(drained).toBe(false)
    enumerated.resolve(['Inter Regular', 'Inter Bold', 'Menlo'])
    expect(await fonts).toEqual(['Inter', 'Menlo'])
    await folder
    await stopping
    expect(loggingHost.openLoggingFolder).not.toHaveBeenCalled()
    owner.start()
    expect(await owner.listSystemFonts()).toEqual(['Inter', 'Menlo'])
    expect(enumerateFonts).toHaveBeenCalledOnce()
    await owner.openLoggingFolder()
    expect(loggingHost.openLoggingFolder).toHaveBeenCalledOnce()
  })
})
