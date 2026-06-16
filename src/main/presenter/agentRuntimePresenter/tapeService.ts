import { SQLitePresenter } from '../sqlitePresenter'
import { nanoid } from 'nanoid'
import { createHash } from 'crypto'
import type {
  AgentTapeAnchorResult,
  AgentTapeAnchorsOptions,
  AgentTapeSearchOptions,
  ChatMessageRecord
} from '@shared/types/agent-interface'
import type {
  DeepChatTapeViewManifest,
  DeepChatTapeViewManifestRecord
} from '@shared/types/tape-view-manifest'
import type {
  DeepChatTapeReplayEntrySnapshot,
  DeepChatTapeReplayExportOptions,
  DeepChatTapeReplaySlice,
  DeepChatTapeReplayTraceSnapshot
} from '@shared/types/tape-replay'
import type { DeepChatMessageStore } from './messageStore'
import type {
  DeepChatTapeEntryRow,
  DeepChatTapeSearchInput
} from '../sqlitePresenter/tables/deepchatTapeEntries'
import type { DeepChatMessageTraceRow } from '../sqlitePresenter/tables/deepchatMessageTraces'
import { appendMessageRecordToTape } from './tapeFacts'
import {
  buildEffectiveTapeView,
  getLastEffectiveTokenUsage,
  searchEffectiveTapeRows
} from './tapeEffectiveView'
import { hashJson, TAPE_VIEW_MANIFEST_EVENT_NAME } from './tapeViewManifest'

export type TapeMigrationState = 'none' | 'ready'

export type TapeBackfillResult = {
  sessionId: string
  migrationState: TapeMigrationState
  messageCount: number
  maxOrderSeq: number
  appendedFactCount: number
  historyRecords: ChatMessageRecord[]
}

export type TapeInfo = {
  sessionId: string
  entries: number
  anchors: number
  lastAnchor: string | null
  lastAnchorEntryId: number | null
  entriesSinceLastAnchor: number
  lastTokenUsage: number | null
  migrationState: TapeMigrationState
}

export type TapeSearchResult = {
  entryId: number
  kind: string
  name: string | null
  payload: Record<string, unknown>
  meta: Record<string, unknown>
  createdAt: number
}

export type TapeAnchorResult = AgentTapeAnchorResult

export type TapeForkHandle = {
  parentSessionId: string
  forkId: string
  forkSessionId: string
}

export type TapeViewManifestSourceMaps = {
  latestEntryId: number
  anchorEntryIds: number[]
  entryIdByMessageId: Map<string, number>
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {}
  return {}
}

function parseSearchBoundary(value: string | undefined, name: string): number | undefined {
  const trimmed = value?.trim()
  if (!trimmed) {
    return undefined
  }

  const numericValue = Number(trimmed)
  if (Number.isFinite(numericValue)) {
    return numericValue
  }

  const parsedDate = Date.parse(trimmed)
  if (Number.isFinite(parsedDate)) {
    return parsedDate
  }

  throw new Error(`${name} must be an ISO date/time or millisecond timestamp.`)
}

function toTapeSearchInput(options: AgentTapeSearchOptions | undefined): DeepChatTapeSearchInput {
  return {
    limit: options?.limit,
    kinds: options?.kinds,
    startCreatedAt: parseSearchBoundary(options?.start, 'start'),
    endCreatedAt: parseSearchBoundary(options?.end, 'end')
  }
}

function migrationProvenanceKey(sessionId: string): string {
  return `migration:${sessionId}:message-backfill:v1`
}

function legacySummaryProvenanceKey(sessionId: string): string {
  return `summary:${sessionId}:legacy-summary:v1`
}

function normalizeHandoffName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) {
    return 'handoff/manual'
  }
  if (trimmed.startsWith('handoff/') || trimmed.startsWith('auto_handoff/')) {
    return trimmed
  }
  return `handoff/${trimmed}`
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value))
  }
  return null
}

function hasOwnKey(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function buildOrderSeqRange(records: ChatMessageRecord[]): Record<string, number> | null {
  if (records.length === 0) {
    return null
  }

  return {
    fromOrderSeq: records[0].orderSeq,
    toOrderSeq: records[records.length - 1].orderSeq
  }
}

function enrichHandoffState(
  state: Record<string, unknown>,
  historyRecords: ChatMessageRecord[]
): Record<string, unknown> {
  const maxOrderSeq = historyRecords.reduce(
    (currentMax, record) => Math.max(currentMax, record.orderSeq),
    0
  )
  const cursorOrderSeq =
    normalizePositiveInteger(state.cursorOrderSeq ?? state.summaryCursorOrderSeq) ?? maxOrderSeq + 1
  const sourceRecords = historyRecords.filter((record) => record.orderSeq < cursorOrderSeq)
  const enrichedState: Record<string, unknown> = {
    ...state,
    cursorOrderSeq
  }

  if (!hasOwnKey(enrichedState, 'range')) {
    enrichedState.range = buildOrderSeqRange(sourceRecords)
  }

  const sourceMessageIds = enrichedState.sourceMessageIds
  if (!Array.isArray(sourceMessageIds) || sourceMessageIds.some((id) => typeof id !== 'string')) {
    enrichedState.sourceMessageIds = sourceRecords.map((record) => record.id)
  }

  return enrichedState
}

function forkSessionId(parentSessionId: string, forkId: string): string {
  return `${parentSessionId}::fork::${forkId}`
}

function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function collectEntryIds(values: Array<number | null>): number[] {
  return [...new Set(values.filter((value): value is number => typeof value === 'number'))].sort(
    (left, right) => left - right
  )
}

const VIEW_POLICIES = new Set([
  'legacy_context_v1',
  'legacy_context_shadow',
  'resume_shadow',
  'tool_loop_shadow',
  'context_pressure_recovery_shadow'
])

const VIEW_ENTRY_REASONS = new Set([
  'system_prompt',
  'selected_history',
  'new_user_input',
  'resume_target',
  'tool_loop_message'
])

const VIEW_EXCLUDED_REASONS = new Set([
  'before_summary_cursor',
  'compaction_indicator',
  'pending_not_context_history',
  'out_of_budget',
  'empty_after_formatting',
  'superseded',
  'retracted'
])

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number'
}

function isViewEntryRef(value: unknown): value is DeepChatTapeViewManifest['included'][number] {
  if (!isRecordObject(value)) {
    return false
  }

  return (
    isNullableNumber(value.entryId) &&
    isNullableString(value.messageId) &&
    isNullableNumber(value.orderSeq) &&
    (value.role === 'system' ||
      value.role === 'user' ||
      value.role === 'assistant' ||
      value.role === 'tool' ||
      value.role === null) &&
    (value.source === 'tape' || value.source === 'synthetic') &&
    typeof value.reason === 'string' &&
    VIEW_ENTRY_REASONS.has(value.reason)
  )
}

function isViewExcludedRef(value: unknown): value is DeepChatTapeViewManifest['excluded'][number] {
  if (!isRecordObject(value)) {
    return false
  }

  return (
    isNullableNumber(value.entryId) &&
    isNullableString(value.messageId) &&
    isNullableNumber(value.orderSeq) &&
    typeof value.reason === 'string' &&
    VIEW_EXCLUDED_REASONS.has(value.reason)
  )
}

function hasNumberFields(value: unknown, fields: string[]): value is Record<string, number> {
  if (!isRecordObject(value)) {
    return false
  }

  return fields.every((field) => typeof value[field] === 'number')
}

function hasStringFields(value: unknown, fields: string[]): value is Record<string, string> {
  if (!isRecordObject(value)) {
    return false
  }

  return fields.every((field) => typeof value[field] === 'string')
}

function isViewManifestMeta(value: unknown): value is DeepChatTapeViewManifest['meta'] {
  if (!isRecordObject(value)) {
    return false
  }

  return (
    typeof value.providerId === 'string' &&
    typeof value.modelId === 'string' &&
    typeof value.summaryCursorOrderSeq === 'number' &&
    typeof value.supportsVision === 'boolean' &&
    typeof value.supportsAudioInput === 'boolean' &&
    typeof value.traceDebugEnabled === 'boolean'
  )
}

function isViewManifest(value: unknown, sessionId: string): value is DeepChatTapeViewManifest {
  if (!isRecordObject(value)) {
    return false
  }

  return (
    value.schemaVersion === 1 &&
    value.sessionId === sessionId &&
    typeof value.viewId === 'string' &&
    typeof value.messageId === 'string' &&
    typeof value.requestSeq === 'number' &&
    (value.taskType === 'chat' || value.taskType === 'resume' || value.taskType === 'tool_loop') &&
    typeof value.policy === 'string' &&
    VIEW_POLICIES.has(value.policy) &&
    (typeof value.policyVersion === 'number' || value.policyVersion === null) &&
    value.contextBuilderVersion === 'legacy-v1' &&
    typeof value.latestEntryId === 'number' &&
    Array.isArray(value.anchorEntryIds) &&
    value.anchorEntryIds.every((entryId) => typeof entryId === 'number') &&
    Array.isArray(value.included) &&
    value.included.every(isViewEntryRef) &&
    Array.isArray(value.excluded) &&
    value.excluded.every(isViewExcludedRef) &&
    hasNumberFields(value.tokenBudget, [
      'contextLength',
      'requestedMaxTokens',
      'effectiveMaxTokens',
      'reserveTokens',
      'toolReserveTokens',
      'estimatedPromptTokens'
    ]) &&
    hasStringFields(value.hashes, ['promptHash', 'toolDefinitionsHash', 'manifestHash']) &&
    isViewManifestMeta(value.meta) &&
    typeof value.assembledAt === 'number'
  )
}

function withReplaySliceHash(
  slice: Omit<DeepChatTapeReplaySlice, 'hashes'> & {
    hashes: Omit<DeepChatTapeReplaySlice['hashes'], 'sliceHash'> & { sliceHash: '' }
  }
): DeepChatTapeReplaySlice {
  const sliceForHash = { ...slice } as Partial<DeepChatTapeReplaySlice>
  delete sliceForHash.createdAt
  return {
    ...slice,
    hashes: {
      ...slice.hashes,
      sliceHash: hashJson(sliceForHash)
    }
  }
}

export class DeepChatTapeService {
  constructor(private readonly sqlitePresenter: SQLitePresenter) {}

  private get table(): SQLitePresenter['deepchatTapeEntriesTable'] | undefined {
    return this.sqlitePresenter.deepchatTapeEntriesTable
  }

  ensureSessionTapeReady(
    sessionId: string,
    messageStore: DeepChatMessageStore
  ): TapeBackfillResult {
    const table = this.table
    const historyRecords = messageStore
      .getMessages(sessionId)
      .sort((left, right) => left.orderSeq - right.orderSeq)
    const maxOrderSeq = historyRecords.reduce(
      (currentMax, record) => Math.max(currentMax, record.orderSeq),
      0
    )

    if (!table) {
      return {
        sessionId,
        migrationState: 'none',
        messageCount: historyRecords.length,
        maxOrderSeq,
        appendedFactCount: 0,
        historyRecords
      }
    }

    table.ensureBootstrapAnchor(sessionId)

    let appendedFactCount = 0
    for (const record of historyRecords) {
      appendedFactCount += appendMessageRecordToTape(table, record, 'backfill')
    }

    this.backfillLegacySummaryAnchor(sessionId, historyRecords)

    table.appendEvent({
      sessionId,
      name: 'migration/backfill',
      source: {
        type: 'migration',
        id: 'message-backfill',
        seq: 1
      },
      provenanceKey: migrationProvenanceKey(sessionId),
      data: {
        source: 'deepchat_messages',
        messageCount: historyRecords.length,
        maxOrderSeq
      },
      idempotent: true
    })

    return {
      sessionId,
      migrationState: 'ready',
      messageCount: historyRecords.length,
      maxOrderSeq,
      appendedFactCount,
      historyRecords: this.getMessageRecords(sessionId)
    }
  }

  appendMessageRecord(record: ChatMessageRecord): number {
    const table = this.table
    if (!table) {
      throw new Error('Tape table is not available.')
    }

    return appendMessageRecordToTape(table, record, 'live')
  }

  getMessageRecords(sessionId: string): ChatMessageRecord[] {
    const table = this.table
    return table
      ? buildEffectiveTapeView(table.getBySession(sessionId), { includePending: true })
          .messageRecords
      : []
  }

  info(sessionId: string): TapeInfo {
    const table = this.table
    if (!table) {
      return {
        sessionId,
        entries: 0,
        anchors: 0,
        lastAnchor: null,
        lastAnchorEntryId: null,
        entriesSinceLastAnchor: 0,
        lastTokenUsage: null,
        migrationState: 'none'
      }
    }

    const lastAnchor = table.getLatestAnchor(sessionId)
    const rows = table.getBySession(sessionId)
    return {
      sessionId,
      entries: table.countBySession(sessionId),
      anchors: table.countAnchorsBySession(sessionId),
      lastAnchor: lastAnchor?.name ?? null,
      lastAnchorEntryId: lastAnchor?.entry_id ?? null,
      entriesSinceLastAnchor: lastAnchor
        ? table.countEntriesAfter(sessionId, lastAnchor.entry_id)
        : 0,
      lastTokenUsage: getLastEffectiveTokenUsage(rows),
      migrationState: table.getByProvenanceKey(sessionId, migrationProvenanceKey(sessionId))
        ? 'ready'
        : 'none'
    }
  }

  search(sessionId: string, query: string, options?: AgentTapeSearchOptions): TapeSearchResult[] {
    const table = this.table
    return table
      ? searchEffectiveTapeRows(
          table.getBySession(sessionId),
          query,
          toTapeSearchInput(options)
        ).map((row) => this.toSearchResult(row))
      : []
  }

  anchors(sessionId: string, options: AgentTapeAnchorsOptions = {}): TapeAnchorResult[] {
    const table = this.table
    return table
      ? table.getAnchors(sessionId, options.limit).map((row) => this.toAnchorResult(row))
      : []
  }

  getViewManifestSourceMaps(sessionId: string): TapeViewManifestSourceMaps {
    const table = this.table
    if (!table) {
      return {
        latestEntryId: 0,
        anchorEntryIds: [],
        entryIdByMessageId: new Map()
      }
    }

    const rows = table.getBySession(sessionId)
    const entryIdByMessageId = new Map<string, number>()
    let latestEntryId = 0
    const anchorEntryIds: number[] = []

    for (const row of rows) {
      latestEntryId = Math.max(latestEntryId, row.entry_id)
      if (row.kind === 'anchor') {
        anchorEntryIds.push(row.entry_id)
      }
      if (row.kind === 'message' && row.source_type === 'message' && row.source_id) {
        entryIdByMessageId.set(row.source_id, row.entry_id)
      }
    }

    return {
      latestEntryId,
      anchorEntryIds,
      entryIdByMessageId
    }
  }

  appendViewManifest(manifest: DeepChatTapeViewManifest): DeepChatTapeEntryRow {
    const table = this.table
    if (!table) {
      throw new Error('Tape table is not available.')
    }

    table.ensureBootstrapAnchor(manifest.sessionId)
    return table.appendEvent({
      sessionId: manifest.sessionId,
      name: TAPE_VIEW_MANIFEST_EVENT_NAME,
      source: {
        type: 'runtime_event',
        id: manifest.messageId,
        seq: manifest.requestSeq
      },
      provenanceKey: `view:${manifest.sessionId}:${manifest.messageId}:${manifest.requestSeq}:${manifest.hashes.manifestHash}`,
      data: {
        manifest
      },
      meta: {
        viewId: manifest.viewId,
        requestSeq: manifest.requestSeq,
        taskType: manifest.taskType,
        policy: manifest.policy,
        policyVersion: manifest.policyVersion
      },
      createdAt: manifest.assembledAt,
      idempotent: true
    })
  }

  listViewManifestsByMessage(
    sessionId: string,
    messageId: string
  ): DeepChatTapeViewManifestRecord[] {
    const table = this.table
    if (!table) {
      return []
    }

    return table
      .getBySession(sessionId)
      .filter(
        (row) =>
          row.kind === 'event' &&
          row.name === TAPE_VIEW_MANIFEST_EVENT_NAME &&
          row.source_type === 'runtime_event' &&
          row.source_id === messageId
      )
      .map((row) => this.toViewManifestRecord(row))
      .filter((record): record is DeepChatTapeViewManifestRecord => Boolean(record))
      .sort((left, right) => right.requestSeq - left.requestSeq || right.entryId - left.entryId)
  }

  exportReplaySlice(
    sessionId: string,
    messageId: string,
    options: DeepChatTapeReplayExportOptions = {}
  ): DeepChatTapeReplaySlice | null {
    if (options.requestSeq !== undefined && !isPositiveInteger(options.requestSeq)) {
      throw new Error('requestSeq must be a positive integer.')
    }

    const table = this.table
    if (!table) {
      return null
    }

    const manifests = this.listViewManifestsByMessage(sessionId, messageId)
    const manifestRecord =
      options.requestSeq === undefined
        ? manifests[0]
        : manifests.find((record) => record.requestSeq === options.requestSeq)
    if (!manifestRecord) {
      return null
    }

    const manifest = manifestRecord.manifest
    const includedEntryIds = collectEntryIds(manifest.included.map((ref) => ref.entryId))
    const excludedEntryIds = collectEntryIds(manifest.excluded.map((ref) => ref.entryId))
    const anchorEntryIds = collectEntryIds(manifest.anchorEntryIds)
    const selectedEntryIds = new Set([
      manifestRecord.entryId,
      ...includedEntryIds,
      ...excludedEntryIds,
      ...anchorEntryIds
    ])
    const entries = table
      .getBySession(sessionId)
      .filter((row) => selectedEntryIds.has(row.entry_id))
      .map((row) => this.toReplayEntrySnapshot(row, options.includeTapePayloads === true))

    const trace = this.findReplayTrace(sessionId, messageId, manifestRecord.requestSeq)
    const createdAt = Date.now()
    const sliceBase: Omit<DeepChatTapeReplaySlice, 'hashes'> & {
      hashes: Omit<DeepChatTapeReplaySlice['hashes'], 'sliceHash'> & { sliceHash: '' }
    } = {
      schemaVersion: 1 as const,
      sliceId: `replay_${hashJson({
        sessionId,
        messageId,
        requestSeq: manifestRecord.requestSeq,
        manifestHash: manifest.hashes.manifestHash
      }).slice(0, 16)}`,
      sessionId,
      messageId,
      requestSeq: manifestRecord.requestSeq,
      mode: trace ? 'trace_bound' : 'manifest_only',
      manifestRecord,
      trace: trace ? this.toReplayTraceSnapshot(trace, options.includeTracePayload === true) : null,
      entries,
      refs: {
        manifestEntryId: manifestRecord.entryId,
        includedEntryIds,
        excludedEntryIds,
        anchorEntryIds
      },
      hashes: {
        manifestHash: manifest.hashes.manifestHash,
        sliceHash: ''
      },
      createdAt
    }

    return withReplaySliceHash(sliceBase)
  }

  handoff(
    sessionId: string,
    name: string,
    state: Record<string, unknown> = {},
    meta: Record<string, unknown> = {}
  ): DeepChatTapeEntryRow {
    const table = this.table
    if (!table) {
      throw new Error('Tape table is not available.')
    }

    table.ensureBootstrapAnchor(sessionId)
    const handoffState = enrichHandoffState(state, this.getMessageRecords(sessionId))
    return table.appendAnchor({
      sessionId,
      name: normalizeHandoffName(name),
      source: {
        type: 'runtime_event',
        id: `handoff:${Date.now()}`,
        seq: 0
      },
      state: handoffState,
      meta: {
        ...meta,
        handoff: true
      }
    })
  }

  createFork(parentSessionId: string, forkId: string = nanoid()): TapeForkHandle {
    const table = this.table
    if (!table) {
      throw new Error('Tape table is not available.')
    }

    const forkIdValue = forkId.trim() || nanoid()
    const forkSessionIdValue = forkSessionId(parentSessionId, forkIdValue)
    table.ensureBootstrapAnchor(forkSessionIdValue)
    const parentAnchor = table.getLatestAnchor(parentSessionId)
    table.appendAnchor({
      sessionId: forkSessionIdValue,
      name: 'fork/start',
      source: {
        type: 'fork',
        id: forkIdValue,
        seq: 0
      },
      provenanceKey: `fork:${parentSessionId}:${forkIdValue}:start`,
      state: {
        parentSessionId,
        parentLastAnchorEntryId: parentAnchor?.entry_id ?? null,
        parentLastAnchorName: parentAnchor?.name ?? null
      },
      idempotent: true
    })
    return {
      parentSessionId,
      forkId: forkIdValue,
      forkSessionId: forkSessionIdValue
    }
  }

  appendForkMessageRecord(handle: TapeForkHandle, record: ChatMessageRecord): number {
    return appendMessageRecordToTape(
      this.table,
      {
        ...record,
        sessionId: handle.forkSessionId
      },
      'live'
    )
  }

  mergeFork(parentSessionId: string, forkId: string): number {
    const table = this.table
    if (!table) {
      return 0
    }

    const forkSessionIdValue = forkSessionId(parentSessionId, forkId)
    const forkEntries = table
      .getBySession(forkSessionIdValue)
      .filter((entry) => !(entry.kind === 'anchor' && entry.name === 'session/start'))

    let mergedCount = 0
    for (const entry of forkEntries) {
      table.append({
        sessionId: parentSessionId,
        kind: entry.kind,
        name: entry.name,
        source: {
          type: 'fork',
          id: forkId,
          seq: entry.entry_id
        },
        provenanceKey: `fork:${parentSessionId}:${forkId}:merge:${entry.entry_id}`,
        payload: parseJsonObject(entry.payload_json),
        meta: {
          ...parseJsonObject(entry.meta_json),
          forkId,
          forkSessionId: forkSessionIdValue,
          mergedFromEntryId: entry.entry_id
        },
        createdAt: entry.created_at,
        idempotent: true
      })
      mergedCount += 1
    }

    table.appendEvent({
      sessionId: parentSessionId,
      name: 'fork/merge',
      source: {
        type: 'fork',
        id: forkId,
        seq: 0
      },
      provenanceKey: `fork:${parentSessionId}:${forkId}:merge:event`,
      data: {
        forkId,
        forkSessionId: forkSessionIdValue,
        mergedCount
      },
      idempotent: true
    })

    return mergedCount
  }

  discardFork(parentSessionId: string, forkId: string): void {
    const table = this.table
    if (!table) {
      return
    }

    const forkSessionIdValue = forkSessionId(parentSessionId, forkId)
    table.deleteBySession(forkSessionIdValue)
    table.appendEvent({
      sessionId: parentSessionId,
      name: 'fork/discard',
      source: {
        type: 'fork',
        id: forkId,
        seq: 0
      },
      provenanceKey: `fork:${parentSessionId}:${forkId}:discard:event`,
      data: {
        forkId,
        forkSessionId: forkSessionIdValue
      },
      idempotent: true
    })
  }

  recordExternalForkMerge(
    parentSessionId: string,
    forkSessionIdValue: string,
    forkId: string,
    meta: Record<string, unknown> = {}
  ): DeepChatTapeEntryRow {
    const table = this.table
    if (!table) {
      throw new Error('Tape table is not available.')
    }

    const referencedEntryCount = table.countBySession(forkSessionIdValue)
    return table.appendEvent({
      sessionId: parentSessionId,
      name: 'fork/merge',
      source: {
        type: 'fork',
        id: forkId,
        seq: 0
      },
      provenanceKey: `fork:${parentSessionId}:${forkId}:external-merge:event`,
      data: {
        forkId,
        forkSessionId: forkSessionIdValue,
        referencedEntryCount,
        ...meta
      },
      idempotent: true
    })
  }

  recordExternalForkDiscard(
    parentSessionId: string,
    forkSessionIdValue: string,
    forkId: string,
    meta: Record<string, unknown> = {}
  ): DeepChatTapeEntryRow {
    const table = this.table
    if (!table) {
      throw new Error('Tape table is not available.')
    }

    return table.appendEvent({
      sessionId: parentSessionId,
      name: 'fork/discard',
      source: {
        type: 'fork',
        id: forkId,
        seq: 0
      },
      provenanceKey: `fork:${parentSessionId}:${forkId}:external-discard:event`,
      data: {
        forkId,
        forkSessionId: forkSessionIdValue,
        ...meta
      },
      idempotent: true
    })
  }

  private backfillLegacySummaryAnchor(
    sessionId: string,
    historyRecords: ChatMessageRecord[]
  ): void {
    const table = this.table
    if (!table) {
      return
    }

    if (table.getLatestSummaryAnchor(sessionId)) {
      return
    }

    const legacyState = this.sqlitePresenter.deepchatSessionsTable.getSummaryState(sessionId)
    if (!legacyState) {
      return
    }

    const summary = legacyState.summary_text?.trim()
    if (!summary) {
      return
    }

    const cursorOrderSeq = Math.max(1, legacyState.summary_cursor_order_seq ?? 1)
    const sourceRecords = historyRecords.filter((record) => record.orderSeq < cursorOrderSeq)
    table.appendAnchor({
      sessionId,
      name: 'compaction/migrated_summary',
      source: {
        type: 'summary',
        id: 'legacy-summary',
        seq: 1
      },
      provenanceKey: legacySummaryProvenanceKey(sessionId),
      state: {
        summary,
        cursorOrderSeq,
        range:
          sourceRecords.length > 0
            ? {
                fromOrderSeq: sourceRecords[0].orderSeq,
                toOrderSeq: sourceRecords[sourceRecords.length - 1].orderSeq
              }
            : null,
        sourceMessageIds: sourceRecords.map((record) => record.id),
        migratedFrom: 'deepchat_sessions.summary_text'
      },
      idempotent: true,
      createdAt: legacyState.summary_updated_at ?? undefined
    })
  }

  private toSearchResult(row: DeepChatTapeEntryRow): TapeSearchResult {
    return {
      entryId: row.entry_id,
      kind: row.kind,
      name: row.name,
      payload: parseJsonObject(row.payload_json),
      meta: parseJsonObject(row.meta_json),
      createdAt: row.created_at
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

  private toViewManifestRecord(row: DeepChatTapeEntryRow): DeepChatTapeViewManifestRecord | null {
    const payload = parseJsonObject(row.payload_json)
    const data = payload.data
    const manifest =
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>).manifest
        : undefined
    if (!isViewManifest(manifest, row.session_id)) {
      return null
    }

    return {
      sessionId: row.session_id,
      messageId: manifest.messageId,
      requestSeq: manifest.requestSeq,
      entryId: row.entry_id,
      createdAt: row.created_at,
      manifest
    }
  }

  private findReplayTrace(
    sessionId: string,
    messageId: string,
    requestSeq: number
  ): DeepChatMessageTraceRow | null {
    const traceTable = this.sqlitePresenter.deepchatMessageTracesTable
    if (!traceTable) {
      return null
    }

    return (
      traceTable
        .listByMessageId(messageId)
        .find((row) => row.session_id === sessionId && row.request_seq === requestSeq) ?? null
    )
  }

  private toReplayEntrySnapshot(
    row: DeepChatTapeEntryRow,
    includePayloads: boolean
  ): DeepChatTapeReplayEntrySnapshot {
    const snapshot: DeepChatTapeReplayEntrySnapshot = {
      entryId: row.entry_id,
      kind: row.kind,
      name: row.name,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceSeq: row.source_seq,
      provenanceKey: row.provenance_key,
      payloadHash: hashString(row.payload_json),
      metaHash: hashString(row.meta_json),
      createdAt: row.created_at
    }

    if (includePayloads) {
      snapshot.payload = parseJsonObject(row.payload_json)
      snapshot.meta = parseJsonObject(row.meta_json)
    }

    return snapshot
  }

  private toReplayTraceSnapshot(
    row: DeepChatMessageTraceRow,
    includePayload: boolean
  ): DeepChatTapeReplayTraceSnapshot {
    const snapshot: DeepChatTapeReplayTraceSnapshot = {
      id: row.id,
      requestSeq: row.request_seq,
      providerId: row.provider_id,
      modelId: row.model_id,
      endpoint: row.endpoint,
      headersHash: hashString(row.headers_json),
      bodyHash: hashString(row.body_json),
      truncated: row.truncated === 1,
      createdAt: row.created_at
    }

    if (includePayload) {
      snapshot.headersJson = row.headers_json
      snapshot.bodyJson = row.body_json
    }

    return snapshot
  }
}
