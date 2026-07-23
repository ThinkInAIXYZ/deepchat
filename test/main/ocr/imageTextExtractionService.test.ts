import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ImageTextExtractionService,
  truncateOcrText,
  type LightOcrRecognitionPort
} from '../../../src/main/ocr/imageTextExtractionService'
import {
  OcrArtifactStore,
  type OcrArtifactIdentity,
  type OcrArtifactStorePort
} from '../../../src/main/ocr/ocrArtifactStore'
import type { OcrCacheKeyProvider } from '../../../src/main/ocr/ocrCacheKeyProvider'
import type {
  LightOcrEngineStatus,
  LightOcrRecognitionResult,
  LightOcrTimingUs
} from '../../../src/main/ocr/lightOcrProtocol'

const nullKeyProvider: OcrCacheKeyProvider = { loadOrCreateKey: async () => null }

const timing: LightOcrTimingUs = {
  total: 1,
  decode: 1,
  inputValidation: 0,
  detectionPreprocess: 0,
  detectionInference: 0,
  detectionPostprocess: 0,
  detectionMerge: 0,
  cropAndSort: 0,
  recognitionPreprocess: 0,
  recognitionInference: 0,
  recognitionPostprocess: 0
}

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

function cpuEngine(): LightOcrEngineStatus {
  return {
    ...engine(),
    detection: {
      actualProviderChain: ['cpu'],
      precision: 'fp32',
      qualificationId: 'detection-cpu-q'
    },
    recognition: {
      actualProviderChain: ['cpu'],
      precision: 'fp32',
      qualificationId: 'recognition-cpu-q'
    }
  }
}

function recognition(text = 'recognized text'): LightOcrRecognitionResult {
  return {
    lines: text.split('\n').map((line) => ({
      text: line,
      confidence: 0.9,
      box: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 }
      ]
    })),
    imageWidth: 100,
    imageHeight: 50,
    modelBundleId: 'bundle-1',
    timingUs: timing,
    engine: engine()
  }
}

function createProcessHost(
  recognizeImpl: LightOcrRecognitionPort['recognize'] = async () => recognition(),
  preparedEngine: LightOcrEngineStatus = engine()
) {
  return {
    prepare: vi.fn(async () => structuredClone(preparedEngine)),
    recognize: vi.fn(recognizeImpl)
  } satisfies LightOcrRecognitionPort
}

describe('ImageTextExtractionService', () => {
  let tempDir: string
  let artifactStore: OcrArtifactStore

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-ocr-service-test-'))
    artifactStore = new OcrArtifactStore({
      dbPath: path.join(tempDir, 'cache.db'),
      keyProvider: nullKeyProvider
    })
  })

  afterEach(async () => {
    await artifactStore.close()
    await rm(tempDir, { recursive: true, force: true })
  })

  function createService(processHost: LightOcrRecognitionPort, sourceSha256 = 'a'.repeat(64)) {
    return new ImageTextExtractionService({
      processHost,
      artifactStore,
      lightOcrVersion: '0.3.4',
      bundleId: 'bundle-1',
      preprocessingRevision: 'preprocess-1',
      snapshotReader: async () => ({ bytes: Buffer.from('snapshot'), sourceSha256 }),
      preprocessor: async () => ({
        encoded: Buffer.from('normalized'),
        mimeType: 'image/png',
        width: 100,
        height: 50,
        strategy: 'bounded-960',
        preprocessingRevision: 'preprocess-1'
      })
    })
  }

  it('caches results by immutable content and actual execution identity', async () => {
    const processHost = createProcessHost()
    const service = createService(processHost)
    const input = { filePath: '/not-read.png', maxFileSize: 1024, backend: 'auto' as const }

    const first = await service.extract(input)
    const second = await service.extract(input)

    expect(first).toMatchObject({ text: 'recognized text', cacheHit: false })
    expect(second).toMatchObject({ text: 'recognized text', cacheHit: true })
    expect(processHost.prepare).toHaveBeenCalledTimes(2)
    expect(processHost.recognize).toHaveBeenCalledTimes(1)
    service.close()
  })

  it('does not reuse an artifact produced by a different actual provider chain', async () => {
    const cpuIdentity: OcrArtifactIdentity = {
      sourceSha256: 'a'.repeat(64),
      lightOcrVersion: '0.3.4',
      bundleId: 'bundle-1',
      preprocessingRevision: 'preprocess-1',
      strategy: 'bounded-960',
      requestedBackend: 'auto',
      detectionProviderChain: ['cpu'],
      detectionPrecision: 'fp32',
      recognitionProviderChain: ['cpu'],
      recognitionPrecision: 'fp32'
    }
    await artifactStore.put(cpuIdentity, {
      text: 'stale CPU result',
      tokenCount: 3,
      truncated: false,
      mimeType: 'image/png',
      imageWidth: 100,
      imageHeight: 50,
      engine: cpuEngine()
    })
    const processHost = createProcessHost(async () => recognition('fresh CoreML result'))
    const service = createService(processHost)

    await expect(
      service.extract({ filePath: '/image.png', maxFileSize: 1024, backend: 'auto' })
    ).resolves.toMatchObject({ text: 'fresh CoreML result', cacheHit: false })
    expect(processHost.recognize).toHaveBeenCalledTimes(1)
    service.close()
  })

  it('rejects provider identity drift between preparation and recognition', async () => {
    const drifted = recognition()
    drifted.engine = cpuEngine()
    const service = createService(createProcessHost(async () => drifted))

    await expect(
      service.extract({ filePath: '/image.png', maxFileSize: 1024, backend: 'auto' })
    ).rejects.toMatchObject({ code: 'runtime_identity_mismatch' })
    expect(await artifactStore.getStats()).toMatchObject({ entryCount: 0 })
    service.close()
  })

  it('singleflights duplicate OCR while allowing one owner to cancel', async () => {
    let finishRecognition!: (result: LightOcrRecognitionResult) => void
    const processHost = createProcessHost(
      () =>
        new Promise<LightOcrRecognitionResult>((resolve) => {
          finishRecognition = resolve
        })
    )
    const service = createService(processHost)
    const controller = new AbortController()
    const input = { filePath: '/same.png', maxFileSize: 1024, backend: 'auto' as const }
    const cancelled = service.extract({ ...input, signal: controller.signal })
    const retained = service.extract(input)

    await vi.waitFor(() => expect(processHost.recognize).toHaveBeenCalledTimes(1))
    expect(service.hasActiveExtractions()).toBe(true)
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ code: 'cancelled' })
    finishRecognition(recognition('shared result'))
    await expect(retained).resolves.toMatchObject({ text: 'shared result' })
    await vi.waitFor(() => expect(service.hasActiveExtractions()).toBe(false))
    service.close()
  })

  it('starts a fresh flight when the only owner cancels and retries immediately', async () => {
    let callCount = 0
    const processHost = createProcessHost(async ({ signal }) => {
      callCount += 1
      if (callCount > 1) return recognition('retry result')
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
      return recognition('unreachable')
    })
    const service = createService(processHost)
    const controller = new AbortController()
    const cancelled = service.extract({
      filePath: '/same.png',
      maxFileSize: 1024,
      backend: 'auto',
      signal: controller.signal
    })

    await vi.waitFor(() => expect(processHost.recognize).toHaveBeenCalledTimes(1))
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ code: 'cancelled' })
    await expect(
      service.extract({ filePath: '/same.png', maxFileSize: 1024, backend: 'auto' })
    ).resolves.toMatchObject({ text: 'retry result' })
    expect(processHost.recognize).toHaveBeenCalledTimes(2)
    service.close()
  })

  it('bounds source snapshots waiting in the main-process extraction queue', async () => {
    const processHost = createProcessHost(({ signal }) => {
      if (signal?.aborted) return Promise.reject(new Error('aborted'))
      return new Promise<LightOcrRecognitionResult>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    })
    const service = new ImageTextExtractionService({
      processHost,
      artifactStore,
      lightOcrVersion: '0.3.4',
      bundleId: 'bundle-1',
      preprocessingRevision: 'preprocess-1',
      snapshotReader: async ({ filePath }) => ({
        bytes: Buffer.from(filePath),
        sourceSha256: filePath.padEnd(64, 'a')
      }),
      preprocessor: async () => ({
        encoded: Buffer.from('normalized'),
        mimeType: 'image/png',
        width: 100,
        height: 50,
        strategy: 'bounded-960',
        preprocessingRevision: 'preprocess-1'
      })
    })
    const pending = Array.from({ length: 8 }, (_, index) =>
      service.extract({ filePath: `image-${index}`, maxFileSize: 1024, backend: 'auto' })
    )

    await expect(
      service.extract({ filePath: 'overflow', maxFileSize: 1024, backend: 'auto' })
    ).rejects.toMatchObject({ code: 'queue_full' })
    service.close()
    await Promise.allSettled(pending)
  })

  it('returns partial batch failures and enforces the shared text budget', async () => {
    let call = 0
    const processHost = createProcessHost(async () =>
      recognition(`${'汉'.repeat(10_000)}-${call++}`)
    )
    const service = new ImageTextExtractionService({
      processHost,
      artifactStore,
      lightOcrVersion: '0.3.4',
      bundleId: 'bundle-1',
      preprocessingRevision: 'preprocess-1',
      snapshotReader: async ({ filePath }) => {
        if (filePath === 'broken') throw new Error('unreadable')
        return { bytes: Buffer.from(filePath), sourceSha256: filePath.padEnd(64, 'a') }
      },
      preprocessor: async () => ({
        encoded: Buffer.from('normalized'),
        mimeType: 'image/png',
        width: 100,
        height: 50,
        strategy: 'bounded-960',
        preprocessingRevision: 'preprocess-1'
      })
    })
    const results = await service.extractBatch(
      ['first', 'broken', 'second', 'third'].map((filePath) => ({
        filePath,
        maxFileSize: 1024,
        backend: 'auto' as const
      }))
    )
    const fulfilled = results.filter((item) => item.status === 'fulfilled')

    expect(results[1]).toMatchObject({ status: 'rejected' })
    expect(fulfilled).toHaveLength(3)
    expect(fulfilled.reduce((total, item) => total + item.value.tokenCount, 0)).toBeLessThanOrEqual(
      16_000
    )
    expect(fulfilled.every((item) => item.value.truncated)).toBe(true)
    service.close()
  })

  it('rejects runtime identity drift instead of caching it', async () => {
    const mismatched = recognition()
    mismatched.engine.modelBundleId = 'wrong-bundle'
    const processHost = createProcessHost(async () => mismatched)
    const service = createService(processHost)

    await expect(
      service.extract({ filePath: '/image.png', maxFileSize: 1024, backend: 'auto' })
    ).rejects.toMatchObject({ code: 'runtime_identity_mismatch' })
    expect(await artifactStore.getStats()).toMatchObject({ entryCount: 0 })
    service.close()
  })

  it('rejects recognition dimensions that differ from the normalized input', async () => {
    const mismatched = recognition()
    mismatched.imageWidth = 101
    const service = createService(createProcessHost(async () => mismatched))

    await expect(
      service.extract({ filePath: '/image.png', maxFileSize: 1024, backend: 'auto' })
    ).rejects.toMatchObject({ code: 'runtime_identity_mismatch' })
    expect(await artifactStore.getStats()).toMatchObject({ entryCount: 0 })
    service.close()
  })

  it('revalidates cached text limits before returning cache hits', async () => {
    const cachedText = 'cached '.repeat(20_000)
    const failingCache: OcrArtifactStorePort = {
      find: vi.fn(async () => ({
        cacheKey: 'cache-key',
        text: cachedText,
        tokenCount: 0,
        truncated: false,
        mimeType: 'image/png',
        imageWidth: 100,
        imageHeight: 50,
        engine: engine()
      })),
      put: vi.fn(async () => {
        throw new Error('write failure')
      }),
      clear: vi.fn(async () => undefined),
      runMaintenance: vi.fn(async () => undefined),
      getStats: vi.fn(async () => ({
        mode: 'memory',
        entryCount: 0,
        logicalBytes: 0,
        maxBytes: 1
      })),
      close: vi.fn(async () => undefined)
    }
    const processHost = createProcessHost()
    const service = new ImageTextExtractionService({
      processHost,
      artifactStore: failingCache,
      lightOcrVersion: '0.3.4',
      bundleId: 'bundle-1',
      preprocessingRevision: 'preprocess-1',
      snapshotReader: async () => ({
        bytes: Buffer.from('snapshot'),
        sourceSha256: 'a'.repeat(64)
      }),
      preprocessor: async () => ({
        encoded: Buffer.from('normalized'),
        mimeType: 'image/png',
        width: 100,
        height: 50,
        strategy: 'bounded-960',
        preprocessingRevision: 'preprocess-1'
      })
    })

    const result = await service.extract({
      filePath: '/image.png',
      maxFileSize: 1024,
      backend: 'auto'
    })
    expect(result).toMatchObject({ cacheHit: true, truncated: true })
    expect(result.tokenCount).toBeLessThanOrEqual(8_000)
    expect(processHost.recognize).not.toHaveBeenCalled()
    service.close()
  })

  it('does not let cache or diagnostic failures change OCR results', async () => {
    const unavailableCache: OcrArtifactStorePort = {
      find: vi.fn(async () => {
        throw new Error('read failure')
      }),
      put: vi.fn(async () => {
        throw new Error('write failure')
      }),
      clear: vi.fn(async () => undefined),
      runMaintenance: vi.fn(async () => undefined),
      getStats: vi.fn(async () => ({
        mode: 'memory',
        entryCount: 0,
        logicalBytes: 0,
        maxBytes: 1
      })),
      close: vi.fn(async () => undefined)
    }
    const service = new ImageTextExtractionService({
      processHost: createProcessHost(async () => recognition('fresh result')),
      artifactStore: unavailableCache,
      lightOcrVersion: '0.3.4',
      bundleId: 'bundle-1',
      preprocessingRevision: 'preprocess-1',
      snapshotReader: async () => ({
        bytes: Buffer.from('snapshot'),
        sourceSha256: 'a'.repeat(64)
      }),
      preprocessor: async () => ({
        encoded: Buffer.from('normalized'),
        mimeType: 'image/png',
        width: 100,
        height: 50,
        strategy: 'bounded-960',
        preprocessingRevision: 'preprocess-1'
      }),
      onDiagnostic: () => {
        throw new Error('diagnostic failure')
      }
    })

    await expect(
      service.extract({ filePath: '/image.png', maxFileSize: 1024, backend: 'auto' })
    ).resolves.toMatchObject({ text: 'fresh result', cacheHit: false })
    expect(unavailableCache.find).toHaveBeenCalledTimes(1)
    expect(unavailableCache.put).toHaveBeenCalledTimes(1)
    service.close()
  })

  it('preserves both ends when truncating oversized OCR text', () => {
    const result = truncateOcrText(
      `start\nsecond line\n${'middle '.repeat(10_000)}\npenultimate line\nend`,
      200
    )

    expect(result.truncated).toBe(true)
    expect(result.tokenCount).toBeLessThanOrEqual(200)
    expect(result.text).toContain('start')
    expect(result.text).toContain('end')
    expect(result.text).toContain('OCR text truncated')
    expect(result.text).not.toContain('middle')
    expect(result.text.length).toBeLessThanOrEqual(128_000)
  })
})
