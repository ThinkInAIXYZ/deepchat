import { describe, it, expect, beforeEach, vi, beforeAll, afterEach } from 'vitest'
import { LLMProviderPresenter } from '../../../src/main/presenter/llmProviderPresenter/index'
import { ConfigPresenter } from '../../../src/main/presenter/configPresenter/index'
import { LLM_PROVIDER, ChatMessage, ISQLitePresenter } from '../../../src/shared/presenter'
import { OpenAICompatibleProvider } from '../../../src/main/presenter/llmProviderPresenter/providers/openAICompatibleProvider'

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

const presenterRuntimeMock = vi.hoisted(() => ({
  toolPresenter: {
    getAllToolDefinitions: vi.fn().mockResolvedValue([]),
    preCheckToolPermission: vi.fn().mockResolvedValue(null),
    callTool: vi.fn().mockResolvedValue({ content: 'Mock tool response', rawData: {} })
  },
  mcpPresenter: {
    getAllToolDefinitions: vi.fn().mockResolvedValue([]),
    callTool: vi.fn().mockResolvedValue({ content: 'Mock tool response', rawData: {} })
  },
  yoBrowserPresenter: {}
}))

// Mock presenter
vi.mock('@/presenter', () => ({
  presenter: presenterRuntimeMock
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
    llmProviderPresenter = new LLMProviderPresenter(
      mockConfigPresenter,
      mockSqlitePresenter,
      presenterRuntimeMock.mcpPresenter as any
    )
  })

  afterEach(async () => {
    // Stop all active streams after each test
    const activeStreams = (llmProviderPresenter as any).activeStreams as Map<string, any>
    for (const [eventId] of activeStreams) {
      await llmProviderPresenter.stopStream(eventId)
    }

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

    it('should resolve novita via apiType fallback without an id-specific provider mapping', () => {
      const novitaProvider: LLM_PROVIDER = {
        id: 'novita',
        name: 'Novita AI',
        apiType: 'openai-completions',
        apiKey: 'deepchatIsAwesome',
        baseUrl: 'https://api.novita.ai/openai',
        enable: true
      }

      mockConfigPresenter.getProviders = vi.fn().mockReturnValue([novitaProvider])
      mockConfigPresenter.getProviderById = vi.fn().mockReturnValue(novitaProvider)

      llmProviderPresenter = new LLMProviderPresenter(
        mockConfigPresenter,
        mockSqlitePresenter,
        presenterRuntimeMock.mcpPresenter as any
      )

      const providerInstance = llmProviderPresenter.getProviderInstance('novita')

      expect(providerInstance).toBeInstanceOf(OpenAICompatibleProvider)
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

  describe('Error Handling', () => {
    it('should handle invalid provider id', () => {
      expect(() => {
        llmProviderPresenter.getProviderById('non-existent')
      }).toThrow('Provider non-existent not found')
    })

    it('should swallow ACP warmup shutdown errors', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const mockAcpProvider = {
        warmupProcess: vi
          .fn()
          .mockRejectedValue(new Error('[ACP] Process manager is shutting down, refusing to spawn'))
      }
      vi.spyOn(llmProviderPresenter as any, 'getAcpProviderInstance').mockReturnValue(
        mockAcpProvider as any
      )

      await expect(
        llmProviderPresenter.warmupAcpProcess('agent-test', '/tmp')
      ).resolves.toBeUndefined()
      warnSpy.mockRestore()
    })

    it('should rethrow non-shutdown ACP warmup errors', async () => {
      const mockAcpProvider = {
        warmupProcess: vi.fn().mockRejectedValue(new Error('boom'))
      }
      vi.spyOn(llmProviderPresenter as any, 'getAcpProviderInstance').mockReturnValue(
        mockAcpProvider as any
      )

      await expect(llmProviderPresenter.warmupAcpProcess('agent-test', '/tmp')).rejects.toThrow(
        'boom'
      )
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

      const invalidLlmProvider = new LLMProviderPresenter(
        invalidMockConfig,
        mockSqlitePresenter,
        presenterRuntimeMock.mcpPresenter as any
      )

      const result = await invalidLlmProvider.check('invalid-test')
      expect(result.isOk).toBe(false)
      expect(result.errorMsg).toBeDefined()
    }, 10000)
  })
})
