import { SHARED_AGENT_MCP_SELECTION_ID, type AgentCatalogSettingsTable } from './data/settingsTable'
import type { StoreLike } from '@/config/storeLike'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export class AcpDbStore implements StoreLike<Record<string, unknown>> {
  private readonly legacySnapshot: Record<string, unknown>

  constructor(
    legacySnapshot: Record<string, unknown>,
    private readonly getSettingsTable: () => AgentCatalogSettingsTable
  ) {
    this.legacySnapshot = clone(legacySnapshot)
  }

  private get settingsTable(): AgentCatalogSettingsTable {
    return this.getSettingsTable()
  }

  get store(): Record<string, unknown> {
    const enabled = this.settingsTable.getAgentSetting<boolean>('enabled')
    return {
      ...this.getLegacyStoreSnapshot(),
      ...this.settingsTable.listAgentSettings(),
      ...(enabled !== undefined ? { enabled } : {}),
      sharedMcpSelections: this.settingsTable.getAgentMcpSelections(SHARED_AGENT_MCP_SELECTION_ID)
    }
  }

  get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
    if (key === 'sharedMcpSelections') {
      const selections = this.settingsTable.getAgentMcpSelections(SHARED_AGENT_MCP_SELECTION_ID)
      return (selections.length > 0 ? selections : defaultValue) as TValue | undefined
    }
    if (key === 'enabled' || key === 'version') {
      const value = this.settingsTable.getAgentSetting<TValue>(key)
      return value === undefined ? defaultValue : value
    }
    const legacyValue = this.legacySnapshot[key] as TValue | undefined
    return legacyValue === undefined ? defaultValue : clone(legacyValue)
  }

  set(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
    if (typeof keyOrValues !== 'string') {
      if (
        Object.keys(keyOrValues).some(
          (key) => key !== 'enabled' && key !== 'version' && key !== 'sharedMcpSelections'
        )
      ) {
        throw new Error('Legacy ACP settings are read-only after database attachment')
      }
      for (const [key, nextValue] of Object.entries(keyOrValues)) this.set(key, nextValue)
      return
    }
    if (keyOrValues === 'sharedMcpSelections' && Array.isArray(value)) {
      this.settingsTable.setAgentMcpSelections(
        value.filter((item): item is string => typeof item === 'string')
      )
      return
    }
    if (keyOrValues === 'enabled' || keyOrValues === 'version') {
      this.settingsTable.setAgentSetting(keyOrValues, value)
      return
    }
    throw new Error('Legacy ACP settings are read-only after database attachment')
  }

  delete(key: string): void {
    if (key === 'sharedMcpSelections') {
      this.settingsTable.setAgentMcpSelections([])
      return
    }
    if (key === 'enabled' || key === 'version') {
      this.settingsTable.deleteAgentSetting(key)
      return
    }
    throw new Error('Legacy ACP settings are read-only after database attachment')
  }

  private getLegacyStoreSnapshot(): Record<string, unknown> {
    const snapshot = clone(this.legacySnapshot)
    delete snapshot.enabled
    delete snapshot.version
    delete snapshot.sharedMcpSelections
    return snapshot
  }
}
