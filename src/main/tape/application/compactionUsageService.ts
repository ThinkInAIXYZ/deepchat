import {
  buildTapeCompactionModelCallEvent,
  parseTapeCompactionModelCallEvent,
  TAPE_COMPACTION_MODEL_CALL_EVENT_NAME,
  type TapeCompactionModelCallInput,
  type TapeCompactionModelCallReceipt
} from '../domain/compactionUsage'
import type { TapeApplicationProviders } from '../ports/application'
import type {
  TapeCompactionModelCallCandidate,
  TapeCompactionModelCallReader,
  TapeCompactionModelCallWriter
} from '../ports/capabilities'

type TapeCompactionUsageProviders = Pick<
  TapeApplicationProviders,
  'getEntryStore' | 'getCompactionUsageStore'
>

function provenanceKey(input: TapeCompactionModelCallInput): string {
  return `compaction-model-call:${input.compactionAttemptId}:${input.providerCallId}`
}

export class TapeCompactionUsageService
  implements TapeCompactionModelCallReader, TapeCompactionModelCallWriter
{
  constructor(private readonly providers: TapeCompactionUsageProviders) {}

  listCompactionModelCallsPage(
    cursor: { sessionId: string; entryId: number } | null,
    limit: number
  ): TapeCompactionModelCallCandidate[] {
    return this.providers
      .getEntryStore()
      .listEventsByNamePage(TAPE_COMPACTION_MODEL_CALL_EVENT_NAME, cursor, limit)
      .map((row) => ({
        sessionId: row.session_id,
        entryId: row.entry_id,
        event: parseTapeCompactionModelCallEvent(row)
      }))
  }

  appendCompactionModelCall(input: TapeCompactionModelCallInput): TapeCompactionModelCallReceipt {
    const table = this.providers.getCompactionUsageStore()
    const append = (): TapeCompactionModelCallReceipt => {
      table.ensureBootstrapAnchor(input.sessionId)
      const key = provenanceKey(input)
      const existing = table.getByProvenanceKey(input.sessionId, key)
      if (existing) {
        const event = parseTapeCompactionModelCallEvent(existing)
        if (!event) {
          throw new Error('Compaction model call provenance resolved to an invalid Tape event.')
        }
        return { row: existing, event }
      }

      const callSeq =
        table.getMaxEventSourceSeq(
          input.sessionId,
          TAPE_COMPACTION_MODEL_CALL_EVENT_NAME,
          'runtime_event',
          input.compactionAttemptId
        ) + 1
      const event = buildTapeCompactionModelCallEvent(input, callSeq)
      const row = table.appendCompactionModelCallEvent({
        sessionId: input.sessionId,
        name: TAPE_COMPACTION_MODEL_CALL_EVENT_NAME,
        source: {
          type: 'runtime_event',
          id: event.compactionAttemptId,
          seq: event.callSeq
        },
        provenanceKey: key,
        data: { ...event },
        createdAt: event.completedAt,
        idempotent: true
      })
      return { row, event }
    }

    return table.isInTransaction() ? append() : table.runInTransaction(append)
  }
}
