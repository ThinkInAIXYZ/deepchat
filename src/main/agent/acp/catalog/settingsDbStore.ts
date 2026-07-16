import type { SettingsTables } from '@/settings/data/tables/settingsTables'
import { SHARED_AGENT_MCP_SELECTION_ID } from '@/settings/data/tables/settingsTables'
import type { StoreLike } from '@/config/storeLike'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export class AcpDbStore implements StoreLike<Record<string, unknown>> {
  constructor(
    private readonly legacyStore: StoreLike<Record<string, unknown>>,
    private readonly getSettingsTables: () => SettingsTables
  ) {}

  private get settingsTables(): SettingsTables {
    return this.getSettingsTables()
  }

  get store(): Record<string, unknown> {
    const enabled = this.settingsTables.getAgentSetting<boolean>('enabled')
    return {
      ...this.getLegacyStoreSnapshot(),
      ...this.settingsTables.listAgentSettings(),
      ...(enabled !== undefined ? { enabled } : {}),
      sharedMcpSelections: this.settingsTables.getAgentMcpSelections(SHARED_AGENT_MCP_SELECTION_ID)
    }
  }

  get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
    if (key === 'sharedMcpSelections') {
      const selections = this.settingsTables.getAgentMcpSelections(SHARED_AGENT_MCP_SELECTION_ID)
      return (selections.length > 0 ? selections : defaultValue) as TValue | undefined
    }
    if (key === 'enabled' || key === 'version') {
      const value = this.settingsTables.getAgentSetting<TValue>(key)
      return value === undefined ? defaultValue : value
    }
    const legacyValue = this.legacyStore.get<TValue>(key)
    return legacyValue === undefined ? defaultValue : clone(legacyValue)
  }

  set(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
    if (typeof keyOrValues !== 'string') {
      for (const [key, nextValue] of Object.entries(keyOrValues)) this.set(key, nextValue)
      return
    }
    if (keyOrValues === 'sharedMcpSelections' && Array.isArray(value)) {
      this.settingsTables.setAgentMcpSelections(
        value.filter((item): item is string => typeof item === 'string')
      )
      return
    }
    if (keyOrValues === 'enabled' || keyOrValues === 'version') {
      this.settingsTables.setAgentSetting(keyOrValues, value)
      return
    }
    this.legacyStore.set(keyOrValues, value)
  }

  delete(key: string): void {
    if (key === 'sharedMcpSelections') {
      this.settingsTables.setAgentMcpSelections([])
      return
    }
    if (key === 'enabled' || key === 'version') {
      this.settingsTables.deleteAgentSetting(key)
      return
    }
    this.legacyStore.delete(key)
  }

  private getLegacyStoreSnapshot(): Record<string, unknown> {
    const snapshot = { ...this.legacyStore.store }
    delete snapshot.enabled
    delete snapshot.version
    delete snapshot.sharedMcpSelections
    return snapshot
  }
}
