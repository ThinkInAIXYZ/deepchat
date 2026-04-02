import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IConfigPresenter, LLM_PROVIDER, ModelConfig } from '../../../../src/shared/presenter'
import { AnthropicProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/anthropicProvider'

const { mockAnthropicConstructor, mockMessagesCreate, mockModelsList, mockGetProxyUrl } =
  vi.hoisted(() => ({
    mockAnthropicConstructor: vi.fn(),
    mockMessagesCreate: vi.fn().mockResolvedValue({ content: [], usage: undefined }),
    mockModelsList: vi.fn().mockResolvedValue({ data: [] }),
    mockGetProxyUrl: vi.fn().mockReturnValue(null)
  }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation((options: Record<string, unknown>) => {
    mockAnthropicConstructor(options)
    return {
      messages: {
        create: mockMessagesCreate
      },
      models: {
        list: mockModelsList
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
    MODEL_LIST_CHANGED: 'MODEL_LIST_CHANGED'
  }
}))

vi.mock('../../../../src/main/presenter/proxyConfig', () => ({
  proxyConfig: {
    getProxyUrl: mockGetProxyUrl
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

const createAsyncStream = (chunks: Array<Record<string, unknown>>) => ({
  async *[Symbol.asyncIterator]() {
    for (const chunk of chunks) {
      yield chunk
    }
  }
})

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'anthropic',
  name: 'Anthropic',
  apiType: 'anthropic',
  apiKey: 'test-key',
  baseUrl: 'https://api.anthropic.com',
  enable: true,
  ...overrides
})

describe('AnthropicProvider API-only behavior', () => {
  const originalEnvKey = process.env.ANTHROPIC_API_KEY
  const streamModelConfig: ModelConfig = {
    maxTokens: 1024,
    contextLength: 8192,
    vision: false,
    functionCall: false,
    reasoning: false,
    type: 'chat',
    conversationId: 'session-1'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockMessagesCreate.mockResolvedValue({ content: [], usage: undefined })
    mockModelsList.mockResolvedValue({ data: [] })
    mockGetProxyUrl.mockReturnValue(null)
    delete process.env.ANTHROPIC_API_KEY
  })

  afterEach(() => {
    if (originalEnvKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY
      return
    }
    process.env.ANTHROPIC_API_KEY = originalEnvKey
  })

  it('initializes with env API key when provider apiKey is empty', () => {
    process.env.ANTHROPIC_API_KEY = 'env-key'

    new AnthropicProvider(createProvider({ apiKey: '' }), createConfigPresenter())

    expect(mockAnthropicConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'env-key',
        baseURL: 'https://api.anthropic.com'
      })
    )
  })

  it('does not initialize when no API key is available', async () => {
    const provider = new AnthropicProvider(
      createProvider({ apiKey: '', enable: true }),
      createConfigPresenter()
    )

    expect(mockAnthropicConstructor).not.toHaveBeenCalled()
    await expect(provider.check()).resolves.toEqual({
      isOk: false,
      errorMsg: 'Anthropic SDK not initialized'
    })
  })

  it('does not send Claude Code system prompt or oauth beta header', async () => {
    const provider = new AnthropicProvider(
      createProvider({ enable: false }),
      createConfigPresenter()
    )
    ;(provider as any).anthropic = {
      messages: { create: mockMessagesCreate },
      models: { list: mockModelsList }
    }

    const headers = (provider as any).buildAnthropicApiKeyHeaders()
    expect(headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': 'test-key'
      })
    )
    expect(headers).not.toHaveProperty('anthropic-beta')

    await provider.check()

    const request = mockMessagesCreate.mock.calls.at(-1)?.[0]
    expect(request).toEqual(
      expect.objectContaining({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 10
      })
    )
    expect(request).not.toHaveProperty('system')
  })

  it('passes through the caller system prompt for text generation', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'hello' }],
      usage: undefined
    })

    const provider = new AnthropicProvider(
      createProvider({ enable: false }),
      createConfigPresenter()
    )
    ;(provider as any).anthropic = {
      messages: { create: mockMessagesCreate },
      models: { list: mockModelsList }
    }

    await provider.generateText('hi', 'claude-sonnet-4-5-20250929', 0.2, 32, 'Real system prompt')

    expect(mockMessagesCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        system: 'Real system prompt',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
      })
    )
  })

  it('adds top-level cache_control for Claude streaming requests', async () => {
    mockMessagesCreate.mockResolvedValue(
      createAsyncStream([
        {
          type: 'message_start',
          message: {
            usage: {
              input_tokens: 10,
              output_tokens: 2
            }
          }
        },
        {
          type: 'content_block_delta',
          delta: {
            type: 'text_delta',
            text: 'hello'
          }
        }
      ])
    )

    const provider = new AnthropicProvider(
      createProvider({ enable: false }),
      createConfigPresenter()
    )
    ;(provider as any).anthropic = {
      messages: { create: mockMessagesCreate },
      models: { list: mockModelsList }
    }

    const events = []
    for await (const event of provider.coreStream(
      [{ role: 'user', content: 'hi' }],
      'claude-sonnet-4-5-20250929',
      streamModelConfig,
      0.2,
      64,
      []
    )) {
      events.push(event)
    }

    const request = mockMessagesCreate.mock.calls.at(-1)?.[0]
    expect(request).toMatchObject({
      cache_control: {
        type: 'ephemeral'
      }
    })
    expect(events.some((event) => event.type === 'text')).toBe(true)
  })

  it('normalizes cache read and cache write usage metadata for streams', async () => {
    mockMessagesCreate.mockResolvedValue(
      createAsyncStream([
        {
          type: 'message_start',
          message: {
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cache_read_input_tokens: 20,
              cache_creation_input_tokens: 30
            }
          }
        },
        {
          type: 'content_block_delta',
          delta: {
            type: 'text_delta',
            text: 'hello'
          }
        }
      ])
    )

    const provider = new AnthropicProvider(
      createProvider({ enable: false }),
      createConfigPresenter()
    )
    ;(provider as any).anthropic = {
      messages: { create: mockMessagesCreate },
      models: { list: mockModelsList }
    }

    const events = []
    for await (const event of provider.coreStream(
      [{ role: 'user', content: 'hi' }],
      'claude-sonnet-4-5-20250929',
      streamModelConfig,
      0.2,
      64,
      []
    )) {
      events.push(event)
    }

    const usageEvent = events.find((event) => event.type === 'usage')
    expect(usageEvent).toMatchObject({
      type: 'usage',
      usage: {
        prompt_tokens: 60,
        completion_tokens: 5,
        total_tokens: 65,
        cached_tokens: 20,
        cache_write_tokens: 30
      }
    })
  })
})
