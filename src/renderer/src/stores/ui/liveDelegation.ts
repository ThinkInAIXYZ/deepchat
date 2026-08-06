import { onScopeDispose, reactive } from 'vue'
import { defineStore } from 'pinia'
import { createOrchestrationClient } from '@api/OrchestrationClient'
import type {
  LiveDelegationDetail,
  LiveDelegationSummary
} from '@shared/orchestration/liveDelegation'

type LiveDelegationSessionProjection = {
  byId: Map<
    string,
    {
      delegation: LiveDelegationSummary
      authoritative: boolean
    }
  >
  loaded: boolean
  loading: boolean
  loadFailed: boolean
}

const createSessionProjection = (): LiveDelegationSessionProjection => ({
  byId: new Map(),
  loaded: false,
  loading: false,
  loadFailed: false
})

const sortDelegations = (items: Iterable<LiveDelegationSummary>): LiveDelegationSummary[] =>
  [...items].sort(
    (left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id)
  )

export const useLiveDelegationStore = defineStore('liveDelegation', () => {
  const client = createOrchestrationClient()
  const projections = reactive(new Map<string, LiveDelegationSessionProjection>())
  const interrupting = reactive(new Set<string>())
  const loadPromises = new Map<string, Promise<boolean>>()
  const confirmationPromises = new Map<string, Promise<LiveDelegationSummary>>()
  const interruptPromises = new Map<string, Promise<LiveDelegationDetail>>()
  let stopChanged: (() => void) | null = null

  function normalizeId(value: string): string {
    return value.trim()
  }

  function requireProjection(parentSessionId: string): LiveDelegationSessionProjection {
    const normalized = normalizeId(parentSessionId)
    if (!normalized) throw new Error('Live delegation projection requires a parent Session ID.')
    const current = projections.get(normalized)
    if (current) return current
    const created = createSessionProjection()
    projections.set(normalized, created)
    return created
  }

  function ensureStarted(): void {
    if (stopChanged) return
    stopChanged = client.onLiveDelegationChanged((payload) => {
      upsert(payload.delegation, true)
    })
  }

  function upsert(delegation: LiveDelegationSummary, authoritative: boolean): void {
    const projection = requireProjection(delegation.parentSessionId)
    const current = projection.byId.get(delegation.id)
    if (current?.authoritative && !authoritative) return
    if (
      current &&
      current.authoritative === authoritative &&
      (current.delegation.revision > delegation.revision ||
        (current.delegation.revision === delegation.revision &&
          current.delegation.updatedAt > delegation.updatedAt))
    ) {
      return
    }
    projection.byId.set(delegation.id, { delegation, authoritative })
  }

  function assertRelation(
    delegation: LiveDelegationSummary,
    parentSessionId: string,
    delegationId?: string
  ): void {
    if (
      delegation.parentSessionId !== parentSessionId ||
      (delegationId !== undefined && delegation.id !== delegationId)
    ) {
      throw new Error('Live delegation response does not match the requested relationship.')
    }
  }

  function seed(delegation: LiveDelegationSummary): void {
    ensureStarted()
    upsert(delegation, false)
  }

  function getDelegation(
    parentSessionId: string,
    delegationId: string
  ): LiveDelegationSummary | null {
    const parentId = normalizeId(parentSessionId)
    const id = normalizeId(delegationId)
    if (!parentId || !id) return null
    return projections.get(parentId)?.byId.get(id)?.delegation ?? null
  }

  function listAuthoritative(parentSessionId: string): LiveDelegationSummary[] {
    const normalized = normalizeId(parentSessionId)
    if (!normalized) return []
    return sortDelegations(
      [...(projections.get(normalized)?.byId.values() ?? [])]
        .filter((item) => item.authoritative)
        .map((item) => item.delegation)
    )
  }

  function isAuthoritative(parentSessionId: string, delegationId: string): boolean {
    const parentId = normalizeId(parentSessionId)
    const id = normalizeId(delegationId)
    if (!parentId || !id) return false
    return projections.get(parentId)?.byId.get(id)?.authoritative === true
  }

  function getLoadState(parentSessionId: string): {
    loaded: boolean
    loading: boolean
    loadFailed: boolean
  } {
    const normalized = normalizeId(parentSessionId)
    const projection = normalized ? projections.get(normalized) : undefined
    if (!projection) {
      return { loaded: false, loading: false, loadFailed: false }
    }
    return {
      loaded: projection.loaded,
      loading: projection.loading,
      loadFailed: projection.loadFailed
    }
  }

  function refresh(parentSessionId: string): Promise<boolean> {
    const normalized = normalizeId(parentSessionId)
    if (!normalized) return Promise.resolve(false)
    ensureStarted()
    const existing = loadPromises.get(normalized)
    if (existing) return existing
    const projection = requireProjection(normalized)
    const request = (async () => {
      projection.loading = true
      projection.loadFailed = false
      try {
        const beforeRefresh = new Map(projection.byId)
        const loaded = await client.listLiveDelegations(normalized, 100)
        if (projections.get(normalized) !== projection) return false
        for (const delegation of loaded) assertRelation(delegation, normalized)
        for (const delegation of loaded) upsert(delegation, true)
        const loadedIds = new Set(loaded.map((delegation) => delegation.id))
        for (const [delegationId, previous] of beforeRefresh) {
          // Reference identity preserves an authoritative event that replaced this entry while the
          // bounded list request was in flight. Transcript seeds remain until host confirmation.
          if (
            previous.authoritative &&
            !loadedIds.has(delegationId) &&
            projection.byId.get(delegationId) === previous
          ) {
            projection.byId.delete(delegationId)
          }
        }
        projection.loaded = true
        return true
      } catch (error) {
        console.warn('[LiveDelegationStore] Failed to list delegations:', error)
        projection.loadFailed = true
        return false
      } finally {
        projection.loading = false
      }
    })().finally(() => {
      if (loadPromises.get(normalized) === request) loadPromises.delete(normalized)
    })
    loadPromises.set(normalized, request)
    return request
  }

  async function ensureLoaded(
    parentSessionId: string,
    options?: { revalidate?: boolean }
  ): Promise<boolean> {
    const normalized = normalizeId(parentSessionId)
    if (!normalized) return false
    ensureStarted()
    const projection = requireProjection(normalized)
    if (projection.loaded && !options?.revalidate) return true
    return await refresh(normalized)
  }

  function interruptionKey(parentSessionId: string, delegationId: string): string {
    return `${parentSessionId}\u0000${delegationId}`
  }

  async function confirm(
    parentSessionId: string,
    delegationId: string
  ): Promise<LiveDelegationSummary> {
    const normalizedParentId = normalizeId(parentSessionId)
    const normalizedDelegationId = normalizeId(delegationId)
    if (!normalizedParentId || !normalizedDelegationId) {
      throw new Error('Confirmation requires parent Session and delegation IDs.')
    }
    const current = getDelegation(normalizedParentId, normalizedDelegationId)
    if (current && isAuthoritative(normalizedParentId, normalizedDelegationId)) return current

    ensureStarted()
    const projection = requireProjection(normalizedParentId)
    const key = interruptionKey(normalizedParentId, normalizedDelegationId)
    const existing = confirmationPromises.get(key)
    if (existing) return await existing
    const request = client
      .inspectLiveDelegation(normalizedParentId, normalizedDelegationId)
      .then((detail) => {
        assertRelation(detail.delegation, normalizedParentId, normalizedDelegationId)
        if (projections.get(normalizedParentId) === projection) {
          upsert(detail.delegation, true)
        }
        return detail.delegation
      })
      .finally(() => {
        if (confirmationPromises.get(key) === request) confirmationPromises.delete(key)
      })
    confirmationPromises.set(key, request)
    return await request
  }

  function isInterrupting(parentSessionId: string, delegationId: string): boolean {
    const parentId = normalizeId(parentSessionId)
    const id = normalizeId(delegationId)
    return Boolean(parentId && id && interrupting.has(interruptionKey(parentId, id)))
  }

  async function interrupt(
    parentSessionId: string,
    delegationId: string,
    expected?: { slotId: string; title: string }
  ): Promise<LiveDelegationDetail> {
    const normalizedParentId = normalizeId(parentSessionId)
    const normalizedDelegationId = normalizeId(delegationId)
    if (!normalizedParentId || !normalizedDelegationId) {
      throw new Error('Interrupt requires parent Session and delegation IDs.')
    }
    ensureStarted()
    const projection = requireProjection(normalizedParentId)
    const confirmed = await confirm(normalizedParentId, normalizedDelegationId)
    if (projections.get(normalizedParentId) !== projection) {
      throw new Error('The parent Session was removed while the delegation was being confirmed.')
    }
    if (
      expected &&
      (confirmed.slotId !== expected.slotId.trim() || confirmed.title !== expected.title.trim())
    ) {
      throw new Error('The delegation no longer matches the displayed task.')
    }
    const key = interruptionKey(normalizedParentId, normalizedDelegationId)
    const existing = interruptPromises.get(key)
    if (existing) return await existing

    interrupting.add(key)
    const request = client
      .interruptLiveDelegation(normalizedParentId, normalizedDelegationId)
      .then((detail) => {
        assertRelation(detail.delegation, normalizedParentId, normalizedDelegationId)
        if (projections.get(normalizedParentId) === projection) {
          upsert(detail.delegation, true)
        }
        return detail
      })
      .finally(() => {
        if (interruptPromises.get(key) === request) {
          interrupting.delete(key)
          interruptPromises.delete(key)
        }
      })
    interruptPromises.set(key, request)
    return await request
  }

  function purge(parentSessionId: string): void {
    const normalized = normalizeId(parentSessionId)
    if (!normalized) return
    projections.delete(normalized)
    loadPromises.delete(normalized)
    const prefix = `${normalized}\u0000`
    for (const key of interrupting) {
      if (key.startsWith(prefix)) interrupting.delete(key)
    }
    for (const key of confirmationPromises.keys()) {
      if (key.startsWith(prefix)) confirmationPromises.delete(key)
    }
    for (const key of interruptPromises.keys()) {
      if (key.startsWith(prefix)) interruptPromises.delete(key)
    }
  }

  function stop(): void {
    stopChanged?.()
    stopChanged = null
  }

  onScopeDispose(stop)

  return {
    seed,
    getDelegation,
    listAuthoritative,
    isAuthoritative,
    getLoadState,
    refresh,
    ensureLoaded,
    confirm,
    interrupt,
    isInterrupting,
    purge,
    stop
  }
})
