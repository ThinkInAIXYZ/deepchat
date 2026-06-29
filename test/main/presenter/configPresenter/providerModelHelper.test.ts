import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelConfig } from '../../../../src/shared/presenter'
import { ModelType } from '../../../../src/shared/model'

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

const eventBusMocks = vi.hoisted(() => ({
  on: vi.fn(),
  send: vi.fn(),
  sendToMain: vi.fn()
}))

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

vi.mock('@/eventbus', () => ({
  eventBus: {
    on: eventBusMocks.on,
    send: eventBusMocks.send,
    sendToMain: eventBusMocks.sendToMain
  }
}))

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: publishDeepchatEventMock
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

describe('ProviderModelHelper cache', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-19T00:00:00.000Z'))
    storeStates.clear()
    eventBusMocks.on.mockReset()
    eventBusMocks.send.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reuses provider model snapshots within the ttl window', async () => {
    const { ProviderModelHelper } =
      await import('../../../../src/main/presenter/configPresenter/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      getModelConfig: () => undefined as unknown as ModelConfig,
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn()
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
    const { ProviderModelHelper } =
      await import('../../../../src/main/presenter/configPresenter/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      getModelConfig: () => undefined as unknown as ModelConfig,
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn()
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
    const { ProviderModelHelper } =
      await import('../../../../src/main/presenter/configPresenter/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      getModelConfig: () => undefined as unknown as ModelConfig,
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn()
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

  it('enriches cached NewAPI openai-only chat models with chat selectable endpoints', async () => {
    const { ProviderModelHelper } =
      await import('../../../../src/main/presenter/configPresenter/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      getModelConfig: () => undefined as unknown as ModelConfig,
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn()
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
      selectableEndpointTypes: ['openai', 'openai-response', 'anthropic', 'gemini'],
      endpointType: 'openai'
    })
  })

  it('enriches cached NewAPI relay chat models with chat selectable endpoints', async () => {
    const { ProviderModelHelper } =
      await import('../../../../src/main/presenter/configPresenter/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      getModelConfig: () => undefined as unknown as ModelConfig,
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn()
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
      selectableEndpointTypes: ['openai', 'openai-response', 'anthropic', 'gemini'],
      endpointType: 'openai',
      type: ModelType.Chat
    })
  })

  it('recomputes stale cached NewAPI selectable endpoint types', async () => {
    const { ProviderModelHelper } =
      await import('../../../../src/main/presenter/configPresenter/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      getModelConfig: () => undefined as unknown as ModelConfig,
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn()
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
      selectableEndpointTypes: ['openai', 'openai-response', 'anthropic', 'gemini']
    })
  })

  it('computes NewAPI selectable endpoint types from the resolved model type', async () => {
    const { ProviderModelHelper } =
      await import('../../../../src/main/presenter/configPresenter/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      getModelConfig: (modelId: string) =>
        createModelConfig({
          type: modelId === 'gpt-image-2' ? ModelType.ImageGeneration : ModelType.Embedding
        }),
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn()
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

    expect(models[0]).toMatchObject({
      id: 'gpt-image-2',
      type: ModelType.ImageGeneration,
      selectableEndpointTypes: ['image-generation']
    })
    expect(models[1]).toMatchObject({
      id: 'text-embedding-3-large',
      type: ModelType.Embedding,
      selectableEndpointTypes: ['openai']
    })
  })

  it('derives NewAPI media type from cached endpoint metadata before default chat config', async () => {
    const { ProviderModelHelper } =
      await import('../../../../src/main/presenter/configPresenter/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      getModelConfig: () =>
        createModelConfig({
          isUserDefined: false
        }),
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn()
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

    expect(models[0]).toMatchObject({
      id: 'gpt-image-2',
      type: ModelType.ImageGeneration,
      selectableEndpointTypes: ['image-generation']
    })
  })

  it('derives NewAPI media type from sparse cached media model ids', async () => {
    const { ProviderModelHelper } =
      await import('../../../../src/main/presenter/configPresenter/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      getModelConfig: () =>
        createModelConfig({
          isUserDefined: false
        }),
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn()
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
      type: ModelType.ImageGeneration,
      supportedEndpointTypes: ['openai'],
      selectableEndpointTypes: ['image-generation'],
      endpointType: 'openai'
    })
  })

  it('derives NewAPI media type when legacy user config has no explicit type', async () => {
    const { ProviderModelHelper } =
      await import('../../../../src/main/presenter/configPresenter/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      getModelConfig: () =>
        createModelConfig({
          type: undefined,
          isUserDefined: true
        }),
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn()
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

    expect(models[0]).toMatchObject({
      id: 'sora-3',
      type: ModelType.VideoGeneration,
      selectableEndpointTypes: ['video-generation']
    })
  })

  it('keeps explicit user NewAPI chat type ahead of provider media metadata', async () => {
    const { ProviderModelHelper } =
      await import('../../../../src/main/presenter/configPresenter/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      getModelConfig: () =>
        createModelConfig({
          type: ModelType.Chat,
          isUserDefined: true
        }),
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn()
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
      type: ModelType.Chat,
      selectableEndpointTypes: ['openai', 'openai-response', 'anthropic', 'gemini']
    })
  })

  it('clears persisted provider models and custom models for a removed provider', async () => {
    const { ProviderModelHelper } =
      await import('../../../../src/main/presenter/configPresenter/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      getModelConfig: () => undefined as unknown as ModelConfig,
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn()
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
    const { ProviderModelHelper } =
      await import('../../../../src/main/presenter/configPresenter/providerModelHelper')
    const helper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      getModelConfig: () => undefined as unknown as ModelConfig,
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn()
    })

    helper.getProviderModelStore(':providerId')

    expect(storeStates.has('models_%3AproviderId')).toBe(true)
  })
})

describe('ConfigPresenter provider model cache invalidation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-19T01:00:00.000Z'))
    storeStates.clear()
    eventBusMocks.on.mockReset()
    eventBusMocks.send.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('refreshes cached provider models after setModelConfig and resetModelConfig', async () => {
    vi.doMock('@/presenter', () => ({
      presenter: {}
    }))

    const [{ ConfigPresenter }, { ProviderModelHelper }] = await Promise.all([
      import('../../../../src/main/presenter/configPresenter/index'),
      import('../../../../src/main/presenter/configPresenter/providerModelHelper')
    ])

    const configState = new Map<string, ModelConfig>()
    const cacheKey = (providerId: string, modelId: string) => `${providerId}:${modelId}`
    const presenter = Object.assign(Object.create(ConfigPresenter.prototype), {
      modelConfigHelper: {
        getModelConfig: vi.fn((modelId: string, providerId?: string) =>
          providerId ? configState.get(cacheKey(providerId, modelId)) : undefined
        ),
        setModelConfig: vi.fn((modelId: string, providerId: string, config: ModelConfig) => {
          configState.set(cacheKey(providerId, modelId), config)
          return config
        }),
        resetModelConfig: vi.fn((modelId: string, providerId: string) => {
          configState.delete(cacheKey(providerId, modelId))
        }),
        importConfigs: vi.fn()
      },
      providerHelper: {
        getProviderById: vi.fn().mockReturnValue(undefined)
      }
    }) as InstanceType<typeof ConfigPresenter>
    const presenterWithHelper = presenter as InstanceType<typeof ConfigPresenter> & {
      providerModelHelper: InstanceType<typeof ProviderModelHelper>
    }

    presenterWithHelper.providerModelHelper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      getModelConfig: (modelId: string, providerId?: string) =>
        presenter.getModelConfig(modelId, providerId),
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn()
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

  it('refreshes cached provider models after importModelConfigs', async () => {
    vi.doMock('@/presenter', () => ({
      presenter: {}
    }))

    const [{ ConfigPresenter }, { ProviderModelHelper }] = await Promise.all([
      import('../../../../src/main/presenter/configPresenter/index'),
      import('../../../../src/main/presenter/configPresenter/providerModelHelper')
    ])

    const configState = new Map<string, ModelConfig>()
    const cacheKey = (providerId: string, modelId: string) => `${providerId}:${modelId}`
    const presenter = Object.assign(Object.create(ConfigPresenter.prototype), {
      modelConfigHelper: {
        getModelConfig: vi.fn((modelId: string, providerId?: string) =>
          providerId ? configState.get(cacheKey(providerId, modelId)) : undefined
        ),
        setModelConfig: vi.fn(),
        resetModelConfig: vi.fn(),
        importConfigs: vi.fn(() => {
          configState.set(
            cacheKey('openai', 'gpt-5'),
            createModelConfig({
              maxTokens: 24000
            })
          )
        })
      },
      providerHelper: {
        getProviderById: vi.fn().mockReturnValue(undefined)
      }
    }) as InstanceType<typeof ConfigPresenter>
    const presenterWithHelper = presenter as InstanceType<typeof ConfigPresenter> & {
      providerModelHelper: InstanceType<typeof ProviderModelHelper>
    }

    presenterWithHelper.providerModelHelper = new ProviderModelHelper({
      userDataPath: 'C:/mock-user-data',
      getModelConfig: (modelId: string, providerId?: string) =>
        presenter.getModelConfig(modelId, providerId),
      setModelStatus: vi.fn(),
      deleteModelStatus: vi.fn()
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

describe('ConfigPresenter provider DB model mapping', () => {
  beforeEach(() => {
    vi.resetModules()
    storeStates.clear()
    eventBusMocks.on.mockReset()
    eventBusMocks.send.mockReset()
  })

  it('preserves embedding and rerank types from provider DB models', async () => {
    vi.doMock('@/presenter', () => ({
      presenter: {}
    }))

    vi.doMock('../../../../src/main/presenter/configPresenter/providerDbLoader', () => ({
      providerDbLoader: {
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

    const { ConfigPresenter } = await import('../../../../src/main/presenter/configPresenter/index')
    const presenter = Object.assign(Object.create(ConfigPresenter.prototype), {
      supportsReasoningCapability: vi.fn(() => false)
    }) as InstanceType<typeof ConfigPresenter>

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
  })
})
