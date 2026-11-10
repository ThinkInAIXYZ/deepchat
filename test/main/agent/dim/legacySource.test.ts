import { expect, it } from 'vitest'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import { DimLegacySource } from '@/agent/dim/legacySource'
import { dimHistoryPlan } from '@/agent/dim/historyImport'
import { TranscriptProjectionApplier } from '@/session/data/transcriptProjection'
import { dimDatabase } from './fixtures/database'

it('converts canonical edits and retractions without resurrecting stale transcript rows or writing Tape', async () => {
  const { data, sqlite } = dimDatabase()
  try {
    const tape = data.deepchatTapeEntriesTable
    sqlite.exec(tape.getCreateTableSQL())
    const record = (id: string, orderSeq: number, text: string): ChatMessageRecord => ({
      id,
      sessionId: 'legacy',
      orderSeq,
      role: 'user',
      content: JSON.stringify({ text, files: [], links: [], search: false, think: false }),
      status: 'sent',
      metadata: '{}',
      isContextEdge: 0,
      createdAt: 1,
      updatedAt: 1
    })
    const stale = record('edited', 1, 'stale cached content')
    const removed = record('removed', 2, 'removed content')
    const oldSqlOnly = record('sql-only', 3, 'before Tape existed')
    const pending = {
      ...record('interrupted', 4, ''),
      role: 'assistant' as const,
      content: '[]',
      status: 'pending' as const
    }
    const applier = new TranscriptProjectionApplier(data)
    for (const message of [stale, removed, oldSqlOnly, pending]) applier.applyRecord(message)
    for (const message of [
      stale,
      removed,
      { ...stale, content: record('edited', 1, 'canonical edit').content, updatedAt: 2 }
    ])
      tape.append({
        sessionId: 'legacy',
        kind: 'message',
        payload: { record: message },
        createdAt: message.updatedAt
      })
    tape.appendEvent({
      sessionId: 'legacy',
      name: 'message/retracted',
      data: { messageId: removed.id },
      createdAt: 3
    })
    const head = tape.getMaxEntryId('legacy')
    const draft = {
      id: 'retry',
      sessionId: 'legacy',
      mode: 'queue' as const,
      state: 'retry_required' as const,
      payload: { text: 'before Tape existed' },
      messageIds: ['sql-only'],
      assistantMessageId: null,
      queueOrder: 0,
      blocking: null,
      claimedAt: null,
      consumedAt: null,
      createdAt: 1,
      updatedAt: 1
    }
    const source = new DimLegacySource({
      database: data,
      tape,
      transcript: { getMessages: () => [stale, removed, oldSqlOnly, pending] },
      summary: {
        getSummaryState: () => ({
          summaryText: 'Retained summary',
          summaryCursorOrderSeq: 3,
          summaryUpdatedAt: 3
        })
      },
      pending: { listPendingInputs: () => [], listMigrationInputs: () => [draft] }
    })
    const snapshot = await source.snapshot('legacy')
    expect(snapshot.messages.map((message) => message.id)).toEqual([
      'edited',
      'sql-only',
      'interrupted'
    ])
    expect(JSON.parse(snapshot.messages[0].content).text).toBe('canonical edit')
    expect(snapshot).toMatchObject({ summary: 'Retained summary', contextFromOrderSeq: 3 })
    expect(snapshot.pendingInputs).toEqual([draft])
    expect(snapshot.excludedContextMessageIds).toEqual(['sql-only'])
    expect(dimHistoryPlan(await source.snapshot('legacy')).digest).toBe(
      dimHistoryPlan(snapshot).digest
    )
    expect(tape.getMaxEntryId('legacy')).toBe(head)
    expect(data.dimSessionBindingsTable.get('legacy')).toBeNull()
  } finally {
    sqlite.close()
  }
})
