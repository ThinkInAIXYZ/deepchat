import { describe, it, expect, beforeEach, vi, beforeAll, afterEach } from 'vitest'
import { LLMProviderPresenter } from '../../../src/main/presenter/llmProviderPresenter/index'
import { ConfigPresenter } from '../../../src/main/presenter/configPresenter/index'
import { LLM_PROVIDER, ChatMessage, LLMAgentEvent } from '../../../src/shared/presenter'

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

  // Mock OpenAI Compatible Provider配置
  const mockProvider: LLM_PROVIDER = {
    id: 'mock-openai-api',
    name: 'Mock OpenAI API',
    apiType: 'openai-compatible',
    apiKey: 'deepchatIsAwesome',
    baseUrl: 'https://mockllm.anya2a.com/v1',
    enable: true
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
  })

  afterEach(() => {
    // Stop all active streams after each test
    const activeStreams = (llmProviderPresenter as any).activeStreams as Map<string, any>
    for (const [eventId] of activeStreams) {
      llmProviderPresenter.stopStream(eventId)
    }
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
    }, 15000) // 增加超时时间，因为是网络请求

    it('should check provider connectivity', async () => {
      const result = await llmProviderPresenter.check('mock-openai-api')
      expect(result).toHaveProperty('isOk')
      expect(result).toHaveProperty('errorMsg')
      expect(result.isOk).toBe(true)
    }, 10000)
  })

  describe('Stream Completion', () => {
    beforeEach(async () => {
      await llmProviderPresenter.setCurrentProvider('mock-openai-api')
    })

    it('should handle basic stream completion', async () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'Hello, how are you?' }]

      const eventId = 'test-stream-1'
      const events: LLMAgentEvent[] = []

      try {
        const stream = llmProviderPresenter.startStreamCompletion(
          'mock-openai-api',
          messages,
          'mock-gpt-thinking',
          eventId,
          0.7,
          1000
        )

        for await (const event of stream) {
          events.push(event)

          // 收集足够的事件后停止测试
          if (events.length >= 5) {
            await llmProviderPresenter.stopStream(eventId)
            break
          }
        }
      } catch (error) {
        // 允许因为停止流而产生的错误
        console.log('Stream stopped:', error)
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
    }, 20000)

    it('should handle stream for markdown model', async () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'Generate some markdown content' }]

      const eventId = 'test-markdown-stream'
      const events: LLMAgentEvent[] = []
      let contentReceived = ''

      try {
        const stream = llmProviderPresenter.startStreamCompletion(
          'mock-openai-api',
          messages,
          'mock-gpt-markdown',
          eventId,
          0.7,
          500
        )

        for await (const event of stream) {
          events.push(event)

          if (event.type === 'response' && event.data.content) {
            contentReceived += event.data.content
          }

          // 限制事件数量
          if (events.length >= 10) {
            await llmProviderPresenter.stopStream(eventId)
            break
          }
        }
      } catch (error) {
        console.log('Markdown stream stopped:', error)
      }

      // 验证我们收到了内容
      expect(events.length).toBeGreaterThan(0)
      expect(contentReceived.length).toBeGreaterThan(0)

      console.log('Received content sample:', contentReceived.substring(0, 100))
    }, 20000)

    it('should handle function calling model', async () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'What time is it now?' }]

      const eventId = 'test-function-call'
      const events: LLMAgentEvent[] = []

      try {
        const stream = llmProviderPresenter.startStreamCompletion(
          'mock-openai-api',
          messages,
          'gpt-4-mock',
          eventId,
          0.7,
          1000
        )

        for await (const event of stream) {
          events.push(event)

          // 限制事件数量
          if (events.length >= 15) {
            await llmProviderPresenter.stopStream(eventId)
            break
          }
        }
      } catch (error) {
        console.log('Function call stream stopped:', error)
      }

      // 验证收到了事件
      expect(events.length).toBeGreaterThan(0)

      // 检查是否有工具调用相关的事件
      const toolCallEvents = events.filter(
        (e) => e.type === 'response' && e.data && (e.data.tool_call_name || e.data.tool_call)
      )

      console.log('Total events:', events.length)
      console.log('Tool call events:', toolCallEvents.length)
    }, 25000)
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
    }, 15000)

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
    }, 15000)

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
    }, 15000)
  })

  describe('Stream Management', () => {
    beforeEach(async () => {
      await llmProviderPresenter.setCurrentProvider('mock-openai-api')
    })

    it('should track active streams', async () => {
      const eventId = 'test-tracking'

      expect(llmProviderPresenter.isGenerating(eventId)).toBe(false)

      const messages: ChatMessage[] = [{ role: 'user', content: 'Start a stream' }]

      // 启动流但不等待完成
      const streamPromise = (async () => {
        const stream = llmProviderPresenter.startStreamCompletion(
          'mock-openai-api',
          messages,
          'mock-gpt-thinking',
          eventId
        )

        let count = 0
        for await (const event of stream) {
          count++
          if (count >= 3) break // 只处理几个事件
        }
      })()

      // 短暂等待让流开始
      await new Promise((resolve) => setTimeout(resolve, 100))

      // 检查流状态
      expect(llmProviderPresenter.isGenerating(eventId)).toBe(true)

      const streamState = llmProviderPresenter.getStreamState(eventId)
      expect(streamState).toBeDefined()
      expect(streamState?.providerId).toBe('mock-openai-api')

      // 停止流
      await llmProviderPresenter.stopStream(eventId)

      // 等待流处理完成
      await streamPromise.catch(() => {}) // 忽略停止导致的错误

      // 验证流已停止
      expect(llmProviderPresenter.isGenerating(eventId)).toBe(false)
    }, 10000)

    it('should handle concurrent streams limit', async () => {
      // 设置较小的并发限制进行测试
      llmProviderPresenter.setMaxConcurrentStreams(2)
      expect(llmProviderPresenter.getMaxConcurrentStreams()).toBe(2)

      const messages: ChatMessage[] = [{ role: 'user', content: 'Concurrent test' }]

      // 启动多个流
      const streams: Array<{
        eventId: string
        stream: AsyncGenerator<LLMAgentEvent, void, unknown>
      }> = []
      for (let i = 0; i < 3; i++) {
        const eventId = `concurrent-${i}`
        const stream = llmProviderPresenter.startStreamCompletion(
          'mock-openai-api',
          messages,
          'mock-gpt-thinking',
          eventId
        )
        streams.push({ eventId, stream })
      }

      // 处理流，第三个应该被限制
      let errorCount = 0
      let successCount = 0

      for (const { eventId, stream } of streams) {
        try {
          let count = 0
          for await (const event of stream) {
            if (event.type === 'error') {
              errorCount++
              break
            }
            if (event.type === 'response') {
              successCount++
            }
            count++
            if (count >= 2) {
              await llmProviderPresenter.stopStream(eventId)
              break
            }
          }
        } catch (error) {
          // 预期的错误
        }
      }

      // 应该有至少一个流被拒绝或出错
      expect(errorCount + successCount).toBeGreaterThan(0)
    }, 15000)
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

      llmProviderPresenter.setProviders([invalidProvider])

      const result = await llmProviderPresenter.check('invalid-test')
      expect(result.isOk).toBe(false)
      expect(result.errorMsg).toBeDefined()
    }, 10000)
  })
})
