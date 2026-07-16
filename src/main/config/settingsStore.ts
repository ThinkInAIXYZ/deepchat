import type { SettingsDatabase } from '@/settings/data/database'
import { AppSettingsDbBackedStore } from '@/settings/appSettingsDbStore'
import type { StoreLike } from '@/config/storeLike'
import ElectronStore from 'electron-store'
import path from 'node:path'
import { app } from 'electron'

export function createSettingsStore(): SettingsStore {
  const userDataPath = app.getPath('userData')
  return new SettingsStore(
    new ElectronStore<Record<string, unknown>>({
      name: 'app-settings',
      defaults: {
        language: 'system',
        providers: [],
        closeToQuit: false,
        proxyMode: 'system',
        customProxyUrl: '',
        artifactsEffectEnabled: true,
        searchPreviewEnabled: true,
        contentProtectionEnabled: false,
        privacyModeEnabled: false,
        syncEnabled: false,
        syncFolderPath: path.join(userDataPath, 'sync'),
        lastSyncTime: 0,
        copyWithCotEnabled: true,
        autoCompactionEnabled: true,
        autoCompactionTriggerThreshold: 80,
        autoCompactionRetainRecentPairs: 2,
        loggingEnabled: false,
        floatingButtonEnabled: false,
        fontFamily: '',
        codeFontFamily: '',
        default_system_prompt: '',
        skillsPath: path.join(app.getPath('home'), '.deepchat', 'skills'),
        enableSkills: true,
        skillDraftSuggestionsEnabled: false,
        appVersion: app.getVersion(),
        hooksNotifications: { hooks: [] }
      }
    }) as unknown as StoreLike<Record<string, unknown>>
  )
}

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

  attachDatabase(database: SettingsDatabase): void {
    if (this.isDatabaseAttached) {
      throw new Error('Settings database is already attached')
    }
    this.activeStore = new AppSettingsDbBackedStore(
      this.legacyStore,
      () => database.appSettingsTable
    )
  }

  getLegacy<TValue = unknown>(key: string): TValue | undefined {
    return this.legacyStore.get<TValue>(key)
  }

  deleteLegacy(key: string): void {
    this.legacyStore.delete(key)
  }
}
