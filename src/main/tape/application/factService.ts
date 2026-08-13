import type { AgentTapeHandoffState, ChatMessageRecord } from '@shared/types/agent-interface'
import type { DeepChatTapeEntryRow, TapeAnchorAppendInput } from '../domain/entry'
import {
  toTapeSessionId,
  type TapeEntryRef,
  type TapeMessageReplacementOptions,
  type TapeToolFactInput
} from '../domain/facts'
import {
  MAX_SKILL_VIEW_RESULT_FACT_BYTES,
  validateRuntimeSkillJournalChain,
  type TapeSkillViewResultFactInput,
  type TapeSkillViewResultFactReceipt
} from '../domain/skillContext'
import { hashSkillEffectiveContent } from '../domain/skillMaterialization'
import { buildExecutionOperationProvenanceKey } from '../domain/executionJournal'
import { buildEffectiveTapeView } from '../domain/effectiveView'
import type {
  TapeAnchorWriter,
  TapeIncarnationReader,
  TapeMessageFactWriter,
  TapeSkillViewResultFactWriter,
  TapeToolFactWriter
} from '../ports/capabilities'
import type { TapeApplicationProviders } from '../ports/application'
import {
  appendMessageRecordToTape,
  appendMessageReplacementToTape,
  appendMessageRetractionToTape,
  appendTapeToolFact,
  assertTapeToolFactPhysicalEnvelope
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
  implements
    TapeToolFactWriter,
    TapeSkillViewResultFactWriter,
    TapeIncarnationReader,
    TapeMessageFactWriter,
    TapeAnchorWriter
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
    if (parseJsonObject(row.meta_json).skillContextEvidence) {
      assertTapeToolFactPhysicalEnvelope(row, input, 'live', {
        reason: 'tool_loop',
        allowStoredSkillContextEvidence: true
      })
    }
    return { sessionId: input.sessionId, entryId: row.entry_id }
  }

  getTapeIncarnationId(sessionId: string): string {
    const incarnation = this.table.getBootstrapIncarnation(sessionId)
    if (!incarnation) throw new Error('Session Tape bootstrap is missing or invalid.')
    return incarnation
  }

  appendSkillViewResultFact(input: TapeSkillViewResultFactInput): TapeSkillViewResultFactReceipt {
    if (
      !input.sessionId.trim() ||
      !input.expectedTapeIncarnationId.trim() ||
      !input.messageId.trim() ||
      !input.toolCallId.trim() ||
      input.toolName !== 'skill_view' ||
      !Number.isSafeInteger(input.orderSeq) ||
      input.orderSeq < 0 ||
      !Number.isSafeInteger(input.blockIndex) ||
      input.blockIndex < 0 ||
      !Number.isSafeInteger(input.timestamp) ||
      input.timestamp < 0 ||
      !Number.isSafeInteger(input.outcomeEntryId) ||
      input.outcomeEntryId <= 0 ||
      input.operation.providerToolCallId !== input.toolCallId ||
      typeof input.responseText !== 'string' ||
      !input.responseText
    ) {
      throw new TypeError('Runtime Skill-view result fact identity is invalid.')
    }
    if (Buffer.byteLength(input.responseText, 'utf8') > MAX_SKILL_VIEW_RESULT_FACT_BYTES) {
      throw new RangeError('Runtime Skill-view result fact exceeds 768 KiB.')
    }

    return this.table.runInTransaction(() => {
      const incarnation = this.getTapeIncarnationId(input.sessionId)
      if (incarnation !== input.expectedTapeIncarnationId) {
        throw new Error('Session Tape incarnation changed.')
      }
      const outcomeRow = this.table.getByEntryIds(input.sessionId, [input.outcomeEntryId])[0]
      if (!outcomeRow) {
        throw new Error('Runtime Skill-view Journal outcome is missing.')
      }
      const dispatchRow = this.table.getByProvenanceKey(
        input.sessionId,
        buildExecutionOperationProvenanceKey(input.operation, 'dispatch')
      )
      if (!dispatchRow) {
        throw new Error('Runtime Skill-view Journal dispatch is missing.')
      }
      const sourceId = `${input.messageId}:${input.toolCallId}`
      const skillContextEvidence = {
        identity: input.identity,
        operation: input.operation,
        outcomeEntryId: input.outcomeEntryId
      }
      const evidence = validateRuntimeSkillJournalChain({
        sessionId: input.sessionId,
        messageId: input.messageId,
        toolCallId: input.toolCallId,
        responseText: input.responseText,
        evidence: { schemaVersion: 1, ...skillContextEvidence },
        dispatchRow,
        outcomeRow
      })
      const factInput = {
        sessionId: toTapeSessionId(input.sessionId),
        messageId: input.messageId,
        orderSeq: input.orderSeq,
        blockIndex: input.blockIndex,
        block: {
          type: 'tool_call',
          content: '',
          status: 'success',
          timestamp: input.timestamp,
          tool_call: {
            id: input.toolCallId,
            name: input.toolName,
            params: '',
            response: input.responseText
          }
        },
        provenance: {
          source: 'tool_result',
          sourceId,
          sequence: input.blockIndex
        }
      } satisfies TapeToolFactInput
      const factOptions = { reason: 'tool_loop', skillContextEvidence } as const
      const row = appendTapeToolFact(this.table, factInput, 'live', factOptions)
      if (!row) throw new Error('Runtime Skill-view result fact was not appendable.')
      if (row.entry_id <= evidence.outcomeEntryId) {
        throw new Error('Runtime Skill-view result fact does not follow its Journal outcome.')
      }

      assertTapeToolFactPhysicalEnvelope(row, factInput, 'live', factOptions)

      if (this.getTapeIncarnationId(input.sessionId) !== incarnation) {
        throw new Error('Session Tape incarnation changed during Runtime Skill-view persistence.')
      }

      return {
        sessionId: input.sessionId,
        entryId: row.entry_id,
        tapeIncarnationId: incarnation,
        contentHash: hashSkillEffectiveContent(input.responseText)
      }
    })
  }

  getMessageRecords(sessionId: string): ChatMessageRecord[] {
    return buildEffectiveTapeView(this.table.getBySessionExcludingContext(sessionId), {
      includePending: true
    }).messageRecords
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
