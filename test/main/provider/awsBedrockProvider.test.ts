import type { ProviderSettingsPort } from '@/provider/settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AWS_BEDROCK_PROVIDER } from '@shared/types/provider'
import { AiSdkProvider } from '../../../src/main/provider/providers/aiSdkProvider'

const {
  mockBedrockClient,
  mockBedrockSend,
  mockGetProvider,
  mockRunAiSdkCoreStream,
  mockRunAiSdkGenerateText
} = vi.hoisted(() => ({
  mockBedrockClient: vi.fn(),
  mockBedrockSend: vi.fn(),
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

vi.mock('@aws-sdk/client-bedrock', () => ({
  BedrockClient: mockBedrockClient,
  ListFoundationModelsCommand: class ListFoundationModelsCommand {
    input: unknown

    constructor(input: unknown) {
      this.input = input
    }
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

const createProviderSettings = (): ProviderSettingsPort =>
  ({
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getModelConfig: vi.fn().mockReturnValue(undefined),
    getSetting: vi.fn().mockReturnValue(undefined),
    setProviderModels: vi.fn(),
    getModelStatus: vi.fn().mockReturnValue(true)
  }) as unknown as ProviderSettingsPort

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
    mockGetProvider.mockReturnValue({
      id: 'amazon-bedrock',
      name: 'Amazon Bedrock',
      models: [
        {
          id: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
          display_name: 'Claude 3.5 Sonnet',
          modalities: {
            input: ['text'],
            output: ['text']
          },
          limit: {
            context: 200000,
            output: 64000
          },
          tool_call: false,
          reasoning: {
            supported: false
          },
          type: 'chat'
        }
      ]
    })
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
      createProviderSettings()
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

    const provider = new AiSdkProvider(createProvider(), createProviderSettings())
    const models = await provider.fetchModels()

    expect(models).toEqual([
      expect.objectContaining({
        id: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        providerId: 'aws-bedrock'
      })
    ])
    expect(models[0]).not.toHaveProperty('contextLength')
    expect(models[0]).not.toHaveProperty('maxTokens')
    expect(models[0]).not.toHaveProperty('vision')
    expect(models[0]).not.toHaveProperty('functionCall')
    expect(models[0]).not.toHaveProperty('reasoning')
  })

  it('falls back to the provider DB snapshot when the Bedrock catalog lookup fails', async () => {
    mockBedrockSend.mockRejectedValue(new Error('catalog unavailable'))

    const provider = new AiSdkProvider(createProvider(), createProviderSettings())
    const models = await provider.fetchModels()

    expect(models).toEqual([
      expect.objectContaining({
        id: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        group: 'default'
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

    const provider = new AiSdkProvider(createProvider(), createProviderSettings())
    ;(provider as any).isInitialized = true

    await expect(provider.check()).resolves.toEqual({
      isOk: true,
      errorMsg: null
    })
    expect(mockBedrockSend).toHaveBeenCalledTimes(1)
    expect(mockRunAiSdkGenerateText).not.toHaveBeenCalled()
  })
})
