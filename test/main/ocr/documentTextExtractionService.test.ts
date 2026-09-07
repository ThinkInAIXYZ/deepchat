import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DocumentTextExtractionService,
  type DocumentTextExtractionServiceOptions,
  type LightOcrDocumentRecognitionPort
} from '../../../src/main/ocr/documentTextExtractionService'
import { OcrArtifactStore } from '../../../src/main/ocr/ocrArtifactStore'
import type { OcrCacheKeyProvider } from '../../../src/main/ocr/ocrCacheKeyProvider'
import type {
  LightOcrDocumentPage,
  LightOcrEngineStatus
} from '../../../src/main/ocr/lightOcrProtocol'
import { LightOcrProcessHostError } from '../../../src/main/ocr/lightOcrProcessHost'
import { OcrSourceSnapshotBudget } from '../../../src/main/ocr/ocrSourceSnapshotBudget'

const nullKeyProvider: OcrCacheKeyProvider = { loadOrCreateKey: async () => null }

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

function page(index: number, text: string): LightOcrDocumentPage {
  return {
    index,
    width: 1_240,
    height: 1_755,
    lines: [text],
    modelBundleId: 'bundle-1',
    timingUs: { total: 3, decode: 1, ocr: 2 }
  }
}

function createProcessHost(
  recognizeDocument: LightOcrDocumentRecognitionPort['recognizeDocument'] = async (input) => {
    let emittedPages = 0
    for (const documentPage of [page(0, 'first page'), page(1, 'second page')]) {
      emittedPages += 1
      if (input.onPage(documentPage) === 'output_limit_reached') {
        return {
          artifactTermination: 'stopped_by_output_limit',
          emittedPages,
          generationOutputLimitReached: true,
          engine: engine()
        }
      }
    }
    return {
      artifactTermination: 'request_complete',
      emittedPages,
      generationOutputLimitReached: false,
      engine: engine()
    }
  },
  preparedEngine = engine()
) {
  return {
    createDocumentSourceSnapshot: vi.fn(async () => ({
      filePath: '/private/process-host-snapshot.pdf',
      byteLength: Buffer.byteLength('%PDF-snapshot'),
      sourceSha256: 'a'.repeat(64),
      release: vi.fn(async () => undefined)
    })),
    prepare: vi.fn(async () => structuredClone(preparedEngine)),
    recognizeDocument: vi.fn(recognizeDocument)
  } satisfies LightOcrDocumentRecognitionPort
}

describe('DocumentTextExtractionService', () => {
  let tempDir: string
  let artifactStore: OcrArtifactStore

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-document-ocr-service-test-'))
    artifactStore = new OcrArtifactStore({
      dbPath: path.join(tempDir, 'cache.db'),
      keyProvider: nullKeyProvider
    })
  })

  afterEach(async () => {
    await artifactStore.close()
    await rm(tempDir, { recursive: true, force: true })
  })

  function createService(
    processHost: LightOcrDocumentRecognitionPort,
    snapshotReader: NonNullable<
      DocumentTextExtractionServiceOptions['snapshotReader']
    > = async () => ({
      filePath: '/private/service-snapshot.pdf',
      byteLength: Buffer.byteLength('%PDF-snapshot'),
      sourceSha256: 'a'.repeat(64),
      release: vi.fn(async () => undefined)
    })
  ) {
    return new DocumentTextExtractionService({
      processHost,
      artifactStore,
      facadeVersion: '0.5.5',
      runtimeVersion: '0.1.5',
      nativeVersion: '0.5.5',
      modelVersion: '0.3.4',
      bundleId: 'bundle-1',
      snapshotReader
    })
  }

  it('uses explicit bounded PDF options and caches complete page-aware text', async () => {
    const processHost = createProcessHost()
    const service = createService(processHost)
    const input = {
      filePath: '/not-read.pdf',
      maxFileSize: 80 * 1024 * 1024,
      backend: 'auto' as const,
      sourcePageCountHint: 2
    }

    const first = await service.extractDocument(input)
    const second = await service.extractDocument({ ...input, sourcePageCountHint: 3 })

    expect(first).toMatchObject({
      text: '## Page 1\n\nfirst page\n\n## Page 2\n\nsecond page',
      artifactTermination: 'request_complete',
      generationOutputLimitReached: false,
      cacheHit: false,
      sourcePageCountHint: 2
    })
    expect(second).toMatchObject({ cacheHit: true, sourcePageCountHint: 3 })
    expect(processHost.prepare).toHaveBeenCalledTimes(2)
    expect(processHost.recognizeDocument).toHaveBeenCalledTimes(1)
    expect(processHost.recognizeDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          filePath: '/private/service-snapshot.pdf',
          byteLength: Buffer.byteLength('%PDF-snapshot'),
          sourceSha256: 'a'.repeat(64)
        }),
        strategy: 'bounded-960',
        options: {
          dpi: 150,
          pageRange: { start: 1, end: 100 },
          maxPages: 100,
          maxFileBytes: 50 * 1024 * 1024,
          maxPagePixels: 4096 * 4096,
          maxTotalPixels: 100 * 1024 * 1024
        }
      })
    )
    service.close()
  })

  it('classifies invalid service limits as invalid input', async () => {
    const service = createService(createProcessHost())
    const input = {
      filePath: '/invalid-limits.pdf',
      maxFileSize: 1024,
      backend: 'auto' as const
    }

    await expect(service.extractDocument({ ...input, maxFileSize: 0 })).rejects.toMatchObject({
      code: 'invalid_input'
    })
    await expect(
      service.extractDocument({ ...input, generationTokenLimit: 0 })
    ).rejects.toMatchObject({ code: 'invalid_input' })

    service.close()
  })

  it('misses an output-limited cache for a larger budget and reuses it for a smaller one', async () => {
    const processHost = createProcessHost(async (input) => {
      const action = input.onPage(page(0, 'A'.repeat(2_000)))
      return {
        artifactTermination:
          action === 'output_limit_reached' ? 'stopped_by_output_limit' : 'request_complete',
        emittedPages: 1,
        generationOutputLimitReached: action === 'output_limit_reached',
        engine: engine()
      }
    })
    const service = createService(processHost)
    const base = {
      filePath: '/document.pdf',
      maxFileSize: 50 * 1024 * 1024,
      backend: 'auto' as const
    }

    const small = await service.extractDocument({ ...base, generationTokenLimit: 20 })
    const larger = await service.extractDocument({ ...base, generationTokenLimit: 40 })
    const smallerAgain = await service.extractDocument({ ...base, generationTokenLimit: 15 })

    expect(small).toMatchObject({ generationOutputLimitReached: true, cacheHit: false })
    expect(larger).toMatchObject({ generationOutputLimitReached: true, cacheHit: false })
    expect(larger.text.length).toBeGreaterThan(small.text.length)
    expect(smallerAgain).toMatchObject({
      generationOutputLimitReached: true,
      generationTokenLimit: 15,
      cacheHit: true
    })
    expect(smallerAgain.text).not.toContain('A'.repeat(100))
    expect(processHost.recognizeDocument).toHaveBeenCalledTimes(2)
    service.close()
  })

  it('caches an empty resource-limited prefix after a validated page', async () => {
    const processHost = createProcessHost(async (input) => {
      input.onPage(page(0, ''))
      return {
        artifactTermination: 'resource_limited',
        emittedPages: 1,
        generationOutputLimitReached: false,
        resourceLimit: {
          code: 'resource_limit_exceeded',
          message: 'total pixel limit'
        },
        engine: engine()
      }
    })
    const service = createService(processHost)
    const input = {
      filePath: '/empty.pdf',
      maxFileSize: 1024,
      backend: 'auto' as const
    }

    await expect(service.extractDocument(input)).resolves.toMatchObject({
      text: '',
      artifactTermination: 'resource_limited',
      cacheHit: false,
      pageSpans: [{ pageNumber: 1, complete: true }]
    })
    await expect(service.extractDocument(input)).resolves.toMatchObject({
      text: '',
      cacheHit: true
    })
    expect(processHost.recognizeDocument).toHaveBeenCalledTimes(1)
    service.close()
  })

  it('does not cache a resource limit before the first page', async () => {
    const processHost = createProcessHost(async () => {
      throw new LightOcrProcessHostError('helper_error', 'page is too large', {
        helperCode: 'resource_limit_exceeded'
      })
    })
    const service = createService(processHost)
    const input = {
      filePath: '/oversized-page.pdf',
      maxFileSize: 1024,
      backend: 'auto' as const
    }

    await expect(service.extractDocument(input)).rejects.toMatchObject({
      helperCode: 'resource_limit_exceeded'
    })
    await expect(service.extractDocument(input)).rejects.toMatchObject({
      helperCode: 'resource_limit_exceeded'
    })
    expect(processHost.recognizeDocument).toHaveBeenCalledTimes(2)
    expect(await artifactStore.getStats()).toMatchObject({ entryCount: 0 })
    service.close()
  })

  it('rejects provider drift between cache lookup and document recognition', async () => {
    const drifted = engine()
    drifted.detection.actualProviderChain = ['cpu']
    drifted.detection.precision = 'fp32'
    const processHost = createProcessHost(async (input) => {
      input.onPage(page(0, 'text'))
      return {
        artifactTermination: 'request_complete',
        emittedPages: 1,
        generationOutputLimitReached: false,
        engine: drifted
      }
    })
    const service = createService(processHost)

    await expect(
      service.extractDocument({
        filePath: '/drift.pdf',
        maxFileSize: 1024,
        backend: 'auto'
      })
    ).rejects.toMatchObject({ code: 'runtime_identity_mismatch' })
    expect(await artifactStore.getStats()).toMatchObject({ entryCount: 0 })
    service.close()
  })

  it('discards streamed pages when the only owner cancels', async () => {
    const processHost = createProcessHost(
      (input) =>
        new Promise((_, reject) => {
          input.onPage(page(0, 'partial text'))
          input.signal?.addEventListener(
            'abort',
            () => reject(new LightOcrProcessHostError('cancelled', 'cancelled')),
            { once: true }
          )
        })
    )
    const service = createService(processHost)
    const controller = new AbortController()
    const extraction = service.extractDocument({
      filePath: '/cancelled.pdf',
      maxFileSize: 1024,
      backend: 'auto',
      signal: controller.signal
    })

    await vi.waitFor(() => expect(processHost.recognizeDocument).toHaveBeenCalledTimes(1))
    controller.abort()
    await expect(extraction).rejects.toMatchObject({ code: 'cancelled' })
    expect(await artifactStore.getStats()).toMatchObject({ entryCount: 0 })
    service.close()
  })

  it('singleflights duplicate PDF OCR while allowing one owner to cancel', async () => {
    let finishRecognition!: () => void
    const processHost = createProcessHost(
      (input) =>
        new Promise((resolve) => {
          finishRecognition = () => {
            input.onPage(page(0, 'shared document text'))
            resolve({
              artifactTermination: 'request_complete',
              emittedPages: 1,
              generationOutputLimitReached: false,
              engine: engine()
            })
          }
        })
    )
    const releasedSnapshots: string[] = []
    let snapshotSequence = 0
    const service = createService(processHost, async () => {
      const filePath = `/private/service-snapshot-${snapshotSequence++}.pdf`
      return {
        filePath,
        byteLength: Buffer.byteLength('%PDF-snapshot'),
        sourceSha256: 'a'.repeat(64),
        release: vi.fn(async () => {
          releasedSnapshots.push(filePath)
        })
      }
    })
    const controller = new AbortController()
    const input = {
      filePath: '/shared.pdf',
      maxFileSize: 1024,
      backend: 'auto' as const
    }
    const cancelled = service.extractDocument({ ...input, signal: controller.signal })
    const retained = service.extractDocument(input)

    await vi.waitFor(() => expect(processHost.recognizeDocument).toHaveBeenCalledTimes(1))
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ code: 'cancelled' })
    finishRecognition()
    await expect(retained).resolves.toMatchObject({ text: expect.stringContaining('shared') })
    expect(processHost.recognizeDocument).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(releasedSnapshots).toHaveLength(2))
    service.close()
  })

  it('reserves pending source capacity before materializing a PDF snapshot', async () => {
    let finishFirstSnapshot!: () => void
    const release = vi.fn(async () => undefined)
    const snapshotReader = vi.fn(
      () =>
        new Promise<{
          filePath: string
          byteLength: number
          sourceSha256: string
          release: () => Promise<void>
        }>((resolve) => {
          finishFirstSnapshot = () =>
            resolve({
              filePath: '/private/bounded-snapshot.pdf',
              byteLength: 5,
              sourceSha256: 'b'.repeat(64),
              release
            })
        })
    )
    const processHost = createProcessHost()
    const service = new DocumentTextExtractionService({
      processHost,
      artifactStore,
      snapshotBudget: new OcrSourceSnapshotBudget(2, 15),
      facadeVersion: '0.5.5',
      runtimeVersion: '0.1.5',
      nativeVersion: '0.5.5',
      modelVersion: '0.3.4',
      bundleId: 'bundle-1',
      snapshotReader
    })
    const input = {
      filePath: '/bounded.pdf',
      maxFileSize: 10,
      backend: 'auto' as const
    }

    const first = service.extractDocument(input)
    await vi.waitFor(() => expect(snapshotReader).toHaveBeenCalledTimes(1))
    await expect(service.extractDocument(input)).rejects.toMatchObject({ code: 'queue_full' })
    expect(snapshotReader).toHaveBeenCalledTimes(1)

    finishFirstSnapshot()
    await expect(first).resolves.toMatchObject({ cacheHit: false })
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1))
    service.close()
  })
})
