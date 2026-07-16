import type { MODEL_META } from '@shared/presenter'
import type { SettingsTables } from '@/settings/data/tables/settingsTables'
import type { StoreLike } from '@/config/storeLike'
import type { IModelStore } from './providerModelHelper'

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
