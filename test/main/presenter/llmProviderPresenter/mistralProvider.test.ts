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
  id: 'mistral',
  name: 'Mistral',
  apiType: 'mistral',
  apiKey: 'test-key',
  baseUrl: 'https://api.mistral.ai/v1',
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

describe('AiSdkProvider mistral', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunAiSdkGenerateText.mockResolvedValue({ content: 'ok' })
  })

  it('resolves Mistral by id and by custom provider apiType', () => {
    expect(resolveAiSdkProviderDefinition(createProvider())).toMatchObject({
      runtimeKind: 'openai-compatible',
      modelSource: 'provider-db',
      providerDbSourceId: 'mistral',
      checkStrategy: 'generate-text',
      credentialStrategy: 'api-key',
      checkModelId: 'mistral-small-latest'
    })

    expect(
      resolveAiSdkProviderDefinition(
        createProvider({
          id: 'custom-mistral',
          apiType: 'mistral'
        })
      )
    ).toMatchObject({
      runtimeKind: 'openai-compatible',
      modelSource: 'provider-db'
    })
  })

  it('maps Mistral provider DB metadata into provider models', async () => {
    mockGetProvider.mockReturnValue({
      id: 'mistral',
      name: 'Mistral',
      models: [
        {
          id: 'mistral-small-latest',
          display_name: 'Mistral Small',
          tool_call: true,
          reasoning: {
            supported: true
          },
          modalities: {
            input: ['text', 'image'],
            output: ['text']
          },
          limit: {
            context: 256000,
            output: 64000
          }
        }
      ]
    })

    const provider = new AiSdkProvider(createProvider(), createConfigPresenter())
    const models = await provider.fetchModels()

    expect(models).toEqual([
      expect.objectContaining({
        id: 'mistral-small-latest',
        name: 'Mistral Small',
        group: 'default',
        providerId: 'mistral',
        vision: true,
        functionCall: true,
        reasoning: true,
        contextLength: 256000,
        maxTokens: 32000
      })
    ])
  })

  it('uses Mistral provider DB metadata for custom Mistral providers', async () => {
    mockGetProvider.mockReturnValue({
      id: 'mistral',
      name: 'Mistral',
      models: [
        {
          id: 'mistral-large-latest',
          display_name: 'Mistral Large'
        }
      ]
    })

    const provider = new AiSdkProvider(
      createProvider({
        id: 'custom-mistral',
        apiType: 'mistral',
        custom: true
      }),
      createConfigPresenter()
    )
    const models = await provider.fetchModels()

    expect(mockGetProvider).toHaveBeenCalledWith('mistral')
    expect(models).toEqual([
      expect.objectContaining({
        id: 'mistral-large-latest',
        providerId: 'custom-mistral'
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

  it('verifies Mistral with a small generate-text request', async () => {
    const provider = new AiSdkProvider(createProvider(), createConfigPresenter())
    ;(provider as any).isInitialized = true

    await expect(provider.check()).resolves.toEqual({
      isOk: true,
      errorMsg: null
    })
    expect(mockRunAiSdkGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKind: 'openai-compatible',
        provider: expect.objectContaining({
          id: 'mistral',
          baseUrl: 'https://api.mistral.ai/v1'
        })
      }),
      [{ role: 'user', content: 'Hello' }],
      'mistral-small-latest',
      expect.any(Object),
      0.2,
      16
    )
  })
})
