import type { ConfigTables } from '@/config/data/tables/configTables'
import { AppSettingsDbBackedStore } from './configDbStores'
import type { StoreLike } from './storeLike'

export class SettingsStore implements StoreLike<Record<string, unknown>> {
  private activeStore: StoreLike<Record<string, unknown>>

  constructor(private readonly legacyStore: StoreLike<Record<string, unknown>>) {
    this.activeStore = legacyStore
  }

  get path(): string | undefined {
    return this.activeStore.path
  }

  get store(): Record<string, unknown> {
    return this.activeStore.store
  }

  get isDatabaseAttached(): boolean {
    return this.activeStore !== this.legacyStore
  }

  get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
    return this.activeStore.get(key, defaultValue as TValue)
  }

  set(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
    if (typeof keyOrValues === 'string') {
      this.activeStore.set(keyOrValues, value)
      return
    }
    this.activeStore.set(keyOrValues)
  }

  delete(key: string): void {
    this.activeStore.delete(key)
  }

  has(key: string): boolean {
    return typeof this.activeStore.has === 'function'
      ? this.activeStore.has(key)
      : this.activeStore.get(key) !== undefined
  }

  attachDatabase(configTables: ConfigTables): void {
    if (this.isDatabaseAttached) {
      throw new Error('Settings database is already attached')
    }
    this.activeStore = new AppSettingsDbBackedStore(this.legacyStore, configTables)
  }

  getLegacy<TValue = unknown>(key: string): TValue | undefined {
    return this.legacyStore.get<TValue>(key)
  }

  deleteLegacy(key: string): void {
    this.legacyStore.delete(key)
  }
}
