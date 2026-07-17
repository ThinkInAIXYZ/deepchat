import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type { TapeEntryRef, TapeToolFactInput } from '../domain/facts'
import { buildEffectiveTapeView } from '../domain/effectiveView'
import type { TapeToolFactWriter, TapeMessageFactWriter } from '../ports/capabilities'
import type { TapeApplicationProviders } from '../ports/application'
import {
  appendMessageRecordToTape,
  appendMessageReplacementToTape,
  appendMessageRetractionToTape,
  appendTapeToolFact
} from './factPersistence'

type TapeFactProviders = Pick<TapeApplicationProviders, 'getEntryStore'>

export class TapeFactService implements TapeToolFactWriter, TapeMessageFactWriter {
  constructor(private readonly providers: TapeFactProviders) {}

  private get table() {
    return this.providers.getEntryStore()
  }

  appendMessageRecord(record: ChatMessageRecord): number {
    return appendMessageRecordToTape(this.table, record, 'live')
  }

  appendMessageReplacement(record: ChatMessageRecord, reason: string): number {
    return appendMessageReplacementToTape(this.table, record, reason)
  }

  appendMessageRetraction(record: ChatMessageRecord, reason: string): number {
    return appendMessageRetractionToTape(this.table, record, reason)
  }

  async appendToolFact(input: TapeToolFactInput): Promise<TapeEntryRef> {
    const row = appendTapeToolFact(this.table, input, 'live', 'tool_loop')
    if (!row) throw new Error('Tape tool fact was not appendable.')
    return { sessionId: input.sessionId, entryId: row.entry_id }
  }

  getMessageRecords(sessionId: string): ChatMessageRecord[] {
    return buildEffectiveTapeView(this.table.getBySession(sessionId), { includePending: true })
      .messageRecords
  }
}
