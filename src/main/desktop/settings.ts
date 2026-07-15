import type { SettingsStore } from '@/config/settingsStore'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import type { ShortcutKeySetting } from '@shared/presenter'
import { defaultShortcutKey } from './shortcutKeySettings'
import { app } from 'electron'

export class DesktopSettings {
  constructor(private readonly settings: SettingsStore) {}

  getNotificationsEnabled(): boolean {
    return this.settings.get<boolean>('notificationsEnabled') ?? true
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
}
