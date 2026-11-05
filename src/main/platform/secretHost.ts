/**
 * Secret storage boundary.
 *
 * DeepChat keeps ciphertext next to the setting it protects (base64 wrapped in
 * SQLite), so the host only has to encrypt and decrypt strings. Electron
 * provides that through `safeStorage`; a mygo shell can implement the same
 * interface by keeping one master key in `mygo.Secrets` and encrypting with
 * AES-GCM in Go, which is why this boundary does not expose Electron types.
 */
export type SecretStorageBackend =
  | 'basic_text'
  | 'gnome_libsecret'
  | 'kwallet'
  | 'kwallet5'
  | 'kwallet6'
  | 'unknown'

export interface SecretHost {
  /** Whether the operating system can protect secrets for this user. */
  isAvailable(): boolean
  /** Encrypts a UTF-8 string with the OS credential store. */
  encryptString(value: string): Buffer
  /** Reverses `encryptString`. Throws when the payload cannot be decrypted. */
  decryptString(value: Buffer): string
  /** The Linux keyring backend in use; `undefined` on other platforms. */
  selectedBackend(): SecretStorageBackend | undefined
  /**
   * Whether the OS store would leave secrets readable by other users, which is
   * Linux's `basic_text` backend. Callers treat it as "not protected".
   */
  isInsecure(): boolean
}

export { electronSecretHost as secretHost } from './electron/secretHost'
