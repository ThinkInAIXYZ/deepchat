import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const createDeferred = <T = unknown>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const flushMicrotasks = async (times: number = 8) => {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

async function setupStore() {
  vi.resetModules()

  const source = ref([
    {
      id: 'p1',
      name: 'P1',
      apiType: 'openai',
      apiKey: '',
      baseUrl: 'http://old',
      enable: true
    }
  ])

  const providerClient = {
    getProviderSummaries: vi.fn(async () => source.value),
    getDefaultProviders: vi.fn(async () => []),
    validateDraftProvider: vi.fn(async () => ({ isOk: true, errorMsg: null, models: [] })),
    updateProviderAtomic: vi.fn(async (providerId: string, updates: Record<string, unknown>) => {
      source.value = source.value.map((provider) =>
        provider.id === providerId ? { ...provider, ...updates } : provider
      )
      return false
    }),
    setProviderById: vi.fn(async () => undefined),
    addProviderAtomic: vi.fn(async () => undefined),
    removeProviderAtomic: vi.fn(async () => undefined),
    reorderProvidersAtomic: vi.fn(async () => undefined),
    testConnection: vi.fn(async () => ({ isOk: true, errorMsg: null })),
    onProvidersChanged: vi.fn(() => vi.fn())
  }

  const configClient = {
    getSetting: vi.fn(async () => undefined),
    setSetting: vi.fn(async () => undefined)
  }

  vi.doMock('../../../src/renderer/api/ProviderClient', () => ({
    createProviderClient: () => providerClient
  }))
  vi.doMock('../../../src/renderer/api/ConfigClient', () => ({
    createConfigClient: () => configClient
  }))
  vi.doMock('@/composables/useIpcQuery', () => ({
    useIpcQuery: (options: { query: () => Promise<unknown> }) => {
      const data = ref<unknown>(undefined)
      void options.query().then((value) => {
        data.value = value
      })
      return {
        data,
        refetch: async () => {
          data.value = await options.query()
        }
      }
    }
  }))
  vi.doMock('pinia', async () => {
    const actual = await vi.importActual<typeof import('pinia')>('pinia')
    return {
      ...actual,
      defineStore: (_id: string, setup: () => unknown) => setup
    }
  })

  const { useProviderStore } = await import('@/stores/providerStore')
  const store = useProviderStore()

  return { store, providerClient, configClient }
}

describe('providerStore.stageProviderApiChange', () => {
  it('serializes overlapping key and endpoint edits per provider', async () => {
    const { store, providerClient } = await setupStore()

    const deferreds: ReturnType<typeof createDeferred<{ isOk: boolean }>>[] = []
    let inFlight = 0
    let maxInFlight = 0
    const stagedDrafts: Array<Record<string, unknown>> = []

    providerClient.validateDraftProvider.mockImplementation(
      async (draft: Record<string, unknown>) => {
        stagedDrafts.push(draft)
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        const deferred = createDeferred<{ isOk: boolean }>()
        deferreds.push(deferred)
        return deferred.promise.finally(() => {
          inFlight -= 1
        })
      }
    )

    const keyEdit = store.stageProviderApiChange('p1', { apiKey: 'K1' })
    const baseEdit = store.stageProviderApiChange('p1', { baseUrl: 'U1' })
    await flushMicrotasks()

    // Only the first edit may be validating while the second is queued.
    expect(deferreds).toHaveLength(1)

    deferreds[0].resolve({ isOk: true })
    await keyEdit
    await flushMicrotasks()

    // The endpoint edit validates against the state that already includes the
    // committed key, so a never-validated combination cannot be persisted.
    expect(deferreds).toHaveLength(2)
    expect(stagedDrafts[1]).toMatchObject({ apiKey: 'K1', baseUrl: 'U1' })

    deferreds[1].resolve({ isOk: true })
    await baseEdit

    expect(maxInFlight).toBe(1)
    expect(providerClient.updateProviderAtomic).toHaveBeenCalledTimes(2)
    expect(providerClient.updateProviderAtomic).toHaveBeenNthCalledWith(1, 'p1', {
      apiKey: 'K1'
    })
    expect(providerClient.updateProviderAtomic).toHaveBeenNthCalledWith(2, 'p1', {
      baseUrl: 'U1'
    })
  })

  it('keeps the previous configuration when the first queued edit fails validation', async () => {
    const { store, providerClient } = await setupStore()

    const deferreds: ReturnType<typeof createDeferred<{ isOk: boolean }>>[] = []
    const stagedDrafts: Array<Record<string, unknown>> = []

    providerClient.validateDraftProvider.mockImplementation(
      async (draft: Record<string, unknown>) => {
        stagedDrafts.push(draft)
        const deferred = createDeferred<{ isOk: boolean }>()
        deferreds.push(deferred)
        return deferred.promise
      }
    )

    const keyEdit = store.stageProviderApiChange('p1', { apiKey: 'K1' })
    const baseEdit = store.stageProviderApiChange('p1', { baseUrl: 'U1' })
    await flushMicrotasks()

    // The queued key edit fails verification before the endpoint edit runs.
    deferreds[0].resolve({ isOk: false })
    await keyEdit
    await flushMicrotasks()

    // The endpoint edit then validates against the unchanged key.
    expect(deferreds).toHaveLength(2)
    expect(stagedDrafts[1]).toMatchObject({ apiKey: '', baseUrl: 'U1' })

    deferreds[1].resolve({ isOk: true })
    await baseEdit

    // Only the valid endpoint edit is persisted; the rejected key is not.
    expect(providerClient.updateProviderAtomic).toHaveBeenCalledTimes(1)
    expect(providerClient.updateProviderAtomic).toHaveBeenNthCalledWith(1, 'p1', {
      baseUrl: 'U1'
    })
  })

  it('validates configured custom headers atomically before persisting them', async () => {
    const { store, providerClient, configClient } = await setupStore()
    await store.markProviderConfigured('p1')
    providerClient.updateProviderAtomic.mockClear()
    configClient.setSetting.mockClear()

    providerClient.validateDraftProvider.mockResolvedValueOnce({
      isOk: false,
      errorMsg: 'Connection failed',
      models: []
    })
    const rejected = await store.saveProviderCustomHeaders('p1', {
      'X-Tenant-ID': 'rejected-team'
    })

    expect(rejected).toEqual({ isOk: false, errorMsg: 'Connection failed' })
    expect(providerClient.updateProviderAtomic).not.toHaveBeenCalled()

    providerClient.validateDraftProvider.mockResolvedValueOnce({
      isOk: true,
      errorMsg: null,
      models: []
    })
    const accepted = await store.saveProviderCustomHeaders('p1', {
      'X-Tenant-ID': 'team-a',
      'CF-Access-Client-Secret': 'secret'
    })

    expect(accepted).toEqual({ isOk: true, errorMsg: null })
    expect(providerClient.validateDraftProvider).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 'p1',
        customHeaders: {
          'X-Tenant-ID': 'team-a',
          'CF-Access-Client-Secret': 'secret'
        }
      }),
      { loadModels: false }
    )
    expect(providerClient.updateProviderAtomic).toHaveBeenCalledWith('p1', {
      customHeaders: {
        'X-Tenant-ID': 'team-a',
        'CF-Access-Client-Secret': 'secret'
      }
    })
    expect(configClient.setSetting).toHaveBeenCalledWith(
      'providerHealth',
      expect.objectContaining({
        p1: expect.objectContaining({ status: 'verified', fingerprint: expect.any(String) })
      })
    )
    const healthWrite = configClient.setSetting.mock.calls.find(([key]) => key === 'providerHealth')
    expect(JSON.stringify(healthWrite)).not.toContain('secret')
  })
})
