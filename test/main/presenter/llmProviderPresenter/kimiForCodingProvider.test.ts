import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IConfigPresenter, LLM_PROVIDER } from '../../../../src/shared/presenter'
import { AiSdkProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/aiSdkProvider'
import { resolveAiSdkProviderDefinition } from '../../../../src/main/presenter/llmProviderPresenter/providerRegistry'

const { mockGetProvider, mockRunAiSdkGenerateText } = vi.hoisted(() => ({
  mockGetProvider: vi.fn(),
  mockRunAiSdkGenerateText: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getName: vi.fn(() => 'DeepChat'),
    getVersion: vi.fn(() => '0.0.0-test'),
    getPath: vi.fn(() => '/mock/path'),
    isReady: vi.fn(() => true),
    on: vi.fn()
  }
}))

vi.mock('@shared/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    silly: vi.fn(),
    log: vi.fn()
  }
}))

vi.mock('@/eventbus', () => ({
  eventBus: {
    on: vi.fn(),
    sendToMain: vi.fn(),
    emit: vi.fn(),
    send: vi.fn()
  }
}))

vi.mock('@/events', () => ({
  CONFIG_EVENTS: {
    MODEL_LIST_CHANGED: 'MODEL_LIST_CHANGED'
  },
  PROVIDER_DB_EVENTS: {
    LOADED: 'LOADED',
    UPDATED: 'UPDATED'
  },
  NOTIFICATION_EVENTS: {
    SHOW_ERROR: 'SHOW_ERROR'
  }
}))

vi.mock('../../../../src/main/presenter/proxyConfig', () => ({
  proxyConfig: {
    getProxyUrl: vi.fn().mockReturnValue(null)
  }
}))

vi.mock('../../../../src/main/presenter/configPresenter/providerDbLoader', () => ({
  providerDbLoader: {
    getDb: vi.fn().mockReturnValue(null),
    getProvider: mockGetProvider,
    getModel: vi.fn()
  }
}))

vi.mock('../../../../src/main/presenter/llmProviderPresenter/aiSdk', () => ({
  runAiSdkCoreStream: vi.fn(),
  runAiSdkDimensions: vi.fn(),
  runAiSdkEmbeddings: vi.fn(),
  runAiSdkGenerateText: mockRunAiSdkGenerateText
}))

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'kimi-for-coding',
  name: 'Kimi For Coding',
  apiType: 'anthropic',
  apiKey: 'test-key',
  baseUrl: 'https://api.kimi.com/coding/',
  enable: false,
  ...overrides
})

const createConfigPresenter = (): IConfigPresenter =>
  ({
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getModelConfig: vi.fn().mockReturnValue(undefined),
    getSetting: vi.fn().mockReturnValue(undefined),
    setProviderModels: vi.fn(),
    getModelStatus: vi.fn().mockReturnValue(true),
    setModelConfig: vi.fn(),
    hasUserModelConfig: vi.fn().mockReturnValue(false)
  }) as unknown as IConfigPresenter

describe('AiSdkProvider kimi-for-coding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunAiSdkGenerateText.mockResolvedValue({ content: 'ok' })
  })

  it('resolves Kimi For Coding through the Anthropic-compatible runtime', () => {
    expect(resolveAiSdkProviderDefinition(createProvider())).toMatchObject({
      runtimeKind: 'anthropic',
      behaviorPreset: 'anthropic',
      modelSource: 'kimi-for-coding',
      providerDbSourceId: 'kimi-for-coding',
      providerDbGroup: 'Kimi Code',
      checkStrategy: 'generate-text',
      credentialStrategy: 'api-key',
      embeddingStrategy: 'none',
      checkModelId: 'kimi-for-coding'
    })
  })

  it('maps Kimi For Coding provider DB metadata into provider models', async () => {
    mockGetProvider.mockReturnValue({
      id: 'kimi-for-coding',
      name: 'Kimi For Coding',
      models: [
        {
          id: 'k2p7',
          display_name: 'Kimi K2.7 Code',
          tool_call: true,
          reasoning: {
            supported: true,
            default: true
          },
          modalities: {
            input: ['text', 'image', 'video'],
            output: ['text']
          },
          limit: {
            context: 262144,
            output: 32768
          }
        },
        {
          id: 'kimi-for-coding',
          display_name: 'K2.7 Code',
          tool_call: true,
          reasoning: {
            supported: true,
            default: true
          },
          modalities: {
            input: ['text', 'image', 'video'],
            output: ['text']
          },
          limit: {
            context: 262144,
            output: 32768
          }
        }
      ]
    })

    const provider = new AiSdkProvider(createProvider(), createConfigPresenter())
    const models = await provider.fetchModels()

    expect(mockGetProvider).toHaveBeenCalledWith('kimi-for-coding')
    expect(models).toHaveLength(1)
    expect(models).toEqual([
      expect.objectContaining({
        id: 'kimi-for-coding',
        name: 'K2.7 Code',
        group: 'Kimi Code',
        providerId: 'kimi-for-coding',
        vision: true,
        functionCall: true,
        reasoning: true,
        contextLength: 262144,
        maxTokens: 32000
      })
    ])
  })

  it('fails provider verification before making a request when the API key is missing', async () => {
    const provider = new AiSdkProvider(
      createProvider({
        apiKey: ''
      }),
      createConfigPresenter()
    )

    await expect(provider.check()).resolves.toEqual({
      isOk: false,
      errorMsg: 'Missing API key'
    })
    expect(mockRunAiSdkGenerateText).not.toHaveBeenCalled()
  })

  it('verifies Kimi For Coding with a small generate-text request', async () => {
    const provider = new AiSdkProvider(createProvider(), createConfigPresenter())
    ;(provider as any).isInitialized = true

    await expect(provider.check()).resolves.toEqual({
      isOk: true,
      errorMsg: null
    })
    expect(mockRunAiSdkGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKind: 'anthropic',
        cleanHeaders: false,
        provider: expect.objectContaining({
          id: 'kimi-for-coding',
          apiType: 'anthropic',
          baseUrl: 'https://api.kimi.com/coding/'
        })
      }),
      [{ role: 'user', content: 'Hello' }],
      'kimi-for-coding',
      expect.any(Object),
      0.2,
      16
    )
  })
})
