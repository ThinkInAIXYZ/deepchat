import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { createSessionClient } from '../../../api/SessionClient'
import type {
  ListTapeInspectorPageOutput,
  TapeInspectorEntryCursor,
  TapeInspectorEvidenceCursor,
  TapeInspectorEvidenceRecord,
  TapeInspectorFactFilters,
  TapeInspectorFactRecord,
  TapeInspectorHeadPulse
} from '@shared/types/tape-inspector'
import {
  buildTapeInspectorRows,
  findTapeInspectorPreselection,
  getTapeInspectorDetailCapabilities,
  type TapeInspectorDetailCapabilities,
  type TapeInspectorDetailState,
  type TapeInspectorDisplayRow
} from './model'

const PAGE_LIMIT = 100
const EVIDENCE_PAGE_LIMIT = 100
const LIVE_RETRY_DELAY_MS = 1_000
const SEARCH_FILL_DEBOUNCE_MS = 250
const SEARCH_FILL_MAX_PAGES = 6

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

export const useTapeInspectorStore = defineStore('tapeInspector', () => {
  const sessionClient = createSessionClient()
  const sessionId = ref<string | null>(null)
  const tapeIncarnationId = ref<string | null>(null)
  const snapshotMaxEntryId = ref(0)
  const factsByEntryId = shallowRef(new Map<number, TapeInspectorFactRecord>())
  const factEntryIds = ref<number[]>([])
  const evidenceByTraceId = shallowRef(new Map<string, TapeInspectorEvidenceRecord>())
  const evidenceTraceIds = ref<string[]>([])
  const serverFilters = shallowRef<TapeInspectorFactFilters>({})
  const loadedSearch = ref('')
  const loadingSearchFill = ref(false)
  const livePaused = ref(false)
  const collapsedKeys = ref(new Set<string>())
  const selectedKey = ref<string | null>(null)
  const selectedDetail = ref<TapeInspectorDetailState | null>(null)
  const selectedCapabilities = ref<TapeInspectorDetailCapabilities | null>(null)
  const preselection = ref<TapeInspectorPreselection | null>(null)
  const prependScrollAnchor = ref<TapeInspectorScrollAnchor | null>(null)
  const olderCursor = ref<TapeInspectorEntryCursor | null>(null)
  const newerCursor = ref<TapeInspectorEntryCursor | null>(null)
  const evidenceCursor = ref<TapeInspectorEvidenceCursor | null>(null)
  const loadingInitial = ref(false)
  const loadingOlder = ref(false)
  const loadingNewer = ref(false)
  const loadingEvidence = ref(false)
  const loadingDetail = ref(false)
  const errorCode = ref<TapeInspectorErrorCode>(null)
  let requestGeneration = 0
  let detailRequestGeneration = 0
  let pendingLiveHead: TapeInspectorHeadPulse | null = null
  const liveSyncing = ref(false)
  let liveRetryTimer: ReturnType<typeof setTimeout> | null = null
  let newerPageRequest: { generation: number; promise: Promise<boolean> } | null = null
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
  const rows = computed(() =>
    buildTapeInspectorRows({
      tapeIncarnationId: tapeIncarnationId.value,
      records: records.value,
      evidence: evidence.value,
      collapsedKeys: collapsedKeys.value,
      search: loadedSearch.value
    })
  )
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
    requestGeneration += 1
    detailRequestGeneration += 1
    loadingInitial.value = false
    loadingOlder.value = false
    loadingNewer.value = false
    loadingEvidence.value = false
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
    collapsedKeys.value = new Set()
    selectedKey.value = null
    selectedDetail.value = null
    selectedCapabilities.value = null
    prependScrollAnchor.value = null
    olderCursor.value = null
    newerCursor.value = null
    evidenceCursor.value = null
    errorCode.value = null
    pendingLiveHead = null
  }

  function upsertFacts(incoming: readonly TapeInspectorFactRecord[], replace = false): void {
    const next = replace
      ? new Map<number, TapeInspectorFactRecord>()
      : new Map(factsByEntryId.value)
    let hasNewKey = replace
    for (const record of incoming) {
      if (!next.has(record.entryId)) hasNewKey = true
      next.set(record.entryId, record)
    }
    factsByEntryId.value = next
    if (hasNewKey) factEntryIds.value = [...next.keys()].sort((left, right) => left - right)
  }

  function upsertEvidence(incoming: readonly TapeInspectorEvidenceRecord[], replace = false): void {
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
  }

  function isCurrentRequest(generation: number, requestedSessionId: string): boolean {
    return generation === requestGeneration && sessionId.value === requestedSessionId
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
    upsertFacts(output.records, mode === 'tail')
    if (mode === 'tail') {
      olderCursor.value = output.nextCursor
      newerCursor.value = { sort: 'entryId', entryId: output.snapshotMaxEntryId }
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
          filters: serverFilters.value
        }),
        sessionClient.listTapeInspectorEvidence({
          sessionId: normalizedSessionId,
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
      resolvePreselection()
      requestLoadedSearchFill()
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
    if (!currentSessionId || !incarnation || !cursor) return false
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
    if (livePaused.value || liveSyncing.value) return false
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
    if (paused) clearLiveRetryTimer()
    return paused ? false : await drainLiveHead()
  }

  async function loadMoreEvidence(): Promise<boolean> {
    const currentSessionId = sessionId.value
    const cursor = evidenceCursor.value
    if (!currentSessionId || !cursor || loadingEvidence.value) return false
    const generation = requestGeneration
    loadingEvidence.value = true
    errorCode.value = null
    try {
      const page = await sessionClient.listTapeInspectorEvidence({
        sessionId: currentSessionId,
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
      resolvePreselection()
      return true
    } catch {
      if (isCurrentRequest(generation, currentSessionId)) errorCode.value = 'load_failed'
      return false
    } finally {
      if (isCurrentRequest(generation, currentSessionId)) loadingEvidence.value = false
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
      selectedKey.value = previousSelection
      selectedDetail.value = previousDetail
      selectedCapabilities.value = previousCapabilities
      collapsedKeys.value = previousCollapsedKeys
    }
    return loaded
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
          raw: result.detail.disclosure === 'structured'
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
        detail = { source: 'unbound_lane', count: row.count }
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
    cancelPendingRequests()
    sessionId.value = null
    preselection.value = null
    prependScrollAnchor.value = null
    serverFilters.value = {}
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
    loadedSearch,
    loadingSearchFill,
    livePaused,
    liveSyncing,
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
    loadingDetail,
    errorCode,
    rows,
    selectedRow,
    hasOlder,
    hasMoreEvidence,
    canLoadNewer,
    initialize,
    loadOlderPage,
    loadNewerPage,
    handleLiveHeadPulse,
    setLivePaused,
    loadMoreEvidence,
    applyServerFilters,
    setLoadedSearch,
    toggleCollapsed,
    setPrependScrollAnchor,
    selectRow,
    moveSelection,
    loadSelectedDetail,
    clear
  }
})

export type TapeInspectorStore = ReturnType<typeof useTapeInspectorStore>
export type { TapeInspectorDisplayRow }
