import type { MODEL_META } from '@shared/presenter'
import type { ConfigTables } from '@/settings/data/tables/configTables'
import type { StoreLike } from '@/config/storeLike'
import type { IModelStore } from './providerModelHelper'

export class ProviderModelDbStore implements StoreLike<IModelStore & Record<string, unknown>> {
  constructor(
    private readonly providerId: string,
    private readonly getConfigTables: () => ConfigTables
  ) {}

  private get configTables(): ConfigTables {
    return this.getConfigTables()
  }

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
      for (const [key, nextValue] of Object.entries(keyOrValues)) this.set(key, nextValue)
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
    if (key === 'models') this.configTables.replaceProviderModels(this.providerId, 'provider', [])
    if (key === 'custom_models') {
      this.configTables.replaceProviderModels(this.providerId, 'custom', [])
    }
  }

  clear(): void {
    this.configTables.clearProviderModels(this.providerId)
  }
}

export class ModelConfigDbStore implements StoreLike<Record<string, unknown>> {
  constructor(private readonly getConfigTables: () => ConfigTables) {}

  private get configTables(): ConfigTables {
    return this.getConfigTables()
  }

  get store(): Record<string, unknown> {
    return this.configTables.listModelConfigStore()
  }

  get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
    const value = this.configTables.getModelConfigStoreEntry<TValue>(key)
    return value === undefined ? defaultValue : value
  }

  set(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
    if (typeof keyOrValues !== 'string') {
      for (const [key, nextValue] of Object.entries(keyOrValues)) this.set(key, nextValue)
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
