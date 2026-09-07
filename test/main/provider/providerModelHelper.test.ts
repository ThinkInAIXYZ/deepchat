import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelConfig } from '@shared/types/provider'
import { ApiEndpointType, ModelType } from '../../../src/shared/model'

const storeStates = vi.hoisted(
  () =>
    new Map<
      string,
      {
        data: Record<string, unknown>
        get: ReturnType<typeof vi.fn>
        set: ReturnType<typeof vi.fn>
        clear: ReturnType<typeof vi.fn>
      }
    >()
)

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())

vi.mock('electron-store', () => ({
  default: class MockElectronStore {
    private readonly state: {
      data: Record<string, unknown>
      get: ReturnType<typeof vi.fn>
      set: ReturnType<typeof vi.fn>
      clear: ReturnType<typeof vi.fn>
    }

    constructor(options: { name: string; defaults?: Record<string, unknown> }) {
      const existing = storeStates.get(options.name)
      if (existing) {
        this.state = existing
        return
      }

      const data = structuredClone(options.defaults ?? {})
      const state = {
        data,
        get: vi.fn((key: string) => data[key]),
        set: vi.fn((key: string, value: unknown) => {
          data[key] = value
        }),
        clear: vi.fn(() => {
          Object.keys(data).forEach((key) => {
            delete data[key]
          })
        })
      }
      storeStates.set(options.name, state)
      this.state = state
    }

    get(key: string) {
      return this.state.get(key)
    }

    set(key: string, value: unknown) {
      this.state.set(key, value)
    }

    clear() {
      this.state.clear()
    }
  }
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return 'C:/mock-user-data'
      return 'C:/mock-home'
    }),
    getVersion: vi.fn(() => '1.0.0'),
    getAppPath: vi.fn(() => 'C:/mock-app')
  },
  nativeTheme: {
    themeSource: 'system',
    shouldUseDarkColors: false,
    on: vi.fn()
  },
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn()
  }
}))

const createBaseModel = (providerId: string, modelId: string) => ({
  id: modelId,
  name: modelId,
  providerId,
  contextLength: 32000,
  maxTokens: 8000,
  isCustom: false,
  type: ModelType.Chat
})

const createModelConfig = (overrides?: Partial<ModelConfig>): ModelConfig => ({
  maxTokens: 8000,
  contextLength: 32000,
  temperature: 0.6,
  vision: false,
  functionCall: true,
  reasoning: false,
  type: ModelType.Chat,
  ...overrides
})

const modelConfigCacheKey = (providerId: string, modelId: string) => `${providerId}:${modelId}`

const createGetModelConfigMock = (configState: Map<string, ModelConfig>) =>
  vi.fn(
    (
      modelId: string,
      providerId?: string,
      _capabilityProviderId?: string,
      _resolvedIdentity?: unknown,
      providerFacts?: ReturnType<typeof createBaseModel>
    ) =>
      (providerId ? configState.get(modelConfigCacheKey(providerId, modelId)) : undefined) ??
      createModelConfig({
        maxTokens: providerFacts?.maxTokens,
        contextLength: providerFacts?.contextLength,
        type: providerFacts?.type
      })
  )

describe('ProviderModelHelper cache', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-19T00:00:00.000Z'))
    storeStates.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reuses provider model snapshots within the ttl window', async () => {
    const { ProviderModelHelper } = await import('../../../src/main/provider/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })

    helper.setProviderModels('openai', [createBaseModel('openai', 'gpt-5')])
    const storeState = storeStates.get('models_openai')!
    storeState.get.mockClear()

    helper.getProviderModels('openai')
    helper.getProviderModels('openai')

    expect(storeState.get).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(251)
    helper.getProviderModels('openai')

    expect(storeState.get).toHaveBeenCalledTimes(2)
  })

  it('invalidates cached provider models after setProviderModels writes', async () => {
    const { ProviderModelHelper } = await import('../../../src/main/provider/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })

    helper.setProviderModels('openai', [createBaseModel('openai', 'gpt-5')])
    helper.getProviderModels('openai')

    const storeState = storeStates.get('models_openai')!
    storeState.get.mockClear()

    helper.setProviderModels('openai', [
      {
        ...createBaseModel('openai', 'gpt-5'),
        maxTokens: 16000
      }
    ])

    const models = helper.getProviderModels('openai')

    expect(storeState.get).toHaveBeenCalledTimes(1)
    expect(models[0].maxTokens).toBe(16000)
  })

  it('invalidates cached provider models after custom model writes', async () => {
    const { ProviderModelHelper } = await import('../../../src/main/provider/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })

    helper.setProviderModels('openai', [createBaseModel('openai', 'gpt-5')])
    helper.getProviderModels('openai')

    const storeState = storeStates.get('models_openai')!
    storeState.get.mockClear()

    helper.setCustomModels('openai', [
      {
        ...createBaseModel('openai', 'custom-model'),
        isCustom: true
      }
    ])

    helper.getProviderModels('openai')

    expect(storeState.get).toHaveBeenCalledTimes(1)
  })

  it('removes stale catalog projections in memory without writing from the read path', async () => {
    const { ProviderModelHelper } = await import('../../../src/main/provider/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })
    const store = helper.getProviderModelStore('openai-codex')
    store.set('models', [
      {
        id: 'gpt-5.6-sol',
        name: 'GPT-5.6 Sol',
        group: 'Codex',
        providerId: 'openai-codex',
        isCustom: false,
        contextLength: 16000,
        maxTokens: 4096,
        vision: false,
        functionCall: true,
        reasoning: false,
        type: ModelType.Chat,
        selectableEndpointTypes: ['openai']
      }
    ])
    const storeState = storeStates.get('models_openai-codex')!
    storeState.set.mockClear()

    const models = helper.getProviderModels('openai-codex')

    expect(models).toEqual([
      {
        id: 'gpt-5.6-sol',
        name: 'GPT-5.6 Sol',
        group: 'Codex',
        providerId: 'openai-codex',
        isCustom: false
      }
    ])
    expect(storeState.set).not.toHaveBeenCalled()
  })

  it('returns cached NewAPI route facts without deriving selectable endpoints', async () => {
    const { ProviderModelHelper } = await import('../../../src/main/provider/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })

    const store = helper.getProviderModelStore('new-api')
    store.set('models', [
      {
        id: 'gpt-5.5',
        name: 'GPT-5.5',
        group: 'openai',
        providerId: 'new-api',
        isCustom: false,
        supportedEndpointTypes: ['openai'],
        endpointType: 'openai',
        ownedBy: 'openai'
      }
    ])

    const models = helper.getProviderModels('new-api')

    expect(models[0]).toMatchObject({
      id: 'gpt-5.5',
      supportedEndpointTypes: ['openai'],
      endpointType: 'openai'
    })
    expect(models[0]).not.toHaveProperty('selectableEndpointTypes')
  })

  it('does not materialize missing type fields in the raw cache', async () => {
    const { ProviderModelHelper } = await import('../../../src/main/provider/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })

    const store = helper.getProviderModelStore('new-api')
    store.set('models', [
      {
        id: 'proxy-chat',
        name: 'Proxy Chat',
        group: 'default',
        providerId: 'new-api',
        isCustom: false,
        supportedEndpointTypes: ['openai'],
        endpointType: 'openai',
        ownedBy: 'openai-compatible'
      }
    ])

    const models = helper.getProviderModels('new-api')

    expect(models[0]).toMatchObject({
      id: 'proxy-chat',
      supportedEndpointTypes: ['openai'],
      endpointType: 'openai'
    })
    expect(models[0]).not.toHaveProperty('type')
  })

  it('drops selectable endpoints because they are an effective projection', async () => {
    const { ProviderModelHelper } = await import('../../../src/main/provider/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })

    const store = helper.getProviderModelStore('new-api')
    store.set('models', [
      {
        id: 'gpt-5.5',
        name: 'GPT-5.5',
        group: 'openai',
        providerId: 'new-api',
        isCustom: false,
        supportedEndpointTypes: ['openai'],
        selectableEndpointTypes: ['openai', 'openai-response'],
        endpointType: 'openai',
        type: ModelType.Chat
      }
    ])

    const models = helper.getProviderModels('new-api')

    expect(models[0]).toMatchObject({
      id: 'gpt-5.5',
      supportedEndpointTypes: ['openai']
    })
    expect(models[0]).not.toHaveProperty('selectableEndpointTypes')
  })

  it('does not project effective types into cached provider facts', async () => {
    const { ProviderModelHelper } = await import('../../../src/main/provider/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })

    const store = helper.getProviderModelStore('new-api')
    store.set('models', [
      {
        id: 'gpt-image-2',
        name: 'GPT Image 2',
        group: 'openai',
        providerId: 'new-api',
        isCustom: false,
        supportedEndpointTypes: ['openai', 'image-generation'],
        endpointType: 'openai'
      },
      {
        id: 'text-embedding-3-large',
        name: 'Text Embedding 3 Large',
        group: 'openai',
        providerId: 'new-api',
        isCustom: false,
        supportedEndpointTypes: ['openai', 'anthropic'],
        endpointType: 'openai'
      }
    ])

    const models = helper.getProviderModels('new-api')

    expect(models[0]).not.toHaveProperty('type')
    expect(models[0]).not.toHaveProperty('selectableEndpointTypes')
    expect(models[1]).not.toHaveProperty('type')
    expect(models[1]).not.toHaveProperty('selectableEndpointTypes')
  })

  it('keeps cached media endpoint metadata sparse', async () => {
    const { ProviderModelHelper } = await import('../../../src/main/provider/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })

    const store = helper.getProviderModelStore('new-api')
    store.set('models', [
      {
        id: 'gpt-image-2',
        name: 'GPT Image 2',
        group: 'openai',
        providerId: 'new-api',
        isCustom: false,
        supportedEndpointTypes: ['image-generation'],
        endpointType: 'image-generation'
      }
    ])

    const models = helper.getProviderModels('new-api')

    expect(models[0]).toMatchObject({ id: 'gpt-image-2', endpointType: 'image-generation' })
    expect(models[0]).not.toHaveProperty('type')
  })

  it('does not derive media type from a sparse cached model id', async () => {
    const { ProviderModelHelper } = await import('../../../src/main/provider/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })

    const store = helper.getProviderModelStore('new-api')
    store.set('models', [
      {
        id: 'gpt-image-2',
        name: 'GPT Image 2',
        group: 'openai',
        providerId: 'new-api',
        isCustom: false,
        supportedEndpointTypes: ['openai'],
        endpointType: 'openai'
      }
    ])

    const models = helper.getProviderModels('new-api')

    expect(models[0]).toMatchObject({
      id: 'gpt-image-2',
      supportedEndpointTypes: ['openai'],
      endpointType: 'openai'
    })
    expect(models[0]).not.toHaveProperty('type')
  })

  it('does not mix legacy user config into cached provider facts', async () => {
    const { ProviderModelHelper } = await import('../../../src/main/provider/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })

    const store = helper.getProviderModelStore('new-api')
    store.set('models', [
      {
        id: 'sora-3',
        name: 'Sora 3',
        group: 'openai',
        providerId: 'new-api',
        isCustom: false,
        supportedEndpointTypes: ['video-generation'],
        endpointType: 'video-generation'
      }
    ])

    const models = helper.getProviderModels('new-api')

    expect(models[0]).toMatchObject({ id: 'sora-3', endpointType: 'video-generation' })
    expect(models[0]).not.toHaveProperty('type')
  })

  it('does not mix explicit user type into cached provider facts', async () => {
    const { ProviderModelHelper } = await import('../../../src/main/provider/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })

    const store = helper.getProviderModelStore('new-api')
    store.set('models', [
      {
        id: 'media-debug-model',
        name: 'Media Debug Model',
        group: 'openai',
        providerId: 'new-api',
        isCustom: false,
        supportedEndpointTypes: ['image-generation'],
        endpointType: 'image-generation'
      }
    ])

    const models = helper.getProviderModels('new-api')

    expect(models[0]).toMatchObject({
      id: 'media-debug-model',
      endpointType: 'image-generation'
    })
    expect(models[0]).not.toHaveProperty('type')
  })

  it('uses targeted model reads for route metadata when the store supports them', async () => {
    const { ProviderModelHelper } = await import('../../../src/main/provider/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })
    const listModels = vi.fn()
    const getProviderModel = vi.fn((source: 'provider' | 'custom', modelId: string) =>
      source === 'provider' && modelId === 'kimi-k3'
        ? {
            ...createBaseModel('new-api', modelId),
            supportedEndpointTypes: ['openai', 'anthropic']
          }
        : undefined
    )
    helper.setStoreFactory(() => ({
      store: { models: [], custom_models: [] },
      get<TValue = unknown>(_key: string, defaultValue?: TValue): TValue | undefined {
        listModels()
        return defaultValue
      },
      set: vi.fn(),
      delete: vi.fn(),
      getProviderModel
    }))

    expect(helper.getProviderModelRouteMetadata('new-api', 'kimi-k3')).toEqual({
      endpointType: undefined,
      supportedEndpointTypes: ['openai', 'anthropic'],
      type: ModelType.Chat,
      ownedBy: undefined
    })
    expect(getProviderModel).toHaveBeenCalledOnce()
    expect(getProviderModel).toHaveBeenCalledWith('provider', 'kimi-k3')
    expect(listModels).not.toHaveBeenCalled()
    expect(
      helper.getProviderModelRouteMetadata(
        'new-api',
        'kimi-k3',
        createModelConfig({ endpointType: 'openai', ownedBy: 'moonshot' })
      )
    ).toMatchObject({
      endpointType: 'openai',
      ownedBy: 'moonshot'
    })
  })

  it('keeps stored non-New API model type authoritative in route metadata', async () => {
    const { ProviderModelHelper } = await import('../../../src/main/provider/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })
    const model = {
      ...createBaseModel('openai', 'image-model'),
      type: ModelType.ImageGeneration
    }
    const store = helper.getProviderModelStore('openai')
    store.set('models', [model])

    expect(helper.getProviderModels('openai')[0]?.type).toBe(ModelType.ImageGeneration)
    expect(
      helper.getProviderModelRouteMetadata(
        'openai',
        model.id,
        createModelConfig({ type: ModelType.Chat })
      )
    ).toMatchObject({
      type: ModelType.ImageGeneration
    })

    expect(
      helper.getProviderModelRouteMetadata(
        'openai',
        model.id,
        createModelConfig({
          type: ModelType.Chat,
          apiEndpoint: ApiEndpointType.Video
        })
      )
    ).toMatchObject({
      type: ModelType.VideoGeneration
    })
  })

  it('applies explicit user route intent after provider route facts', async () => {
    const { ProviderModelHelper } = await import('../../../src/main/provider/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })
    const model = {
      ...createBaseModel('new-api', 'routed-model'),
      type: ModelType.ImageGeneration,
      endpointType: 'image-generation' as const,
      ownedBy: 'provider-owner'
    }
    const store = helper.getProviderModelStore('new-api')
    store.set('models', [model])

    expect(
      helper.getProviderModelRouteMetadata(
        'new-api',
        model.id,
        createModelConfig({
          type: ModelType.Chat,
          endpointType: 'anthropic',
          ownedBy: 'user-owner',
          isUserDefined: true
        })
      )
    ).toMatchObject({
      type: ModelType.Chat,
      endpointType: 'anthropic',
      ownedBy: 'user-owner'
    })
  })

  it('does not synthesize a chat type for sparse route facts', async () => {
    const { ProviderModelHelper } = await import('../../../src/main/provider/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })
    const providerModel = {
      id: 'aggregated-model',
      name: 'Aggregated Model',
      group: 'default',
      providerId: 'new-api',
      isCustom: false,
      endpointType: undefined,
      ownedBy: undefined,
      supportedEndpointTypes: ['openai', 'anthropic'] as const
    }
    helper.setStoreFactory(() => ({
      store: { models: [providerModel], custom_models: [] },
      get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
        if (key === 'models') return [providerModel] as TValue
        return defaultValue
      },
      set: vi.fn(),
      delete: vi.fn()
    }))

    expect(helper.getProviderModels('new-api')[0]).toMatchObject({
      endpointType: undefined,
      ownedBy: undefined
    })
    expect(helper.getProviderModelRouteMetadata('new-api', providerModel.id, {})).toEqual({
      endpointType: undefined,
      supportedEndpointTypes: ['openai', 'anthropic'],
      type: undefined,
      ownedBy: undefined
    })
  })

  it('checks targeted provider and custom rows after a fresh-cache miss', async () => {
    const { ProviderModelHelper } = await import('../../../src/main/provider/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })
    const providerModel = createBaseModel('new-api', 'provider-model')
    const customModel = {
      ...createBaseModel('new-api', 'custom-model'),
      isCustom: true,
      ownedBy: 'moonshot'
    }
    const getProviderModel = vi.fn((source: 'provider' | 'custom', modelId: string) =>
      source === 'custom' && modelId === customModel.id ? customModel : undefined
    )
    helper.setStoreFactory(() => ({
      store: { models: [providerModel], custom_models: [customModel] },
      get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
        if (key === 'models') return [providerModel] as TValue
        if (key === 'custom_models') return [customModel] as TValue
        return defaultValue
      },
      set: vi.fn(),
      delete: vi.fn(),
      getProviderModel
    }))

    helper.getProviderModels('new-api')
    expect(helper.getProviderModelRouteMetadata('new-api', customModel.id)).toMatchObject({
      ownedBy: 'moonshot'
    })
    expect(getProviderModel).toHaveBeenCalledTimes(2)
    expect(getProviderModel).toHaveBeenNthCalledWith(1, 'provider', customModel.id)
    expect(getProviderModel).toHaveBeenNthCalledWith(2, 'custom', customModel.id)
  })

  it('finds a provider row inserted after a provider-list snapshot was cached', async () => {
    const { ProviderModelHelper } = await import('../../../src/main/provider/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })
    const cachedModel = createBaseModel('new-api', 'cached-model')
    const insertedModel = {
      ...createBaseModel('new-api', 'inserted-model'),
      ownedBy: 'openai'
    }
    const getProviderModel = vi.fn((source: 'provider' | 'custom', modelId: string) =>
      source === 'provider' && modelId === insertedModel.id ? insertedModel : undefined
    )
    helper.setStoreFactory(() => ({
      store: { models: [cachedModel], custom_models: [] },
      get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
        if (key === 'models') return [cachedModel] as TValue
        return defaultValue
      },
      set: vi.fn(),
      delete: vi.fn(),
      getProviderModel
    }))

    helper.getProviderModels('new-api')

    expect(helper.getProviderModel('new-api', insertedModel.id)).toMatchObject({
      id: insertedModel.id,
      ownedBy: 'openai'
    })
    expect(helper.getProviderModelRouteMetadata('new-api', insertedModel.id)).toMatchObject({
      ownedBy: 'openai'
    })
    expect(getProviderModel).toHaveBeenCalledWith('provider', insertedModel.id)
  })

  it('clears persisted provider models and custom models for a removed provider', async () => {
    const { ProviderModelHelper } = await import('../../../src/main/provider/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })

    helper.setProviderModels('openai', [createBaseModel('openai', 'gpt-5')])
    helper.setCustomModels('openai', [
      {
        ...createBaseModel('openai', 'custom-gpt-5'),
        isCustom: true
      }
    ])

    helper.clearProviderModelStore('openai')

    expect(helper.getProviderModels('openai')).toEqual([])
    expect(helper.getCustomModels('openai')).toEqual([])
    expect(storeStates.get('models_openai')?.clear).toHaveBeenCalledTimes(1)
  })

  it('encodes invalid provider id characters before creating store files', async () => {
    const { ProviderModelHelper } = await import('../../../src/main/provider/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })

    helper.getProviderModelStore(':providerId')

    expect(storeStates.has('models_%3AproviderId')).toBe(true)
  })
})

describe('ProviderSettings effective model projection', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-19T01:00:00.000Z'))
    storeStates.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('applies set and reset immediately without invalidating raw model facts', async () => {
    const [{ ProviderSettings }, { ProviderModelHelper }] = await Promise.all([
      import('../../../src/main/provider/settings'),
      import('../../../src/main/provider/providerModelHelper')
    ])

    const configState = new Map<string, ModelConfig>()
    const presenter = Object.assign(Object.create(ProviderSettings.prototype), {
      modelConfigHelper: {
        getModelRouteConfig: vi.fn(() => ({})),
        getModelConfig: createGetModelConfigMock(configState),
        setModelConfig: vi.fn((modelId: string, providerId: string, config: ModelConfig) => {
          configState.set(modelConfigCacheKey(providerId, modelId), config)
          return config
        }),
        resetModelConfig: vi.fn((modelId: string, providerId: string) => {
          configState.delete(modelConfigCacheKey(providerId, modelId))
        }),
        importConfigs: vi.fn()
      },
      providerHelper: {
        getProviderById: vi.fn().mockReturnValue(undefined)
      },
      publishEvent: publishDeepchatEventMock
    }) as InstanceType<typeof ProviderSettings>
    const presenterWithHelper = presenter as InstanceType<typeof ProviderSettings> & {
      providerModelHelper: InstanceType<typeof ProviderModelHelper>
    }

    presenterWithHelper.providerModelHelper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })

    presenterWithHelper.providerModelHelper.setProviderModels('openai', [
      createBaseModel('openai', 'gpt-5')
    ])

    const initialModels = presenter.getProviderModels('openai')
    expect(initialModels[0].maxTokens).toBe(8000)

    presenter.setModelConfig(
      'gpt-5',
      'openai',
      createModelConfig({
        maxTokens: 16000
      })
    )

    const updatedModels = presenter.getProviderModels('openai')
    expect(updatedModels[0].maxTokens).toBe(16000)

    presenter.resetModelConfig('gpt-5', 'openai')

    const resetModels = presenter.getProviderModels('openai')
    expect(resetModels[0].maxTokens).toBe(8000)
  })

  it('applies imported user config without invalidating raw model facts', async () => {
    const [{ ProviderSettings }, { ProviderModelHelper }] = await Promise.all([
      import('../../../src/main/provider/settings'),
      import('../../../src/main/provider/providerModelHelper')
    ])

    const configState = new Map<string, ModelConfig>()
    const presenter = Object.assign(Object.create(ProviderSettings.prototype), {
      modelConfigHelper: {
        getModelRouteConfig: vi.fn(() => ({})),
        getModelConfig: createGetModelConfigMock(configState),
        setModelConfig: vi.fn(),
        resetModelConfig: vi.fn(),
        importConfigs: vi.fn(() => {
          configState.set(
            modelConfigCacheKey('openai', 'gpt-5'),
            createModelConfig({
              maxTokens: 24000
            })
          )
        })
      },
      providerHelper: {
        getProviderById: vi.fn().mockReturnValue(undefined)
      },
      publishEvent: publishDeepchatEventMock
    }) as InstanceType<typeof ProviderSettings>
    const presenterWithHelper = presenter as InstanceType<typeof ProviderSettings> & {
      providerModelHelper: InstanceType<typeof ProviderModelHelper>
    }

    presenterWithHelper.providerModelHelper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn(),
      publishEvent: publishDeepchatEventMock
    })

    presenterWithHelper.providerModelHelper.setProviderModels('openai', [
      createBaseModel('openai', 'gpt-5')
    ])
    presenter.getProviderModels('openai')

    presenter.importModelConfigs(
      {
        'openai:gpt-5': {
          maxTokens: 24000
        } as never
      },
      true
    )

    const importedModels = presenter.getProviderModels('openai')
    expect(importedModels[0].maxTokens).toBe(24000)
  })
})

describe('ProviderSettings provider DB model mapping', () => {
  beforeEach(() => {
    vi.resetModules()
    storeStates.clear()
  })

  it('preserves embedding and rerank types from provider DB models', async () => {
    vi.doMock('../../../src/main/provider/providerDbLoader', () => ({
      providerDbLoader: {
        subscribeCatalogChanges: vi.fn(),
        getDb: vi.fn(() => ({
          providers: {
            aihubmix: {
              id: 'aihubmix',
              models: [
                {
                  id: 'text-embedding-3-small',
                  display_name: 'text-embedding-3-small',
                  type: 'embedding',
                  limit: {
                    context: 8192,
                    output: 8192
                  },
                  tool_call: false
                },
                {
                  id: 'rerank-v1',
                  display_name: 'rerank-v1',
                  type: 'rerank',
                  tool_call: false
                }
              ]
            }
          }
        }))
      }
    }))

    const { ProviderSettings } = await import('../../../src/main/provider/settings')
    const getCapabilitySnapshot = vi.fn(() => ({ supportsReasoning: false }))
    const presenter = Object.assign(Object.create(ProviderSettings.prototype), {
      getCapabilitySnapshot
    }) as InstanceType<typeof ProviderSettings>

    const models = presenter.getDbProviderModels('aihubmix')

    expect(models).toEqual([
      expect.objectContaining({
        id: 'text-embedding-3-small',
        type: ModelType.Embedding
      }),
      expect.objectContaining({
        id: 'rerank-v1',
        type: ModelType.Rerank
      })
    ])
    expect(getCapabilitySnapshot).not.toHaveBeenCalled()
  })
})
