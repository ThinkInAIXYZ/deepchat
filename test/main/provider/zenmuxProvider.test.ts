import type { ProviderSettingsPort } from '@/provider/settings'
import type { LLM_PROVIDER } from '@shared/types/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
})
