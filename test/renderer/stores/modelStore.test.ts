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

const setupStore = async (overrides?: { configPresenter?: Record<string, any> }) => {
  vi.resetModules()

  const queryCache = createQueryCache()
  const agentModelStore = {
    refreshAgentModels: vi.fn()
  }
  const modelConfigStore = {
    getModelConfig: vi.fn(async () => null)
  }
  const configPresenter = {
    getDbProviderModels: vi.fn(async () => []),
    getProviderModels: vi.fn(async () => []),
    getCustomModels: vi.fn(async () => []),
    getBatchModelStatus: vi.fn(async () => ({})),
    ...overrides?.configPresenter
  }
  const llmPresenter = {
    getModelList: vi.fn(async () => [])
  }

  vi.doMock('pinia', () => ({
    defineStore: (_id: string, setup: any) => setup
  }))

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
    useProviderStore: () => ({ providers: [] })
  }))

  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: (name: string) => (name === 'configPresenter' ? configPresenter : llmPresenter)
  }))

  vi.doMock('@/composables/useIpcMutation', () => ({
    useIpcMutation: () => ({ mutateAsync: vi.fn() })
  }))

  const { useModelStore } = await import('@/stores/modelStore')
  const store = useModelStore()

  return {
    store,
    agentModelStore,
    configPresenter,
    llmPresenter
  }
}

describe('modelStore.refreshProviderModels', () => {
  it('uses ACP refresh path for acp provider', async () => {
    const { store, agentModelStore, configPresenter } = await setupStore()
    agentModelStore.refreshAgentModels.mockResolvedValue({
      rendererModels: [],
      modelMetas: []
    })

    await store.refreshProviderModels('acp')

    expect(agentModelStore.refreshAgentModels).toHaveBeenCalledWith('acp')
    expect(configPresenter.getDbProviderModels).not.toHaveBeenCalled()
  })

  it('uses standard refresh path for non-acp provider', async () => {
    const { store, agentModelStore, configPresenter } = await setupStore()

    await store.refreshProviderModels('openai')

    expect(agentModelStore.refreshAgentModels).not.toHaveBeenCalled()
    expect(configPresenter.getDbProviderModels).toHaveBeenCalledWith('openai')
    expect(configPresenter.getProviderModels).toHaveBeenCalledWith('openai')
  })

  it('normalizes sparse model metadata with unified fallback defaults', async () => {
    const sparseModel = {
      id: 'gpt-sparse',
      name: 'GPT Sparse',
      providerId: 'openai',
      isCustom: false
    }
    const { store } = await setupStore({
      configPresenter: {
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
})
