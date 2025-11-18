import { eventBus, SendTarget } from '@/eventbus'
import { CONFIG_EVENTS } from '@/events'

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

  getSearchPreviewEnabled(): Promise<boolean> {
    const value = this.getSetting<boolean>('searchPreviewEnabled')
    return Promise.resolve(Boolean(value))
  }

  setSearchPreviewEnabled(enabled: boolean): void {
    const boolValue = Boolean(enabled)
    this.setSetting('searchPreviewEnabled', boolValue)
    eventBus.send(CONFIG_EVENTS.SEARCH_PREVIEW_CHANGED, SendTarget.ALL_WINDOWS, boolValue)
  }

  getContentProtectionEnabled(): boolean {
    const value = this.getSetting<boolean>('contentProtectionEnabled')
    return value === undefined || value === null ? false : value
  }

  setContentProtectionEnabled(enabled: boolean): void {
    this.setSetting('contentProtectionEnabled', enabled)
    eventBus.send(CONFIG_EVENTS.CONTENT_PROTECTION_CHANGED, SendTarget.ALL_WINDOWS, enabled)
  }

  getCopyWithCotEnabled(): boolean {
    const value = this.getSetting<boolean>('copyWithCotEnabled')
    return value === undefined || value === null ? false : value
  }

  setCopyWithCotEnabled(enabled: boolean): void {
    this.setSetting('copyWithCotEnabled', enabled)
    eventBus.send(CONFIG_EVENTS.COPY_WITH_COT_CHANGED, SendTarget.ALL_WINDOWS, enabled)
  }

  setTraceDebugEnabled(enabled: boolean): void {
    this.setSetting('traceDebugEnabled', enabled)
    eventBus.send(CONFIG_EVENTS.TRACE_DEBUG_CHANGED, SendTarget.ALL_WINDOWS, enabled)
  }

  getNotificationsEnabled(): boolean {
    const value = this.getSetting<boolean>('notificationsEnabled')
    if (value === undefined) {
      return true
    }
    return value
  }

  setNotificationsEnabled(enabled: boolean): void {
    this.setSetting('notificationsEnabled', enabled)
    eventBus.send(CONFIG_EVENTS.NOTIFICATIONS_CHANGED, SendTarget.ALL_WINDOWS, Boolean(enabled))
  }
}
