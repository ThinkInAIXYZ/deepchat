import type { DeepChatTapeEntryRow } from '../domain/entry'
import {
  buildTapeProviderAttemptEvent,
  TAPE_PROVIDER_ATTEMPT_EVENT_NAME,
  type TapeProviderAttemptInput
} from '../domain/providerAttempt'
import type { TapeApplicationProviders } from '../ports/application'
import type { TapeProviderAttemptReader, TapeProviderAttemptWriter } from '../ports/capabilities'

type TapeProviderAttemptProviders = Pick<TapeApplicationProviders, 'getEntryStore'>

export class TapeProviderAttemptService
  implements TapeProviderAttemptReader, TapeProviderAttemptWriter
{
  constructor(private readonly providers: TapeProviderAttemptProviders) {}

  getMaxProviderAttemptRequestSeq(sessionId: string, messageId: string): number {
    return this.providers
      .getEntryStore()
      .getMaxEventSourceSeq(sessionId, TAPE_PROVIDER_ATTEMPT_EVENT_NAME, 'runtime_event', messageId)
  }

  appendProviderAttempt(input: TapeProviderAttemptInput): DeepChatTapeEntryRow {
    const table = this.providers.getEntryStore()
    table.ensureBootstrapAnchor(input.sessionId)
    return table.appendEvent({
      sessionId: input.sessionId,
      name: TAPE_PROVIDER_ATTEMPT_EVENT_NAME,
      source: {
        type: 'runtime_event',
        id: input.messageId,
        seq: input.requestSeq
      },
      provenanceKey: `provider-attempt:${input.sessionId}:${input.messageId}:${input.requestSeq}`,
      data: { ...buildTapeProviderAttemptEvent(input) },
      idempotent: true
    })
  }
}
