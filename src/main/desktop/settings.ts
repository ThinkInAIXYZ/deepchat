import type { SettingsStore } from '@/config/settingsStore'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import type { ShortcutKeySetting } from '@shared/presenter'
import { defaultShortcutKey } from './shortcutKeySettings'
import { app } from 'electron'
import type { FloatingButtonBounds } from '@shared/types/floating-widget'

export class DesktopSettings {
  constructor(private readonly settings: SettingsStore) {}

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

  setNotificationsEnabled(enabled: boolean): void {
    const value = Boolean(enabled)
    this.settings.set('notificationsEnabled', value)
    publishDeepchatEvent('settings.changed', {
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
    publishDeepchatEvent('settings.changed', {
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
    publishDeepchatEvent('settings.changed', {
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
    publishDeepchatEvent('config.floatingButton.changed', {
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
    publishDeepchatEvent('config.shortcutKeys.changed', {
      shortcuts: this.getShortcutKeys(),
      version: Date.now()
    })
  }

  private setSetting(
    key: 'fontSizeLevel' | 'artifactsEffectEnabled',
    value: number | boolean
  ): void {
    this.settings.set(key, value)
    publishDeepchatEvent('settings.changed', {
      changedKeys: [key],
      version: Date.now(),
      values: { [key]: value }
    })
  }
}
