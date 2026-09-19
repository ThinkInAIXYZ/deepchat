import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AUDIO_TRANSCRIPTION_MAX_TEXT_CHARACTERS,
  audioTranscribeArtifactRoute,
  audioTranscribeUploadRoute,
  ocrExtractUploadRoute
} from '@shared/contracts/routes'
import { ArtifactSpool } from '@/cli/artifactSpool'
import {
  CliAudioTranscriptionService,
  type CliAudioTranscriptionServiceOptions
} from '@/cli/audioTranscriptionService'
import { CliOcrService, type CliOcrServiceOptions } from '@/cli/ocrService'
import type { CliRouteCaller } from '@/routes/routeRegistry'
import type { OcrRuntimeServiceStatus } from '@/ocr/ocrRuntimeService'
import { OcrRuntimeBusyError } from '@/ocr/ocrRuntimeService'

const temporaryDirectories: string[] = []
const spools: ArtifactSpool[] = []

const caller: CliRouteCaller = {
  kind: 'cli',
  principal: 'human',
  connectionId: 'connection-1',
  scopes: ['audio:transcribe', 'ocr:extract', 'artifacts:read']
}

const engine = {
  coreVersion: '0.5.5',
  modelBundleId: 'bundle-v1',
  requestedProvider: 'auto' as const,
  strategy: 'bounded-960' as const,
  detection: {
    actualProviderChain: ['coreml', 'cpu'],
    precision: 'fp16',
    qualificationId: 'private-detection-id'
  },
  recognition: {
    actualProviderChain: ['cpu'],
    precision: 'fp32',
    qualificationId: 'private-recognition-id'
  }
}

const readyStatus: OcrRuntimeServiceStatus = {
  availability: {
    status: 'available',
    assets: {
      nodeExecutable: '/private/node',
      helperEntryPath: '/private/helper.js',
      facadeDir: '/private/facade',
      runtimeDir: '/private/runtime',
      bundlePath: '/private/bundle',
      nativePackageDir: '/private/native',
      nativePayloadEncoding: 'gzip-base64-v1',
      nativePackage: '@arcships/light-ocr-test',
      lightOcrVersion: '0.5.5',
      bundleId: 'bundle-v1'
    }
  },
  process: {
    state: 'ready',
    pid: 123,
    nodeVersion: 'v24.0.0',
    queuedRequests: 0,
    pendingInputBytes: 0,
    stderrBytesCaptured: 0,
    engine
  },
  cache: {
    mode: 'persistent',
    entryCount: 1,
    logicalBytes: 100,
    maxBytes: 1024
  }
}

afterEach(async () => {
  await Promise.allSettled(spools.splice(0).map((spool) => spool.close()))
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

async function createService(
  overrides: {
    status?: OcrRuntimeServiceStatus
    transcript?: string
  } = {}
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cli-input-'))
  temporaryDirectories.push(root)
  const artifactSpool = new ArtifactSpool({ directory: path.join(root, 'artifacts') })
  spools.push(artifactSpool)
  await artifactSpool.initialize()

  const providerSettings: CliAudioTranscriptionServiceOptions['providerSettings'] = {
    getProviderById: vi.fn(() => ({
      id: 'provider-1',
      name: 'Provider One',
      apiType: 'openai-compatible',
      apiKey: 'secret-key',
      baseUrl: 'https://private.example',
      enable: true
    })),
    getModelStatus: vi.fn(() => true),
    isKnownModel: vi.fn(() => true)
  }
  const providerRuntime: CliAudioTranscriptionServiceOptions['providerRuntime'] = {
    transcribeAudioStandalone: vi.fn(async () => overrides.transcript ?? '  transcript text  ')
  }
  const ocrRuntime: CliOcrServiceOptions['ocrRuntime'] = {
    clearCache: vi.fn(async () => undefined),
    getStatus: vi.fn(async () => overrides.status ?? readyStatus),
    extract: vi.fn(async () => ({
      text: 'recognized image text',
      tokenCount: 3,
      truncated: false,
      mimeType: 'image/png',
      imageWidth: 10,
      imageHeight: 20,
      strategy: 'bounded-960',
      engine,
      cacheHit: false,
      timingMs: { snapshot: 1, preprocessing: 2, recognition: 3, total: 6 }
    })),
    extractDocument: vi.fn(async () => {
      const text = '## Page 1\n\nrecognized PDF text'
      return {
        text,
        tokenCount: 7,
        pageSpans: [{ pageNumber: 1, start: 0, end: text.length, complete: true }],
        artifactTermination: 'request_complete',
        generationOutputLimitReached: false,
        generationTokenLimit: 16_000,
        emittedPages: 1,
        sourcePageCountHint: 1,
        engine,
        cacheHit: true,
        timingMs: { snapshot: 1, recognition: 4, total: 5 }
      }
    })
  }
  return {
    root,
    artifactSpool,
    providerRuntime,
    ocrRuntime,
    audioService: new CliAudioTranscriptionService({
      providerSettings,
      providerRuntime,
      artifactSpool,
      now: () => 100
    }),
    ocrService: new CliOcrService({
      appVersion: '1.2.3',
      ocrRuntime,
      artifactSpool,
      now: () => 100
    })
  }
}

describe('CLI audio transcription and OCR services', () => {
  it('transcribes owned audio artifacts without exposing their file path', async () => {
    const { root, artifactSpool, providerRuntime, audioService } = await createService()
    const artifact = await artifactSpool.write({
      caller,
      requestId: 'request-1',
      mimeType: 'audio/wav',
      suggestedFilename: 'sample.wav',
      data: Buffer.from('audio bytes')
    })

    const result = await audioService.dispatchRpc(
      audioTranscribeArtifactRoute.name,
      { providerId: 'provider-1', modelId: 'model-1', artifactId: artifact.id },
      caller,
      new AbortController().signal
    )

    expect(result).toMatchObject({
      providerId: 'provider-1',
      modelId: 'model-1',
      text: 'transcript text',
      mimeType: 'audio/wav',
      inputBytes: 11
    })
    expect(providerRuntime.transcribeAudioStandalone).toHaveBeenCalledWith(
      'provider-1',
      'model-1',
      Buffer.from('audio bytes').toString('base64'),
      'audio/wav',
      'sample.wav',
      { signal: expect.any(AbortSignal) }
    )
    expect(JSON.stringify(result)).not.toContain(root)
  })

  it('preserves cancellation before loading a transcription into memory', async () => {
    const { root, providerRuntime, audioService } = await createService()
    const filePath = path.join(root, 'sample.wav')
    await writeFile(filePath, 'audio bytes')
    const controller = new AbortController()
    controller.abort()

    await expect(
      audioService.dispatchUpload(
        audioTranscribeUploadRoute.name,
        {
          providerId: 'provider-1',
          modelId: 'model-1',
          mimeType: 'audio/wav',
          filename: 'sample.wav'
        },
        { path: filePath, size: 11 },
        caller,
        controller.signal
      )
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(providerRuntime.transcribeAudioStandalone).not.toHaveBeenCalled()
  })

  it('bounds transcription text without splitting a surrogate pair', async () => {
    const prefix = 'a'.repeat(AUDIO_TRANSCRIPTION_MAX_TEXT_CHARACTERS - 1)
    const { root, audioService } = await createService({ transcript: `${prefix}😀tail` })
    const filePath = path.join(root, 'sample.wav')
    await writeFile(filePath, 'audio bytes')

    const result = await audioService.dispatchUpload(
      audioTranscribeUploadRoute.name,
      {
        providerId: 'provider-1',
        modelId: 'model-1',
        mimeType: 'audio/wav',
        filename: 'sample.wav'
      },
      { path: filePath, size: 11 },
      caller,
      new AbortController().signal
    )

    expect(result).toMatchObject({ truncated: true, text: prefix })
  })

  it('extracts image text on the background queue and emits public benchmark data', async () => {
    const { root, ocrRuntime, ocrService } = await createService()
    const filePath = path.join(root, 'image.png')
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await writeFile(filePath, bytes)

    const result = await ocrService.dispatchUpload(
      ocrExtractUploadRoute.name,
      { mimeType: 'image/png', backend: 'auto' },
      { path: filePath, size: bytes.length },
      caller,
      new AbortController().signal
    )

    expect(result).toMatchObject({
      kind: 'image',
      text: 'recognized image text',
      benchmark: {
        state: 'miss-warm',
        runtimeStateBefore: 'ready',
        runtimeWasReady: true,
        inputBytes: bytes.length,
        appVersion: '1.2.3',
        protocolVersion: 1,
        surfaceVersion: 2
      },
      engine: {
        requestedBackend: 'auto',
        detection: { providerChain: ['coreml', 'cpu'] }
      }
    })
    expect(ocrRuntime.extract).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath,
        backend: 'auto',
        priority: 'background',
        signal: expect.any(AbortSignal)
      })
    )
    expect(JSON.stringify(result)).not.toContain('qualificationId')
    expect(JSON.stringify(result)).not.toContain('/private/')
  })

  it('routes PDF input separately and rejects a mismatched declared image type', async () => {
    const { root, ocrRuntime, ocrService } = await createService()
    const filePath = path.join(root, 'document.pdf')
    const bytes = Buffer.from('%PDF-1.7\nbody')
    await writeFile(filePath, bytes)

    const result = await ocrService.dispatchUpload(
      ocrExtractUploadRoute.name,
      {
        mimeType: 'application/pdf',
        backend: 'cpu',
        sourcePageCountHint: 1,
        generationTokenLimit: 100
      },
      { path: filePath, size: bytes.length },
      caller,
      new AbortController().signal
    )

    expect(result).toMatchObject({
      kind: 'document',
      text: '## Page 1\n\nrecognized PDF text',
      cacheHit: true,
      benchmark: { state: 'hit' }
    })
    expect(ocrRuntime.extractDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: 'cpu',
        sourcePageCountHint: 1,
        generationTokenLimit: 100,
        priority: 'background'
      })
    )

    const firstDocumentResult = await vi.mocked(ocrRuntime.extractDocument).mock.results[0].value
    vi.mocked(ocrRuntime.extractDocument).mockResolvedValueOnce({
      ...firstDocumentResult,
      artifactTermination: 'resource_limited',
      resourceLimit: {
        code: 'resource_limit_exceeded',
        message: 'private helper message',
        detail: '/private/runtime/model'
      }
    })
    const limited = await ocrService.dispatchUpload(
      ocrExtractUploadRoute.name,
      { mimeType: 'application/pdf', backend: 'auto' },
      { path: filePath, size: bytes.length },
      caller,
      new AbortController().signal
    )
    expect(limited).toMatchObject({
      truncated: true,
      resourceLimit: {
        code: 'resource_limit_exceeded',
        message: 'OCR document processing reached a resource limit'
      }
    })
    expect(JSON.stringify(limited)).not.toContain('/private/')
    expect(JSON.stringify(limited)).not.toContain('detail')

    await expect(
      ocrService.dispatchUpload(
        ocrExtractUploadRoute.name,
        { mimeType: 'image/png', backend: 'auto' },
        { path: filePath, size: bytes.length },
        caller,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: 'invalid_request' })
    expect(ocrRuntime.extract).not.toHaveBeenCalled()
  })

  it('maps active-extraction cache maintenance to a stable conflict', async () => {
    const { ocrRuntime, ocrService } = await createService()
    vi.mocked(ocrRuntime.clearCache).mockRejectedValueOnce(new OcrRuntimeBusyError())

    await expect(
      ocrService.dispatchRpc('ocr.clearCache', {}, caller, new AbortController().signal)
    ).rejects.toMatchObject({ code: 'conflict', httpStatus: 409 })
  })

  it('distinguishes cold-runtime misses from offline unavailability', async () => {
    const coldStatus: OcrRuntimeServiceStatus = {
      ...readyStatus,
      process: null,
      cache: null
    }
    const cold = await createService({ status: coldStatus })
    const filePath = path.join(cold.root, 'cold.png')
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await writeFile(filePath, bytes)

    await expect(
      cold.ocrService.dispatchUpload(
        ocrExtractUploadRoute.name,
        { mimeType: 'image/png', backend: 'auto' },
        { path: filePath, size: bytes.length },
        caller,
        new AbortController().signal
      )
    ).resolves.toMatchObject({
      benchmark: {
        state: 'cold-runtime',
        runtimeStateBefore: 'not-started',
        runtimeWasReady: false
      }
    })

    const offlineStatus: OcrRuntimeServiceStatus = {
      availability: {
        status: 'unavailable',
        reason: 'assets_missing',
        lightOcrVersion: '0.5.5',
        bundleId: 'bundle-v1'
      },
      process: null,
      cache: null
    }
    const offline = await createService({ status: offlineStatus })
    await expect(
      offline.ocrService.dispatchUpload(
        ocrExtractUploadRoute.name,
        { mimeType: 'image/png', backend: 'auto' },
        { path: '/not/inspected/while-offline.png', size: 8 },
        caller,
        new AbortController().signal
      )
    ).rejects.toMatchObject({
      code: 'unavailable',
      httpStatus: 503,
      options: { details: { reason: 'assets_missing' } }
    })
    expect(offline.ocrRuntime.extract).not.toHaveBeenCalled()
  })
})
