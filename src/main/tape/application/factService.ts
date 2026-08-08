import type { AgentTapeHandoffState, ChatMessageRecord } from '@shared/types/agent-interface'
import type { DeepChatTapeEntryRow, TapeAnchorAppendInput } from '../domain/entry'
import type {
  TapeEntryRef,
  TapeMessageReplacementOptions,
  TapeToolFactInput
} from '../domain/facts'
import { buildEffectiveTapeView } from '../domain/effectiveView'
import type {
  TapeAnchorWriter,
  TapeMessageFactWriter,
  TapeToolFactWriter
} from '../ports/capabilities'
import type { TapeApplicationProviders } from '../ports/application'
import {
  appendMessageRecordToTape,
  appendMessageReplacementToTape,
  appendMessageRetractionToTape,
  appendTapeToolFact
} from './factPersistence'
import { parseJsonObject } from './common'
import type { TapeAnchorResult } from './contracts'

type TapeFactProviders = Pick<TapeApplicationProviders, 'getEntryStore'>

function normalizeHandoffName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return 'handoff/manual'
  if (trimmed.startsWith('handoff/') || trimmed.startsWith('auto_handoff/')) return trimmed
  return `handoff/${trimmed}`
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(1, Math.floor(value))
}

function buildOrderSeqRange(records: ChatMessageRecord[]): Record<string, number> | null {
  if (records.length === 0) return null
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
  const enrichedState: Record<string, unknown> = { ...state, cursorOrderSeq }

  if (!Object.prototype.hasOwnProperty.call(enrichedState, 'range')) {
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

export class TapeFactService
  implements TapeToolFactWriter, TapeMessageFactWriter, TapeAnchorWriter
{
  constructor(private readonly providers: TapeFactProviders) {}

  private get table() {
    return this.providers.getEntryStore()
  }

  appendMessageRecord(record: ChatMessageRecord): number {
    return appendMessageRecordToTape(this.table, record, 'live')
  }

  appendMessageRecordForSession(sessionId: string, record: ChatMessageRecord): number {
    return appendMessageRecordToTape(this.table, { ...record, sessionId }, 'live')
  }

  appendMessageReplacement(
    record: ChatMessageRecord,
    options: TapeMessageReplacementOptions
  ): number {
    return appendMessageReplacementToTape(this.table, record, options)
  }

  appendMessageRetraction(record: ChatMessageRecord, reason: string): number {
    return appendMessageRetractionToTape(this.table, record, reason)
  }

  async appendToolFact(input: TapeToolFactInput): Promise<TapeEntryRef> {
    const row = appendTapeToolFact(this.table, input, 'live', { reason: 'tool_loop' })
    if (!row) throw new Error('Tape tool fact was not appendable.')
    return { sessionId: input.sessionId, entryId: row.entry_id }
  }

  getMessageRecords(sessionId: string): ChatMessageRecord[] {
    return buildEffectiveTapeView(this.table.getBySession(sessionId), { includePending: true })
      .messageRecords
  }

  appendAnchor(input: TapeAnchorAppendInput): DeepChatTapeEntryRow {
    return this.table.appendAnchor(input)
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
    const handoffState = enrichHandoffState(normalizedState, this.getMessageRecords(sessionId))
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
    const row = this.handoff(sessionId, name, state, meta)
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
