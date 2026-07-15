type SetSetting = <T>(key: string, value: T) => void
type GetSetting = <T>(key: string) => T | undefined

interface UiSettingsHelperOptions {
  getSetting: GetSetting
  setSetting: SetSetting
}

export class UiSettingsHelper {
  private readonly getSetting: GetSetting
  private readonly setSetting: SetSetting

  constructor(options: UiSettingsHelperOptions) {
    this.getSetting = options.getSetting
    this.setSetting = options.setSetting
  }

  getPrivacyModeEnabled(): boolean {
    const value = this.getSetting<boolean>('privacyModeEnabled')
    return value === undefined || value === null ? false : value
  }

  setPrivacyModeEnabled(enabled: boolean): void {
    this.setSetting('privacyModeEnabled', Boolean(enabled))
  }

  getCopyWithCotEnabled(): boolean {
    const value = this.getSetting<boolean>('copyWithCotEnabled')
    return value === undefined || value === null ? false : value
  }

  setCopyWithCotEnabled(enabled: boolean): void {
    this.setSetting('copyWithCotEnabled', enabled)
  }

  setTraceDebugEnabled(enabled: boolean): void {
    this.setSetting('traceDebugEnabled', enabled)
  }
}
