import type { ProviderSettingsPort } from '@/provider/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLM_PROVIDER, ModelConfig } from '@shared/types/provider'
import { AiSdkProvider } from '../../../src/main/provider/providers/aiSdkProvider'

const {
  mockRunAiSdkCoreStream,
  mockRunAiSdkDimensions,
  mockRunAiSdkEmbeddings,
  mockRunAiSdkGenerateText
} = vi.hoisted(() => ({
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

vi.mock('../../../src/main/platform/proxy', () => ({
  proxyConfig: {
    getProxyUrl: vi.fn().mockReturnValue(null)
  }
}))

vi.mock('../../../src/main/provider/aiSdk', () => ({
  runAiSdkCoreStream: mockRunAiSdkCoreStream,
  runAiSdkDimensions: mockRunAiSdkDimensions,
  runAiSdkEmbeddings: mockRunAiSdkEmbeddings,
  runAiSdkGenerateText: mockRunAiSdkGenerateText
}))

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'openai',
  name: 'OpenAI',
  apiType: 'openai-responses',
  apiKey: 'test-key',
  baseUrl: 'https://api.openai.com/v1',
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

describe('OpenAIResponsesProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunAiSdkCoreStream.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'stop', stop_reason: 'complete' }
      }
    })
  })

  it('uses the responses runtime for official OpenAI providers', async () => {
    const provider = new AiSdkProvider(createProvider(), createProviderSettings())
    ;(provider as any).isInitialized = true

    for await (const _event of provider.coreStream(
      [{ role: 'user', content: 'hello' }],
      'gpt-4o',
      {
        maxTokens: 1024,
        contextLength: 8192,
        vision: false,
        functionCall: false,
        reasoning: false,
        type: 'chat'
      } as ModelConfig,
      0.7,
      256,
      []
    )) {
      break
    }

    const context = mockRunAiSdkCoreStream.mock.calls.at(-1)?.[0]

    expect(context.providerKind).toBe('openai-responses')
    expect(context.shouldUseImageGeneration('gpt-image-1', {} as ModelConfig)).toBe(true)
    expect(
      context.shouldUseImageGeneration('custom-image-model', {
        type: 'imageGeneration'
      } as ModelConfig)
    ).toBe(true)
    expect(context.shouldUseImageGeneration('gpt-4o', {} as ModelConfig)).toBe(false)
  })

  it('uses azure runtime semantics for azure-openai responses providers', async () => {
    const provider = new AiSdkProvider(
      createProvider({
        id: 'azure-openai',
        name: 'Azure OpenAI',
        baseUrl: 'https://example.openai.azure.com/openai'
      }),
      createProviderSettings()
    )
    ;(provider as any).isInitialized = true

    for await (const _event of provider.coreStream(
      [{ role: 'user', content: 'paint' }],
      'gpt-image-1',
      {
        apiEndpoint: 'image',
        maxTokens: 1024,
        contextLength: 8192,
        vision: false,
        functionCall: false,
        reasoning: false,
        type: 'chat'
      } as ModelConfig,
      0.7,
      256,
      []
    )) {
      break
    }

    const context = mockRunAiSdkCoreStream.mock.calls.at(-1)?.[0]

    expect(context.providerKind).toBe('azure')
    expect(context.buildTraceHeaders()).toMatchObject({
      'Content-Type': 'application/json',
      'api-key': 'test-key'
    })
    expect(
      context.shouldUseImageGeneration('gpt-image-1', {
        apiEndpoint: 'image'
      } as ModelConfig)
    ).toBe(true)
    expect(
      context.shouldUseImageGeneration('custom-image-model', {
        type: 'imageGeneration'
      } as ModelConfig)
    ).toBe(false)
    expect(context.shouldUseImageGeneration('gpt-image-1', {} as ModelConfig)).toBe(false)
  })

  it('submits audio transcriptions to the OpenAI audio endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ text: 'transcribed text' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new AiSdkProvider(createProvider(), createProviderSettings())
    ;(provider as any).isInitialized = true

    const text = await provider.transcribeAudio('gpt-4o-mini-transcribe', 'AQID', 'audio/wav')

    expect(text).toBe('transcribed text')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key'
        })
      })
    )
  })

  it('surfaces official OpenAI audio transcription errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('openai transcription failed')
      })
    )

    const provider = new AiSdkProvider(createProvider(), createProviderSettings())
    ;(provider as any).isInitialized = true

    await expect(
      provider.transcribeAudio('gpt-4o-mini-transcribe', 'AQID', 'audio/wav')
    ).rejects.toThrow('openai transcription failed')
  })
})
