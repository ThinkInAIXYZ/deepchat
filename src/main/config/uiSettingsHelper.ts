type SetSetting = <T>(key: string, value: T) => void
interface UiSettingsHelperOptions {
  setSetting: SetSetting
}

export class UiSettingsHelper {
  private readonly setSetting: SetSetting

  constructor(options: UiSettingsHelperOptions) {
    this.setSetting = options.setSetting
  }

  setTraceDebugEnabled(enabled: boolean): void {
    this.setSetting('traceDebugEnabled', enabled)
  }
}
