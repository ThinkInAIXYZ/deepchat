import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IConfigPresenter, LLM_PROVIDER, ModelConfig } from '../../../../src/shared/presenter'
import {
  AiSdkProvider,
  normalizeExtractedImageText
} from '../../../../src/main/presenter/llmProviderPresenter/providers/aiSdkProvider'

const {
  mockGetProxyUrl,
  mockRunAiSdkCoreStream,
  mockRunAiSdkDimensions,
  mockRunAiSdkEmbeddings,
  mockRunAiSdkGenerateText
} = vi.hoisted(() => ({
  mockGetProxyUrl: vi.fn().mockReturnValue(null),
  mockRunAiSdkCoreStream: vi.fn(),
  mockRunAiSdkDimensions: vi.fn(),
  mockRunAiSdkEmbeddings: vi.fn(),
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
  },
  NOTIFICATION_EVENTS: {
    SHOW_ERROR: 'SHOW_ERROR'
  }
}))

vi.mock('../../../../src/main/presenter/proxyConfig', () => ({
  proxyConfig: {
    getProxyUrl: mockGetProxyUrl
  }
}))

vi.mock('../../../../src/main/presenter/llmProviderPresenter/aiSdk', () => ({
  runAiSdkCoreStream: mockRunAiSdkCoreStream,
  runAiSdkDimensions: mockRunAiSdkDimensions,
  runAiSdkEmbeddings: mockRunAiSdkEmbeddings,
  runAiSdkGenerateText: mockRunAiSdkGenerateText
}))

const createStream = (events: Array<Record<string, unknown>>) => ({
  async *[Symbol.asyncIterator]() {
    for (const event of events) {
      yield event
    }
  }
})

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'novita',
  name: 'Novita',
  apiType: 'openai-completions',
  apiKey: 'test-key',
  baseUrl: 'https://mock.example.com/v1',
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
    getModelStatus: vi.fn().mockReturnValue(true)
  }) as unknown as IConfigPresenter

describe('AiSdkProvider openai-compatible', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    mockGetProxyUrl.mockReturnValue(null)
    mockRunAiSdkCoreStream.mockReturnValue(
      createStream([
        { type: 'text', content: 'ok' },
        { type: 'stop', stop_reason: 'complete' }
      ])
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches models over the provider HTTP endpoint instead of the legacy SDK client', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ id: 'gpt-4o' }]
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new AiSdkProvider(createProvider(), createConfigPresenter())
    const models = await provider.fetchModels()

    expect(fetchMock).toHaveBeenCalledWith(
      'https://mock.example.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key'
        })
      })
    )
    expect(models).toEqual([
      expect.objectContaining({
        id: 'gpt-4o',
        providerId: 'novita'
      })
    ])
  })

  it('forwards streaming requests to the AI SDK runtime', async () => {
    const provider = new AiSdkProvider(createProvider(), createConfigPresenter())
    ;(provider as any).isInitialized = true

    const modelConfig: ModelConfig = {
      maxTokens: 1024,
      contextLength: 8192,
      vision: false,
      functionCall: true,
      reasoning: false,
      type: 'chat'
    }

    const events = []
    for await (const event of provider.coreStream(
      [{ role: 'user', content: 'hello' }],
      'gpt-4o',
      modelConfig,
      0.7,
      512,
      []
    )) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: 'text', content: 'ok' },
      { type: 'stop', stop_reason: 'complete' }
    ])
    expect(mockRunAiSdkCoreStream).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKind: 'openai-compatible'
      }),
      [{ role: 'user', content: 'hello' }],
      'gpt-4o',
      modelConfig,
      0.7,
      512,
      []
    )
  })

  it('builds azure runtime context with azure auth headers and image routing', async () => {
    const provider = new AiSdkProvider(
      createProvider({
        id: 'azure-openai',
        name: 'Azure OpenAI',
        apiType: 'openai-completions',
        baseUrl: 'https://example.openai.azure.com/openai/deployments/deepchat-prod'
      }),
      createConfigPresenter()
    )
    ;(provider as any).isInitialized = true

    const modelConfig = {
      apiEndpoint: 'image',
      maxTokens: 1024,
      contextLength: 8192,
      vision: false,
      functionCall: false,
      reasoning: false,
      type: 'chat'
    } as ModelConfig

    for await (const _event of provider.coreStream(
      [{ role: 'user', content: 'paint' }],
      'gpt-image-1',
      modelConfig,
      0.7,
      256,
      []
    )) {
      break
    }

    const context = mockRunAiSdkCoreStream.mock.calls.at(-1)?.[0]
    expect(context.providerKind).toBe('azure')
    expect(context.cleanHeaders).toBe(false)
    expect(context.buildTraceHeaders()).toMatchObject({
      'Content-Type': 'application/json',
      'api-key': 'test-key'
    })
    expect(context.shouldUseImageGeneration('gpt-image-1', modelConfig)).toBe(true)
    expect(context.shouldUseImageGeneration('gpt-image-1', {} as ModelConfig)).toBe(false)
  })
})

describe('normalizeExtractedImageText', () => {
  it('keeps meaningful text after markdown cleanup', () => {
    expect(normalizeExtractedImageText('  Here is the updated image.\n\n')).toBe(
      'Here is the updated image.'
    )
  })

  it('drops markdown residue that contains no semantic text', () => {
    expect(normalizeExtractedImageText('`\n')).toBe('')
    expect(normalizeExtractedImageText('[]()')).toBe('')
  })
})
