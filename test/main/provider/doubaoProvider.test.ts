import type { ProviderSettingsPort } from '@/provider/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLM_PROVIDER } from '@shared/types/provider'
import { AiSdkProvider } from '../../../src/main/provider/providers/aiSdkProvider'

const { mockGetProvider } = vi.hoisted(() => ({
  mockGetProvider: vi.fn()
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
  runAiSdkGenerateText: vi.fn()
}))

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'doubao',
  name: 'Doubao',
  apiType: 'doubao',
  apiKey: 'test-key',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
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
    getModelStatus: vi.fn().mockReturnValue(true)
  }) as unknown as ProviderSettingsPort

describe('AiSdkProvider doubao', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stores only doubao catalog identity in provider models', async () => {
    mockGetProvider.mockReturnValue({
      id: 'doubao',
      name: 'Doubao',
      models: [
        {
          id: 'doubao-seed-2.0-pro',
          display_name: 'Doubao-Seed 2.0 Pro',
          tool_call: true,
          reasoning: {
            supported: true
          },
          modalities: {
            input: ['text', 'image', 'video'],
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
        id: 'doubao-seed-2.0-pro',
        name: 'Doubao-Seed 2.0 Pro',
        group: 'default',
        providerId: 'doubao',
        isCustom: false
      }
    ])
  })
})
