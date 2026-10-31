import { describe, expect, it, vi } from 'vitest'
import type { LLM_PROVIDER, MODEL_META, RENDERER_MODEL_META } from '@shared/types/provider'
import type { ProviderCatalogState, ProviderCatalogStatePatch } from '@shared/types/providerCatalog'
import {
  ProviderCatalogService,
  type ProviderCatalogSettingsPort,
  type ProviderCatalogSourcePort
} from '@/provider/catalog/providerCatalogService'

type CatalogStateOptions = { bumpRevision?: boolean }

const createHarness = (options: {
  providers: LLM_PROVIDER[]
  providerModels?: Record<string, MODEL_META[]>
  customModels?: Record<string, MODEL_META[]>
  dbModels?: Record<string, RENDERER_MODEL_META[]>
  modelStatus?: Record<string, boolean>
  now?: () => number
}) => {
  const providerModels = structuredClone(options.providerModels ?? {})
  const customModels = structuredClone(options.customModels ?? {})
  const dbModels = structuredClone(options.dbModels ?? {})
  const catalogStates = new Map<string, ProviderCatalogState>()
  const now = options.now ?? (() => 1_000)

  const setProviderCatalogState = vi.fn(
    (
      providerId: string,
      patch: ProviderCatalogStatePatch,
      stateOptions: CatalogStateOptions = {}
    ) => {
      const existing = catalogStates.get(providerId)
      const next: ProviderCatalogState = {
        providerId,
        revision: (existing?.revision ?? 0) + (stateOptions.bumpRevision ? 1 : 0),
        fetchedAt: patch.fetchedAt !== undefined ? patch.fetchedAt : (existing?.fetchedAt ?? null),
        source: patch.source !== undefined ? patch.source : (existing?.source ?? null),
        lastRefreshReason:
          patch.lastRefreshReason !== undefined
            ? patch.lastRefreshReason
            : (existing?.lastRefreshReason ?? null),
        lastErrorCode:
          patch.lastErrorCode !== undefined
            ? patch.lastErrorCode
            : (existing?.lastErrorCode ?? null),
        lastErrorAt:
          patch.lastErrorAt !== undefined ? patch.lastErrorAt : (existing?.lastErrorAt ?? null)
      }
      catalogStates.set(providerId, next)
      return next
    }
  )

  const settings = {
    getProviders: vi.fn(() => options.providers),
    getProviderById: vi.fn(
      (providerId: string) =>
        options.providers.find((provider) => provider.id === providerId) ?? undefined
    ),
    getRawProviderModels: vi.fn((providerId: string) => providerModels[providerId] ?? []),
    getRawCustomModels: vi.fn((providerId: string) => customModels[providerId] ?? []),
    getDbProviderModels: vi.fn((providerId: string) => dbModels[providerId] ?? []),
    resolveEffectiveModels: vi.fn((models: MODEL_META[]) => models),
    getBatchModelStatus: vi.fn(
      (_providerId: string, modelIds: string[]) =>
        Object.fromEntries(
          modelIds.map((modelId) => [modelId, options.modelStatus?.[modelId] ?? false])
        ) as Record<string, boolean>
    ),
    setProviderModels: vi.fn((providerId: string, models: MODEL_META[]) => {
      providerModels[providerId] = structuredClone(models)
    }),
    getProviderCatalogState: vi.fn((providerId: string) => catalogStates.get(providerId)),
    setProviderCatalogState,
    deleteProviderCatalogState: vi.fn((providerId: string) => {
      catalogStates.delete(providerId)
    }),
    notifyModelsChanged: vi.fn(),
    refreshProviderDb: vi.fn().mockResolvedValue({ status: 'updated', providersCount: 1 })
  } as unknown as ProviderCatalogSettingsPort

  const source: ProviderCatalogSourcePort = {
    fetchCatalog: vi.fn(),
    reloadModels: vi.fn()
  }
  const publishEvent = vi.fn()
  const service = new ProviderCatalogService({
    settings,
    source,
    publishEvent: publishEvent as never,
    now
  })

  return {
    service,
    settings,
    source,
    publishEvent,
    providerModels,
    customModels,
    catalogStates,
    setProviderCatalogState,
    refreshProviderDb: vi.mocked(settings.refreshProviderDb)
  }
}

const provider = (id: string, overrides: Partial<LLM_PROVIDER> = {}): LLM_PROVIDER =>
  ({
    id,
    name: id,
    apiType: id,
    apiKey: `${id}-key`,
    baseUrl: `https://${id}.example.com`,
    enable: true,
    ...overrides
  }) as LLM_PROVIDER

const model = (id: string, overrides: Partial<MODEL_META> = {}): MODEL_META => ({
  id,
  name: id,
  group: 'default',
  providerId: 'new-api',
  isCustom: false,
  ...overrides
})

describe('ProviderCatalogService', () => {
  it('projects merged catalog sources with status and capability defaults', () => {
    const mistralDbModel = {
      id: 'mistral-large',
      name: 'Mistral Large',
      group: 'default',
      providerId: 'mistral',
      enabled: false,
      isCustom: false
    } as RENDERER_MODEL_META
    const harness = createHarness({
      providers: [provider('mistral')],
      dbModels: { mistral: [mistralDbModel] },
      providerModels: {
        mistral: [model('mistral-large', { providerId: 'mistral', vision: true })]
      },
      customModels: { mistral: [model('my-model', { providerId: 'mistral', isCustom: true })] },
      modelStatus: { 'mistral-large': true, 'my-model': true }
    })

    const snapshot = harness.service.getSnapshot('mistral')

    expect(snapshot).toMatchObject({
      providerId: 'mistral',
      revision: 0,
      status: 'unknown',
      source: 'provider-db',
      fetchedAt: null,
      lastErrorCode: null
    })
    expect(snapshot.models.map((item) => item.id).sort()).toEqual(['mistral-large', 'my-model'])
    expect(snapshot.models.find((item) => item.id === 'mistral-large')).toMatchObject({
      enabled: true,
      isCustom: false,
      vision: true,
      functionCall: true
    })
    expect(snapshot.models.find((item) => item.id === 'my-model')).toMatchObject({
      enabled: true,
      isCustom: true
    })
  })

  it('persists upstream discoveries and reports a diff on user refresh', async () => {
    const harness = createHarness({
      providers: [provider('new-api')],
      providerModels: { 'new-api': [model('old-model'), model('kept-model')] }
    })
    vi.mocked(harness.source.fetchCatalog).mockResolvedValue([
      model('kept-model'),
      model('gpt-6.1-sol', { group: 'openai' })
    ])

    const result = await harness.service.refresh('new-api', 'user')

    expect(result).toMatchObject({
      providerId: 'new-api',
      status: 'ok',
      revision: 1,
      added: ['gpt-6.1-sol'],
      removed: ['old-model'],
      updated: [],
      errorCode: null
    })
    expect(harness.providerModels['new-api'].map((item) => item.id)).toEqual([
      'kept-model',
      'gpt-6.1-sol'
    ])
    expect(harness.settings.notifyModelsChanged).toHaveBeenCalledWith('new-api')
    expect(harness.source.reloadModels).toHaveBeenCalledWith('new-api')
    expect(harness.publishEvent).toHaveBeenCalledWith(
      'providers.catalog.changed',
      expect.objectContaining({
        providerId: 'new-api',
        revision: 1,
        status: 'fresh',
        reason: 'user',
        changed: true,
        added: ['gpt-6.1-sol'],
        removed: ['old-model']
      })
    )
    expect(harness.service.getSnapshot('new-api').status).toBe('fresh')
  })

  it('does not rewrite or notify when the upstream catalog is unchanged', async () => {
    const existing = model('gpt-6.1-sol', { providerId: 'new-api' })
    const harness = createHarness({
      providers: [provider('new-api')],
      providerModels: { 'new-api': [existing] }
    })
    vi.mocked(harness.source.fetchCatalog).mockResolvedValue([existing])

    const result = await harness.service.refresh('new-api', 'user')

    expect(result).toMatchObject({ status: 'not-modified', revision: 0, added: [] })
    expect(harness.settings.setProviderModels).not.toHaveBeenCalled()
    expect(harness.settings.notifyModelsChanged).not.toHaveBeenCalled()
    expect(harness.publishEvent).toHaveBeenCalledWith(
      'providers.catalog.changed',
      expect.objectContaining({ changed: false, status: 'fresh', errorCode: null })
    )
  })

  it('keeps the last known catalog and records a sanitized error when refresh fails', async () => {
    const harness = createHarness({
      providers: [provider('new-api')],
      providerModels: { 'new-api': [model('last-known')] }
    })
    vi.mocked(harness.source.fetchCatalog).mockRejectedValue(
      Object.assign(new Error('upstream rejected the request'), { status: 401 })
    )

    const result = await harness.service.refresh('new-api', 'user')

    expect(result).toMatchObject({ status: 'failed', errorCode: 'auth', added: [], removed: [] })
    expect(harness.providerModels['new-api'].map((item) => item.id)).toEqual(['last-known'])
    expect(harness.settings.setProviderModels).not.toHaveBeenCalled()
    expect(harness.publishEvent).toHaveBeenCalledWith(
      'providers.catalog.changed',
      expect.objectContaining({ status: 'error', changed: false, errorCode: 'auth' })
    )

    const snapshot = harness.service.getSnapshot('new-api')
    expect(snapshot).toMatchObject({ status: 'error', lastErrorCode: 'auth' })
    expect(snapshot.models.map((item) => item.id)).toEqual(['last-known'])
  })

  it('syncs the provider DB before a user refresh and survives a failed download', async () => {
    const harness = createHarness({ providers: [provider('mistral')] })
    harness.refreshProviderDb.mockResolvedValue({
      status: 'error',
      lastUpdated: null,
      providersCount: 1,
      message: 'offline'
    })
    vi.mocked(harness.source.fetchCatalog).mockResolvedValue([
      model('mistral-large', { providerId: 'mistral' })
    ])

    const result = await harness.service.refresh('mistral', 'user')

    expect(harness.refreshProviderDb).toHaveBeenCalledWith(true)
    expect(harness.refreshProviderDb.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(harness.source.fetchCatalog).mock.invocationCallOrder[0]
    )
    expect(result).toMatchObject({ status: 'ok', added: ['mistral-large'], errorCode: null })
  })

  it('deduplicates concurrent refreshes for the same provider', async () => {
    const harness = createHarness({ providers: [provider('new-api')] })
    let resolveFetch: (models: MODEL_META[]) => void = () => undefined
    vi.mocked(harness.source.fetchCatalog).mockImplementation(
      () => new Promise((resolve) => (resolveFetch = resolve))
    )

    const first = harness.service.refresh('new-api', 'user')
    const second = harness.service.refresh('new-api', 'user')
    resolveFetch([model('gpt-6.1-sol')])

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(harness.source.fetchCatalog).toHaveBeenCalledTimes(1)
    expect(harness.service.getSnapshot('new-api').models.map((item) => item.id)).toEqual([
      'gpt-6.1-sol'
    ])
  })

  it('refreshes stale remote catalogs at most once and skips fresh or disabled providers', async () => {
    let now = 10_000
    const harness = createHarness({ providers: [provider('new-api')], now: () => now })
    vi.mocked(harness.source.fetchCatalog).mockResolvedValue([model('gpt-6.1-sol')])

    expect(harness.service.ensureFresh('new-api')).toBe(true)
    await vi.waitFor(() => expect(harness.service.getSnapshot('new-api').status).toBe('fresh'))
    expect(harness.service.ensureFresh('new-api')).toBe(false)
    expect(harness.source.fetchCatalog).toHaveBeenCalledTimes(1)

    now += 6 * 60 * 60 * 1000 + 1
    expect(harness.service.ensureFresh('new-api')).toBe(true)
    await vi.waitFor(() => expect(harness.source.fetchCatalog).toHaveBeenCalledTimes(2))

    const disabled = createHarness({
      providers: [provider('new-api', { enable: false })],
      now: () => now
    })
    expect(disabled.service.ensureFresh('new-api')).toBe(false)
    expect(disabled.source.fetchCatalog).not.toHaveBeenCalled()
  })

  it('never auto-refreshes ACP catalogs', () => {
    const harness = createHarness({ providers: [provider('acp')] })

    expect(harness.service.ensureFresh('acp')).toBe(false)
    expect(harness.source.fetchCatalog).not.toHaveBeenCalled()
  })

  it('bumps the revision without fetching for remote providers on a provider DB update', async () => {
    const harness = createHarness({
      providers: [provider('new-api'), provider('mistral')]
    })
    vi.mocked(harness.source.fetchCatalog).mockResolvedValue([])

    harness.service.onProviderDbUpdated()
    await vi.waitFor(() => expect(harness.source.fetchCatalog).toHaveBeenCalledTimes(1))

    expect(harness.source.fetchCatalog).toHaveBeenCalledWith('mistral')
    expect(harness.service.getSnapshot('new-api').revision).toBe(1)
    expect(harness.publishEvent).toHaveBeenCalledWith(
      'providers.catalog.changed',
      expect.objectContaining({ providerId: 'new-api', revision: 1, reason: 'provider-db' })
    )
  })

  it('replaces an externally written catalog (ACP agents) and reports the diff', () => {
    const harness = createHarness({
      providers: [provider('acp')],
      providerModels: { acp: [model('removed-agent', { providerId: 'acp', isCustom: true })] }
    })

    const result = harness.service.replaceFromSource(
      'acp',
      [model('claude-code', { providerId: 'acp', isCustom: true })],
      'acp'
    )

    expect(result).toMatchObject({
      status: 'ok',
      revision: 1,
      added: ['claude-code'],
      removed: ['removed-agent']
    })
    expect(harness.providerModels.acp).toMatchObject([{ id: 'claude-code', isCustom: true }])
    expect(harness.settings.notifyModelsChanged).toHaveBeenCalledWith('acp')
  })
})
