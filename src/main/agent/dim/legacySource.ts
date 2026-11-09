import type { ChatMessageRecord, PendingSessionInputRecord } from '@shared/types/agent-interface'
import type { JsonValue } from '@shared/contracts/json'
import type { SessionDatabase } from '@/session/data/database'
import type { DeepChatTapeEntryRow } from '@/tape/domain/entry'
import { buildEffectiveTapeView } from '@/tape/domain/effectiveView'
import { readTapeMessageRetractionId } from '@/tape/domain/effectiveSemantics'
import type { SessionSummaryState } from '@/session/data/contracts'
import type { DimHistorySnapshot } from './historyImport'

interface LegacySourceOptions {
  database: SessionDatabase
  transcript: { getMessages(sessionId: string): ChatMessageRecord[] }
  tape: { getEffectiveViewInputRows(sessionId: string): DeepChatTapeEntryRow[] }
  summary: { getSummaryState(sessionId: string): SessionSummaryState }
  pending: { listPendingInputs(sessionId: string): PendingSessionInputRecord[] }
  images?(messages: ChatMessageRecord[]): Promise<Record<string, JsonValue[]>>
}

/** Read-only legacy conversion source. Browsing and startup never call this boundary. */
export class DimLegacySource {
  constructor(private readonly options: LegacySourceOptions) {}

  async snapshot(sessionId: string): Promise<DimHistorySnapshot> {
    const snapshot = this.options.database.getDatabase().transaction((): DimHistorySnapshot => {
      const rows = this.options.tape.getEffectiveViewInputRows(sessionId)
      const effective = buildEffectiveTapeView(rows, { includePending: true }).messageRecords
      const removed = new Set(rows.map(readTapeMessageRetractionId).filter((id) => id !== null))
      const messages = new Map(effective.map((message) => [message.id, message]))
      // Pending assistants and pre-Tape rows may only exist in the old transcript. Explicit
      // retractions must still win over a stale cache; canonical Tape edits win over that cache.
      for (const message of this.options.transcript.getMessages(sessionId))
        if (!messages.has(message.id) && !removed.has(message.id)) messages.set(message.id, message)
      const summary = this.options.summary.getSummaryState(sessionId)
      const text = summary.summaryText?.trim() || null
      const contextFromOrderSeq = text ? Math.max(1, summary.summaryCursorOrderSeq) : 1
      if (!Number.isSafeInteger(contextFromOrderSeq))
        throw new Error('Invalid legacy conversation summary boundary')
      const ordered = [...messages.values()].sort((left, right) => left.orderSeq - right.orderSeq)
      if (ordered.some((message) => message.sessionId !== sessionId))
        throw new Error('Legacy content belongs to another session')
      const pendingInputs = this.options.pending.listPendingInputs(sessionId)
      if (pendingInputs.some((item) => item.sessionId !== sessionId))
        throw new Error('Legacy pending input belongs to another session')
      return {
        formatVersion: 1,
        productSessionId: sessionId,
        messages: ordered,
        summary: text,
        contextFromOrderSeq,
        pendingInputs,
        source: {
          kind: 'legacy',
          tapeHead: rows.reduce((head, row) => Math.max(head, row.entry_id), 0),
          summaryUpdatedAt: summary.summaryUpdatedAt
        }
      }
    })()
    // File conversion is outside the synchronous SQL snapshot. Its result becomes part of the
    // import digest, so changed/missing bytes cannot silently replace an interrupted import.
    if (this.options.images) snapshot.images = await this.options.images(snapshot.messages)
    return snapshot
  }
}
