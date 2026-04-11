import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IConfigPresenter, LLM_PROVIDER, ModelConfig } from '../../../../src/shared/presenter'
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

const createConfigPresenter = (): IConfigPresenter =>
  ({
    getProviders: vi.fn().mockReturnValue([]),
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getModelConfig: vi.fn().mockReturnValue(undefined),
    getSetting: vi.fn().mockReturnValue(undefined),
    setProviderModels: vi.fn(),
    getModelStatus: vi.fn().mockReturnValue(true)
  }) as unknown as IConfigPresenter

const createProvider = (): LLM_PROVIDER =>
  ({
    id: 'aihubmix',
    name: 'Aihubmix',
    apiType: 'openai-compatible',
    apiKey: 'test-key',
    baseUrl: 'https://aihubmix.com/v1',
    enable: false
  }) as LLM_PROVIDER

describe('AihubmixProvider AI SDK runtime headers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunAiSdkCoreStream.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'stop', stop_reason: 'complete' }
      }
    })
  })

  it('preserves the DeepChat APP-Code header in AI SDK mode', async () => {
    const provider = new AiSdkProvider(createProvider(), createConfigPresenter())
    ;(provider as any).isInitialized = true

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

    const context = mockRunAiSdkCoreStream.mock.calls.at(-1)?.[0]

    expect(context.defaultHeaders).toMatchObject({
      'APP-Code': 'SMUE7630',
      'X-Title': 'DeepChat'
    })
  })
})
