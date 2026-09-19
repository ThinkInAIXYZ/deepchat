import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { createSessionClient } from '../../../api/SessionClient'
import type {
  ListTapeInspectorPageOutput,
  TapeInspectorEntryCursor,
  TapeInspectorEvidenceAppendCursor,
  TapeInspectorEvidenceCursor,
  TapeInspectorEvidenceEntryIdentity,
  TapeInspectorEvidenceRecord,
  TapeInspectorFactFilters,
  TapeInspectorFactRecord,
  TapeInspectorHeadPulse,
  TapeInspectorSort
} from '@shared/types/tape-inspector'
import {
  buildTapeInspectorRows,
  DIAGNOSTIC_EVIDENCE_LANE_KEY,
  findTapeInspectorPreselection,
  getTapeInspectorEvidenceEntryIdentityKey,
  getTapeInspectorDetailCapabilities,
  type TapeInspectorDetailCapabilities,
  type TapeInspectorDetailState,
  type TapeInspectorDisplayRow
} from './model'
import type { TapeInspectorTimelineMode } from './timeline'

const PAGE_LIMIT = 100
const EVIDENCE_PAGE_LIMIT = 100
const EVIDENCE_REFRESH_INTERVAL_MS = 1_000
const LIVE_RETRY_DELAY_MS = 1_000
const SEARCH_FILL_DEBOUNCE_MS = 250
const SEARCH_FILL_MAX_PAGES = 6
const EVIDENCE_PARENT_LOAD_MAX_PAGES = 6
const CANONICAL_SORT = { column: 'entryId', direction: 'asc' } as const

function defaultCollapsedKeys(): Set<string> {
  return new Set([DIAGNOSTIC_EVIDENCE_LANE_KEY])
}

export type TapeInspectorErrorCode = 'load_failed' | 'detail_failed' | 'record_not_found' | null

export interface TapeInspectorPreselection {
  messageId: string
  requestSeq?: number
}

export interface TapeInspectorScrollAnchor {
  key: string
  offset: number
}

interface LiveHeadSyncResult {
  changed: boolean
  retry: boolean
}

function copyFilters(filters: TapeInspectorFactFilters): TapeInspectorFactFilters {
  return {
    ...filters,
    ...(filters.kinds ? { kinds: [...filters.kinds] } : {}),
    ...(filters.families ? { families: [...filters.families] } : {})
  }
}

function sameSort(left: TapeInspectorSort, right: TapeInspectorSort): boolean {
  return left.column === right.column && left.direction === right.direction
}

function applyCollapsedVisibility(
  rows: readonly TapeInspectorDisplayRow[],
  collapsedKeys: ReadonlySet<string>
): TapeInspectorDisplayRow[] {
  const visible: TapeInspectorDisplayRow[] = []
  let hiddenBelowDepth: number | null = null
  for (const row of rows) {
    if (hiddenBelowDepth !== null) {
      if (row.depth > hiddenBelowDepth) continue
      hiddenBelowDepth = null
    }
    if (row.recordType !== 'group' && row.recordType !== 'evidence_lane') {
      visible.push(row)
      continue
    }
    const collapsed = collapsedKeys.has(row.key)
    visible.push(collapsed === row.collapsed ? row : { ...row, collapsed })
    if (collapsed) hiddenBelowDepth = row.depth
  }
  return visible
}

export const useTapeInspectorStore = defineStore('tapeInspector', () => {
  const sessionClient = createSessionClient()
  const sessionId = ref<string | null>(null)
  const tapeIncarnationId = ref<string | null>(null)
  const snapshotMaxEntryId = ref(0)
  const factsByEntryId = shallowRef(new Map<number, TapeInspectorFactRecord>())
  const factEntryIds = ref<number[]>([])
  const evidenceByTraceId = shallowRef(new Map<string, TapeInspectorEvidenceRecord>())
  const evidenceTraceIds = ref<string[]>([])
  const evidenceEntryResolutions = shallowRef(new Map<string, number | null>())
  const serverFilters = shallowRef<TapeInspectorFactFilters>({})
  const serverSort = shallowRef<TapeInspectorSort>(CANONICAL_SORT)
  const timelineMode = ref<TapeInspectorTimelineMode>('actual')
  const loadedSearch = ref('')
  const loadingSearchFill = ref(false)
  const livePaused = ref(false)
  const collapsedKeys = ref(defaultCollapsedKeys())
  const selectedKey = ref<string | null>(null)
  const selectedDetail = ref<TapeInspectorDetailState | null>(null)
  const selectedCapabilities = ref<TapeInspectorDetailCapabilities | null>(null)
  const preselection = ref<TapeInspectorPreselection | null>(null)
  const prependScrollAnchor = ref<TapeInspectorScrollAnchor | null>(null)
  const olderCursor = shallowRef<TapeInspectorEntryCursor | null>(null)
  const newerCursor = shallowRef<TapeInspectorEntryCursor | null>(null)
  const evidenceCursor = shallowRef<TapeInspectorEvidenceCursor | null>(null)
  const evidenceNewerCursor = shallowRef<TapeInspectorEvidenceAppendCursor | null>(null)
  const loadingInitial = ref(false)
  const loadingOlder = ref(false)
  const loadingNewer = ref(false)
  const loadingEvidence = ref(false)
  const loadingEvidenceParents = ref(false)
  const loadingDetail = ref(false)
  const errorCode = ref<TapeInspectorErrorCode>(null)
  const liveEvidenceRevision = ref(0)
  let requestGeneration = 0
  let detailRequestGeneration = 0
  let pendingLiveHead: TapeInspectorHeadPulse | null = null
  const liveSyncing = ref(false)
  let liveRetryTimer: ReturnType<typeof setTimeout> | null = null
  let newerPageRequest: { generation: number; promise: Promise<boolean> } | null = null
  let evidenceRefreshTimer: ReturnType<typeof setInterval> | null = null
  let evidenceRefreshEnabled = false
  let evidenceRefreshRequest: { generation: number; promise: Promise<boolean> } | null = null
  let searchFillGeneration = 0
  let searchFillTimer: ReturnType<typeof setTimeout> | null = null
  let searchFillActive = false
  let searchFillRequested = false

  const records = computed(() =>
    factEntryIds.value.flatMap((entryId) => {
      const record = factsByEntryId.value.get(entryId)
      return record ? [record] : []
    })
  )
  const evidence = computed(() =>
    evidenceTraceIds.value.flatMap((traceId) => {
      const record = evidenceByTraceId.value.get(traceId)
      return record ? [record] : []
    })
  )
  const canonicalSort = computed(() => serverSort.value.column === 'entryId')
  const entryFiltersCanHideEvidenceParents = computed(
    () =>
      Boolean(serverFilters.value.kinds?.length) ||
      Boolean(serverFilters.value.families?.length) ||
      Boolean(serverFilters.value.name) ||
      Boolean(serverFilters.value.namePrefix) ||
      Boolean(serverFilters.value.factStatus) ||
      serverFilters.value.errorsOnly === true
  )
  const overviewRows = computed(() =>
    buildTapeInspectorRows({
      tapeIncarnationId: tapeIncarnationId.value,
      records: records.value,
      evidence: evidence.value,
      evidenceEntryResolutions: evidenceEntryResolutions.value,
      collapsedKeys: new Set(),
      search: loadedSearch.value,
      flat: !canonicalSort.value,
      chronological: canonicalSort.value && timelineMode.value === 'actual',
      hasOlder: olderCursor.value !== null,
      filtersActive: entryFiltersCanHideEvidenceParents.value,
      loadingNewer: loadingNewer.value
    })
  )
  const rows = computed(() => applyCollapsedVisibility(overviewRows.value, collapsedKeys.value))
  const selectedRow = computed(
    () => rows.value.find((row) => row.key === selectedKey.value) ?? null
  )
  const hasOlder = computed(() => olderCursor.value !== null)
  const hasMoreEvidence = computed(() => evidenceCursor.value !== null)
  const canLoadNewer = computed(
    () =>
      tapeIncarnationId.value !== null &&
      newerCursor.value !== null &&
      !loadingInitial.value &&
      !loadingNewer.value
  )
  const earlierEvidenceEntryIds = computed(() => {
    const oldestLoadedEntryId = factEntryIds.value[0]
    if (oldestLoadedEntryId === undefined) return []
    const entryIds = new Set<number>()
    for (const record of evidence.value) {
      const key = getTapeInspectorEvidenceEntryIdentityKey(record)
      if (!key) continue
      const entryId = evidenceEntryResolutions.value.get(key)
      if (
        typeof entryId === 'number' &&
        entryId < oldestLoadedEntryId &&
        !factsByEntryId.value.has(entryId)
      ) {
        entryIds.add(entryId)
      }
    }
    return [...entryIds].sort((left, right) => right - left)
  })
  const hasEarlierEvidenceEntries = computed(() => earlierEvidenceEntryIds.value.length > 0)
  const canLoadEvidenceParents = computed(
    () =>
      hasEarlierEvidenceEntries.value &&
      hasOlder.value &&
      canonicalSort.value &&
      !entryFiltersCanHideEvidenceParents.value &&
      !loadingInitial.value &&
      !loadingOlder.value &&
      !loadingEvidenceParents.value
  )

  function clearSearchFillTimer(): void {
    if (searchFillTimer === null) return
    clearTimeout(searchFillTimer)
    searchFillTimer = null
  }

  function cancelLoadedSearchFill(): void {
    searchFillGeneration += 1
    searchFillRequested = false
    clearSearchFillTimer()
    loadingSearchFill.value = false
  }

  function scheduleLoadedSearchFill(generation: number, delayMs: number): void {
    clearSearchFillTimer()
    searchFillTimer = setTimeout(() => {
      searchFillTimer = null
      void fillLoadedSearch(generation)
    }, delayMs)
  }

  function requestLoadedSearchFill(delayMs = SEARCH_FILL_DEBOUNCE_MS): void {
    const generation = ++searchFillGeneration
    clearSearchFillTimer()
    if (
      loadedSearch.value.trim().length === 0 ||
      rows.value.length > 0 ||
      (olderCursor.value === null && evidenceCursor.value === null)
    ) {
      searchFillRequested = false
      loadingSearchFill.value = false
      return
    }
    searchFillRequested = true
    loadingSearchFill.value = true
    scheduleLoadedSearchFill(generation, delayMs)
  }

  async function fillLoadedSearch(generation: number): Promise<void> {
    if (generation !== searchFillGeneration || !searchFillRequested || searchFillActive) {
      return
    }
    searchFillActive = true
    let pagesLoaded = 0
    try {
      while (
        generation === searchFillGeneration &&
        loadedSearch.value.trim().length > 0 &&
        rows.value.length === 0 &&
        pagesLoaded < SEARCH_FILL_MAX_PAGES
      ) {
        let advanced = false
        if (olderCursor.value !== null && pagesLoaded < SEARCH_FILL_MAX_PAGES) {
          if (await loadOlderPage()) {
            pagesLoaded += 1
            advanced = true
          }
          if (generation !== searchFillGeneration || rows.value.length > 0) break
        }
        if (evidenceCursor.value !== null && pagesLoaded < SEARCH_FILL_MAX_PAGES) {
          if (await loadMoreEvidence()) {
            pagesLoaded += 1
            advanced = true
          }
          if (generation !== searchFillGeneration || rows.value.length > 0) break
        }
        if (!advanced) break
      }
    } finally {
      searchFillActive = false
      if (generation !== searchFillGeneration && searchFillRequested) {
        scheduleLoadedSearchFill(searchFillGeneration, 0)
      } else if (generation === searchFillGeneration) {
        searchFillRequested = false
        loadingSearchFill.value = false
      }
    }
  }

  function cancelPendingRequests(): number {
    cancelLoadedSearchFill()
    suspendEvidenceRefresh()
    requestGeneration += 1
    detailRequestGeneration += 1
    loadingInitial.value = false
    loadingOlder.value = false
    loadingNewer.value = false
    loadingEvidence.value = false
    loadingEvidenceParents.value = false
    loadingDetail.value = false
    return requestGeneration
  }

  function clearProjection(): void {
    clearLiveRetryTimer()
    tapeIncarnationId.value = null
    snapshotMaxEntryId.value = 0
    factsByEntryId.value = new Map()
    factEntryIds.value = []
    evidenceByTraceId.value = new Map()
    evidenceTraceIds.value = []
    evidenceEntryResolutions.value = new Map()
    collapsedKeys.value = defaultCollapsedKeys()
    selectedKey.value = null
    selectedDetail.value = null
    selectedCapabilities.value = null
    prependScrollAnchor.value = null
    olderCursor.value = null
    newerCursor.value = null
    evidenceCursor.value = null
    evidenceNewerCursor.value = null
    liveEvidenceRevision.value = 0
    errorCode.value = null
    pendingLiveHead = null
  }

  function upsertFacts(
    incoming: readonly TapeInspectorFactRecord[],
    mode: 'tail' | 'older' | 'newer'
  ): void {
    const replace = mode === 'tail'
    const next = replace
      ? new Map<number, TapeInspectorFactRecord>()
      : new Map(factsByEntryId.value)
    const incomingIds: number[] = []
    for (const record of incoming) {
      if (!next.has(record.entryId)) incomingIds.push(record.entryId)
      next.set(record.entryId, record)
    }
    factsByEntryId.value = next
    if (replace) {
      factEntryIds.value = incoming.map((record) => record.entryId)
    } else if (incomingIds.length > 0) {
      factEntryIds.value = canonicalSort.value
        ? [...next.keys()].sort((left, right) => left - right)
        : [...factEntryIds.value, ...incomingIds]
    }
    const nextResolutions = new Map(evidenceEntryResolutions.value)
    let resolutionsChanged = false
    for (const record of incoming) {
      if (
        record.name !== 'provider/attempt_completed' ||
        !record.messageId ||
        record.requestSeq === undefined ||
        record.physicalAttempt === undefined
      ) {
        continue
      }
      const key = getTapeInspectorEvidenceEntryIdentityKey({
        messageId: record.messageId,
        requestSeq: record.requestSeq,
        physicalAttempt: record.physicalAttempt
      })
      if (!key || nextResolutions.get(key) === record.entryId) continue
      nextResolutions.set(key, record.entryId)
      resolutionsChanged = true
    }
    if (resolutionsChanged) evidenceEntryResolutions.value = nextResolutions
  }

  function upsertEvidence(
    incoming: readonly TapeInspectorEvidenceRecord[],
    replace = false
  ): boolean {
    const next = replace
      ? new Map<string, TapeInspectorEvidenceRecord>()
      : new Map(evidenceByTraceId.value)
    let hasNewKey = replace
    for (const record of incoming) {
      if (!next.has(record.traceId)) hasNewKey = true
      next.set(record.traceId, record)
    }
    evidenceByTraceId.value = next
    if (hasNewKey) {
      evidenceTraceIds.value = [...next.values()]
        .sort(
          (left, right) =>
            left.createdAt - right.createdAt || left.traceId.localeCompare(right.traceId)
        )
        .map((record) => record.traceId)
    }
    return hasNewKey
  }

  function isCurrentRequest(generation: number, requestedSessionId: string): boolean {
    return generation === requestGeneration && sessionId.value === requestedSessionId
  }

  async function resolveEvidenceEntries(
    incoming: readonly TapeInspectorEvidenceRecord[],
    generation: number,
    requestedSessionId: string,
    expectedTapeIncarnationId: string
  ): Promise<'ok' | 'reset' | 'failed'> {
    const identities = new Map<string, TapeInspectorEvidenceEntryIdentity>()
    for (const record of incoming) {
      const key = getTapeInspectorEvidenceEntryIdentityKey(record)
      if (!key || record.physicalAttempt === undefined) continue
      identities.set(key, {
        messageId: record.messageId,
        requestSeq: record.requestSeq,
        physicalAttempt: record.physicalAttempt
      })
    }
    if (identities.size === 0) return 'ok'

    try {
      const output = await sessionClient.resolveTapeInspectorEvidenceEntries({
        sessionId: requestedSessionId,
        expectedTapeIncarnationId,
        identities: [...identities.values()]
      })
      if (!isCurrentRequest(generation, requestedSessionId)) return 'failed'
      if (output.status === 'reset' || output.tapeIncarnationId !== expectedTapeIncarnationId) {
        return 'reset'
      }
      const next = new Map(evidenceEntryResolutions.value)
      for (const resolution of output.resolutions) {
        const key = getTapeInspectorEvidenceEntryIdentityKey(resolution)
        if (key) next.set(key, resolution.entryId)
      }
      evidenceEntryResolutions.value = next
      return 'ok'
    } catch {
      return 'failed'
    }
  }

  function resolvePreselection(): void {
    const target = preselection.value
    if (!target || selectedKey.value !== null) return
    const key = findTapeInspectorPreselection({
      rows: rows.value,
      messageId: target.messageId,
      requestSeq: target.requestSeq
    })
    if (key) selectedKey.value = key
  }

  function applyPage(
    output: Extract<ListTapeInspectorPageOutput, { status: 'ok' }>,
    mode: 'tail' | 'older' | 'newer'
  ): void {
    tapeIncarnationId.value = output.tapeIncarnationId
    snapshotMaxEntryId.value = Math.max(snapshotMaxEntryId.value, output.snapshotMaxEntryId)
    upsertFacts(output.records, mode)
    if (mode === 'tail') {
      olderCursor.value = output.nextCursor
      newerCursor.value = canonicalSort.value
        ? { sort: 'entryId', entryId: output.snapshotMaxEntryId }
        : null
    } else if (mode === 'older') {
      olderCursor.value = output.nextCursor
    } else {
      newerCursor.value = output.nextCursor ?? {
        sort: 'entryId',
        entryId: output.snapshotMaxEntryId
      }
    }
    resolvePreselection()
  }

  async function initialize(
    requestedSessionId: string,
    options: {
      preselection?: TapeInspectorPreselection | null
      filters?: TapeInspectorFactFilters
    } = {}
  ): Promise<boolean> {
    const normalizedSessionId = requestedSessionId.trim()
    if (!normalizedSessionId) return false
    const generation = cancelPendingRequests()
    sessionId.value = normalizedSessionId
    preselection.value = options.preselection ?? null
    serverFilters.value = copyFilters(
      options.filters ??
        (preselection.value
          ? {
              messageId: preselection.value.messageId,
              ...(preselection.value.requestSeq === undefined
                ? {}
                : { requestSeq: preselection.value.requestSeq })
            }
          : {})
    )
    clearProjection()
    loadingInitial.value = true
    loadingEvidence.value = true

    try {
      const [page, evidencePage] = await Promise.all([
        sessionClient.listTapeInspectorPage({
          sessionId: normalizedSessionId,
          mode: 'tail',
          limit: PAGE_LIMIT,
          sort: serverSort.value,
          filters: serverFilters.value
        }),
        sessionClient.listTapeInspectorEvidence({
          sessionId: normalizedSessionId,
          mode: 'older',
          limit: EVIDENCE_PAGE_LIMIT,
          ...(serverFilters.value.messageId
            ? {
                messageId: serverFilters.value.messageId
              }
            : {}),
          ...(serverFilters.value.requestSeq === undefined
            ? {}
            : { requestSeq: serverFilters.value.requestSeq })
        })
      ])
      if (!isCurrentRequest(generation, normalizedSessionId)) return false
      if (page.status === 'reset') {
        errorCode.value = 'load_failed'
        return false
      }
      applyPage(page, 'tail')
      upsertEvidence(evidencePage.records, true)
      evidenceCursor.value = evidencePage.nextCursor
      evidenceNewerCursor.value = evidencePage.newerCursor
      const resolution = await resolveEvidenceEntries(
        evidencePage.records,
        generation,
        normalizedSessionId,
        page.tapeIncarnationId
      )
      if (resolution === 'reset') return await resetForIncarnationChange()
      if (!isCurrentRequest(generation, normalizedSessionId)) return false
      resolvePreselection()
      requestLoadedSearchFill()
      if (evidenceRefreshEnabled) startEvidenceRefresh()
      return true
    } catch {
      if (isCurrentRequest(generation, normalizedSessionId)) errorCode.value = 'load_failed'
      return false
    } finally {
      if (isCurrentRequest(generation, normalizedSessionId)) {
        loadingInitial.value = false
        loadingEvidence.value = false
      }
    }
  }

  async function resetForIncarnationChange(): Promise<boolean> {
    const currentSessionId = sessionId.value
    if (!currentSessionId) return false
    return await initialize(currentSessionId, {
      preselection: preselection.value,
      filters: serverFilters.value
    })
  }

  async function loadOlderPage(): Promise<boolean> {
    const currentSessionId = sessionId.value
    const incarnation = tapeIncarnationId.value
    const cursor = olderCursor.value
    if (!currentSessionId || !incarnation || !cursor || loadingOlder.value) return false
    const generation = requestGeneration
    loadingOlder.value = true
    errorCode.value = null
    try {
      const page = await sessionClient.listTapeInspectorPage({
        sessionId: currentSessionId,
        expectedTapeIncarnationId: incarnation,
        mode: 'older',
        cursor,
        limit: PAGE_LIMIT,
        sort: serverSort.value,
        filters: serverFilters.value
      })
      if (!isCurrentRequest(generation, currentSessionId)) return false
      if (page.status === 'reset' || page.tapeIncarnationId !== incarnation) {
        await resetForIncarnationChange()
        return false
      }
      applyPage(page, 'older')
      return true
    } catch {
      if (isCurrentRequest(generation, currentSessionId)) errorCode.value = 'load_failed'
      return false
    } finally {
      if (isCurrentRequest(generation, currentSessionId)) loadingOlder.value = false
    }
  }

  async function loadNewerPage(): Promise<boolean> {
    const currentSessionId = sessionId.value
    const incarnation = tapeIncarnationId.value
    const cursor = newerCursor.value
    if (!currentSessionId || !incarnation || !cursor || !canonicalSort.value) return false
    const generation = requestGeneration
    if (newerPageRequest?.generation === generation) return await newerPageRequest.promise

    const promise = (async () => {
      loadingNewer.value = true
      errorCode.value = null
      try {
        const page = await sessionClient.listTapeInspectorPage({
          sessionId: currentSessionId,
          expectedTapeIncarnationId: incarnation,
          mode: 'newer',
          cursor,
          limit: PAGE_LIMIT,
          sort: CANONICAL_SORT,
          filters: serverFilters.value
        })
        if (!isCurrentRequest(generation, currentSessionId)) return false
        if (page.status === 'reset' || page.tapeIncarnationId !== incarnation) {
          await resetForIncarnationChange()
          return false
        }
        applyPage(page, 'newer')
        return true
      } catch {
        if (isCurrentRequest(generation, currentSessionId)) errorCode.value = 'load_failed'
        return false
      } finally {
        if (isCurrentRequest(generation, currentSessionId)) loadingNewer.value = false
      }
    })()
    newerPageRequest = { generation, promise }
    try {
      return await promise
    } finally {
      if (newerPageRequest?.promise === promise) newerPageRequest = null
    }
  }

  async function loadEarlierEvidenceEntries(): Promise<boolean> {
    const currentSessionId = sessionId.value
    if (!currentSessionId || !canLoadEvidenceParents.value) return false
    const generation = requestGeneration
    loadingEvidenceParents.value = true
    let pagesLoaded = 0
    try {
      while (
        isCurrentRequest(generation, currentSessionId) &&
        earlierEvidenceEntryIds.value.length > 0 &&
        olderCursor.value !== null &&
        pagesLoaded < EVIDENCE_PARENT_LOAD_MAX_PAGES
      ) {
        const cursorBefore = olderCursor.value
        if (!(await loadOlderPage())) break
        pagesLoaded += 1
        if (olderCursor.value === cursorBefore) break
      }
      return pagesLoaded > 0
    } finally {
      if (isCurrentRequest(generation, currentSessionId)) loadingEvidenceParents.value = false
    }
  }

  function queueLiveHead(pulse: TapeInspectorHeadPulse): void {
    const pending = pendingLiveHead
    if (
      !pending ||
      pending.tapeIncarnationId !== pulse.tapeIncarnationId ||
      pulse.maxEntryId > pending.maxEntryId
    ) {
      pendingLiveHead = pulse
    }
  }

  async function synchronizeLiveHead(pulse: TapeInspectorHeadPulse): Promise<LiveHeadSyncResult> {
    const currentSessionId = sessionId.value
    if (!currentSessionId || pulse.sessionId !== currentSessionId) {
      return { changed: false, retry: false }
    }
    if (tapeIncarnationId.value !== pulse.tapeIncarnationId) {
      const reset = await resetForIncarnationChange()
      return {
        changed: reset,
        retry: !reset && sessionId.value === currentSessionId
      }
    }

    let changed = false
    while (
      !livePaused.value &&
      sessionId.value === currentSessionId &&
      tapeIncarnationId.value === pulse.tapeIncarnationId &&
      (newerCursor.value?.entryId ?? snapshotMaxEntryId.value) < pulse.maxEntryId
    ) {
      const beforeCursor = newerCursor.value?.entryId ?? snapshotMaxEntryId.value
      const beforeRecords = factsByEntryId.value.size
      const beforeIncarnation = tapeIncarnationId.value
      if (!(await loadNewerPage())) {
        changed = changed || tapeIncarnationId.value !== beforeIncarnation
        const currentCursor = newerCursor.value?.entryId ?? snapshotMaxEntryId.value
        return {
          changed,
          retry:
            sessionId.value === currentSessionId &&
            errorCode.value === 'load_failed' &&
            (tapeIncarnationId.value === null ||
              (tapeIncarnationId.value === pulse.tapeIncarnationId &&
                currentCursor < pulse.maxEntryId))
        }
      }
      changed = changed || factsByEntryId.value.size !== beforeRecords
      const afterCursor = newerCursor.value?.entryId ?? snapshotMaxEntryId.value
      if (afterCursor <= beforeCursor) break
    }
    return { changed, retry: false }
  }

  function clearLiveRetryTimer(): void {
    if (liveRetryTimer === null) return
    clearTimeout(liveRetryTimer)
    liveRetryTimer = null
  }

  function scheduleLiveRetry(): void {
    if (
      liveRetryTimer !== null ||
      livePaused.value ||
      pendingLiveHead === null ||
      sessionId.value === null
    ) {
      return
    }
    liveRetryTimer = setTimeout(() => {
      liveRetryTimer = null
      void drainLiveHead()
    }, LIVE_RETRY_DELAY_MS)
  }

  async function drainLiveHead(): Promise<boolean> {
    if (livePaused.value || liveSyncing.value || !canonicalSort.value) return false
    clearLiveRetryTimer()
    liveSyncing.value = true
    let changed = false
    try {
      while (!livePaused.value && pendingLiveHead) {
        const pulse = pendingLiveHead
        pendingLiveHead = null
        const result = await synchronizeLiveHead(pulse)
        changed = result.changed || changed
        if (result.retry) {
          queueLiveHead(pulse)
          break
        }
      }
      return changed
    } finally {
      liveSyncing.value = false
      scheduleLiveRetry()
    }
  }

  async function handleLiveHeadPulse(pulse: TapeInspectorHeadPulse): Promise<boolean> {
    if (pulse.sessionId !== sessionId.value) return false
    queueLiveHead(pulse)
    return await drainLiveHead()
  }

  async function setLivePaused(paused: boolean): Promise<boolean> {
    livePaused.value = paused
    if (paused) {
      clearLiveRetryTimer()
      suspendEvidenceRefresh()
      return false
    }
    startEvidenceRefresh()
    const [factsChanged, evidenceChanged] = await Promise.all([
      drainLiveHead(),
      refreshNewerEvidence()
    ])
    return factsChanged || evidenceChanged
  }

  async function loadMoreEvidence(): Promise<boolean> {
    const currentSessionId = sessionId.value
    const incarnation = tapeIncarnationId.value
    const cursor = evidenceCursor.value
    if (!currentSessionId || !incarnation || !cursor || loadingEvidence.value) return false
    const generation = requestGeneration
    loadingEvidence.value = true
    errorCode.value = null
    try {
      const page = await sessionClient.listTapeInspectorEvidence({
        sessionId: currentSessionId,
        mode: 'older',
        cursor,
        limit: EVIDENCE_PAGE_LIMIT,
        ...(serverFilters.value.messageId
          ? {
              messageId: serverFilters.value.messageId
            }
          : {}),
        ...(serverFilters.value.requestSeq === undefined
          ? {}
          : { requestSeq: serverFilters.value.requestSeq })
      })
      if (!isCurrentRequest(generation, currentSessionId)) return false
      upsertEvidence(page.records)
      evidenceCursor.value = page.nextCursor
      const resolution = await resolveEvidenceEntries(
        page.records,
        generation,
        currentSessionId,
        incarnation
      )
      if (resolution === 'reset') {
        await resetForIncarnationChange()
        return false
      }
      if (!isCurrentRequest(generation, currentSessionId)) return false
      resolvePreselection()
      return true
    } catch {
      if (isCurrentRequest(generation, currentSessionId)) errorCode.value = 'load_failed'
      return false
    } finally {
      if (isCurrentRequest(generation, currentSessionId)) loadingEvidence.value = false
    }
  }

  function suspendEvidenceRefresh(): void {
    if (evidenceRefreshTimer === null) return
    clearInterval(evidenceRefreshTimer)
    evidenceRefreshTimer = null
  }

  function startEvidenceRefresh(): void {
    evidenceRefreshEnabled = true
    if (evidenceRefreshTimer !== null || livePaused.value || sessionId.value === null) return
    evidenceRefreshTimer = setInterval(() => {
      void refreshNewerEvidence()
    }, EVIDENCE_REFRESH_INTERVAL_MS)
  }

  function stopEvidenceRefresh(): void {
    evidenceRefreshEnabled = false
    suspendEvidenceRefresh()
  }

  async function refreshNewerEvidence(): Promise<boolean> {
    const currentSessionId = sessionId.value
    if (!currentSessionId || livePaused.value || loadingInitial.value) return false
    const generation = requestGeneration
    if (evidenceRefreshRequest?.generation === generation) {
      return await evidenceRefreshRequest.promise
    }
    const cursor = evidenceNewerCursor.value
    const promise = (async () => {
      try {
        const page = await sessionClient.listTapeInspectorEvidence({
          sessionId: currentSessionId,
          mode: 'newer',
          limit: EVIDENCE_PAGE_LIMIT,
          ...(cursor ? { cursor } : {}),
          ...(serverFilters.value.messageId
            ? {
                messageId: serverFilters.value.messageId
              }
            : {}),
          ...(serverFilters.value.requestSeq === undefined
            ? {}
            : { requestSeq: serverFilters.value.requestSeq })
        })
        if (livePaused.value || !isCurrentRequest(generation, currentSessionId)) return false
        const changed = upsertEvidence(page.records)
        evidenceNewerCursor.value = page.newerCursor
        const incarnation = tapeIncarnationId.value
        if (incarnation) {
          const resolution = await resolveEvidenceEntries(
            page.records,
            generation,
            currentSessionId,
            incarnation
          )
          if (resolution === 'reset') {
            await resetForIncarnationChange()
            return false
          }
        }
        if (livePaused.value || !isCurrentRequest(generation, currentSessionId)) return false
        resolvePreselection()
        if (changed) liveEvidenceRevision.value += 1
        return changed
      } catch {
        return false
      }
    })()
    evidenceRefreshRequest = { generation, promise }
    try {
      return await promise
    } finally {
      if (evidenceRefreshRequest?.promise === promise) evidenceRefreshRequest = null
    }
  }

  async function applyServerFilters(filters: TapeInspectorFactFilters): Promise<boolean> {
    const currentSessionId = sessionId.value
    if (!currentSessionId) {
      serverFilters.value = copyFilters(filters)
      return false
    }
    const previousIncarnation = tapeIncarnationId.value
    const previousSelection = selectedKey.value
    const previousDetail = selectedDetail.value
    const previousCapabilities = selectedCapabilities.value
    const previousCollapsedKeys = collapsedKeys.value
    preselection.value = null
    const loaded = await initialize(currentSessionId, {
      preselection: null,
      filters
    })
    if (loaded && tapeIncarnationId.value === previousIncarnation) {
      collapsedKeys.value = previousCollapsedKeys
      if (previousSelection && rows.value.some((row) => row.key === previousSelection)) {
        selectedKey.value = previousSelection
        selectedDetail.value = previousDetail
        selectedCapabilities.value = previousCapabilities
      }
    }
    return loaded
  }

  async function applyServerSort(sort: TapeInspectorSort): Promise<boolean> {
    if (sameSort(serverSort.value, sort)) return true
    const currentSessionId = sessionId.value
    serverSort.value = sort
    if (sort.column !== 'entryId') timelineMode.value = 'sequence'
    cancelLoadedSearchFill()
    if (!currentSessionId) return false
    const previousIncarnation = tapeIncarnationId.value
    const previousSelection = selectedKey.value
    const previousDetail = selectedDetail.value
    const previousCapabilities = selectedCapabilities.value
    const previousCollapsedKeys = collapsedKeys.value
    const loaded = await initialize(currentSessionId, {
      preselection: preselection.value,
      filters: serverFilters.value
    })
    if (loaded && tapeIncarnationId.value === previousIncarnation) {
      collapsedKeys.value = previousCollapsedKeys
      if (previousSelection && rows.value.some((row) => row.key === previousSelection)) {
        selectedKey.value = previousSelection
        selectedDetail.value = previousDetail
        selectedCapabilities.value = previousCapabilities
      }
    }
    return loaded
  }

  async function setTimelineMode(mode: TapeInspectorTimelineMode): Promise<boolean> {
    if (timelineMode.value === mode && (mode !== 'actual' || canonicalSort.value)) return true
    if (mode === 'actual' && !canonicalSort.value) {
      const restored = await applyServerSort(CANONICAL_SORT)
      if (!restored) return false
    }
    timelineMode.value = mode
    return true
  }

  function setLoadedSearch(search: string): void {
    loadedSearch.value = search
    requestLoadedSearchFill()
  }

  function toggleCollapsed(key: string): void {
    const next = new Set(collapsedKeys.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    collapsedKeys.value = next
  }

  function setPrependScrollAnchor(anchor: TapeInspectorScrollAnchor | null): void {
    prependScrollAnchor.value = anchor
  }

  function selectRow(key: string | null): void {
    detailRequestGeneration += 1
    selectedKey.value = key
    selectedDetail.value = null
    selectedCapabilities.value = null
    errorCode.value = null
    loadingDetail.value = false
  }

  function revealOverviewRow(key: string): boolean {
    const targetIndex = overviewRows.value.findIndex((row) => row.key === key)
    if (targetIndex < 0) return false
    const target = overviewRows.value[targetIndex]
    const nextCollapsed = new Set(collapsedKeys.value)
    let ancestorDepth = target.depth - 1
    for (let index = targetIndex - 1; index >= 0 && ancestorDepth >= 0; index -= 1) {
      const candidate = overviewRows.value[index]
      if (
        candidate.depth === ancestorDepth &&
        (candidate.recordType === 'group' || candidate.recordType === 'evidence_lane')
      ) {
        nextCollapsed.delete(candidate.key)
        ancestorDepth -= 1
      }
    }
    collapsedKeys.value = nextCollapsed
    selectRow(key)
    return true
  }

  function moveSelection(offset: -1 | 1): string | null {
    if (rows.value.length === 0) return null
    const currentIndex = rows.value.findIndex((row) => row.key === selectedKey.value)
    const nextIndex = Math.min(
      rows.value.length - 1,
      Math.max(
        0,
        currentIndex < 0 ? (offset > 0 ? 0 : rows.value.length - 1) : currentIndex + offset
      )
    )
    selectRow(rows.value[nextIndex].key)
    return selectedKey.value
  }

  async function loadSelectedDetail(): Promise<boolean> {
    const row = selectedRow.value
    const currentSessionId = sessionId.value
    const incarnation = tapeIncarnationId.value
    if (!row || !currentSessionId || !incarnation) return false
    const selected = row.key
    const generation = ++detailRequestGeneration
    loadingDetail.value = true
    errorCode.value = null
    selectedCapabilities.value = getTapeInspectorDetailCapabilities(row)

    try {
      let detail: TapeInspectorDetailState
      if (row.recordType === 'fact') {
        const result = await sessionClient.getTapeInspectorRecordDetail({
          sessionId: currentSessionId,
          expectedTapeIncarnationId: incarnation,
          entryId: row.record.entryId
        })
        if (
          generation !== detailRequestGeneration ||
          selectedKey.value !== selected ||
          sessionId.value !== currentSessionId
        ) {
          return false
        }
        if (result.status === 'reset') {
          await resetForIncarnationChange()
          return false
        }
        if (result.tapeIncarnationId !== incarnation) {
          await resetForIncarnationChange()
          return false
        }
        if (result.status === 'not_found' || result.detail.record.entryId !== row.record.entryId) {
          errorCode.value = 'record_not_found'
          return false
        }
        selectedCapabilities.value = {
          ...selectedCapabilities.value!,
          payload: result.detail.disclosure === 'structured',
          raw: true
        }
        detail = { source: 'tape', detail: result.detail }
      } else if (row.recordType === 'evidence') {
        const traces = await sessionClient.listMessageTraces(row.record.messageId)
        if (
          generation !== detailRequestGeneration ||
          selectedKey.value !== selected ||
          sessionId.value !== currentSessionId
        ) {
          return false
        }
        const trace = traces.find((candidate) => candidate.id === row.record.traceId)
        if (
          !trace ||
          trace.sessionId !== currentSessionId ||
          trace.messageId !== row.record.messageId ||
          trace.requestSeq !== row.record.requestSeq ||
          (trace.physicalAttempt ?? undefined) !== row.record.physicalAttempt
        ) {
          errorCode.value = 'record_not_found'
          return false
        }
        detail = { source: 'request', trace }
      } else if (row.recordType === 'group') {
        detail = { source: 'derived', group: row.group }
      } else {
        detail = { source: 'evidence_lane', laneKind: row.laneKind, count: row.count }
      }
      if (
        generation !== detailRequestGeneration ||
        selectedKey.value !== selected ||
        sessionId.value !== currentSessionId
      ) {
        return false
      }
      selectedDetail.value = detail
      return true
    } catch {
      if (
        generation === detailRequestGeneration &&
        selectedKey.value === selected &&
        sessionId.value === currentSessionId
      ) {
        errorCode.value = 'detail_failed'
      }
      return false
    } finally {
      if (generation === detailRequestGeneration) loadingDetail.value = false
    }
  }

  function clear(): void {
    stopEvidenceRefresh()
    cancelPendingRequests()
    sessionId.value = null
    preselection.value = null
    prependScrollAnchor.value = null
    serverFilters.value = {}
    serverSort.value = CANONICAL_SORT
    timelineMode.value = 'actual'
    loadedSearch.value = ''
    livePaused.value = false
    clearProjection()
  }

  return {
    sessionId,
    tapeIncarnationId,
    snapshotMaxEntryId,
    records,
    evidence,
    serverFilters,
    serverSort,
    timelineMode,
    canonicalSort,
    loadedSearch,
    loadingSearchFill,
    livePaused,
    liveSyncing,
    liveEvidenceRevision,
    collapsedKeys,
    selectedKey,
    selectedDetail,
    selectedCapabilities,
    preselection,
    prependScrollAnchor,
    loadingInitial,
    loadingOlder,
    loadingNewer,
    loadingEvidence,
    loadingEvidenceParents,
    loadingDetail,
    errorCode,
    rows,
    overviewRows,
    selectedRow,
    hasOlder,
    hasMoreEvidence,
    hasEarlierEvidenceEntries,
    canLoadEvidenceParents,
    canLoadNewer,
    initialize,
    loadOlderPage,
    loadNewerPage,
    loadEarlierEvidenceEntries,
    handleLiveHeadPulse,
    setLivePaused,
    startEvidenceRefresh,
    stopEvidenceRefresh,
    loadMoreEvidence,
    applyServerFilters,
    applyServerSort,
    setTimelineMode,
    setLoadedSearch,
    toggleCollapsed,
    setPrependScrollAnchor,
    selectRow,
    revealOverviewRow,
    moveSelection,
    loadSelectedDetail,
    clear
  }
})

export type TapeInspectorStore = ReturnType<typeof useTapeInspectorStore>
export type { TapeInspectorDisplayRow }
