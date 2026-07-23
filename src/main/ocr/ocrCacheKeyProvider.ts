import { randomBytes, randomUUID } from 'node:crypto'
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { safeStorage } from 'electron'

const OCR_CACHE_KEY_BYTES = 32

export interface OcrCacheKeyProvider {
  loadOrCreateKey(): Promise<Buffer | null>
}

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
  getSelectedStorageBackend?():
    | 'basic_text'
    | 'gnome_libsecret'
    | 'kwallet'
    | 'kwallet5'
    | 'kwallet6'
    | 'unknown'
}

interface WrappedOcrCacheKey {
  schemaVersion: 1
  wrappedKey: string
}

export class SafeStorageOcrCacheKeyProvider implements OcrCacheKeyProvider {
  constructor(
    private readonly keyFilePath: string,
    private readonly encryption: SafeStorageAdapter = safeStorage,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  async loadOrCreateKey(): Promise<Buffer | null> {
    if (!this.isEncryptionAvailable()) return null

    let replaceUnreadableKey = false
    try {
      const stored = await this.readStoredKey()
      if (stored) return stored
    } catch {
      replaceUnreadableKey = true
      // The OCR cache is derived data. Rotating an unreadable wrapping key is safe because the
      // artifact store will rebuild an encrypted database that no longer opens with the new key.
    }

    const key = randomBytes(OCR_CACHE_KEY_BYTES)
    try {
      await this.writeStoredKey(key, replaceUnreadableKey)
      return key
    } catch (error) {
      key.fill(0)
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        try {
          return await this.readStoredKey()
        } catch {
          return null
        }
      }
      return null
    }
  }

  private isEncryptionAvailable(): boolean {
    try {
      if (!this.encryption.isEncryptionAvailable()) return false
      if (this.platform !== 'linux') return true
      const backend = this.encryption.getSelectedStorageBackend?.()
      return backend !== undefined && backend !== 'basic_text' && backend !== 'unknown'
    } catch {
      return false
    }
  }

  private async readStoredKey(): Promise<Buffer | null> {
    let serialized: string
    try {
      serialized = await readFile(this.keyFilePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }

    const parsed = JSON.parse(serialized) as unknown
    if (!isWrappedOcrCacheKey(parsed)) throw new Error('Invalid OCR cache key metadata')
    const unwrapped = this.encryption.decryptString(Buffer.from(parsed.wrappedKey, 'base64'))
    const key = Buffer.from(unwrapped, 'base64')
    if (key.byteLength !== OCR_CACHE_KEY_BYTES) {
      key.fill(0)
      throw new Error('Invalid OCR cache key length')
    }
    return key
  }

  private async writeStoredKey(key: Buffer, replaceExisting: boolean): Promise<void> {
    const wrapped: WrappedOcrCacheKey = {
      schemaVersion: 1,
      wrappedKey: Buffer.from(this.encryption.encryptString(key.toString('base64'))).toString(
        'base64'
      )
    }
    const directory = path.dirname(this.keyFilePath)
    const temporaryPath = path.join(directory, `.ocr-cache-key-${randomUUID()}.tmp`)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    try {
      await writeFile(temporaryPath, `${JSON.stringify(wrapped)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx'
      })
      if (replaceExisting) {
        // Windows rename does not replace an existing file. The target was already proven
        // unreadable, so a crash-safe derived-cache rotation may remove it before installation.
        await rm(this.keyFilePath, { force: true })
        await rename(temporaryPath, this.keyFilePath)
      } else {
        // Linking a fully-written sibling is an atomic create-if-absent operation. It avoids a
        // concurrent first-use race overwriting a valid random key on POSIX.
        await link(temporaryPath, this.keyFilePath)
      }
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }
}

function isWrappedOcrCacheKey(value: unknown): value is WrappedOcrCacheKey {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return candidate.schemaVersion === 1 && typeof candidate.wrappedKey === 'string'
}
