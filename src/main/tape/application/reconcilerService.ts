import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type { TapeApplicationProviders } from '../ports/application'
import type { TapeBackfillResult, TapeTranscriptReader } from '../ports/capabilities'
import { appendMessageRecordToTape } from './factPersistence'
import type { TapeFactService } from './factService'
import { migrationProvenanceKey } from './common'

type TapeReconcilerProviders = Pick<
  TapeApplicationProviders,
  'getEntryStore' | 'getLegacySummaryReader'
>

function legacySummaryProvenanceKey(sessionId: string): string {
  return `summary:${sessionId}:legacy-summary:v1`
}

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
    messageStore: TapeTranscriptReader
  ): TapeBackfillResult {
    const table = this.table
    const historyRecords = [...messageStore.getMessages(sessionId)].sort(
      (left, right) => left.orderSeq - right.orderSeq
    )
    const maxOrderSeq = historyRecords.reduce(
      (currentMax, record) => Math.max(currentMax, record.orderSeq),
      0
    )

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
