import logger from '@shared/logger'
import type { DeepchatEventPayload, DeepchatEventPublisher } from '@shared/contracts/events'
import type { LLM_PROVIDER, MODEL_META } from '@shared/types/provider'
import type {
  ProviderCatalogErrorCode,
  ProviderCatalogRefreshReason,
  ProviderCatalogRefreshResult,
  ProviderCatalogSnapshot,
  ProviderCatalogSource,
  ProviderCatalogState,
  ProviderCatalogStatus
} from '@shared/types/providerCatalog'
import { stripDerivedProviderModelFields } from '../providerModelFacts'
import { isProviderDbBackedProvider, resolveAiSdkProviderDefinition } from '../providerRegistry'
import type { ProviderSettingsPort } from '../settings'
import { buildProviderCatalogModels } from './providerCatalogProjection'

const REMOTE_CATALOG_TTL_MS = 6 * 60 * 60 * 1000
const RUNTIME_CATALOG_TTL_MS = 60 * 1000
const ERROR_RETRY_MS = 5 * 60 * 1000

export type ProviderCatalogSettingsPort = Pick<
  ProviderSettingsPort,
  | 'getProviders'
  | 'getProviderById'
  | 'getRawProviderModels'
  | 'getRawCustomModels'
  | 'getDbProviderModels'
  | 'resolveEffectiveModels'
  | 'getBatchModelStatus'
  | 'setProviderModels'
  | 'getProviderCatalogState'
  | 'setProviderCatalogState'
  | 'deleteProviderCatalogState'
  | 'notifyModelsChanged'
  | 'refreshProviderDb'
>

export interface ProviderCatalogSourcePort {
  fetchCatalog(providerId: string): Promise<MODEL_META[]>
  reloadModels(providerId: string): void
}

/** The only supported way for a provider to publish a catalog it owns (ACP agents). */
export interface ProviderCatalogWriterPort {
  replaceFromSource(
    providerId: string,
    models: MODEL_META[],
    reason?: ProviderCatalogRefreshReason
  ): ProviderCatalogRefreshResult
}

export interface ProviderCatalogServiceDeps {
  settings: ProviderCatalogSettingsPort
  source: ProviderCatalogSourcePort
  publishEvent: DeepchatEventPublisher
  now?: () => number
}

type CatalogDiff = {
  added: string[]
  removed: string[]
  updated: string[]
}

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

const catalogSourceForProvider = (provider: LLM_PROVIDER): ProviderCatalogSource => {
  const providerId = provider.id.trim().toLowerCase()
  if (providerId === 'acp') return 'acp'
  if (providerId === 'ollama' || provider.apiType === 'ollama') return 'ollama'
  if (provider.custom) return 'remote'

  const definition = resolveAiSdkProviderDefinition(provider)
  switch (definition?.modelSource) {
    case 'provider-db':
    case 'kimi-for-coding':
      return 'provider-db'
    case 'config-db':
      return 'config'
    case 'openai-codex':
      return 'runtime'
    default:
      return 'remote'
  }
}

const catalogTtlForSource = (source: ProviderCatalogSource): number => {
  if (source === 'provider-db' || source === 'config') return Number.POSITIVE_INFINITY
  if (source === 'remote') return REMOTE_CATALOG_TTL_MS
  return RUNTIME_CATALOG_TTL_MS
}

const includesCatalogModels = (source: ProviderCatalogSource): boolean =>
  source === 'remote' || source === 'provider-db' || source === 'config'

const normalizeFetchedModels = (models: MODEL_META[], providerId: string): MODEL_META[] => {
  const byId = new Map<string, MODEL_META>()
  for (const model of models) {
    if (!model || typeof model.id !== 'string' || model.id.trim().length === 0) continue
    const id = model.id.trim()
    const normalized: MODEL_META = { ...model, id, providerId, isCustom: model.isCustom ?? false }
    byId.set(id, stripDerivedProviderModelFields(normalized, providerId))
  }
  return Array.from(byId.values())
}

const diffCatalogModels = (
  previous: MODEL_META[],
  next: MODEL_META[],
  providerId: string
): CatalogDiff => {
  const fingerprint = (model: MODEL_META): string =>
    stableStringify(stripDerivedProviderModelFields({ ...model, providerId }, providerId))
  const previousById = new Map(previous.map((model) => [model.id, fingerprint(model)]))
  const nextById = new Map(next.map((model) => [model.id, fingerprint(model)]))

  return {
    added: next
      .filter((model) => !previousById.has(model.id))
      .map((model) => model.id)
      .sort(),
    removed: previous
      .filter((model) => !nextById.has(model.id))
      .map((model) => model.id)
      .sort(),
    updated: next
      .filter(
        (model) =>
          previousById.has(model.id) && previousById.get(model.id) !== nextById.get(model.id)
      )
      .map((model) => model.id)
      .sort()
  }
}

const classifyCatalogError = (error: unknown): ProviderCatalogErrorCode => {
  const status = (error as { status?: unknown } | null)?.status
  if (typeof status === 'number') {
    if (status === 401) return 'auth'
    if (status === 403) return 'forbidden'
    if (status === 404) return 'not-found'
    if (status === 408) return 'timeout'
    return 'http'
  }

  const message =
    error instanceof Error
      ? `${error.name} ${error.message}`.toLowerCase()
      : String(error).toLowerCase()
  if (message.includes('abort') || message.includes('timeout')) return 'timeout'
  if (
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('econn') ||
    message.includes('enotfound') ||
    message.includes('socket')
  ) {
    return 'network'
  }
  if (message.includes('json') || message.includes('parse')) return 'invalid-response'
  return 'unknown'
}

export class ProviderCatalogService {
  private readonly inFlight = new Map<string, Promise<ProviderCatalogRefreshResult>>()
  private readonly now: () => number

  constructor(private readonly deps: ProviderCatalogServiceDeps) {
    this.now = deps.now ?? Date.now
  }

  getSnapshot(providerId: string): ProviderCatalogSnapshot {
    const provider = this.requireProvider(providerId)
    const source = catalogSourceForProvider(provider)
    const state = this.deps.settings.getProviderCatalogState(providerId)
    const status = this.deriveStatus(state, source, this.inFlight.has(providerId))
    const catalogModels = includesCatalogModels(source)
      ? this.deps.settings.getDbProviderModels(providerId)
      : []

    const models = buildProviderCatalogModels({
      providerId,
      catalogModels,
      providerModels: this.deps.settings.getRawProviderModels(providerId),
      customModels: this.deps.settings.getRawCustomModels(providerId),
      resolveEffectiveModels: (input, id) => this.deps.settings.resolveEffectiveModels(input, id),
      modelStatus: (modelIds) => this.deps.settings.getBatchModelStatus(providerId, modelIds)
    })

    return {
      providerId,
      revision: state?.revision ?? 0,
      status,
      fetchedAt: state?.fetchedAt ?? null,
      source,
      lastErrorCode: state?.lastErrorCode ?? null,
      models
    }
  }

  listSnapshots(providerIds?: string[]): ProviderCatalogSnapshot[] {
    const ids = providerIds ?? this.deps.settings.getProviders().map((provider) => provider.id)
    return ids.map((providerId) => this.getSnapshot(providerId))
  }

  ensureFresh(providerId: string): boolean {
    const provider = this.deps.settings.getProviderById(providerId)
    if (!provider?.enable) return false

    const source = catalogSourceForProvider(provider)
    if (source === 'acp') return false
    if (this.inFlight.has(providerId)) return false

    const state = this.deps.settings.getProviderCatalogState(providerId)
    const status = this.deriveStatus(state, source, false)
    if (status === 'fresh') return false
    if (
      status === 'error' &&
      state?.lastErrorAt != null &&
      this.now() - state.lastErrorAt < ERROR_RETRY_MS
    ) {
      return false
    }

    void this.refresh(providerId, 'stale').catch((error) => {
      logger.warn(
        `[ProviderCatalog] Background refresh failed for ${providerId}: ` +
          (error instanceof Error ? error.message : String(error))
      )
    })
    return true
  }

  refresh(
    providerId: string,
    reason: ProviderCatalogRefreshReason = 'user'
  ): Promise<ProviderCatalogRefreshResult> {
    const existing = this.inFlight.get(providerId)
    if (existing) return existing
    this.requireProvider(providerId)

    const refreshPromise = this.performRefresh(providerId, reason).finally(() => {
      if (this.inFlight.get(providerId) === refreshPromise) {
        this.inFlight.delete(providerId)
      }
    })
    this.inFlight.set(providerId, refreshPromise)
    return refreshPromise
  }

  replaceFromSource(
    providerId: string,
    models: MODEL_META[],
    reason: ProviderCatalogRefreshReason = 'external-write'
  ): ProviderCatalogRefreshResult {
    const provider = this.requireProvider(providerId)
    const source = catalogSourceForProvider(provider)
    const normalized = normalizeFetchedModels(models, providerId)
    const diff = diffCatalogModels(
      this.deps.settings.getRawProviderModels(providerId),
      normalized,
      providerId
    )
    const changed = diff.added.length + diff.removed.length + diff.updated.length > 0

    if (changed) {
      this.deps.settings.setProviderModels(providerId, normalized)
    }
    const state = this.deps.settings.setProviderCatalogState(
      providerId,
      {
        fetchedAt: this.now(),
        source,
        lastRefreshReason: reason,
        lastErrorCode: null,
        lastErrorAt: null
      },
      { bumpRevision: changed }
    )
    this.deps.source.reloadModels(providerId)
    if (changed) this.deps.settings.notifyModelsChanged(providerId)
    this.publishChanged(providerId, state, source, reason, changed, diff, null)

    return {
      providerId,
      status: changed ? 'ok' : 'not-modified',
      revision: state.revision,
      fetchedAt: state.fetchedAt,
      ...diff,
      errorCode: null
    }
  }

  onExternalCatalogWrite(
    providerId: string,
    reason: ProviderCatalogRefreshReason = 'external-write'
  ): void {
    const provider = this.deps.settings.getProviderById(providerId)
    if (!provider) return
    const source = catalogSourceForProvider(provider)
    const state = this.deps.settings.setProviderCatalogState(
      providerId,
      { source, lastRefreshReason: reason },
      { bumpRevision: true }
    )
    this.deps.source.reloadModels(providerId)
    this.deps.settings.notifyModelsChanged(providerId)
    this.publishChanged(providerId, state, source, reason, true, undefined, null)
  }

  forgetCatalog(providerId: string): void {
    this.deps.settings.deleteProviderCatalogState(providerId)
  }

  /** A sync/import wrote provider or model rows outside the catalog service. */
  invalidateFromSync(providerId: string): void {
    this.onExternalCatalogWrite(providerId, 'sync')
  }

  onProviderDbUpdated(): void {
    for (const provider of this.deps.settings.getProviders()) {
      if (!provider.enable) continue
      const source = catalogSourceForProvider(provider)
      if (source === 'remote' || source === 'ollama' || source === 'acp' || source === 'runtime') {
        const state = this.deps.settings.setProviderCatalogState(
          provider.id,
          { source },
          { bumpRevision: true }
        )
        this.publishChanged(provider.id, state, source, 'provider-db', true, undefined, null)
        continue
      }

      void this.refresh(provider.id, 'provider-db').catch((error) => {
        logger.warn(
          `[ProviderCatalog] Provider DB refresh failed for ${provider.id}: ` +
            (error instanceof Error ? error.message : String(error))
        )
      })
    }
  }

  onProviderConfigChanged(providerId: string): void {
    const provider = this.deps.settings.getProviderById(providerId)
    if (!provider) return
    const source = catalogSourceForProvider(provider)

    if (provider.enable) {
      void this.refresh(providerId, 'config').catch((error) => {
        logger.warn(
          `[ProviderCatalog] Config refresh failed for ${providerId}: ` +
            (error instanceof Error ? error.message : String(error))
        )
      })
      return
    }

    const state = this.deps.settings.setProviderCatalogState(providerId, {
      fetchedAt: null,
      source,
      lastRefreshReason: 'config',
      lastErrorCode: null,
      lastErrorAt: null
    })
    this.publishChanged(providerId, state, source, 'config', false, undefined, null)
  }

  private async performRefresh(
    providerId: string,
    reason: ProviderCatalogRefreshReason
  ): Promise<ProviderCatalogRefreshResult> {
    const provider = this.requireProvider(providerId)
    const source = catalogSourceForProvider(provider)
    const currentState = this.deps.settings.getProviderCatalogState(providerId)
    this.publishChanged(
      providerId,
      currentState,
      source,
      reason,
      false,
      undefined,
      null,
      'refreshing'
    )

    try {
      if ((reason === 'user' || reason === 'config') && isProviderDbBackedProvider(providerId)) {
        try {
          const dbRefresh = await this.deps.settings.refreshProviderDb(true)
          if (dbRefresh.status === 'error') {
            logger.warn(
              `[ProviderCatalog] Provider DB download failed for ${providerId}; using the cached catalog`
            )
          }
        } catch (error) {
          // The cached provider DB still answers the fetch; a failed download must not empty it.
          logger.warn(
            `[ProviderCatalog] Provider DB download failed for ${providerId}: ` +
              (error instanceof Error ? error.message : String(error))
          )
        }
      }

      // Snapshot before fetching: some sources (ACP) persist while fetching.
      const previousModels = this.deps.settings.getRawProviderModels(providerId)
      const fetched = await this.deps.source.fetchCatalog(providerId)
      if (!this.deps.settings.getProviderById(providerId)) {
        throw new Error(`Provider ${providerId} was removed during refresh`)
      }

      const normalized = normalizeFetchedModels(fetched, providerId)
      const diff = diffCatalogModels(previousModels, normalized, providerId)
      const changed = diff.added.length + diff.removed.length + diff.updated.length > 0
      if (changed) {
        this.deps.settings.setProviderModels(providerId, normalized)
      }

      const state = this.deps.settings.setProviderCatalogState(
        providerId,
        {
          fetchedAt: this.now(),
          source,
          lastRefreshReason: reason,
          lastErrorCode: null,
          lastErrorAt: null
        },
        { bumpRevision: changed }
      )
      this.deps.source.reloadModels(providerId)
      if (changed) this.deps.settings.notifyModelsChanged(providerId)
      this.publishChanged(
        providerId,
        state,
        source,
        reason,
        changed,
        diff,
        null,
        this.deriveStatus(state, source, false)
      )

      return {
        providerId,
        status: changed ? 'ok' : 'not-modified',
        revision: state.revision,
        fetchedAt: state.fetchedAt,
        ...diff,
        errorCode: null
      }
    } catch (error) {
      const errorCode = classifyCatalogError(error)
      if (!this.deps.settings.getProviderById(providerId)) {
        // The provider (and its state row) was deleted mid-refresh; do not resurrect either.
        return {
          providerId,
          status: 'failed',
          revision: 0,
          fetchedAt: null,
          added: [],
          removed: [],
          updated: [],
          errorCode
        }
      }

      const state = this.deps.settings.setProviderCatalogState(
        providerId,
        {
          source,
          lastRefreshReason: reason,
          lastErrorCode: errorCode,
          lastErrorAt: this.now()
        },
        { bumpRevision: false }
      )
      this.publishChanged(providerId, state, source, reason, false, undefined, errorCode, 'error')
      logger.warn(
        `[ProviderCatalog] Refresh failed for ${providerId} (${reason}): ` +
          (error instanceof Error ? error.message : String(error))
      )

      return {
        providerId,
        status: 'failed',
        revision: state.revision,
        fetchedAt: state.fetchedAt,
        added: [],
        removed: [],
        updated: [],
        errorCode
      }
    }
  }

  private deriveStatus(
    state: ProviderCatalogState | undefined,
    source: ProviderCatalogSource,
    refreshing: boolean
  ): ProviderCatalogStatus {
    if (refreshing) return 'refreshing'
    if (state?.lastErrorCode) return 'error'
    if (!state?.fetchedAt) return 'unknown'
    const ttl = catalogTtlForSource(source)
    if (ttl !== Number.POSITIVE_INFINITY && this.now() - state.fetchedAt > ttl) return 'stale'
    return 'fresh'
  }

  private requireProvider(providerId: string): LLM_PROVIDER {
    const provider = this.deps.settings.getProviderById(providerId)
    if (!provider) throw new Error(`Provider ${providerId} not found`)
    return provider
  }

  private publishChanged(
    providerId: string,
    state: ProviderCatalogState | undefined,
    source: ProviderCatalogSource,
    reason: ProviderCatalogRefreshReason,
    changed: boolean,
    diff?: CatalogDiff,
    errorCode: ProviderCatalogErrorCode | null = null,
    statusOverride?: ProviderCatalogStatus
  ): void {
    const payload: DeepchatEventPayload<'providers.catalog.changed'> = {
      providerId,
      revision: state?.revision ?? 0,
      status: statusOverride ?? this.deriveStatus(state, source, this.inFlight.has(providerId)),
      reason,
      changed,
      errorCode,
      version: this.now(),
      ...(diff ? { added: diff.added, removed: diff.removed, updated: diff.updated } : {})
    }
    this.deps.publishEvent('providers.catalog.changed', payload)
  }
}
