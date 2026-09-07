import type { ProviderSettingsPort } from '@/provider/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLM_PROVIDER } from '@shared/types/provider'
import { AiSdkProvider } from '../../../src/main/provider/providers/aiSdkProvider'
import { resolveAiSdkProviderDefinition } from '../../../src/main/provider/providerRegistry'

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

vi.mock('../../../src/main/platform/proxy', () => ({
  proxyConfig: {
    getProxyUrl: vi.fn().mockReturnValue(null)
  }
}))

vi.mock('../../../src/main/provider/providerDbLoader', () => ({
  providerDbLoader: {
    subscribeCatalogChanges: vi.fn(),
    getDb: vi.fn().mockReturnValue(null),
    getProvider: mockGetProvider,
    getModel: vi.fn()
  }
}))

vi.mock('../../../src/main/provider/aiSdk', () => ({
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

const createProviderSettings = (): ProviderSettingsPort =>
  ({
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getModelConfig: vi.fn().mockReturnValue(undefined),
    getSetting: vi.fn().mockReturnValue(undefined),
    setProviderModels: vi.fn(),
    getModelStatus: vi.fn().mockReturnValue(true),
    setModelConfig: vi.fn(),
    hasUserModelConfig: vi.fn().mockReturnValue(false)
  }) as unknown as ProviderSettingsPort

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

  it('maps Mistral catalog identities without duplicating capability state', async () => {
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

    const provider = new AiSdkProvider(createProvider(), createProviderSettings())
    const models = await provider.fetchModels()

    expect(models).toEqual([
      {
        id: 'mistral-small-latest',
        name: 'Mistral Small',
        group: 'default',
        providerId: 'mistral',
        isCustom: false
      }
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
      createProviderSettings()
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
      createProviderSettings()
    )

    await expect(provider.check()).resolves.toEqual({
      isOk: false,
      errorMsg: 'Missing API key'
    })
    expect(mockRunAiSdkGenerateText).not.toHaveBeenCalled()
  })

  it('verifies Mistral with a small generate-text request', async () => {
    const provider = new AiSdkProvider(createProvider(), createProviderSettings())
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
