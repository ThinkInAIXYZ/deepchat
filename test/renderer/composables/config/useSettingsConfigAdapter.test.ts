import { describe, it, expect, vi } from 'vitest'
import type { ShortcutKeySetting } from '@shared/presenter'
import { createSettingsConfigAdapter } from '@/composables/config/useSettingsConfigAdapter'

describe('createSettingsConfigAdapter', () => {
  it('loads ui settings from config presenter', async () => {
    const configPresenter = {
      getSetting: vi.fn((key: string) => {
        if (key === 'fontSizeLevel') return Promise.resolve(2)
        if (key === 'artifactsEffectEnabled') return Promise.resolve(true)
        if (key === 'traceDebugEnabled') return Promise.resolve(true)
        return Promise.resolve(null)
      }),
      getFontFamily: vi.fn().mockResolvedValue('Inter'),
      getCodeFontFamily: vi.fn().mockResolvedValue('Fira Code'),
      getContentProtectionEnabled: vi.fn().mockResolvedValue(true),
      getCopyWithCotEnabled: vi.fn().mockResolvedValue(false),
      getNotificationsEnabled: vi.fn().mockResolvedValue(false),
      getLoggingEnabled: vi.fn().mockResolvedValue(true)
    } as any

    const adapter = createSettingsConfigAdapter(configPresenter)
    const snapshot = await adapter.loadUiSettings()

    expect(snapshot.fontSizeLevel).toBe(2)
    expect(snapshot.artifactsEffectEnabled).toBe(true)
    expect(snapshot.fontFamily).toBe('Inter')
    expect(snapshot.codeFontFamily).toBe('Fira Code')
    expect(snapshot.contentProtectionEnabled).toBe(true)
    expect(snapshot.copyWithCotEnabled).toBe(false)
    expect(snapshot.traceDebugEnabled).toBe(true)
    expect(snapshot.notificationsEnabled).toBe(false)
    expect(snapshot.loggingEnabled).toBe(true)
  })

  it('persists shortcut keys through config presenter', async () => {
    const configPresenter = {
      getShortcutKey: vi.fn().mockResolvedValue({}),
      setShortcutKey: vi.fn().mockResolvedValue(undefined),
      resetShortcutKeys: vi.fn().mockResolvedValue(undefined),
      getSetting: vi.fn().mockResolvedValue(null),
      getFontFamily: vi.fn().mockResolvedValue(null),
      getCodeFontFamily: vi.fn().mockResolvedValue(null),
      getContentProtectionEnabled: vi.fn().mockResolvedValue(null),
      getCopyWithCotEnabled: vi.fn().mockResolvedValue(null),
      getNotificationsEnabled: vi.fn().mockResolvedValue(null),
      getLoggingEnabled: vi.fn().mockResolvedValue(null)
    } as any

    const adapter = createSettingsConfigAdapter(configPresenter)
    const keys = { NewConversation: 'CommandOrControl+N' } as unknown as ShortcutKeySetting

    await adapter.saveShortcutKeys(keys)
    await adapter.resetShortcutKeys()
    await adapter.loadShortcutKeys()

    expect(configPresenter.setShortcutKey).toHaveBeenCalledWith(keys)
    expect(configPresenter.resetShortcutKeys).toHaveBeenCalled()
    expect(configPresenter.getShortcutKey).toHaveBeenCalled()
  })
})
