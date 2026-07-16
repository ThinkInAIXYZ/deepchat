import type { LLM_PROVIDER, MODEL_META } from '@shared/types/provider'
import type { ProviderSettingsTable } from './data/settingsTable'
import type { StoreLike } from '@/config/storeLike'
import type { IModelStore } from './providerModelHelper'

const MODEL_STATUS_KEY_PREFIX = 'model_status_'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export class ProviderDbStore implements StoreLike<Record<string, unknown>> {
  readonly path?: string

  constructor(
    private readonly settings: StoreLike<Record<string, unknown>>,
    private readonly getSettingsTable: () => ProviderSettingsTable
  ) {
    this.path = settings.path
  }

  private get settingsTable(): ProviderSettingsTable {
    return this.getSettingsTable()
  }

  get store(): Record<string, unknown> {
    return {
      ...this.getSettingsSnapshot(),
      providers: this.settingsTable.listProviders(),
      providerOrder: this.settingsTable.getProviderOrder(),
      providerTimestamps: this.settingsTable.getProviderTimestamps(),
      ...this.settingsTable.listModelStatusEntries()
    }
  }

  get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
    if (key === 'providers') {
      const providers = this.settingsTable.listProviders()
      return (providers.length > 0 ? providers : defaultValue) as TValue | undefined
    }
    if (key === 'providerOrder') {
      const order = this.settingsTable.getProviderOrder()
      return (order.length > 0 ? order : defaultValue) as TValue | undefined
    }
    if (key === 'providerTimestamps') {
      const timestamps = this.settingsTable.getProviderTimestamps()
      return (Object.keys(timestamps).length > 0 ? timestamps : defaultValue) as TValue | undefined
    }
    if (this.isModelStatusKey(key)) {
      const status = this.settingsTable.getModelStatus(key)
      return status === undefined ? defaultValue : (status as TValue)
    }

    return this.settings.get(key, defaultValue)
  }

  set(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
    if (typeof keyOrValues !== 'string') {
      for (const [key, nextValue] of Object.entries(keyOrValues)) {
        this.set(key, nextValue)
      }
      return
    }

    if (keyOrValues === 'providers' && Array.isArray(value)) {
      const providers = value as LLM_PROVIDER[]
      this.settingsTable.replaceProviders(
        providers,
        providers.map((provider) => provider.id),
        this.settingsTable.getProviderTimestamps()
      )
      return
    }
    if (keyOrValues === 'providerOrder' && Array.isArray(value)) {
      this.settingsTable.setProviderOrder(
        value.filter((item): item is string => typeof item === 'string')
      )
      return
    }
    if (keyOrValues === 'providerTimestamps' && isRecord(value)) {
      this.settingsTable.setProviderTimestamps(
        Object.fromEntries(
          Object.entries(value).filter((entry): entry is [string, number] => {
            return typeof entry[1] === 'number' && Number.isFinite(entry[1])
          })
        )
      )
      return
    }
    if (this.isModelStatusKey(keyOrValues)) {
      const { providerId, modelId } = this.parseModelStatusKey(keyOrValues)
      this.settingsTable.setModelStatus(keyOrValues, providerId, modelId, Boolean(value))
      return
    }

    this.settings.set(keyOrValues, value)
  }

  delete(key: string): void {
    if (this.isModelStatusKey(key)) {
      this.settingsTable.deleteModelStatus(key)
      return
    }
    this.settings.delete(key)
  }

  has(key: string): boolean {
    if (key === 'providers') {
      return this.settingsTable.listProviders().length > 0
    }
    if (key === 'providerOrder') {
      return this.settingsTable.getProviderOrder().length > 0
    }
    if (key === 'providerTimestamps') {
      return Object.keys(this.settingsTable.getProviderTimestamps()).length > 0
    }
    if (this.isModelStatusKey(key)) {
      return this.settingsTable.hasModelStatus(key)
    }
    return typeof this.settings.has === 'function'
      ? this.settings.has(key)
      : this.settings.get(key) !== undefined
  }

  private isModelStatusKey(key: string): boolean {
    return key.startsWith(MODEL_STATUS_KEY_PREFIX)
  }

  private parseModelStatusKey(key: string): { providerId: string; modelId: string } {
    const suffix = key.slice(MODEL_STATUS_KEY_PREFIX.length)
    const providerIds = this.settingsTable
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

  private getSettingsSnapshot(): Record<string, unknown> {
    const snapshot = { ...this.settings.store }
    delete snapshot.providers
    delete snapshot.providerOrder
    delete snapshot.providerTimestamps
    for (const key of Object.keys(snapshot)) {
      if (this.isModelStatusKey(key)) {
        delete snapshot[key]
      }
    }
    return snapshot
  }
}

export class ProviderModelDbStore implements StoreLike<IModelStore & Record<string, unknown>> {
  constructor(
    private readonly providerId: string,
    private readonly getSettingsTable: () => ProviderSettingsTable
  ) {}

  private get settingsTable(): ProviderSettingsTable {
    return this.getSettingsTable()
  }

  get store(): IModelStore & Record<string, unknown> {
    return {
      models: this.settingsTable.listProviderModels(this.providerId, 'provider'),
      custom_models: this.settingsTable.listProviderModels(this.providerId, 'custom')
    }
  }

  get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
    if (key === 'models') {
      return this.settingsTable.listProviderModels(this.providerId, 'provider') as TValue
    }
    if (key === 'custom_models') {
      return this.settingsTable.listProviderModels(this.providerId, 'custom') as TValue
    }
    return defaultValue
  }

  set(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
    if (typeof keyOrValues !== 'string') {
      for (const [key, nextValue] of Object.entries(keyOrValues)) this.set(key, nextValue)
      return
    }
    if (keyOrValues === 'models' && Array.isArray(value)) {
      this.settingsTable.replaceProviderModels(this.providerId, 'provider', value as MODEL_META[])
      return
    }
    if (keyOrValues === 'custom_models' && Array.isArray(value)) {
      this.settingsTable.replaceProviderModels(this.providerId, 'custom', value as MODEL_META[])
    }
  }

  delete(key: string): void {
    if (key === 'models') this.settingsTable.replaceProviderModels(this.providerId, 'provider', [])
    if (key === 'custom_models') {
      this.settingsTable.replaceProviderModels(this.providerId, 'custom', [])
    }
  }

  clear(): void {
    this.settingsTable.clearProviderModels(this.providerId)
  }
}

export class ModelConfigDbStore implements StoreLike<Record<string, unknown>> {
  constructor(private readonly getSettingsTable: () => ProviderSettingsTable) {}

  private get settingsTable(): ProviderSettingsTable {
    return this.getSettingsTable()
  }

  get store(): Record<string, unknown> {
    return this.settingsTable.listModelConfigStore()
  }

  get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
    const value = this.settingsTable.getModelConfigStoreEntry<TValue>(key)
    return value === undefined ? defaultValue : value
  }

  set(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
    if (typeof keyOrValues !== 'string') {
      for (const [key, nextValue] of Object.entries(keyOrValues)) this.set(key, nextValue)
      return
    }
    this.settingsTable.setModelConfigStoreEntry(keyOrValues, value)
  }

  delete(key: string): void {
    this.settingsTable.deleteModelConfigStoreEntry(key)
  }

  clear(): void {
    this.settingsTable.clearModelConfigStore()
  }

  has(key: string): boolean {
    return this.settingsTable.hasModelConfigStoreEntry(key)
  }
}
