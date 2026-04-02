import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IConfigPresenter, LLM_PROVIDER } from '../../../../src/shared/presenter'
import { ZenmuxProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/zenmuxProvider'

const ZENMUX_ANTHROPIC_BASE_URL = 'https://zenmux.ai/api/anthropic'

const {
  mockOpenAIConstructor,
  mockAnthropicConstructor,
  mockChatCompletionsCreate,
  mockOpenAIModelsList,
  mockAnthropicMessagesCreate,
  mockAnthropicModelsList,
  mockGetProxyUrl,
  mockCacheImage
} = vi.hoisted(() => ({
  mockOpenAIConstructor: vi.fn(),
  mockAnthropicConstructor: vi.fn(),
  mockChatCompletionsCreate: vi.fn(),
  mockOpenAIModelsList: vi.fn().mockResolvedValue({ data: [] }),
  mockAnthropicMessagesCreate: vi.fn(),
  mockAnthropicModelsList: vi.fn().mockResolvedValue({ data: [] }),
  mockGetProxyUrl: vi.fn().mockReturnValue(null),
  mockCacheImage: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getName: vi.fn(() => 'DeepChat'),
    getVersion: vi.fn(() => '0.0.0-test'),
    getPath: vi.fn(() => '/mock/path'),
    isReady: vi.fn(() => true),
    on: vi.fn()
  },
  session: {},
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
    removeHandler: vi.fn()
  },
  BrowserWindow: vi.fn(() => ({
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn(),
    webContents: { send: vi.fn(), on: vi.fn(), isDestroyed: vi.fn(() => false) },
    isDestroyed: vi.fn(() => false),
    close: vi.fn(),
    show: vi.fn(),
    hide: vi.fn()
  })),
  dialog: {
    showOpenDialog: vi.fn()
  },
  shell: {
    openExternal: vi.fn()
  }
}))

vi.mock('openai', () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: mockChatCompletionsCreate
      }
    }
    models = {
      list: mockOpenAIModelsList
    }
    embeddings = {
      create: vi.fn()
    }

    constructor(options: Record<string, unknown>) {
      mockOpenAIConstructor(options)
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
      cacheImage: mockCacheImage
    }
  }
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation((options: Record<string, unknown>) => {
    mockAnthropicConstructor(options)
    return {
      messages: {
        create: mockAnthropicMessagesCreate
      },
      models: {
        list: mockAnthropicModelsList
      }
    }
  })
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
  NOTIFICATION_EVENTS: {
    SHOW_ERROR: 'SHOW_ERROR'
  }
}))

vi.mock('../../../../src/main/presenter/proxyConfig', () => ({
  proxyConfig: {
    getProxyUrl: mockGetProxyUrl
  }
}))

vi.mock('../../../../src/main/presenter/configPresenter/modelCapabilities', () => ({
  modelCapabilities: {
    supportsReasoningEffort: vi.fn().mockReturnValue(false),
    supportsVerbosity: vi.fn().mockReturnValue(false),
    supportsReasoning: vi.fn().mockReturnValue(false),
    resolveProviderId: vi.fn((providerId: string) => providerId)
  }
}))

const createConfigPresenter = () =>
  ({
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getModelConfig: vi.fn().mockReturnValue(undefined),
    getDbProviderModels: vi.fn().mockReturnValue([]),
    getSetting: vi.fn().mockReturnValue(undefined),
    setProviderModels: vi.fn(),
    getModelStatus: vi.fn().mockReturnValue(true)
  }) as unknown as IConfigPresenter

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'zenmux',
  name: 'ZenMux',
  apiType: 'zenmux',
  apiKey: 'test-key',
  baseUrl: 'https://zenmux.ai/api/v1/',
  enable: false,
  ...overrides
})

describe('ZenmuxProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProxyUrl.mockReturnValue(null)
    mockOpenAIModelsList.mockResolvedValue({ data: [] })
    mockAnthropicModelsList.mockResolvedValue({ data: [] })
    mockChatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: 'openai-ok' } }]
    })
    mockAnthropicMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'anthropic-ok' }],
      usage: undefined
    })
  })

  it('routes anthropic/* models through the fixed Anthropic endpoint', async () => {
    const provider = new ZenmuxProvider(createProvider(), createConfigPresenter())

    const result = await provider.generateText('hello', 'anthropic/claude-sonnet-4-5')

    expect(result.content).toBe('anthropic-ok')
    expect(mockAnthropicConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-key',
        baseURL: ZENMUX_ANTHROPIC_BASE_URL
      })
    )
    expect(mockAnthropicMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'anthropic/claude-sonnet-4-5'
      })
    )
    expect(mockAnthropicMessagesCreate.mock.calls.at(-1)?.[0]).not.toHaveProperty('cache_control')
    expect(mockChatCompletionsCreate).not.toHaveBeenCalled()
  })

  it('uses explicit Anthropic cache breakpoints for ZenMux Claude history', async () => {
    mockAnthropicMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'anthropic-ok' }],
      usage: undefined
    })

    const provider = new ZenmuxProvider(createProvider(), createConfigPresenter())
    const anthropicDelegate = (provider as any).anthropicDelegate
    anthropicDelegate.clientInitialized = true
    anthropicDelegate.isInitialized = true
    anthropicDelegate.anthropic = {
      messages: {
        create: mockAnthropicMessagesCreate
      },
      models: {
        list: mockAnthropicModelsList
      }
    }
    vi.spyOn(anthropicDelegate, 'ensureClientInitialized').mockResolvedValue(undefined)

    const result = await provider.completions(
      [
        { role: 'user', content: 'history' },
        { role: 'assistant', content: 'stable reply' },
        { role: 'user', content: 'latest question' }
      ],
      'anthropic/claude-sonnet-4-5'
    )

    expect(result.content).toBe('anthropic-ok')
    expect(mockAnthropicMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'anthropic/claude-sonnet-4-5',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'history' }]
          },
          {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: 'stable reply',
                cache_control: {
                  type: 'ephemeral'
                }
              }
            ]
          },
          {
            role: 'user',
            content: [{ type: 'text', text: 'latest question' }]
          }
        ]
      })
    )
    expect(mockAnthropicMessagesCreate.mock.calls.at(-1)?.[0]).not.toHaveProperty('cache_control')
  })

  it('routes non-anthropic models through the configured OpenAI-compatible endpoint', async () => {
    const provider = new ZenmuxProvider(
      createProvider({ baseUrl: 'https://custom.zenmux.ai/api/v1' }),
      createConfigPresenter()
    )

    const result = await provider.generateText('hello', 'moonshotai/kimi-k2.5')

    expect(result.content).toBe('openai-ok')
    expect(mockOpenAIConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-key',
        baseURL: 'https://custom.zenmux.ai/api/v1'
      })
    )
    expect(mockChatCompletionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'moonshotai/kimi-k2.5'
      })
    )
    expect(mockAnthropicMessagesCreate).not.toHaveBeenCalled()
  })

  it('fetches model metadata from the OpenAI-compatible models API and keeps the ZenMux group', async () => {
    mockOpenAIModelsList.mockResolvedValue({
      data: [{ id: 'moonshotai/kimi-k2.5' }, { id: 'anthropic/claude-sonnet-4-5' }]
    })

    const provider = new ZenmuxProvider(createProvider(), createConfigPresenter())
    const models = await provider.fetchModels()

    expect(mockOpenAIModelsList).toHaveBeenCalled()
    expect(models).toEqual([
      expect.objectContaining({
        id: 'moonshotai/kimi-k2.5',
        group: 'ZenMux',
        providerId: 'zenmux'
      }),
      expect.objectContaining({
        id: 'anthropic/claude-sonnet-4-5',
        group: 'ZenMux',
        providerId: 'zenmux'
      })
    ])
  })

  it('uses the OpenAI-compatible check path', async () => {
    const provider = new ZenmuxProvider(createProvider(), createConfigPresenter())

    const result = await provider.check()

    expect(result).toEqual({ isOk: true, errorMsg: null })
    expect(mockOpenAIModelsList).toHaveBeenCalled()
    expect(mockAnthropicMessagesCreate).not.toHaveBeenCalled()
  })

  it('refreshes both delegates on proxy updates after the anthropic route has been initialized', async () => {
    const provider = new ZenmuxProvider(createProvider(), createConfigPresenter())
    const openaiDelegate = (provider as any).openaiDelegate
    const anthropicDelegate = (provider as any).anthropicDelegate
    const openaiProxySpy = vi.spyOn(openaiDelegate, 'onProxyResolved')
    const anthropicProxySpy = vi.spyOn(anthropicDelegate, 'onProxyResolved')
    await anthropicDelegate.ensureClientInitialized()

    expect(anthropicDelegate.isClientInitialized()).toBe(true)

    provider.onProxyResolved()

    expect(openaiProxySpy).toHaveBeenCalledTimes(1)
    expect(anthropicProxySpy).toHaveBeenCalledTimes(1)
  })
})
