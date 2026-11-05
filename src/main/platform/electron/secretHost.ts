import { safeStorage } from 'electron'
import type { SecretHost, SecretStorageBackend } from '../secretHost'

/**
 * Electron implementation of the secret storage boundary.
 *
 * Every method swallows platform errors and reports them the way the call sites
 * did before this boundary existed: `isAvailable` and `selectedBackend` never
 * throw, `encryptString` and `decryptString` propagate the original error.
 */
export const electronSecretHost: SecretHost = {
  isAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  },

  encryptString(value: string): Buffer {
    return safeStorage.encryptString(value)
  },

  decryptString(value: Buffer): string {
    return safeStorage.decryptString(value)
  },

  selectedBackend(): SecretStorageBackend | undefined {
    if (process.platform !== 'linux') {
      return undefined
    }

    try {
      return safeStorage.getSelectedStorageBackend()
    } catch {
      return undefined
    }
  },

  isInsecure(): boolean {
    return electronSecretHost.selectedBackend() === 'basic_text'
  }
}
