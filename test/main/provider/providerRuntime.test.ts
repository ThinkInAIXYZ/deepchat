import { describe, it, expect, beforeEach, vi, beforeAll, afterEach } from 'vitest'
import { ProviderRuntime } from '../../../src/main/provider/index'
import { ProviderSettings } from '../../../src/main/provider/settings'
import type { LLM_PROVIDER } from '@shared/types/provider'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { MainDatabase } from '../../../src/main/data/mainDatabase'
import { AiSdkProvider } from '../../../src/main/provider/providers/aiSdkProvider'
import { ApiEndpointType, ModelType } from '../../../src/shared/model'
import { AcpRuntimeOwner } from '@/agent/acp/client'
import { AcpSessionPersistence } from '@/agent/acp/runtime'

const {
  mockRunAiSdkCoreStream,
  mockRunAiSdkDimensions,
  mockRunAiSdkEmbeddings,
  mockRunAiSdkGenerateText
} = vi.hoisted(() => ({
  mockRunAiSdkCoreStream: vi.fn(),
  mockRunAiSdkDimensions: vi.fn(),
  mockRunAiSdkEmbeddings: vi.fn(),
  mockRunAiSdkGenerateText: vi.fn().mockResolvedValue({ content: 'mock completion' })
}))

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

// Mock proxy config
vi.mock('@/platform/proxy', () => ({
  proxyConfig: {
    getProxyUrl: vi.fn().mockReturnValue(null)
  }
}))

vi.mock('../../../src/main/provider/aiSdk', () => ({
  runAiSdkCoreStream: mockRunAiSdkCoreStream,
  runAiSdkDimensions: mockRunAiSdkDimensions,
  runAiSdkEmbeddings: mockRunAiSdkEmbeddings,
  runAiSdkGenerateText: mockRunAiSdkGenerateText
}))

describe('ProviderRuntime Integration Tests', () => {
  let providerRuntime: ProviderRuntime
  let mockProviderSettings: ProviderSettings
  const mockSqlitePresenter: MainDatabase = {
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
  } as unknown as MainDatabase

  const createProviderRuntime = (providerSettings: ProviderSettings) => {
    const persistence = new AcpSessionPersistence(
      mockSqlitePresenter,
      mockSqlitePresenter as never,
      {
        newEnvironmentsTable: { listPathsForSession: () => [], syncPath: vi.fn() }
      } as never
    )
    return new ProviderRuntime(
      providerSettings,
      { getLanguage: vi.fn().mockReturnValue('en-US') },
      {} as never,
      {} as never,
      new AcpRuntimeOwner(() => {
        throw new Error('ACP runtime is not used in this test')
      }),
      persistence,
      vi.fn()
    )
  }

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
    // Mock ProviderSettings methods
    const mockProviderSettingsInstance = {
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

    mockProviderSettings = mockProviderSettingsInstance as unknown as ProviderSettings
  })

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    mockRunAiSdkGenerateText.mockResolvedValue({ content: 'mock completion' })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 'mock-gpt-thinking' }, { id: 'gpt-4-mock' }, { id: 'mock-gpt-markdown' }]
        }),
        text: vi.fn().mockResolvedValue('')
      })
    )

    // Reset mock implementations
    mockProviderSettings.getProviders = vi.fn().mockReturnValue([mockProvider])
    mockProviderSettings.getProviderById = vi.fn().mockReturnValue(mockProvider)
    mockProviderSettings.getModelConfig = vi.fn().mockReturnValue({
      maxTokens: 4096,
      contextLength: 4096,
      temperature: 0.7,
      vision: false,
      functionCall: false,
      reasoning: false,
      type: 'chat'
    })
    mockProviderSettings.enableModel = vi.fn()
    mockProviderSettings.setProviderModels = vi.fn()
    mockProviderSettings.getCustomModels = vi.fn().mockReturnValue([])
    mockProviderSettings.getProviderModels = vi.fn().mockReturnValue([])
    mockProviderSettings.getModelStatus = vi.fn().mockReturnValue(true)

    // Create new instance for each test
    providerRuntime = createProviderRuntime(mockProviderSettings)
  })

  afterEach(async () => {
    await providerRuntime.shutdown()
    vi.unstubAllGlobals()
  })

  describe('Basic Provider Management', () => {
    it('should initialize with providers', () => {
      const providers = providerRuntime.getProviders()
      expect(providers).toHaveLength(1)
      expect(providers[0].id).toBe('mock-openai-api')
    })

    it('should get provider by id', () => {
      const provider = providerRuntime.getProviderById('mock-openai-api')
      expect(provider).toBeDefined()
      expect(provider.id).toBe('mock-openai-api')
      expect(provider.apiType).toBe('openai-compatible')
    })

    it('streams through the provider runtime boundary', () => {
      const provider = providerRuntime.getProviderInstance('mock-openai-api')
      const stream = (async function* () {})()
      const coreStream = vi.spyOn(provider, 'coreStream').mockReturnValue(stream)
      const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }]
      const signal = new AbortController().signal
      const modelConfig = mockProviderSettings.getModelConfig(
        'mock-gpt-thinking',
        'mock-openai-api'
      )

      expect(
        providerRuntime.streamChat(
          'mock-openai-api',
          messages,
          'mock-gpt-thinking',
          modelConfig,
          0.7,
          100,
          [],
          { signal }
        )
      ).toBe(stream)
      expect(coreStream).toHaveBeenCalledWith(
        messages,
        'mock-gpt-thinking',
        modelConfig,
        0.7,
        100,
        [],
        { signal }
      )
    })

    it('should set current provider', async () => {
      await providerRuntime.setCurrentProvider('mock-openai-api')
      const currentProvider = providerRuntime.getCurrentProvider()
      expect(currentProvider?.id).toBe('mock-openai-api')
    })

    it('defers provider bootstrap until a provider instance is requested', async () => {
      const fetchSpy = vi.spyOn(AiSdkProvider.prototype, 'fetchModels').mockResolvedValue([])

      const presenter = createProviderRuntime(mockProviderSettings)

      await Promise.resolve()
      await Promise.resolve()

      expect(fetchSpy).not.toHaveBeenCalled()

      presenter.getProviderInstance('mock-openai-api')
      await Promise.resolve()
      await Promise.resolve()

      expect(fetchSpy).toHaveBeenCalledTimes(1)
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

      mockProviderSettings.getProviders = vi.fn().mockReturnValue([novitaProvider])
      mockProviderSettings.getProviderById = vi.fn().mockReturnValue(novitaProvider)

      providerRuntime = createProviderRuntime(mockProviderSettings)

      const providerInstance = providerRuntime.getProviderInstance('novita')

      expect(providerInstance).toBeInstanceOf(AiSdkProvider)
    })

    it('cleans provider instances once and rejects new runtime work after shutdown', async () => {
      providerRuntime.getProviderInstance('mock-openai-api')

      await providerRuntime.shutdown()
      await providerRuntime.shutdown()

      expect(providerRuntime.getExistingProviderInstance('mock-openai-api')).toBeUndefined()
      expect(() => providerRuntime.getProviderInstance('mock-openai-api')).toThrow(
        '[Provider] Runtime is closed'
      )
    })
  })

  describe('Model Management', () => {
    beforeEach(async () => {
      await providerRuntime.setCurrentProvider('mock-openai-api')
    })

    it('should fetch model list from mock API', async () => {
      const models = await providerRuntime.getModelList('mock-openai-api')

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
      const result = await providerRuntime.check('mock-openai-api')
      expect(result).toHaveProperty('isOk')
      expect(result).toHaveProperty('errorMsg')
      expect(result.isOk).toBe(true)
    }, 10000)
  })

  describe('Non-stream Completion', () => {
    beforeEach(async () => {
      await providerRuntime.setCurrentProvider('mock-openai-api')
    })

    it('should generate completion without streaming', async () => {
      const messages = [{ role: 'user' as const, content: '1' }]

      const response = await providerRuntime.generateCompletion(
        'mock-openai-api',
        messages,
        'mock-gpt-thinking',
        0.7,
        100
      )

      expect(typeof response).toBe('string')
      expect(response.length).toBeGreaterThan(0)
    }, 15000)

    it('forwards text-generation cancellation options to the provider', async () => {
      const provider = providerRuntime.getProviderInstance('mock-openai-api')
      const generateTextSpy = vi
        .spyOn(provider, 'generateText')
        .mockResolvedValue({ content: 'generated' })
      const signal = new AbortController().signal

      await expect(
        providerRuntime.generateText('mock-openai-api', 'prompt', 'mock-gpt-thinking', 0.2, 128, {
          signal
        })
      ).resolves.toEqual({ content: 'generated' })

      expect(generateTextSpy).toHaveBeenCalledWith('prompt', 'mock-gpt-thinking', 0.2, 128, {
        signal
      })
    })

    it('should generate completion standalone', async () => {
      const messages: ChatMessage[] = [{ role: 'user', content: '1' }]

      const response = await providerRuntime.generateCompletionStandalone(
        'mock-openai-api',
        messages,
        'mock-gpt-thinking',
        0.7,
        100
      )

      expect(typeof response).toBe('string')
      expect(response.length).toBeGreaterThan(0)
    }, 15000)

    it('observes a completion failure that arrives after standalone cancellation', async () => {
      let rejectCompletion!: (reason?: unknown) => void
      const completion = new Promise<never>((_, reject) => {
        rejectCompletion = reject
      })
      const provider = providerRuntime.getProviderInstance('mock-openai-api')
      const completionsSpy = vi.spyOn(provider, 'completions').mockReturnValue(completion)
      const abortController = new AbortController()
      const lateError = new Error('late standalone completion failure')
      const unhandled = vi.fn()

      try {
        const generating = providerRuntime.generateCompletionStandalone(
          'mock-openai-api',
          [{ role: 'user', content: 'cancel me' }],
          'mock-gpt-thinking',
          undefined,
          undefined,
          { signal: abortController.signal }
        )
        abortController.abort()

        await expect(generating).rejects.toMatchObject({ name: 'AbortError' })

        process.on('unhandledRejection', unhandled)
        try {
          rejectCompletion(lateError)
          await new Promise<void>((resolve) => setImmediate(resolve))
          await new Promise<void>((resolve) => setImmediate(resolve))
          expect(unhandled.mock.calls.some(([reason]) => reason === lateError)).toBe(false)
        } finally {
          process.off('unhandledRejection', unhandled)
        }
      } finally {
        completionsSpy.mockRestore()
      }
    })

    it('consumes an iterator teardown failure during standalone image cancellation', async () => {
      const lateError = new Error('image iterator teardown failed')
      const stream = {
        next: vi.fn(() => new Promise<IteratorResult<never>>(() => undefined)),
        return: vi.fn().mockRejectedValue(lateError),
        [Symbol.asyncIterator]() {
          return this
        }
      }
      const provider = providerRuntime.getProviderInstance('mock-openai-api')
      const coreStreamSpy = vi.spyOn(provider, 'coreStream').mockReturnValue(stream as any)
      const abortController = new AbortController()
      const unhandled = vi.fn()

      process.on('unhandledRejection', unhandled)
      try {
        const generating = providerRuntime.generateImageStandalone(
          'mock-openai-api',
          'cancel me',
          'mock-gpt-thinking',
          undefined,
          { signal: abortController.signal }
        )
        await vi.waitFor(() => expect(coreStreamSpy).toHaveBeenCalledOnce())
        expect(coreStreamSpy.mock.calls[0]?.[6]).toEqual({ signal: abortController.signal })
        abortController.abort()

        await expect(generating).rejects.toMatchObject({ name: 'AbortError' })
        await new Promise<void>((resolve) => setImmediate(resolve))
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(stream.return).toHaveBeenCalledOnce()
        expect(unhandled.mock.calls.some(([reason]) => reason === lateError)).toBe(false)
      } finally {
        process.off('unhandledRejection', unhandled)
        coreStreamSpy.mockRestore()
      }
    })

    it('falls back to completion transcription when audio endpoint is unsupported', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (input: string | URL | Request) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

          if (url.endsWith('/audio/transcriptions')) {
            return {
              ok: false,
              status: 404,
              text: vi.fn().mockResolvedValue('mock transcription failure')
            }
          }

          return {
            ok: true,
            json: vi.fn().mockResolvedValue({
              data: [{ id: 'mock-gpt-thinking' }, { id: 'gpt-4-mock' }, { id: 'mock-gpt-markdown' }]
            }),
            text: vi.fn().mockResolvedValue('')
          }
        })
      )

      const transcript = await providerRuntime.transcribeAudioStandalone(
        'mock-openai-api',
        'mock-gpt-thinking',
        'AQID',
        'audio/wav',
        'recording.wav'
      )

      expect(transcript).toBe('mock completion')
    }, 15000)

    it('normalizes audio MIME type casing before transcription validation', async () => {
      const transcribeSpy = vi
        .spyOn(AiSdkProvider.prototype, 'transcribeAudio')
        .mockResolvedValue('mock transcript')

      const transcript = await providerRuntime.transcribeAudioStandalone(
        'mock-openai-api',
        'mock-gpt-thinking',
        'AQID',
        'Audio/WAV',
        'recording.wav'
      )

      expect(transcript).toBe('mock transcript')
      expect(transcribeSpy).toHaveBeenCalledWith(
        'mock-gpt-thinking',
        'AQID',
        'audio/wav',
        'recording.wav',
        expect.any(Object)
      )
    }, 15000)

    it('should generate images through the standalone image runtime', async () => {
      mockProviderSettings.getModelConfig = vi.fn().mockReturnValue({
        maxTokens: 4096,
        contextLength: 4096,
        temperature: 0.7,
        vision: false,
        functionCall: false,
        reasoning: false,
        type: ModelType.ImageGeneration,
        imageGeneration: { quality: 'low' }
      })
      mockRunAiSdkCoreStream.mockImplementationOnce(async function* () {
        yield {
          type: 'image_data',
          image_data: { data: 'imgcache://generated.png', mimeType: 'image/png' }
        }
        yield { type: 'stop', stop_reason: 'complete' }
      })

      const response = await providerRuntime.generateImageStandalone(
        'mock-openai-api',
        'A warm sunset over the ocean',
        'gpt-image-1',
        { size: '1024x1024' }
      )

      expect(response).toEqual({
        providerId: 'mock-openai-api',
        modelId: 'gpt-image-1',
        options: { quality: 'low', size: '1024x1024' },
        images: [{ data: 'imgcache://generated.png', mimeType: 'image/png' }]
      })
      expect(mockRunAiSdkCoreStream).toHaveBeenCalledWith(
        expect.any(Object),
        [{ role: 'user', content: 'A warm sunset over the ocean' }],
        'gpt-image-1',
        expect.objectContaining({
          apiEndpoint: ApiEndpointType.Image,
          type: ModelType.ImageGeneration,
          imageGeneration: { quality: 'low', size: '1024x1024' }
        }),
        0.7,
        4096,
        []
      )
    }, 15000)

    it('should summarize titles', async () => {
      const messages = [
        { role: 'user' as const, content: 'Hello, I want to learn about artificial intelligence' },
        {
          role: 'assistant' as const,
          content: 'I can help you learn about AI. What specific aspects interest you?'
        }
      ]

      const title = await providerRuntime.summaryTitles(
        messages,
        'mock-openai-api',
        'mock-gpt-thinking'
      )

      expect(typeof title).toBe('string')
      expect(title.length).toBeGreaterThan(0)
    }, 15000)
  })

  describe('Error Handling', () => {
    it('should handle invalid provider id', () => {
      expect(() => {
        providerRuntime.getProviderById('non-existent')
      }).toThrow('Provider non-existent not found')
    })

    it('should swallow ACP warmup shutdown errors', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const mockAcpProvider = {
        warmupProcess: vi
          .fn()
          .mockRejectedValue(new Error('[ACP] Process manager is shutting down, refusing to spawn'))
      }
      vi.spyOn(providerRuntime as any, 'getAcpProviderInstance').mockReturnValue(
        mockAcpProvider as any
      )

      await expect(providerRuntime.warmupAcpProcess('agent-test', '/tmp')).resolves.toBeUndefined()
      warnSpy.mockRestore()
    })

    it('should rethrow non-shutdown ACP warmup errors', async () => {
      const mockAcpProvider = {
        warmupProcess: vi.fn().mockRejectedValue(new Error('boom'))
      }
      vi.spyOn(providerRuntime as any, 'getAcpProviderInstance').mockReturnValue(
        mockAcpProvider as any
      )

      await expect(providerRuntime.warmupAcpProcess('agent-test', '/tmp')).rejects.toThrow('boom')
    })

    it('should handle provider check failure for invalid config', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

      // 创建一个无效配置的provider
      const invalidProvider: LLM_PROVIDER = {
        id: 'invalid-test',
        name: 'Invalid Test',
        apiType: 'openai-compatible',
        apiKey: 'invalid-key',
        baseUrl: 'https://invalid-url-that-does-not-exist.com/v1',
        enable: true
      }

      // 创建一个新的 ProviderRuntime 实例来测试无效配置
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
      } as unknown as ProviderSettings

      const invalidLlmProvider = createProviderRuntime(invalidMockConfig)

      const result = await invalidLlmProvider.check('invalid-test')
      expect(result.isOk).toBe(false)
      expect(result.errorMsg).toBeDefined()
    }, 10000)
  })
})
