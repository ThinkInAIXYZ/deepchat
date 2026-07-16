import type { LLM_PROVIDER } from '@shared/presenter'
import type { ConfigTables } from './data/tables/configTables'
import type { StoreLike } from '@/config/storeLike'

const MODEL_STATUS_KEY_PREFIX = 'model_status_'

export const SENSITIVE_APP_SETTING_KEYS = [
  'remoteControl',
  'mcprouterApiKey',
  'nowledgeMemConfig',
  'hooksNotifications',
  'knowledgeConfigs',
  'customPrompts',
  'systemPrompts',
  'skills.managementState'
] as const

const SENSITIVE_APP_SETTING_KEY_SET = new Set<string>(SENSITIVE_APP_SETTING_KEYS)

type LegacyStore = StoreLike<Record<string, unknown>>
type ConfigTablesProvider = () => ConfigTables

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export class AppSettingsDbBackedStore implements StoreLike<Record<string, unknown>> {
  readonly path?: string

  constructor(
    private readonly legacyStore: LegacyStore,
    private readonly getConfigTables: ConfigTablesProvider
  ) {
    this.path = legacyStore.path
  }

  private get configTables(): ConfigTables {
    return this.getConfigTables()
  }

  get store(): Record<string, unknown> {
    const providers = this.configTables.listProviders()
    const providerOrder = this.configTables.getProviderOrder()
    const providerTimestamps = this.configTables.getProviderTimestamps()
    const modelStatusEntries = this.configTables.listModelStatusEntries()
    return {
      ...this.getLegacyStoreSnapshot(),
      providers,
      providerOrder,
      providerTimestamps,
      ...modelStatusEntries
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
      return status === undefined ? defaultValue : (status as TValue)
    }
    if (this.isSensitiveAppSettingKey(key)) {
      const value = this.configTables.getAppSetting<TValue>(key)
      return value === undefined ? defaultValue : clone(value)
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
    if (this.isSensitiveAppSettingKey(key)) {
      this.configTables.setAppSetting(key, value, true)
      return
    }

    this.legacyStore.set(key, value)
  }

  delete(key: string): void {
    if (this.isModelStatusKey(key)) {
      this.configTables.deleteModelStatus(key)
      return
    }
    if (this.isSensitiveAppSettingKey(key)) {
      this.configTables.deleteAppSetting(key)
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
    if (this.isSensitiveAppSettingKey(key)) {
      return this.configTables.hasAppSetting(key)
    }
    return this.hasLegacyKey(key)
  }

  private isModelStatusKey(key: string): boolean {
    return key.startsWith(MODEL_STATUS_KEY_PREFIX)
  }

  private isSensitiveAppSettingKey(key: string): boolean {
    return SENSITIVE_APP_SETTING_KEY_SET.has(key)
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

  private getLegacyStoreSnapshot(): Record<string, unknown> {
    const snapshot = { ...this.legacyStore.store }
    delete snapshot.providers
    delete snapshot.providerOrder
    delete snapshot.providerTimestamps
    for (const key of Object.keys(snapshot)) {
      if (this.isModelStatusKey(key)) {
        delete snapshot[key]
      }
      if (this.isSensitiveAppSettingKey(key)) {
        delete snapshot[key]
      }
    }
    return snapshot
  }

  private hasLegacyKey(key: string): boolean {
    return typeof this.legacyStore.has === 'function'
      ? this.legacyStore.has(key)
      : this.legacyStore.get(key) !== undefined
  }
}
