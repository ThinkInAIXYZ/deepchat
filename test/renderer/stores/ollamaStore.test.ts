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

const setupStore = async (overrides?: {
  providerClient?: Record<string, any>
  modelStore?: Record<string, any>
  providerStore?: Record<string, any>
}) => {
  vi.resetModules()
  vi.useFakeTimers()

  const providerClient = {
    listOllamaRunningModels: vi.fn(async () => [createModel('qwen3:8b')]),
    listOllamaModels: vi.fn(async () => [createModel('deepseek-r1:1.5b')]),
    refreshModels: vi.fn(async () => undefined),
    pullOllamaModels: vi.fn(async () => true),
    ...overrides?.providerClient
  }
  const modelStore = {
    refreshProviderModels: vi.fn(async () => undefined),
    ...overrides?.modelStore
  }
  const providerStore = {
    providers: [{ id: 'ollama', apiType: 'ollama', enable: true }],
    ...overrides?.providerStore
  }

  vi.doMock('pinia', async () => {
    const actual = await vi.importActual<typeof import('pinia')>('pinia')
    return {
      ...actual,
      defineStore: (_id: string, setup: () => unknown) => setup
    }
  })

  vi.doMock('vue', async () => {
    const actual = await vi.importActual<typeof import('vue')>('vue')
    return {
      ...actual,
      onMounted: vi.fn(),
      onBeforeUnmount: vi.fn()
    }
  })

  vi.doMock('../../../src/renderer/api/ProviderClient', () => ({
    createProviderClient: vi.fn(() => providerClient)
  }))

  vi.doMock('@api/legacy/runtime', () => ({
    createLegacyIpcSubscriptionScope: () => ({
      on: vi.fn(),
      cleanup: vi.fn()
    })
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
    providerClient,
    modelStore
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ollamaStore', () => {
  it('refreshes UI lists, then persists through main refresh and local modelStore refresh', async () => {
    const { store, providerClient, modelStore } = await setupStore()

    await expect(store.refreshOllamaModels('ollama')).resolves.toBe(true)

    expect(store.getOllamaRunningModels('ollama').map((model) => model.name)).toEqual(['qwen3:8b'])
    expect(store.getOllamaLocalModels('ollama').map((model) => model.name)).toEqual([
      'deepseek-r1:1.5b'
    ])
    expect(providerClient.refreshModels).toHaveBeenCalledWith('ollama')
    expect(modelStore.refreshProviderModels).toHaveBeenCalledWith('ollama')
  })

  it('reuses the same refresh chain when pull completes', async () => {
    const { store, providerClient, modelStore } = await setupStore()

    store.handleOllamaModelPullEvent({
      eventId: 'pullOllamaModels',
      providerId: 'ollama',
      modelName: 'deepseek-r1:1.5b',
      status: 'success'
    })

    await vi.advanceTimersByTimeAsync(600)

    expect(providerClient.refreshModels).toHaveBeenCalledWith('ollama')
    expect(modelStore.refreshProviderModels).toHaveBeenCalledWith('ollama')
  })

  it('retries provider initialization after a failed refresh', async () => {
    let shouldFail = true
    const { store, providerClient, modelStore } = await setupStore({
      providerClient: {
        listOllamaModels: vi.fn(async () => {
          if (shouldFail) {
            throw new Error('ollama offline')
          }
          return [createModel('deepseek-r1:1.5b')]
        }),
        listOllamaRunningModels: vi.fn(async () => [])
      }
    })

    await store.ensureProviderReady('ollama')

    shouldFail = false
    await store.ensureProviderReady('ollama')

    expect(providerClient.listOllamaModels).toHaveBeenCalledTimes(2)
    expect(providerClient.refreshModels).toHaveBeenCalledTimes(1)
    expect(modelStore.refreshProviderModels).toHaveBeenCalledTimes(1)
  })

  it('keeps explicit refresh working after the provider is marked ready', async () => {
    const { store, providerClient, modelStore } = await setupStore()

    await store.ensureProviderReady('ollama')
    await expect(store.refreshOllamaModels('ollama')).resolves.toBe(true)

    expect(providerClient.refreshModels).toHaveBeenCalledTimes(2)
    expect(modelStore.refreshProviderModels).toHaveBeenCalledTimes(2)
  })
})
