import type { ProviderSettingsPort } from '@/provider/settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLM_PROVIDER } from '@shared/types/provider'
import { AiSdkProvider } from '../../../src/main/provider/providers/aiSdkProvider'

const { mockGetProvider, mockRunAiSdkCoreStream, mockRunAiSdkGenerateText } = vi.hoisted(() => ({
  mockGetProvider: vi.fn(),
  mockRunAiSdkCoreStream: vi.fn(),
  mockRunAiSdkGenerateText: vi.fn().mockResolvedValue({ content: 'ok' })
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

vi.mock('../../../src/main/provider/aiSdk', () => ({
  runAiSdkCoreStream: mockRunAiSdkCoreStream,
  runAiSdkGenerateText: mockRunAiSdkGenerateText
}))

vi.mock('../../../src/main/provider/providerDbLoader', () => ({
  providerDbLoader: {
    subscribeCatalogChanges: vi.fn(),
    getDb: vi.fn().mockReturnValue(null),
    getProvider: mockGetProvider,
    getModel: vi.fn()
  }
}))

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'gemini',
  name: 'Gemini',
  apiType: 'gemini',
  apiKey: 'test-key',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
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

describe('AiSdkProvider gemini', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProvider.mockReturnValue({
      id: 'google',
      name: 'Google',
      models: [
        {
          id: 'models/gemini-2.0-flash',
          display_name: 'Gemini 2.0 Flash',
          modalities: {
            input: ['text', 'image'],
            output: ['text']
          },
          limit: {
            context: 1048576,
            output: 8192
          },
          tool_call: true,
          reasoning: {
            supported: false
          },
          type: 'chat'
        }
      ]
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches remote models for custom gemini-compatible providers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        models: [
          {
            name: 'models/gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            inputTokenLimit: 1048576,
            outputTokenLimit: 8192
          }
        ]
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new AiSdkProvider(
      createProvider({
        id: 'custom-gemini',
        name: 'Custom Gemini',
        custom: true,
        baseUrl: 'https://generativelanguage.googleapis.com/v1'
      }),
      createProviderSettings()
    )
    const models = await provider.fetchModels()

    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'x-goog-api-key': 'test-key'
        })
      })
    )
    expect(models).toEqual([
      expect.objectContaining({
        id: 'models/gemini-2.5-flash',
        providerId: 'custom-gemini',
        name: 'Gemini 2.5 Flash',
        contextLength: 1048576,
        maxTokens: 8192
      })
    ])
    expect(models[0]).not.toHaveProperty('vision')
    expect(models[0]).not.toHaveProperty('functionCall')
    expect(models[0]).not.toHaveProperty('reasoning')
  })

  it('throws refresh errors for custom gemini-compatible providers when remote fetch fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      text: vi.fn().mockResolvedValue('{"error":{"message":"API key not valid"}}')
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new AiSdkProvider(
      createProvider({
        id: 'custom-gemini',
        name: 'Custom Gemini',
        custom: true
      }),
      createProviderSettings()
    )

    await expect(provider.refreshModels()).rejects.toThrow('API key not valid')
  })
})
