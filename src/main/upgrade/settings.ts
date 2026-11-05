import type { SettingsStore } from '@/config/settingsStore'
import { appHost } from '@/platform/appHost'

export class UpdateSettings {
  constructor(private readonly settings: SettingsStore) {}

  getChannel(): 'stable' | 'beta' {
    const raw = this.settings.get<string>('updateChannel')
    if (raw === 'stable' || raw === 'beta') {
      return raw
    }
    const channel = /-(?:alpha|beta|rc|canary)(?:[.-]\d+)?$/i.test(appHost.getVersion())
      ? 'beta'
      : 'stable'
    this.settings.set('updateChannel', channel)
    return channel
  }

  setChannel(channel: 'stable' | 'beta'): void {
    this.settings.set('updateChannel', channel)
  }
}
