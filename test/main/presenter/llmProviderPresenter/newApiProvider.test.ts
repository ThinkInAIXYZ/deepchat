import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ChatMessage,
  IConfigPresenter,
  LLMCoreStreamEvent,
  LLM_PROVIDER,
  ModelConfig
} from '../../../../src/shared/presenter'
import { ApiEndpointType, ModelType } from '../../../../src/shared/model'
import { NewApiProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/newApiProvider'

const {
  mockOpenAIChatCreate,
  mockOpenAIResponsesCreate,
  mockOpenAIModelsList,
  mockAnthropicModelsList,
  mockAnthropicMessagesCreate,
  mockGetProxyUrl
} = vi.hoisted(() => ({
  mockOpenAIChatCreate: vi.fn(),
  mockOpenAIResponsesCreate: vi.fn(),
  mockOpenAIModelsList: vi.fn().mockResolvedValue({ data: [] }),
  mockAnthropicModelsList: vi.fn().mockResolvedValue({ data: [] }),
  mockAnthropicMessagesCreate: vi.fn().mockResolvedValue({}),
  mockGetProxyUrl: vi.fn().mockReturnValue(null)
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
        create: mockOpenAIChatCreate
      }
    }
    responses = {
      create: mockOpenAIResponsesCreate
    }
    models = {
      list: mockOpenAIModelsList
    }
  }

  return {
    default: MockOpenAI,
    AzureOpenAI: MockOpenAI
  }
})

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    models = {
      list: mockAnthropicModelsList
    }
    messages = {
      create: mockAnthropicMessagesCreate
    }

    constructor(_: Record<string, unknown>) {}
  }

  return {
    default: MockAnthropic
  }
})

vi.mock('@google/genai', () => ({
  Content: class {},
  GoogleGenAI: class MockGoogleGenAI {
    models = {
      list: vi.fn().mockResolvedValue([]),
      generateContent: vi.fn().mockResolvedValue({ text: 'ok' })
    }

    constructor(_: Record<string, unknown>) {}
  },
  FunctionCallingConfigMode: {
    ANY: 'ANY',
    AUTO: 'AUTO',
    NONE: 'NONE'
  },
  GenerateContentParameters: class {},
  GenerateContentResponseUsageMetadata: class {},
  GenerateContentConfig: class {},
  HarmBlockThreshold: {
    BLOCK_NONE: 'BLOCK_NONE',
    BLOCK_LOW_AND_ABOVE: 'BLOCK_LOW_AND_ABOVE',
    BLOCK_MEDIUM_AND_ABOVE: 'BLOCK_MEDIUM_AND_ABOVE',
    BLOCK_ONLY_HIGH: 'BLOCK_ONLY_HIGH',
    HARM_BLOCK_THRESHOLD_UNSPECIFIED: 'HARM_BLOCK_THRESHOLD_UNSPECIFIED'
  },
  HarmCategory: {
    HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
    HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
    HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT'
  },
  Modality: {
    TEXT: 'TEXT',
    IMAGE: 'IMAGE'
  },
  Part: class {},
  SafetySetting: class {},
  Tool: class {}
}))

vi.mock('@/presenter', () => ({
  presenter: {
    devicePresenter: {
      cacheImage: vi.fn()
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
    supportsVision: vi.fn().mockReturnValue(false),
    supportsToolCall: vi.fn().mockReturnValue(false),
    supportsImageOutput: vi.fn().mockReturnValue(false),
    getThinkingBudgetRange: vi.fn().mockReturnValue({}),
    resolveProviderId: vi.fn((providerId: string) => providerId)
  }
}))

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'new-api',
  name: 'New API',
  apiType: 'new-api',
  apiKey: 'test-key',
  baseUrl: 'https://www.newapi.ai',
  enable: false,
  models: [],
  customModels: [],
  enabledModels: [],
  disabledModels: [],
  ...overrides
})

const createConfigPresenter = (
  modelConfigById: Record<string, Partial<ModelConfig>> = {}
): IConfigPresenter =>
  ({
    getProviders: vi.fn().mockReturnValue([]),
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getDbProviderModels: vi.fn().mockReturnValue([]),
    getModelConfig: vi.fn((modelId: string) => ({
      type: ModelType.Chat,
      apiEndpoint: ApiEndpointType.Chat,
      ...modelConfigById[modelId]
    })),
    getSetting: vi.fn().mockReturnValue(undefined),
    getModelStatus: vi.fn().mockReturnValue(false),
    setProviderModels: vi.fn(),
    hasUserModelConfig: vi.fn().mockReturnValue(false),
    setModelConfig: vi.fn()
  }) as unknown as IConfigPresenter

describe('NewApiProvider capability routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps openai-response delegates to openai capability semantics', () => {
    const provider = new NewApiProvider(createProvider(), createConfigPresenter())
    const delegateProvider = (provider as any).openaiResponsesDelegate.provider as LLM_PROVIDER

    expect(delegateProvider.id).toBe('new-api')
    expect(delegateProvider.capabilityProviderId).toBe('openai')
    expect(delegateProvider.apiType).toBe('openai-responses')
  })

  it('maps gemini delegates to gemini capability semantics', () => {
    const provider = new NewApiProvider(createProvider(), createConfigPresenter())
    const delegateProvider = (provider as any).geminiDelegate.provider as LLM_PROVIDER

    expect(delegateProvider.id).toBe('new-api')
    expect(delegateProvider.capabilityProviderId).toBe('gemini')
    expect(delegateProvider.apiType).toBe('gemini')
  })

  it('maps anthropic delegates to anthropic capability semantics', () => {
    const provider = new NewApiProvider(createProvider(), createConfigPresenter())
    const delegateProvider = (provider as any).anthropicDelegate.provider as LLM_PROVIDER

    expect(delegateProvider.id).toBe('new-api')
    expect(delegateProvider.capabilityProviderId).toBe('anthropic')
    expect(delegateProvider.apiType).toBe('anthropic')
  })

  it('keeps image-generation on the image runtime route while using openai capabilities', async () => {
    const configPresenter = createConfigPresenter({
      'gpt-image-1': {
        endpointType: 'image-generation',
        apiEndpoint: ApiEndpointType.Chat,
        type: ModelType.Chat
      }
    })
    const provider = new NewApiProvider(createProvider(), configPresenter)
    const openaiChatDelegate = (provider as any).openaiChatDelegate
    const coreStreamSpy = vi
      .spyOn(openaiChatDelegate, 'coreStream')
      .mockImplementation(async function* (
        _messages: ChatMessage[],
        _modelId: string,
        modelConfig: ModelConfig
      ): AsyncIterable<LLMCoreStreamEvent> {
        expect(modelConfig.apiEndpoint).toBe(ApiEndpointType.Image)
        expect(modelConfig.type).toBe(ModelType.ImageGeneration)
        expect(modelConfig.endpointType).toBe('image-generation')
        yield { type: 'text', content: 'generated-image' } as LLMCoreStreamEvent
      })

    const result = await provider.completions(
      [{ role: 'user', content: 'Draw a cat' }],
      'gpt-image-1'
    )

    expect(openaiChatDelegate.provider.capabilityProviderId).toBe('openai')
    expect(coreStreamSpy).toHaveBeenCalledOnce()
    expect(result.content).toBe('generated-image')
  })
})
