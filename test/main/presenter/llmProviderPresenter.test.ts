import { describe, it, expect, beforeEach, vi, beforeAll, afterEach } from 'vitest'
import { LLMProviderPresenter } from '../../../src/main/presenter/llmProviderPresenter/index'
import { ConfigPresenter } from '../../../src/main/presenter/configPresenter/index'
import {
  LLM_PROVIDER,
  ChatMessage,
  LLMAgentEvent,
  ISQLitePresenter
} from '../../../src/shared/presenter'

// Ensure electron is mocked for this suite to avoid CJS named export issues
vi.mock('electron', () => {
  return {
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
  }
})

// Mock eventBus
vi.mock('@/eventbus', () => ({
  eventBus: {
    on: vi.fn(),
    sendToRenderer: vi.fn(),
    emit: vi.fn(),
    send: vi.fn()
  },
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
  }
}))

// Mock presenter
vi.mock('@/presenter', () => ({
  presenter: {
    mcpPresenter: {
      getAllToolDefinitions: vi.fn().mockResolvedValue([]),
      callTool: vi.fn().mockResolvedValue({ content: 'Mock tool response', rawData: {} })
    }
  }
}))

// Mock proxy config
vi.mock('@/presenter/proxyConfig', () => ({
  proxyConfig: {
    getProxyUrl: vi.fn().mockReturnValue(null)
  }
}))

describe('LLMProviderPresenter Integration Tests', () => {
  let llmProviderPresenter: LLMProviderPresenter
  let mockConfigPresenter: ConfigPresenter
  let fakeProvider: any

  const installFakeProviderInstance = (providerId: string) => {
    fakeProvider = {
      fetchModels: vi.fn().mockResolvedValue([
        {
          id: 'mock-gpt-thinking',
          name: 'Mock GPT Thinking',
          providerId,
          isCustom: false
        },
        {
          id: 'gpt-4-mock',
          name: 'GPT-4 Mock',
          providerId,
          isCustom: false
        },
        {
          id: 'mock-gpt-markdown',
          name: 'Mock GPT Markdown',
          providerId,
          isCustom: false
        }
      ]),
      check: vi.fn().mockResolvedValue({ isOk: true, errorMsg: null }),
      completions: vi.fn().mockResolvedValue({ content: 'ok' }),
      summaryTitles: vi.fn().mockResolvedValue('Mock title')
    }

    const providerInstanceManager = (llmProviderPresenter as any).providerInstanceManager
    providerInstanceManager.providerInstances.set(providerId, fakeProvider)
  }

  const installFakeAgentLoopHandler = () => {
    const activeStreams = (llmProviderPresenter as any).activeStreams as Map<string, any>

    ;(llmProviderPresenter as any).agentLoopHandler = {
      startStreamCompletion: async function* (
        providerId: string,
        _initialMessages: ChatMessage[],
        modelId: string,
        eventId: string
      ): AsyncGenerator<LLMAgentEvent, void, unknown> {
        if (activeStreams.size >= llmProviderPresenter.getMaxConcurrentStreams()) {
          yield {
            type: 'error',
            data: { eventId, error: 'Maximum concurrent stream limit reached' }
          } as any
          return
        }

        const abortController = new AbortController()
        activeStreams.set(eventId, { isGenerating: true, providerId, modelId, abortController })

        let chunk = 0
        while (!abortController.signal.aborted) {
          yield { type: 'response', data: { eventId, content: `chunk-${chunk}` } } as any
          chunk += 1
          // Keep the generator alive until the test aborts it.
          await new Promise((resolve) => setTimeout(resolve, 0))
          if (chunk >= 3) {
            // Prevent unbounded output if a test forgets to stop the stream.
            break
          }
        }

        const userStop = abortController.signal.aborted
        activeStreams.delete(eventId)
        yield { type: 'end', data: { eventId, userStop } } as any
      }
    }
  }

  const mockSqlitePresenter: ISQLitePresenter = {
    getAcpSession: vi.fn().mockResolvedValue(null),
    upsertAcpSession: vi.fn().mockResolvedValue(undefined),
    updateAcpSessionId: vi.fn().mockResolvedValue(undefined),
    updateAcpWorkdir: vi.fn().mockResolvedValue(undefined),
    updateAcpSessionStatus: vi.fn().mockResolvedValue(undefined),
    deleteAcpSession: vi.fn().mockResolvedValue(undefined),
    deleteAcpSessions: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    createConversation: vi.fn(),
    deleteConversation: vi.fn(),
    renameConversation: vi.fn(),
    getConversation: vi.fn(),
    updateConversation: vi.fn(),
    getConversationList: vi.fn(),
    getConversationCount: vi.fn(),
    insertMessage: vi.fn(),
    queryMessages: vi.fn(),
    deleteAllMessages: vi.fn(),
    runTransaction: vi.fn(),
    getMessage: vi.fn(),
    getMessageVariants: vi.fn(),
    updateMessage: vi.fn(),
    updateMessageParentId: vi.fn(),
    deleteMessage: vi.fn(),
    getMaxOrderSeq: vi.fn(),
    addMessageAttachment: vi.fn(),
    getMessageAttachments: vi.fn(),
    getLastUserMessage: vi.fn(),
    getMainMessageByParentId: vi.fn(),
    deleteAllMessagesInConversation: vi.fn()
  } as unknown as ISQLitePresenter

  // Mock OpenAI Compatible Provider配置
  const mockProvider: LLM_PROVIDER = {
    id: 'mock-openai-api',
    name: 'Mock OpenAI API',
    apiType: 'openai-compatible',
    apiKey: 'deepchatIsAwesome',
    baseUrl: 'https://mockllm.anya2a.com/v1',
    // Disable auto-init network calls in BaseLLMProvider.init() for unit tests.
    enable: false
  }

  beforeAll(() => {
    // Mock ConfigPresenter methods
    const mockConfigPresenterInstance = {
      getProviders: vi.fn().mockReturnValue([mockProvider]),
      getProviderById: vi.fn().mockReturnValue(mockProvider),
      getModelConfig: vi.fn().mockReturnValue({
        maxTokens: 4096,
        contextLength: 4096,
        temperature: 0.7,
        vision: false,
        functionCall: false,
        reasoning: false
      }),
      getSetting: vi.fn().mockImplementation((key: string) => {
        if (key === 'azureApiVersion') return '2024-02-01'
        return undefined
      }),
      setModelStatus: vi.fn(),
      updateCustomModel: vi.fn(),
      setProviderModels: vi.fn(),
      getCustomModels: vi.fn().mockReturnValue([]),
      getProviderModels: vi.fn().mockReturnValue([]),
      getModelStatus: vi.fn().mockReturnValue(true),
      enableModel: vi.fn(),
      setCustomModels: vi.fn(),
      addCustomModel: vi.fn(),
      removeCustomModel: vi.fn()
    }

    mockConfigPresenter = mockConfigPresenterInstance as unknown as ConfigPresenter
  })

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks()

    // Reset mock implementations
    mockConfigPresenter.getProviders = vi.fn().mockReturnValue([mockProvider])
    mockConfigPresenter.getProviderById = vi.fn().mockReturnValue(mockProvider)
    mockConfigPresenter.getModelConfig = vi.fn().mockReturnValue({
      maxTokens: 4096,
      contextLength: 4096,
      temperature: 0.7,
      vision: false,
      functionCall: false,
      reasoning: false,
      type: 'chat'
    })
    mockConfigPresenter.enableModel = vi.fn()
    mockConfigPresenter.setProviderModels = vi.fn()
    mockConfigPresenter.getCustomModels = vi.fn().mockReturnValue([])
    mockConfigPresenter.getProviderModels = vi.fn().mockReturnValue([])
    mockConfigPresenter.getModelStatus = vi.fn().mockReturnValue(true)

    // Create new instance for each test
    llmProviderPresenter = new LLMProviderPresenter(mockConfigPresenter)
    installFakeProviderInstance('mock-openai-api')
    installFakeAgentLoopHandler()
  })

  afterEach(async () => {
    // Stop all active streams after each test
    const activeStreams = (llmProviderPresenter as any).activeStreams as Map<string, any>
    for (const [eventId] of activeStreams) {
      await llmProviderPresenter.stopStream(eventId)
    }
    activeStreams.clear()

    // Wait for any pending async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  describe('Basic Provider Management', () => {
    it('should initialize with providers', () => {
      const providers = llmProviderPresenter.getProviders()
      expect(providers).toHaveLength(1)
      expect(providers[0].id).toBe('mock-openai-api')
    })

    it('should get provider by id', () => {
      const provider = llmProviderPresenter.getProviderById('mock-openai-api')
      expect(provider).toBeDefined()
      expect(provider.id).toBe('mock-openai-api')
      expect(provider.apiType).toBe('openai-compatible')
    })

    it('should set current provider', async () => {
      await llmProviderPresenter.setCurrentProvider('mock-openai-api')
      const currentProvider = llmProviderPresenter.getCurrentProvider()
      expect(currentProvider?.id).toBe('mock-openai-api')
    })
  })

  describe('Model Management', () => {
    beforeEach(async () => {
      await llmProviderPresenter.setCurrentProvider('mock-openai-api')
    })

    it('should fetch model list from mock API', async () => {
      const models = await llmProviderPresenter.getModelList('mock-openai-api')

      expect(models).toBeDefined()
      expect(Array.isArray(models)).toBe(true)

      // 验证返回的模型包含预期的mock模型
      const modelIds = models.map((m) => m.id)
      expect(modelIds).toContain('mock-gpt-thinking')
      expect(modelIds).toContain('gpt-4-mock')
      expect(modelIds).toContain('mock-gpt-markdown')

      // 验证模型结构
      const firstModel = models[0]
      expect(firstModel).toHaveProperty('id')
      expect(firstModel).toHaveProperty('name')
      expect(firstModel).toHaveProperty('providerId', 'mock-openai-api')
      expect(firstModel).toHaveProperty('isCustom', false)
    })

    it('should check provider connectivity', async () => {
      const result = await llmProviderPresenter.check('mock-openai-api')
      expect(result).toHaveProperty('isOk')
      expect(result).toHaveProperty('errorMsg')
      expect(result.isOk).toBe(true)
    })
  })

  describe('Stream Completion', () => {
    beforeEach(async () => {
      await llmProviderPresenter.setCurrentProvider('mock-openai-api')
    })

    it('should handle basic stream completion', async () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'Hello, how are you?' }]

      const eventId = 'test-stream-1'
      const events: LLMAgentEvent[] = []

      const stream = llmProviderPresenter.startStreamCompletion(
        'mock-openai-api',
        messages,
        'mock-gpt-thinking',
        eventId
      )

      for await (const event of stream) {
        events.push(event)
        if (events.length >= 2) {
          await llmProviderPresenter.stopStream(eventId)
        }
      }

      // 验证我们收到了一些事件
      expect(events.length).toBeGreaterThan(0)

      // 检查事件类型
      const eventTypes = events.map((e) => e.type)
      expect(eventTypes).toContain('response')

      // 验证事件数据结构
      const responseEvents = events.filter((e) => e.type === 'response')
      if (responseEvents.length > 0) {
        const firstResponse = responseEvents[0] as { type: 'response'; data: any }
        expect(firstResponse.data).toHaveProperty('eventId', eventId)
      }
    })
  })

  describe('Non-stream Completion', () => {
    beforeEach(async () => {
      await llmProviderPresenter.setCurrentProvider('mock-openai-api')
    })

    it('should generate completion without streaming', async () => {
      const messages = [{ role: 'user' as const, content: '1' }]

      const response = await llmProviderPresenter.generateCompletion(
        'mock-openai-api',
        messages,
        'mock-gpt-thinking',
        0.7,
        100
      )

      expect(typeof response).toBe('string')
      expect(response.length).toBeGreaterThan(0)
      console.log('Completion response:', response.substring(0, 100))
    })

    it('should generate completion standalone', async () => {
      const messages: ChatMessage[] = [{ role: 'user', content: '1' }]

      const response = await llmProviderPresenter.generateCompletionStandalone(
        'mock-openai-api',
        messages,
        'mock-gpt-thinking',
        0.7,
        100
      )

      expect(typeof response).toBe('string')
      expect(response.length).toBeGreaterThan(0)
    })

    it('should summarize titles', async () => {
      const messages = [
        { role: 'user' as const, content: 'Hello, I want to learn about artificial intelligence' },
        {
          role: 'assistant' as const,
          content: 'I can help you learn about AI. What specific aspects interest you?'
        }
      ]

      const title = await llmProviderPresenter.summaryTitles(
        messages,
        'mock-openai-api',
        'mock-gpt-thinking'
      )

      expect(typeof title).toBe('string')
      expect(title.length).toBeGreaterThan(0)
      console.log('Generated title:', title)
    })
  })

  describe('Stream Management', () => {
    beforeEach(async () => {
      await llmProviderPresenter.setCurrentProvider('mock-openai-api')
    })

    it('should track active streams', async () => {
      const eventId = 'test-tracking'

      expect(llmProviderPresenter.isGenerating(eventId)).toBe(false)

      const messages: ChatMessage[] = [{ role: 'user', content: 'Start a stream' }]

      const stream = llmProviderPresenter.startStreamCompletion(
        'mock-openai-api',
        messages,
        'mock-gpt-thinking',
        eventId
      )

      // Pull the first chunk so the stream is registered as active.
      const first = await stream.next()
      expect(first.value?.type).toBe('response')

      expect(llmProviderPresenter.isGenerating(eventId)).toBe(true)

      const streamState = llmProviderPresenter.getStreamState(eventId)
      expect(streamState).toBeDefined()
      expect(streamState?.providerId).toBe('mock-openai-api')

      // 停止流
      await llmProviderPresenter.stopStream(eventId)

      // Drain stream to completion
      for await (const _event of stream) {
        // no-op
      }

      // 验证流已停止
      expect(llmProviderPresenter.isGenerating(eventId)).toBe(false)
    })

    it('should handle concurrent streams limit', async () => {
      // 设置较小的并发限制进行测试
      llmProviderPresenter.setMaxConcurrentStreams(2)
      expect(llmProviderPresenter.getMaxConcurrentStreams()).toBe(2)

      const messages: ChatMessage[] = [{ role: 'user', content: 'Concurrent test' }]

      // 启动多个流
      const streamA = llmProviderPresenter.startStreamCompletion(
        'mock-openai-api',
        messages,
        'mock-gpt-thinking',
        'concurrent-0'
      )
      const streamB = llmProviderPresenter.startStreamCompletion(
        'mock-openai-api',
        messages,
        'mock-gpt-thinking',
        'concurrent-1'
      )
      const streamC = llmProviderPresenter.startStreamCompletion(
        'mock-openai-api',
        messages,
        'mock-gpt-thinking',
        'concurrent-2'
      )

      await streamA.next()
      await streamB.next()

      const third = await streamC.next()
      expect(third.value?.type).toBe('error')

      await llmProviderPresenter.stopStream('concurrent-0')
      await llmProviderPresenter.stopStream('concurrent-1')

      for await (const _event of streamA) {
        // no-op
      }
      for await (const _event of streamB) {
        // no-op
      }
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid provider id', () => {
      expect(() => {
        llmProviderPresenter.getProviderById('non-existent')
      }).toThrow('Provider non-existent not found')
    })

    it('should handle provider check failure for invalid config', async () => {
      // 创建一个无效配置的provider
      const invalidProvider: LLM_PROVIDER = {
        id: 'invalid-test',
        name: 'Invalid Test',
        apiType: 'openai-compatible',
        apiKey: 'invalid-key',
        baseUrl: 'https://invalid-url-that-does-not-exist.com/v1',
        enable: true
      }

      // 创建一个新的 LLMProviderPresenter 实例来测试无效配置
      // 避免污染其他测试的 provider 状态
      const invalidMockConfig = {
        getProviders: vi.fn().mockReturnValue([invalidProvider]),
        getProviderById: vi.fn().mockReturnValue(invalidProvider),
        getModelConfig: vi.fn().mockReturnValue({
          maxTokens: 4096,
          contextLength: 4096,
          temperature: 0.7,
          vision: false,
          functionCall: false,
          reasoning: false,
          type: 'chat'
        }),
        getSetting: vi.fn(),
        setModelStatus: vi.fn(),
        updateCustomModel: vi.fn(),
        setProviderModels: vi.fn(),
        getCustomModels: vi.fn().mockReturnValue([]),
        getProviderModels: vi.fn().mockReturnValue([]),
        getModelStatus: vi.fn().mockReturnValue(true),
        enableModel: vi.fn(),
        setCustomModels: vi.fn(),
        addCustomModel: vi.fn(),
        removeCustomModel: vi.fn()
      } as unknown as ConfigPresenter

      const invalidLlmProvider = new LLMProviderPresenter(invalidMockConfig)
      const invalidProviderInstanceManager = (invalidLlmProvider as any).providerInstanceManager
      invalidProviderInstanceManager.providerInstances.set('invalid-test', {
        check: vi.fn().mockResolvedValue({ isOk: false, errorMsg: 'invalid' })
      })

      const result = await invalidLlmProvider.check('invalid-test')
      expect(result.isOk).toBe(false)
      expect(result.errorMsg).toBeDefined()
    }, 10000)
  })
})
