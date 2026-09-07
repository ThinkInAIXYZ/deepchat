import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { openSQLiteDatabase } from '../../../src/main/data/databaseConnection'
import {
  PDF_OCR_ARTIFACT_REVISION,
  estimateDocumentOcrTokens,
  type DocumentOcrArtifactIdentity,
  type DocumentOcrArtifactValue
} from '../../../src/main/ocr/documentOcrArtifact'
import {
  OcrArtifactStore,
  computeDocumentOcrArtifactCacheKey
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
    const database = new sqliteModule.default(':memory:')
    database.close()
    sqliteAvailable = true
  } catch (error) {
    sqliteLoadError = error
    sqliteAvailable = false
  }
}
if (process.env.DEEPCHAT_REQUIRE_NATIVE_SQLITE === '1' && !sqliteAvailable) {
  throw new Error('Native SQLite is required for document OCR artifact persistence tests', {
    cause: sqliteLoadError
  })
}
const persistentIt = sqliteAvailable ? it : it.skip

const keyProvider = (key: Buffer | null): OcrCacheKeyProvider => ({
  loadOrCreateKey: async () => (key ? Buffer.from(key) : null)
})

function engine(): LightOcrEngineStatus {
  return {
    coreVersion: 'core-1',
    modelBundleId: 'bundle-1',
    requestedProvider: 'auto',
    strategy: 'bounded-960',
    detection: {
      actualProviderChain: ['coreml', 'cpu'],
      precision: 'fp16',
      qualificationId: 'detection-q'
    },
    recognition: {
      actualProviderChain: ['coreml', 'cpu'],
      precision: 'fp16',
      qualificationId: 'recognition-q'
    }
  }
}

function identity(
  overrides: Partial<DocumentOcrArtifactIdentity> = {}
): DocumentOcrArtifactIdentity {
  return {
    sourceSha256: 'a'.repeat(64),
    facadeVersion: '0.5.5',
    runtimeVersion: '0.1.5',
    nativeVersion: '0.5.5',
    modelVersion: '0.3.4',
    bundleId: 'bundle-1',
    artifactRevision: PDF_OCR_ARTIFACT_REVISION,
    strategy: 'bounded-960',
    requestedBackend: 'auto',
    detectionProviderChain: ['coreml', 'cpu'],
    detectionPrecision: 'fp16',
    recognitionProviderChain: ['coreml', 'cpu'],
    recognitionPrecision: 'fp16',
    dpi: 150,
    pageRangeStart: 1,
    pageRangeEnd: 100,
    maxPages: 100,
    maxFileBytes: 50 * 1024 * 1024,
    maxPagePixels: 4096 * 4096,
    maxTotalPixels: 100 * 1024 * 1024,
    ...overrides
  }
}

function value(text = '## Page 1\n\nsecret PDF OCR text'): DocumentOcrArtifactValue {
  return {
    text,
    tokenCount: estimateDocumentOcrTokens(text),
    pageSpans: [{ pageNumber: 1, start: 0, end: text.length, complete: true }],
    artifactTermination: 'request_complete',
    generationOutputLimitReached: false,
    generationTokenLimit: 16_000,
    emittedPages: 1,
    sourcePageCountHint: 1,
    engine: engine()
  }
}

describe('document OcrArtifactStore', () => {
  let tempDir: string
  let dbPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-document-ocr-cache-test-'))
    dbPath = path.join(tempDir, 'ocr-cache.db')
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('keys every render and runtime resource fact exactly', () => {
    const base = identity()
    const distinct: Array<Partial<DocumentOcrArtifactIdentity>> = [
      { facadeVersion: '0.5.6' },
      { runtimeVersion: '0.1.6' },
      { nativeVersion: '0.5.6' },
      { modelVersion: '0.3.5' },
      { artifactRevision: 'pdf-v2' },
      { dpi: 200 },
      { pageRangeEnd: 80 },
      { maxPages: 80 },
      { maxFileBytes: 40 * 1024 * 1024 },
      { maxPagePixels: 10_000_000 },
      { maxTotalPixels: 50 * 1024 * 1024 }
    ]
    for (const override of distinct) {
      expect(computeDocumentOcrArtifactCacheKey(base)).not.toBe(
        computeDocumentOcrArtifactCacheKey(identity(override))
      )
    }
  })

  it('stores deterministic empty results and clones returned coverage', async () => {
    const store = new OcrArtifactStore({ dbPath, keyProvider: keyProvider(null) })
    const empty: DocumentOcrArtifactValue = {
      ...value(''),
      pageSpans: [{ pageNumber: 1, start: 0, end: 0, complete: true }],
      tokenCount: 0
    }
    await store.putDocument(identity(), empty)

    const first = await store.findDocument(identity())
    expect(first).toMatchObject({ text: '', emittedPages: 1 })
    ;(first!.pageSpans as Array<{ pageNumber: number }>)[0].pageNumber = 99
    await expect(store.findDocument(identity())).resolves.toMatchObject({
      pageSpans: [{ pageNumber: 1 }]
    })
    await store.close()
  })

  it('replaces only when retained text coverage dominates', async () => {
    const store = new OcrArtifactStore({ dbPath, keyProvider: keyProvider(null) })
    const partialText = '## Page 1\n\npartial\n\n[… PDF OCR truncated …]'
    const partial: DocumentOcrArtifactValue = {
      ...value(partialText),
      pageSpans: [{ pageNumber: 1, start: 0, end: partialText.length, complete: false }],
      artifactTermination: 'resource_limited',
      generationOutputLimitReached: true,
      emittedPages: 20,
      resourceLimit: { code: 'resource_limit_exceeded', message: 'pixel limit' }
    }
    await store.putDocument(identity(), partial)
    await store.putDocument(identity(), value('## Page 1\n\ncomplete text'))
    await store.putDocument(identity(), {
      ...partial,
      emittedPages: 80,
      generationTokenLimit: 8_000
    })

    await expect(store.findDocument(identity())).resolves.toMatchObject({
      text: '## Page 1\n\ncomplete text',
      artifactTermination: 'request_complete'
    })
    await store.close()
  })

  persistentIt('persists encrypted document artifacts in schema v2', async () => {
    const persistentKey = Buffer.alloc(32, 9)
    const first = new OcrArtifactStore({
      dbPath,
      keyProvider: keyProvider(persistentKey)
    })
    await first.putDocument(identity(), value())
    await first.close()

    expect((await readFile(dbPath)).includes(Buffer.from('secret PDF OCR text'))).toBe(false)

    const second = new OcrArtifactStore({
      dbPath,
      keyProvider: keyProvider(persistentKey)
    })
    await expect(second.findDocument(identity())).resolves.toMatchObject({
      text: '## Page 1\n\nsecret PDF OCR text'
    })
    await second.close()
  })

  persistentIt('rebuilds schema-v1 derived data before creating document storage', async () => {
    const persistentKey = Buffer.alloc(32, 5)
    const legacy = openSQLiteDatabase(dbPath, persistentKey.toString('base64'))
    legacy.exec('CREATE TABLE stale_schema_v1 (value TEXT NOT NULL)')
    legacy.pragma('user_version = 1')
    legacy.close()

    const store = new OcrArtifactStore({
      dbPath,
      keyProvider: keyProvider(persistentKey)
    })
    await store.putDocument(identity(), value())
    await store.close()

    const rebuilt = openSQLiteDatabase(dbPath, persistentKey.toString('base64'))
    expect(rebuilt.pragma('user_version', { simple: true })).toBe(2)
    expect(
      rebuilt
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'stale_schema_v1'"
        )
        .get()
    ).toEqual({ count: 0 })
    rebuilt.close()
  })
})
