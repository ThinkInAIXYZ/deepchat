import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IConfigPresenter, LLM_PROVIDER } from '../../../../src/shared/presenter'
import { AiSdkProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/aiSdkProvider'

const { mockRunAiSdkCoreStream, mockRunAiSdkGenerateText } = vi.hoisted(() => ({
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

vi.mock('@/eventbus', () => ({
  eventBus: {
    on: vi.fn(),
    sendToRenderer: vi.fn()
  },
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
  }
}))

vi.mock('@/events', () => ({
  CONFIG_EVENTS: {
    MODEL_LIST_CHANGED: 'MODEL_LIST_CHANGED'
  },
  PROVIDER_DB_EVENTS: {
    LOADED: 'LOADED',
    UPDATED: 'UPDATED'
  }
}))

vi.mock('../../../../src/main/presenter/llmProviderPresenter/aiSdk', () => ({
  runAiSdkCoreStream: mockRunAiSdkCoreStream,
  runAiSdkGenerateText: mockRunAiSdkGenerateText
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

const createConfigPresenter = (): IConfigPresenter =>
  ({
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getDbProviderModels: vi.fn().mockReturnValue([
      {
        id: 'models/gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        group: 'default',
        contextLength: 1048576,
        maxTokens: 8192,
        vision: true,
        functionCall: true,
        reasoning: false
      }
    ]),
    getModelConfig: vi.fn().mockReturnValue(undefined),
    getSetting: vi.fn().mockReturnValue(undefined),
    setProviderModels: vi.fn(),
    getModelStatus: vi.fn().mockReturnValue(true)
  }) as unknown as IConfigPresenter

describe('AiSdkProvider gemini', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      createConfigPresenter()
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
        name: 'Gemini 2.5 Flash'
      })
    ])
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
      createConfigPresenter()
    )

    await expect(provider.refreshModels()).rejects.toThrow('API key not valid')
  })
})
