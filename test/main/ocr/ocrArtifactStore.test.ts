import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  OcrArtifactStore,
  computeOcrArtifactCacheKey,
  type OcrArtifactIdentity,
  type OcrArtifactValue
} from '../../../src/main/ocr/ocrArtifactStore'
import type { OcrCacheKeyProvider } from '../../../src/main/ocr/ocrCacheKeyProvider'
import type { LightOcrEngineStatus } from '../../../src/main/ocr/lightOcrProtocol'

let sqliteLoadError: unknown
const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch((error) => {
  sqliteLoadError = error
  return null
})
let sqliteAvailable = false
if (sqliteModule) {
  try {
    const smokeDatabase = new sqliteModule.default(':memory:')
    smokeDatabase.close()
    sqliteAvailable = true
  } catch (error) {
    sqliteLoadError = error
    sqliteAvailable = false
  }
}
if (process.env.DEEPCHAT_REQUIRE_NATIVE_SQLITE === '1' && !sqliteAvailable) {
  throw new Error('Native SQLite is required for OCR artifact persistence tests', {
    cause: sqliteLoadError
  })
}
const persistentIt = sqliteAvailable ? it : it.skip

const persistentKey = Buffer.alloc(32, 7)

const keyProvider = (key: Buffer | null): OcrCacheKeyProvider => ({
  loadOrCreateKey: async () => (key ? Buffer.from(key) : null)
})

function engine(qualificationId = 'qualification-a'): LightOcrEngineStatus {
  return {
    coreVersion: 'core-1',
    modelBundleId: 'bundle-1',
    requestedProvider: 'auto',
    strategy: 'bounded-960',
    detection: {
      actualProviderChain: ['coreml', 'cpu'],
      precision: 'fp16',
      qualificationId
    },
    recognition: {
      actualProviderChain: ['coreml', 'cpu'],
      precision: 'fp16',
      qualificationId
    }
  }
}

function cpuEngine(): LightOcrEngineStatus {
  return {
    ...engine('qualification-cpu'),
    detection: {
      actualProviderChain: ['cpu'],
      precision: 'fp32',
      qualificationId: 'qualification-cpu'
    },
    recognition: {
      actualProviderChain: ['cpu'],
      precision: 'fp32',
      qualificationId: 'qualification-cpu'
    }
  }
}

function identity(overrides: Partial<OcrArtifactIdentity> = {}): OcrArtifactIdentity {
  return {
    sourceSha256: 'a'.repeat(64),
    lightOcrVersion: '0.3.4',
    bundleId: 'bundle-1',
    preprocessingRevision: 'preprocess-1',
    strategy: 'bounded-960',
    requestedBackend: 'auto',
    detectionProviderChain: ['coreml', 'cpu'],
    detectionPrecision: 'fp16',
    recognitionProviderChain: ['coreml', 'cpu'],
    recognitionPrecision: 'fp16',
    ...overrides
  }
}

function value(text = 'secret OCR text', qualificationId = 'qualification-a'): OcrArtifactValue {
  return {
    text,
    tokenCount: 4,
    truncated: false,
    mimeType: 'image/png',
    imageWidth: 100,
    imageHeight: 50,
    engine: engine(qualificationId)
  }
}

describe('OcrArtifactStore', () => {
  let tempDir: string
  let dbPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-ocr-cache-test-'))
    dbPath = path.join(tempDir, 'ocr-cache.db')
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  persistentIt('persists encrypted artifacts across store instances', async () => {
    const first = new OcrArtifactStore({ dbPath, keyProvider: keyProvider(persistentKey) })
    await first.put(identity(), value())
    expect(await first.getStats()).toMatchObject({ mode: 'persistent', entryCount: 1 })
    await first.close()

    const databaseBytes = await readFile(dbPath)
    expect(databaseBytes.includes(Buffer.from('secret OCR text'))).toBe(false)

    const second = new OcrArtifactStore({ dbPath, keyProvider: keyProvider(persistentKey) })
    await expect(second.find(identity())).resolves.toMatchObject({
      text: 'secret OCR text',
      engine: { detection: { qualificationId: 'qualification-a' } }
    })
    await second.close()
  })

  persistentIt('rebuilds when the cache main file is missing but a WAL remains', async () => {
    await writeFile(`${dbPath}-wal`, 'leftover-wal')
    const store = new OcrArtifactStore({ dbPath, keyProvider: keyProvider(persistentKey) })

    await expect(store.put(identity(), value('rebuilt'))).resolves.toMatchObject({
      text: 'rebuilt'
    })
    expect(await store.getStats()).toMatchObject({ mode: 'persistent', entryCount: 1 })
    await store.close()
  })

  persistentIt('rebuilds a corrupt derived database with the current key', async () => {
    await writeFile(dbPath, 'not-a-sqlite-database')
    const store = new OcrArtifactStore({ dbPath, keyProvider: keyProvider(persistentKey) })

    await expect(store.put(identity(), value('recovered'))).resolves.toMatchObject({
      text: 'recovered'
    })
    expect(await store.getStats()).toMatchObject({ mode: 'persistent', entryCount: 1 })
    await store.close()
  })

  it('falls back to bounded memory caching without safeStorage', async () => {
    let now = 1_000
    const store = new OcrArtifactStore({
      dbPath,
      keyProvider: keyProvider(null),
      ttlMs: 10,
      leaseMs: 5,
      maxBytes: 300,
      now: () => now
    })
    await store.put(identity(), value('first artifact'))
    expect(await store.find(identity())).toMatchObject({ text: 'first artifact' })
    expect(await store.getStats()).toMatchObject({
      mode: 'memory',
      persistenceUnavailableReason: 'safe_storage_unavailable',
      entryCount: 1
    })

    now += 11
    await store.runMaintenance()
    expect(await store.getStats()).toMatchObject({ entryCount: 0 })
    await store.close()
  })

  it('keeps actual execution details in the key and qualification metadata out of it', async () => {
    const base = identity()
    const distinctIdentities: Array<Partial<OcrArtifactIdentity>> = [
      { sourceSha256: 'b'.repeat(64) },
      { lightOcrVersion: '0.3.1' },
      { bundleId: 'bundle-2' },
      { preprocessingRevision: 'preprocess-2' },
      { strategy: 'tiled-v1' },
      { requestedBackend: 'cpu' },
      { detectionProviderChain: ['cpu'] },
      { detectionPrecision: 'fp32' },
      { recognitionProviderChain: ['cpu'] },
      { recognitionPrecision: 'fp32' }
    ]
    for (const override of distinctIdentities) {
      expect(computeOcrArtifactCacheKey(base)).not.toBe(
        computeOcrArtifactCacheKey(identity(override))
      )
    }

    const store = new OcrArtifactStore({ dbPath, keyProvider: keyProvider(null) })
    const first = await store.put(base, value('same output', 'qualification-a'))
    const second = await store.put(base, value('same output', 'qualification-b'))
    expect(second.cacheKey).toBe(first.cacheKey)
    await expect(store.find(base)).resolves.toMatchObject({
      engine: { detection: { qualificationId: 'qualification-b' } }
    })
    await store.close()
  })

  it('returns only the artifact matching the exact provider and precision identity', async () => {
    const store = new OcrArtifactStore({ dbPath, keyProvider: keyProvider(null) })
    const coreMlIdentity = identity()
    const cpuIdentity = identity({
      detectionProviderChain: ['cpu'],
      detectionPrecision: 'fp32',
      recognitionProviderChain: ['cpu'],
      recognitionPrecision: 'fp32'
    })
    await store.put(coreMlIdentity, value('CoreML result'))
    await store.put(cpuIdentity, { ...value('CPU result'), engine: cpuEngine() })

    await expect(store.find(coreMlIdentity)).resolves.toMatchObject({ text: 'CoreML result' })
    await expect(store.find(cpuIdentity)).resolves.toMatchObject({ text: 'CPU result' })
    await store.close()
  })

  it('protects active leases and evicts oversized entries after the lease expires', async () => {
    let now = 1_000
    const store = new OcrArtifactStore({
      dbPath,
      keyProvider: keyProvider(null),
      maxBytes: 1,
      leaseMs: 5,
      now: () => now
    })
    await store.put(identity(), value())
    expect(await store.getStats()).toMatchObject({ entryCount: 1 })

    now += 6
    await store.runMaintenance()
    expect(await store.getStats()).toMatchObject({ entryCount: 0 })
    await store.close()
  })
})
