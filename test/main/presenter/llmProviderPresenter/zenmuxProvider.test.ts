import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IConfigPresenter, LLM_PROVIDER, MODEL_META } from '../../../../src/shared/presenter'
import { ZenmuxProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/zenmuxProvider'

vi.mock('electron', () => ({
  app: {
    getName: vi.fn(() => 'DeepChat'),
    getVersion: vi.fn(() => '0.0.0-test'),
    getPath: vi.fn(() => '/mock/path'),
    isReady: vi.fn(() => true),
    on: vi.fn()
  }
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
    getProxyUrl: vi.fn().mockReturnValue(null)
  }
}))

vi.mock('../../../../src/main/presenter/llmProviderPresenter/aiSdk', () => ({
  runAiSdkCoreStream: vi.fn(),
  runAiSdkDimensions: vi.fn(),
  runAiSdkEmbeddings: vi.fn(),
  runAiSdkGenerateText: vi.fn()
}))

const createConfigPresenter = (): IConfigPresenter =>
  ({
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getDbProviderModels: vi.fn().mockReturnValue([]),
    getModelConfig: vi.fn().mockReturnValue(undefined),
    getSetting: vi.fn().mockReturnValue(undefined),
    setProviderModels: vi.fn(),
    getModelStatus: vi.fn().mockReturnValue(true)
  }) as unknown as IConfigPresenter

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'zenmux',
  name: 'ZenMux',
  apiType: 'zenmux',
  apiKey: 'test-key',
  baseUrl: 'https://zenmux.ai/api/v1/',
  enable: false,
  ...overrides
})

describe('ZenmuxProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes anthropic models through the anthropic delegate', async () => {
    const provider = new ZenmuxProvider(createProvider(), createConfigPresenter())
    const anthropicDelegate = (provider as any).anthropicDelegate
    const openaiDelegate = (provider as any).openaiDelegate
    const anthropicSpy = vi
      .spyOn(anthropicDelegate, 'generateText')
      .mockResolvedValue({ content: 'anthropic-ok' })
    const openaiSpy = vi.spyOn(openaiDelegate, 'generateText')

    const result = await provider.generateText('hello', 'anthropic/claude-sonnet-4-5')

    expect(result.content).toBe('anthropic-ok')
    expect(anthropicSpy).toHaveBeenCalledWith(
      'hello',
      'anthropic/claude-sonnet-4-5',
      undefined,
      undefined
    )
    expect(openaiSpy).not.toHaveBeenCalled()
  })

  it('routes non-anthropic models through the openai-compatible delegate', async () => {
    const provider = new ZenmuxProvider(createProvider(), createConfigPresenter())
    const anthropicDelegate = (provider as any).anthropicDelegate
    const openaiDelegate = (provider as any).openaiDelegate
    const openaiSpy = vi
      .spyOn(openaiDelegate, 'generateText')
      .mockResolvedValue({ content: 'openai-ok' })
    const anthropicSpy = vi.spyOn(anthropicDelegate, 'generateText')

    const result = await provider.generateText('hello', 'moonshotai/kimi-k2.5')

    expect(result.content).toBe('openai-ok')
    expect(openaiSpy).toHaveBeenCalledWith('hello', 'moonshotai/kimi-k2.5', undefined, undefined)
    expect(anthropicSpy).not.toHaveBeenCalled()
  })

  it('fetches model metadata from the shared OpenAI-compatible path and keeps the ZenMux group', async () => {
    const provider = new ZenmuxProvider(createProvider(), createConfigPresenter())
    const openaiDelegate = (provider as any).openaiDelegate
    vi.spyOn(openaiDelegate, 'fetchZenmuxModels').mockResolvedValue([
      {
        id: 'moonshotai/kimi-k2.5',
        name: 'moonshotai/kimi-k2.5',
        group: 'default',
        providerId: 'zenmux',
        isCustom: false,
        contextLength: 64000,
        maxTokens: 8192
      }
    ] as MODEL_META[])

    const models = await provider.fetchModels()

    expect(models).toEqual([
      expect.objectContaining({
        id: 'moonshotai/kimi-k2.5',
        group: 'ZenMux',
        providerId: 'zenmux'
      })
    ])
  })

  it('keeps proxy refresh fan-out across both delegates', () => {
    const provider = new ZenmuxProvider(createProvider(), createConfigPresenter())
    const openaiProxySpy = vi.spyOn((provider as any).openaiDelegate, 'onProxyResolved')
    const anthropicProxySpy = vi.spyOn((provider as any).anthropicDelegate, 'onProxyResolved')

    provider.onProxyResolved()

    expect(openaiProxySpy).toHaveBeenCalledTimes(1)
    expect(anthropicProxySpy).toHaveBeenCalledTimes(1)
  })

  it('fails fast for embeddings on anthropic models', async () => {
    const provider = new ZenmuxProvider(createProvider(), createConfigPresenter())

    await expect(provider.getEmbeddings('anthropic/claude-sonnet-4-5', ['hello'])).rejects.toThrow(
      'Embeddings not supported for Anthropic models: anthropic/claude-sonnet-4-5'
    )
  })

  it('fails fast for embedding dimensions on anthropic models', async () => {
    const provider = new ZenmuxProvider(createProvider(), createConfigPresenter())

    await expect(provider.getDimensions('anthropic/claude-sonnet-4-5')).rejects.toThrow(
      'Embeddings not supported for Anthropic models: anthropic/claude-sonnet-4-5'
    )
  })
})
