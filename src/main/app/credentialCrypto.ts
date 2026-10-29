import { safeStorage } from 'electron'
import type { CredentialCryptoPort } from '@/config/secretStore'

export const credentialCrypto: CredentialCryptoPort = {
  isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
  encrypt: async (value) => (await safeStorage.encryptStringAsync(value)).toString('base64'),
  decrypt: async (wrapped) =>
    (await safeStorage.decryptStringAsync(Buffer.from(wrapped, 'base64'))).result
}

export const secureCredentialCrypto: CredentialCryptoPort = {
  ...credentialCrypto,
  isAvailable: async () => {
    if (!(await credentialCrypto.isAvailable())) return false
    if (process.platform !== 'linux') return true
    try {
      return safeStorage.getSelectedStorageBackend() !== 'basic_text'
    } catch {
      return false
    }
  }
}
