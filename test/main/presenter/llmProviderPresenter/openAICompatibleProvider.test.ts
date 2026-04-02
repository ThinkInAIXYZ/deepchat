import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ChatMessage,
  IConfigPresenter,
  ISQLitePresenter,
  LLM_PROVIDER,
  MCPToolDefinition,
  ModelConfig
} from '../../../../src/shared/presenter'
import {
  OpenAICompatibleProvider,
  normalizeExtractedImageText
} from '../../../../src/main/presenter/llmProviderPresenter/providers/openAICompatibleProvider'
import { OpenRouterProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/openRouterProvider'
import { LLMProviderPresenter } from '../../../../src/main/presenter/llmProviderPresenter'

const {
  mockChatCompletionsCreate,
  mockModelsList,
  mockMcpToolsToOpenAITools,
  mockGetProxyUrl,
  mockCacheImage
} = vi.hoisted(() => ({
  mockChatCompletionsCreate: vi.fn(),
  mockModelsList: vi.fn().mockResolvedValue({ data: [] }),
  mockMcpToolsToOpenAITools: vi.fn().mockResolvedValue([]),
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
      list: mockModelsList
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

const createAsyncStream = (chunks: Array<Record<string, unknown>>) => ({
  async *[Symbol.asyncIterator]() {
    for (const chunk of chunks) {
      yield chunk
    }
  }
})

const collectEvents = async (
  provider: OpenAICompatibleProvider,
  providerModel: string,
  modelConfig: ModelConfig,
  messages: ChatMessage[],
  tools: MCPToolDefinition[]
) => {
  const events = []
  for await (const event of provider.coreStream(
    messages,
    providerModel,
    modelConfig,
    0.7,
    512,
    tools
  )) {
    events.push(event)
  }
  return events
}

const createConfigPresenter = (providers: LLM_PROVIDER[]) =>
  ({
    getProviders: vi.fn().mockReturnValue(providers),
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getModelConfig: vi.fn().mockReturnValue(undefined),
    getSetting: vi.fn().mockReturnValue(undefined),
    setProviderModels: vi.fn(),
    getModelStatus: vi.fn().mockReturnValue(true)
  }) as unknown as IConfigPresenter

const mockSqlitePresenter = {
  getAcpSession: vi.fn().mockResolvedValue(null),
  upsertAcpSession: vi.fn().mockResolvedValue(undefined),
  updateAcpSessionId: vi.fn().mockResolvedValue(undefined),
  updateAcpWorkdir: vi.fn().mockResolvedValue(undefined),
  updateAcpSessionStatus: vi.fn().mockResolvedValue(undefined),
  deleteAcpSession: vi.fn().mockResolvedValue(undefined),
  deleteAcpSessions: vi.fn().mockResolvedValue(undefined)
} as unknown as ISQLitePresenter

describe('OpenAICompatibleProvider MCP runtime injection', () => {
  const convertedTools = [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get current weather',
        parameters: {
          type: 'object',
          properties: {
            city: {
              type: 'string'
            }
          }
        }
      }
    }
  ]

  const modelConfig: ModelConfig = {
    maxTokens: 1024,
    contextLength: 8192,
    vision: false,
    functionCall: true,
    reasoning: false,
    type: 'chat'
  }

  const messages: ChatMessage[] = [{ role: 'user', content: 'What is the weather today?' }]

  const mcpTools: MCPToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get current weather',
        parameters: {
          type: 'object',
          properties: {
            city: {
              type: 'string'
            }
          },
          required: ['city']
        }
      },
      server: {
        name: 'weather-server',
        icons: '',
        description: 'Weather tools'
      }
    }
  ]

  const mcpRuntime = {
    mcpToolsToOpenAITools: mockMcpToolsToOpenAITools
  }

  const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
    id: 'mock-openai-compatible',
    name: 'Mock OpenAI Compatible',
    apiType: 'openai-compatible',
    apiKey: 'test-key',
    baseUrl: 'https://mock.example.com/v1',
    enable: false,
    ...overrides
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockModelsList.mockResolvedValue({ data: [] })
    mockGetProxyUrl.mockReturnValue(null)
    mockMcpToolsToOpenAITools.mockResolvedValue(convertedTools)
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
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 4,
            total_tokens: 16
          }
        }
      ])
    )
  })

  it('injects converted tools for direct OpenAICompatibleProvider instances', async () => {
    const provider = new OpenAICompatibleProvider(
      createProvider(),
      createConfigPresenter([]),
      mcpRuntime as any
    )
    ;(provider as any).isInitialized = true

    const events = await collectEvents(provider, 'gpt-4o', modelConfig, messages, mcpTools)
    const requestParams = mockChatCompletionsCreate.mock.calls[0]?.[0]

    expect(events.some((event) => event.type === 'text')).toBe(true)
    expect(events.some((event) => event.type === 'stop')).toBe(true)
    expect(mockMcpToolsToOpenAITools).toHaveBeenCalledWith(mcpTools, 'mock-openai-compatible')
    expect(requestParams.tools).toEqual(convertedTools)
  })

  it('does not inject tools when mcpRuntime is missing', async () => {
    const provider = new OpenAICompatibleProvider(createProvider(), createConfigPresenter([]))
    ;(provider as any).isInitialized = true

    await collectEvents(provider, 'gpt-4o', modelConfig, messages, mcpTools)
    const requestParams = mockChatCompletionsCreate.mock.calls[0]?.[0]

    expect(mockMcpToolsToOpenAITools).not.toHaveBeenCalled()
    expect(requestParams.tools).toBeUndefined()
  })

  it('forwards mcpRuntime through OpenAICompatibleProvider subclasses', async () => {
    const provider = new OpenRouterProvider(
      createProvider({
        id: 'openrouter',
        name: 'OpenRouter'
      }),
      createConfigPresenter([]),
      mcpRuntime as any
    )
    ;(provider as any).isInitialized = true

    await collectEvents(provider, 'gpt-4o', modelConfig, messages, mcpTools)
    const requestParams = mockChatCompletionsCreate.mock.calls[0]?.[0]

    expect(mockMcpToolsToOpenAITools).toHaveBeenCalledWith(mcpTools, 'openrouter')
    expect(requestParams.tools).toEqual(convertedTools)
  })

  it('preserves mcpRuntime on the LLMProviderPresenter instantiation path', async () => {
    const providerConfig = createProvider({
      id: 'openrouter',
      name: 'OpenRouter'
    })
    const llmProviderPresenter = new LLMProviderPresenter(
      createConfigPresenter([providerConfig]),
      mockSqlitePresenter,
      mcpRuntime as any
    )

    const provider = llmProviderPresenter.getProviderInstance('openrouter') as OpenRouterProvider
    ;(provider as any).isInitialized = true

    await collectEvents(provider, 'gpt-4o', modelConfig, messages, mcpTools)
    const requestParams = mockChatCompletionsCreate.mock.calls[0]?.[0]

    expect(provider).toBeInstanceOf(OpenRouterProvider)
    expect(mockMcpToolsToOpenAITools).toHaveBeenCalledWith(mcpTools, 'openrouter')
    expect(requestParams.tools).toEqual(convertedTools)
  })
})

describe('normalizeExtractedImageText', () => {
  it('keeps meaningful text after image markdown cleanup', () => {
    expect(normalizeExtractedImageText('  Here is the updated image.\n\n')).toBe(
      'Here is the updated image.'
    )
  })

  it('drops markdown residue after image markdown cleanup', () => {
    expect(normalizeExtractedImageText('`\n')).toBe('')
    expect(normalizeExtractedImageText('[]()')).toBe('')
  })
})

describe('OpenAICompatibleProvider prompt cache behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockModelsList.mockResolvedValue({ data: [] })
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
          ],
          usage: {
            prompt_tokens: 80,
            completion_tokens: 12,
            total_tokens: 92,
            prompt_tokens_details: {
              cached_tokens: 24,
              cache_write_tokens: 16
            }
          }
        }
      ])
    )
  })

  it('injects prompt_cache_key only for official OpenAI chat completions', async () => {
    const provider = new OpenAICompatibleProvider(
      {
        id: 'openai',
        name: 'OpenAI',
        apiType: 'openai-compatible',
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1',
        enable: false
      },
      createConfigPresenter([])
    )
    ;(provider as any).isInitialized = true

    const modelConfig: ModelConfig = {
      maxTokens: 1024,
      contextLength: 8192,
      vision: false,
      functionCall: false,
      reasoning: false,
      type: 'chat',
      conversationId: 'session-1'
    }

    const events = await collectEvents(
      provider,
      'gpt-5',
      modelConfig,
      [{ role: 'user', content: 'cache me' }],
      []
    )
    const usageEvent = events.find((event) => event.type === 'usage')
    const requestParams = mockChatCompletionsCreate.mock.calls[0]?.[0]

    expect(requestParams.prompt_cache_key).toMatch(/^deepchat:openai:gpt-5:/)
    expect(usageEvent).toMatchObject({
      type: 'usage',
      usage: {
        cached_tokens: 24,
        cache_write_tokens: 16
      }
    })
  })

  it('adds explicit cache_control breakpoint for OpenRouter Claude without top-level cache_control', async () => {
    const provider = new OpenRouterProvider(
      {
        id: 'openrouter',
        name: 'OpenRouter',
        apiType: 'openai-compatible',
        apiKey: 'test-key',
        baseUrl: 'https://openrouter.ai/api/v1',
        enable: false
      },
      createConfigPresenter([])
    )
    ;(provider as any).isInitialized = true

    const modelConfig: ModelConfig = {
      maxTokens: 1024,
      contextLength: 8192,
      vision: false,
      functionCall: false,
      reasoning: false,
      type: 'chat',
      conversationId: 'session-2'
    }

    await collectEvents(
      provider,
      'anthropic/claude-sonnet-4',
      modelConfig,
      [
        { role: 'user', content: 'history' },
        { role: 'assistant', content: 'stable reply' },
        { role: 'user', content: 'latest question' }
      ],
      []
    )

    const requestParams = mockChatCompletionsCreate.mock.calls[0]?.[0]
    expect(requestParams).not.toHaveProperty('cache_control')
    expect(requestParams).not.toHaveProperty('prompt_cache_key')
    expect(requestParams.messages[1]).toMatchObject({
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
    })
  })
})
