import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'

const createQueryCache = () => {
  return {
    ensure: vi.fn((options: any) => ({
      key: options.key,
      state: ref({ data: undefined })
    })),
    invalidateQueries: vi.fn(async () => undefined),
    refresh: vi.fn(async (entry: any) => entry.state.value),
    fetch: vi.fn(async (entry: any) => entry.state.value),
    setQueriesData: vi.fn()
  }
}

const setupStore = async () => {
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
    getBatchModelStatus: vi.fn(async () => ({}))
  }
  const llmPresenter = {
    getModelList: vi.fn(async () => []),
    getProviderById: vi.fn((providerId: string) => ({
      id: providerId,
      apiType: providerId === 'acp' ? 'acp' : 'openai-compatible'
    }))
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
})
