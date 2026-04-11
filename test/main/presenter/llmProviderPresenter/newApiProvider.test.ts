import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IConfigPresenter, LLM_PROVIDER, ModelConfig } from '../../../../src/shared/presenter'
import { ApiEndpointType, ModelType } from '../../../../src/shared/model'
import { AiSdkProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/aiSdkProvider'

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
  modelConfigById: Record<string, Partial<ModelConfig>> = {}
): IConfigPresenter =>
  ({
    getProviders: vi.fn().mockReturnValue([]),
    getProviderModels: vi.fn().mockReturnValue([]),
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
