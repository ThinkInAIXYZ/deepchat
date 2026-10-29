import type { SettingsStore } from '@/config/settingsStore'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import type { ShortcutKeySetting } from '@shared/types/desktop'
import { defaultShortcutKey } from './shortcutKeySettings'
import type { FloatingButtonBounds } from '@shared/types/floating-widget'
import {
  getLocaleDirection,
  resolveRequestedLocale,
  resolveSupportedLocale,
  type RequestedLocale,
  type SupportedLocale
} from '@shared/locales'

export interface DesktopSettingsHost {
  readonly systemLocale: string
  readTheme(): Promise<{ theme: 'dark' | 'light' | 'system'; isDark: boolean }>
  applyTheme(theme: 'dark' | 'light' | 'system'): Promise<boolean>
  refreshLanguage(locale: SupportedLocale): Promise<void>
  refreshTheme(isDark: boolean): Promise<void>
  readLaunchAtLogin(): Promise<boolean>
  setLaunchAtLogin(enabled: boolean): Promise<boolean>
  applyContentProtection(enabled: boolean): Promise<void>
  applyFloatingButtonEnabled(enabled: boolean): Promise<void>
}

export class DesktopSettings {
  constructor(
    private readonly settings: SettingsStore,
    private readonly host: DesktopSettingsHost,
    private readonly publishEvent: DeepchatEventPublisher,
    private readonly committed: () => void
  ) {}

  getRequestedLanguage(): RequestedLocale {
    return resolveRequestedLocale(this.settings.get<string>('language') || 'system')
  }

  getLanguage(): SupportedLocale {
    const language = this.getRequestedLanguage()
    return resolveSupportedLocale(language === 'system' ? this.host.systemLocale : language)
  }

  async setLanguage(language: string): Promise<void> {
    const requestedLanguage = resolveRequestedLocale(language)
    this.settings.set('language', requestedLanguage)
    this.committed()
    const locale = this.getLanguage()
    await this.host.refreshLanguage(locale)
    this.publishEvent('config.language.changed', {
      requestedLanguage,
      locale,
      direction: getLocaleDirection(locale),
      version: Date.now()
    })
  }

  async initialize(): Promise<void> {
    await this.host.applyTheme(this.getTheme())
    await this.host.refreshLanguage(this.getLanguage())
  }

  async observeSystemTheme(): Promise<void> {
    const observed = await this.host.readTheme()
    if (this.getTheme() !== 'system' || observed.theme !== 'system') return
    await this.host.refreshTheme(observed.isDark)
    this.publishEvent('config.systemTheme.changed', {
      isDark: observed.isDark,
      version: Date.now()
    })
  }

  async setTheme(theme: 'dark' | 'light' | 'system'): Promise<boolean> {
    const isDark = await this.host.applyTheme(theme)
    this.settings.set('appTheme', theme)
    this.committed()
    await this.host.refreshTheme(isDark)
    this.publishEvent('config.theme.changed', {
      theme,
      isDark,
      version: Date.now()
    })
    return isDark
  }

  getTheme(): 'dark' | 'light' | 'system' {
    return this.settings.get<'dark' | 'light' | 'system'>('appTheme') || 'system'
  }

  async getCurrentThemeIsDark(): Promise<boolean> {
    return (await this.host.readTheme()).isDark
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
    this.committed()
    this.publishEvent('settings.changed', {
      changedKeys: ['autoScrollEnabled'],
      version: Date.now(),
      values: { autoScrollEnabled: Boolean(enabled) }
    })
  }

  setNotificationsEnabled(enabled: boolean): void {
    const value = Boolean(enabled)
    this.settings.set('notificationsEnabled', value)
    this.committed()
    this.publishEvent('settings.changed', {
      changedKeys: ['notificationsEnabled'],
      version: Date.now(),
      values: { notificationsEnabled: value }
    })
  }

  async getLaunchAtLoginEnabled(): Promise<boolean> {
    return await this.host.readLaunchAtLogin()
  }

  async setLaunchAtLoginEnabled(enabled: boolean): Promise<void> {
    const observed = await this.host.setLaunchAtLogin(Boolean(enabled))
    this.publishEvent('settings.changed', {
      changedKeys: ['launchAtLoginEnabled'],
      version: Date.now(),
      values: { launchAtLoginEnabled: observed }
    })
  }

  getCloseToQuit(): boolean {
    return this.settings.get<boolean>('closeToQuit') ?? false
  }

  getContentProtectionEnabled(): boolean {
    return this.settings.get<boolean>('contentProtectionEnabled') ?? false
  }

  async setContentProtectionEnabled(enabled: boolean): Promise<void> {
    const value = Boolean(enabled)
    this.settings.set('contentProtectionEnabled', value)
    this.committed()
    await this.host.applyContentProtection(value)
    this.publishEvent('settings.changed', {
      changedKeys: ['contentProtectionEnabled'],
      version: Date.now(),
      values: { contentProtectionEnabled: value }
    })
  }

  getFloatingButtonEnabled(): boolean {
    return this.settings.get<boolean>('floatingButtonEnabled') ?? false
  }

  async setFloatingButtonEnabled(enabled: boolean): Promise<void> {
    const value = Boolean(enabled)
    this.settings.set('floatingButtonEnabled', value)
    this.committed()
    await this.host.applyFloatingButtonEnabled(value)
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
    this.committed()
  }

  getShortcutKeys(): ShortcutKeySetting {
    return {
      ...defaultShortcutKey,
      ...this.settings.get<ShortcutKeySetting>('shortcutKey')
    }
  }

  setShortcutKeys(shortcuts: ShortcutKeySetting): void {
    this.settings.set('shortcutKey', shortcuts)
    this.committed()
    this.publishShortcutKeysChanged()
  }

  resetShortcutKeys(): void {
    this.settings.set('shortcutKey', { ...defaultShortcutKey })
    this.committed()
    this.publishShortcutKeysChanged()
  }

  private publishShortcutKeysChanged(): void {
    this.publishEvent('config.shortcutKeys.changed', {
      shortcuts: this.getShortcutKeys(),
      version: Date.now()
    })
  }

  private setSetting(key: 'fontSizeLevel' | 'copyWithCotEnabled', value: number | boolean): void {
    this.settings.set(key, value)
    this.committed()
    this.publishEvent('settings.changed', {
      changedKeys: [key],
      version: Date.now(),
      values: { [key]: value }
    })
  }
}
