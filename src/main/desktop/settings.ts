import type { SettingsStore } from '@/config/settingsStore'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import type { ShortcutKeySetting } from '@shared/types/desktop'
import { defaultShortcutKey } from './shortcutKeySettings'
import { app, nativeTheme } from 'electron'
import type { FloatingButtonBounds } from '@shared/types/floating-widget'
import {
  getLocaleDirection,
  resolveRequestedLocale,
  resolveSupportedLocale,
  type RequestedLocale,
  type SupportedLocale
} from '@shared/locales'

export class DesktopSettings {
  constructor(
    private readonly settings: SettingsStore,
    private readonly effects: {
      refreshLanguage(): void
      refreshTheme(): Promise<void>
    },
    private readonly publishEvent: DeepchatEventPublisher
  ) {}

  getRequestedLanguage(): RequestedLocale {
    return resolveRequestedLocale(this.settings.get<string>('language') || 'system')
  }

  getLanguage(): SupportedLocale {
    const language = this.getRequestedLanguage()
    return resolveSupportedLocale(language === 'system' ? app.getLocale() : language)
  }

  setLanguage(language: string): void {
    const requestedLanguage = resolveRequestedLocale(language)
    this.settings.set('language', requestedLanguage)
    const locale = this.getLanguage()
    this.publishEvent('config.language.changed', {
      requestedLanguage,
      locale,
      direction: getLocaleDirection(locale),
      version: Date.now()
    })
    this.effects.refreshLanguage()
  }

  initializeTheme(): void {
    nativeTheme.themeSource = this.getTheme()
    nativeTheme.on('updated', () => {
      if (nativeTheme.themeSource !== 'system') return
      this.publishEvent('config.systemTheme.changed', {
        isDark: nativeTheme.shouldUseDarkColors,
        version: Date.now()
      })
      void this.effects.refreshTheme()
    })
  }

  setTheme(theme: 'dark' | 'light' | 'system'): boolean {
    nativeTheme.themeSource = theme
    this.settings.set('appTheme', theme)
    this.publishEvent('config.theme.changed', {
      theme,
      isDark: nativeTheme.shouldUseDarkColors,
      version: Date.now()
    })
    void this.effects.refreshTheme()
    return nativeTheme.shouldUseDarkColors
  }

  getTheme(): 'dark' | 'light' | 'system' {
    return this.settings.get<'dark' | 'light' | 'system'>('appTheme') || 'system'
  }

  getCurrentThemeIsDark(): boolean {
    return nativeTheme.shouldUseDarkColors
  }

  getNotificationsEnabled(): boolean {
    return this.settings.get<boolean>('notificationsEnabled') ?? true
  }

  getFontSizeLevel(): number {
    return this.settings.get<number>('fontSizeLevel') ?? 1
  }

  setFontSizeLevel(level: number): void {
    this.setSetting('fontSizeLevel', level)
  }

  getArtifactsEffectEnabled(): boolean {
    return this.settings.get<boolean>('artifactsEffectEnabled') ?? false
  }

  setArtifactsEffectEnabled(enabled: boolean): void {
    this.setSetting('artifactsEffectEnabled', Boolean(enabled))
  }

  getAutoScrollEnabled(): boolean {
    return this.settings.get<boolean>('autoScrollEnabled') ?? true
  }

  getCopyWithCotEnabled(): boolean {
    return this.settings.get<boolean>('copyWithCotEnabled') ?? true
  }

  setCopyWithCotEnabled(enabled: boolean): void {
    this.setSetting('copyWithCotEnabled', Boolean(enabled))
  }

  setAutoScrollEnabled(enabled: boolean): void {
    this.settings.set('autoScrollEnabled', Boolean(enabled))
    this.publishEvent('settings.changed', {
      changedKeys: ['autoScrollEnabled'],
      version: Date.now(),
      values: { autoScrollEnabled: Boolean(enabled) }
    })
  }

  setNotificationsEnabled(enabled: boolean): void {
    const value = Boolean(enabled)
    this.settings.set('notificationsEnabled', value)
    this.publishEvent('settings.changed', {
      changedKeys: ['notificationsEnabled'],
      version: Date.now(),
      values: { notificationsEnabled: value }
    })
  }

  getLaunchAtLoginEnabled(): boolean {
    return app.getLoginItemSettings().openAtLogin
  }

  setLaunchAtLoginEnabled(enabled: boolean): void {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) })
    this.publishEvent('settings.changed', {
      changedKeys: ['launchAtLoginEnabled'],
      version: Date.now(),
      values: { launchAtLoginEnabled: this.getLaunchAtLoginEnabled() }
    })
  }

  getCloseToQuit(): boolean {
    return this.settings.get<boolean>('closeToQuit') ?? false
  }

  getContentProtectionEnabled(): boolean {
    return this.settings.get<boolean>('contentProtectionEnabled') ?? false
  }

  setContentProtectionEnabled(enabled: boolean): void {
    const value = Boolean(enabled)
    this.settings.set('contentProtectionEnabled', value)
    this.publishEvent('settings.changed', {
      changedKeys: ['contentProtectionEnabled'],
      version: Date.now(),
      values: { contentProtectionEnabled: value }
    })
  }

  getFloatingButtonEnabled(): boolean {
    return this.settings.get<boolean>('floatingButtonEnabled') ?? false
  }

  setFloatingButtonEnabled(enabled: boolean): void {
    const value = Boolean(enabled)
    this.settings.set('floatingButtonEnabled', value)
    this.publishEvent('config.floatingButton.changed', {
      enabled: value,
      version: Date.now()
    })
  }

  getFloatingButtonBounds(): FloatingButtonBounds | null {
    const value = this.settings.get<FloatingButtonBounds>('floatingButtonBounds')
    if (
      !value ||
      typeof value.x !== 'number' ||
      typeof value.y !== 'number' ||
      (value.dockSide !== 'left' && value.dockSide !== 'right')
    ) {
      return null
    }
    return value
  }

  setFloatingButtonBounds(bounds: FloatingButtonBounds): void {
    this.settings.set('floatingButtonBounds', bounds)
  }

  getShortcutKeys(): ShortcutKeySetting {
    return {
      ...defaultShortcutKey,
      ...this.settings.get<ShortcutKeySetting>('shortcutKey')
    }
  }

  setShortcutKeys(shortcuts: ShortcutKeySetting): void {
    this.settings.set('shortcutKey', shortcuts)
    this.publishShortcutKeysChanged()
  }

  resetShortcutKeys(): void {
    this.settings.set('shortcutKey', { ...defaultShortcutKey })
    this.publishShortcutKeysChanged()
  }

  private publishShortcutKeysChanged(): void {
    this.publishEvent('config.shortcutKeys.changed', {
      shortcuts: this.getShortcutKeys(),
      version: Date.now()
    })
  }

  private setSetting(
    key: 'fontSizeLevel' | 'artifactsEffectEnabled' | 'copyWithCotEnabled',
    value: number | boolean
  ): void {
    this.settings.set(key, value)
    this.publishEvent('settings.changed', {
      changedKeys: [key],
      version: Date.now(),
      values: { [key]: value }
    })
  }
}
