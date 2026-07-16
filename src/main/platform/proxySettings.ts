export type ProxySettingMode = 'system' | 'none' | 'custom'

interface ProxySettingsStore {
  get<T>(key: string): T | undefined
  set<T>(key: string, value: T): void
}

export class ProxySettings {
  constructor(private readonly settings: ProxySettingsStore) {}

  getMode(): ProxySettingMode {
    const mode = this.settings.get<string>('proxyMode')
    return mode === 'none' || mode === 'custom' ? mode : 'system'
  }

  setMode(mode: ProxySettingMode): void {
    this.settings.set('proxyMode', mode)
  }

  getCustomUrl(): string {
    return this.settings.get<string>('customProxyUrl') ?? ''
  }

  setCustomUrl(url: string): void {
    this.settings.set('customProxyUrl', url)
  }
}
