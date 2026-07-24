import type { ProviderSettingsPort } from '@/provider/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLM_PROVIDER } from '@shared/types/provider'
import { AiSdkProvider } from '../../../src/main/provider/providers/aiSdkProvider'

vi.mock('electron', () => ({
  app: {
    getName: vi.fn(() => 'DeepChat'),
    getVersion: vi.fn(() => '0.0.0-test'),
    getPath: vi.fn(() => '/mock/path'),
    isReady: vi.fn(() => true),
    on: vi.fn()
  }
}))

vi.mock('../../../src/main/platform/proxy', () => ({
  proxyConfig: {
    getProxyUrl: vi.fn().mockReturnValue(null)
  }
}))

vi.mock('../../../src/main/provider/aiSdk', () => ({
  runAiSdkCoreStream: vi.fn(),
  runAiSdkDimensions: vi.fn(),
  runAiSdkEmbeddings: vi.fn(),
  runAiSdkGenerateText: vi.fn()
}))

const createProviderSettings = (): ProviderSettingsPort =>
  ({
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getDbProviderModels: vi.fn().mockReturnValue([]),
    getModelConfig: vi.fn().mockReturnValue(undefined),
    getSetting: vi.fn().mockReturnValue(undefined),
    setProviderModels: vi.fn(),
    getModelStatus: vi.fn().mockReturnValue(true)
  }) as unknown as ProviderSettingsPort

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'zenmux',
  name: 'ZenMux',
  apiType: 'zenmux',
  apiKey: 'test-key',
  baseUrl: 'https://zenmux.ai/api/v1/',
  enable: false,
  ...overrides
})

describe('AiSdkProvider zenmux', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes anthropic models through the cache-aware OpenAI-compatible runtime', async () => {
    const provider = new AiSdkProvider(createProvider(), createProviderSettings())
    const routeDecision = (provider as any).resolveRouteDecision('anthropic/claude-sonnet-4-5')
    const runtimeProvider = (provider as any).getRuntimeProvider(routeDecision) as LLM_PROVIDER

    expect(routeDecision.providerKind).toBe('openai-compatible')
    expect(runtimeProvider.baseUrl).toBe('https://zenmux.ai/api/v1/')
    expect(runtimeProvider.capabilityProviderId).toBe('anthropic')
  })

  it('routes non-anthropic models through the openai-compatible runtime', async () => {
    const provider = new AiSdkProvider(createProvider(), createProviderSettings())
    const routeDecision = (provider as any).resolveRouteDecision('moonshotai/kimi-k2.5')

    expect(routeDecision.providerKind).toBe('openai-compatible')
  })

  it('fetches model metadata from the shared OpenAI-compatible path and keeps the ZenMux group', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ id: 'moonshotai/kimi-k2.5' }]
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const provider = new AiSdkProvider(createProvider(), createProviderSettings())

    const models = await provider.fetchModels()

    expect(models).toEqual([
      expect.objectContaining({
        id: 'moonshotai/kimi-k2.5',
        group: 'ZenMux',
        providerId: 'zenmux'
      })
    ])
  })

  it('fails fast for embeddings on anthropic models', async () => {
    const provider = new AiSdkProvider(createProvider(), createProviderSettings())

    await expect(provider.getEmbeddings('anthropic/claude-sonnet-4-5', ['hello'])).rejects.toThrow(
      'Embeddings not supported for Anthropic models: anthropic/claude-sonnet-4-5'
    )
  })

  it('fails fast for embedding dimensions on anthropic models', async () => {
    const provider = new AiSdkProvider(createProvider(), createProviderSettings())

    await expect(provider.getDimensions('anthropic/claude-sonnet-4-5')).rejects.toThrow(
      'Embeddings not supported for Anthropic models: anthropic/claude-sonnet-4-5'
    )
  })
})
