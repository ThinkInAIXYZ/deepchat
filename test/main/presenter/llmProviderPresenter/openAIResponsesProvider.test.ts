import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IConfigPresenter, LLM_PROVIDER, ModelConfig } from '../../../../src/shared/presenter'
import { AiSdkProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/aiSdkProvider'

const {
  mockRunAiSdkCoreStream,
  mockRunAiSdkDimensions,
  mockRunAiSdkEmbeddings,
  mockRunAiSdkGenerateText
} = vi.hoisted(() => ({
  mockRunAiSdkCoreStream: vi.fn(),
  mockRunAiSdkDimensions: vi.fn(),
  mockRunAiSdkEmbeddings: vi.fn(),
  mockRunAiSdkGenerateText: vi.fn()
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

vi.mock('@/eventbus', () => ({
  eventBus: {
    on: vi.fn(),
    sendToRenderer: vi.fn()
  },
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
  }
}))

vi.mock('@/events', () => ({
  CONFIG_EVENTS: {
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
  runAiSdkDimensions: mockRunAiSdkDimensions,
  runAiSdkEmbeddings: mockRunAiSdkEmbeddings,
  runAiSdkGenerateText: mockRunAiSdkGenerateText
}))

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'openai',
  name: 'OpenAI',
  apiType: 'openai-responses',
  apiKey: 'test-key',
  baseUrl: 'https://api.openai.com/v1',
  enable: false,
  ...overrides
})

const createConfigPresenter = (): IConfigPresenter =>
  ({
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getModelConfig: vi.fn().mockReturnValue(undefined),
    getSetting: vi.fn().mockReturnValue(undefined),
    setProviderModels: vi.fn(),
    getModelStatus: vi.fn().mockReturnValue(true)
  }) as unknown as IConfigPresenter

describe('OpenAIResponsesProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunAiSdkCoreStream.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'stop', stop_reason: 'complete' }
      }
    })
  })

  it('uses the responses runtime for official OpenAI providers', async () => {
    const provider = new AiSdkProvider(createProvider(), createConfigPresenter())
    ;(provider as any).isInitialized = true

    try {
      for await (const _event of provider.coreStream(
        [{ role: 'user', content: 'hello' }],
        'gpt-4o',
        {
          maxTokens: 1024,
          contextLength: 8192,
          vision: false,
          functionCall: false,
          reasoning: false,
          type: 'chat'
        } as ModelConfig,
        0.7,
        256,
        []
      )) {
        break
      }
    } catch {}

    const context = mockRunAiSdkCoreStream.mock.calls.at(-1)?.[0]

    expect(context.providerKind).toBe('openai-responses')
    expect(context.shouldUseImageGeneration('gpt-image-1', {} as ModelConfig)).toBe(true)
    expect(context.shouldUseImageGeneration('gpt-4o', {} as ModelConfig)).toBe(false)
  })

  it('uses azure runtime semantics for azure-openai responses providers', async () => {
    const provider = new AiSdkProvider(
      createProvider({
        id: 'azure-openai',
        name: 'Azure OpenAI',
        baseUrl: 'https://example.openai.azure.com/openai'
      }),
      createConfigPresenter()
    )
    ;(provider as any).isInitialized = true

    try {
      for await (const _event of provider.coreStream(
        [{ role: 'user', content: 'paint' }],
        'gpt-image-1',
        {
          apiEndpoint: 'image',
          maxTokens: 1024,
          contextLength: 8192,
          vision: false,
          functionCall: false,
          reasoning: false,
          type: 'chat'
        } as ModelConfig,
        0.7,
        256,
        []
      )) {
        break
      }
    } catch {}

    const context = mockRunAiSdkCoreStream.mock.calls.at(-1)?.[0]

    expect(context.providerKind).toBe('azure')
    expect(context.buildTraceHeaders()).toMatchObject({
      'Content-Type': 'application/json',
      'api-key': 'test-key'
    })
    expect(
      context.shouldUseImageGeneration('gpt-image-1', {
        apiEndpoint: 'image'
      } as ModelConfig)
    ).toBe(true)
    expect(context.shouldUseImageGeneration('gpt-image-1', {} as ModelConfig)).toBe(false)
  })
})
