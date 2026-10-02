import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

async function setupStore() {
  vi.resetModules()
  const source = ref([
    {
      id: 'p1',
      name: 'P1',
      apiType: 'openai',
      apiKey: 'old-key',
      baseUrl: 'http://old',
      enable: true
    }
  ])
  const providerClient = {
    getProviderSummaries: vi.fn(async () => source.value),
    getDefaultProviders: vi.fn(async () => []),
    validateDraftProvider: vi.fn(async () => ({
      isOk: false,
      errorMsg: 'AccessDenied.Unpurchased',
      models: []
    })),
    updateProviderAtomic: vi.fn(async (providerId: string, updates: Record<string, unknown>) => {
      source.value = source.value.map((provider) =>
        provider.id === providerId ? { ...provider, ...updates } : provider
      )
      return false
    }),
    setProviderById: vi.fn(),
    addProviderAtomic: vi.fn(),
    removeProviderAtomic: vi.fn(),
    reorderProvidersAtomic: vi.fn(),
    testConnection: vi.fn(async () => ({ isOk: true, errorMsg: null })),
    onProvidersChanged: vi.fn(() => vi.fn())
  }
  const configClient = {
    getSetting: vi.fn(async (_key: string): Promise<unknown> => undefined),
    setSetting: vi.fn(async () => undefined),
    setAzureApiVersion: vi.fn(async () => undefined)
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
  vi.doMock('pinia', async () => ({
    ...(await vi.importActual<typeof import('pinia')>('pinia')),
    defineStore: (_id: string, setup: () => unknown) => setup
  }))
  const { useProviderStore } = await import('@/stores/providerStore')
  const store = useProviderStore()
  await store.refreshProviders()
  return { store, source, providerClient, configClient }
}

describe('provider connection persistence', () => {
  it.each([
    { location: 'europe-west1' },
    { accountClientEmail: 'other@example.invalid' },
    { apiVersion: 'v1beta1' }
  ])('invalidates health when Vertex connection fields change: %j', async (updates) => {
    const { store } = await setupStore()
    await store.updateProviderConfig('p1', { apiType: 'vertex' })
    await store.checkProvider('p1')
    await store.updateVertexProviderConfig('p1', updates)
    expect(store.getProviderHealth('p1').status).toBe('not_checked')
  })

  it('invalidates an in-flight Azure check when its API version changes', async () => {
    const { store, source, providerClient } = await setupStore()
    source.value[0].id = 'azure-openai'
    await store.refreshProviders()
    let finish!: (result: { isOk: boolean; errorMsg: null }) => void
    providerClient.testConnection.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const check = store.checkProvider('azure-openai')
    await store.setAzureApiVersion('2025-01-01-preview')
    finish({ isOk: true, errorMsg: null })
    await check
    expect(store.getProviderHealth('azure-openai').status).toBe('not_checked')
  })

  it('preserves manual order when enabling or disabling a provider', async () => {
    const { store, source, configClient } = await setupStore()
    source.value = [
      { ...source.value[0], id: 'a', enable: false },
      { ...source.value[0], id: 'b' },
      { ...source.value[0], id: 'c' }
    ]
    configClient.getSetting.mockImplementation(async (key) =>
      key === 'providerOrder' ? ['a', 'b', 'c'] : undefined
    )
    await store.refreshProviders()
    await store.updateProviderStatus('b', false)
    expect(store.sortedProviders.value.map((provider) => provider.id)).toEqual(['a', 'b', 'c'])
    await store.updateProviderStatus('a', true)
    expect(store.sortedProviders.value.map((provider) => provider.id)).toEqual(['a', 'b', 'c'])
  })

  it('invalidates cached health when the OpenAI authentication mode changes', async () => {
    const { store } = await setupStore()
    await store.checkProvider('p1')
    expect(store.getProviderHealth('p1').status).toBe('verified')
    await store.updateProviderConfig('p1', { openaiAuthMode: 'chatgpt' })
    expect(store.getProviderHealth('p1').status).toBe('not_checked')
  })

  it('saves key and URL atomically without requiring access to the default probe model', async () => {
    const { store, source, providerClient, configClient } = await setupStore()
    await store.checkProvider('p1')
    await store.updateProviderApi('p1', 'replacement', 'https://new.example/v1')
    expect(providerClient.updateProviderAtomic).toHaveBeenCalledExactlyOnceWith('p1', {
      apiKey: 'replacement',
      baseUrl: 'https://new.example/v1'
    })
    expect(source.value[0]).toMatchObject({
      apiKey: 'replacement',
      baseUrl: 'https://new.example/v1'
    })
    expect(providerClient.validateDraftProvider).not.toHaveBeenCalled()
    expect(store.getProviderHealth('p1').status).toBe('not_checked')
    await store.checkProvider('p1', 'qwen3.8-flash')
    expect(providerClient.testConnection).toHaveBeenLastCalledWith({
      providerId: 'p1',
      modelId: 'qwen3.8-flash'
    })
    expect(store.getProviderHealth('p1')).toMatchObject({
      status: 'verified',
      modelId: 'qwen3.8-flash'
    })
    expect(configClient.setSetting).toHaveBeenLastCalledWith('providerHealth', {
      p1: expect.objectContaining({ modelId: 'qwen3.8-flash' })
    })
  })

  it('does not replace persisted configuration when the write fails', async () => {
    const { store, source, providerClient } = await setupStore()
    providerClient.updateProviderAtomic.mockRejectedValueOnce(new Error('write failed'))
    await expect(
      store.updateProviderApi('p1', 'replacement', 'https://new.example')
    ).rejects.toThrow('write failed')
    expect(source.value[0]).toMatchObject({ apiKey: 'old-key', baseUrl: 'http://old' })
  })

  it('saves configured custom headers without remote verification or a false healthy status', async () => {
    const { store, source, providerClient } = await setupStore()
    await store.markProviderConfigured('p1')
    await store.checkProvider('p1')
    expect(await store.saveProviderCustomHeaders('p1', { 'X-Tenant-ID': 'team-a' })).toEqual({
      isOk: true,
      errorMsg: null
    })
    expect(source.value[0]).toMatchObject({ customHeaders: { 'X-Tenant-ID': 'team-a' } })
    expect(providerClient.validateDraftProvider).not.toHaveBeenCalled()
    expect(store.getProviderHealth('p1').status).toBe('not_checked')
  })

  it.each([true, false])(
    'keeps the latest check authoritative when old finishes first: %s',
    async (oldFirst) => {
      const { store, providerClient } = await setupStore()
      let finishOld!: (result: { isOk: boolean; errorMsg: string | null }) => void
      let finishNew!: (result: { isOk: boolean; errorMsg: string | null }) => void
      providerClient.testConnection
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishOld = resolve
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishNew = resolve
            })
        )
      const oldCheck = store.checkProvider('p1', 'denied-model')
      const newCheck = store.checkProvider('p1', 'available-model')
      if (oldFirst) {
        finishOld({ isOk: false, errorMsg: 'late failure' })
        await oldCheck
        expect(store.getProviderHealth('p1').status).toBe('checking')
      }
      finishNew({ isOk: true, errorMsg: null })
      await newCheck
      if (!oldFirst) {
        finishOld({ isOk: false, errorMsg: 'late failure' })
        await oldCheck
      }
      expect(store.getProviderHealth('p1')).toMatchObject({
        status: 'verified',
        modelId: 'available-model'
      })
    }
  )

  it('records the failed model and clears it for a later default-model check', async () => {
    const { store, providerClient } = await setupStore()
    providerClient.testConnection.mockRejectedValueOnce(new Error('model unavailable'))
    await expect(store.checkProvider('p1', 'denied-model')).rejects.toThrow('model unavailable')
    expect(store.getProviderHealth('p1')).toMatchObject({
      status: 'needs_attention',
      modelId: 'denied-model'
    })
    await store.checkProvider('p1')
    expect(store.getProviderHealth('p1').status).toBe('verified')
    expect(store.getProviderHealth('p1').modelId).toBeUndefined()
  })

  it('keeps remote validation for custom-provider creation', async () => {
    const { store, source, providerClient } = await setupStore()
    expect(await store.validateDraftProvider(source.value[0])).toMatchObject({
      isOk: false,
      errorMsg: 'AccessDenied.Unpurchased'
    })
    expect(providerClient.validateDraftProvider).toHaveBeenCalledTimes(1)
    expect(providerClient.updateProviderAtomic).not.toHaveBeenCalled()
  })
})
