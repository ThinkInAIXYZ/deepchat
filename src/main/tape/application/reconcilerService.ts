import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type { TapeApplicationProviders } from '../ports/application'
import type { TapeBackfillResult, TapeTranscriptReader } from '../ports/capabilities'
import { appendMessageRecordToTape, buildTapeToolRevisionIndex } from './factPersistence'
import type { TapeFactService } from './factService'
import { migrationProvenanceKey } from './common'

type TapeReconcilerProviders = Pick<
  TapeApplicationProviders,
  'getEntryStore' | 'getLegacySummaryReader'
>

/**
 * What the last completed backfill of a session saw. Every transcript mutation either changes the
 * row count or stamps a row with `updated_at = Date.now()`, every Tape reset mints a new
 * incarnation, and every Tape append moves the head, so an identical snapshot proves the backfill
 * has nothing left to do. The head also catches the database file being swapped underneath a live
 * process (sync restore, maintenance reopen), where the incarnation is copied rather than minted.
 */
interface ReconciledTranscriptSnapshot {
  messageCount: number
  maxOrderSeq: number
  maxUpdatedAt: number
  tapeIncarnationId: string
  tapeHeadEntryId: number
}

function legacySummaryProvenanceKey(sessionId: string): string {
  return `summary:${sessionId}:legacy-summary:v1`
}

export class TapeReconcilerService {
  /**
   * Keyed by session id; absent until the first completed backfill in this process. Entries are
   * never evicted: a stale one costs ~100 bytes and can only ever force a full backfill.
   */
  private readonly reconciled = new Map<string, ReconciledTranscriptSnapshot>()

  constructor(
    private readonly providers: TapeReconcilerProviders,
    private readonly facts: TapeFactService
  ) {}

  private get table() {
    return this.providers.getEntryStore()
  }

  ensureSessionTapeReady(
    sessionId: string,
    messageStore: TapeTranscriptReader
  ): TapeBackfillResult {
    const table = this.table
    const observedAt = Date.now()
    const historyRecords = [...messageStore.getMessages(sessionId)].sort(
      (left, right) => left.orderSeq - right.orderSeq
    )
    let maxOrderSeq = 0
    let maxUpdatedAt = 0
    for (const record of historyRecords) {
      maxOrderSeq = Math.max(maxOrderSeq, record.orderSeq)
      maxUpdatedAt = Math.max(maxUpdatedAt, record.updatedAt)
    }

    // A clock that stepped back to or before the newest remembered write could stamp a later
    // mutation with a smaller `updated_at`, so the snapshot is only trusted while time is ahead of it.
    const previous = this.reconciled.get(sessionId)
    if (
      previous &&
      previous.maxUpdatedAt < observedAt &&
      previous.messageCount === historyRecords.length &&
      previous.maxOrderSeq === maxOrderSeq &&
      previous.maxUpdatedAt === maxUpdatedAt &&
      previous.tapeIncarnationId === table.getBootstrapIncarnation(sessionId) &&
      previous.tapeHeadEntryId === table.getMaxEntryId(sessionId)
    ) {
      return {
        sessionId,
        migrationState: 'ready',
        messageCount: historyRecords.length,
        maxOrderSeq,
        appendedFactCount: 0,
        historyRecords: this.facts.getMessageRecords(sessionId)
      }
    }

    table.ensureBootstrapAnchor(sessionId)

    let appendedFactCount = 0
    const toolRevisionIndex = buildTapeToolRevisionIndex(table.getEffectiveViewInputRows(sessionId))
    for (const record of historyRecords) {
      appendedFactCount += appendMessageRecordToTape(table, record, 'backfill', {
        toolRevisionIndex
      })
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

    // `updated_at` has millisecond resolution: a mutation landing in the same millisecond as the
    // newest row we saw would be indistinguishable from it, so only remember snapshots whose newest
    // write is already strictly in the past. Inside a host transaction the appends above are not
    // committed yet and could still roll back, so nothing is remembered there either.
    const tapeIncarnationId = table.getBootstrapIncarnation(sessionId)
    if (tapeIncarnationId && maxUpdatedAt < observedAt && !table.isInTransaction()) {
      this.reconciled.set(sessionId, {
        messageCount: historyRecords.length,
        maxOrderSeq,
        maxUpdatedAt,
        tapeIncarnationId,
        tapeHeadEntryId: table.getMaxEntryId(sessionId)
      })
    } else {
      this.reconciled.delete(sessionId)
    }

    return {
      sessionId,
      migrationState: 'ready',
      messageCount: historyRecords.length,
      maxOrderSeq,
      appendedFactCount,
      historyRecords: this.facts.getMessageRecords(sessionId)
    }
  }

  private backfillLegacySummaryAnchor(
    sessionId: string,
    historyRecords: ChatMessageRecord[]
  ): void {
    const table = this.table
    if (table.getLatestSummaryAnchor(sessionId)) {
      return
    }

    const legacyState = this.providers.getLegacySummaryReader().getSummaryState(sessionId)
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
}
