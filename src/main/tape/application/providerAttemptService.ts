import type { DeepChatTapeEntryRow } from '../domain/entry'
import {
  buildTapeProviderAttemptEvent,
  parseTapeProviderAttemptEvent,
  TAPE_PROVIDER_ATTEMPT_EVENT_NAME,
  TAPE_PROVIDER_ATTEMPT_SCHEMA_VERSION,
  type TapeProviderAttemptInput,
  type TapeProviderAttemptRecord,
  type TapeProviderContextPressureRecord
} from '../domain/providerAttempt'
import type { TapeApplicationProviders } from '../ports/application'
import type { TapeProviderAttemptReader, TapeProviderAttemptWriter } from '../ports/capabilities'

type TapeProviderAttemptProviders = Pick<
  TapeApplicationProviders,
  'getEntryStore' | 'getProviderAttemptStore'
>

export class TapeProviderAttemptService
  implements TapeProviderAttemptReader, TapeProviderAttemptWriter
{
  constructor(private readonly providers: TapeProviderAttemptProviders) {}

  getMaxProviderAttemptRequestSeq(sessionId: string, messageId: string): number {
    return this.providers
      .getEntryStore()
      .getMaxEventSourceSeq(sessionId, TAPE_PROVIDER_ATTEMPT_EVENT_NAME, 'runtime_event', messageId)
  }

  getLatestProviderAttemptForRequest(
    sessionId: string,
    messageId: string,
    requestSeq: number
  ): TapeProviderAttemptRecord | null {
    const row = this.providers
      .getEntryStore()
      .getLatestEventBySource(
        sessionId,
        TAPE_PROVIDER_ATTEMPT_EVENT_NAME,
        'runtime_event',
        messageId,
        requestSeq
      )
    if (!row) return null

    const attempt = parseTapeProviderAttemptEvent(row)
    return attempt
      ? {
          entryId: row.entry_id,
          createdAt: row.created_at,
          attempt
        }
      : null
  }

  getPendingProviderContextPressure(
    sessionId: string,
    providerId: string,
    modelId: string
  ): TapeProviderContextPressureRecord | null {
    const table = this.providers.getEntryStore()
    const latestAnchorEntryId = table.getLatestReconstructionAnchor(sessionId)?.entry_id ?? 0
    const row = table.getLatestProviderContextPressureEvent(
      sessionId,
      providerId,
      modelId,
      latestAnchorEntryId
    )
    if (!row) return null

    const attempt = parseTapeProviderAttemptEvent(row)
    if (
      !attempt ||
      attempt.schemaVersion !== TAPE_PROVIDER_ATTEMPT_SCHEMA_VERSION ||
      !attempt.contextPressure
    ) {
      return null
    }
    return {
      entryId: row.entry_id,
      attempt: { ...attempt, contextPressure: attempt.contextPressure }
    }
  }

  appendProviderAttempt(input: TapeProviderAttemptInput): DeepChatTapeEntryRow {
    const table = this.providers.getProviderAttemptStore()
    table.ensureBootstrapAnchor(input.sessionId)
    return table.appendProviderAttemptEvent({
      sessionId: input.sessionId,
      name: TAPE_PROVIDER_ATTEMPT_EVENT_NAME,
      source: {
        type: 'runtime_event',
        id: input.messageId,
        seq: input.requestSeq
      },
      provenanceKey: `provider-attempt:${input.sessionId}:${input.messageId}:${input.requestSeq}:${input.physicalAttempt}`,
      data: { ...buildTapeProviderAttemptEvent(input) },
      idempotent: true
    })
  }
}
