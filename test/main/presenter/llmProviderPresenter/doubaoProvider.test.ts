import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IConfigPresenter, LLM_PROVIDER } from '../../../../src/shared/presenter'
import { AiSdkProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/aiSdkProvider'

const { mockGetProvider } = vi.hoisted(() => ({
  mockGetProvider: vi.fn()
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

vi.mock('../../../../src/main/presenter/configPresenter/providerDbLoader', () => ({
  providerDbLoader: {
    getDb: vi.fn().mockReturnValue(null),
    getProvider: mockGetProvider,
    getModel: vi.fn()
  }
}))

vi.mock('../../../../src/main/presenter/llmProviderPresenter/aiSdk', () => ({
  runAiSdkCoreStream: vi.fn(),
  runAiSdkDimensions: vi.fn(),
  runAiSdkEmbeddings: vi.fn(),
  runAiSdkGenerateText: vi.fn()
}))

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'doubao',
  name: 'Doubao',
  apiType: 'doubao',
  apiKey: 'test-key',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
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

describe('AiSdkProvider doubao', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps doubao catalog entries into provider models', async () => {
    mockGetProvider.mockReturnValue({
      id: 'doubao',
      name: 'Doubao',
      models: [
        {
          id: 'doubao-seed-2.0-pro',
          display_name: 'Doubao-Seed 2.0 Pro',
          tool_call: true,
          reasoning: {
            supported: true
          },
          modalities: {
            input: ['text', 'image', 'video'],
            output: ['text']
          },
          limit: {
            context: 256000,
            output: 64000
          }
        }
      ]
    })

    const provider = new AiSdkProvider(createProvider(), createConfigPresenter())
    const models = await provider.fetchModels()

    expect(models).toEqual([
      expect.objectContaining({
        id: 'doubao-seed-2.0-pro',
        name: 'Doubao-Seed 2.0 Pro',
        providerId: 'doubao',
        vision: true,
        functionCall: true,
        reasoning: true
      })
    ])
  })
})
