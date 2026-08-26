import type { ProviderSettingsPort } from '@/provider/settings'
import { supportsOpenAIImageGenerationSettings } from '@shared/imageGenerationSettings'
import { ApiEndpointType, ModelType } from '@shared/model'
import type { LLM_PROVIDER, ModelConfig } from '@shared/types/provider'
import { supportsOpenAICompatibleVideoGeneration } from '@shared/videoGenerationSettings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PROVIDERS } from '../../../src/main/provider/defaults'
import { ProviderInstanceManager } from '../../../src/main/provider/managers/providerInstanceManager'
import { resolveAiSdkProviderDefinition } from '../../../src/main/provider/providerRegistry'
import { ApimartProvider } from '../../../src/main/provider/providers/apimartProvider'

const { mockCacheImage, mockRunAiSdkCoreStream } = vi.hoisted(() => ({
  mockCacheImage: vi.fn(),
  mockRunAiSdkCoreStream: vi.fn()
}))

vi.mock('@shared/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    silly: vi.fn(),
    log: vi.fn()
  }
}))

vi.mock('electron', () => ({
  app: {
    getName: vi.fn(() => 'DeepChat'),
    getVersion: vi.fn(() => '0.0.0-test'),
    getPath: vi.fn(() => '/mock/path'),
    isReady: vi.fn(() => true),
    on: vi.fn()
  }
}))

vi.mock('../../../src/main/platform/proxy', () => ({
  proxyConfig: {
    getProxyUrl: vi.fn().mockReturnValue(null)
  }
}))

vi.mock('../../../src/main/platform/imageCache', () => ({
  cacheImage: mockCacheImage
}))

vi.mock('../../../src/main/provider/aiSdk', () => ({
  runAiSdkCoreStream: mockRunAiSdkCoreStream,
  runAiSdkDimensions: vi.fn(),
  runAiSdkEmbeddings: vi.fn(),
  runAiSdkGenerateText: vi.fn()
}))

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'apimart',
  name: 'APIMart',
  apiType: 'apimart',
  apiKey: 'test-key',
  baseUrl: 'https://api.apimart.ai/v1',
  enable: false,
  ...overrides
})

const createModelConfig = (overrides?: Partial<ModelConfig>): ModelConfig => ({
  maxTokens: 4096,
  contextLength: 8192,
  temperature: 0.7,
  vision: false,
  functionCall: false,
  reasoning: false,
  type: ModelType.Chat,
  apiEndpoint: ApiEndpointType.Chat,
  ...overrides
})

const createProviderSettings = (): ProviderSettingsPort =>
  ({
    getProviders: vi.fn().mockReturnValue([]),
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getProviderModelRouteMetadata: vi.fn().mockReturnValue(undefined),
    getModelConfig: vi.fn().mockReturnValue(createModelConfig()),
    getModelRouteConfig: vi.fn().mockReturnValue({ type: ModelType.Chat }),
    getSetting: vi.fn().mockReturnValue(undefined),
    getModelStatus: vi.fn().mockReturnValue(false),
    setProviderModels: vi.fn(),
    setModelConfig: vi.fn(),
    hasUserModelConfig: vi.fn().mockReturnValue(false)
  }) as unknown as ProviderSettingsPort

const createProviderInstance = (providerSettings = createProviderSettings()) =>
  new ApimartProvider(createProvider(), providerSettings, {
    getLanguage: vi.fn().mockReturnValue('en-US')
  })

const jsonResponse = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })

describe('ApimartProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCacheImage.mockResolvedValue('imgcache://apimart-output.png')
    mockRunAiSdkCoreStream.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'stop', stop_reason: 'complete' }
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('registers the built-in profile and dedicated catalog strategy', () => {
    expect(DEFAULT_PROVIDERS).toContainEqual(
      expect.objectContaining({
        id: 'apimart',
        name: 'APIMart',
        apiType: 'apimart',
        baseUrl: 'https://api.apimart.ai/v1',
        enable: false,
        websites: expect.objectContaining({
          official: 'https://apimart.ai/zh',
          docs: 'https://docs.apimart.ai/cn',
          defaultBaseUrl: 'https://api.apimart.ai/v1'
        })
      })
    )
    expect(resolveAiSdkProviderDefinition(createProvider())).toMatchObject({
      runtimeKind: 'openai-compatible',
      modelSource: 'apimart',
      checkStrategy: 'fetch-models',
      credentialStrategy: 'api-key',
      routeStrategy: 'apimart',
      embeddingStrategy: 'openai'
    })

    const manager = new ProviderInstanceManager({
      providerSettings: createProviderSettings(),
      locale: { getLanguage: () => 'en-US' },
      agentSettings: {
        getAcpEnabled: vi.fn().mockReturnValue(false),
        getAcpAgents: vi.fn().mockReturnValue([])
      },
      activeStreams: new Map(),
      rateLimitManager: {} as never,
      getCurrentProviderId: () => null,
      setCurrentProviderId: vi.fn(),
      acpRuntimeOwner: {} as never,
      publishEvent: vi.fn()
    })
    expect(manager.createDraftInstance(createProvider())).toBeInstanceOf(ApimartProvider)
    expect(
      supportsOpenAIImageGenerationSettings({
        providerId: 'apimart',
        providerApiType: 'apimart',
        type: ModelType.ImageGeneration
      })
    ).toBe(true)
    expect(
      supportsOpenAICompatibleVideoGeneration({
        providerId: 'apimart',
        providerApiType: 'apimart',
        type: ModelType.VideoGeneration
      })
    ).toBe(true)
  })

  it('classifies the account-scoped expanded model catalog', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 'gpt-5',
            owned_by: 'openai',
            category: 'chat',
            capability_tags: ['Text', 'Vision'],
            supported_endpoint_types: ['openai']
          },
          {
            id: 'gpt-5.6-luna',
            owned_by: 'openai',
            category: 'chat',
            capability_tags: ['Text'],
            supported_endpoint_types: ['openai']
          },
          {
            id: 'claude-sonnet-4-6',
            owned_by: 'anthropic',
            category: 'chat',
            capability_tags: ['Text'],
            supported_endpoint_types: ['openai-response', 'anthropic']
          },
          {
            id: 'gemini-2.5-pro',
            owned_by: 'google',
            category: 'chat',
            capability_tags: ['Text'],
            supported_endpoint_types: ['openai', 'gemini']
          },
          {
            id: 'text-embedding-3-large',
            owned_by: 'openai',
            category: 'chat',
            capability_tags: ['Embedding']
          },
          {
            id: 'gpt-image-2',
            owned_by: 'openai',
            category: 'image',
            parameters: {
              operation: 'image_generation',
              endpoint: '/v1/images/generations'
            }
          },
          {
            id: 'wan2.7',
            owned_by: 'alibaba',
            category: 'video',
            parameters: {
              operation: 'video_generation',
              endpoint: '/v1/videos/generations'
            }
          },
          { id: 'tts-1', owned_by: 'openai', category: 'audio' },
          { id: 'whisper-1', owned_by: 'openai', category: 'audio' },
          { id: 'suno-v5', owned_by: 'suno', category: 'audio' },
          { id: 'omni-moderation-latest', owned_by: 'openai', category: 'unknown' }
        ]
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const models = await createProviderInstance().fetchModels({ suppressErrors: false })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.apimart.ai/v1/models?expand=parameters',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key'
        })
      })
    )
    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'gpt-5',
          type: ModelType.Chat,
          endpointType: 'openai-response',
          ownedBy: 'openai',
          vision: true
        }),
        expect.objectContaining({
          id: 'text-embedding-3-large',
          type: ModelType.Embedding,
          endpointType: 'openai'
        }),
        expect.objectContaining({
          id: 'gpt-5.6-luna',
          type: ModelType.Chat,
          endpointType: 'openai-response',
          supportedEndpointTypes: ['openai']
        }),
        expect.objectContaining({
          id: 'claude-sonnet-4-6',
          type: ModelType.Chat,
          endpointType: 'anthropic'
        }),
        expect.objectContaining({
          id: 'gemini-2.5-pro',
          type: ModelType.Chat,
          endpointType: 'gemini'
        }),
        expect.objectContaining({
          id: 'gpt-image-2',
          type: ModelType.ImageGeneration,
          endpointType: 'image-generation'
        }),
        expect.objectContaining({
          id: 'wan2.7',
          type: ModelType.VideoGeneration,
          endpointType: 'video-generation',
          ownedBy: 'alibaba'
        }),
        expect.objectContaining({ id: 'tts-1', type: ModelType.TTS }),
        expect.objectContaining({ id: 'whisper-1', type: ModelType.Chat })
      ])
    )
    expect(models.map(({ id }) => id)).not.toContain('suno-v5')
    expect(models.map(({ id }) => id)).not.toContain('omni-moderation-latest')
  })

  it('maps current catalog routes despite stale request endpoint state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [
            {
              id: 'gpt-5.6-luna',
              owned_by: 'openai',
              category: 'chat',
              supported_endpoint_types: ['openai']
            },
            {
              id: 'claude-sonnet-4-6',
              owned_by: 'anthropic',
              category: 'chat',
              supported_endpoint_types: ['openai-response', 'anthropic']
            },
            {
              id: 'gemini-2.5-pro',
              owned_by: 'google',
              category: 'chat',
              supported_endpoint_types: ['openai', 'gemini']
            }
          ]
        })
      )
    )

    const providerSettings = createProviderSettings()
    const provider = createProviderInstance(providerSettings)
    await provider.fetchModels({ suppressErrors: false })
    ;(provider as any).isInitialized = true

    vi.mocked(providerSettings.getProviderModelRouteMetadata!).mockImplementation(
      (_providerId, modelId, routeConfig) => {
        const model = (provider as any).getStoredModel(modelId)
        if (!model) return undefined
        return {
          endpointType:
            routeConfig?.isUserDefined === true ? routeConfig.endpointType : model.endpointType,
          supportedEndpointTypes: model.supportedEndpointTypes,
          type: model.type,
          ownedBy: model.ownedBy
        }
      }
    )

    const resolveRuntime = (modelId: string, modelConfig?: ModelConfig) => {
      const decision = (provider as any).resolveRouteDecision(modelId, modelConfig)
      const runtimeProvider = (provider as any).getRuntimeProvider(decision) as LLM_PROVIDER
      return { decision, runtimeProvider }
    }

    const staleLunaConfig = createModelConfig({
      endpointType: 'openai',
      isUserDefined: true,
      reasoning: true,
      reasoningEffort: 'medium'
    })
    expect(resolveRuntime('gpt-5.6-luna', staleLunaConfig)).toMatchObject({
      decision: {
        providerKind: 'openai-responses',
        endpointType: 'openai-response'
      },
      runtimeProvider: {
        apiType: 'openai-responses',
        baseUrl: 'https://api.apimart.ai/v1'
      }
    })

    for await (const _event of provider.coreStream(
      [{ role: 'user', content: 'hello' }],
      'gpt-5.6-luna',
      staleLunaConfig,
      0.7,
      1024,
      []
    )) {
      continue
    }
    expect(mockRunAiSdkCoreStream.mock.calls.at(-1)?.[0]).toMatchObject({
      providerKind: 'openai-responses',
      provider: {
        apiType: 'openai-responses',
        baseUrl: 'https://api.apimart.ai/v1'
      }
    })
    expect(
      resolveRuntime(
        'claude-sonnet-4-6',
        createModelConfig({
          endpointType: 'gemini',
          ownedBy: 'google',
          isUserDefined: true
        })
      )
    ).toMatchObject({
      decision: {
        providerKind: 'anthropic',
        endpointType: 'anthropic'
      },
      runtimeProvider: {
        apiType: 'anthropic',
        baseUrl: 'https://api.apimart.ai/v1'
      }
    })

    const gemini = resolveRuntime('gemini-2.5-pro')
    expect(gemini).toMatchObject({
      decision: {
        providerKind: 'gemini',
        endpointType: 'gemini'
      },
      runtimeProvider: {
        apiType: 'apimart',
        baseUrl: 'https://api.apimart.ai/v1beta'
      }
    })
    expect(
      (provider as any)
        .buildRuntimeContext('gemini-2.5-pro', gemini.decision)
        .context.buildTraceHeaders()
    ).toMatchObject({
      Authorization: 'Bearer test-key'
    })
  })

  it('routes image generation through APIMart task polling and caches expiring output', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/models?expand=parameters')) {
        return jsonResponse({
          data: [
            {
              id: 'gpt-image-2',
              owned_by: 'openai',
              category: 'image',
              parameters: {
                operation: 'image_generation',
                endpoint: '/v1/images/generations',
                input_schema: {
                  properties: {
                    model: {},
                    prompt: {},
                    size: {},
                    quality: {}
                  }
                }
              }
            }
          ]
        })
      }
      if (url.endsWith('/images/generations') && init?.method === 'POST') {
        return jsonResponse({
          code: 200,
          data: [{ status: 'submitted', task_id: 'task-image' }]
        })
      }
      if (url.includes('/tasks/task-image')) {
        return jsonResponse({
          code: 200,
          data: {
            id: 'task-image',
            status: 'completed',
            result: {
              images: [{ url: ['https://cdn.apimart.ai/output.webp'] }]
            }
          }
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const provider = createProviderInstance()
    await provider.fetchModels({ suppressErrors: false })

    const events = []
    for await (const event of provider.coreStream(
      [{ role: 'user', content: 'paint a castle' }],
      'gpt-image-2',
      createModelConfig({
        type: ModelType.ImageGeneration,
        apiEndpoint: ApiEndpointType.Image,
        endpointType: 'image-generation',
        timeout: 5000,
        imageGeneration: {
          size: '1536x1024',
          quality: 'high',
          outputFormat: 'png'
        }
      }),
      0.7,
      1024,
      []
    )) {
      events.push(event)
    }

    const creationCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/images/generations') && init?.method === 'POST'
    )
    expect(JSON.parse(String(creationCall?.[1]?.body))).toEqual({
      model: 'gpt-image-2',
      prompt: 'paint a castle',
      size: '3:2',
      quality: 'high'
    })
    expect(mockCacheImage).toHaveBeenCalledWith(
      'https://cdn.apimart.ai/output.webp',
      expect.objectContaining({
        allowPrivateNetwork: false,
        signal: expect.any(AbortSignal)
      })
    )
    expect(events).toEqual([
      {
        type: 'image_data',
        image_data: { data: 'imgcache://apimart-output.png', mimeType: 'image/webp' }
      },
      { type: 'stop', stop_reason: 'complete' }
    ])
  })

  it('uses the model schema for video parameters without leaking the API key to output URLs', async () => {
    const videoBytes = new Uint8Array([1, 2, 3, 4])
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/models?expand=parameters')) {
        return jsonResponse({
          data: [
            {
              id: 'wan2.7',
              owned_by: 'alibaba',
              category: 'video',
              parameters: {
                operation: 'video_generation',
                endpoint: '/v1/videos/generations',
                input_schema: {
                  properties: {
                    model: {},
                    prompt: {},
                    duration: {},
                    size: {},
                    resolution: {},
                    generate_audio: {}
                  }
                }
              }
            }
          ]
        })
      }
      if (url.endsWith('/videos/generations') && init?.method === 'POST') {
        return jsonResponse({ data: [{ status: 'submitted', task_id: 'task-video' }] })
      }
      if (url.includes('/tasks/task-video')) {
        return jsonResponse({
          data: {
            id: 'task-video',
            status: 'completed',
            result: {
              videos: [{ url: ['https://cdn.apimart.ai/output.mp4'] }]
            }
          }
        })
      }
      if (url === 'https://cdn.apimart.ai/output.mp4') {
        return new Response(videoBytes, {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' }
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const provider = createProviderInstance()
    await provider.fetchModels({ suppressErrors: false })

    const events = []
    for await (const event of provider.coreStream(
      [{ role: 'user', content: 'animate the castle' }],
      'wan2.7',
      createModelConfig({
        type: ModelType.VideoGeneration,
        apiEndpoint: ApiEndpointType.Video,
        endpointType: 'video-generation',
        videoGeneration: {
          duration: 8,
          ratio: '16:9',
          resolution: '1080P',
          generateAudio: true
        }
      }),
      0.7,
      1024,
      []
    )) {
      events.push(event)
    }

    const creationCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/videos/generations') && init?.method === 'POST'
    )
    expect(JSON.parse(String(creationCall?.[1]?.body))).toEqual({
      model: 'wan2.7',
      prompt: 'animate the castle',
      duration: 8,
      size: '16:9',
      resolution: '1080P',
      generate_audio: true
    })
    const downloadCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === 'https://cdn.apimart.ai/output.mp4'
    )
    expect(downloadCall?.[1]?.headers).toBeUndefined()
    expect(events).toEqual([
      {
        type: 'image_data',
        image_data: {
          data: `data:video/mp4;base64,${Buffer.from(videoBytes).toString('base64')}`,
          mimeType: 'video/mp4'
        }
      },
      { type: 'stop', stop_reason: 'complete' }
    ])
  })
})
