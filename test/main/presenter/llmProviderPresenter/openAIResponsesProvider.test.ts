import { describe, expect, it, vi } from 'vitest'
import type { IConfigPresenter, LLM_PROVIDER, ModelConfig } from '../../../../src/shared/presenter'
import { OpenAIResponsesProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/openAIResponsesProvider'

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
  runAiSdkCoreStream: vi.fn(),
  runAiSdkDimensions: vi.fn(),
  runAiSdkEmbeddings: vi.fn(),
  runAiSdkGenerateText: vi.fn()
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
  it('uses the responses runtime for official OpenAI providers', () => {
    const provider = new OpenAIResponsesProvider(createProvider(), createConfigPresenter())
    const context = (provider as any).getAiSdkRuntimeContext()

    expect(context.providerKind).toBe('openai-responses')
    expect(context.shouldUseImageGeneration('gpt-image-1', {} as ModelConfig)).toBe(true)
    expect(context.shouldUseImageGeneration('gpt-4o', {} as ModelConfig)).toBe(false)
  })

  it('uses azure runtime semantics for azure-openai responses providers', () => {
    const provider = new OpenAIResponsesProvider(
      createProvider({
        id: 'azure-openai',
        name: 'Azure OpenAI',
        baseUrl: 'https://example.openai.azure.com/openai'
      }),
      createConfigPresenter()
    )
    const context = (provider as any).getAiSdkRuntimeContext()

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
