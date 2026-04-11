import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IConfigPresenter, LLM_PROVIDER } from '../../../../src/shared/presenter'
import { AihubmixProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/aihubmixProvider'
import type { AiSdkRuntimeContext } from '../../../../src/main/presenter/llmProviderPresenter/aiSdk/runtime'

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
  runAiSdkCoreStream: vi.fn(),
  runAiSdkDimensions: vi.fn(),
  runAiSdkEmbeddings: vi.fn(),
  runAiSdkGenerateText: vi.fn()
}))

class TestAihubmixProvider extends AihubmixProvider {
  public exposeAiSdkRuntimeContext(): AiSdkRuntimeContext {
    return this.getAiSdkRuntimeContext()
  }
}

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
  })

  it('preserves the DeepChat APP-Code header in AI SDK mode', () => {
    const provider = new TestAihubmixProvider(createProvider(), createConfigPresenter())
    const context = provider.exposeAiSdkRuntimeContext()

    expect(context.defaultHeaders).toMatchObject({
      'APP-Code': 'SMUE7630',
      'X-Title': 'DeepChat'
    })
  })
})
