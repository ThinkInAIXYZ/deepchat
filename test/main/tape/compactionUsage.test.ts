import { describe, expect, it } from 'vitest'
import { TapeCompactionUsageService } from '@/tape/application/compactionUsageService'
import {
  buildTapeCompactionModelCallEvent,
  parseTapeCompactionModelCallEvent,
  type TapeCompactionModelCallInput
} from '@/tape/domain/compactionUsage'
import type { DeepChatTapeEntryRow, TapeEventAppendInput } from '@/tape/domain/entry'
import { SessionTranscript } from '@/session/data/transcript'
import { SessionTape } from '@/tape/application/sessionTape'
import { SessionDatabase } from '@/session/data/database'
import { UsageStatsService } from '@/session/usageStatsService'
import { DASHBOARD_STATS_BACKFILL_KEY, buildCompactionUsageStatsRecord } from '@/session/usageStats'
import { itIfSqlite, DatabaseCtor } from '../session/data/tapeTestHarness'

function input(
  overrides: Partial<TapeCompactionModelCallInput> = {}
): TapeCompactionModelCallInput {
  return {
    sessionId: 'session-1',
    compactionMessageId: 'message-1',
    compactionAttemptId: 'attempt-1',
    providerCallId: 'call-1',
    providerId: 'provider-1',
    modelId: 'model-1',
    status: 'completed',
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    startedAt: 10,
    completedAt: 20,
    ...overrides
  }
}

function createService() {
  const rows: DeepChatTapeEntryRow[] = []
  let inTransaction = false
  const store = {
    ensureBootstrapAnchor: () => undefined,
    isInTransaction: () => inTransaction,
    runInTransaction<T>(operation: () => T): T {
      inTransaction = true
      try {
        return operation()
      } finally {
        inTransaction = false
      }
    },
    getByProvenanceKey(sessionId: string, key: string) {
      return rows.find((row) => row.session_id === sessionId && row.provenance_key === key)
    },
    getMaxEventSourceSeq(sessionId: string, name: string, sourceType: string, sourceId: string) {
      return rows.reduce(
        (maximum, row) =>
          row.session_id === sessionId &&
          row.name === name &&
          row.source_type === sourceType &&
          row.source_id === sourceId
            ? Math.max(maximum, row.source_seq ?? 0)
            : maximum,
        0
      )
    },
    appendEvent(event: TapeEventAppendInput) {
      const row: DeepChatTapeEntryRow = {
        session_id: event.sessionId,
        entry_id: rows.length + 1,
        kind: 'event',
        name: event.name,
        source_type: event.source?.type ?? null,
        source_id: event.source?.id ?? null,
        source_seq: event.source?.seq ?? null,
        provenance_key: event.provenanceKey ?? null,
        payload_json: JSON.stringify({ name: event.name, data: event.data }),
        meta_json: JSON.stringify(event.meta ?? {}),
        created_at: event.createdAt ?? Date.now()
      }
      rows.push(row)
      return row
    },
    appendCompactionModelCallEvent(event: TapeEventAppendInput) {
      return this.appendEvent(event)
    },
    listEventsByNamePage(
      name: string,
      cursor: { sessionId: string; entryId: number } | null,
      limit: number
    ) {
      return rows
        .filter(
          (row) =>
            row.name === name &&
            (!cursor ||
              row.session_id > cursor.sessionId ||
              (row.session_id === cursor.sessionId && row.entry_id > cursor.entryId))
        )
        .sort(
          (left, right) =>
            left.session_id.localeCompare(right.session_id) || left.entry_id - right.entry_id
        )
        .slice(0, limit)
    }
  }
  return {
    rows,
    service: new TapeCompactionUsageService({
      getEntryStore: () => store as never,
      getCompactionUsageStore: () => store as never
    })
  }
}

describe('compaction model call Tape usage', () => {
  it('round-trips known and unknown usage without synthesizing token counts', () => {
    const known = buildTapeCompactionModelCallEvent(input(), 1)
    const unknown = buildTapeCompactionModelCallEvent(
      input({ providerCallId: 'call-2', usage: null, status: 'error' }),
      2
    )
    const { service } = createService()

    const knownRow = service.appendCompactionModelCall(input()).row
    const unknownRow = service.appendCompactionModelCall(
      input({ providerCallId: 'call-2', usage: null, status: 'error' })
    ).row

    expect(parseTapeCompactionModelCallEvent(knownRow)).toEqual(known)
    expect(parseTapeCompactionModelCallEvent(unknownRow)).toEqual(unknown)
  })

  it('round-trips partial usage and rejects unpublished schema versions', () => {
    const { service } = createService()
    const partialRow = service.appendCompactionModelCall(
      input({ usage: { inputTokens: 100, outputTokens: 20, totalTokens: null } })
    ).row
    const legacyPayload = JSON.parse(partialRow.payload_json) as {
      data: { schemaVersion: number; usage: { totalTokens: number | null } }
    }
    legacyPayload.data.schemaVersion = 1
    legacyPayload.data.usage.totalTokens = 120
    const legacyRow: DeepChatTapeEntryRow = {
      ...partialRow,
      payload_json: JSON.stringify(legacyPayload)
    }

    expect(parseTapeCompactionModelCallEvent(partialRow)?.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: null
    })
    expect(parseTapeCompactionModelCallEvent(legacyRow)).toBeNull()
  })

  it('assigns monotonic attempt-local sequences and reuses an idempotent call identity', () => {
    const { rows, service } = createService()

    const first = service.appendCompactionModelCall(input())
    const second = service.appendCompactionModelCall(input({ providerCallId: 'call-2' }))
    const replay = service.appendCompactionModelCall(
      input({ usage: null, status: 'error', completedAt: 30 })
    )

    expect(first.event.callSeq).toBe(1)
    expect(second.event.callSeq).toBe(2)
    expect(replay).toEqual(first)
    expect(rows).toHaveLength(2)
  })

  it('pages typed facts past a malformed event without stalling the cursor', () => {
    const { rows, service } = createService()
    service.appendCompactionModelCall(input())
    service.appendCompactionModelCall(input({ providerCallId: 'call-2' }))
    service.appendCompactionModelCall(input({ providerCallId: 'call-3' }))
    rows[1] = { ...rows[1], payload_json: '{}' }

    const firstPage = service.listCompactionModelCallsPage(null, 2)
    const secondPage = service.listCompactionModelCallsPage(
      { sessionId: firstPage[1].sessionId, entryId: firstPage[1].entryId },
      2
    )

    expect(firstPage).toMatchObject([
      { sessionId: 'session-1', entryId: 1, event: { providerCallId: 'call-1' } },
      { sessionId: 'session-1', entryId: 2, event: null }
    ])
    expect(secondPage).toMatchObject([
      { sessionId: 'session-1', entryId: 3, event: { providerCallId: 'call-3' } }
    ])
  })

  it('rejects malformed usage rather than normalizing it to zero', () => {
    expect(() =>
      buildTapeCompactionModelCallEvent(
        input({ usage: { inputTokens: -1, outputTokens: 0, totalTokens: 0 } }),
        1
      )
    ).toThrow('Invalid compaction model call observation')
  })

  it('rejects events whose durable source identity disagrees with the payload', () => {
    const { service } = createService()
    const row = service.appendCompactionModelCall(input()).row
    const mismatched = { ...row, source_id: 'another-attempt' }

    expect(parseTapeCompactionModelCallEvent(mismatched)).toBeNull()
  })
})

itIfSqlite('reserves internal provider and compaction observations for exact writers', () => {
  const db = new DatabaseCtor(':memory:')
  try {
    const database = new SessionDatabase({ getDatabase: () => db })
    const table = database.deepchatTapeEntriesTable
    table.createTable()

    for (const name of ['provider/attempt_completed', 'compaction/model_call_completed']) {
      expect(() => table.appendEvent({ sessionId: 's1', name, data: { forged: true } })).toThrow(
        'reserved for the strict'
      )
      expect(() =>
        table.append({
          sessionId: 's1',
          kind: 'event',
          name,
          payload: { name, data: { forged: true } }
        })
      ).toThrow('reserved for the strict')
    }

    expect(
      table.appendEvent({
        sessionId: 's1',
        name: 'provider/attempt_completed/future',
        data: { compatible: true }
      }).name
    ).toBe('provider/attempt_completed/future')
    expect(
      table.appendAnchor({
        sessionId: 's1',
        name: 'compaction/auto',
        state: { compatible: true }
      }).name
    ).toBe('compaction/auto')
    expect(
      table.appendProviderAttemptEvent({
        sessionId: 's1',
        name: 'provider/attempt_completed',
        data: { dedicated: true }
      }).name
    ).toBe('provider/attempt_completed')
    expect(
      table.appendCompactionModelCallEvent({
        sessionId: 's1',
        name: 'compaction/model_call_completed',
        data: { dedicated: true }
      }).name
    ).toBe('compaction/model_call_completed')
  } finally {
    db.close()
  }
})

itIfSqlite('persists compaction call facts and reporting rows atomically and idempotently', () => {
  const db = new DatabaseCtor(':memory:')
  try {
    const database = new SessionDatabase({ getDatabase: () => db })
    database.deepchatTapeEntriesTable.createTable()
    database.deepchatUsageStatsTable.createTable()
    const transcript = new SessionTranscript(database, new SessionTape(database))

    transcript.recordCompactionModelCall(input())
    transcript.recordCompactionModelCall(input())
    transcript.recordCompactionModelCall(
      input({ providerCallId: 'call-2', status: 'error', usage: null, completedAt: 30 })
    )

    const tapeRows = db
      .prepare(
        `SELECT source_seq, provenance_key
         FROM deepchat_tape_entries
         WHERE kind = 'event' AND name = 'compaction/model_call_completed'
         ORDER BY entry_id ASC`
      )
      .all()
    const usageRows = db
      .prepare(
        `SELECT usage_category, provider_call_id, provider_call_seq, input_tokens, total_tokens
         FROM deepchat_usage_stats
         ORDER BY provider_call_seq ASC`
      )
      .all()

    expect(tapeRows).toEqual([
      {
        source_seq: 1,
        provenance_key: 'compaction-model-call:attempt-1:call-1'
      },
      {
        source_seq: 2,
        provenance_key: 'compaction-model-call:attempt-1:call-2'
      }
    ])
    expect(usageRows).toEqual([
      {
        usage_category: 'compaction',
        provider_call_id: 'call-1',
        provider_call_seq: 1,
        input_tokens: 100,
        total_tokens: 120
      },
      {
        usage_category: 'compaction',
        provider_call_id: 'call-2',
        provider_call_seq: 2,
        input_tokens: null,
        total_tokens: null
      }
    ])

    db.exec('DROP TABLE deepchat_usage_stats')
    expect(() =>
      transcript.recordCompactionModelCall(input({ providerCallId: 'call-3' }))
    ).toThrow()
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM deepchat_tape_entries
           WHERE kind = 'event' AND name = 'compaction/model_call_completed'`
        )
        .get()
    ).toEqual({ count: 2 })
  } finally {
    db.close()
  }
})

itIfSqlite('aggregates independently measured compaction usage fields with real SQL', () => {
  const db = new DatabaseCtor(':memory:')
  try {
    const database = new SessionDatabase({ getDatabase: () => db })
    database.deepchatTapeEntriesTable.createTable()
    database.deepchatUsageStatsTable.createTable()
    const transcript = new SessionTranscript(database, new SessionTape(database))

    transcript.recordCompactionModelCall(
      input({ usage: { inputTokens: 100, outputTokens: 20, totalTokens: null } })
    )
    transcript.recordCompactionModelCall(
      input({ providerCallId: 'call-2', usage: null, status: 'error' })
    )
    database.deepchatUsageStatsTable.upsert(
      buildCompactionUsageStatsRecord({
        sessionId: 'session-1',
        event: buildTapeCompactionModelCallEvent(input(), 1),
        source: 'backfill'
      })
    )

    expect(database.deepchatUsageStatsTable.getProviderBreakdownRows()).toEqual([
      {
        id: 'provider-1',
        messageCount: 0,
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 0,
        cachedInputTokens: 0
      }
    ])
    expect(database.deepchatUsageStatsTable.getCategoryBreakdownRows()).toEqual([
      {
        id: 'compaction',
        eventCount: 2,
        knownUsageCount: 1,
        unknownUsageCount: 1,
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 0
      }
    ])
    expect(
      db.prepare("SELECT source FROM deepchat_usage_stats WHERE provider_call_id = 'call-1'").get()
    ).toEqual({ source: 'live' })
  } finally {
    db.close()
  }
})

itIfSqlite(
  'rebuilds paginated compaction usage projections from append-only Tape facts',
  async () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const database = new SessionDatabase({ getDatabase: () => db })
      database.deepchatTapeEntriesTable.createTable()
      database.deepchatUsageStatsTable.createTable()
      database.deepchatMessagesTable.createTable()
      database.deepchatSessionsTable.createTable()
      const tape = new SessionTape(database)
      const transcript = new SessionTranscript(database, tape)

      for (const sessionId of ['session-a', 'session-b']) {
        for (let index = 0; index < 26; index += 1) {
          transcript.recordCompactionModelCall(
            input({
              sessionId,
              compactionAttemptId: `attempt-${sessionId}`,
              providerCallId: `call-${index}`,
              usage:
                index === 25
                  ? { inputTokens: 10, outputTokens: 2, totalTokens: null }
                  : { inputTokens: 100, outputTokens: 20, totalTokens: 120 }
            })
          )
        }
      }
      database.deepchatUsageStatsTable.deleteAll()

      const settingsValues = new Map<string, unknown>()
      const service = new UsageStatsService(
        database,
        { getProviders: () => [], getProviderById: () => undefined } as never,
        {
          get: <T>(key: string) => settingsValues.get(key) as T,
          set: (key: string, value: unknown) => settingsValues.set(key, value)
        },
        tape
      )
      await service.startBackfill()

      expect(database.deepchatUsageStatsTable.count()).toBe(52)
      expect(database.deepchatUsageStatsTable.getCategoryBreakdownRows()).toEqual([
        {
          id: 'compaction',
          eventCount: 52,
          knownUsageCount: 52,
          unknownUsageCount: 0,
          inputTokens: 5020,
          outputTokens: 1004,
          totalTokens: 6000
        }
      ])
      expect(settingsValues.get(DASHBOARD_STATS_BACKFILL_KEY)).toMatchObject({
        status: 'completed',
        processedCount: 52
      })
    } finally {
      db.close()
    }
  }
)
