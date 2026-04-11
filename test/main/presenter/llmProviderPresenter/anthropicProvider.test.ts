import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IConfigPresenter, LLM_PROVIDER } from '../../../../src/shared/presenter'
import { AnthropicProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/anthropicProvider'

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
    sendToRenderer: vi.fn()
  },
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
  }
}))

vi.mock('@/events', () => ({
  CONFIG_EVENTS: {
    MODEL_LIST_CHANGED: 'MODEL_LIST_CHANGED'
  }
}))

vi.mock('../../../../src/main/presenter/llmProviderPresenter/aiSdk', () => ({
  runAiSdkCoreStream: mockRunAiSdkCoreStream,
  runAiSdkGenerateText: mockRunAiSdkGenerateText
}))

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'anthropic',
  name: 'Anthropic',
  apiType: 'anthropic',
  apiKey: 'test-key',
  baseUrl: 'https://api.anthropic.com',
  enable: false,
  ...overrides
})

const createConfigPresenter = (): IConfigPresenter =>
  ({
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getDbProviderModels: vi.fn().mockReturnValue([
      {
        id: 'claude-sonnet-4-5-20250929',
        name: 'Claude Sonnet 4.5',
        group: 'Claude',
        contextLength: 200000,
        maxTokens: 64000,
        vision: true,
        functionCall: true,
        reasoning: true
      }
    ]),
    getModelConfig: vi.fn().mockReturnValue(undefined),
    setProviderModels: vi.fn(),
    getModelStatus: vi.fn().mockReturnValue(true)
  }) as unknown as IConfigPresenter

describe('AnthropicProvider', () => {
  const originalEnvKey = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    mockRunAiSdkGenerateText.mockResolvedValue({ content: 'ok' })
    delete process.env.ANTHROPIC_API_KEY
  })

  afterEach(() => {
    if (originalEnvKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY
      return
    }

    process.env.ANTHROPIC_API_KEY = originalEnvKey
  })

  it('fails fast when no Anthropic API key is available', async () => {
    const provider = new AnthropicProvider(
      createProvider({
        apiKey: ''
      }),
      createConfigPresenter()
    )

    await expect(provider.check()).resolves.toEqual({
      isOk: false,
      errorMsg: 'Missing API key'
    })
    expect(mockRunAiSdkGenerateText).not.toHaveBeenCalled()
  })

  it('uses the AI SDK runtime for provider health checks', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key'
    const provider = new AnthropicProvider(
      createProvider({
        apiKey: ''
      }),
      createConfigPresenter()
    )

    await expect(provider.check()).resolves.toEqual({
      isOk: true,
      errorMsg: null
    })
    expect(mockRunAiSdkGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKind: 'anthropic'
      }),
      [{ role: 'user', content: 'Hello' }],
      'claude-sonnet-4-5-20250929',
      undefined,
      0.2,
      16
    )
  })

  it('passes system prompts through the AI SDK text path', async () => {
    const provider = new AnthropicProvider(createProvider(), createConfigPresenter())

    await provider.generateText('hi', 'claude-sonnet-4-5-20250929', 0.2, 32, 'Real system prompt')

    expect(mockRunAiSdkGenerateText).toHaveBeenLastCalledWith(
      expect.objectContaining({
        providerKind: 'anthropic'
      }),
      [
        { role: 'system', content: 'Real system prompt' },
        { role: 'user', content: 'hi' }
      ],
      'claude-sonnet-4-5-20250929',
      undefined,
      0.2,
      32
    )
  })

  it('reads model metadata from the provider database snapshot', async () => {
    const provider = new AnthropicProvider(createProvider(), createConfigPresenter())
    const models = await (provider as any).fetchProviderModels()

    expect(models).toEqual([
      expect.objectContaining({
        id: 'claude-sonnet-4-5-20250929',
        providerId: 'anthropic',
        vision: true,
        functionCall: true,
        reasoning: true
      })
    ])
  })
})
