import type { SettingsStore } from '@/config/settingsStore'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'

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
}
