import type { ProviderSettingsPort } from '@/provider/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLM_PROVIDER, ModelConfig } from '@shared/types/provider'
import { AiSdkProvider } from '../../../src/main/provider/providers/aiSdkProvider'

const { mockRunAiSdkCoreStream } = vi.hoisted(() => ({
  mockRunAiSdkCoreStream: vi.fn()
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
  runAiSdkDimensions: vi.fn(),
  runAiSdkEmbeddings: vi.fn(),
  runAiSdkGenerateText: vi.fn()
}))

const createProviderSettings = (): ProviderSettingsPort =>
  ({
    getProviders: vi.fn().mockReturnValue([]),
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getModelConfig: vi.fn().mockReturnValue(undefined),
    getSetting: vi.fn().mockReturnValue(undefined),
    setProviderModels: vi.fn(),
    getModelStatus: vi.fn().mockReturnValue(true)
  }) as unknown as ProviderSettingsPort

const createProvider = (): LLM_PROVIDER =>
  ({
    id: 'aihubmix',
    name: 'Aihubmix',
    apiType: 'openai-compatible',
    apiKey: 'test-key',
    baseUrl: 'https://aihubmix.com/v1',
    enable: false
  }) as LLM_PROVIDER

describe('AihubmixProvider AI SDK runtime headers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunAiSdkCoreStream.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'stop', stop_reason: 'complete' }
      }
    })
  })

  it('preserves the DeepChat APP-Code header in AI SDK mode', async () => {
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

    expect(context.defaultHeaders).toMatchObject({
      'APP-Code': 'SMUE7630',
      'X-Title': 'DeepChat'
    })
  })

  it('treats Seedance models as video generation even when metadata is still chat', async () => {
    const provider = new AiSdkProvider(createProvider(), createProviderSettings())
    ;(provider as any).isInitialized = true

    const modelConfig = {
      maxTokens: 1024,
      contextLength: 8192,
      vision: false,
      functionCall: false,
      reasoning: false,
      type: 'chat'
    } as ModelConfig

    for await (const _event of provider.coreStream(
      [{ role: 'user', content: '生成 马斯克 喝酒的视频 2s' }],
      'doubao-seedance-2-0-fast-260128',
      modelConfig,
      0.7,
      256,
      []
    )) {
      break
    }

    const context = mockRunAiSdkCoreStream.mock.calls.at(-1)?.[0]

    expect(context.providerKind).toBe('openai-compatible')
    expect(context.shouldUseVideoGeneration('doubao-seedance-2-0-fast-260128', modelConfig)).toBe(
      true
    )
    expect(context.shouldUseVideoGeneration('gpt-4o', { type: 'chat' } as ModelConfig)).toBe(false)
  })
})
