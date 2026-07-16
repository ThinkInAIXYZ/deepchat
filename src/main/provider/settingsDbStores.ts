import type { LLM_PROVIDER, MODEL_META } from '@shared/presenter'
import type { SettingsTables } from '@/settings/data/tables/settingsTables'
import type { StoreLike } from '@/config/storeLike'
import type { IModelStore } from './providerModelHelper'

const MODEL_STATUS_KEY_PREFIX = 'model_status_'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export class ProviderDbStore implements StoreLike<Record<string, unknown>> {
  readonly path?: string

  constructor(
    private readonly settings: StoreLike<Record<string, unknown>>,
    private readonly getSettingsTables: () => SettingsTables
  ) {
    this.path = settings.path
  }

  private get settingsTables(): SettingsTables {
    return this.getSettingsTables()
  }

  get store(): Record<string, unknown> {
    return {
      ...this.getSettingsSnapshot(),
      providers: this.settingsTables.listProviders(),
      providerOrder: this.settingsTables.getProviderOrder(),
      providerTimestamps: this.settingsTables.getProviderTimestamps(),
      ...this.settingsTables.listModelStatusEntries()
    }
  }

  get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
    if (key === 'providers') {
      const providers = this.settingsTables.listProviders()
      return (providers.length > 0 ? providers : defaultValue) as TValue | undefined
    }
    if (key === 'providerOrder') {
      const order = this.settingsTables.getProviderOrder()
      return (order.length > 0 ? order : defaultValue) as TValue | undefined
    }
    if (key === 'providerTimestamps') {
      const timestamps = this.settingsTables.getProviderTimestamps()
      return (Object.keys(timestamps).length > 0 ? timestamps : defaultValue) as TValue | undefined
    }
    if (this.isModelStatusKey(key)) {
      const status = this.settingsTables.getModelStatus(key)
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
      this.settingsTables.replaceProviders(
        providers,
        providers.map((provider) => provider.id),
        this.settingsTables.getProviderTimestamps()
      )
      return
    }
    if (keyOrValues === 'providerOrder' && Array.isArray(value)) {
      this.settingsTables.setProviderOrder(
        value.filter((item): item is string => typeof item === 'string')
      )
      return
    }
    if (keyOrValues === 'providerTimestamps' && isRecord(value)) {
      this.settingsTables.setProviderTimestamps(
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
      this.settingsTables.setModelStatus(keyOrValues, providerId, modelId, Boolean(value))
      return
    }

    this.settings.set(keyOrValues, value)
  }

  delete(key: string): void {
    if (this.isModelStatusKey(key)) {
      this.settingsTables.deleteModelStatus(key)
      return
    }
    this.settings.delete(key)
  }

  has(key: string): boolean {
    if (key === 'providers') {
      return this.settingsTables.listProviders().length > 0
    }
    if (key === 'providerOrder') {
      return this.settingsTables.getProviderOrder().length > 0
    }
    if (key === 'providerTimestamps') {
      return Object.keys(this.settingsTables.getProviderTimestamps()).length > 0
    }
    if (this.isModelStatusKey(key)) {
      return this.settingsTables.hasModelStatus(key)
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
    const providerIds = this.settingsTables
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
    private readonly getSettingsTables: () => SettingsTables
  ) {}

  private get settingsTables(): SettingsTables {
    return this.getSettingsTables()
  }

  get store(): IModelStore & Record<string, unknown> {
    return {
      models: this.settingsTables.listProviderModels(this.providerId, 'provider'),
      custom_models: this.settingsTables.listProviderModels(this.providerId, 'custom')
    }
  }

  get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
    if (key === 'models') {
      return this.settingsTables.listProviderModels(this.providerId, 'provider') as TValue
    }
    if (key === 'custom_models') {
      return this.settingsTables.listProviderModels(this.providerId, 'custom') as TValue
    }
    return defaultValue
  }

  set(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
    if (typeof keyOrValues !== 'string') {
      for (const [key, nextValue] of Object.entries(keyOrValues)) this.set(key, nextValue)
      return
    }
    if (keyOrValues === 'models' && Array.isArray(value)) {
      this.settingsTables.replaceProviderModels(this.providerId, 'provider', value as MODEL_META[])
      return
    }
    if (keyOrValues === 'custom_models' && Array.isArray(value)) {
      this.settingsTables.replaceProviderModels(this.providerId, 'custom', value as MODEL_META[])
    }
  }

  delete(key: string): void {
    if (key === 'models') this.settingsTables.replaceProviderModels(this.providerId, 'provider', [])
    if (key === 'custom_models') {
      this.settingsTables.replaceProviderModels(this.providerId, 'custom', [])
    }
  }

  clear(): void {
    this.settingsTables.clearProviderModels(this.providerId)
  }
}

export class ModelConfigDbStore implements StoreLike<Record<string, unknown>> {
  constructor(private readonly getSettingsTables: () => SettingsTables) {}

  private get settingsTables(): SettingsTables {
    return this.getSettingsTables()
  }

  get store(): Record<string, unknown> {
    return this.settingsTables.listModelConfigStore()
  }

  get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
    const value = this.settingsTables.getModelConfigStoreEntry<TValue>(key)
    return value === undefined ? defaultValue : value
  }

  set(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
    if (typeof keyOrValues !== 'string') {
      for (const [key, nextValue] of Object.entries(keyOrValues)) this.set(key, nextValue)
      return
    }
    this.settingsTables.setModelConfigStoreEntry(keyOrValues, value)
  }

  delete(key: string): void {
    this.settingsTables.deleteModelConfigStoreEntry(key)
  }

  clear(): void {
    this.settingsTables.clearModelConfigStore()
  }

  has(key: string): boolean {
    return this.settingsTables.hasModelConfigStoreEntry(key)
  }
}
