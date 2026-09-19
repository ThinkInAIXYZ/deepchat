import type { SettingsStore } from '@/config/settingsStore'
import type { SettingsKey, SettingsSnapshotValues } from '@shared/contracts/routes'

const AUTO_COMPACTION_TRIGGER_THRESHOLD_DEFAULT = 80
const AUTO_COMPACTION_TRIGGER_THRESHOLD_MIN = 5
const AUTO_COMPACTION_TRIGGER_THRESHOLD_MAX = 95
const AUTO_COMPACTION_RETAIN_RECENT_PAIRS_DEFAULT = 2
const AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MIN = 1
const AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MAX = 10

export const normalizeAutoCompactionTriggerThreshold = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return AUTO_COMPACTION_TRIGGER_THRESHOLD_DEFAULT
  }
  const rounded = Math.round(value / 5) * 5
  return Math.min(
    AUTO_COMPACTION_TRIGGER_THRESHOLD_MAX,
    Math.max(AUTO_COMPACTION_TRIGGER_THRESHOLD_MIN, rounded)
  )
}

export const normalizeAutoCompactionRetainRecentPairs = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return AUTO_COMPACTION_RETAIN_RECENT_PAIRS_DEFAULT
  }
  const rounded = Math.round(value)
  return Math.min(
    AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MAX,
    Math.max(AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MIN, rounded)
  )
}

type AutoCompactionSettingKey = Extract<
  SettingsKey,
  'autoCompactionEnabled' | 'autoCompactionTriggerThreshold' | 'autoCompactionRetainRecentPairs'
>

export interface DeepChatDefaultsDependencies {
  settings: Pick<SettingsStore, 'get' | 'set'>
  publishSettingChanged(
    key: AutoCompactionSettingKey,
    value: SettingsSnapshotValues[AutoCompactionSettingKey]
  ): void
}

export class DeepChatDefaults {
  constructor(private readonly dependencies: DeepChatDefaultsDependencies) {}

  getAutoCompactionEnabled(): boolean {
    return this.dependencies.settings.get<boolean>('autoCompactionEnabled') ?? true
  }

  setAutoCompactionEnabled(enabled: boolean): void {
    this.update('autoCompactionEnabled', Boolean(enabled))
  }

  getAutoCompactionTriggerThreshold(): number {
    return normalizeAutoCompactionTriggerThreshold(
      this.dependencies.settings.get('autoCompactionTriggerThreshold')
    )
  }

  setAutoCompactionTriggerThreshold(threshold: number): void {
    this.update(
      'autoCompactionTriggerThreshold',
      normalizeAutoCompactionTriggerThreshold(threshold)
    )
  }

  getAutoCompactionRetainRecentPairs(): number {
    return normalizeAutoCompactionRetainRecentPairs(
      this.dependencies.settings.get('autoCompactionRetainRecentPairs')
    )
  }

  setAutoCompactionRetainRecentPairs(count: number): void {
    this.update('autoCompactionRetainRecentPairs', normalizeAutoCompactionRetainRecentPairs(count))
  }

  private update<Key extends AutoCompactionSettingKey>(
    key: Key,
    value: SettingsSnapshotValues[Key]
  ): void {
    this.dependencies.settings.set(key, value)
    this.dependencies.publishSettingChanged(key, value)
  }
}
