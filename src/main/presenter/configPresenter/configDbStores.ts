import type { LLM_PROVIDER, MCPServerConfig, MODEL_META } from '@shared/presenter'
import type { ConfigTables } from '../sqlitePresenter/tables/configTables'
import { SHARED_AGENT_MCP_SELECTION_ID } from '../sqlitePresenter/tables/configTables'
import type { IModelStore } from './providerModelHelper'
import type { StoreLike } from './storeLike'

const MODEL_STATUS_KEY_PREFIX = 'model_status_'

type LegacyStore = StoreLike<Record<string, unknown>>

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export class AppSettingsDbBackedStore implements StoreLike<Record<string, unknown>> {
  readonly path?: string

  constructor(
    private readonly legacyStore: LegacyStore,
    private readonly configTables: ConfigTables
  ) {
    this.path = legacyStore.path
  }

  get store(): Record<string, unknown> {
    return {
      ...this.legacyStore.store,
      providers: this.configTables.listProviders(),
      providerOrder: this.configTables.getProviderOrder(),
      providerTimestamps: this.configTables.getProviderTimestamps(),
      ...this.configTables.listModelStatusEntries()
    }
  }

  get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
    if (key === 'providers') {
      const providers = this.configTables.listProviders()
      return (providers.length > 0 ? providers : defaultValue) as TValue | undefined
    }
    if (key === 'providerOrder') {
      const order = this.configTables.getProviderOrder()
      return (order.length > 0 ? order : defaultValue) as TValue | undefined
    }
    if (key === 'providerTimestamps') {
      const timestamps = this.configTables.getProviderTimestamps()
      return (Object.keys(timestamps).length > 0 ? timestamps : defaultValue) as TValue | undefined
    }
    if (this.isModelStatusKey(key)) {
      const status = this.configTables.getModelStatus(key)
      return (status ?? defaultValue) as TValue | undefined
    }

    const value = this.legacyStore.get<TValue>(key)
    return value === undefined ? defaultValue : value
  }

  set(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
    if (typeof keyOrValues !== 'string') {
      this.setMany(keyOrValues)
      return
    }

    const key = keyOrValues
    if (key === 'providers' && Array.isArray(value)) {
      const providers = value as LLM_PROVIDER[]
      this.configTables.replaceProviders(
        providers,
        providers.map((provider) => provider.id),
        this.configTables.getProviderTimestamps()
      )
      return
    }
    if (key === 'providerOrder' && Array.isArray(value)) {
      this.configTables.setProviderOrder(
        value.filter((item): item is string => typeof item === 'string')
      )
      return
    }
    if (key === 'providerTimestamps' && isRecord(value)) {
      this.configTables.setProviderTimestamps(
        Object.fromEntries(
          Object.entries(value).filter((entry): entry is [string, number] => {
            return typeof entry[1] === 'number' && Number.isFinite(entry[1])
          })
        )
      )
      return
    }
    if (this.isModelStatusKey(key)) {
      const parsed = this.parseModelStatusKey(key)
      this.configTables.setModelStatus(key, parsed.providerId, parsed.modelId, Boolean(value))
      return
    }

    this.legacyStore.set(key, value)
  }

  delete(key: string): void {
    if (this.isModelStatusKey(key)) {
      this.configTables.deleteModelStatus(key)
      return
    }
    this.legacyStore.delete(key)
  }

  has(key: string): boolean {
    if (key === 'providers') {
      return this.configTables.listProviders().length > 0
    }
    if (key === 'providerOrder') {
      return this.configTables.getProviderOrder().length > 0
    }
    if (key === 'providerTimestamps') {
      return Object.keys(this.configTables.getProviderTimestamps()).length > 0
    }
    if (this.isModelStatusKey(key)) {
      return this.configTables.hasModelStatus(key)
    }
    return typeof this.legacyStore.has === 'function'
      ? this.legacyStore.has(key)
      : this.legacyStore.get(key) !== undefined
  }

  private isModelStatusKey(key: string): boolean {
    return key.startsWith(MODEL_STATUS_KEY_PREFIX)
  }

  private parseModelStatusKey(key: string): { providerId: string; modelId: string } {
    const suffix = key.slice(MODEL_STATUS_KEY_PREFIX.length)
    const providerIds = this.configTables
      .listProviders()
      .map((provider) => provider.id)
      .sort((a, b) => b.length - a.length)
    const matchedProvider = providerIds.find((providerId) => suffix.startsWith(`${providerId}_`))

    if (matchedProvider) {
      return {
        providerId: matchedProvider,
        modelId: suffix.slice(matchedProvider.length + 1)
      }
    }

    const separatorIndex = suffix.indexOf('_')
    if (separatorIndex === -1) {
      return { providerId: '', modelId: suffix }
    }
    return {
      providerId: suffix.slice(0, separatorIndex),
      modelId: suffix.slice(separatorIndex + 1)
    }
  }

  private setMany(values: Record<string, unknown>): void {
    for (const [key, nextValue] of Object.entries(values)) {
      this.set(key, nextValue)
    }
  }
}

export class ProviderModelDbStore implements StoreLike<IModelStore & Record<string, unknown>> {
  constructor(
    private readonly providerId: string,
    private readonly configTables: ConfigTables
  ) {}

  get store(): IModelStore & Record<string, unknown> {
    return {
      models: this.configTables.listProviderModels(this.providerId, 'provider'),
      custom_models: this.configTables.listProviderModels(this.providerId, 'custom')
    }
  }

  get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
    if (key === 'models') {
      return this.configTables.listProviderModels(this.providerId, 'provider') as TValue
    }
    if (key === 'custom_models') {
      return this.configTables.listProviderModels(this.providerId, 'custom') as TValue
    }
    return defaultValue
  }

  set(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
    if (typeof keyOrValues !== 'string') {
      for (const [key, nextValue] of Object.entries(keyOrValues)) {
        this.set(key, nextValue)
      }
      return
    }

    if (keyOrValues === 'models' && Array.isArray(value)) {
      this.configTables.replaceProviderModels(this.providerId, 'provider', value as MODEL_META[])
      return
    }
    if (keyOrValues === 'custom_models' && Array.isArray(value)) {
      this.configTables.replaceProviderModels(this.providerId, 'custom', value as MODEL_META[])
    }
  }

  delete(key: string): void {
    if (key === 'models') {
      this.configTables.replaceProviderModels(this.providerId, 'provider', [])
      return
    }
    if (key === 'custom_models') {
      this.configTables.replaceProviderModels(this.providerId, 'custom', [])
    }
  }

  clear(): void {
    this.configTables.clearProviderModels(this.providerId)
  }
}

export class ModelConfigDbStore implements StoreLike<Record<string, unknown>> {
  constructor(private readonly configTables: ConfigTables) {}

  get store(): Record<string, unknown> {
    return this.configTables.listModelConfigStore()
  }

  get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
    const value = this.configTables.getModelConfigStoreEntry<TValue>(key)
    return value === undefined ? defaultValue : value
  }

  set(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
    if (typeof keyOrValues !== 'string') {
      for (const [key, nextValue] of Object.entries(keyOrValues)) {
        this.set(key, nextValue)
      }
      return
    }
    this.configTables.setModelConfigStoreEntry(keyOrValues, value)
  }

  delete(key: string): void {
    this.configTables.deleteModelConfigStoreEntry(key)
  }

  clear(): void {
    this.configTables.clearModelConfigStore()
  }

  has(key: string): boolean {
    return this.configTables.hasModelConfigStoreEntry(key)
  }
}

export class McpDbStore implements StoreLike<Record<string, unknown>> {
  constructor(
    private readonly legacyStore: LegacyStore,
    private readonly configTables: ConfigTables
  ) {}

  get store(): Record<string, unknown> {
    return {
      ...this.legacyStore.store,
      ...this.configTables.listMcpSettings(),
      mcpServers: this.configTables.listMcpServers()
    }
  }

  get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
    if (key === 'mcpServers') {
      const servers = this.configTables.listMcpServers()
      return (Object.keys(servers).length > 0 ? servers : defaultValue) as TValue | undefined
    }
    const value = this.configTables.getMcpSetting<TValue>(key)
    if (value !== undefined) {
      return value
    }
    const legacyValue = this.legacyStore.get<TValue>(key)
    return legacyValue === undefined ? defaultValue : legacyValue
  }

  set(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
    if (typeof keyOrValues !== 'string') {
      for (const [key, nextValue] of Object.entries(keyOrValues)) {
        this.set(key, nextValue)
      }
      return
    }

    if (keyOrValues === 'mcpServers' && isRecord(value)) {
      this.configTables.replaceMcpServers(value as Record<string, MCPServerConfig>)
      return
    }
    this.configTables.setMcpSetting(keyOrValues, value)
  }

  delete(key: string): void {
    if (key === 'mcpServers') {
      this.configTables.replaceMcpServers({})
      return
    }
    this.configTables.deleteMcpSetting(key)
  }

  has(key: string): boolean {
    if (key === 'mcpServers') {
      return Object.keys(this.configTables.listMcpServers()).length > 0
    }
    return (
      this.configTables.getMcpSetting(key) !== undefined ||
      (typeof this.legacyStore.has === 'function'
        ? this.legacyStore.has(key)
        : this.legacyStore.get(key) !== undefined)
    )
  }
}

export class AcpDbStore implements StoreLike<Record<string, unknown>> {
  constructor(
    private readonly legacyStore: LegacyStore,
    private readonly configTables: ConfigTables
  ) {}

  get store(): Record<string, unknown> {
    return {
      ...this.legacyStore.store,
      ...this.configTables.listAgentSettings(),
      enabled: this.configTables.getAgentSetting<boolean>('enabled'),
      sharedMcpSelections: this.configTables.getAgentMcpSelections(SHARED_AGENT_MCP_SELECTION_ID)
    }
  }

  get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
    if (key === 'sharedMcpSelections') {
      const selections = this.configTables.getAgentMcpSelections(SHARED_AGENT_MCP_SELECTION_ID)
      return (selections.length > 0 ? selections : defaultValue) as TValue | undefined
    }

    if (key === 'enabled' || key === 'version') {
      const value = this.configTables.getAgentSetting<TValue>(key)
      if (value !== undefined) {
        return value
      }
    }

    const legacyValue = this.legacyStore.get<TValue>(key)
    return legacyValue === undefined ? defaultValue : clone(legacyValue)
  }

  set(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
    if (typeof keyOrValues !== 'string') {
      for (const [key, nextValue] of Object.entries(keyOrValues)) {
        this.set(key, nextValue)
      }
      return
    }

    if (keyOrValues === 'sharedMcpSelections' && Array.isArray(value)) {
      this.configTables.setAgentMcpSelections(
        value.filter((item): item is string => typeof item === 'string')
      )
      return
    }
    if (keyOrValues === 'enabled' || keyOrValues === 'version') {
      this.configTables.setAgentSetting(keyOrValues, value)
      return
    }
    this.legacyStore.set(keyOrValues, value)
  }

  delete(key: string): void {
    if (key === 'sharedMcpSelections') {
      this.configTables.setAgentMcpSelections([])
      return
    }
    if (key === 'enabled' || key === 'version') {
      this.configTables.deleteAgentSetting(key)
      return
    }
    this.legacyStore.delete(key)
  }
}
