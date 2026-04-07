import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IConfigPresenter, LLM_PROVIDER, ModelConfig } from '../../../../src/shared/presenter'
import { DoubaoProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/doubaoProvider'

const { mockChatCompletionsCreate, mockGetProvider, mockGetModel, mockGetProxyUrl } = vi.hoisted(
  () => ({
    mockChatCompletionsCreate: vi.fn(),
    mockGetProvider: vi.fn(),
    mockGetModel: vi.fn(),
    mockGetProxyUrl: vi.fn().mockReturnValue(null)
  })
)

vi.mock('openai', () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: mockChatCompletionsCreate
      }
    }
    models = {
      list: vi.fn().mockResolvedValue({ data: [] })
    }
  }

  return {
    default: MockOpenAI,
    AzureOpenAI: MockOpenAI
  }
})

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
    MODEL_LIST_CHANGED: 'MODEL_LIST_CHANGED'
  },
  NOTIFICATION_EVENTS: {
    SHOW_ERROR: 'SHOW_ERROR'
  }
}))

vi.mock('../../../../src/main/presenter/proxyConfig', () => ({
  proxyConfig: {
    getProxyUrl: mockGetProxyUrl
  }
}))

vi.mock('../../../../src/main/presenter/configPresenter/providerDbLoader', () => ({
  providerDbLoader: {
    getProvider: mockGetProvider,
    getModel: mockGetModel
  }
}))

vi.mock('../../../../src/main/presenter/configPresenter/modelCapabilities', () => ({
  modelCapabilities: {
    supportsReasoningEffort: vi.fn().mockReturnValue(false),
    supportsVerbosity: vi.fn().mockReturnValue(false),
    supportsReasoning: vi.fn().mockReturnValue(false)
  }
}))

const createAsyncStream = (chunks: Array<Record<string, unknown>>) => ({
  async *[Symbol.asyncIterator]() {
    for (const chunk of chunks) {
      yield chunk
    }
  }
})

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'doubao',
  name: 'Doubao',
  apiType: 'doubao',
  apiKey: 'test-key',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  enable: false,
  ...overrides
})

const createConfigPresenter = () =>
  ({
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getModelConfig: vi.fn().mockReturnValue(undefined),
    getSetting: vi.fn().mockReturnValue(undefined),
    setProviderModels: vi.fn(),
    getModelStatus: vi.fn().mockReturnValue(true)
  }) as unknown as IConfigPresenter

describe('DoubaoProvider', () => {
  const modelConfig: ModelConfig = {
    maxTokens: 1024,
    contextLength: 8192,
    vision: true,
    functionCall: true,
    reasoning: true,
    type: 'chat'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProxyUrl.mockReturnValue(null)
    mockChatCompletionsCreate.mockResolvedValue(
      createAsyncStream([
        {
          choices: [
            {
              delta: {
                content: 'ok'
              },
              finish_reason: 'stop'
            }
          ]
        }
      ])
    )
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

    const provider = new DoubaoProvider(createProvider(), createConfigPresenter())
    const models = await (provider as any).fetchOpenAIModels()

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

  it('adds Doubao thinking parameter for reasoning models based on metadata notes', async () => {
    mockGetProvider.mockReturnValue({
      id: 'doubao',
      name: 'Doubao',
      models: []
    })
    mockGetModel.mockReturnValue({
      id: 'doubao-seed-2.0-pro',
      extra_capabilities: {
        reasoning: {
          notes: ['doubao-thinking-parameter']
        }
      }
    })

    const provider = new DoubaoProvider(createProvider(), createConfigPresenter())
    ;(provider as any).isInitialized = true

    const events = []
    for await (const event of provider.coreStream(
      [{ role: 'user', content: 'hello' }],
      'doubao-seed-2.0-pro',
      modelConfig,
      0.7,
      1024,
      []
    )) {
      events.push(event)
    }

    expect(events.some((event) => event.type === 'text')).toBe(true)
    expect(mockChatCompletionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'doubao-seed-2.0-pro',
        thinking: {
          type: 'enabled'
        }
      }),
      undefined
    )
  })
})
