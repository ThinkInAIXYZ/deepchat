import { afterEach, describe, expect, it, vi } from 'vitest'

const createModel = (name: string) => ({
  name,
  model: name,
  size: 1,
  digest: `${name}-digest`,
  modified_at: new Date(),
  details: {
    format: 'gguf',
    family: 'llama',
    families: ['llama'],
    parameter_size: '7b',
    quantization_level: 'Q4_K_M'
  },
  model_info: {
    context_length: 8192,
    embedding_length: 0
  },
  capabilities: ['chat']
})

const setupStore = async () => {
  vi.resetModules()
  vi.useFakeTimers()

  const llmPresenter = {
    listOllamaRunningModels: vi.fn(async () => [createModel('qwen3:8b')]),
    listOllamaModels: vi.fn(async () => [createModel('deepseek-r1:1.5b')]),
    refreshModels: vi.fn(async () => undefined),
    pullOllamaModels: vi.fn(async () => true)
  }
  const modelStore = {
    refreshProviderModels: vi.fn(async () => undefined)
  }
  const providerStore = {
    providers: [{ id: 'ollama', apiType: 'ollama', enable: true }]
  }

  ;(window as any).electron = {
    ipcRenderer: {
      on: vi.fn(),
      removeAllListeners: vi.fn()
    }
  }

  vi.doMock('pinia', () => ({
    defineStore: (_id: string, setup: () => unknown) => setup
  }))

  vi.doMock('vue', async () => {
    const actual = await vi.importActual<typeof import('vue')>('vue')
    return {
      ...actual,
      onMounted: vi.fn(),
      onBeforeUnmount: vi.fn()
    }
  })

  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: () => llmPresenter
  }))

  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => modelStore
  }))

  vi.doMock('@/stores/providerStore', () => ({
    useProviderStore: () => providerStore
  }))

  const { useOllamaStore } = await import('@/stores/ollamaStore')

  return {
    store: useOllamaStore(),
    llmPresenter,
    modelStore
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ollamaStore', () => {
  it('refreshes UI lists, then persists through main refresh and local modelStore refresh', async () => {
    const { store, llmPresenter, modelStore } = await setupStore()

    await store.refreshOllamaModels('ollama')

    expect(store.getOllamaRunningModels('ollama').map((model) => model.name)).toEqual(['qwen3:8b'])
    expect(store.getOllamaLocalModels('ollama').map((model) => model.name)).toEqual([
      'deepseek-r1:1.5b'
    ])
    expect(llmPresenter.refreshModels).toHaveBeenCalledWith('ollama')
    expect(modelStore.refreshProviderModels).toHaveBeenCalledWith('ollama')
  })

  it('reuses the same refresh chain when pull completes', async () => {
    const { store, llmPresenter, modelStore } = await setupStore()

    store.handleOllamaModelPullEvent({
      eventId: 'pullOllamaModels',
      providerId: 'ollama',
      modelName: 'deepseek-r1:1.5b',
      status: 'success'
    })

    await vi.advanceTimersByTimeAsync(600)

    expect(llmPresenter.refreshModels).toHaveBeenCalledWith('ollama')
    expect(modelStore.refreshProviderModels).toHaveBeenCalledWith('ollama')
  })
})
