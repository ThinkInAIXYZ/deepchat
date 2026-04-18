import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IConfigPresenter, LLM_PROVIDER, ModelConfig } from '../../../../src/shared/presenter'
import { ApiEndpointType, ModelType } from '../../../../src/shared/model'
import { AiSdkProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/aiSdkProvider'
import { resolveAiSdkProviderDefinition } from '../../../../src/main/presenter/llmProviderPresenter/providerRegistry'

const { mockRunAiSdkCoreStream } = vi.hoisted(() => ({
  mockRunAiSdkCoreStream: vi.fn()
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
    sendToRenderer: vi.fn(),
    sendToMain: vi.fn(),
    emit: vi.fn(),
    send: vi.fn()
  },
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
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
