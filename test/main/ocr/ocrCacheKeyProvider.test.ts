import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  SafeStorageOcrCacheKeyProvider,
  type SafeStorageAdapter
} from '../../../src/main/ocr/ocrCacheKeyProvider'

function createEncryptionAdapter(available = true): SafeStorageAdapter {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value) => Buffer.from(`wrapped:${Buffer.from(value).toString('base64')}`),
    decryptString: (value) => {
      const wrapped = value.toString('utf8')
      if (!wrapped.startsWith('wrapped:')) throw new Error('invalid wrapped value')
      return Buffer.from(wrapped.slice('wrapped:'.length), 'base64').toString('utf8')
    }
  }
}

describe('SafeStorageOcrCacheKeyProvider', () => {
  let tempDir: string
  let keyPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-ocr-key-test-'))
    keyPath = path.join(tempDir, 'ocr-cache-key.json')
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('persists only a safeStorage-wrapped random key', async () => {
    const encryption = createEncryptionAdapter()
    const first = await new SafeStorageOcrCacheKeyProvider(keyPath, encryption).loadOrCreateKey()
    const serialized = await readFile(keyPath, 'utf8')
    const second = await new SafeStorageOcrCacheKeyProvider(keyPath, encryption).loadOrCreateKey()

    expect(first).toHaveLength(32)
    expect(second).toEqual(first)
    expect(serialized).toContain('wrappedKey')
    expect(serialized).not.toContain(first!.toString('base64'))
    if (process.platform !== 'win32') {
      expect((await stat(keyPath)).mode & 0o777).toBe(0o600)
    }
  })

  it('returns no key when safeStorage is unavailable', async () => {
    const key = await new SafeStorageOcrCacheKeyProvider(
      keyPath,
      createEncryptionAdapter(false)
    ).loadOrCreateKey()

    expect(key).toBeNull()
    await expect(stat(keyPath)).rejects.toThrow()
  })

  it.each(['basic_text', 'unknown'] as const)(
    'uses memory-only caching for the insecure Linux %s backend',
    async (backend) => {
      const encryption = createEncryptionAdapter()
      encryption.getSelectedStorageBackend = () => backend
      const key = await new SafeStorageOcrCacheKeyProvider(
        keyPath,
        encryption,
        'linux'
      ).loadOrCreateKey()

      expect(key).toBeNull()
      await expect(stat(keyPath)).rejects.toThrow()
    }
  )

  it('rotates corrupt wrapped metadata because the cache is derived data', async () => {
    await writeFile(keyPath, '{"schemaVersion":1,"wrappedKey":"invalid"}\n')
    const key = await new SafeStorageOcrCacheKeyProvider(
      keyPath,
      createEncryptionAdapter()
    ).loadOrCreateKey()

    expect(key).toHaveLength(32)
    await expect(
      new SafeStorageOcrCacheKeyProvider(keyPath, createEncryptionAdapter()).loadOrCreateKey()
    ).resolves.toEqual(key)
  })

  it('converges on one key during concurrent first use', async () => {
    const encryption = createEncryptionAdapter()
    const [first, second] = await Promise.all([
      new SafeStorageOcrCacheKeyProvider(keyPath, encryption).loadOrCreateKey(),
      new SafeStorageOcrCacheKeyProvider(keyPath, encryption).loadOrCreateKey()
    ])

    expect(first).toHaveLength(32)
    expect(second).toEqual(first)
  })
})
