import { describe, it, expect, beforeEach, vi, beforeAll, afterEach } from 'vitest'
import { ProviderRuntime } from '../../../src/main/provider/index'
import { ProviderSettings } from '../../../src/main/provider/settings'
import type { LLM_PROVIDER } from '@shared/types/provider'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { MainDatabase } from '../../../src/main/data/mainDatabase'
import { AiSdkProvider } from '../../../src/main/provider/providers/aiSdkProvider'
import { ModelType } from '../../../src/shared/model'
import { AcpRuntimeOwner } from '@/agent/acp/client'
import { AcpSessionPersistence } from '@/agent/acp/runtime'
import { DEFAULT_PROVIDERS } from '@/provider/defaults'
import { DimAuxiliaryModels } from '@/agent/dim/auxiliaryModels'
import { DimEmbeddingModels } from '@/agent/dim/embeddingModels'
import { DimMediaModels } from '@/agent/dim/mediaModels'
import { DimDecisions } from '@/agent/dim/decisions'
import { DimMediaSubmissionError } from '@/agent/dim/modality'
import { ProviderInstanceManager } from '@/provider/managers/providerInstanceManager'

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
    BrowserWindow: vi.fn(function BrowserWindow() {
      return {
        loadURL: vi.fn(),
        loadFile: vi.fn(),
        on: vi.fn(),
        webContents: { send: vi.fn(), on: vi.fn(), isDestroyed: vi.fn(() => false) },
        isDestroyed: vi.fn(() => false),
        close: vi.fn(),
        show: vi.fn(),
        hide: vi.fn()
      }
    }),
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
      getCapabilitySnapshot: vi.fn().mockReturnValue({ supportsAudioInput: false }),
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
    mockProviderSettings.resolveEffectiveModels = vi.fn((models, providerId) =>
      models.map((model) => ({
        ...model,
        ...mockProviderSettings.getModelConfig(model.id, providerId)
      }))
    )

    // Create new instance for each test
    providerRuntime = createProviderRuntime(mockProviderSettings)
  })

  afterEach(async () => {
    await providerRuntime.shutdown()
    vi.unstubAllGlobals()
  })

  it('instantiates every built-in profile without an extra special-provider allowlist', () => {
    const manager = new ProviderInstanceManager({
      providerSettings: mockProviderSettings,
      locale: { getLanguage: () => 'en-US' },
      agentSettings: { getAcpEnabled: () => false, getAcpAgents: () => [] },
      activeStreams: new Map(),
      rateLimitManager: { cleanupProviderRateLimit: vi.fn(), syncProviders: vi.fn() } as never,
      getCurrentProviderId: () => null,
      setCurrentProviderId: vi.fn(),
      acpRuntimeOwner: new AcpRuntimeOwner(() => ({}) as never),
      publishEvent: vi.fn()
    })
    manager.setProviders(DEFAULT_PROVIDERS.map((provider) => ({ ...provider, enable: false })))
    try {
      expect(DEFAULT_PROVIDERS.length).toBeGreaterThan(0)
      for (const provider of DEFAULT_PROVIDERS) {
        expect(manager.getProviderInstance(provider.id), provider.id).toBeDefined()
      }
    } finally {
      manager.shutdown()
    }
  })

  describe('Draft credential validation', () => {
    it.each([
      ['alibaba-token-plan-cn', 'openai-completions', 'deepseek-v4-flash'],
      ['anthropic', 'anthropic', 'claude-sonnet-4-5-20250929']
    ])(
      'validates %s without background catalog writes or replacing the live instance',
      async (id, apiType, modelId) => {
        const saved = { ...mockProvider, id, apiType, enable: false, apiKey: 'saved-key' }
        mockProviderSettings.getProviders = vi.fn().mockReturnValue([saved])
        mockProviderSettings.getProviderById = vi.fn().mockReturnValue(saved)
        await providerRuntime.shutdown()
        providerRuntime = createProviderRuntime(mockProviderSettings)
        const liveInstance = providerRuntime.getProviderInstance(id)
        const draft = { ...saved, enable: true, apiKey: 'replacement-key' }
        const completeDraft = vi.fn().mockResolvedValue({ text: 'checked', stopReason: 'end_turn' })
        providerRuntime.setNativeModels({ completeDraft } as never)

        await expect(providerRuntime.validateDraft(draft, { loadModels: false })).resolves.toEqual({
          isOk: true,
          errorMsg: null,
          models: []
        })

        expect(completeDraft).toHaveBeenCalledOnce()
        expect(completeDraft).toHaveBeenCalledWith(
          draft,
          modelId,
          expect.any(String),
          expect.any(AbortSignal)
        )
        expect(mockRunAiSdkGenerateText).not.toHaveBeenCalled()
        expect(global.fetch).not.toHaveBeenCalled()
        expect(mockProviderSettings.setProviderModels).not.toHaveBeenCalled()
        expect(mockProviderSettings.enableModel).not.toHaveBeenCalled()
        expect(providerRuntime.getExistingProviderInstance(id)).toBe(liveInstance)
        expect(providerRuntime.getProviderById(id)).toEqual(saved)
        expect(draft).toMatchObject({ enable: true, apiKey: 'replacement-key' })
      }
    )

    it('returns the upstream credential error without saving the rejected draft', async () => {
      const completeDraft = vi.fn().mockRejectedValue(new Error('Invalid API-key provided'))
      providerRuntime.setNativeModels({ completeDraft } as never)

      await expect(
        providerRuntime.validateDraft(
          {
            ...mockProvider,
            id: 'alibaba-token-plan-cn',
            apiType: 'openai-completions',
            apiKey: 'rejected-key'
          },
          { loadModels: false }
        )
      ).resolves.toEqual({
        isOk: false,
        errorMsg: 'Invalid API-key provided',
        models: []
      })
      expect(completeDraft).toHaveBeenCalledOnce()
      expect(mockRunAiSdkGenerateText).not.toHaveBeenCalled()
      expect(global.fetch).not.toHaveBeenCalled()
      expect(mockProviderSettings.setProviderModels).not.toHaveBeenCalled()
      expect(mockProviderSettings.enableModel).not.toHaveBeenCalled()
      expect(providerRuntime.getProviders()).toEqual([mockProvider])
      expect(providerRuntime.getExistingProviderInstance('alibaba-token-plan-cn')).toBeUndefined()
    })
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

    it('should set current provider', async () => {
      await providerRuntime.setCurrentProvider('mock-openai-api')
      const currentProvider = providerRuntime.getCurrentProvider()
      expect(currentProvider?.id).toBe('mock-openai-api')
    })

    it('never bootstraps the catalog from provider instance creation', async () => {
      const fetchSpy = vi.spyOn(AiSdkProvider.prototype, 'fetchModels').mockResolvedValue([])

      const presenter = createProviderRuntime(mockProviderSettings)

      await Promise.resolve()
      await Promise.resolve()

      expect(fetchSpy).not.toHaveBeenCalled()

      presenter.getProviderInstance('mock-openai-api')
      await Promise.resolve()
      await Promise.resolve()

      expect(fetchSpy).not.toHaveBeenCalled()
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

    it('routes desktop text inference exclusively through the installed native facade', async () => {
      const complete = vi.fn().mockResolvedValue({
        text: 'native answer',
        stopReason: 'end_turn',
        usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 }
      })
      const legacy = vi.spyOn(
        providerRuntime.getProviderInstance('mock-openai-api'),
        'generateText'
      )
      providerRuntime.setNativeModels(
        new DimAuxiliaryModels({
          models: {
            admit: async () => ({ providerId: 'native-provider', modelId: 'native-model' })
          },
          bridge: { complete }
        })
      )
      const signal = new AbortController().signal
      await expect(
        providerRuntime.generateText('mock-openai-api', 'prompt', 'mock-gpt-thinking', 0.2, 128, {
          signal
        })
      ).resolves.toEqual({
        content: 'native answer',
        totalUsage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
      })
      expect(complete).toHaveBeenCalledWith(
        { providerId: 'native-provider', modelId: 'native-model' },
        { messages: [{ role: 'user', content: [{ type: 'text', text: 'prompt' }] }] },
        signal,
        { temperature: 0.2, maxTokens: 128 }
      )
      expect(legacy).not.toHaveBeenCalled()
    })

    it('uses native streaming and model tests without invoking the desktop provider', async () => {
      const legacy = vi.spyOn(providerRuntime.getProviderInstance('mock-openai-api'), 'coreStream')
      const completions = vi.spyOn(
        providerRuntime.getProviderInstance('mock-openai-api'),
        'completions'
      )
      const complete = vi.fn().mockResolvedValue({ text: 'checked', stopReason: 'end_turn' })
      const stream = vi.fn(async function* () {
        yield { type: 'text' as const, content: 'native chunk' }
        yield { type: 'stop' as const, stop_reason: 'complete' as const }
      })
      providerRuntime.setNativeModels(
        new DimAuxiliaryModels({
          models: { admit: async () => ({ providerId: 'native', modelId: 'native-model' }) },
          bridge: { complete, stream }
        })
      )
      const events = []
      for await (const event of providerRuntime.streamChat(
        'mock-openai-api',
        [{ role: 'user', content: 'prompt' }],
        'mock-gpt-thinking',
        mockProviderSettings.getModelConfig('mock-gpt-thinking', 'mock-openai-api'),
        0.2,
        128,
        []
      ))
        events.push(event)
      expect(events).toEqual([
        { type: 'text', content: 'native chunk' },
        { type: 'stop', stop_reason: 'complete' }
      ])
      await expect(providerRuntime.check('mock-openai-api', 'mock-gpt-thinking')).resolves.toEqual({
        isOk: true,
        errorMsg: null
      })
      expect(stream).toHaveBeenCalledOnce()
      expect(complete).toHaveBeenCalledOnce()
      expect(legacy).not.toHaveBeenCalled()
      expect(completions).not.toHaveBeenCalled()
    })

    it('keeps ACP auxiliary calls on the desktop ACP client', async () => {
      mockProviderSettings.getProviderById = vi
        .fn()
        .mockReturnValue({ ...mockProvider, id: 'acp', apiType: 'acp' })
      const generateText = vi.fn().mockResolvedValue({ content: 'ACP client answer' })
      vi.spyOn(providerRuntime, 'getProviderInstance').mockReturnValue({ generateText } as never)
      const complete = vi.fn()
      providerRuntime.setNativeModels(
        new DimAuxiliaryModels({ models: { admit: vi.fn() }, bridge: { complete } })
      )
      await expect(providerRuntime.generateText('acp', 'question', 'agent')).resolves.toEqual({
        content: 'ACP client answer'
      })
      expect(generateText).toHaveBeenCalledWith('question', 'agent', undefined, undefined)
      expect(complete).not.toHaveBeenCalled()
    })

    it('propagates native cancellation without falling back to a desktop provider', async () => {
      const controller = new AbortController()
      const complete = vi.fn(async () => {
        controller.abort()
        throw new Error('native disconnected')
      })
      const legacy = vi.spyOn(providerRuntime.getProviderInstance('mock-openai-api'), 'completions')
      providerRuntime.setNativeModels(
        new DimAuxiliaryModels({
          models: {
            admit: async () => ({ providerId: 'native-provider', modelId: 'native-model' })
          },
          bridge: { complete }
        })
      )
      await expect(
        providerRuntime.generateCompletionStandalone(
          'mock-openai-api',
          [{ role: 'user', content: 'prompt' }],
          'mock-gpt-thinking',
          0.2,
          128,
          { signal: controller.signal }
        )
      ).rejects.toThrow()
      expect(legacy).not.toHaveBeenCalled()
    })

    it('routes knowledge embeddings and dimension failures exclusively through dim', async () => {
      const legacy = vi.spyOn(
        providerRuntime.getProviderInstance('mock-openai-api'),
        'getEmbeddings'
      )
      const embed = vi.fn().mockResolvedValue({ vectors: [[1, 0]] })
      providerRuntime.setNativeEmbedding(
        new DimEmbeddingModels({
          models: {
            admit: async () => ({ providerId: 'native-provider', modelId: 'native-model' })
          },
          bridge: { embed }
        })
      )
      await expect(
        providerRuntime.getEmbeddings('mock-openai-api', 'mock-gpt-thinking', ['sample'])
      ).resolves.toEqual([[1, 0]])
      await expect(
        providerRuntime.getDimensions('mock-openai-api', 'mock-gpt-thinking')
      ).resolves.toEqual({ data: { dimensions: 2, normalized: true } })
      embed.mockRejectedValue(new Error('native connection lost'))
      await expect(
        providerRuntime.getDimensions('mock-openai-api', 'mock-gpt-thinking')
      ).resolves.toEqual({
        data: { dimensions: 0, normalized: false },
        errorMsg: 'native connection lost'
      })
      const controller = new AbortController()
      controller.abort(new Error('cancel dimensions'))
      await expect(
        providerRuntime.getDimensions('mock-openai-api', 'mock-gpt-thinking', controller.signal)
      ).rejects.toThrow('cancel dimensions')
      expect(legacy).not.toHaveBeenCalled()
    })

    it('keeps desktop media admission limits and never retries an unknown native submission', async () => {
      const unknown = new DimMediaSubmissionError('native-task-id', new Error('connection lost'))
      const submit = vi.fn().mockRejectedValue(unknown)
      const legacy = vi.spyOn(providerRuntime.getProviderInstance('mock-openai-api'), 'coreStream')
      const rateLimit = vi.spyOn(providerRuntime, 'executeWithRateLimit').mockResolvedValue()
      providerRuntime.setNativeMedia(
        new DimMediaModels({
          settings: mockProviderSettings,
          models: {
            admit: async () => ({ providerId: 'native-provider', modelId: 'native-model' })
          },
          media: { submit, wait: vi.fn(), readResult: vi.fn() }
        })
      )
      const calls = [
        () =>
          providerRuntime.generateImageStandalone('mock-openai-api', 'image', 'mock-gpt-thinking'),
        () =>
          providerRuntime.generateVideoStandalone('mock-openai-api', 'video', 'mock-gpt-thinking'),
        () =>
          providerRuntime.generateSpeechStandalone(
            'mock-openai-api',
            'speech',
            'mock-gpt-thinking'
          ),
        () =>
          providerRuntime.transcribeAudioStandalone(
            'mock-openai-api',
            'mock-gpt-thinking',
            'AQID',
            'audio/wav'
          )
      ]
      for (const call of calls) await expect(call()).rejects.toBe(unknown)
      expect(rateLimit).toHaveBeenCalledTimes(4)
      expect(submit).toHaveBeenCalledTimes(4)
      expect(legacy).not.toHaveBeenCalled()
    })

    it('transcribes with the selected audio chat model through native inference', async () => {
      vi.mocked(mockProviderSettings.getCapabilitySnapshot).mockReturnValueOnce({
        supportsAudioInput: true
      } as never)
      const complete = vi
        .fn()
        .mockResolvedValue({ text: ' Native audio transcript ', stopReason: 'end_turn' })
      const oldTranscribe = vi.spyOn(
        providerRuntime.getProviderInstance('mock-openai-api'),
        'transcribeAudio'
      )
      providerRuntime.setNativeModels(
        new DimAuxiliaryModels({
          models: { admit: async () => ({ providerId: 'native', modelId: 'audio-model' }) },
          bridge: { complete }
        })
      )
      await expect(
        providerRuntime.transcribeAudioStandalone(
          'mock-openai-api',
          'audio-model',
          'AQID',
          'Audio/WAV'
        )
      ).resolves.toBe('Native audio transcript')
      expect(complete.mock.calls[0][1].messages[0].content).toContainEqual({
        type: 'image',
        source: { type: 'base64', mediaType: 'audio/wav', data: 'AQID' }
      })
      expect(oldTranscribe).not.toHaveBeenCalled()
    })

    it('requires native admission for judgments and never constructs a Node executor', async () => {
      const legacy = vi.spyOn(providerRuntime, 'getProviderInstance')
      const input = {
        state: { evidence: 'fixture' },
        questions: { accepted: { type: 'noul' as const, instructions: 'Accept?' } }
      }
      await expect(providerRuntime.runJudgment('mock-openai-api', 'jev', input)).rejects.toThrow(
        'Native dim decision service is unavailable'
      )
      const result = {
        model: 'jev-version',
        answers: { accepted: { type: 'noul' as const, noul: 0.9 } }
      }
      const decide = vi.fn().mockResolvedValue(result)
      const admit = vi.fn().mockResolvedValue({ providerId: 'native', modelId: 'jev' })
      providerRuntime.setNativeDecisions(
        new DimDecisions({ models: { admit }, bridge: { decide } })
      )
      await expect(providerRuntime.runJudgment('mock-openai-api', 'jev', input)).resolves.toEqual(
        result
      )
      expect(admit).toHaveBeenCalledWith('mock-openai-api', 'jev')
      expect(decide).toHaveBeenCalledWith(
        { providerId: 'native', modelId: 'jev' },
        input,
        undefined
      )
      expect(legacy).not.toHaveBeenCalled()
    })

    it('requires native media owners for every standalone media operation', async () => {
      const provider = providerRuntime.getProviderInstance('mock-openai-api')
      const legacy = vi.spyOn(provider, 'coreStream')
      const legacyTranscribe = vi.spyOn(provider, 'transcribeAudio')
      for (const method of [
        'generateImageStandalone',
        'generateVideoStandalone',
        'generateSpeechStandalone'
      ] as const) {
        await expect(
          providerRuntime[method]('mock-openai-api', 'hello', 'mock-gpt-thinking')
        ).rejects.toThrow('Native dim media service is unavailable')
      }
      await expect(
        providerRuntime.transcribeAudioStandalone(
          'mock-openai-api',
          'mock-gpt-thinking',
          'AQID',
          'Audio/WAV'
        )
      ).rejects.toThrow('Native dim media service is unavailable')
      expect(legacy).not.toHaveBeenCalled()
      expect(legacyTranscribe).not.toHaveBeenCalled()
    })

    it('routes title and summary helpers through the native model service', async () => {
      const complete = vi.fn().mockResolvedValue({ text: 'Native title', stopReason: 'end_turn' })
      const provider = providerRuntime.getProviderInstance('mock-openai-api')
      const legacyTitle = vi.spyOn(provider, 'summaryTitles')
      const legacySummary = vi.spyOn(provider, 'summaries')
      providerRuntime.setNativeModels(
        new DimAuxiliaryModels({
          models: { admit: async () => ({ providerId: 'native', modelId: 'fixture' }) },
          bridge: { complete }
        })
      )
      await expect(
        providerRuntime.summaryTitles(
          [{ role: 'user', content: 'conversation' }],
          'mock-openai-api',
          'mock-gpt-thinking'
        )
      ).resolves.toBe('Native title')
      await providerRuntime.generateSummary(
        'mock-openai-api',
        'content to summarize',
        'mock-gpt-thinking'
      )
      expect(complete).toHaveBeenCalledTimes(2)
      expect(complete.mock.calls[0][1].system).toBeTruthy()
      expect(JSON.stringify(complete.mock.calls[1][1])).toContain('concise summary')
      expect(legacyTitle).not.toHaveBeenCalled()
      expect(legacySummary).not.toHaveBeenCalled()
    })

    it('rejects missing native model and embedding owners instead of falling back', async () => {
      const provider = providerRuntime.getProviderInstance('mock-openai-api')
      const completion = vi.spyOn(provider, 'completions')
      const embedding = vi.spyOn(provider, 'getEmbeddings')
      await expect(
        providerRuntime.generateText('mock-openai-api', 'prompt', 'mock-gpt-thinking')
      ).rejects.toThrow('Native dim model service is unavailable')
      await expect(
        providerRuntime.generateCompletionStandalone(
          'mock-openai-api',
          [{ role: 'user', content: 'prompt' }],
          'mock-gpt-thinking'
        )
      ).rejects.toThrow('Native dim model service is unavailable')
      await expect(
        providerRuntime.getEmbeddings('mock-openai-api', 'mock-gpt-thinking', ['text'])
      ).rejects.toThrow('Native dim embedding service is unavailable')
      expect(completion).not.toHaveBeenCalled()
      expect(embedding).not.toHaveBeenCalled()
    })
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
