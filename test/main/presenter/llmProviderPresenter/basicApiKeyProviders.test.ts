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

const createProvider = (overrides: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'nvidia',
  name: 'NVIDIA',
  apiType: 'openai-completions',
  apiKey: 'test-key',
  baseUrl: 'https://integrate.api.nvidia.com/v1',
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

describe('basic API-key provider registrations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunAiSdkGenerateText.mockResolvedValue({ content: 'ok' })
  })

  it('resolves OpenAI-compatible providers through provider-db backed definitions', () => {
    const expectations = [
      ['nvidia', 'nvidia', 'microsoft/phi-4-mini-instruct'],
      ['huggingface', 'huggingface', 'Qwen/Qwen3-Coder-Next'],
      ['moonshot-ai', 'moonshot-ai', 'kimi-k2-0905-preview'],
      ['stepfun', 'stepfun', 'step-3.5-flash'],
      ['upstage', 'upstage', 'solar-mini'],
      ['alibaba-token-plan', 'alibaba-token-plan', 'deepseek-v4-flash'],
      ['alibaba-token-plan-cn', 'alibaba-token-plan-cn', 'deepseek-v4-flash']
    ] as const

    for (const [providerId, sourceId, checkModelId] of expectations) {
      expect(
        resolveAiSdkProviderDefinition(
          createProvider({
            id: providerId
          })
        )
      ).toMatchObject({
        runtimeKind: 'openai-compatible',
        modelSource: 'provider-db',
        providerDbSourceId: sourceId,
        checkStrategy: 'generate-text',
        credentialStrategy: 'api-key',
        checkModelId
      })
    }
  })

  it('resolves MiniMax global through the Anthropic-compatible runtime', () => {
    expect(
      resolveAiSdkProviderDefinition(
        createProvider({
          id: 'minimax-global',
          name: 'MiniMax Global',
          apiType: 'anthropic',
          baseUrl: 'https://api.minimax.io/anthropic/v1'
        })
      )
    ).toMatchObject({
      runtimeKind: 'anthropic',
      behaviorPreset: 'anthropic',
      modelSource: 'provider-db',
      providerDbSourceId: 'minimax',
      checkStrategy: 'generate-text',
      credentialStrategy: 'api-key',
      checkModelId: 'MiniMax-M2.1'
    })
  })

  it('maps provider DB metadata into built-in provider models', async () => {
    mockGetProvider.mockReturnValue({
      id: 'nvidia',
      name: 'NVIDIA',
      models: [
        {
          id: 'microsoft/phi-4-mini-instruct',
          display_name: 'Phi-4 Mini',
          tool_call: true,
          reasoning: {
            supported: false
          },
          modalities: {
            input: ['text'],
            output: ['text']
          },
          limit: {
            context: 131072,
            output: 8192
          }
        }
      ]
    })

    const provider = new AiSdkProvider(createProvider({}), createConfigPresenter())
    const models = await provider.fetchModels()

    expect(mockGetProvider).toHaveBeenCalledWith('nvidia')
    expect(models).toEqual([
      expect.objectContaining({
        id: 'microsoft/phi-4-mini-instruct',
        name: 'Phi-4 Mini',
        group: 'default',
        providerId: 'nvidia',
        functionCall: true,
        reasoning: false,
        contextLength: 131072,
        maxTokens: 8192
      })
    ])
  })

  it('uses the configured check model for MiniMax global', async () => {
    const provider = new AiSdkProvider(
      createProvider({
        id: 'minimax-global',
        name: 'MiniMax Global',
        apiType: 'anthropic',
        baseUrl: 'https://api.minimax.io/anthropic/v1'
      }),
      createConfigPresenter()
    )
    ;(provider as any).isInitialized = true

    await expect(provider.check()).resolves.toEqual({
      isOk: true,
      errorMsg: null
    })
    expect(mockRunAiSdkGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKind: 'anthropic',
        provider: expect.objectContaining({
          id: 'minimax-global',
          baseUrl: 'https://api.minimax.io/anthropic/v1'
        })
      }),
      [{ role: 'user', content: 'Hello' }],
      'MiniMax-M2.1',
      expect.any(Object),
      0.2,
      16
    )
  })
})
