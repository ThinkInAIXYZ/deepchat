import { describe, it, expect, vi } from 'vitest'
import { reactive } from 'vue'
import type { RENDERER_MODEL_META } from '../../../src/shared/types/provider'
import type { ProviderCatalogSnapshot } from '../../../src/shared/types/providerCatalog'
import { ModelType } from '../../../src/shared/model'

const catalogModel = (
  id: string,
  overrides: Partial<RENDERER_MODEL_META> = {}
): RENDERER_MODEL_META => ({
  id,
  name: id,
  group: 'default',
  providerId: 'openai',
  enabled: false,
  isCustom: false,
  contextLength: 16_000,
  maxTokens: 4_096,
  vision: false,
  functionCall: true,
  reasoning: false,
  enableSearch: false,
  type: ModelType.Chat,
  ...overrides
})

const catalogSnapshot = (
  providerId: string,
  models: RENDERER_MODEL_META[],
  overrides: Partial<ProviderCatalogSnapshot> = {}
): ProviderCatalogSnapshot => ({
  providerId,
  revision: 1,
  status: 'fresh',
  fetchedAt: 1_000,
  source: 'remote',
  lastErrorCode: null,
  models,
  ...overrides
})

const setupStore = async (overrides?: {
  providerStore?: Record<string, any>
  catalogs?: Record<string, RENDERER_MODEL_META[]>
  modelClient?: Record<string, any>
}) => {
  vi.resetModules()

  const catalogs = overrides?.catalogs ?? {}
  const agentModelStore = {
    refreshAgentModels: vi.fn(async () => ({ rendererModels: [], modelMetas: [] }))
  }
  const modelClient = {
    updateModelStatus: vi.fn(async () => undefined),
    setBatchModelStatus: vi.fn(async () => undefined),
    addCustomModel: vi.fn(async () => undefined),
    saveCustomModel: vi.fn(async () => undefined),
    removeCustomModel: vi.fn(async () => true),
    updateCustomModel: vi.fn(async () => true),
    onModelsChanged: vi.fn(() => vi.fn()),
    onModelStatusChanged: vi.fn(() => vi.fn()),
    onModelBatchStatusChanged: vi.fn(() => vi.fn()),
    ...overrides?.modelClient
  }
  const catalogClient = {
    getCatalog: vi.fn(async (providerId: string) =>
      catalogSnapshot(providerId, catalogs[providerId] ?? [])
    ),
    listCatalogs: vi.fn(async (providerIds: string[]) =>
      providerIds.map((providerId) => catalogSnapshot(providerId, catalogs[providerId] ?? []))
    ),
    refreshCatalog: vi.fn(),
    ensureFresh: vi.fn(async () => false),
    onCatalogChanged: vi.fn(() => vi.fn())
  }
  const providerRecords = overrides?.providerStore?.providers ?? [
    { id: 'openai', enable: true, name: 'OpenAI' },
    { id: 'acp', enable: true, name: 'ACP' }
  ]
  const providerStore = reactive({
    providers: providerRecords,
    sortedProviders:
      overrides?.providerStore?.sortedProviders ??
      providerRecords.map((provider) => ({
        ...provider,
        apiType: provider.apiType ?? 'openai'
      })),
    ensureInitialized: vi.fn(async () => undefined),
    ...overrides?.providerStore
  })

  vi.doMock('pinia', async () => {
    const actual = await vi.importActual<typeof import('pinia')>('pinia')
    return {
      ...actual,
      defineStore: (_id: string, setup: any) => setup
    }
  })

  vi.doMock('@/stores/agentModelStore', () => ({
    useAgentModelStore: () => agentModelStore
  }))

  vi.doMock('@/stores/providerStore', () => ({
    useProviderStore: () => providerStore
  }))

  vi.doMock('@/stores/uiSettingsStore', () => ({
    useUiSettingsStore: () => ({ traceDebugEnabled: false })
  }))

  vi.doMock('../../../src/renderer/api/ModelClient', () => ({
    createModelClient: vi.fn(() => modelClient)
  }))

  vi.doMock('../../../src/renderer/api/ProviderCatalogClient', () => ({
    createProviderCatalogClient: vi.fn(() => catalogClient)
  }))

  const { useModelStore } = await import('@/stores/modelStore')
  const store = useModelStore()

  return {
    store,
    agentModelStore,
    modelClient,
    catalogClient,
    providerStore
  }
}

const flushMicrotasks = async (times: number = 6) => {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

const createDeferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('modelStore.refreshProviderModels', () => {
  it('materializes the catalog snapshot into provider, custom, and enabled groups', async () => {
    const { store } = await setupStore({
      catalogs: {
        openai: [
          catalogModel('gpt-5', { enabled: true }),
          catalogModel('gpt-5-embed', { type: ModelType.Embedding }),
          catalogModel('my-custom', { isCustom: true, enabled: true })
        ]
      }
    })

    expect(await store.refreshProviderModels('openai', false)).toBe(true)

    expect(store.allProviderModels.value).toEqual([
      {
        providerId: 'openai',
        models: [
          expect.objectContaining({ id: 'gpt-5', enabled: true }),
          expect.objectContaining({ id: 'gpt-5-embed', enabled: false })
        ]
      }
    ])
    expect(store.customModels.value).toEqual([
      { providerId: 'openai', models: [expect.objectContaining({ id: 'my-custom' })] }
    ])
    expect(
      store.enabledModels.value.flatMap((group) => group.models.map((model) => model.id))
    ).toEqual(['gpt-5', 'my-custom'])
  })

  it('preserves the displayed catalog when the snapshot read fails', async () => {
    const { store, catalogClient } = await setupStore({
      catalogs: { openai: [catalogModel('gpt-5')] }
    })
    expect(await store.refreshProviderModels('openai', false)).toBe(true)

    catalogClient.getCatalog.mockRejectedValueOnce(new Error('main process unavailable'))
    expect(await store.refreshProviderModels('openai', false)).toBe(false)
    expect(store.allProviderModels.value[0].models.map((model) => model.id)).toEqual(['gpt-5'])

    catalogClient.getCatalog.mockResolvedValueOnce(
      catalogSnapshot('openai', [catalogModel('gpt-6')])
    )
    expect(await store.refreshProviderModels('openai', false)).toBe(true)
    expect(store.allProviderModels.value[0].models.map((model) => model.id)).toEqual(['gpt-6'])
  })

  it('requests background revalidation only when discovery is enabled', async () => {
    const { store, catalogClient } = await setupStore({
      catalogs: { openai: [catalogModel('gpt-5')] }
    })

    await store.refreshProviderModels('openai', false)
    expect(catalogClient.ensureFresh).not.toHaveBeenCalled()

    await store.refreshProviderModels('openai', true)
    expect(catalogClient.ensureFresh).toHaveBeenCalledWith('openai')

    await store.refreshProviderModels('openai')
    expect(catalogClient.ensureFresh).toHaveBeenCalledTimes(2)
  })

  it('does not schedule revalidation for disabled providers by default', async () => {
    const { store, catalogClient } = await setupStore({
      providerStore: { providers: [{ id: 'offline', enable: false }] },
      catalogs: { offline: [] }
    })

    await store.refreshProviderModels('offline')
    expect(catalogClient.ensureFresh).not.toHaveBeenCalled()
  })

  it('coalesces concurrent refreshes for the same provider', async () => {
    const deferred = createDeferred<ProviderCatalogSnapshot>()
    const { store, catalogClient } = await setupStore()
    catalogClient.getCatalog.mockImplementationOnce(() => deferred.promise)

    const firstRefresh = store.refreshProviderModels('openai', false)
    const secondRefresh = store.refreshProviderModels('openai', false)
    expect(firstRefresh).toBe(secondRefresh)

    deferred.resolve(catalogSnapshot('openai', [catalogModel('gpt-5')]))
    await Promise.all([firstRefresh, secondRefresh])

    expect(catalogClient.getCatalog).toHaveBeenCalledTimes(1)
    expect(store.allProviderModels.value[0].models.map((model) => model.id)).toEqual(['gpt-5'])
  })

  it('uses the ACP agent path instead of the catalog snapshot', async () => {
    const { store, agentModelStore, catalogClient } = await setupStore()

    await store.refreshProviderModels('acp', false)

    expect(agentModelStore.refreshAgentModels).toHaveBeenCalledWith('acp')
    expect(catalogClient.getCatalog).not.toHaveBeenCalled()
  })

  it('exposes only enabled provider groups through activeEnabledModels', async () => {
    const { store } = await setupStore({
      providerStore: {
        providers: [
          { id: 'openai', enable: true },
          { id: 'deepseek', enable: false }
        ]
      }
    })

    store.enabledModels.value = [
      {
        providerId: 'openai',
        models: [catalogModel('gpt-5')]
      },
      {
        providerId: 'deepseek',
        models: [catalogModel('deepseek-chat', { providerId: 'deepseek' })]
      }
    ]

    expect(store.activeEnabledModels.value).toEqual([
      {
        providerId: 'openai',
        models: [expect.objectContaining({ id: 'gpt-5' })]
      }
    ])
  })

  it('bumps the chat selectable revision for provider and in-place model changes', async () => {
    const { store, providerStore } = await setupStore({
      providerStore: {
        providers: [
          { id: 'openai', enable: true, name: 'OpenAI' },
          { id: 'anthropic', enable: true, name: 'Anthropic' }
        ],
        sortedProviders: [
          { id: 'openai', enable: true, name: 'OpenAI' },
          { id: 'anthropic', enable: true, name: 'Anthropic' }
        ]
      }
    })
    await flushMicrotasks()

    const initialRevision = store.chatSelectableModelGroupsRevision.value
    store.enabledModels.value = [
      { providerId: 'openai', models: [catalogModel('gpt-5', { enabled: true })] }
    ]
    await flushMicrotasks()
    expect(store.chatSelectableModelGroupsRevision.value).toBeGreaterThan(initialRevision)
    expect(store.chatSelectableModelGroups.value).toEqual([
      expect.objectContaining({
        providerId: 'openai',
        providerName: 'OpenAI',
        models: [expect.objectContaining({ id: 'gpt-5' })]
      })
    ])

    const afterModelsRevision = store.chatSelectableModelGroupsRevision.value
    store.enabledModels.value[0].models.push(
      catalogModel('gpt-5-embed', { type: ModelType.Embedding, enabled: true })
    )
    await flushMicrotasks()
    expect(store.chatSelectableModelGroupsRevision.value).toBeGreaterThan(afterModelsRevision)
    expect(store.chatSelectableModelGroups.value[0].models.map((model) => model.id)).toEqual([
      'gpt-5'
    ])

    const afterTypeRevision = store.chatSelectableModelGroupsRevision.value
    store.enabledModels.value[0].models[1].type = ModelType.Chat
    await flushMicrotasks()
    expect(store.chatSelectableModelGroupsRevision.value).toBeGreaterThan(afterTypeRevision)

    const afterRenameRevision = store.chatSelectableModelGroupsRevision.value
    providerStore.sortedProviders[0].name = 'OpenAI Renamed'
    await flushMicrotasks()
    expect(store.chatSelectableModelGroupsRevision.value).toBeGreaterThan(afterRenameRevision)
    expect(store.chatSelectableModelGroups.value[0].providerName).toBe('OpenAI Renamed')
  })

  it('purges deleted providers from local model state', async () => {
    const { store, providerStore } = await setupStore({
      providerStore: {
        providers: [
          { id: 'openai', enable: true },
          { id: 'deepseek', enable: true }
        ]
      }
    })

    store.allProviderModels.value = [
      { providerId: 'openai', models: [catalogModel('gpt-5')] },
      { providerId: 'deepseek', models: [catalogModel('deepseek-chat')] }
    ]
    store.enabledModels.value = [...store.allProviderModels.value]
    store.customModels.value = [
      { providerId: 'deepseek', models: [catalogModel('deepseek-custom', { isCustom: true })] }
    ]

    providerStore.providers = [{ id: 'openai', enable: true }]
    await flushMicrotasks()

    expect(store.allProviderModels.value).toEqual([
      { providerId: 'openai', models: [expect.objectContaining({ id: 'gpt-5' })] }
    ])
    expect(store.enabledModels.value).toEqual([
      { providerId: 'openai', models: [expect.objectContaining({ id: 'gpt-5' })] }
    ])
    expect(store.customModels.value).toEqual([])
  })
})

describe('modelStore listeners', () => {
  it('reloads the snapshot when the catalog service reports a change', async () => {
    let catalogChangedListener: ((payload: { providerId: string }) => void) | undefined
    const { store, catalogClient } = await setupStore({
      catalogs: { openai: [catalogModel('gpt-5')] }
    })
    catalogClient.onCatalogChanged.mockImplementation((listener) => {
      catalogChangedListener = listener
      return vi.fn()
    })

    store.setupModelListeners()
    catalogChangedListener?.({ providerId: 'openai' })
    await vi.waitFor(() => expect(store.allProviderModels.value[0]?.models[0]?.id).toBe('gpt-5'))
    expect(catalogClient.getCatalog).toHaveBeenCalledWith('openai')
  })

  it('keeps models.changed for non-catalog writers and ignores provider-db reasons', async () => {
    let modelsChangedListener:
      | ((payload: { reason: string; providerId?: string }) => Promise<void> | void)
      | undefined
    const { store, catalogClient, modelClient } = await setupStore()
    modelClient.onModelsChanged.mockImplementation((listener) => {
      modelsChangedListener = listener
      return vi.fn()
    })
    catalogClient.getCatalog.mockClear()

    store.setupModelListeners()

    await modelsChangedListener?.({ reason: 'provider-db-updated' })
    expect(catalogClient.getCatalog).not.toHaveBeenCalled()

    await modelsChangedListener?.({ providerId: 'openai' })
    expect(catalogClient.getCatalog).toHaveBeenCalledWith('openai')
  })
})

describe('modelStore model status', () => {
  it('persists status changes and updates the enabled groups', async () => {
    const { store, modelClient } = await setupStore({
      catalogs: { openai: [catalogModel('gpt-5')] }
    })
    await store.refreshProviderModels('openai', false)

    const updated = await store.updateModelStatus('openai', 'gpt-5', true)

    expect(modelClient.updateModelStatus).toHaveBeenCalledWith('openai', 'gpt-5', true)
    expect(updated).toBe(true)
    expect(store.enabledModels.value[0].models.map((model) => model.id)).toEqual(['gpt-5'])
  })

  it('returns false and rolls back when status persistence fails', async () => {
    const { store } = await setupStore({
      catalogs: { openai: [catalogModel('gpt-5')] },
      modelClient: { updateModelStatus: vi.fn().mockRejectedValue(new Error('backend failure')) }
    })
    await store.refreshProviderModels('openai', false)

    const updated = await store.updateModelStatus('openai', 'gpt-5', true)

    expect(updated).toBe(false)
    expect(store.allProviderModels.value[0].models[0].enabled).toBe(false)
    expect(store.enabledModels.value).toEqual([])
  })

  it('rolls back batch enablement when persistence fails', async () => {
    const { store } = await setupStore({
      catalogs: { openai: [catalogModel('gpt-5'), catalogModel('gpt-5-mini')] },
      modelClient: { setBatchModelStatus: vi.fn().mockRejectedValue(new Error('ipc failed')) }
    })
    await store.refreshProviderModels('openai', false)

    await expect(store.enableAllModels('openai')).rejects.toThrow('ipc failed')
    expect(store.enabledModels.value).toEqual([])
  })
})

describe('modelStore.initialize', () => {
  it('loads every enabled catalog once and schedules revalidation', async () => {
    const { store, catalogClient, agentModelStore } = await setupStore({
      providerStore: {
        providers: [
          { id: 'openai', enable: true },
          { id: 'anthropic', enable: true },
          { id: 'acp', enable: true },
          { id: 'disabled', enable: false }
        ]
      },
      catalogs: {
        openai: [catalogModel('gpt-5', { enabled: true })],
        anthropic: [catalogModel('claude', { providerId: 'anthropic', enabled: true })]
      }
    })

    await store.initialize()

    expect(store.initialized.value).toBe(true)
    expect(store.initializationError.value).toBeNull()
    expect(catalogClient.listCatalogs).toHaveBeenCalledExactlyOnceWith([
      'openai',
      'anthropic',
      'acp'
    ])
    expect(catalogClient.ensureFresh).toHaveBeenCalledWith('openai')
    expect(catalogClient.ensureFresh).toHaveBeenCalledWith('anthropic')
    expect(catalogClient.ensureFresh).not.toHaveBeenCalledWith('acp')
    expect(agentModelStore.refreshAgentModels).toHaveBeenCalledWith('acp')
    expect(store.enabledModels.value.map((group) => group.providerId).sort()).toEqual([
      'anthropic',
      'openai'
    ])
  })

  it('still initializes when the catalog list is unavailable', async () => {
    const { store, catalogClient } = await setupStore()
    catalogClient.listCatalogs.mockRejectedValueOnce(new Error('main process unavailable'))

    await store.initialize()

    expect(store.initialized.value).toBe(true)
    expect(store.initializationError.value).toBeNull()
  })

  it('reuses a ready provider catalog without re-reading it', async () => {
    const { store, catalogClient } = await setupStore({
      catalogs: { openai: [catalogModel('gpt-5')] }
    })

    await store.ensureProviderModelsReady('openai')
    await store.ensureProviderModelsReady('openai')

    expect(catalogClient.getCatalog).toHaveBeenCalledTimes(1)
  })
})

describe('modelStore.applyInitialModelRecommendations', () => {
  const createProviderModels = () => [
    catalogModel('chat-1'),
    catalogModel('embed-1', { type: ModelType.Embedding }),
    catalogModel('chat-2'),
    catalogModel('chat-3'),
    catalogModel('chat-4')
  ]

  it('preselects up to three chat-typed models when nothing is enabled yet', async () => {
    const { store, modelClient } = await setupStore({
      catalogs: { openai: createProviderModels() }
    })

    const applied = await store.applyInitialModelRecommendations('openai')

    expect(modelClient.updateModelStatus.mock.calls.map((call: unknown[]) => call[1])).toEqual([
      'chat-1',
      'chat-2',
      'chat-3'
    ])
    expect(applied).toBe(3)
  })

  it('counts only models whose activation actually succeeds', async () => {
    const { store } = await setupStore({
      catalogs: { openai: createProviderModels() },
      modelClient: {
        updateModelStatus: vi.fn(async (_providerId: string, modelId: string) => {
          if (modelId === 'chat-2') {
            throw new Error('ipc failed')
          }
        })
      }
    })

    const applied = await store.applyInitialModelRecommendations('openai')

    expect(applied).toBe(2)
  })

  it('never overwrites an existing selection', async () => {
    const { store, modelClient } = await setupStore({
      catalogs: {
        openai: createProviderModels().map((model) =>
          model.id === 'chat-4' ? { ...model, enabled: true } : model
        )
      }
    })

    await store.applyInitialModelRecommendations('openai')

    expect(modelClient.updateModelStatus).not.toHaveBeenCalled()
  })
})
