import { BUILTIN_DEEPCHAT_AGENT_ID, type AgentRepository } from '@/agent/repository'
import type { SettingsKey, SettingsSnapshotValues } from '@shared/contracts/routes'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'

const AUTO_COMPACTION_TRIGGER_THRESHOLD_DEFAULT = 80
const AUTO_COMPACTION_TRIGGER_THRESHOLD_MIN = 5
const AUTO_COMPACTION_TRIGGER_THRESHOLD_MAX = 95
const AUTO_COMPACTION_RETAIN_RECENT_PAIRS_DEFAULT = 2
const AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MIN = 1
const AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MAX = 10

type AutoCompactionSettingKey = Extract<
  SettingsKey,
  'autoCompactionEnabled' | 'autoCompactionTriggerThreshold' | 'autoCompactionRetainRecentPairs'
>

export interface DeepChatDefaultsDependencies {
  repository: AgentRepository
  onAgentChanged(): void
  publishSettingChanged(
    key: AutoCompactionSettingKey,
    value: SettingsSnapshotValues[AutoCompactionSettingKey]
  ): void
}

export class DeepChatDefaults {
  constructor(private readonly dependencies: DeepChatDefaultsDependencies) {}

  getAutoCompactionEnabled(): boolean {
    return this.getConfig().autoCompactionEnabled ?? true
  }

  setAutoCompactionEnabled(enabled: boolean): void {
    this.update('autoCompactionEnabled', Boolean(enabled))
  }

  getAutoCompactionTriggerThreshold(): number {
    return this.normalizeTriggerThreshold(this.getConfig().autoCompactionTriggerThreshold)
  }

  setAutoCompactionTriggerThreshold(threshold: number): void {
    this.update('autoCompactionTriggerThreshold', this.normalizeTriggerThreshold(threshold))
  }

  getAutoCompactionRetainRecentPairs(): number {
    return this.normalizeRetainRecentPairs(this.getConfig().autoCompactionRetainRecentPairs)
  }

  setAutoCompactionRetainRecentPairs(count: number): void {
    this.update('autoCompactionRetainRecentPairs', this.normalizeRetainRecentPairs(count))
  }

  private getConfig(): DeepChatAgentConfig {
    return this.dependencies.repository.resolveDeepChatAgentConfig(BUILTIN_DEEPCHAT_AGENT_ID)
  }

  private update<Key extends AutoCompactionSettingKey>(
    key: Key,
    value: SettingsSnapshotValues[Key]
  ): void {
    const updated = this.dependencies.repository.updateDeepChatAgent(BUILTIN_DEEPCHAT_AGENT_ID, {
      config: { [key]: value }
    })
    if (!updated) {
      throw new Error('Built-in DeepChat agent is unavailable.')
    }
    this.dependencies.onAgentChanged()
    this.dependencies.publishSettingChanged(key, value)
  }

  private normalizeTriggerThreshold(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return AUTO_COMPACTION_TRIGGER_THRESHOLD_DEFAULT
    }
    const rounded = Math.round(value / 5) * 5
    return Math.min(
      AUTO_COMPACTION_TRIGGER_THRESHOLD_MAX,
      Math.max(AUTO_COMPACTION_TRIGGER_THRESHOLD_MIN, rounded)
    )
  }

  private normalizeRetainRecentPairs(value: unknown): number {
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
