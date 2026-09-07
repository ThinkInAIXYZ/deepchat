import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  imagesGenerateRoute,
  modelsInvokeRoute,
  speechGenerateRoute,
  videosGenerateRoute,
  type MediaGenerationEvent,
  type ModelInvokeEvent
} from '@shared/contracts/routes'
import { ModelType } from '@shared/model'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { MODEL_META, ModelConfig } from '@shared/types/provider'
import { CliComputeService, type CliComputeServiceOptions } from '@/cli/computeService'
import { ArtifactSpool } from '@/cli/artifactSpool'
import type { CliRouteCaller } from '@/routes/routeRegistry'

const mediaSpools: ArtifactSpool[] = []
const temporaryDirectories: string[] = []

const provider = {
  id: 'provider-1',
  name: 'Provider One',
  apiType: 'openai-compatible',
  apiKey: 'secret-key',
  baseUrl: 'https://private.example',
  enable: true,
  custom: true
}

const model: MODEL_META = {
  id: 'model-1',
  name: 'Model One',
  group: 'default',
  providerId: provider.id,
  type: ModelType.Chat
}

const modelConfig: ModelConfig = {
  maxTokens: 4_096,
  contextLength: 32_768,
  temperature: 0.7,
  vision: false,
  functionCall: true,
  reasoning: true,
  type: ModelType.Chat
}

const caller: CliRouteCaller = {
  kind: 'cli',
  principal: 'human',
  connectionId: 'connection-1',
  scopes: ['models:invoke', 'media:generate']
}

afterEach(async () => {
  await Promise.allSettled(mediaSpools.splice(0).map((spool) => spool.close()))
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

async function* streamEvents(
  events: readonly LLMCoreStreamEvent[]
): AsyncGenerator<LLMCoreStreamEvent> {
  for (const event of events) yield event
}

function createService(
  events: readonly LLMCoreStreamEvent[],
  options: {
    now?: () => number
    providerRuntime?: Partial<CliComputeServiceOptions['providerRuntime']>
  } = {}
) {
  const providerSettings: CliComputeServiceOptions['providerSettings'] = {
    getProviders: vi.fn(() => [provider]),
    getProviderById: vi.fn(() => provider),
    getProviderModels: vi.fn(() => [model]),
    getCustomModels: vi.fn(() => []),
    getBatchModelStatus: vi.fn(() => ({ [model.id]: true })),
    getModelStatus: vi.fn(() => true),
    isKnownModel: vi.fn(() => true),
    getModelConfig: vi.fn(() => modelConfig)
  }
  const providerRuntime: CliComputeServiceOptions['providerRuntime'] = {
    executeWithRateLimit: vi.fn(async () => undefined),
    streamChat: vi.fn(() => streamEvents(events)),
    ...options.providerRuntime
  }
  const log = { warn: vi.fn() }
  return {
    service: new CliComputeService({
      providerSettings,
      providerRuntime,
      log,
      now: options.now ?? (() => 100)
    }),
    providerSettings,
    providerRuntime,
    log
  }
}

async function createMediaService(
  type: ModelType,
  overrides: Partial<CliComputeServiceOptions['providerRuntime']> = {}
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cli-compute-'))
  temporaryDirectories.push(root)
  const artifactDirectory = path.join(root, 'artifacts')
  const mediaCacheDirectory = path.join(root, 'images')
  const artifactSpool = new ArtifactSpool({ directory: artifactDirectory })
  mediaSpools.push(artifactSpool)
  const mediaModel = { ...model, id: `${type}-model`, type }
  const mediaConfig = { ...modelConfig, type }
  const providerSettings: CliComputeServiceOptions['providerSettings'] = {
    getProviders: vi.fn(() => [provider]),
    getProviderById: vi.fn(() => provider),
    getProviderModels: vi.fn(() => [mediaModel]),
    getCustomModels: vi.fn(() => []),
    getBatchModelStatus: vi.fn(() => ({ [mediaModel.id]: true })),
    getModelStatus: vi.fn(() => true),
    isKnownModel: vi.fn(() => true),
    getModelConfig: vi.fn(() => mediaConfig)
  }
  const providerRuntime: CliComputeServiceOptions['providerRuntime'] = {
    executeWithRateLimit: vi.fn(async () => undefined),
    streamChat: vi.fn(() => streamEvents([])),
    generateImageStandalone: vi.fn(async (providerId, _prompt, modelId) => ({
      providerId,
      modelId,
      images: [{ data: 'aW1hZ2U=', mimeType: 'image/png' }]
    })),
    generateVideoStandalone: vi.fn(async (providerId, _prompt, modelId) => ({
      providerId,
      modelId,
      videos: [{ data: 'dmlkZW8=', mimeType: 'video/mp4' }]
    })),
    generateSpeechStandalone: vi.fn(async (providerId, _text, modelId) => ({
      providerId,
      modelId,
      audio: { data: 'YXVkaW8=', mimeType: 'audio/mpeg' }
    })),
    ...overrides
  }
  const log = { warn: vi.fn() }
  return {
    service: new CliComputeService({
      providerSettings,
      providerRuntime,
      artifactSpool,
      mediaCacheDirectory,
      log,
      now: () => 100
    }),
    artifactSpool,
    artifactDirectory,
    mediaModel,
    providerRuntime,
    log
  }
}

async function collectArtifact(spool: ArtifactSpool, id: string): Promise<Buffer> {
  const opened = await spool.openRead(id, caller)
  const chunks: Buffer[] = []
  for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

describe('CLI compute service', () => {
  it('returns an explicitly redacted provider and model view', () => {
    const { service } = createService([])

    const result = service.listPublicProviders()

    expect(result).toEqual([
      {
        id: 'provider-1',
        name: 'Provider One',
        apiType: 'openai-compatible',
        enabled: true,
        custom: true,
        storedCredentialConfigured: true,
        models: [
          {
            id: 'model-1',
            name: 'Model One',
            group: 'default',
            enabled: true,
            custom: false,
            vision: false,
            functionCall: false,
            reasoning: false,
            enableSearch: false,
            type: ModelType.Chat
          }
        ]
      }
    ])
    expect(JSON.stringify(result)).not.toContain('secret-key')
    expect(JSON.stringify(result)).not.toContain('private.example')
  })

  it('streams only typed raw-model events and never enables tools', async () => {
    const timestamps = [0, 5, 25, 40, 80]
    const { service, providerRuntime } = createService(
      [
        { type: 'text', content: 'Hel' },
        { type: 'text', content: '' },
        { type: 'reasoning', reasoning_content: 'Think' },
        { type: 'text', content: 'lo' },
        {
          type: 'usage',
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
        },
        { type: 'stop', stop_reason: 'complete' }
      ],
      { now: () => timestamps.shift() ?? 80 }
    )
    const emitted: ModelInvokeEvent[] = []
    const signal = new AbortController().signal

    const result = await service.dispatchStream(
      modelsInvokeRoute.name,
      {
        providerId: provider.id,
        modelId: model.id,
        messages: [{ role: 'user', content: 'hello' }]
      },
      caller,
      'request-1',
      signal,
      async (event, data) => {
        expect(event).toBe(modelsInvokeRoute.name)
        emitted.push(data as ModelInvokeEvent)
      }
    )

    expect(result).toMatchObject({
      providerId: provider.id,
      modelId: model.id,
      text: 'Hello',
      reasoning: 'Think',
      usage: { totalTokens: 5 },
      finishReason: 'complete',
      latency: { queueMs: 20, firstEventMs: 40, firstTextMs: 40, totalMs: 80 }
    })
    expect(emitted.map((event) => event.type)).toEqual([
      'text_delta',
      'reasoning_delta',
      'text_delta',
      'usage',
      'stop'
    ])
    const streamCall = vi.mocked(providerRuntime.streamChat).mock.calls[0]
    expect(streamCall?.[6]).toEqual([])
    expect(streamCall?.[7]).toEqual({ signal })
  })

  it('serializes repeated rate-limit queue events before model output', async () => {
    const releases: Array<() => void> = []
    const startedQueueLengths: number[] = []
    let activeEmissions = 0
    let maxActiveEmissions = 0
    const { service } = createService([{ type: 'stop', stop_reason: 'complete' }], {
      providerRuntime: {
        executeWithRateLimit: vi.fn(async (_providerId, options) => {
          options?.onQueued?.({
            providerId: provider.id,
            qpsLimit: 1,
            currentQps: 1,
            queueLength: 2,
            estimatedWaitTime: 20
          })
          options?.onQueued?.({
            providerId: provider.id,
            qpsLimit: 1,
            currentQps: 1,
            queueLength: 1,
            estimatedWaitTime: 10
          })
        })
      }
    })

    const invocation = service.dispatchStream(
      modelsInvokeRoute.name,
      {
        providerId: provider.id,
        modelId: model.id,
        messages: [{ role: 'user', content: 'hello' }]
      },
      caller,
      'request-queued',
      new AbortController().signal,
      async (_event, data) => {
        const event = data as ModelInvokeEvent
        if (event.type !== 'rate_limit') return
        activeEmissions += 1
        maxActiveEmissions = Math.max(maxActiveEmissions, activeEmissions)
        startedQueueLengths.push(event.queueLength)
        await new Promise<void>((resolve) => releases.push(resolve))
        activeEmissions -= 1
      }
    )

    await vi.waitFor(() => expect(releases).toHaveLength(1))
    expect(startedQueueLengths).toEqual([2])
    releases.shift()?.()
    await vi.waitFor(() => expect(releases).toHaveLength(1))
    expect(startedQueueLengths).toEqual([2, 1])
    releases.shift()?.()

    await expect(invocation).resolves.toMatchObject({ finishReason: 'complete' })
    expect(maxActiveEmissions).toBe(1)
  })

  it('drains queued events before propagating an admission failure', async () => {
    let releaseEmission!: () => void
    const emissionGate = new Promise<void>((resolve) => {
      releaseEmission = resolve
    })
    let emissionStarted = false
    let emissionFinished = false
    const { service, providerRuntime } = createService([], {
      providerRuntime: {
        executeWithRateLimit: vi.fn(async (_providerId, options) => {
          options?.onQueued?.({
            providerId: provider.id,
            qpsLimit: 1,
            currentQps: 1,
            queueLength: 1,
            estimatedWaitTime: 10
          })
          throw new Error('Rate-limit admission failed')
        })
      }
    })

    const invocation = service.dispatchStream(
      modelsInvokeRoute.name,
      {
        providerId: provider.id,
        modelId: model.id,
        messages: [{ role: 'user', content: 'hello' }]
      },
      caller,
      'request-admission-failure',
      new AbortController().signal,
      async (_event, data) => {
        if ((data as ModelInvokeEvent).type !== 'rate_limit') return
        emissionStarted = true
        await emissionGate
        emissionFinished = true
      }
    )
    let settled = false
    void invocation.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )

    await vi.waitFor(() => expect(emissionStarted).toBe(true))
    await Promise.resolve()
    expect(settled).toBe(false)
    releaseEmission()

    await expect(invocation).rejects.toMatchObject({ code: 'unavailable' })
    expect(emissionFinished).toBe(true)
    expect(providerRuntime.streamChat).not.toHaveBeenCalled()
  })

  it('exposes normalized provider failure metadata without upstream text or headers', async () => {
    const { service, log } = createService([
      {
        type: 'error',
        error_message: 'secret upstream response',
        failure: {
          statusCode: 401,
          code: 'SECRET_PROVIDER_CODE',
          retryable: false,
          retryHeaders: { 'retry-after': 'secret-header-value' }
        }
      }
    ])

    await expect(
      service.dispatchStream(
        modelsInvokeRoute.name,
        {
          providerId: provider.id,
          modelId: model.id,
          messages: [{ role: 'user', content: 'hello' }]
        },
        caller,
        'request-1',
        new AbortController().signal,
        async () => undefined
      )
    ).rejects.toMatchObject({
      code: 'unavailable',
      message: 'Model provider request failed',
      retriable: false,
      options: {
        details: { providerFailure: { statusCode: 401, retryable: false } }
      }
    })
    expect(log.warn).toHaveBeenCalledOnce()
    const serializedLog = JSON.stringify(log.warn.mock.calls)
    expect(serializedLog).not.toContain('secret upstream response')
    expect(serializedLog).not.toContain('SECRET_PROVIDER_CODE')
    expect(serializedLog).not.toContain('secret-header-value')
  })

  it('rejects tool events instead of turning raw invocation into an Agent run', async () => {
    const { service } = createService([
      { type: 'tool_call_start', tool_call_id: 'call-1', tool_call_name: 'dangerous_tool' }
    ])

    await expect(
      service.dispatchStream(
        modelsInvokeRoute.name,
        {
          providerId: provider.id,
          modelId: model.id,
          messages: [{ role: 'user', content: 'hello' }]
        },
        caller,
        'request-1',
        new AbortController().signal,
        async () => undefined
      )
    ).rejects.toMatchObject({
      code: 'conflict',
      message: 'Raw model invocation returned an unsupported event'
    })
  })

  it('persists generated images and emits artifacts only after publication', async () => {
    const { service, artifactSpool, mediaModel, providerRuntime } = await createMediaService(
      ModelType.ImageGeneration
    )
    const emitted: MediaGenerationEvent[] = []
    const signal = new AbortController().signal

    const result = await service.dispatchStream(
      imagesGenerateRoute.name,
      {
        providerId: provider.id,
        modelId: mediaModel.id,
        prompt: 'a lighthouse',
        options: { quality: 'high', outputFormat: 'png' }
      },
      caller,
      'request-image',
      signal,
      async (event, data) => {
        expect(event).toBe(imagesGenerateRoute.name)
        emitted.push(data as MediaGenerationEvent)
      }
    )

    expect(result).toMatchObject({
      providerId: provider.id,
      modelId: mediaModel.id,
      requestedOptions: { quality: 'high', outputFormat: 'png' },
      artifacts: [{ owner: 'human', mimeType: 'image/png', filename: 'generated-image-1.png' }]
    })
    expect(emitted.map((event) => event.type)).toEqual(['started', 'artifact'])
    const artifact = imagesGenerateRoute.output.parse(result).artifacts[0]
    expect(await collectArtifact(artifactSpool, artifact.id)).toEqual(Buffer.from('image'))
    expect(providerRuntime.generateImageStandalone).toHaveBeenCalledWith(
      provider.id,
      'a lighthouse',
      mediaModel.id,
      { quality: 'high', outputFormat: 'png' },
      { signal }
    )
  })

  it('persists video and speech results with typed media artifacts', async () => {
    const video = await createMediaService(ModelType.VideoGeneration)
    const videoResult = await video.service.dispatchStream(
      videosGenerateRoute.name,
      {
        providerId: provider.id,
        modelId: video.mediaModel.id,
        prompt: 'ocean waves',
        options: { duration: 8, generateAudio: true }
      },
      caller,
      'request-video',
      new AbortController().signal,
      async () => undefined
    )
    const videoArtifact = videosGenerateRoute.output.parse(videoResult).artifacts[0]
    expect(videoArtifact).toMatchObject({
      mimeType: 'video/mp4',
      filename: 'generated-video-1.mp4'
    })
    expect(await collectArtifact(video.artifactSpool, videoArtifact.id)).toEqual(
      Buffer.from('video')
    )

    const speech = await createMediaService(ModelType.TTS)
    const speechResult = await speech.service.dispatchStream(
      speechGenerateRoute.name,
      {
        providerId: provider.id,
        modelId: speech.mediaModel.id,
        text: 'hello',
        options: { voice: 'alloy', responseFormat: 'mp3' }
      },
      caller,
      'request-speech',
      new AbortController().signal,
      async () => undefined
    )
    const speechArtifact = speechGenerateRoute.output.parse(speechResult).artifacts[0]
    expect(speechArtifact).toMatchObject({
      mimeType: 'audio/mpeg',
      filename: 'generated-audio-1.mp3'
    })
    expect(await collectArtifact(speech.artifactSpool, speechArtifact.id)).toEqual(
      Buffer.from('audio')
    )
  })

  it('rejects mismatched provider identity before publishing media', async () => {
    const media = await createMediaService(ModelType.ImageGeneration, {
      generateImageStandalone: vi.fn(async (_providerId, _prompt, modelId) => ({
        providerId: 'different-provider',
        modelId,
        images: [{ data: 'aW1hZ2U=', mimeType: 'image/png' }]
      }))
    })

    await expect(
      media.service.dispatchStream(
        imagesGenerateRoute.name,
        {
          providerId: provider.id,
          modelId: media.mediaModel.id,
          prompt: 'hello'
        },
        caller,
        'request-mismatch',
        new AbortController().signal,
        async () => undefined
      )
    ).rejects.toMatchObject({
      code: 'unavailable',
      message: 'Provider returned inconsistent media output'
    })
  })

  it('rejects media requests whose model is configured for another capability', async () => {
    const media = await createMediaService(ModelType.TTS)

    await expect(
      media.service.dispatchStream(
        imagesGenerateRoute.name,
        {
          providerId: provider.id,
          modelId: media.mediaModel.id,
          prompt: 'hello'
        },
        caller,
        'request-wrong-model',
        new AbortController().signal,
        async () => undefined
      )
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(media.providerRuntime.generateImageStandalone).not.toHaveBeenCalled()
  })

  it('removes earlier artifacts when a later provider output is invalid', async () => {
    const media = await createMediaService(ModelType.ImageGeneration, {
      generateImageStandalone: vi.fn(async (providerId, _prompt, modelId) => ({
        providerId,
        modelId,
        images: [
          { data: 'Zmlyc3Q=', mimeType: 'image/png' },
          { data: 'invalid base64', mimeType: 'image/png' }
        ]
      }))
    })

    await expect(
      media.service.dispatchStream(
        imagesGenerateRoute.name,
        {
          providerId: provider.id,
          modelId: media.mediaModel.id,
          prompt: 'hello'
        },
        caller,
        'request-partial',
        new AbortController().signal,
        async () => undefined
      )
    ).rejects.toMatchObject({ code: 'unavailable' })
    expect(await readdir(media.artifactDirectory)).toEqual([])
  })

  it('discards published artifacts when stream delivery fails', async () => {
    const media = await createMediaService(ModelType.ImageGeneration)

    await expect(
      media.service.dispatchStream(
        imagesGenerateRoute.name,
        {
          providerId: provider.id,
          modelId: media.mediaModel.id,
          prompt: 'hello'
        },
        caller,
        'request-delivery-failure',
        new AbortController().signal,
        async (_event, data) => {
          if ((data as MediaGenerationEvent).type === 'artifact') {
            throw new Error('stream disconnected')
          }
        }
      )
    ).rejects.toMatchObject({ code: 'unavailable' })
    expect(await readdir(media.artifactDirectory)).toEqual([])
  })

  it('normalizes media failures without logging provider response text', async () => {
    const media = await createMediaService(ModelType.TTS, {
      generateSpeechStandalone: vi.fn(async () => {
        throw new Error('secret upstream media response')
      })
    })

    await expect(
      media.service.dispatchStream(
        speechGenerateRoute.name,
        {
          providerId: provider.id,
          modelId: media.mediaModel.id,
          text: 'hello'
        },
        caller,
        'request-error',
        new AbortController().signal,
        async () => undefined
      )
    ).rejects.toMatchObject({ code: 'unavailable', message: 'Speech generation failed' })
    expect(media.log.warn).toHaveBeenCalledOnce()
    expect(JSON.stringify(media.log.warn.mock.calls)).not.toContain(
      'secret upstream media response'
    )
  })
})
