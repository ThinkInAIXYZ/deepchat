import { resolveMediaSettingsCapabilities } from '@/provider/mediaCapabilities'
import type { ProviderSettingsPort } from '@/provider/settings'
import { ApiEndpointType, ModelType } from '@shared/model'
import type { LLM_PROVIDER, ModelConfig } from '@shared/types/provider'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PROVIDERS } from '../../../src/main/provider/defaults'
import { ProviderInstanceManager } from '../../../src/main/provider/managers/providerInstanceManager'
import { resolveAiSdkProviderDefinition } from '../../../src/main/provider/providerRegistry'
import { ApimartProvider } from '../../../src/main/provider/providers/apimartProvider'

const { mockCacheImage, mockFetchRemoteFile } = vi.hoisted(() => ({
  mockCacheImage: vi.fn(),
  mockFetchRemoteFile: vi.fn()
}))

vi.mock('@shared/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    silly: vi.fn(),
    log: vi.fn()
  }
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

vi.mock('../../../src/main/platform/imageCache', () => ({
  cacheImage: mockCacheImage,
  fetchRemoteFile: mockFetchRemoteFile
}))

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'apimart',
  name: 'APIMart',
  apiType: 'apimart',
  apiKey: 'test-key',
  baseUrl: 'https://api.apimart.ai/v1',
  enable: false,
  ...overrides
})

const createModelConfig = (overrides?: Partial<ModelConfig>): ModelConfig => ({
  maxTokens: 4096,
  contextLength: 8192,
  temperature: 0.7,
  vision: false,
  functionCall: false,
  reasoning: false,
  type: ModelType.Chat,
  apiEndpoint: ApiEndpointType.Chat,
  ...overrides
})

const createProviderSettings = (): ProviderSettingsPort =>
  ({
    getProviders: vi.fn().mockReturnValue([]),
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getProviderModelRouteMetadata: vi.fn().mockReturnValue(undefined),
    getModelConfig: vi.fn().mockReturnValue(createModelConfig()),
    getModelRouteConfig: vi.fn().mockReturnValue({ type: ModelType.Chat }),
    getSetting: vi.fn().mockReturnValue(undefined),
    getModelStatus: vi.fn().mockReturnValue(false),
    setProviderModels: vi.fn(),
    setModelConfig: vi.fn(),
    hasUserModelConfig: vi.fn().mockReturnValue(false)
  }) as unknown as ProviderSettingsPort

const createProviderInstance = (providerSettings = createProviderSettings()) =>
  new ApimartProvider(createProvider(), providerSettings, {
    getLanguage: vi.fn().mockReturnValue('en-US')
  })

const jsonResponse = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })

describe('ApimartProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCacheImage.mockResolvedValue('imgcache://apimart-output.png')
    mockFetchRemoteFile.mockResolvedValue({
      ok: true,
      status: 200,
      data: Buffer.from([1, 2, 3, 4]),
      mimeType: 'video/mp4'
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('registers the built-in profile and dedicated catalog strategy', () => {
    expect(DEFAULT_PROVIDERS).toContainEqual(
      expect.objectContaining({
        id: 'apimart',
        name: 'APIMart',
        apiType: 'apimart',
        baseUrl: 'https://api.apimart.ai/v1',
        enable: false,
        websites: expect.objectContaining({
          official: 'https://apimart.ai/zh',
          docs: 'https://docs.apimart.ai/cn',
          defaultBaseUrl: 'https://api.apimart.ai/v1'
        })
      })
    )
    expect(resolveAiSdkProviderDefinition(createProvider())).toMatchObject({
      runtimeKind: 'openai-compatible',
      modelSource: 'apimart',
      checkStrategy: 'fetch-models',
      credentialStrategy: 'api-key',
      routeStrategy: 'apimart',
      embeddingStrategy: 'openai'
    })

    const manager = new ProviderInstanceManager({
      providerSettings: createProviderSettings(),
      locale: { getLanguage: () => 'en-US' },
      agentSettings: {
        getAcpEnabled: vi.fn().mockReturnValue(false),
        getAcpAgents: vi.fn().mockReturnValue([])
      },
      activeStreams: new Map(),
      rateLimitManager: {} as never,
      getCurrentProviderId: () => null,
      setCurrentProviderId: vi.fn(),
      acpRuntimeOwner: {} as never,
      publishEvent: vi.fn()
    })
    expect(manager.createDraftInstance(createProvider())).toBeInstanceOf(ApimartProvider)
    expect(
      resolveMediaSettingsCapabilities('openai-compatible', 'image', {
        type: ModelType.ImageGeneration
      }).image
    ).toBe(true)
    expect(
      resolveMediaSettingsCapabilities('openai-compatible', 'video', {
        type: ModelType.VideoGeneration
      }).video
    ).toBe(true)
  })

  it('classifies the account-scoped expanded model catalog', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 'gpt-5',
            owned_by: 'openai',
            category: 'chat',
            capability_tags: ['Text', 'Vision'],
            supported_endpoint_types: ['openai']
          },
          {
            id: 'gpt-5.6-luna',
            owned_by: 'openai',
            category: 'chat',
            capability_tags: ['Text'],
            supported_endpoint_types: ['openai']
          },
          {
            id: 'claude-sonnet-4-6',
            owned_by: 'anthropic',
            category: 'chat',
            capability_tags: ['Text'],
            supported_endpoint_types: ['openai-response', 'anthropic']
          },
          {
            id: 'gemini-2.5-pro',
            owned_by: 'google',
            category: 'chat',
            capability_tags: ['Text'],
            supported_endpoint_types: ['openai', 'gemini']
          },
          {
            id: 'text-embedding-3-large',
            owned_by: 'openai',
            category: 'chat',
            capability_tags: ['Embedding']
          },
          {
            id: 'gpt-image-2',
            owned_by: 'openai',
            category: 'image',
            parameters: {
              operation: 'image_generation',
              endpoint: '/v1/images/generations',
              input_schema: { properties: { size: {}, quality: {} } }
            }
          },
          {
            id: 'wan2.7',
            owned_by: 'alibaba',
            category: 'video',
            parameters: {
              operation: 'video_generation',
              endpoint: '/v1/videos/generations'
            }
          },
          { id: 'tts-1', owned_by: 'openai', category: 'audio' },
          { id: 'whisper-1', owned_by: 'openai', category: 'audio' },
          { id: 'suno-v5', owned_by: 'suno', category: 'audio' },
          { id: 'omni-moderation-latest', owned_by: 'openai', category: 'unknown' }
        ]
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const models = await createProviderInstance().fetchModels({ suppressErrors: false })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.apimart.ai/v1/models?expand=parameters',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key'
        })
      })
    )
    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'gpt-5',
          type: ModelType.Chat,
          endpointType: 'openai-response',
          ownedBy: 'openai',
          vision: true
        }),
        expect.objectContaining({
          id: 'text-embedding-3-large',
          type: ModelType.Embedding,
          endpointType: 'openai'
        }),
        expect.objectContaining({
          id: 'gpt-5.6-luna',
          type: ModelType.Chat,
          endpointType: 'openai-response',
          supportedEndpointTypes: ['openai']
        }),
        expect.objectContaining({
          id: 'claude-sonnet-4-6',
          type: ModelType.Chat,
          endpointType: 'anthropic'
        }),
        expect.objectContaining({
          id: 'gemini-2.5-pro',
          type: ModelType.Chat,
          endpointType: 'gemini'
        }),
        expect.objectContaining({
          id: 'gpt-image-2',
          type: ModelType.ImageGeneration,
          endpointType: 'image-generation'
        }),
        expect.objectContaining({
          id: 'wan2.7',
          type: ModelType.VideoGeneration,
          endpointType: 'video-generation',
          ownedBy: 'alibaba'
        }),
        expect.objectContaining({ id: 'tts-1', type: ModelType.TTS }),
        expect.objectContaining({ id: 'whisper-1', type: ModelType.Chat })
      ])
    )
    expect(models.find((model) => model.id === 'gpt-image-2')?.mediaRoute).toEqual({
      endpoint: '/v1/images/generations',
      parameterNames: ['size', 'quality']
    })
    expect(models.map(({ id }) => id)).not.toContain('suno-v5')
    expect(models.map(({ id }) => id)).not.toContain('omni-moderation-latest')
  })

  it('rejects malformed model catalog envelopes without replacing cached models', async () => {
    const cachedModel = {
      id: 'cached-model',
      name: 'Cached model',
      group: 'Chat',
      providerId: 'apimart',
      type: ModelType.Chat,
      endpointType: 'openai' as const
    }
    const providerSettings = createProviderSettings()
    vi.mocked(providerSettings.getProviderModels).mockReturnValue([cachedModel])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: true, data: {} })))
    const provider = createProviderInstance(providerSettings)

    await expect(provider.fetchModels({ suppressErrors: false })).rejects.toThrow(
      'Invalid APIMart model catalog response'
    )
    expect(provider.getModels()).toContainEqual(cachedModel)
    expect(providerSettings.setProviderModels).not.toHaveBeenCalled()
  })
})
