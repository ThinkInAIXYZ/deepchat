import type { ProviderSettingsPort } from '@/provider/settings'
import type { LLM_PROVIDER, ModelConfig } from '@shared/types/provider'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { modelCapabilities } from '../../../src/main/provider/modelCapabilities'
import { AiSdkProvider } from '../../../src/main/provider/providers/aiSdkProvider'
import { ApiEndpointType, ModelType } from '../../../src/shared/model'

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

const createProvider = (overrides?: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'new-api',
  name: 'New API',
  apiType: 'new-api',
  apiKey: 'test-key',
  baseUrl: 'https://www.newapi.ai',
  enable: false,
  models: [],
  customModels: [],
  enabledModels: [],
  disabledModels: [],
  ...overrides
})

const createProviderSettings = (
  modelConfigById: Record<string, Partial<ModelConfig>> = {},
  providerModelsByProviderId: Record<string, unknown[]> = {}
): ProviderSettingsPort =>
  ({
    getProviders: vi.fn().mockReturnValue([]),
    getProviderModels: vi.fn((providerId: string) => providerModelsByProviderId[providerId] ?? []),
    getProviderModelRouteMetadata: vi.fn((providerId: string, modelId: string) => {
      const model = providerModelsByProviderId[providerId]?.find(
        (candidate: any) => candidate.id === modelId
      ) as any
      return model
        ? {
            endpointType: model.endpointType,
            supportedEndpointTypes: model.supportedEndpointTypes,
            type: model.type,
            ownedBy: model.ownedBy
          }
        : undefined
    }),
    getCustomModels: vi.fn().mockReturnValue([]),
    getDbProviderModels: vi.fn().mockReturnValue([]),
    getModelConfig: vi.fn((modelId: string) => ({
      type: ModelType.Chat,
      apiEndpoint: ApiEndpointType.Chat,
      ...modelConfigById[modelId]
    })),
    getModelRouteConfig: vi.fn((modelId: string) => ({
      type: ModelType.Chat,
      apiEndpoint: ApiEndpointType.Chat,
      ...modelConfigById[modelId]
    })),
    getSetting: vi.fn().mockReturnValue(undefined),
    getModelStatus: vi.fn().mockReturnValue(false),
    setProviderModels: vi.fn(),
    hasUserModelConfig: vi.fn().mockReturnValue(false),
    setModelConfig: vi.fn()
  }) as unknown as ProviderSettingsPort

describe('NewApiProvider capability routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('stores New API response facts without duplicating catalog capabilities', async () => {
    const capabilityModel = {
      id: 'anthropic/claude-opus-4.8',
      modalities: {
        input: ['text', 'image'],
        output: ['text']
      },
      tool_call: true,
      extra_capabilities: {
        reasoning: {
          supported: true,
          default_enabled: false,
          mode: 'effort',
          effort: 'high'
        }
      }
    } as any
    const capabilityMatchSpy = vi
      .spyOn(modelCapabilities, 'getProviderCapabilityModelMatch')
      .mockImplementation((providerId, modelId) =>
        providerId === 'anthropic' && modelId === 'claude-opus-4-8'
          ? {
              providerId: 'anthropic',
              modelId: 'claude-opus-4-8',
              model: capabilityModel
            }
          : undefined
      )
    const catalogSnapshotSpy = vi
      .spyOn(modelCapabilities, 'getCatalogCapabilitySnapshot')
      .mockReturnValue({
        modelMatched: true,
        reasoningPortrait: {
          supported: true,
          defaultEnabled: false,
          mode: 'effort',
          effort: 'high'
        },
        supportsReasoning: true,
        thinkingBudgetRange: {},
        supportsSearch: false,
        searchDefaults: {},
        temperatureCapability: undefined,
        supportsAudioInput: false,
        supportsReasoningEffort: true,
        reasoningEffortDefault: 'high',
        supportsVerbosity: false,
        verbosityDefault: undefined
      })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'claude-opus-4-8',
            name: 'Claude Opus 4.8',
            owned_by: 'anthropic',
            supported_endpoint_types: ['openai-response', 'anthropic'],
            type: 'chat',
            context_length: 200000,
            max_output_tokens: 32000
          }
        ]
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const providerSettings = createProviderSettings()
    const provider = new AiSdkProvider(createProvider(), providerSettings)

    const models = await (provider as any).fetchProviderModels()

    expect(models).toEqual([
      expect.objectContaining({
        id: 'claude-opus-4-8',
        name: 'Claude Opus 4.8',
        group: 'anthropic',
        providerId: 'new-api',
        ownedBy: 'anthropic',
        supportedEndpointTypes: ['openai-response', 'anthropic'],
        endpointType: 'anthropic',
        contextLength: 200000,
        maxTokens: 32000
      })
    ])
    expect(models[0]).not.toHaveProperty('vision')
    expect(models[0]).not.toHaveProperty('functionCall')
    expect(models[0]).not.toHaveProperty('reasoning')
    expect(capabilityMatchSpy).not.toHaveBeenCalled()
    expect(catalogSnapshotSpy).not.toHaveBeenCalled()
    expect(providerSettings.setModelConfig).not.toHaveBeenCalled()
  })

  it('infers anthropic for Claude-owned models with empty supported endpoint types', async () => {
    vi.spyOn(modelCapabilities, 'findCapabilityModelMatch').mockReturnValue({
      providerId: 'anthropic',
      modelId: 'claude-opus-4-8',
      model: {
        id: 'claude-opus-4-8'
      } as any
    })
    vi.spyOn(modelCapabilities, 'supportsReasoning').mockReturnValue(true)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'claude-opus-4-8',
              object: 'model',
              owned_by: 'claude',
              supported_endpoint_types: []
            }
          ]
        })
      })
    )

    const providerSettings = createProviderSettings()
    const provider = new AiSdkProvider(createProvider(), providerSettings)
    const models = await (provider as any).fetchProviderModels()

    expect(models[0]).toMatchObject({
      id: 'claude-opus-4-8',
      endpointType: 'anthropic',
      ownedBy: 'claude'
    })
    expect(providerSettings.setModelConfig).not.toHaveBeenCalled()
  })

  it('infers gemini for Google-owned models with empty supported endpoint types', async () => {
    vi.spyOn(modelCapabilities, 'findCapabilityModelMatch').mockReturnValue({
      providerId: 'google',
      modelId: 'gemini-3.5-flash',
      model: {
        id: 'gemini-3.5-flash'
      } as any
    })
    vi.spyOn(modelCapabilities, 'supportsReasoning').mockReturnValue(false)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'gemini-3.5-flash',
              object: 'model',
              owned_by: 'google gemini',
              supported_endpoint_types: []
            }
          ]
        })
      })
    )

    const providerSettings = createProviderSettings()
    const provider = new AiSdkProvider(createProvider(), providerSettings)
    const models = await (provider as any).fetchProviderModels()

    expect(models[0]).toMatchObject({
      id: 'gemini-3.5-flash',
      endpointType: 'gemini',
      ownedBy: 'google gemini'
    })
    expect(providerSettings.setModelConfig).not.toHaveBeenCalled()
  })

  it('classifies explicit media models from endpoint metadata', async () => {
    vi.spyOn(modelCapabilities, 'findCapabilityModelMatch').mockReturnValue(undefined)
    vi.spyOn(modelCapabilities, 'supportsReasoning').mockReturnValue(false)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'gpt-image-2',
              object: 'model',
              owned_by: 'openai',
              supported_endpoint_types: ['openai', 'image-generation'],
              type: 'image'
            },
            {
              id: 'sora-3',
              object: 'model',
              owned_by: 'openai',
              supported_endpoint_types: ['openai', 'video-generation'],
              type: 'video'
            }
          ]
        })
      })
    )

    const provider = new AiSdkProvider(createProvider(), createProviderSettings())
    const models = await (provider as any).fetchProviderModels()

    expect(models[0]).toMatchObject({
      id: 'gpt-image-2',
      type: ModelType.ImageGeneration,
      endpointType: 'image-generation'
    })
    expect(models[1]).toMatchObject({
      id: 'sora-3',
      type: ModelType.VideoGeneration,
      endpointType: 'video-generation'
    })
  })

  it('classifies openai-only non-chat models', async () => {
    vi.spyOn(modelCapabilities, 'findCapabilityModelMatch').mockReturnValue(undefined)
    vi.spyOn(modelCapabilities, 'supportsReasoning').mockReturnValue(false)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'text-embedding-3-large',
              object: 'model',
              owned_by: 'openai',
              supported_endpoint_types: ['openai'],
              type: 'embedding'
            }
          ]
        })
      })
    )

    const provider = new AiSdkProvider(createProvider(), createProviderSettings())
    const models = await (provider as any).fetchProviderModels()

    expect(models[0]).toMatchObject({
      id: 'text-embedding-3-large',
      type: ModelType.Embedding,
      supportedEndpointTypes: ['openai'],
      endpointType: 'openai'
    })
  })

  it('classifies openai-only GPT models without an explicit chat type', async () => {
    vi.spyOn(modelCapabilities, 'findCapabilityModelMatch').mockReturnValue(undefined)
    vi.spyOn(modelCapabilities, 'supportsReasoning').mockReturnValue(false)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'gpt-5.5',
              object: 'model',
              owned_by: 'openai',
              supported_endpoint_types: ['openai']
            }
          ]
        })
      })
    )

    const provider = new AiSdkProvider(createProvider(), createProviderSettings())
    const models = await (provider as any).fetchProviderModels()

    expect(models[0]).toMatchObject({
      id: 'gpt-5.5',
      supportedEndpointTypes: ['openai'],
      endpointType: 'openai'
    })
  })

  it('classifies openai-only audio models without persisting UI projection', async () => {
    vi.spyOn(modelCapabilities, 'findCapabilityModelMatch').mockReturnValue(undefined)
    vi.spyOn(modelCapabilities, 'supportsReasoning').mockReturnValue(false)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'tts-1',
              object: 'model',
              owned_by: 'openai',
              supported_endpoint_types: ['openai'],
              type: 'chat'
            },
            {
              id: 'whisper-1',
              object: 'model',
              owned_by: 'openai',
              supported_endpoint_types: ['openai']
            }
          ]
        })
      })
    )

    const provider = new AiSdkProvider(createProvider(), createProviderSettings())
    const models = await (provider as any).fetchProviderModels()

    expect(models).toHaveLength(2)
    for (const model of models) {
      expect(model.supportedEndpointTypes).toEqual(['openai'])
      expect(model.endpointType).toBe('openai')
      expect(model).not.toHaveProperty('selectableEndpointTypes')
    }
  })

  it('classifies sparse known image model ids', async () => {
    vi.spyOn(modelCapabilities, 'findCapabilityModelMatch').mockReturnValue(undefined)
    vi.spyOn(modelCapabilities, 'supportsReasoning').mockReturnValue(false)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'gpt-image-2',
              object: 'model',
              owned_by: 'openai',
              supported_endpoint_types: ['openai']
            }
          ]
        })
      })
    )

    const provider = new AiSdkProvider(createProvider(), createProviderSettings())
    const models = await (provider as any).fetchProviderModels()

    expect(models[0]).toMatchObject({
      id: 'gpt-image-2',
      type: ModelType.ImageGeneration,
      supportedEndpointTypes: ['openai'],
      endpointType: 'openai'
    })
  })

  it('keeps non-OpenAI relay chat route facts sparse', async () => {
    vi.spyOn(modelCapabilities, 'findCapabilityModelMatch').mockReturnValue(undefined)
    vi.spyOn(modelCapabilities, 'supportsReasoning').mockReturnValue(false)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'qwen3.7-max',
              object: 'model',
              owned_by: 'alibaba',
              supported_endpoint_types: ['openai'],
              type: 'chat'
            },
            {
              id: 'deepseek-chat',
              object: 'model',
              owned_by: 'deepseek',
              supported_endpoint_types: ['openai'],
              type: 'chat'
            }
          ]
        })
      })
    )

    const provider = new AiSdkProvider(createProvider(), createProviderSettings())
    const models = await (provider as any).fetchProviderModels()

    expect(models).toHaveLength(2)
    for (const model of models) {
      expect(model.supportedEndpointTypes).toEqual(['openai'])
      expect(model.endpointType).toBe('openai')
      expect(model).not.toHaveProperty('selectableEndpointTypes')
    }
  })

  it('does not write model configs during provider refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'claude-opus-4-8',
              object: 'model',
              owned_by: 'claude',
              supported_endpoint_types: []
            }
          ]
        })
      })
    )

    const providerSettings = createProviderSettings()
    const provider = new AiSdkProvider(createProvider(), providerSettings)
    const models = await (provider as any).fetchProviderModels()

    expect(models[0]).toMatchObject({
      endpointType: 'anthropic',
      ownedBy: 'claude'
    })
    expect(providerSettings.setModelConfig).not.toHaveBeenCalled()
  })
})
