import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type { TapeApplicationProviders } from '../ports/application'
import type {
  TapeBackfillResult,
  TapeProjectionCursor,
  TapeTranscriptProjection
} from '../ports/capabilities'
import { tapeEntryToMessageRecord } from '../domain/effectiveSemantics'
import { buildEffectiveTapeView } from '../domain/effectiveView'
import { appendMessageRecordToTape, buildTapeToolRevisionIndex } from './factPersistence'
import type { TapeFactService } from './factService'
import { migrationProvenanceKey } from './common'

type TapeReconcilerProviders = Pick<
  TapeApplicationProviders,
  'getEntryStore' | 'getLegacySummaryReader'
>

function legacySummaryProvenanceKey(sessionId: string): string {
  return `summary:${sessionId}:legacy-summary:v1`
}

/**
 * Keeps a Session's transcript tables and its Tape describing the same messages.
 *
 * Terminal transcript writes append their message fact and derive the tables from it in one
 * transaction, then record the Tape head they reached as the transcript projection cursor. This
 * service only has to answer "did anything reach the Tape that the tables have not seen": it
 * compares the cursor with the head and replays the message rows in between, which is empty after
 * an ordinary turn because manifests, journal and provider events are not message facts.
 *
 * A Session without a cursor predates the projection or lost its Tape to a reset. Its transcript
 * is the only complete record, so it is backfilled into the Tape once, the way the reconciler
 * always did. Before the cursor is written at the head that backfill reached, any effective Tape
 * message the transcript does not hold is projected the other way, so a fact that entered the Tape
 * without going through the transcript is not declared aligned unseen. Nothing here reads the
 * transcript otherwise.
 */
export class TapeReconcilerService {
  constructor(
    private readonly providers: TapeReconcilerProviders,
    private readonly facts: TapeFactService
  ) {}

  private get table() {
    return this.providers.getEntryStore()
  }

  ensureSessionTapeReady(
    sessionId: string,
    transcript: TapeTranscriptProjection
  ): TapeBackfillResult {
    const table = this.table
    const appendedFactCount = table.runInTransaction(() => {
      const cursor = transcript.readProjectionCursor(sessionId)
      const tapeIncarnationId = table.getBootstrapIncarnation(sessionId)
      if (!cursor || !tapeIncarnationId || cursor.tapeIncarnationId !== tapeIncarnationId) {
        return this.backfillFromTranscript(sessionId, transcript)
      }

      const head: TapeProjectionCursor = {
        tapeIncarnationId,
        maxEntryId: table.getMaxEntryId(sessionId)
      }
      if (head.maxEntryId > cursor.maxEntryId) {
        transcript.applyTapeEntries(
          table.getEffectiveMessageInputRowsAfter(sessionId, cursor.maxEntryId)
        )
        transcript.writeProjectionCursor(sessionId, head)
      }
      return 0
    })

    const historyRecords = this.facts.getMessageRecords(sessionId)
    return {
      sessionId,
      migrationState: 'ready',
      messageCount: historyRecords.length,
      maxOrderSeq: historyRecords.reduce(
        (currentMax, record) => Math.max(currentMax, record.orderSeq),
        0
      ),
      appendedFactCount,
      historyRecords
    }
  }

  private backfillFromTranscript(sessionId: string, transcript: TapeTranscriptProjection): number {
    const table = this.table
    const historyRecords = [...transcript.getMessages(sessionId)].sort(
      (left, right) => left.orderSeq - right.orderSeq
    )
    table.ensureBootstrapAnchor(sessionId)

    let appendedFactCount = 0
    const toolRevisionIndex = buildTapeToolRevisionIndex(table.getEffectiveViewInputRows(sessionId))
    for (const record of historyRecords) {
      appendedFactCount += appendMessageRecordToTape(table, record, 'backfill', {
        toolRevisionIndex
      })
    }

    this.backfillLegacySummaryAnchor(sessionId, historyRecords)
    this.projectTapeOnlyMessages(sessionId, transcript, historyRecords)

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
        maxOrderSeq: historyRecords.reduce(
          (currentMax, record) => Math.max(currentMax, record.orderSeq),
          0
        )
      },
      idempotent: true
    })

    const tapeIncarnationId = table.getBootstrapIncarnation(sessionId)
    if (tapeIncarnationId) {
      transcript.writeProjectionCursor(sessionId, {
        tapeIncarnationId,
        maxEntryId: table.getMaxEntryId(sessionId)
      })
    }
    return appendedFactCount
  }

  /**
   * The backfill above made the Tape a superset of the transcript. The cursor it is about to write
   * claims the reverse as well, so the effective Tape messages the transcript lacks are projected
   * first. Ordinarily there are none; every message fact comes from the transcript or from this
   * backfill.
   */
  private projectTapeOnlyMessages(
    sessionId: string,
    transcript: TapeTranscriptProjection,
    transcriptRecords: readonly ChatMessageRecord[]
  ): void {
    const transcriptIds = new Set(transcriptRecords.map((record) => record.id))
    const tapeOnlyRows = buildEffectiveTapeView(
      this.table.getEffectiveMessageInputRows(sessionId),
      { includePending: true }
    ).rows.filter((row) => {
      const record = tapeEntryToMessageRecord(row)
      return record !== null && !transcriptIds.has(record.id)
    })
    if (tapeOnlyRows.length > 0) {
      transcript.applyTapeEntries(tapeOnlyRows)
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
