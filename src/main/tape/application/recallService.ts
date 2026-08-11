import type {
  AgentTapeAnchorsOptions,
  AgentTapeContextEntry,
  AgentTapeContextOptions,
  AgentTapeContextResult,
  AgentTapeSearchOptions
} from '@shared/types/agent-interface'
import {
  buildEffectiveTapeView,
  getLastEffectiveTapeMetrics,
  searchEffectiveTapeRows
} from '../domain/effectiveView'
import type { DeepChatTapeEntryRow, DeepChatTapeReadSource } from '../domain/entry'
import type {
  TapeApplicationProviders,
  TapeSearchProjectionInput as DeepChatTapeSearchProjectionInput,
  TapeSearchProjectionResultRow as DeepChatTapeSearchProjectionResultRow,
  TapeSearchProjectionRow as DeepChatTapeSearchProjectionRow,
  TapeSearchProjectionStore
} from '../ports/application'
import type { TapeEffectiveMessageSourceEntry } from '../ports/capabilities'
import { isEntryIdPrefix, migrationProvenanceKey, parseJsonObject } from './common'
import type { TapeAnchorResult, TapeInfo, TapeSearchResult } from './contracts'
import { AgentTapeViewError, type TapeLineageService } from './lineageService'
import {
  buildTapeRowEvidenceText,
  buildTapeRowRefs,
  compareTapeSearchResults,
  getUserMessageProjectionText,
  normalizeContextByteLimit,
  normalizeContextLimit,
  normalizeContextWindowValue,
  normalizeTapeSearchLimit,
  normalizeTapeViewScope,
  parseProjectionRefs,
  stringifyForSummary,
  summarizeTapeRow,
  toTapeSearchInput,
  truncateToUtf8Bytes
} from './recallProjection'

type TapeRecallProviders = Pick<
  TapeApplicationProviders,
  'getEntryStore' | 'getSearchProjectionStore'
>

const DEFAULT_CONTEXT_MAX_BYTES_PER_ENTRY = 2048
const DEFAULT_CONTEXT_MAX_TOTAL_BYTES = 16384
const MAX_CONTEXT_MAX_BYTES_PER_ENTRY = 8192
const MAX_CONTEXT_MAX_TOTAL_BYTES = 65536

export class TapeRecallService {
  constructor(
    private readonly providers: TapeRecallProviders,
    private readonly lineage: TapeLineageService
  ) {}

  private get table() {
    return this.providers.getEntryStore()
  }

  private get searchProjectionTable() {
    return this.providers.getSearchProjectionStore()
  }

  info(sessionId: string): TapeInfo {
    const table = this.table
    const lastAnchor = table.getLatestAnchor(sessionId)
    const rows = table.getBySession(sessionId)
    const metrics = getLastEffectiveTapeMetrics(rows)
    const lastProviderAttempt = metrics.lastProviderAttemptCacheMetrics
    return {
      sessionId,
      entries: table.countBySession(sessionId),
      anchors: table.countAnchorsBySession(sessionId),
      lastAnchor: lastAnchor?.name ?? null,
      lastAnchorEntryId: lastAnchor?.entry_id ?? null,
      entriesSinceLastAnchor: lastAnchor
        ? table.countEntriesAfter(sessionId, lastAnchor.entry_id)
        : 0,
      lastTokenUsage: metrics.lastTokenUsage,
      lastTokenCacheHitRate: lastProviderAttempt?.lastTokenCacheHitRate ?? null,
      lastCacheReadTokens: lastProviderAttempt?.lastCacheReadTokens ?? null,
      lastCacheWriteTokens: lastProviderAttempt?.lastCacheWriteTokens ?? null,
      migrationState: table.getByProvenanceKey(sessionId, migrationProvenanceKey(sessionId))
        ? 'ready'
        : 'none'
    }
  }

  getEffectiveMessageSourceSpan(
    sessionId: string,
    entryIds: number[]
  ): TapeEffectiveMessageSourceEntry[] {
    const requestedEntryIds = new Set(
      entryIds.filter((entryId) => Number.isInteger(entryId) && entryId > 0)
    )
    if (requestedEntryIds.size === 0) return []
    return buildEffectiveTapeView(this.table.getBySession(sessionId), { includePending: false })
      .messageEntries.filter((entry) => requestedEntryIds.has(entry.entryId))
      .map((entry) => ({
        entryId: entry.entryId,
        record: {
          role: entry.record.role,
          content: entry.record.content,
          orderSeq: entry.record.orderSeq
        }
      }))
  }

  search(sessionId: string, query: string, options?: AgentTapeSearchOptions): TapeSearchResult[] {
    const scope = normalizeTapeViewScope(options?.scope)
    if (!query.trim()) {
      return []
    }
    if (scope === 'current') {
      return this.searchCurrentTape(sessionId, query, options)
    }

    const resolution = this.lineage.resolveLinkedTapeSources(sessionId)
    if (resolution.unavailableSourceIds.size > 0) {
      const sourceSessionId = [...resolution.unavailableSourceIds].sort()[0]
      throw new AgentTapeViewError(
        'linked_tape_unavailable',
        sessionId,
        sourceSessionId,
        `Linked Tape ${sourceSessionId} is unavailable.`
      )
    }
    const sources = [...resolution.sources]
    if (scope === 'current_and_linked') {
      sources.push({ sessionId, maxEntryId: this.table?.getMaxEntryId(sessionId) ?? 0 })
    }
    return this.searchTapeSourcesReadOnly(sources, query, options)
  }

  private searchCurrentTape(
    sessionId: string,
    query: string,
    options?: AgentTapeSearchOptions
  ): TapeSearchResult[] {
    const table = this.table
    const searchInput = toTapeSearchInput(options)
    const projectionTable = this.searchProjectionTable
    let skipProjectionSearch = false

    if (projectionTable) {
      try {
        const maxEntryId = table.getMaxEntryId(sessionId)
        if (projectionTable.isCurrent(sessionId, maxEntryId)) {
          return projectionTable
            .search(sessionId, query, searchInput)
            .map((row) => this.toProjectedSearchResult(row, undefined))
        }
      } catch (error) {
        skipProjectionSearch = true
        console.warn('[Tape] Projection search failed; using effective search:', error)
      }
    }

    const rows = table.getBySession(sessionId)
    const effectiveRows = buildEffectiveTapeView(rows, { includePending: false }).rows
    const preparedProjectionTable = skipProjectionSearch
      ? null
      : this.ensureSearchProjection(sessionId, rows, effectiveRows)
    if (!preparedProjectionTable) {
      return searchEffectiveTapeRows(rows, query, searchInput).map((row) =>
        this.toSearchResult(row)
      )
    }

    const rowByEntryId = new Map(effectiveRows.map((row) => [row.entry_id, row]))
    try {
      return preparedProjectionTable
        .search(sessionId, query, searchInput)
        .map((row) => this.toProjectedSearchResult(row, rowByEntryId.get(row.entry_id)))
    } catch (error) {
      console.warn('[Tape] Projection search failed; using effective search:', error)
      return searchEffectiveTapeRows(rows, query, searchInput).map((row) =>
        this.toSearchResult(row)
      )
    }
  }

  getContext(
    sessionId: string,
    entryIds: number[],
    options: AgentTapeContextOptions = {}
  ): AgentTapeContextResult {
    const sourceSessionId = options.sourceSessionId?.trim() || sessionId
    if (sourceSessionId !== sessionId) {
      return this.getLinkedTapeContext(sessionId, sourceSessionId, entryIds, options)
    }

    const requestedEntryIds = [
      ...new Set(entryIds.filter((entryId) => Number.isInteger(entryId) && entryId > 0))
    ].sort((left, right) => left - right)
    const table = this.table
    if (!table || requestedEntryIds.length === 0) {
      return {
        sessionId,
        sourceSessionId,
        requestedEntryIds,
        matchedEntryIds: [],
        entries: []
      }
    }

    const rows = table.getBySession(sessionId)
    const effectiveRows = buildEffectiveTapeView(rows, { includePending: false }).rows
    const indexByEntryId = new Map(effectiveRows.map((row, index) => [row.entry_id, index]))
    const before = normalizeContextWindowValue(options.before, 2)
    const after = normalizeContextWindowValue(options.after, 2)
    const limit = normalizeContextLimit(options.limit)
    const maxBytesPerEntry = normalizeContextByteLimit(
      options.maxBytesPerEntry,
      DEFAULT_CONTEXT_MAX_BYTES_PER_ENTRY,
      MAX_CONTEXT_MAX_BYTES_PER_ENTRY
    )
    const maxTotalBytes = normalizeContextByteLimit(
      options.maxTotalBytes,
      DEFAULT_CONTEXT_MAX_TOTAL_BYTES,
      MAX_CONTEXT_MAX_TOTAL_BYTES
    )
    const selectedIndexes = new Set<number>()
    const requestedIndexes: number[] = []
    const windowIndexes: number[] = []

    for (const entryId of requestedEntryIds) {
      const index = indexByEntryId.get(entryId)
      if (index === undefined) continue
      requestedIndexes.push(index)
      for (
        let cursor = Math.max(0, index - before);
        cursor <= Math.min(effectiveRows.length - 1, index + after);
        cursor += 1
      ) {
        if (cursor === index) continue
        windowIndexes.push(cursor)
      }
    }

    for (const index of requestedIndexes) {
      if (selectedIndexes.size >= limit) break
      selectedIndexes.add(index)
    }
    for (const index of windowIndexes) {
      if (selectedIndexes.size >= limit) break
      selectedIndexes.add(index)
    }

    const selectedRows = [...selectedIndexes]
      .sort((left, right) => left - right)
      .map((index) => effectiveRows[index])
    let projectionRows = new Map<number, DeepChatTapeSearchProjectionRow>()
    try {
      const maxEntryId = rows.reduce((max, row) => Math.max(max, row.entry_id), 0)
      projectionRows = new Map(
        this.searchProjectionTable
          .getByEntryIdsIfCurrent(
            sessionId,
            maxEntryId,
            selectedRows.map((row) => row.entry_id)
          )
          .map((row) => [row.entry_id, row])
      )
    } catch {
      projectionRows = new Map()
    }
    let usedBytes = 0
    const entries: AgentTapeContextEntry[] = []
    const priorityIndexes = [...requestedIndexes, ...windowIndexes].filter(
      (index, offset, indexes) => {
        return selectedIndexes.has(index) && indexes.indexOf(index) === offset
      }
    )
    for (const index of priorityIndexes) {
      const row = effectiveRows[index]
      const remaining = Math.max(0, maxTotalBytes - usedBytes)
      if (remaining <= 0) break
      const maxEntryBytes = Math.min(maxBytesPerEntry, remaining)
      if (maxEntryBytes <= 0) break
      const entry = this.toContextEntry(row, projectionRows.get(row.entry_id), maxEntryBytes)
      if (entry.evidence.bytes <= 0) continue
      usedBytes += entry.evidence.bytes
      entries.push(entry)
    }
    entries.sort((left, right) => left.entryId - right.entryId)
    const returnedEntryIds = new Set(entries.map((entry) => entry.entryId))

    return {
      sessionId,
      sourceSessionId,
      requestedEntryIds,
      matchedEntryIds: requestedEntryIds.filter((entryId) => returnedEntryIds.has(entryId)),
      entries
    }
  }

  private searchTapeSourcesReadOnly(
    sources: DeepChatTapeReadSource[],
    query: string,
    options: AgentTapeSearchOptions | undefined
  ): TapeSearchResult[] {
    const table = this.table
    if (!table || !query.trim() || sources.length === 0) {
      return []
    }
    const searchInput = toTapeSearchInput(options)
    const limit = normalizeTapeSearchLimit(options?.limit)
    const results: TapeSearchResult[] = []
    let uncoveredSources = sources

    try {
      const projected = this.searchProjectionTable?.searchSourcesReadOnly(
        sources,
        query,
        searchInput
      )
      if (projected) {
        const coveredHeadBySource = new Map(
          projected.coveredSources.map((source) => [source.sessionId, source.maxEntryId])
        )
        const hasCompleteProjection =
          coveredHeadBySource.size === sources.length &&
          sources.every((source) => coveredHeadBySource.get(source.sessionId) === source.maxEntryId)
        if (hasCompleteProjection) {
          results.push(...projected.rows.map((row) => this.toProjectedSearchResult(row, undefined)))
          uncoveredSources = []
        }
      }
    } catch (error) {
      console.warn('[Tape] Linked projection search failed; using read-only fallback:', error)
      uncoveredSources = sources
    }

    if (uncoveredSources.length > 0) {
      results.push(
        ...table
          .searchEffectiveSourcesAtHeads(uncoveredSources, query, searchInput)
          .map((row) => this.toSearchResult(row))
      )
    }

    const seen = new Set<string>()
    return results
      .sort(compareTapeSearchResults)
      .filter((result) => {
        const key = `${result.sessionId}:${result.entryId}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, limit)
  }

  private getLinkedTapeContext(
    parentSessionId: string,
    sourceSessionId: string,
    entryIds: number[],
    options: AgentTapeContextOptions
  ): AgentTapeContextResult {
    const resolution = this.lineage.resolveLinkedTapeSources(parentSessionId)
    if (resolution.unavailableSourceIds.has(sourceSessionId)) {
      throw new AgentTapeViewError(
        'linked_tape_unavailable',
        parentSessionId,
        sourceSessionId,
        `Linked Tape ${sourceSessionId} is unavailable.`
      )
    }
    const source = resolution.sources.find((candidate) => candidate.sessionId === sourceSessionId)
    if (!source) {
      throw new AgentTapeViewError(
        'linked_tape_unauthorized',
        parentSessionId,
        sourceSessionId,
        `Tape ${sourceSessionId} is not an authorized direct child of ${parentSessionId}.`
      )
    }

    const requestedEntryIds = [
      ...new Set(entryIds.filter((entryId) => Number.isInteger(entryId) && entryId > 0))
    ].sort((left, right) => left - right)
    const table = this.table
    if (!table || requestedEntryIds.length === 0) {
      return {
        sessionId: parentSessionId,
        sourceSessionId,
        requestedEntryIds,
        matchedEntryIds: [],
        entries: []
      }
    }

    const before = normalizeContextWindowValue(options.before, 2)
    const after = normalizeContextWindowValue(options.after, 2)
    const limit = normalizeContextLimit(options.limit)
    const maxBytesPerEntry = normalizeContextByteLimit(
      options.maxBytesPerEntry,
      DEFAULT_CONTEXT_MAX_BYTES_PER_ENTRY,
      MAX_CONTEXT_MAX_BYTES_PER_ENTRY
    )
    const maxTotalBytes = normalizeContextByteLimit(
      options.maxTotalBytes,
      DEFAULT_CONTEXT_MAX_TOTAL_BYTES,
      MAX_CONTEXT_MAX_TOTAL_BYTES
    )
    const rows = table.getEffectiveContextRowsAtHead(source, requestedEntryIds, {
      before,
      after,
      limit
    })

    let usedBytes = 0
    const entries: AgentTapeContextEntry[] = []
    for (const row of rows) {
      const remaining = Math.max(0, maxTotalBytes - usedBytes)
      if (remaining <= 0) break
      const maxEntryBytes = Math.min(maxBytesPerEntry, remaining)
      const entry = this.toContextEntry(row, undefined, maxEntryBytes)
      if (entry.evidence.bytes <= 0) continue
      usedBytes += entry.evidence.bytes
      entries.push(entry)
    }
    entries.sort((left, right) => left.entryId - right.entryId)
    const returnedEntryIds = new Set(entries.map((entry) => entry.entryId))

    return {
      sessionId: parentSessionId,
      sourceSessionId,
      requestedEntryIds,
      matchedEntryIds: requestedEntryIds.filter((entryId) => returnedEntryIds.has(entryId)),
      entries
    }
  }

  anchors(sessionId: string, options: AgentTapeAnchorsOptions = {}): TapeAnchorResult[] {
    return this.table.getAnchors(sessionId, options.limit).map((row) => this.toAnchorResult(row))
  }

  private ensureSearchProjection(
    sessionId: string,
    rows: DeepChatTapeEntryRow[],
    effectiveRows: DeepChatTapeEntryRow[]
  ): TapeSearchProjectionStore | null {
    const projectionTable = this.searchProjectionTable
    const maxEntryId = rows.reduce((max, row) => Math.max(max, row.entry_id), 0)
    try {
      if (!projectionTable.isCurrent(sessionId, maxEntryId)) {
        const meta = projectionTable.getSessionMeta(sessionId)
        const projectedEntryIds = projectionTable.getProjectedEntryIds(sessionId)
        const effectiveEntryIds = effectiveRows.map((row) => row.entry_id)
        const canAppend =
          !!meta &&
          projectionTable.isCurrent(sessionId, meta.maxEntryId) &&
          meta.maxEntryId <= maxEntryId &&
          isEntryIdPrefix(projectedEntryIds, effectiveEntryIds)
        if (canAppend) {
          projectionTable.appendSession(
            sessionId,
            effectiveRows.slice(projectedEntryIds.length).map((row) => this.toProjectionInput(row)),
            maxEntryId
          )
        } else {
          projectionTable.replaceSession(
            sessionId,
            effectiveRows.map((row) => this.toProjectionInput(row)),
            maxEntryId
          )
        }
      }
      return projectionTable
    } catch {
      return null
    }
  }

  private toProjectionInput(row: DeepChatTapeEntryRow): DeepChatTapeSearchProjectionInput {
    const payload = parseJsonObject(row.payload_json)
    const meta = parseJsonObject(row.meta_json)
    const userMessage = getUserMessageProjectionText(row, payload)
    const summaryText = summarizeTapeRow(row, payload, userMessage)
    const evidenceText = buildTapeRowEvidenceText(row, payload, meta, userMessage)
    const refs = buildTapeRowRefs(row, payload, meta, userMessage, evidenceText)
    const searchText = [
      row.kind,
      row.name ?? '',
      ...(userMessage?.attachmentRefs.searchText ?? []),
      summaryText,
      evidenceText,
      Object.values(refs)
        .map((value) => stringifyForSummary(value))
        .join(' ')
    ]
      .filter(Boolean)
      .join('\n')
    return {
      sessionId: row.session_id,
      entryId: row.entry_id,
      kind: row.kind,
      name: row.name,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceSeq: row.source_seq,
      searchText,
      summaryText,
      refs,
      createdAt: row.created_at
    }
  }

  private toProjectedSearchResult(
    row: DeepChatTapeSearchProjectionResultRow,
    _sourceRow: DeepChatTapeEntryRow | undefined
  ): TapeSearchResult {
    const score =
      typeof row.score === 'number' && Number.isFinite(row.score) ? row.score : undefined
    return {
      sessionId: row.session_id,
      entryId: row.entry_id,
      kind: row.kind,
      name: row.name,
      createdAt: row.created_at,
      summary: row.summary_text,
      refs: parseProjectionRefs(row.refs_json),
      ...(score === undefined ? {} : { score })
    }
  }

  private toContextEntry(
    row: DeepChatTapeEntryRow,
    projectionRow: DeepChatTapeSearchProjectionRow | undefined,
    maxBytes: number
  ): AgentTapeContextEntry {
    const fallbackProjection = projectionRow ? null : this.toProjectionInput(row)
    const payload = parseJsonObject(row.payload_json)
    const meta = parseJsonObject(row.meta_json)
    const evidenceSource = buildTapeRowEvidenceText(row, payload, meta)
    const clipped = truncateToUtf8Bytes(evidenceSource, maxBytes)
    const bytes = Buffer.byteLength(clipped.text, 'utf8')
    return {
      entryId: row.entry_id,
      kind: row.kind,
      name: row.name,
      summary: projectionRow?.summary_text ?? fallbackProjection?.summaryText ?? '',
      refs: projectionRow
        ? parseProjectionRefs(projectionRow.refs_json)
        : (fallbackProjection?.refs ?? {}),
      evidence: {
        text: clipped.text,
        truncated: clipped.truncated,
        bytes
      },
      createdAt: row.created_at
    }
  }

  private toSearchResult(row: DeepChatTapeEntryRow): TapeSearchResult {
    const projection = this.toProjectionInput(row)
    return {
      sessionId: row.session_id,
      entryId: row.entry_id,
      kind: row.kind,
      name: row.name,
      createdAt: row.created_at,
      summary: projection.summaryText,
      refs: projection.refs
    }
  }

  private toAnchorResult(row: DeepChatTapeEntryRow): TapeAnchorResult {
    return {
      sessionId: row.session_id,
      entryId: row.entry_id,
      kind: row.kind,
      name: row.name,
      payload: parseJsonObject(row.payload_json),
      meta: parseJsonObject(row.meta_json),
      createdAt: row.created_at
    }
  }
}
