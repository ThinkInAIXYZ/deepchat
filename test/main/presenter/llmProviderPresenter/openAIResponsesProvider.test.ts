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
  presenter: {
    mcpPresenter: {
      mcpToolsToOpenAIResponsesTools: mockMcpToolsToOpenAIResponsesTools
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
              total_tokens: 15
            }
          }
        }
      ])
    )

    const provider = new OpenAIResponsesProvider(mockProvider, mockConfigPresenter)
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
    const stopEvent = events.find((event) => event.type === 'stop')

    expect(startEvent).toBeDefined()
    expect(startEvent?.tool_call_id).toBe('call_123')
    expect(chunkEvent).toBeDefined()
    expect(chunkEvent?.tool_call_id).toBe('call_123')
    expect(chunkEvent?.tool_call_arguments_chunk).toBe('{"city":"')
    expect(endEvent).toBeDefined()
    expect(endEvent?.tool_call_id).toBe('call_123')
    expect(endEvent?.tool_call_arguments_complete).toBe('{"city":"shanghai"}')
    expect(stopEvent?.stop_reason).toBe('tool_use')
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

    const provider = new OpenAIResponsesProvider(mockProvider, mockConfigPresenter)
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
})
