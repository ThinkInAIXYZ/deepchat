import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import type { SettingsKey, SettingsSnapshotValues } from '@shared/contracts/routes'

const AUTO_COMPACTION_TRIGGER_THRESHOLD_DEFAULT = 80
const AUTO_COMPACTION_TRIGGER_THRESHOLD_MIN = 5
const AUTO_COMPACTION_TRIGGER_THRESHOLD_MAX = 95
const AUTO_COMPACTION_RETAIN_RECENT_PAIRS_DEFAULT = 2
const AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MIN = 1
const AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MAX = 10

type SetSetting = <T>(key: string, value: T) => void
type GetSetting = <T>(key: string) => T | undefined

interface UiSettingsHelperOptions {
  getSetting: GetSetting
  setSetting: SetSetting
}

const emitSettingsChanged = (changedKey: SettingsKey, value: string | number | boolean) => {
  publishDeepchatEvent('settings.changed', {
    changedKeys: [changedKey],
    version: Date.now(),
    values: {
      [changedKey]: value
    } as Partial<SettingsSnapshotValues>
  })
}

export class UiSettingsHelper {
  private readonly getSetting: GetSetting
  private readonly setSetting: SetSetting

  constructor(options: UiSettingsHelperOptions) {
    this.getSetting = options.getSetting
    this.setSetting = options.setSetting
  }

  getAutoCompactionEnabled(): boolean {
    const value = this.getSetting<boolean>('autoCompactionEnabled')
    if (value === undefined) return true
    return Boolean(value)
  }

  setAutoCompactionEnabled(enabled: boolean): void {
    const boolValue = Boolean(enabled)
    this.setSetting('autoCompactionEnabled', boolValue)
    emitSettingsChanged('autoCompactionEnabled', boolValue)
  }

  getAutoCompactionTriggerThreshold(): number {
    return this.normalizeAutoCompactionTriggerThreshold(
      this.getSetting<number>('autoCompactionTriggerThreshold')
    )
  }

  setAutoCompactionTriggerThreshold(threshold: number): void {
    const normalized = this.normalizeAutoCompactionTriggerThreshold(threshold)
    this.setSetting('autoCompactionTriggerThreshold', normalized)
    emitSettingsChanged('autoCompactionTriggerThreshold', normalized)
  }

  getAutoCompactionRetainRecentPairs(): number {
    return this.normalizeAutoCompactionRetainRecentPairs(
      this.getSetting<number>('autoCompactionRetainRecentPairs')
    )
  }

  setAutoCompactionRetainRecentPairs(count: number): void {
    const normalized = this.normalizeAutoCompactionRetainRecentPairs(count)
    this.setSetting('autoCompactionRetainRecentPairs', normalized)
    emitSettingsChanged('autoCompactionRetainRecentPairs', normalized)
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

  private normalizeAutoCompactionTriggerThreshold(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return AUTO_COMPACTION_TRIGGER_THRESHOLD_DEFAULT
    }

    const rounded = Math.round(value / 5) * 5
    return Math.min(
      AUTO_COMPACTION_TRIGGER_THRESHOLD_MAX,
      Math.max(AUTO_COMPACTION_TRIGGER_THRESHOLD_MIN, rounded)
    )
  }

  private normalizeAutoCompactionRetainRecentPairs(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return AUTO_COMPACTION_RETAIN_RECENT_PAIRS_DEFAULT
    }

    const rounded = Math.round(value)
    return Math.min(
      AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MAX,
      Math.max(AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MIN, rounded)
    )
  }
}
