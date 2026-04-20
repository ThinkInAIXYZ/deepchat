import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'

const createQueryCache = () => {
  return {
    ensure: vi.fn((options: any) => ({
      key: options.key,
      query: options.query,
      state: ref({ data: undefined })
    })),
    invalidateQueries: vi.fn(async () => undefined),
    refresh: vi.fn(async (entry: any) => {
      entry.state.value = { data: await entry.query() }
      return entry.state.value
    }),
    fetch: vi.fn(async (entry: any) => {
      entry.state.value = { data: await entry.query() }
      return entry.state.value
    }),
    setQueriesData: vi.fn()
  }
}

const setupStore = async (overrides?: {
  modelClient?: Record<string, any>
  providerStore?: Record<string, any>
}) => {
  vi.resetModules()

  const queryCache = createQueryCache()
  const agentModelStore = {
    refreshAgentModels: vi.fn()
  }
  const modelConfigStore = {
    getModelConfig: vi.fn(async () => null)
  }
  const modelClient = {
    getDbProviderModels: vi.fn(async () => []),
    getProviderModels: vi.fn(async () => []),
    getCustomModels: vi.fn(async () => []),
    getBatchModelStatus: vi.fn(async () => ({})),
    getModelList: vi.fn(async () => []),
    updateModelStatus: vi.fn(async () => undefined),
    addCustomModel: vi.fn(async () => undefined),
    removeCustomModel: vi.fn(async () => true),
    updateCustomModel: vi.fn(async () => true),
    onModelsChanged: vi.fn(() => vi.fn()),
    onModelStatusChanged: vi.fn(() => vi.fn()),
    onModelConfigChanged: vi.fn(() => vi.fn()),
    ...overrides?.modelClient
  }
  const providerStore = {
    providers: [],
    ...overrides?.providerStore
  }

  vi.doMock('pinia', async () => {
    const actual = await vi.importActual<typeof import('pinia')>('pinia')
    return {
      ...actual,
      defineStore: (_id: string, setup: any) => setup
    }
  })

  vi.doMock('@pinia/colada', () => ({
    useQueryCache: () => queryCache
  }))

  vi.doMock('@/stores/agentModelStore', () => ({
    useAgentModelStore: () => agentModelStore
  }))

  vi.doMock('@/stores/modelConfigStore', () => ({
    useModelConfigStore: () => modelConfigStore
  }))

  vi.doMock('@/stores/providerStore', () => ({
    useProviderStore: () => providerStore
  }))

  vi.doMock('../../../src/renderer/api/ModelClient', () => ({
    ModelClient: vi.fn(() => modelClient)
  }))

  vi.doMock('@/composables/useIpcMutation', () => ({
    useIpcMutation: () => ({ mutateAsync: vi.fn() })
  }))

  const { useModelStore } = await import('@/stores/modelStore')
  const store = useModelStore()

  return {
    store,
    agentModelStore,
    modelClient
  }
}

const createDeferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const flushMicrotasks = async (times: number = 6) => {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

describe('modelStore.refreshProviderModels', () => {
  it('registers typed model listeners without legacy provider-db subscriptions', async () => {
    const { store, modelClient } = await setupStore()

    store.setupModelListeners()

    expect(modelClient.onModelsChanged).toHaveBeenCalledTimes(1)
    expect(modelClient.onModelStatusChanged).toHaveBeenCalledTimes(1)
  })

  it('uses ACP refresh path for acp provider', async () => {
    const { store, agentModelStore, modelClient } = await setupStore()
    agentModelStore.refreshAgentModels.mockResolvedValue({
      rendererModels: [],
      modelMetas: []
    })

    await store.refreshProviderModels('acp')

    expect(agentModelStore.refreshAgentModels).toHaveBeenCalledWith('acp')
    expect(modelClient.getDbProviderModels).not.toHaveBeenCalled()
  })

  it('uses standard refresh path for non-acp provider', async () => {
    const { store, agentModelStore, modelClient } = await setupStore()

    await store.refreshProviderModels('openai')

    expect(agentModelStore.refreshAgentModels).not.toHaveBeenCalled()
    expect(modelClient.getDbProviderModels).toHaveBeenCalledWith('openai')
    expect(modelClient.getProviderModels).toHaveBeenCalledWith('openai')
  })

  it('merges same-tick concurrent refreshes into a single provider fetch', async () => {
    const deferredModels = createDeferred<any[]>()
    const model = {
      id: 'gpt-5',
      name: 'GPT-5',
      providerId: 'openai',
      maxTokens: 8192,
      contextLength: 128000,
      isCustom: false
    }
    const { store, modelClient } = await setupStore({
      modelClient: {
        getDbProviderModels: vi.fn(async () => []),
        getProviderModels: vi.fn(() => deferredModels.promise),
        getCustomModels: vi.fn(async () => []),
        getBatchModelStatus: vi.fn(async () => ({ 'gpt-5': true }))
      }
    })

    const firstRefresh = store.refreshProviderModels('openai')
    const secondRefresh = store.refreshProviderModels('openai')

    await flushMicrotasks()

    expect(firstRefresh).toBe(secondRefresh)
    expect(modelClient.getProviderModels).toHaveBeenCalledTimes(1)

    deferredModels.resolve([model])
    await Promise.all([firstRefresh, secondRefresh])

    expect(modelClient.getProviderModels).toHaveBeenCalledTimes(1)
  })

  it('reruns one more provider refresh when another request arrives mid-flight', async () => {
    const deferredModels = createDeferred<any[]>()
    const model = {
      id: 'gpt-5.1',
      name: 'GPT-5.1',
      providerId: 'openai',
      maxTokens: 8192,
      contextLength: 128000,
      isCustom: false
    }
    const { store, modelClient } = await setupStore({
      modelClient: {
        getDbProviderModels: vi.fn(async () => []),
        getProviderModels: vi
          .fn()
          .mockImplementationOnce(() => deferredModels.promise)
          .mockResolvedValue([model]),
        getCustomModels: vi.fn(async () => []),
        getBatchModelStatus: vi.fn(async () => ({ 'gpt-5.1': true }))
      }
    })

    const firstRefresh = store.refreshProviderModels('openai')

    await flushMicrotasks()
    expect(modelClient.getProviderModels).toHaveBeenCalledTimes(1)

    const secondRefresh = store.refreshProviderModels('openai')

    deferredModels.resolve([model])
    await Promise.all([firstRefresh, secondRefresh])

    expect(firstRefresh).toBe(secondRefresh)
    expect(modelClient.getProviderModels).toHaveBeenCalledTimes(2)
  })

  it('normalizes sparse model metadata with unified fallback defaults', async () => {
    const sparseModel = {
      id: 'gpt-sparse',
      name: 'GPT Sparse',
      providerId: 'openai',
      isCustom: false
    }
    const { store } = await setupStore({
      modelClient: {
        getDbProviderModels: vi.fn(async () => []),
        getProviderModels: vi.fn(async () => [sparseModel]),
        getBatchModelStatus: vi.fn(async () => ({ 'gpt-sparse': true }))
      }
    })

    await store.refreshProviderModels('openai')

    expect(store.allProviderModels.value).toEqual([
      {
        providerId: 'openai',
        models: [
          expect.objectContaining({
            id: 'gpt-sparse',
            contextLength: 16000,
            maxTokens: 4096,
            vision: false,
            functionCall: true
          })
        ]
      }
    ])
    expect(store.enabledModels.value).toEqual([
      {
        providerId: 'openai',
        models: [
          expect.objectContaining({
            id: 'gpt-sparse',
            contextLength: 16000,
            maxTokens: 4096,
            vision: false,
            functionCall: true
          })
        ]
      }
    ])
  })

  it('keeps db-backed reasoning capability for standard models when stored config defaults it off', async () => {
    const dbModel = {
      id: 'gpt-5.4',
      name: 'GPT-5.4',
      providerId: 'openai',
      reasoning: true,
      functionCall: true,
      vision: false,
      contextLength: 400000,
      maxTokens: 128000,
      isCustom: false
    }
    const storedModel = {
      id: 'gpt-5.4',
      name: 'GPT-5.4',
      providerId: 'openai',
      reasoning: false,
      functionCall: true,
      vision: false,
      isCustom: false
    }
    const { store } = await setupStore({
      modelClient: {
        getDbProviderModels: vi.fn(async () => [dbModel]),
        getProviderModels: vi.fn(async () => [storedModel]),
        getBatchModelStatus: vi.fn(async () => ({ 'gpt-5.4': true }))
      }
    })

    await store.refreshProviderModels('openai')

    expect(store.allProviderModels.value).toEqual([
      {
        providerId: 'openai',
        models: [
          expect.objectContaining({
            id: 'gpt-5.4',
            reasoning: true
          })
        ]
      }
    ])
    expect(store.enabledModels.value).toEqual([
      {
        providerId: 'openai',
        models: [
          expect.objectContaining({
            id: 'gpt-5.4',
            reasoning: true
          })
        ]
      }
    ])
  })

  it('caps derived maxTokens for merged standard models', async () => {
    const dbModel = {
      id: 'gpt-5.4',
      name: 'GPT-5.4',
      providerId: 'openai',
      reasoning: true,
      functionCall: true,
      vision: false,
      contextLength: 400000,
      maxTokens: 128000,
      isCustom: false
    }
    const storedModel = {
      id: 'gpt-5.4',
      name: 'GPT-5.4',
      providerId: 'openai',
      functionCall: true,
      vision: false,
      contextLength: 400000,
      maxTokens: 64000,
      isCustom: false
    }
    const { store } = await setupStore({
      modelClient: {
        getDbProviderModels: vi.fn(async () => [dbModel]),
        getProviderModels: vi.fn(async () => [storedModel]),
        getBatchModelStatus: vi.fn(async () => ({ 'gpt-5.4': true }))
      }
    })

    await store.refreshProviderModels('openai')

    expect(store.allProviderModels.value).toEqual([
      {
        providerId: 'openai',
        models: [
          expect.objectContaining({
            id: 'gpt-5.4',
            maxTokens: 32000
          })
        ]
      }
    ])
  })

  it('uses stored reasoning metadata when no db capability fallback exists', async () => {
    const storedModel = {
      id: 'custom-chat',
      name: 'Custom Chat',
      providerId: 'openai',
      reasoning: true,
      functionCall: false,
      vision: false,
      isCustom: false
    }
    const { store } = await setupStore({
      modelClient: {
        getDbProviderModels: vi.fn(async () => []),
        getProviderModels: vi.fn(async () => [storedModel]),
        getBatchModelStatus: vi.fn(async () => ({ 'custom-chat': true }))
      }
    })

    await store.refreshProviderModels('openai')

    expect(store.allProviderModels.value).toEqual([
      {
        providerId: 'openai',
        models: [
          expect.objectContaining({
            id: 'custom-chat',
            reasoning: true
          })
        ]
      }
    ])
  })

  it('caps derived maxTokens for stored-only standard models', async () => {
    const storedModel = {
      id: 'custom-chat',
      name: 'Custom Chat',
      providerId: 'openai',
      reasoning: true,
      functionCall: false,
      vision: false,
      contextLength: 200000,
      maxTokens: 128000,
      isCustom: false
    }
    const { store } = await setupStore({
      modelClient: {
        getDbProviderModels: vi.fn(async () => []),
        getProviderModels: vi.fn(async () => [storedModel]),
        getBatchModelStatus: vi.fn(async () => ({ 'custom-chat': true }))
      }
    })

    await store.refreshProviderModels('openai')

    expect(store.allProviderModels.value).toEqual([
      {
        providerId: 'openai',
        models: [
          expect.objectContaining({
            id: 'custom-chat',
            maxTokens: 32000
          })
        ]
      }
    ])
  })

  it('persists ollama model status changes through llm presenter', async () => {
    const { store, modelClient } = await setupStore({
      providerStore: {
        providers: [{ id: 'ollama', apiType: 'ollama' }]
      },
      modelClient: {
        getDbProviderModels: vi.fn(async () => []),
        getProviderModels: vi.fn(async () => [
          {
            id: 'deepseek-r1:1.5b',
            name: 'deepseek-r1:1.5b',
            providerId: 'ollama',
            isCustom: false
          }
        ]),
        getBatchModelStatus: vi.fn(async () => ({ 'deepseek-r1:1.5b': true }))
      }
    })

    await store.refreshProviderModels('ollama')
    await store.updateModelStatus('ollama', 'deepseek-r1:1.5b', false)

    expect(modelClient.updateModelStatus).toHaveBeenCalledWith('ollama', 'deepseek-r1:1.5b', false)
  })
})
