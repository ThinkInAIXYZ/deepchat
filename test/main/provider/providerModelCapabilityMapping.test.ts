import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelType } from '../../../src/shared/model'

const createResolvedConfig = (reasoning: boolean) => ({
  maxTokens: 32000,
  contextLength: 200000,
  vision: true,
  functionCall: true,
  reasoning,
  type: ModelType.Chat
})

const createCatalogSnapshot = (supportsReasoning: boolean) => ({
  modelMatched: supportsReasoning,
  reasoningPortrait: supportsReasoning ? { supported: true } : null,
  supportsReasoning,
  thinkingBudgetRange: {},
  supportsSearch: false,
  searchDefaults: {},
  temperatureCapability: undefined,
  supportsAudioInput: false,
  supportsReasoningEffort: false,
  reasoningEffortDefault: undefined,
  supportsVerbosity: false,
  verbosityDefault: undefined
})

describe('ProviderSettings provider model capability mapping', () => {
  const loadProviderSettings = async () => {
    const { ProviderSettings } = await import('../../../src/main/provider/settings')
    const { modelCapabilities } = await import('../../../src/main/provider/modelCapabilities')
    return { ProviderSettings, modelCapabilities }
  }

  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves new-api reasoning capability from endpoint type instead of stored default state', async () => {
    const { ProviderSettings, modelCapabilities } = await loadProviderSettings()
    const catalogSnapshot = vi
      .spyOn(modelCapabilities, 'getCatalogCapabilitySnapshot')
      .mockImplementation((providerId, modelId) =>
        createCatalogSnapshot(providerId === 'openai' && modelId === 'gpt-5.4')
      )
    vi.spyOn(modelCapabilities, 'hasReasoningCandidate').mockReturnValue(true)

    const resolveModelConfigWithProvider = vi.fn().mockReturnValue(createResolvedConfig(true))
    const presenter = Object.assign(Object.create(ProviderSettings.prototype), {
      providerModelHelper: {
        getProviderModels: vi.fn().mockReturnValue([
          {
            id: 'gpt-5.4',
            name: 'GPT-5.4',
            group: 'default',
            providerId: 'new-api',
            isCustom: false,
            endpointType: 'openai',
            reasoning: false
          }
        ]),
        getCustomModels: vi.fn().mockReturnValue([])
      },
      resolveModelConfigWithProvider
    }) as InstanceType<typeof ProviderSettings>

    const models = presenter.getProviderModels('new-api')

    expect(models).toEqual([
      expect.objectContaining({
        id: 'gpt-5.4',
        reasoning: true
      })
    ])
    expect(catalogSnapshot).not.toHaveBeenCalled()
    expect(resolveModelConfigWithProvider).toHaveBeenCalledWith(
      'gpt-5.4',
      'new-api',
      undefined,
      expect.objectContaining({ id: 'gpt-5.4', endpointType: 'openai' }),
      undefined
    )
  })

  it('preserves explicit stored reasoning support when capability registry has no match', async () => {
    const { ProviderSettings, modelCapabilities } = await loadProviderSettings()
    vi.spyOn(modelCapabilities, 'getCatalogCapabilitySnapshot').mockReturnValue(
      createCatalogSnapshot(false)
    )

    const presenter = Object.assign(Object.create(ProviderSettings.prototype), {
      providerModelHelper: {
        getProviderModels: vi.fn().mockReturnValue([
          {
            id: 'vendor-special',
            name: 'Vendor Special',
            group: 'default',
            providerId: 'new-api',
            isCustom: false,
            endpointType: 'openai',
            reasoning: true
          }
        ]),
        getCustomModels: vi.fn().mockReturnValue([])
      },
      resolveModelConfigWithProvider: vi.fn().mockReturnValue(createResolvedConfig(true))
    }) as InstanceType<typeof ProviderSettings>

    const models = presenter.getProviderModels('new-api')

    expect(models).toEqual([
      expect.objectContaining({
        id: 'vendor-special',
        reasoning: true
      })
    ])
  })

  it('maps routed reasoning capability for new-api-like fork providers from supported endpoints', async () => {
    const { ProviderSettings, modelCapabilities } = await loadProviderSettings()
    const catalogSnapshot = vi
      .spyOn(modelCapabilities, 'getCatalogCapabilitySnapshot')
      .mockImplementation((providerId, modelId) =>
        createCatalogSnapshot(providerId === 'anthropic' && modelId === 'claude-opus-4-7')
      )
    vi.spyOn(modelCapabilities, 'hasReasoningCandidate').mockReturnValue(true)

    const presenter = Object.assign(Object.create(ProviderSettings.prototype), {
      providerModelHelper: {
        getProviderModels: vi.fn().mockReturnValue([
          {
            id: 'claude-opus-4-7',
            name: 'Claude Opus 4.7',
            group: 'default',
            providerId: 'fork-api',
            isCustom: false,
            supportedEndpointTypes: ['openai-response', 'anthropic'],
            reasoning: false
          }
        ]),
        getCustomModels: vi.fn().mockReturnValue([])
      },
      resolveModelConfigWithProvider: vi.fn().mockReturnValue(createResolvedConfig(true))
    }) as InstanceType<typeof ProviderSettings>

    const models = presenter.getProviderModels('fork-api')

    expect(models).toEqual([
      expect.objectContaining({
        id: 'claude-opus-4-7',
        reasoning: true
      })
    ])
    expect(catalogSnapshot).not.toHaveBeenCalled()
  })

  it('keeps anthropic transport relays on provider-local capability semantics', async () => {
    const { ProviderSettings, modelCapabilities } = await loadProviderSettings()
    vi.spyOn(modelCapabilities, 'hasReasoningCandidate').mockReturnValue(false)
    const catalogSnapshot = vi
      .spyOn(modelCapabilities, 'getCatalogCapabilitySnapshot')
      .mockImplementation((providerId, modelId) =>
        createCatalogSnapshot(providerId === 'anthropic' && modelId === 'claude-opus-4-7')
      )

    const presenter = Object.assign(Object.create(ProviderSettings.prototype), {
      providerHelper: {
        getProviderById: vi.fn().mockReturnValue({
          id: 'my-anthropic-proxy',
          apiType: 'anthropic'
        })
      },
      providerModelHelper: {
        getProviderModels: vi.fn().mockReturnValue([
          {
            id: 'claude-opus-4-7',
            name: 'Claude Opus 4.7',
            group: 'default',
            providerId: 'my-anthropic-proxy',
            isCustom: false,
            reasoning: false
          }
        ]),
        getCustomModels: vi.fn().mockReturnValue([])
      },
      resolveModelConfigWithProvider: vi.fn().mockReturnValue(createResolvedConfig(false))
    }) as InstanceType<typeof ProviderSettings>

    const models = presenter.getProviderModels('my-anthropic-proxy')

    expect(models).toEqual([
      expect.objectContaining({
        id: 'claude-opus-4-7',
        reasoning: false
      })
    ])
    expect(catalogSnapshot).not.toHaveBeenCalled()
  })

  it('delegates a raw model list to one batch resolver call', async () => {
    const { ProviderSettings, modelCapabilities } = await loadProviderSettings()
    vi.spyOn(modelCapabilities, 'hasReasoningCandidate').mockReturnValue(false)

    const rawModels = Array.from({ length: 500 }, (_, index) => ({
      id: `plain-model-${index}`,
      name: `Plain Model ${index}`,
      group: 'default',
      providerId: 'new-api',
      isCustom: false,
      reasoning: false
    }))
    const resolveEffectiveModels = vi.fn((models) => models)
    const presenter = Object.assign(Object.create(ProviderSettings.prototype), {
      providerModelHelper: {
        getProviderModels: vi.fn().mockReturnValue(rawModels)
      },
      resolveEffectiveModels
    }) as InstanceType<typeof ProviderSettings>

    expect(presenter.getProviderModels('new-api')).toHaveLength(500)
    expect(resolveEffectiveModels).toHaveBeenCalledOnce()
    expect(resolveEffectiveModels).toHaveBeenCalledWith(rawModels, 'new-api')
  })

  it('reuses one provider snapshot across a batch projection', async () => {
    const { ProviderSettings } = await loadProviderSettings()
    const provider = {
      id: 'custom-relay',
      apiType: 'openai'
    }
    const getProviderById = vi.fn().mockReturnValue(provider)
    const resolveModelConfigWithProvider = vi.fn().mockReturnValue(createResolvedConfig(false))
    const presenter = Object.assign(Object.create(ProviderSettings.prototype), {
      providerHelper: { getProviderById },
      resolveModelConfigWithProvider
    }) as InstanceType<typeof ProviderSettings>
    const rawModels = Array.from({ length: 3 }, (_, index) => ({
      id: `plain-model-${index}`,
      name: `Plain Model ${index}`,
      group: 'default',
      providerId: 'custom-relay',
      isCustom: false
    }))

    expect(presenter.resolveEffectiveModels(rawModels, 'custom-relay')).toHaveLength(3)
    expect(getProviderById).toHaveBeenCalledOnce()
    expect(resolveModelConfigWithProvider).toHaveBeenCalledTimes(3)
    for (const [index, rawModel] of rawModels.entries()) {
      expect(resolveModelConfigWithProvider).toHaveBeenNthCalledWith(
        index + 1,
        rawModel.id,
        'custom-relay',
        undefined,
        rawModel,
        provider
      )
    }
  })

  it('normalizes route facts once without synthesizing a provider model type', async () => {
    const { ProviderSettings } = await loadProviderSettings()
    const rawModel = {
      id: 'opaque-renderer',
      name: 'Opaque Renderer',
      group: 'default',
      providerId: 'new-api',
      isCustom: false,
      supportedEndpointTypes: ['openai'] as const,
      endpointType: 'openai' as const,
      ownedBy: 'openai'
    }
    const routeMetadata = {
      endpointType: undefined,
      supportedEndpointTypes: undefined,
      type: undefined,
      ownedBy: undefined
    }
    const resolveProviderModelRouteMetadata = vi.fn().mockReturnValue(routeMetadata)
    const getModelConfig = vi.fn().mockReturnValue(createResolvedConfig(false))
    const presenter = Object.assign(Object.create(ProviderSettings.prototype), {
      modelConfigHelper: {
        getModelRouteConfig: vi.fn().mockReturnValue({}),
        getModelConfig
      },
      providerModelHelper: {
        resolveProviderModelRouteMetadata
      }
    }) as InstanceType<typeof ProviderSettings>
    const identity = { providerId: 'openai' }

    expect(
      (presenter as any).resolveModelConfigWithProvider(
        rawModel.id,
        'new-api',
        identity,
        rawModel,
        { id: 'new-api', apiType: 'new-api' }
      )
    ).toEqual(createResolvedConfig(false))
    expect(resolveProviderModelRouteMetadata).toHaveBeenCalledOnce()
    expect(getModelConfig).toHaveBeenCalledWith(
      rawModel.id,
      'new-api',
      undefined,
      identity,
      expect.objectContaining({
        endpointType: 'openai',
        supportedEndpointTypes: ['openai'],
        type: undefined,
        ownedBy: 'openai'
      }),
      'new-api'
    )
  })

  it('checks exact raw model facts without resolving complete model lists', async () => {
    const { ProviderSettings, modelCapabilities } = await loadProviderSettings()
    const resolveEffectiveModels = vi.fn(() => {
      throw new Error('effective model resolution must not run')
    })
    const getProviderModels = vi.fn()
    const getCustomModels = vi.fn()
    vi.spyOn(modelCapabilities, 'getProviderCapabilityModelMatch').mockReturnValue(undefined)
    const presenter = Object.assign(Object.create(ProviderSettings.prototype), {
      modelConfigHelper: {
        hasUserConfig: vi.fn().mockReturnValue(false)
      },
      providerModelHelper: {
        getProviderModel: vi.fn().mockReturnValue({
          id: 'gpt-5.6-sol',
          name: 'GPT-5.6 Sol',
          group: 'openai',
          providerId: 'new-api'
        }),
        getProviderModels,
        getCustomModels
      },
      resolveEffectiveModels
    }) as InstanceType<typeof ProviderSettings>

    expect(presenter.isKnownModel('new-api', 'gpt-5.6-sol')).toBe(true)
    expect(resolveEffectiveModels).not.toHaveBeenCalled()
    expect(getProviderModels).not.toHaveBeenCalled()
    expect(getCustomModels).not.toHaveBeenCalled()
  })

  it('uses the catalog index directly for known aliased provider models', async () => {
    const { ProviderSettings, modelCapabilities } = await loadProviderSettings()
    const getCatalogMatch = vi
      .spyOn(modelCapabilities, 'getProviderCapabilityModelMatch')
      .mockReturnValue({
        providerId: 'openai',
        modelId: 'gpt-5.6-sol',
        model: { id: 'gpt-5.6-sol' }
      })
    const getProviderModels = vi.fn()
    const getCustomModels = vi.fn()
    const getProviderModel = vi.fn().mockReturnValue(undefined)
    const presenter = Object.assign(Object.create(ProviderSettings.prototype), {
      modelConfigHelper: {
        hasUserConfig: vi.fn().mockReturnValue(false)
      },
      providerModelHelper: {
        getProviderModel,
        getProviderModels,
        getCustomModels
      }
    }) as InstanceType<typeof ProviderSettings>

    expect(presenter.isKnownModel('openai-codex', 'gpt-5.6-sol')).toBe(true)
    expect(getCatalogMatch).toHaveBeenCalledWith('openai', 'gpt-5.6-sol')
    expect(getProviderModel).not.toHaveBeenCalled()
    expect(getProviderModels).not.toHaveBeenCalled()
    expect(getCustomModels).not.toHaveBeenCalled()
  })

  it('maps zenmux anthropic routes to anthropic capability semantics', async () => {
    const { ProviderSettings } = await loadProviderSettings()
    const presenter = Object.assign(Object.create(ProviderSettings.prototype), {
      providerHelper: {
        getProviderById: vi.fn().mockReturnValue({
          id: 'zenmux',
          apiType: 'openai'
        })
      },
      providerModelHelper: {
        getProviderModels: vi.fn().mockReturnValue([]),
        getCustomModels: vi.fn().mockReturnValue([])
      },
      modelConfigHelper: {
        getModelRouteConfig: vi.fn().mockReturnValue({})
      },
      getModelConfig: vi.fn().mockReturnValue({ endpointType: undefined }),
      getCustomModels: vi.fn().mockReturnValue([])
    }) as InstanceType<typeof ProviderSettings>

    expect(
      presenter.getCapabilitySnapshot({
        providerId: 'zenmux',
        modelId: 'anthropic/claude-opus-4-7'
      }).identity.providerId
    ).toBe('anthropic')
  })

  it('does not load the full model list when a targeted capability route is absent', async () => {
    const { ProviderSettings } = await loadProviderSettings()
    const getProviderModels = vi.fn().mockReturnValue([])
    const getProviderModelRouteMetadata = vi.fn().mockReturnValue(undefined)
    const modelConfig = { endpointType: undefined }
    const presenter = Object.assign(Object.create(ProviderSettings.prototype), {
      providerHelper: {
        getProviderById: vi.fn().mockReturnValue({
          id: 'custom-relay',
          apiType: 'openai'
        })
      },
      providerModelHelper: {
        getProviderModelRouteMetadata,
        getProviderModels,
        getCustomModels: vi.fn().mockReturnValue([])
      },
      modelConfigHelper: {
        getModelRouteConfig: vi.fn().mockReturnValue(modelConfig)
      },
      getModelConfig: vi.fn().mockReturnValue(modelConfig)
    }) as InstanceType<typeof ProviderSettings>

    expect(
      presenter.getCapabilitySnapshot({
        providerId: 'custom-relay',
        modelId: 'unknown-model'
      }).identity.providerId
    ).toBe('custom-relay')
    expect(getProviderModelRouteMetadata).toHaveBeenCalledOnce()
    expect(getProviderModelRouteMetadata).toHaveBeenCalledWith(
      'custom-relay',
      'unknown-model',
      modelConfig
    )
    expect(getProviderModels).not.toHaveBeenCalled()
  })
})
