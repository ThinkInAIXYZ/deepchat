import type { AppSettingsTable } from './data/tables/appSettingsTable'
import type { StoreLike } from '@/config/storeLike'

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
type AppSettingsTableProvider = () => AppSettingsTable

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export class AppSettingsDbBackedStore implements StoreLike<Record<string, unknown>> {
  readonly path?: string

  constructor(
    private readonly legacyStore: LegacyStore,
    private readonly getAppSettingsTable: AppSettingsTableProvider
  ) {
    this.path = legacyStore.path
  }

  private get appSettingsTable(): AppSettingsTable {
    return this.getAppSettingsTable()
  }

  get store(): Record<string, unknown> {
    return {
      ...this.getLegacyStoreSnapshot(),
      ...this.appSettingsTable.listAppSettings()
    }
  }

  get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
    if (this.isSensitiveAppSettingKey(key)) {
      const value = this.appSettingsTable.getAppSetting<TValue>(key)
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
    if (this.isSensitiveAppSettingKey(key)) {
      this.appSettingsTable.setAppSetting(key, value, true)
      return
    }

    this.legacyStore.set(key, value)
  }

  delete(key: string): void {
    if (this.isSensitiveAppSettingKey(key)) {
      this.appSettingsTable.deleteAppSetting(key)
      return
    }
    this.legacyStore.delete(key)
  }

  has(key: string): boolean {
    if (this.isSensitiveAppSettingKey(key)) {
      return this.appSettingsTable.hasAppSetting(key)
    }
    return this.hasLegacyKey(key)
  }

  private isSensitiveAppSettingKey(key: string): boolean {
    return SENSITIVE_APP_SETTING_KEY_SET.has(key)
  }

  private setMany(values: Record<string, unknown>): void {
    for (const [key, nextValue] of Object.entries(values)) {
      this.set(key, nextValue)
    }
  }

  private getLegacyStoreSnapshot(): Record<string, unknown> {
    const snapshot = { ...this.legacyStore.store }
    for (const key of Object.keys(snapshot)) {
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
