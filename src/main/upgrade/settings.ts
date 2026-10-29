import type { SettingsStore } from '@/config/settingsStore'

export class UpdateSettings {
  constructor(
    private readonly settings: SettingsStore,
    private readonly appVersion: string
  ) {}

  getChannel(): 'stable' | 'beta' {
    const raw = this.settings.get<string>('updateChannel')
    if (raw === 'stable' || raw === 'beta') {
      return raw
    }
    const channel = /-(?:alpha|beta|rc|canary)(?:[.-]\d+)?$/i.test(this.appVersion)
      ? 'beta'
      : 'stable'
    this.settings.set('updateChannel', channel)
    return channel
  }

  setChannel(channel: 'stable' | 'beta'): void {
    this.settings.set('updateChannel', channel)
  }
}
