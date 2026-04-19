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
      }
    >()
)

const eventBusMocks = vi.hoisted(() => ({
  on: vi.fn(),
  send: vi.fn(),
  sendToRenderer: vi.fn()
}))

vi.mock('electron-store', () => ({
  default: class MockElectronStore {
    private readonly state: {
      data: Record<string, unknown>
      get: ReturnType<typeof vi.fn>
      set: ReturnType<typeof vi.fn>
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
  }
}))

vi.mock('@/eventbus', () => ({
  eventBus: {
    on: eventBusMocks.on,
    send: eventBusMocks.send,
    sendToRenderer: eventBusMocks.sendToRenderer
  },
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
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

describe('ProviderModelHelper cache', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-19T00:00:00.000Z'))
    storeStates.clear()
    eventBusMocks.on.mockReset()
    eventBusMocks.send.mockReset()
    eventBusMocks.sendToRenderer.mockReset()
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
})

describe('ConfigPresenter provider model cache invalidation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-19T01:00:00.000Z'))
    storeStates.clear()
    eventBusMocks.on.mockReset()
    eventBusMocks.send.mockReset()
    eventBusMocks.sendToRenderer.mockReset()
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
