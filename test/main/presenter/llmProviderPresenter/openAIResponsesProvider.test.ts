import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAIResponsesProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/openAIResponsesProvider'
import type {
  ChatMessage,
  IConfigPresenter,
  LLM_PROVIDER,
  MCPToolDefinition,
  ModelConfig
} from '../../../../src/shared/presenter'

const { mockResponsesCreate, mockModelsList, mockMcpToolsToOpenAIResponsesTools, mockGetProxyUrl } =
  vi.hoisted(() => ({
    mockResponsesCreate: vi.fn(),
    mockModelsList: vi.fn().mockResolvedValue({ data: [] }),
    mockMcpToolsToOpenAIResponsesTools: vi.fn().mockResolvedValue([]),
    mockGetProxyUrl: vi.fn().mockReturnValue(null)
  }))

vi.mock('openai', () => {
  class MockOpenAI {
    responses = {
      create: mockResponsesCreate
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
  presenter: {}
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

vi.mock('../../../../src/main/presenter/configPresenter/modelCapabilities', () => ({
  modelCapabilities: {
    supportsReasoningEffort: vi.fn().mockReturnValue(false),
    supportsVerbosity: vi.fn().mockReturnValue(false)
  }
}))

const createAsyncStream = (chunks: Array<Record<string, unknown>>) => ({
  async *[Symbol.asyncIterator]() {
    for (const chunk of chunks) {
      yield chunk
    }
  }
})

const mcpRuntime = {
  mcpToolsToOpenAIResponsesTools: mockMcpToolsToOpenAIResponsesTools
}

describe('OpenAIResponsesProvider tool call id mapping', () => {
  const mockProvider: LLM_PROVIDER = {
    id: 'openai',
    name: 'OpenAI',
    apiType: 'openai-responses',
    apiKey: 'test-key',
    baseUrl: 'https://api.openai.com/v1',
    enable: false
  }

  const mockConfigPresenter = {
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getSetting: vi.fn().mockReturnValue(undefined),
    setProviderModels: vi.fn(),
    getModelStatus: vi.fn().mockReturnValue(true),
    addCustomModel: vi.fn(),
    removeCustomModel: vi.fn(),
    updateCustomModel: vi.fn()
  } as unknown as IConfigPresenter

  const modelConfig: ModelConfig = {
    maxTokens: 1024,
    contextLength: 8192,
    vision: false,
    functionCall: true,
    reasoning: false,
    type: 'chat'
  }

  const messages: ChatMessage[] = [{ role: 'user', content: 'please call tool' }]
  const tools: MCPToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'test_tool',
        description: 'test',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      server: {
        name: 'test-server',
        icons: '',
        description: 'test'
      }
    }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockModelsList.mockResolvedValue({ data: [] })
    mockMcpToolsToOpenAIResponsesTools.mockResolvedValue([])
    mockGetProxyUrl.mockReturnValue(null)
  })

  it('uses call_id for streamed tool events when item_id differs from call_id', async () => {
    mockResponsesCreate.mockResolvedValue(
      createAsyncStream([
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: {
            type: 'function_call',
            id: 'fc_123',
            call_id: 'call_123',
            name: 'test_tool',
            arguments: ''
          }
        },
        {
          type: 'response.function_call_arguments.delta',
          item_id: 'fc_123',
          output_index: 0,
          delta: '{"city":"'
        },
        {
          type: 'response.function_call_arguments.done',
          item_id: 'fc_123',
          output_index: 0,
          arguments: '{"city":"shanghai"}'
        },
        {
          type: 'response.completed',
          response: {
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              total_tokens: 15,
              input_tokens_details: {
                cached_tokens: 4
              }
            }
          }
        }
      ])
    )

    const provider = new OpenAIResponsesProvider(
      mockProvider,
      mockConfigPresenter,
      mcpRuntime as any
    )
    ;(provider as any).isInitialized = true

    const events = []
    for await (const event of provider.coreStream(
      messages,
      'gpt-4o',
      modelConfig,
      0.7,
      512,
      tools
    )) {
      events.push(event)
    }

    const startEvent = events.find((event) => event.type === 'tool_call_start')
    const chunkEvent = events.find((event) => event.type === 'tool_call_chunk')
    const endEvent = events.find((event) => event.type === 'tool_call_end')
    const usageEvent = events.find((event) => event.type === 'usage')
    const stopEvent = events.find((event) => event.type === 'stop')

    expect(startEvent).toBeDefined()
    expect(startEvent?.tool_call_id).toBe('call_123')
    expect(chunkEvent).toBeDefined()
    expect(chunkEvent?.tool_call_id).toBe('call_123')
    expect(chunkEvent?.tool_call_arguments_chunk).toBe('{"city":"')
    expect(endEvent).toBeDefined()
    expect(endEvent?.tool_call_id).toBe('call_123')
    expect(endEvent?.tool_call_arguments_complete).toBe('{"city":"shanghai"}')
    expect(usageEvent).toMatchObject({
      type: 'usage',
      usage: expect.objectContaining({
        cached_tokens: 4
      })
    })
    expect(stopEvent?.stop_reason).toBe('tool_use')
    expect(mockMcpToolsToOpenAIResponsesTools).toHaveBeenCalledWith(tools, mockProvider.id)
  })

  it('uses unified fallback defaults when model list lacks capability metadata', async () => {
    mockModelsList.mockResolvedValue({
      data: [{ id: 'gpt-4.1' }]
    })

    const provider = new OpenAIResponsesProvider(
      mockProvider,
      mockConfigPresenter,
      mcpRuntime as any
    )
    const models = await (provider as any).fetchOpenAIModels()

    expect(models).toEqual([
      expect.objectContaining({
        id: 'gpt-4.1',
        contextLength: 16000,
        maxTokens: 4096
      })
    ])
  })

  it('falls back to output_index mapping when item id is unavailable', async () => {
    mockResponsesCreate.mockResolvedValue(
      createAsyncStream([
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: {
            type: 'function_call',
            call_id: 'call_456',
            name: 'test_tool',
            arguments: ''
          }
        },
        {
          type: 'response.function_call_arguments.delta',
          item_id: 'fc_missing',
          output_index: 0,
          delta: '{"topic":"'
        },
        {
          type: 'response.function_call_arguments.done',
          item_id: 'fc_missing',
          output_index: 0,
          arguments: '{"topic":"responses"}'
        },
        {
          type: 'response.completed',
          response: {
            usage: {
              input_tokens: 6,
              output_tokens: 3,
              total_tokens: 9
            }
          }
        }
      ])
    )

    const provider = new OpenAIResponsesProvider(
      mockProvider,
      mockConfigPresenter,
      mcpRuntime as any
    )
    ;(provider as any).isInitialized = true

    const events = []
    for await (const event of provider.coreStream(
      messages,
      'gpt-4o',
      modelConfig,
      0.7,
      512,
      tools
    )) {
      events.push(event)
    }

    const chunkEvent = events.find((event) => event.type === 'tool_call_chunk')
    const endEvent = events.find((event) => event.type === 'tool_call_end')
    const stopEvent = events.find((event) => event.type === 'stop')

    expect(chunkEvent).toBeDefined()
    expect(chunkEvent?.tool_call_id).toBe('call_456')
    expect(endEvent).toBeDefined()
    expect(endEvent?.tool_call_id).toBe('call_456')
    expect(endEvent?.tool_call_arguments_complete).toBe('{"topic":"responses"}')
    expect(stopEvent?.stop_reason).toBe('tool_use')
  })

  it('serializes assistant history as shorthand text instead of input_text parts', async () => {
    mockResponsesCreate.mockResolvedValue(
      createAsyncStream([
        {
          type: 'response.completed',
          response: {
            usage: {
              input_tokens: 4,
              output_tokens: 2,
              total_tokens: 6
            }
          }
        }
      ])
    )

    const provider = new OpenAIResponsesProvider(
      mockProvider,
      mockConfigPresenter,
      mcpRuntime as any
    )
    ;(provider as any).isInitialized = true

    const historyMessages: ChatMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hi! What can I help you with today?' },
      { role: 'user', content: '你是谁' }
    ]

    for await (const _event of provider.coreStream(
      historyMessages,
      'gpt-5.3-codex',
      modelConfig,
      0.7,
      512,
      []
    )) {
      // consume stream
    }

    const requestParams = mockResponsesCreate.mock.calls[0][0] as {
      input: Array<Record<string, unknown>>
    }

    expect(requestParams.input).toEqual([
      {
        role: 'system',
        content: [{ type: 'input_text', text: 'system prompt' }]
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'hi' }]
      },
      {
        role: 'assistant',
        content: 'Hi! What can I help you with today?'
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: '你是谁' }]
      }
    ])
  })

  it('flattens assistant content parts to text and omits unsupported images', async () => {
    mockResponsesCreate.mockResolvedValue(
      createAsyncStream([
        {
          type: 'response.completed',
          response: {
            usage: {
              input_tokens: 7,
              output_tokens: 2,
              total_tokens: 9
            }
          }
        }
      ])
    )

    const provider = new OpenAIResponsesProvider(
      mockProvider,
      mockConfigPresenter,
      mcpRuntime as any
    )
    ;(provider as any).isInitialized = true

    const historyMessages: ChatMessage[] = [
      { role: 'user', content: 'show history' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Line 1. ' },
          { type: 'text', text: 'Line 2.' }
        ]
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Look ' },
          { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
          { type: 'text', text: 'here.' }
        ]
      },
      {
        role: 'assistant',
        content: [{ type: 'image_url', image_url: { url: 'https://example.com/only-image.png' } }]
      },
      { role: 'user', content: 'continue' }
    ]

    for await (const _event of provider.coreStream(
      historyMessages,
      'gpt-5.3-codex',
      modelConfig,
      0.7,
      512,
      []
    )) {
      // consume stream
    }

    const requestParams = mockResponsesCreate.mock.calls[0][0] as {
      input: Array<Record<string, unknown>>
    }

    expect(requestParams.input).toEqual([
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'show history' }]
      },
      {
        role: 'assistant',
        content: 'Line 1. Line 2.'
      },
      {
        role: 'assistant',
        content: 'Look here.'
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'continue' }]
      }
    ])
  })

  it('emits request trace with final endpoint, headers and body', async () => {
    const persist = vi.fn()
    const traceAwareConfig = {
      ...modelConfig,
      requestTraceContext: {
        enabled: true,
        persist
      }
    } as ModelConfig & {
      requestTraceContext: {
        enabled: boolean
        persist: (payload: {
          endpoint: string
          headers: Record<string, string>
          body: unknown
        }) => void
      }
    }

    mockResponsesCreate.mockResolvedValue(
      createAsyncStream([
        {
          type: 'response.completed',
          response: {
            usage: {
              input_tokens: 1,
              output_tokens: 1,
              total_tokens: 2
            }
          }
        }
      ])
    )

    const provider = new OpenAIResponsesProvider(
      mockProvider,
      mockConfigPresenter,
      mcpRuntime as any
    )
    ;(provider as any).isInitialized = true

    for await (const _event of provider.coreStream(
      messages,
      'gpt-4o',
      traceAwareConfig,
      0.7,
      512,
      []
    )) {
      // consume stream
    }

    expect(persist).toHaveBeenCalledTimes(1)
    const payload = persist.mock.calls[0][0] as {
      endpoint: string
      headers: Record<string, string>
      body: Record<string, unknown>
    }

    expect(payload.endpoint).toContain('/responses')
    expect(payload.headers).toHaveProperty('Authorization', 'Bearer test-key')
    expect(payload.body).toMatchObject({
      model: 'gpt-4o',
      temperature: 0.7,
      max_output_tokens: 512,
      stream: true
    })
  })
})
