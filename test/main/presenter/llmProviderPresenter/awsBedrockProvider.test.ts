import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AWS_BEDROCK_PROVIDER, IConfigPresenter } from '../../../../src/shared/presenter'
import { AwsBedrockProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/awsBedrockProvider'

const { mockBedrockSend, mockRunAiSdkCoreStream, mockRunAiSdkGenerateText } = vi.hoisted(() => ({
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

vi.mock('@aws-sdk/client-bedrock', () => ({
  BedrockClient: vi.fn().mockImplementation(() => ({
    config: {
      region: vi.fn().mockResolvedValue('us-east-1')
    },
    send: mockBedrockSend
  })),
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

describe('AwsBedrockProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunAiSdkGenerateText.mockResolvedValue({ content: 'ok' })
  })

  it('fails fast when credentials are missing', async () => {
    const provider = new AwsBedrockProvider(
      createProvider({
        credential: undefined
      }),
      createConfigPresenter()
    )

    await expect(provider.check()).resolves.toEqual({
      isOk: false,
      errorMsg: 'Missing AWS Bedrock credentials'
    })
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

    const provider = new AwsBedrockProvider(createProvider(), createConfigPresenter())
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

    const provider = new AwsBedrockProvider(createProvider(), createConfigPresenter())
    const models = await provider.fetchModels()

    expect(models).toEqual([
      expect.objectContaining({
        id: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        group: 'Bedrock Claude'
      })
    ])
  })

  it('uses the AI SDK runtime for health checks', async () => {
    const provider = new AwsBedrockProvider(createProvider(), createConfigPresenter())

    await expect(provider.check()).resolves.toEqual({
      isOk: true,
      errorMsg: null
    })
    expect(mockRunAiSdkGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKind: 'aws-bedrock'
      }),
      [{ role: 'user', content: 'Hi' }],
      'anthropic.claude-3-5-sonnet-20240620-v1:0',
      undefined,
      0.2,
      16
    )
  })
})
