import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { SecretHost, SecretStorageBackend } from '../secretHost'
import { nodeAppHost } from './appHost'

/**
 * Secret storage for the sidecar.
 *
 * A Node process has no OS credential store, so this keeps a 32-byte master key
 * in the app's user-data directory with `0600` permissions and encrypts values
 * with AES-256-GCM. That protects the settings files from casual reads but not
 * from a process running as the same user — a real deployment must keep the
 * master key in `mygo.Secrets` and inject it into the sidecar instead.
 */
const KEY_BYTES = 32
const KEY_FILE = 'sidecar-secret-key'

const readOrCreateKey = (): Buffer => {
  const directory = nodeAppHost.getPath('userData')
  const keyPath = path.join(directory, KEY_FILE)
  if (existsSync(keyPath)) {
    const existing = readFileSync(keyPath)
    if (existing.length === KEY_BYTES) {
      return existing
    }
  }

  mkdirSync(directory, { recursive: true })
  const key = randomBytes(KEY_BYTES)
  writeFileSync(keyPath, key, { mode: 0o600 })
  return key
}

let cachedKey: Buffer | null = null

const masterKey = (): Buffer => {
  cachedKey ??= readOrCreateKey()
  return cachedKey
}

export const nodeSecretHost: SecretHost = {
  isAvailable(): boolean {
    return true
  },

  encryptString(value: string): Buffer {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', masterKey(), iv)
    const encrypted = Buffer.concat([cipher.update(value, 'utf-8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
  },

  decryptString(value: Buffer): string {
    if (value.length < 12 + 16) {
      throw new Error('Secret payload is too short to decrypt')
    }
    const iv = value.subarray(0, 12)
    const tag = value.subarray(12, 28)
    const encrypted = value.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', masterKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8')
  },

  selectedBackend(): SecretStorageBackend | undefined {
    return process.platform === 'linux' ? 'unknown' : undefined
  },

  isInsecure(): boolean {
    // The key file is only as strong as the user's file permissions, so callers that
    // require an OS-backed store must treat the sidecar as insecure.
    return true
  }
}

/** Canonical name so the build can swap this module in for the electron one. */
export const secretHost = nodeSecretHost
