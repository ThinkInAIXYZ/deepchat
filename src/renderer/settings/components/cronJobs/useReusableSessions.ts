import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { SessionClient } from '@api/SessionClient'
import type { CronJob } from '@shared/cronJobs'
import type { SessionListItem, SessionPageCursor } from '@shared/types/agent-interface'

const REUSABLE_SESSIONS_PAGE_SIZE = 20
const OPEN_RELOAD_DEBOUNCE_MS = 150

const foldSearchText = (text: string): string => text.toLowerCase().toUpperCase()

const matchesSessionQuery = (session: SessionListItem, query: string): boolean => {
  const folded = foldSearchText(query.trim())
  if (!folded) {
    return true
  }
  return (
    foldSearchText(session.title).includes(folded) ||
    foldSearchText(session.projectDir ?? '').includes(folded)
  )
}

export interface ReusableSessionsViewState {
  sessions: SessionListItem[]
  query: string
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  loadFailed: boolean
  draftResolved: SessionListItem | null | undefined
  selectedResolved: SessionListItem | null | undefined
}

export interface UseReusableSessionsOptions {
  sessionClient: Pick<SessionClient, 'listLightweight' | 'getLightweightByIds' | 'onUpdated'>
  mode: Ref<'view' | 'edit' | 'create'>
  draft: Ref<CronJob | null>
  selectedJob: ComputedRef<CronJob | null>
  onError?: (scope: string, error: unknown, context?: Readonly<Record<string, unknown>>) => void
}

export function useReusableSessions(options: UseReusableSessionsOptions) {
  const { sessionClient, mode, draft, selectedJob, onError } = options

  const sessions = ref<SessionListItem[]>([])
  const query = ref('')
  const loading = ref(false)
  const loadingMore = ref(false)
  const hasMore = ref(false)
  const nextCursor = ref<SessionPageCursor | null>(null)
  const loadFailed = ref(false)
  const resolvedById = ref<Record<string, SessionListItem | null>>({})

  let generation = 0
  let activeAgentId: string | null = null
  let resolveGeneration = 0
  let mutationEpoch = 0
  let disposed = false
  let pickerOpen = false
  let staleOnOpen = false
  let openReloadTimer: number | null = null
  let unsubscribeUpdates: (() => void) | null = null
  const deletedSessionIds = new Set<string>()
  const failedResolveIds = new Set<string>()
  const updatedSessionEpochById = new Map<string, number>()

  const cancelOpenReload = () => {
    if (openReloadTimer !== null) {
      window.clearTimeout(openReloadTimer)
      openReloadTimer = null
    }
  }

  const selectedResolved = computed<SessionListItem | null | undefined>(() => {
    const current = selectedJob.value
    const sessionId = current?.reuseSessionId
    if (!sessionId) {
      return null
    }
    if (!Object.hasOwn(resolvedById.value, sessionId)) {
      return undefined
    }
    const cached = resolvedById.value[sessionId]
    if (!cached) {
      return null
    }
    if (current.agentId && cached.agentId !== current.agentId) {
      return null
    }
    return cached
  })

  const draftResolved = computed<SessionListItem | null | undefined>(() => {
    const current = draft.value
    const sessionId = current?.reuseSessionId
    if (!sessionId) {
      return undefined
    }
    const fromList = sessions.value.find(
      (session) =>
        session.id === sessionId && (!current.agentId || session.agentId === current.agentId)
    )
    if (fromList) {
      return fromList
    }
    if (!Object.hasOwn(resolvedById.value, sessionId)) {
      return undefined
    }
    const cached = resolvedById.value[sessionId]
    if (!cached) {
      return null
    }
    if (current.agentId && cached.agentId !== current.agentId) {
      return null
    }
    return cached
  })

  const state = computed<ReusableSessionsViewState>(() => ({
    sessions: sessions.value,
    query: query.value,
    loading: loading.value,
    loadingMore: loadingMore.value,
    hasMore: hasMore.value,
    loadFailed: loadFailed.value,
    draftResolved: draftResolved.value,
    selectedResolved: selectedResolved.value
  }))

  const reset = () => {
    cancelOpenReload()
    generation += 1
    activeAgentId = null
    staleOnOpen = false
    sessions.value = []
    query.value = ''
    loading.value = false
    loadingMore.value = false
    hasMore.value = false
    nextCursor.value = null
    loadFailed.value = false
  }

  const resolveSession = async (sessionId: string | null) => {
    if (!sessionId) {
      return
    }
    const requestGeneration = ++resolveGeneration
    try {
      const items = await sessionClient.getLightweightByIds([sessionId])
      if (disposed || requestGeneration !== resolveGeneration) {
        return
      }
      failedResolveIds.delete(sessionId)
      const found = deletedSessionIds.has(sessionId)
        ? null
        : (items.find((entry) => entry.id === sessionId) ?? null)
      resolvedById.value = {
        ...resolvedById.value,
        [sessionId]: found
      }
    } catch (error) {
      if (!disposed && requestGeneration === resolveGeneration) {
        onError?.('Failed to resolve reused session', error, { sessionId })
        failedResolveIds.add(sessionId)
        staleOnOpen = true
        resolvedById.value = {
          ...resolvedById.value,
          [sessionId]: null
        }
      }
    }
  }

  const load = async (loadOptions: {
    agentId: string | null
    query?: string
    cursor?: SessionPageCursor | null
    append?: boolean
    prioritizeSessionId?: string | null
  }) => {
    const { agentId, cursor = null, append = false, prioritizeSessionId = null } = loadOptions
    const normalizedQuery = loadOptions.query?.trim() ?? ''
    if (!agentId) {
      reset()
      return
    }

    cancelOpenReload()
    const requestGeneration = ++generation
    const startedAtEpoch = mutationEpoch
    loadFailed.value = false
    if (append) {
      loadingMore.value = true
    } else {
      staleOnOpen = false
      if (activeAgentId !== agentId || query.value !== normalizedQuery) {
        sessions.value = []
      }
      activeAgentId = agentId
      query.value = normalizedQuery
      loading.value = true
      loadingMore.value = false
      hasMore.value = false
      nextCursor.value = null
    }

    try {
      const response = await sessionClient.listLightweight({
        agentId,
        includeSubagents: false,
        includeDrafts: false,
        limit: REUSABLE_SESSIONS_PAGE_SIZE,
        ...(normalizedQuery ? { query: normalizedQuery } : {}),
        ...(append && cursor ? { cursor } : {}),
        ...(!append && !normalizedQuery && prioritizeSessionId ? { prioritizeSessionId } : {})
      })
      if (disposed || requestGeneration !== generation) {
        return
      }
      const staleMutatedIds = response.items
        .filter(
          (session) =>
            !deletedSessionIds.has(session.id) &&
            (updatedSessionEpochById.get(session.id) ?? 0) > startedAtEpoch
        )
        .map((session) => session.id)
      const staleMutatedIdSet = new Set(staleMutatedIds)
      let refreshedById: Map<string, SessionListItem> | null = null
      if (staleMutatedIds.length > 0) {
        const refreshed = await sessionClient.getLightweightByIds(staleMutatedIds)
        if (disposed || requestGeneration !== generation) {
          return
        }
        refreshedById = new Map(refreshed.map((session) => [session.id, session]))
      }

      const nextResolved = { ...resolvedById.value }
      const liveItems: SessionListItem[] = []
      for (const session of response.items) {
        if (deletedSessionIds.has(session.id)) {
          continue
        }
        if (refreshedById && staleMutatedIdSet.has(session.id)) {
          const fresh = refreshedById.get(session.id) ?? null
          nextResolved[session.id] = fresh
          if (fresh && fresh.agentId === agentId && matchesSessionQuery(fresh, normalizedQuery)) {
            liveItems.push(fresh)
          }
          continue
        }
        liveItems.push(session)
        nextResolved[session.id] = session
        failedResolveIds.delete(session.id)
      }
      if (append) {
        const seen = new Set(sessions.value.map((session) => session.id))
        const appended = liveItems.filter((session) => !seen.has(session.id))
        sessions.value = [...sessions.value, ...appended]
      } else {
        sessions.value = liveItems
      }
      hasMore.value = response.hasMore
      nextCursor.value = response.nextCursor
      resolvedById.value = nextResolved

      if (
        !append &&
        !normalizedQuery &&
        prioritizeSessionId &&
        !deletedSessionIds.has(prioritizeSessionId) &&
        !liveItems.some((session) => session.id === prioritizeSessionId)
      ) {
        void resolveSession(prioritizeSessionId)
      }
    } catch (error) {
      if (!disposed && requestGeneration === generation) {
        onError?.('Failed to load reusable sessions', error, { agentId })
        if (!append) {
          sessions.value = []
        }
        loadFailed.value = true
      }
    } finally {
      if (!disposed && requestGeneration === generation) {
        if (append) {
          loadingMore.value = false
        } else {
          loading.value = false
        }
      }
    }
  }

  const search = (nextQuery: string) => {
    const current = draft.value
    if (!current || current.sessionMode !== 'reuse_session') {
      return
    }
    void load({
      agentId: current.agentId,
      query: nextQuery,
      prioritizeSessionId: current.reuseSessionId
    })
  }

  const loadMore = () => {
    const current = draft.value
    if (
      !current ||
      current.sessionMode !== 'reuse_session' ||
      !current.agentId ||
      loading.value ||
      loadingMore.value ||
      !hasMore.value ||
      !nextCursor.value
    ) {
      return
    }
    void load({
      agentId: current.agentId,
      query: query.value,
      cursor: nextCursor.value,
      append: true
    })
  }

  const refresh = () => {
    const current = draft.value
    if (!current || current.sessionMode !== 'reuse_session') {
      return
    }
    if (current.reuseSessionId && failedResolveIds.has(current.reuseSessionId)) {
      void resolveSession(current.reuseSessionId)
    }
    if (sessions.value.length > 0 && nextCursor.value) {
      void load({
        agentId: current.agentId,
        query: query.value,
        cursor: nextCursor.value,
        append: true
      })
      return
    }
    void load({
      agentId: current.agentId,
      query: query.value,
      prioritizeSessionId: current.reuseSessionId
    })
  }

  const setPickerOpen = (open: boolean) => {
    pickerOpen = open
    if (!open) {
      cancelOpenReload()
      return
    }
    const current = draft.value
    if (!current || current.sessionMode !== 'reuse_session' || !current.agentId) {
      return
    }
    const needsResolveRetry = Boolean(
      current.reuseSessionId && failedResolveIds.has(current.reuseSessionId)
    )
    if (staleOnOpen) {
      void load({
        agentId: current.agentId,
        query: query.value,
        prioritizeSessionId: current.reuseSessionId
      })
      return
    }
    if (needsResolveRetry) {
      void resolveSession(current.reuseSessionId)
    }
  }

  const refreshUpdatedSessions = async (sessionIds: string[]) => {
    try {
      const updated = await sessionClient.getLightweightByIds(sessionIds)
      if (disposed) {
        return
      }
      const updatedById = new Map(updated.map((session) => [session.id, session]))
      const nextResolved = { ...resolvedById.value }
      for (const id of sessionIds) {
        if (deletedSessionIds.has(id)) {
          nextResolved[id] = null
          continue
        }
        nextResolved[id] = updatedById.get(id) ?? null
      }
      resolvedById.value = nextResolved

      const currentAgentId = draft.value?.agentId ?? null
      const activeQuery = query.value
      sessions.value = sessions.value.flatMap((session) => {
        if (!sessionIds.includes(session.id)) {
          return [session]
        }
        if (deletedSessionIds.has(session.id)) {
          return []
        }
        const fresh = updatedById.get(session.id)
        if (
          !fresh ||
          (currentAgentId && fresh.agentId !== currentAgentId) ||
          !matchesSessionQuery(fresh, activeQuery)
        ) {
          return []
        }
        return [fresh]
      })
    } catch (error) {
      if (!disposed) {
        onError?.('Failed to refresh updated sessions', error, { sessionIds })
      }
    }
  }

  const stopReusableSessionsSync = watch(
    () =>
      draft.value && draft.value.sessionMode === 'reuse_session'
        ? `${mode.value}:${draft.value.id}:${draft.value.agentId ?? ''}`
        : null,
    (key) => {
      if (!key || !draft.value) {
        reset()
        return
      }
      void load({
        agentId: draft.value.agentId,
        query: '',
        prioritizeSessionId: draft.value.reuseSessionId
      })
    }
  )

  const stopSelectedReuseSessionSync = watch(
    () =>
      mode.value === 'view'
        ? (selectedJob.value?.reuseSessionId ?? null)
        : (draft.value?.reuseSessionId ?? null),
    (sessionId) => {
      if (sessionId) {
        void resolveSession(sessionId)
      }
    }
  )

  const subscribe = () => {
    unsubscribeUpdates?.()
    unsubscribeUpdates = sessionClient.onUpdated((payload) => {
      if (payload.reason === 'deleted') {
        if (payload.sessionIds.length === 0) {
          return
        }
        const deletedIds = new Set(payload.sessionIds)
        for (const id of deletedIds) {
          deletedSessionIds.add(id)
        }
        sessions.value = sessions.value.filter((session) => !deletedIds.has(session.id))
        let resolvedChanged = false
        const nextResolved = { ...resolvedById.value }
        for (const id of deletedIds) {
          if (
            Object.hasOwn(nextResolved, id) ||
            draft.value?.reuseSessionId === id ||
            selectedJob.value?.reuseSessionId === id
          ) {
            nextResolved[id] = null
            resolvedChanged = true
          }
        }
        if (resolvedChanged) {
          resolvedById.value = nextResolved
        }
        return
      }

      if (payload.reason === 'updated') {
        if (payload.sessionIds.length === 0) {
          return
        }
        mutationEpoch += 1
        for (const id of payload.sessionIds) {
          updatedSessionEpochById.set(id, mutationEpoch)
        }
        const visibleIds = new Set(sessions.value.map((session) => session.id))
        const relevantIds = payload.sessionIds.filter(
          (id) =>
            visibleIds.has(id) ||
            Object.hasOwn(resolvedById.value, id) ||
            draft.value?.reuseSessionId === id ||
            selectedJob.value?.reuseSessionId === id
        )
        if (relevantIds.length > 0) {
          void refreshUpdatedSessions(relevantIds)
        }
        return
      }

      if (
        payload.reason === 'created' ||
        payload.reason === 'list-refreshed' ||
        payload.reason === 'synced'
      ) {
        const current = draft.value
        if (!current || current.sessionMode !== 'reuse_session' || !current.agentId) {
          return
        }
        if (!pickerOpen || sessions.value.length > REUSABLE_SESSIONS_PAGE_SIZE) {
          staleOnOpen = true
          return
        }
        cancelOpenReload()
        openReloadTimer = window.setTimeout(() => {
          openReloadTimer = null
          const latest = draft.value
          if (
            disposed ||
            !pickerOpen ||
            !latest ||
            latest.sessionMode !== 'reuse_session' ||
            !latest.agentId
          ) {
            return
          }
          void load({
            agentId: latest.agentId,
            query: query.value,
            prioritizeSessionId: latest.reuseSessionId
          })
        }, OPEN_RELOAD_DEBOUNCE_MS)
      }
    })
  }

  const dispose = () => {
    disposed = true
    cancelOpenReload()
    generation += 1
    resolveGeneration += 1
    unsubscribeUpdates?.()
    unsubscribeUpdates = null
    stopReusableSessionsSync()
    stopSelectedReuseSessionSync()
  }

  return {
    state,
    search,
    loadMore,
    refresh,
    setPickerOpen,
    subscribe,
    dispose
  }
}
