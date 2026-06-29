import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IConfigPresenter, LLM_PROVIDER, ModelConfig } from '../../../../src/shared/presenter'
import { ApiEndpointType, ModelType } from '../../../../src/shared/model'
import { AiSdkProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/aiSdkProvider'
import { resolveAiSdkProviderDefinition } from '../../../../src/main/presenter/llmProviderPresenter/providerRegistry'
import { modelCapabilities } from '../../../../src/main/presenter/configPresenter/modelCapabilities'

const { mockRunAiSdkCoreStream } = vi.hoisted(() => ({
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

vi.mock('@/presenter', () => ({
  presenter: {
    devicePresenter: {
      cacheImage: vi.fn()
    }
  }
}))

vi.mock('@/eventbus', () => ({
  eventBus: {
    on: vi.fn(),
    sendToMain: vi.fn(),
    emit: vi.fn(),
    send: vi.fn()
  }
}))

vi.mock('@/events', () => ({
  CONFIG_EVENTS: {
    PROXY_RESOLVED: 'PROXY_RESOLVED',
    PROVIDER_ATOMIC_UPDATE: 'PROVIDER_ATOMIC_UPDATE',
    PROVIDER_BATCH_UPDATE: 'PROVIDER_BATCH_UPDATE',
    MODEL_LIST_CHANGED: 'MODEL_LIST_CHANGED'
  },
  PROVIDER_DB_EVENTS: {
    LOADED: 'LOADED',
    UPDATED: 'UPDATED'
  },
  NOTIFICATION_EVENTS: {
    SHOW_ERROR: 'SHOW_ERROR'
  }
}))

vi.mock('../../../../src/main/presenter/proxyConfig', () => ({
  proxyConfig: {
    getProxyUrl: vi.fn().mockReturnValue(null)
  }
}))

vi.mock('../../../../src/main/presenter/llmProviderPresenter/aiSdk', () => ({
  runAiSdkCoreStream: mockRunAiSdkCoreStream,
  runAiSdkDimensions: vi.fn(),
  runAiSdkEmbeddings: vi.fn(),
  runAiSdkGenerateText: vi.fn()
}))

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'new-api',
  name: 'New API',
  apiType: 'new-api',
  apiKey: 'test-key',
  baseUrl: 'https://www.newapi.ai',
  enable: false,
  models: [],
  customModels: [],
  enabledModels: [],
  disabledModels: [],
  ...overrides
})

const createConfigPresenter = (
  modelConfigById: Record<string, Partial<ModelConfig>> = {},
  providerModelsByProviderId: Record<string, unknown[]> = {}
): IConfigPresenter =>
  ({
    getProviders: vi.fn().mockReturnValue([]),
    getProviderModels: vi.fn((providerId: string) => providerModelsByProviderId[providerId] ?? []),
    getCustomModels: vi.fn().mockReturnValue([]),
    getDbProviderModels: vi.fn().mockReturnValue([]),
    getModelConfig: vi.fn((modelId: string) => ({
      type: ModelType.Chat,
      apiEndpoint: ApiEndpointType.Chat,
      ...modelConfigById[modelId]
    })),
    getSetting: vi.fn().mockReturnValue(undefined),
    getModelStatus: vi.fn().mockReturnValue(false),
    setProviderModels: vi.fn(),
    hasUserModelConfig: vi.fn().mockReturnValue(false),
    setModelConfig: vi.fn()
  }) as unknown as IConfigPresenter

describe('NewApiProvider capability routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunAiSdkCoreStream.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'image_data', image_data: { data: 'generated-image', mimeType: 'image/png' } }
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('maps openai-response delegates to openai capability semantics', () => {
    const provider = new AiSdkProvider(
      createProvider(),
      createConfigPresenter({
        'gpt-4o': {
          endpointType: 'openai-response'
        }
      })
    )
    const routeDecision = (provider as any).resolveRouteDecision('gpt-4o')
    const runtimeProvider = (provider as any).getRuntimeProvider(routeDecision) as LLM_PROVIDER

    expect(runtimeProvider.id).toBe('new-api')
    expect(runtimeProvider.capabilityProviderId).toBe('openai')
    expect(runtimeProvider.apiType).toBe('openai-responses')
  })

  it('maps gemini delegates to gemini capability semantics', () => {
    const provider = new AiSdkProvider(
      createProvider(),
      createConfigPresenter({
        'gemini-model': {
          endpointType: 'gemini'
        }
      })
    )
    const routeDecision = (provider as any).resolveRouteDecision('gemini-model')
    const runtimeProvider = (provider as any).getRuntimeProvider(routeDecision) as LLM_PROVIDER

    expect(runtimeProvider.id).toBe('new-api')
    expect(runtimeProvider.capabilityProviderId).toBe('gemini')
    expect(runtimeProvider.apiType).toBe('gemini')
  })

  it('preserves a gemini-compatible v1beta base url for new api routes', async () => {
    const provider = new AiSdkProvider(
      createProvider({
        baseUrl: 'https://api.newapi.ai'
      }),
      createConfigPresenter({
        'gemini-model': {
          endpointType: 'gemini'
        }
      })
    )
    ;(provider as any).isInitialized = true

    for await (const _event of provider.coreStream(
      [{ role: 'user', content: 'hello' }],
      'gemini-model',
      {
        apiEndpoint: ApiEndpointType.Chat,
        maxTokens: 512,
        contextLength: 8192,
        vision: false,
        functionCall: false,
        reasoning: false,
        type: ModelType.Chat
      } as ModelConfig,
      0.2,
      64,
      []
    )) {
      continue
    }

    const context = mockRunAiSdkCoreStream.mock.calls.at(-1)?.[0]
    expect(context.providerKind).toBe('gemini')
    expect(context.provider.baseUrl).toBe('https://api.newapi.ai/v1beta')
    expect(context.buildTraceHeaders()).toMatchObject({
      'Content-Type': 'application/json',
      'x-goog-api-key': 'test-key'
    })
    expect(context.buildTraceHeaders()).not.toHaveProperty('Authorization')
  })

  it('maps anthropic delegates to anthropic capability semantics', () => {
    const provider = new AiSdkProvider(
      createProvider(),
      createConfigPresenter({
        'claude-model': {
          endpointType: 'anthropic'
        }
      })
    )
    const routeDecision = (provider as any).resolveRouteDecision('claude-model')
    const runtimeProvider = (provider as any).getRuntimeProvider(routeDecision) as LLM_PROVIDER

    expect(runtimeProvider.id).toBe('new-api')
    expect(runtimeProvider.capabilityProviderId).toBe('anthropic')
    expect(runtimeProvider.apiType).toBe('anthropic')
    expect(routeDecision.supportsOfficialAnthropicReasoning).toBe(true)

    const runtimeContext = (provider as any).buildRuntimeContext('claude-model')
    expect(runtimeContext.context.provider.capabilityProviderId).toBe('anthropic')
    expect(runtimeContext.context.supportsOfficialAnthropicReasoning).toBe(true)
  })

  it('prefers anthropic for Claude models when supported endpoint types include anthropic', () => {
    const provider = new AiSdkProvider(
      createProvider({
        id: 'fork-api',
        name: 'Fork API',
        apiType: 'new-api'
      }),
      createConfigPresenter(
        {},
        {
          'fork-api': [
            {
              id: 'claude-opus-4-7',
              name: 'Claude Opus 4.7',
              group: 'default',
              providerId: 'fork-api',
              isCustom: false,
              supportedEndpointTypes: ['openai-response', 'anthropic'],
              type: ModelType.Chat
            }
          ]
        }
      )
    )
    const routeDecision = (provider as any).resolveRouteDecision('claude-opus-4-7')
    const runtimeProvider = (provider as any).getRuntimeProvider(routeDecision) as LLM_PROVIDER
    const runtimeContext = (provider as any).buildRuntimeContext('claude-opus-4-7')

    expect(routeDecision.endpointType).toBe('anthropic')
    expect(runtimeProvider.apiType).toBe('anthropic')
    expect(runtimeProvider.capabilityProviderId).toBe('anthropic')
    expect(routeDecision.supportsOfficialAnthropicReasoning).toBe(true)
    expect(runtimeContext.context.supportsOfficialAnthropicReasoning).toBe(true)
  })

  it('overlays provider DB capabilities while preserving new-api endpoint routing', async () => {
    const capabilityModel = {
      id: 'anthropic/claude-opus-4.8',
      modalities: {
        input: ['text', 'image'],
        output: ['text']
      },
      tool_call: true,
      extra_capabilities: {
        reasoning: {
          supported: true,
          default_enabled: false,
          mode: 'effort',
          effort: 'high'
        }
      }
    } as any
    const capabilityMatchSpy = vi
      .spyOn(modelCapabilities, 'findCapabilityModelMatch')
      .mockReturnValue({
        providerId: 'anthropic',
        modelId: 'claude-opus-4-8',
        model: capabilityModel
      })
    const supportsReasoningSpy = vi
      .spyOn(modelCapabilities, 'supportsReasoning')
      .mockReturnValue(true)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'claude-opus-4-8',
            name: 'Claude Opus 4.8',
            owned_by: 'anthropic',
            supported_endpoint_types: ['openai-response', 'anthropic'],
            type: 'chat',
            context_length: 200000,
            max_output_tokens: 32000
          }
        ]
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const configPresenter = createConfigPresenter()
    const provider = new AiSdkProvider(createProvider(), configPresenter)

    const models = await (provider as any).fetchProviderModels()

    expect(models).toEqual([
      expect.objectContaining({
        id: 'claude-opus-4-8',
        name: 'Claude Opus 4.8',
        group: 'anthropic',
        providerId: 'new-api',
        ownedBy: 'anthropic',
        supportedEndpointTypes: ['openai-response', 'anthropic'],
        endpointType: 'anthropic',
        vision: true,
        functionCall: true,
        reasoning: true,
        contextLength: 200000,
        maxTokens: 32000
      })
    ])
    expect(capabilityMatchSpy).toHaveBeenCalledWith(
      'claude-opus-4-8',
      expect.arrayContaining(['anthropic'])
    )
    expect(supportsReasoningSpy).toHaveBeenCalledWith('anthropic', 'claude-opus-4-8')
    expect(configPresenter.setModelConfig).toHaveBeenCalledWith(
      'claude-opus-4-8',
      'new-api',
      expect.objectContaining({
        endpointType: 'anthropic',
        vision: true,
        functionCall: true,
        reasoning: true,
        ownedBy: 'anthropic'
      }),
      { source: 'provider' }
    )
  })

  it('infers anthropic for Claude-owned models with empty supported endpoint types', async () => {
    vi.spyOn(modelCapabilities, 'findCapabilityModelMatch').mockReturnValue({
      providerId: 'anthropic',
      modelId: 'claude-opus-4-8',
      model: {
        id: 'claude-opus-4-8'
      } as any
    })
    vi.spyOn(modelCapabilities, 'supportsReasoning').mockReturnValue(true)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'claude-opus-4-8',
              object: 'model',
              owned_by: 'claude',
              supported_endpoint_types: []
            }
          ]
        })
      })
    )

    const configPresenter = createConfigPresenter()
    const provider = new AiSdkProvider(createProvider(), configPresenter)
    const models = await (provider as any).fetchProviderModels()

    expect(models[0]).toMatchObject({
      id: 'claude-opus-4-8',
      endpointType: 'anthropic',
      ownedBy: 'claude'
    })
    expect(configPresenter.setModelConfig).toHaveBeenCalledWith(
      'claude-opus-4-8',
      'new-api',
      expect.objectContaining({
        endpointType: 'anthropic',
        ownedBy: 'claude'
      }),
      { source: 'provider' }
    )
  })

  it('infers gemini for Google-owned models with empty supported endpoint types', async () => {
    vi.spyOn(modelCapabilities, 'findCapabilityModelMatch').mockReturnValue({
      providerId: 'google',
      modelId: 'gemini-3.5-flash',
      model: {
        id: 'gemini-3.5-flash'
      } as any
    })
    vi.spyOn(modelCapabilities, 'supportsReasoning').mockReturnValue(false)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'gemini-3.5-flash',
              object: 'model',
              owned_by: 'google gemini',
              supported_endpoint_types: []
            }
          ]
        })
      })
    )

    const configPresenter = createConfigPresenter()
    const provider = new AiSdkProvider(createProvider(), configPresenter)
    const models = await (provider as any).fetchProviderModels()

    expect(models[0]).toMatchObject({
      id: 'gemini-3.5-flash',
      endpointType: 'gemini',
      ownedBy: 'google gemini'
    })
    expect(configPresenter.setModelConfig).toHaveBeenCalledWith(
      'gemini-3.5-flash',
      'new-api',
      expect.objectContaining({
        endpointType: 'gemini',
        ownedBy: 'google gemini'
      }),
      { source: 'provider' }
    )
  })

  it('keeps OpenAI-compatible owners on openai endpoints while using provider DB capability matches', () => {
    const capabilityMatchSpy = vi
      .spyOn(modelCapabilities, 'findCapabilityModelMatch')
      .mockReturnValue({
        providerId: 'alibaba-cn',
        modelId: 'qwen3.7-max',
        model: {
          id: 'qwen3.7-max'
        } as any
      })
    const provider = new AiSdkProvider(
      createProvider(),
      createConfigPresenter(
        {},
        {
          'new-api': [
            {
              id: 'qwen3.7-max',
              name: 'Qwen 3.7 Max',
              group: 'ali',
              providerId: 'new-api',
              isCustom: false,
              supportedEndpointTypes: ['openai'],
              endpointType: 'openai',
              ownedBy: 'ali',
              type: ModelType.Chat
            }
          ]
        }
      )
    )
    const routeDecision = (provider as any).resolveRouteDecision('qwen3.7-max')
    const runtimeProvider = (provider as any).getRuntimeProvider(routeDecision) as LLM_PROVIDER

    expect(routeDecision.endpointType).toBe('openai')
    expect(runtimeProvider.apiType).toBe('openai-completions')
    expect(runtimeProvider.capabilityProviderId).toBe('alibaba-cn')
    expect(capabilityMatchSpy).toHaveBeenCalledWith(
      'qwen3.7-max',
      expect.arrayContaining(['openai', 'alibaba-cn'])
    )
  })

  it('exposes all chat endpoints for openai-only chat models while keeping completions as default', async () => {
    vi.spyOn(modelCapabilities, 'findCapabilityModelMatch').mockReturnValue(undefined)
    vi.spyOn(modelCapabilities, 'supportsReasoning').mockReturnValue(false)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'gpt-5.5',
              object: 'model',
              owned_by: 'openai',
              supported_endpoint_types: ['openai'],
              type: 'chat'
            }
          ]
        })
      })
    )

    const configPresenter = createConfigPresenter()
    const provider = new AiSdkProvider(createProvider(), configPresenter)
    const models = await (provider as any).fetchProviderModels()

    expect(models[0]).toMatchObject({
      id: 'gpt-5.5',
      supportedEndpointTypes: ['openai'],
      selectableEndpointTypes: ['openai', 'openai-response', 'anthropic', 'gemini'],
      endpointType: 'openai'
    })
    expect(configPresenter.setModelConfig).toHaveBeenCalledWith(
      'gpt-5.5',
      'new-api',
      expect.objectContaining({
        endpointType: 'openai',
        apiEndpoint: ApiEndpointType.Chat
      }),
      { source: 'provider' }
    )

    const runtimeProvider = new AiSdkProvider(
      createProvider(),
      createConfigPresenter(
        {},
        {
          'new-api': models
        }
      )
    )
    const routeDecision = (runtimeProvider as any).resolveRouteDecision('gpt-5.5')
    const selectedProvider = (runtimeProvider as any).getRuntimeProvider(
      routeDecision
    ) as LLM_PROVIDER

    expect(routeDecision.endpointType).toBe('openai')
    expect(selectedProvider.apiType).toBe('openai-completions')
  })

  it('uses responses when an openai-only NewAPI model is manually configured for responses', () => {
    const provider = new AiSdkProvider(
      createProvider(),
      createConfigPresenter(
        {
          'gpt-5.5': {
            endpointType: 'openai-response'
          }
        },
        {
          'new-api': [
            {
              id: 'gpt-5.5',
              name: 'GPT-5.5',
              group: 'openai',
              providerId: 'new-api',
              isCustom: false,
              supportedEndpointTypes: ['openai'],
              selectableEndpointTypes: ['openai', 'openai-response', 'anthropic', 'gemini'],
              endpointType: 'openai',
              ownedBy: 'openai',
              type: ModelType.Chat
            }
          ]
        }
      )
    )
    const routeDecision = (provider as any).resolveRouteDecision('gpt-5.5')
    const runtimeProvider = (provider as any).getRuntimeProvider(routeDecision) as LLM_PROVIDER

    expect(routeDecision.endpointType).toBe('openai-response')
    expect(runtimeProvider.apiType).toBe('openai-responses')
  })

  it('keeps explicit chat models on chat selectable endpoints when media endpoints are also advertised', async () => {
    vi.spyOn(modelCapabilities, 'findCapabilityModelMatch').mockReturnValue(undefined)
    vi.spyOn(modelCapabilities, 'supportsReasoning').mockReturnValue(false)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'gpt-4.1',
              object: 'model',
              owned_by: 'openai',
              supported_endpoint_types: ['openai', 'image-generation'],
              type: 'chat'
            }
          ]
        })
      })
    )

    const provider = new AiSdkProvider(createProvider(), createConfigPresenter())
    const models = await (provider as any).fetchProviderModels()

    expect(models[0]).toMatchObject({
      id: 'gpt-4.1',
      type: ModelType.Chat,
      supportedEndpointTypes: ['openai', 'image-generation'],
      selectableEndpointTypes: ['openai', 'openai-response', 'anthropic', 'gemini'],
      endpointType: 'openai'
    })

    const runtimeProvider = new AiSdkProvider(
      createProvider(),
      createConfigPresenter(
        {},
        {
          'new-api': models
        }
      )
    )
    const routeDecision = (runtimeProvider as any).resolveRouteDecision('gpt-4.1')

    expect(routeDecision.endpointType).toBe('openai')
  })

  it('limits explicit media models to their matching selectable endpoint', async () => {
    vi.spyOn(modelCapabilities, 'findCapabilityModelMatch').mockReturnValue(undefined)
    vi.spyOn(modelCapabilities, 'supportsReasoning').mockReturnValue(false)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'gpt-image-2',
              object: 'model',
              owned_by: 'openai',
              supported_endpoint_types: ['openai', 'image-generation'],
              type: 'image'
            },
            {
              id: 'sora-3',
              object: 'model',
              owned_by: 'openai',
              supported_endpoint_types: ['openai', 'video-generation'],
              type: 'video'
            }
          ]
        })
      })
    )

    const provider = new AiSdkProvider(createProvider(), createConfigPresenter())
    const models = await (provider as any).fetchProviderModels()

    expect(models[0]).toMatchObject({
      id: 'gpt-image-2',
      type: ModelType.ImageGeneration,
      selectableEndpointTypes: ['image-generation'],
      endpointType: 'image-generation'
    })
    expect(models[1]).toMatchObject({
      id: 'sora-3',
      type: ModelType.VideoGeneration,
      selectableEndpointTypes: ['video-generation'],
      endpointType: 'video-generation'
    })
  })

  it('keeps openai-compatible selectable endpoint for openai-only non-chat models', async () => {
    vi.spyOn(modelCapabilities, 'findCapabilityModelMatch').mockReturnValue(undefined)
    vi.spyOn(modelCapabilities, 'supportsReasoning').mockReturnValue(false)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'text-embedding-3-large',
              object: 'model',
              owned_by: 'openai',
              supported_endpoint_types: ['openai'],
              type: 'embedding'
            }
          ]
        })
      })
    )

    const provider = new AiSdkProvider(createProvider(), createConfigPresenter())
    const models = await (provider as any).fetchProviderModels()

    expect(models[0]).toMatchObject({
      id: 'text-embedding-3-large',
      type: ModelType.Embedding,
      supportedEndpointTypes: ['openai'],
      selectableEndpointTypes: ['openai'],
      endpointType: 'openai'
    })
  })

  it('exposes all chat endpoints for openai-only GPT models without an explicit chat type', async () => {
    vi.spyOn(modelCapabilities, 'findCapabilityModelMatch').mockReturnValue(undefined)
    vi.spyOn(modelCapabilities, 'supportsReasoning').mockReturnValue(false)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'gpt-5.5',
              object: 'model',
              owned_by: 'openai',
              supported_endpoint_types: ['openai']
            }
          ]
        })
      })
    )

    const provider = new AiSdkProvider(createProvider(), createConfigPresenter())
    const models = await (provider as any).fetchProviderModels()

    expect(models[0]).toMatchObject({
      id: 'gpt-5.5',
      supportedEndpointTypes: ['openai'],
      selectableEndpointTypes: ['openai', 'openai-response', 'anthropic', 'gemini'],
      endpointType: 'openai'
    })
  })

  it('does not expose responses for openai-only audio models', async () => {
    vi.spyOn(modelCapabilities, 'findCapabilityModelMatch').mockReturnValue(undefined)
    vi.spyOn(modelCapabilities, 'supportsReasoning').mockReturnValue(false)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'tts-1',
              object: 'model',
              owned_by: 'openai',
              supported_endpoint_types: ['openai'],
              type: 'chat'
            },
            {
              id: 'whisper-1',
              object: 'model',
              owned_by: 'openai',
              supported_endpoint_types: ['openai']
            }
          ]
        })
      })
    )

    const provider = new AiSdkProvider(createProvider(), createConfigPresenter())
    const models = await (provider as any).fetchProviderModels()

    expect(models).toHaveLength(2)
    for (const model of models) {
      expect(model.supportedEndpointTypes).toEqual(['openai'])
      expect(model.endpointType).toBe('openai')
      expect(model.selectableEndpointTypes).toEqual(['openai'])
    }
  })

  it('exposes media selectable endpoint for sparse known image model ids', async () => {
    vi.spyOn(modelCapabilities, 'findCapabilityModelMatch').mockReturnValue(undefined)
    vi.spyOn(modelCapabilities, 'supportsReasoning').mockReturnValue(false)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'gpt-image-2',
              object: 'model',
              owned_by: 'openai',
              supported_endpoint_types: ['openai']
            }
          ]
        })
      })
    )

    const provider = new AiSdkProvider(createProvider(), createConfigPresenter())
    const models = await (provider as any).fetchProviderModels()

    expect(models[0]).toMatchObject({
      id: 'gpt-image-2',
      type: ModelType.ImageGeneration,
      supportedEndpointTypes: ['openai'],
      selectableEndpointTypes: ['image-generation'],
      endpointType: 'openai'
    })
  })

  it('exposes all chat endpoints for non-OpenAI relay chat models', async () => {
    vi.spyOn(modelCapabilities, 'findCapabilityModelMatch').mockReturnValue(undefined)
    vi.spyOn(modelCapabilities, 'supportsReasoning').mockReturnValue(false)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'qwen3.7-max',
              object: 'model',
              owned_by: 'alibaba',
              supported_endpoint_types: ['openai'],
              type: 'chat'
            },
            {
              id: 'deepseek-chat',
              object: 'model',
              owned_by: 'deepseek',
              supported_endpoint_types: ['openai'],
              type: 'chat'
            }
          ]
        })
      })
    )

    const provider = new AiSdkProvider(createProvider(), createConfigPresenter())
    const models = await (provider as any).fetchProviderModels()

    expect(models).toHaveLength(2)
    for (const model of models) {
      expect(model.supportedEndpointTypes).toEqual(['openai'])
      expect(model.endpointType).toBe('openai')
      expect(model.selectableEndpointTypes).toEqual([
        'openai',
        'openai-response',
        'anthropic',
        'gemini'
      ])
    }
  })

  it('does not overwrite user-owned model configs during provider refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'claude-opus-4-8',
              object: 'model',
              owned_by: 'claude',
              supported_endpoint_types: []
            }
          ]
        })
      })
    )

    const configPresenter = createConfigPresenter()
    vi.mocked(configPresenter.hasUserModelConfig).mockReturnValue(true)
    const provider = new AiSdkProvider(createProvider(), configPresenter)
    const models = await (provider as any).fetchProviderModels()

    expect(models[0]).toMatchObject({
      endpointType: 'anthropic',
      ownedBy: 'claude'
    })
    expect(configPresenter.setModelConfig).not.toHaveBeenCalled()
  })

  it('keeps non-Claude models on the original supported endpoint order', () => {
    const provider = new AiSdkProvider(
      createProvider({
        id: 'fork-api',
        name: 'Fork API',
        apiType: 'new-api'
      }),
      createConfigPresenter(
        {},
        {
          'fork-api': [
            {
              id: 'gpt-5.4',
              name: 'GPT-5.4',
              group: 'default',
              providerId: 'fork-api',
              isCustom: false,
              supportedEndpointTypes: ['openai-response', 'anthropic'],
              type: ModelType.Chat
            }
          ]
        }
      )
    )
    const routeDecision = (provider as any).resolveRouteDecision('gpt-5.4')
    const runtimeProvider = (provider as any).getRuntimeProvider(routeDecision) as LLM_PROVIDER

    expect(routeDecision.endpointType).toBe('openai-response')
    expect(runtimeProvider.apiType).toBe('openai-responses')
    expect(runtimeProvider.capabilityProviderId).toBe('openai')
    expect(routeDecision.supportsOfficialAnthropicReasoning).toBeUndefined()
  })

  it('maps zenmux anthropic routes to official anthropic reasoning semantics', () => {
    const zenmuxProvider = createProvider({
      id: 'zenmux',
      name: 'ZenMux',
      apiType: 'openai',
      baseUrl: 'https://zenmux.ai/api'
    })
    const provider = new AiSdkProvider(zenmuxProvider, createConfigPresenter())
    const routeDecision = (provider as any).resolveRouteDecision('anthropic/claude-sonnet-4.5')
    const runtimeProvider = (provider as any).getRuntimeProvider(routeDecision) as LLM_PROVIDER
    const runtimeContext = (provider as any).buildRuntimeContext('anthropic/claude-sonnet-4.5')
    const definition = resolveAiSdkProviderDefinition(zenmuxProvider)

    expect(definition?.anthropicBaseUrl).toBeTruthy()
    expect(routeDecision.providerKind).toBe('anthropic')
    expect(routeDecision.supportsOfficialAnthropicReasoning).toBe(true)
    expect(runtimeProvider.apiType).toBe('anthropic')
    expect(runtimeProvider.baseUrl).toBe(definition?.anthropicBaseUrl)
    expect(runtimeProvider.capabilityProviderId).toBe('anthropic')
    expect(runtimeContext.context.provider.capabilityProviderId).toBe('anthropic')
    expect(runtimeContext.context.supportsOfficialAnthropicReasoning).toBe(true)
  })

  it('keeps transport-compatible anthropic api providers off the official anthropic reasoning route', () => {
    const provider = new AiSdkProvider(
      createProvider({
        id: 'my-anthropic-proxy',
        name: 'My Anthropic Proxy',
        apiType: 'anthropic',
        baseUrl: 'https://proxy.example.com/anthropic'
      }),
      createConfigPresenter()
    )
    const routeDecision = (provider as any).resolveRouteDecision('claude-opus-4-7')
    const runtimeProvider = (provider as any).getRuntimeProvider(routeDecision) as LLM_PROVIDER
    const runtimeContext = (provider as any).buildRuntimeContext('claude-opus-4-7')

    expect(routeDecision.providerKind).toBe('anthropic')
    expect(routeDecision.supportsOfficialAnthropicReasoning).toBeUndefined()
    expect(runtimeProvider.capabilityProviderId).toBeUndefined()
    expect(runtimeContext.context.provider.capabilityProviderId).toBeUndefined()
    expect(runtimeContext.context.supportsOfficialAnthropicReasoning).toBeUndefined()
  })

  it('keeps minimax off the official anthropic reasoning route', () => {
    const provider = new AiSdkProvider(
      createProvider({
        id: 'minimax',
        name: 'MiniMax',
        apiType: 'anthropic',
        baseUrl: 'https://api.minimaxi.com/anthropic'
      }),
      createConfigPresenter()
    )
    const routeDecision = (provider as any).resolveRouteDecision('MiniMax-M2.5')
    const runtimeProvider = (provider as any).getRuntimeProvider(routeDecision) as LLM_PROVIDER
    const runtimeContext = (provider as any).buildRuntimeContext('MiniMax-M2.5')

    expect(routeDecision.providerKind).toBe('anthropic')
    expect(routeDecision.supportsOfficialAnthropicReasoning).toBeUndefined()
    expect(runtimeProvider.capabilityProviderId).toBeUndefined()
    expect(runtimeContext.context.provider.capabilityProviderId).toBeUndefined()
    expect(runtimeContext.context.supportsOfficialAnthropicReasoning).toBeUndefined()
  })

  it('keeps image-generation on the image runtime route while using openai capabilities', async () => {
    const configPresenter = createConfigPresenter({
      'gpt-image-1': {
        endpointType: 'image-generation',
        apiEndpoint: ApiEndpointType.Chat,
        type: ModelType.Chat
      }
    })
    const provider = new AiSdkProvider(createProvider(), configPresenter)
    ;(provider as any).isInitialized = true

    const result = await provider.completions(
      [{ role: 'user', content: 'Draw a cat' }],
      'gpt-image-1'
    )

    const modelConfig = mockRunAiSdkCoreStream.mock.calls.at(-1)?.[3]
    const context = mockRunAiSdkCoreStream.mock.calls.at(-1)?.[0]

    expect(context.provider.capabilityProviderId).toBe('openai')
    expect(modelConfig.apiEndpoint).toBe(ApiEndpointType.Image)
    expect(modelConfig.type).toBe(ModelType.ImageGeneration)
    expect(modelConfig.endpointType).toBe('image-generation')
    expect(result.content).toBe('generated-image')
  })
})
