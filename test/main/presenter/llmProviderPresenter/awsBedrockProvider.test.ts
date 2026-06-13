import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AWS_BEDROCK_PROVIDER, IConfigPresenter } from '../../../../src/shared/presenter'
import { AiSdkProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/aiSdkProvider'

const { mockBedrockClient, mockBedrockSend, mockRunAiSdkCoreStream, mockRunAiSdkGenerateText } =
  vi.hoisted(() => ({
    mockBedrockClient: vi.fn(),
    mockBedrockSend: vi.fn(),
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
    on: vi.fn()
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

vi.mock('@aws-sdk/client-bedrock', () => ({
  BedrockClient: mockBedrockClient,
  ListFoundationModelsCommand: class ListFoundationModelsCommand {
    input: unknown

    constructor(input: unknown) {
      this.input = input
    }
  }
}))

vi.mock('../../../../src/main/presenter/llmProviderPresenter/aiSdk', () => ({
  runAiSdkCoreStream: mockRunAiSdkCoreStream,
  runAiSdkGenerateText: mockRunAiSdkGenerateText
}))

const createConfigPresenter = (): IConfigPresenter =>
  ({
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getDbProviderModels: vi.fn().mockReturnValue([
      {
        id: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        name: 'Claude 3.5 Sonnet',
        group: 'Bedrock Claude',
        contextLength: 200000,
        maxTokens: 64000,
        vision: false,
        functionCall: false,
        reasoning: false
      }
    ]),
    getModelConfig: vi.fn().mockReturnValue(undefined),
    getSetting: vi.fn().mockReturnValue(undefined),
    setProviderModels: vi.fn(),
    getModelStatus: vi.fn().mockReturnValue(true)
  }) as unknown as IConfigPresenter

const createProvider = (overrides?: Partial<AWS_BEDROCK_PROVIDER>): AWS_BEDROCK_PROVIDER => ({
  id: 'aws-bedrock',
  name: 'AWS Bedrock',
  apiType: 'aws-bedrock',
  enable: false,
  credential: {
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret',
    region: 'us-east-1'
  },
  ...overrides
})

describe('AiSdkProvider aws-bedrock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBedrockClient.mockImplementation(() => ({
      config: {
        region: vi.fn().mockResolvedValue('us-east-1')
      },
      send: mockBedrockSend
    }))
    mockRunAiSdkGenerateText.mockResolvedValue({ content: 'ok' })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses the provider DB fallback when credentials are missing', async () => {
    vi.stubEnv('AWS_ACCESS_KEY_ID', '')
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', '')
    vi.stubEnv('AWS_REGION', '')

    const provider = new AiSdkProvider(
      createProvider({
        credential: undefined
      }),
      createConfigPresenter()
    )

    await expect(provider.check()).resolves.toEqual({ isOk: true, errorMsg: null })
    expect(mockBedrockSend).not.toHaveBeenCalled()
    expect(mockRunAiSdkGenerateText).not.toHaveBeenCalled()
  })

  it('maps active Claude models from the Bedrock catalog', async () => {
    mockBedrockSend.mockResolvedValue({
      modelSummaries: [
        {
          modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
          modelLifecycle: { status: 'ACTIVE' },
          inferenceTypesSupported: ['ON_DEMAND']
        }
      ]
    })

    const provider = new AiSdkProvider(createProvider(), createConfigPresenter())
    const models = await provider.fetchModels()

    expect(models).toEqual([
      expect.objectContaining({
        id: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        providerId: 'aws-bedrock'
      })
    ])
  })

  it('falls back to the provider DB snapshot when the Bedrock catalog lookup fails', async () => {
    mockBedrockSend.mockRejectedValue(new Error('catalog unavailable'))

    const provider = new AiSdkProvider(createProvider(), createConfigPresenter())
    const models = await provider.fetchModels()

    expect(models).toEqual([
      expect.objectContaining({
        id: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        group: 'Bedrock Claude'
      })
    ])
  })

  it('uses the Bedrock catalog for health checks', async () => {
    mockBedrockSend.mockResolvedValue({
      modelSummaries: [
        {
          modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
          modelLifecycle: { status: 'ACTIVE' },
          inferenceTypesSupported: ['ON_DEMAND']
        }
      ]
    })

    const provider = new AiSdkProvider(createProvider(), createConfigPresenter())
    ;(provider as any).isInitialized = true

    await expect(provider.check()).resolves.toEqual({
      isOk: true,
      errorMsg: null
    })
    expect(mockBedrockSend).toHaveBeenCalledTimes(1)
    expect(mockRunAiSdkGenerateText).not.toHaveBeenCalled()
  })
})
