import { safeStorage } from 'electron'
import type { SettingsStore } from './settingsStore'

export class SecretStore {
  constructor(private readonly settings: SettingsStore) {}

  isAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  get(key: string): string {
    const wrapped = this.settings.get<string>(key)
    if (!wrapped) {
      return ''
    }
    try {
      return safeStorage.decryptString(Buffer.from(wrapped, 'base64'))
    } catch (error) {
      console.error(`[SecretStore] Failed to decrypt ${key}:`, error)
      return ''
    }
  }

  getWrapped(key: string): string | undefined {
    return this.settings.get<string>(key)
  }

  wrap(value: string): string {
    if (!this.isAvailable()) {
      throw new Error('sync.error.safeStorageUnavailable')
    }
    return Buffer.from(safeStorage.encryptString(value)).toString('base64')
  }

  setWrapped(key: string, wrapped: string): void {
    this.settings.set(key, wrapped)
  }

  restoreWrapped(key: string, wrapped: string | undefined): void {
    if (wrapped === undefined) {
      this.settings.delete(key)
      return
    }
    this.settings.set(key, wrapped)
  }
}
