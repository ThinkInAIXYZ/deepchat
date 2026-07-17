import { nanoid } from 'nanoid'
import logger from 'electron-log'
import type { AgentTapeHandoffState, ChatMessageRecord } from '@shared/types/agent-interface'
import type { DeepChatTapeEntryRow } from '../domain/entry'
import type { TapeApplicationProviders } from '../ports/application'
import { appendMessageRecordToTape } from './factPersistence'
import { parseJsonObject } from './common'
import type { TapeAnchorResult, TapeForkHandle } from './contracts'
import type { TapeFactService } from './factService'

type TapeForkProviders = Pick<TapeApplicationProviders, 'getForkStore' | 'getSearchProjectionStore'>

function readForkMergeReceiptCount(
  row: DeepChatTapeEntryRow,
  parentSessionId: string,
  forkId: string,
  forkSessionIdValue: string
): number {
  const payload = parseJsonObject(row.payload_json)
  const data =
    payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : {}
  const mergedCount = data.mergedCount
  const forkHeadEntryId = data.forkHeadEntryId
  const hasValidLegacyOrCurrentHead =
    forkHeadEntryId === undefined ||
    (typeof forkHeadEntryId === 'number' &&
      Number.isSafeInteger(forkHeadEntryId) &&
      forkHeadEntryId >= 0)
  if (
    row.session_id !== parentSessionId ||
    row.kind !== 'event' ||
    row.name !== 'fork/merge' ||
    row.source_type !== 'fork' ||
    row.source_id !== forkId ||
    row.source_seq !== 0 ||
    row.provenance_key !== `fork:${parentSessionId}:${forkId}:merge:event` ||
    data.forkId !== forkId ||
    data.forkSessionId !== forkSessionIdValue ||
    typeof mergedCount !== 'number' ||
    !Number.isSafeInteger(mergedCount) ||
    mergedCount < 0 ||
    !hasValidLegacyOrCurrentHead ||
    (typeof forkHeadEntryId === 'number' && mergedCount > forkHeadEntryId)
  ) {
    throw new Error(`Stored fork merge receipt is malformed: ${row.entry_id}`)
  }
  return mergedCount
}

function assertValidForkStart(
  row: DeepChatTapeEntryRow | undefined,
  parentSessionId: string,
  forkId: string,
  forkSessionIdValue: string
): void {
  if (!row) {
    throw new Error(`Fork ${forkId} does not exist or has been discarded.`)
  }
  const payload = parseJsonObject(row.payload_json)
  const state =
    payload.state && typeof payload.state === 'object' && !Array.isArray(payload.state)
      ? (payload.state as Record<string, unknown>)
      : {}
  const parentHeadEntryId = state.parentHeadEntryId
  const hasValidLegacyOrCurrentHead =
    parentHeadEntryId === undefined ||
    (typeof parentHeadEntryId === 'number' &&
      Number.isSafeInteger(parentHeadEntryId) &&
      parentHeadEntryId >= 0)
  if (
    row.session_id !== forkSessionIdValue ||
    row.kind !== 'anchor' ||
    row.name !== 'fork/start' ||
    row.source_type !== 'fork' ||
    row.source_id !== forkId ||
    row.source_seq !== 0 ||
    row.provenance_key !== `fork:${parentSessionId}:${forkId}:start` ||
    state.parentSessionId !== parentSessionId ||
    !hasValidLegacyOrCurrentHead
  ) {
    throw new Error(`Stored fork start is malformed: ${row.entry_id}`)
  }
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

export function normalizeTapeHandoffState(state: unknown): AgentTapeHandoffState {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Tape handoff requires a non-empty summary.')
  }

  const summary = (state as Record<string, unknown>).summary
  if (typeof summary !== 'string' || !summary.trim()) {
    throw new Error('Tape handoff requires a non-empty summary.')
  }

  return {
    ...(state as Record<string, unknown>),
    summary: summary.trim()
  }
}

function forkSessionId(parentSessionId: string, forkId: string): string {
  return `${parentSessionId}::fork::${forkId}`
}

export class TapeForkService {
  constructor(
    private readonly providers: TapeForkProviders,
    private readonly facts: TapeFactService
  ) {}

  private get table() {
    return this.providers.getForkStore()
  }

  private get searchProjectionTable() {
    return this.providers.getSearchProjectionStore()
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

  handoff(
    sessionId: string,
    name: string,
    state: AgentTapeHandoffState,
    meta: Record<string, unknown> = {}
  ): DeepChatTapeEntryRow {
    const normalizedState = normalizeTapeHandoffState(state)
    const table = this.table
    table.ensureBootstrapAnchor(sessionId)
    const handoffState = enrichHandoffState(
      normalizedState,
      this.facts.getMessageRecords(sessionId)
    )
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

  handoffResult(
    sessionId: string,
    name: string,
    state: AgentTapeHandoffState,
    meta: Record<string, unknown> = {}
  ): TapeAnchorResult {
    return this.toAnchorResult(this.handoff(sessionId, name, state, meta))
  }

  createFork(parentSessionId: string, forkId: string = nanoid()): TapeForkHandle {
    const table = this.table
    const forkIdValue = forkId.trim() || nanoid()
    const forkSessionIdValue = forkSessionId(parentSessionId, forkIdValue)
    const parentHeadEntryId = table.getMaxEntryId(parentSessionId)
    table.ensureBootstrapAnchor(forkSessionIdValue)
    const parentAnchor = table.getLatestAnchor(parentSessionId)
    const forkStart = table.appendAnchor({
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
        parentHeadEntryId,
        parentLastAnchorEntryId: parentAnchor?.entry_id ?? null,
        parentLastAnchorName: parentAnchor?.name ?? null
      },
      idempotent: true
    })
    const forkStartPayload = parseJsonObject(forkStart.payload_json)
    const persistedState =
      forkStartPayload.state &&
      typeof forkStartPayload.state === 'object' &&
      !Array.isArray(forkStartPayload.state)
        ? (forkStartPayload.state as Record<string, unknown>)
        : {}
    const persistedParentHeadEntryId = persistedState.parentHeadEntryId
    return {
      parentSessionId,
      forkId: forkIdValue,
      forkSessionId: forkSessionIdValue,
      parentHeadEntryId:
        typeof persistedParentHeadEntryId === 'number' &&
        Number.isSafeInteger(persistedParentHeadEntryId) &&
        persistedParentHeadEntryId >= 0
          ? persistedParentHeadEntryId
          : parentHeadEntryId
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
    const forkSessionIdValue = forkSessionId(parentSessionId, forkId)
    const mergeProvenanceKey = `fork:${parentSessionId}:${forkId}:merge:event`

    return table.runInTransaction(() => {
      const existingReceipt = table.getByProvenanceKey(parentSessionId, mergeProvenanceKey)
      if (existingReceipt) {
        return readForkMergeReceiptCount(
          existingReceipt,
          parentSessionId,
          forkId,
          forkSessionIdValue
        )
      }

      assertValidForkStart(
        table.getByProvenanceKey(forkSessionIdValue, `fork:${parentSessionId}:${forkId}:start`),
        parentSessionId,
        forkId,
        forkSessionIdValue
      )

      const forkHeadEntryId = table.getMaxEntryId(forkSessionIdValue)
      const forkEntries = table
        .getBySessionUpToEntryId(forkSessionIdValue, forkHeadEntryId)
        .filter(
          (entry) =>
            !(
              entry.kind === 'anchor' &&
              (entry.name === 'session/start' || entry.name === 'fork/start')
            )
        )

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
      }

      table.appendEvent({
        sessionId: parentSessionId,
        name: 'fork/merge',
        source: {
          type: 'fork',
          id: forkId,
          seq: 0
        },
        provenanceKey: mergeProvenanceKey,
        data: {
          forkId,
          forkSessionId: forkSessionIdValue,
          forkHeadEntryId,
          mergedCount: forkEntries.length
        },
        idempotent: true
      })

      return forkEntries.length
    })
  }

  discardFork(parentSessionId: string, forkId: string): void {
    const table = this.table
    const forkSessionIdValue = forkSessionId(parentSessionId, forkId)
    table.deleteBySession(forkSessionIdValue)
    try {
      this.searchProjectionTable.deleteBySession(forkSessionIdValue)
    } catch (error) {
      logger.warn(`[Tape] failed to delete fork search projection: ${String(error)}`)
    }
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
}
