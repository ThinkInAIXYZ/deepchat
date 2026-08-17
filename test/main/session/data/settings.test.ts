import { describe, expect, it, vi } from 'vitest'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const sqlitePresenterModule = sqliteModule
  ? await import('../../../../src/main/data/mainDatabase')
  : null
const sessionStoreModule = sqliteModule
  ? await import('../../../../src/main/session/data/settings')
  : null
const sessionDatabaseModule = sqliteModule
  ? await import('../../../../src/main/session/data/database')
  : null
const sessionTapeModule = sqliteModule
  ? await import('../../../../src/main/tape/application/sessionTape')
  : null
const sessionTranscriptModule = sqliteModule
  ? await import('../../../../src/main/session/data/transcript')
  : null
const effectiveTapeViewModule = sqliteModule
  ? await import('../../../../src/main/tape/domain/effectiveView')
  : null

const Database = sqliteModule?.default
const MainDatabase = sqlitePresenterModule?.MainDatabase
const SessionSettingsStore = sessionStoreModule?.SessionSettingsStore
const SessionDatabase = sessionDatabaseModule?.SessionDatabase
const SessionTape = sessionTapeModule?.SessionTape
const SessionTranscript = sessionTranscriptModule?.SessionTranscript
const buildEffectiveTapeView = effectiveTapeViewModule?.buildEffectiveTapeView
const MainDatabaseCtor = MainDatabase!
const SessionSettingsStoreCtor = SessionSettingsStore!
const SessionDatabaseCtor = SessionDatabase!
const SessionTapeCtor = SessionTape!
const SessionTranscriptCtor = SessionTranscript!
const buildEffectiveTapeViewFn = buildEffectiveTapeView!

let sqliteAvailable = false
if (Database) {
  try {
    const smokeDb = new Database(':memory:')
    smokeDb.close()
    sqliteAvailable = true
  } catch {
    sqliteAvailable = false
  }
}

const describeIfSqlite = sqliteAvailable ? describe : describe.skip

describeIfSqlite('SessionSettingsStore tape summary state', () => {
  function createStore() {
    const connection = new MainDatabaseCtor(':memory:')
    const database = new SessionDatabaseCtor(connection)
    const tape = new SessionTapeCtor(database)
    const store = new SessionSettingsStoreCtor(database, tape)
    return { connection, database, store }
  }

  it('creates a bootstrap anchor for each session', () => {
    const { connection, database, store } = createStore()

    store.create('s1', 'openai', 'gpt-4o', 'full_access')
    store.create('s2', 'openai', 'gpt-4o-mini', 'full_access')

    expect(database.deepchatTapeEntriesTable.getBySession('s1')).toMatchObject([
      {
        session_id: 's1',
        entry_id: 1,
        kind: 'anchor',
        name: 'session/start'
      }
    ])
    expect(database.deepchatTapeEntriesTable.getBySession('s2')).toMatchObject([
      {
        session_id: 's2',
        entry_id: 1,
        kind: 'anchor',
        name: 'session/start'
      }
    ])

    connection.close()
  })

  it('prefers compaction summary anchors over legacy summary columns', () => {
    const { connection, database, store } = createStore()

    store.create('s1', 'openai', 'gpt-4o', 'full_access')
    store.updateSummaryState('s1', {
      summaryText: 'legacy summary',
      summaryCursorOrderSeq: 2,
      summaryUpdatedAt: 50
    })

    const result = store.compareAndSetSummaryState(
      's1',
      {
        summaryText: 'legacy summary',
        summaryCursorOrderSeq: 2,
        summaryUpdatedAt: 50
      },
      {
        summaryText: 'tape summary',
        summaryCursorOrderSeq: 6,
        summaryUpdatedAt: 100
      },
      {
        name: 'compaction/manual',
        state: {
          summary: 'tape summary',
          cursorOrderSeq: 6,
          range: { fromOrderSeq: 1, toOrderSeq: 5 }
        }
      }
    )

    expect(result).toEqual({
      applied: true,
      currentState: {
        summaryText: 'tape summary',
        summaryCursorOrderSeq: 6,
        summaryUpdatedAt: 100
      }
    })
    expect(store.getSummaryState('s1')).toEqual(result.currentState)
    expect(database.deepchatTapeEntriesTable.getLatestSummaryAnchor('s1')).toMatchObject({
      name: 'compaction/manual',
      created_at: 100
    })

    connection.close()
  })

  it('uses handoff anchors as context reconstruction state', () => {
    const { connection, database, store } = createStore()

    store.create('s1', 'openai', 'gpt-4o', 'full_access')
    store.updateSummaryState('s1', {
      summaryText: 'legacy summary',
      summaryCursorOrderSeq: 2,
      summaryUpdatedAt: 50
    })
    database.deepchatTapeEntriesTable.appendAnchor({
      sessionId: 's1',
      name: 'handoff/manual',
      state: {
        summary: 'handoff summary',
        cursorOrderSeq: 8
      },
      createdAt: 120
    })

    expect(store.getSummaryState('s1')).toEqual({
      summaryText: 'handoff summary',
      summaryCursorOrderSeq: 8,
      summaryUpdatedAt: 120
    })

    connection.close()
  })

  it('uses handoff cursor even when handoff state has no summary', () => {
    const { connection, database, store } = createStore()

    store.create('s1', 'openai', 'gpt-4o', 'full_access')
    database.deepchatTapeEntriesTable.appendAnchor({
      sessionId: 's1',
      name: 'handoff/manual',
      state: {
        cursorOrderSeq: 6,
        reason: 'phase_done'
      },
      createdAt: 120
    })

    expect(store.getSummaryState('s1')).toEqual({
      summaryText: null,
      summaryCursorOrderSeq: 6,
      summaryUpdatedAt: null
    })

    connection.close()
  })

  it('retains a prior summary hint without claiming a new summary timestamp', () => {
    const { connection, database, store } = createStore()

    store.create('s1', 'openai', 'gpt-4o', 'full_access')
    database.deepchatTapeEntriesTable.appendAnchor({
      sessionId: 's1',
      name: 'auto_handoff/context_overflow',
      state: {
        priorSummary: 'last valid summary',
        cursorOrderSeq: 8,
        reason: 'summary_unavailable',
        summaryGap: { fromOrderSeq: 5, toOrderSeq: 7 }
      },
      createdAt: 120
    })

    expect(store.getSummaryState('s1')).toEqual({
      summaryText: 'last valid summary',
      summaryCursorOrderSeq: 8,
      summaryUpdatedAt: null
    })

    connection.close()
  })

  it('normalizes summaries and prior summary hints read from reconstruction anchors', () => {
    const { connection, database, store } = createStore()

    store.create('s1', 'openai', 'gpt-4o', 'full_access')
    store.create('s2', 'openai', 'gpt-4o', 'full_access')
    store.create('s3', 'openai', 'gpt-4o', 'full_access')
    database.deepchatTapeEntriesTable.appendAnchor({
      sessionId: 's1',
      name: 'auto_handoff/context_overflow',
      state: {
        summary: '   ',
        priorSummary: '  last valid summary  ',
        cursorOrderSeq: 8,
        reason: 'summary_unavailable'
      },
      createdAt: 120
    })
    database.deepchatTapeEntriesTable.appendAnchor({
      sessionId: 's2',
      name: 'compaction/auto',
      state: {
        summary: '  generated summary  ',
        cursorOrderSeq: 5
      },
      createdAt: 130
    })
    database.deepchatTapeEntriesTable.appendAnchor({
      sessionId: 's3',
      name: 'compaction/auto',
      state: {
        summary: '   ',
        summaryText: '  legacy summary  ',
        cursorOrderSeq: 6
      },
      createdAt: 140
    })

    expect(store.getSummaryState('s1')).toEqual({
      summaryText: 'last valid summary',
      summaryCursorOrderSeq: 8,
      summaryUpdatedAt: null
    })
    expect(store.getSummaryState('s2')).toEqual({
      summaryText: 'generated summary',
      summaryCursorOrderSeq: 5,
      summaryUpdatedAt: 130
    })
    expect(store.getSummaryState('s3')).toEqual({
      summaryText: 'legacy summary',
      summaryCursorOrderSeq: 6,
      summaryUpdatedAt: 140
    })

    connection.close()
  })

  it('compares summary state against tape reconstruction anchors before writing compaction anchors', () => {
    const { connection, database, store } = createStore()

    store.create('s1', 'openai', 'gpt-4o', 'full_access')
    store.updateSummaryState('s1', {
      summaryText: 'legacy summary',
      summaryCursorOrderSeq: 2,
      summaryUpdatedAt: 50
    })
    database.deepchatTapeEntriesTable.appendAnchor({
      sessionId: 's1',
      name: 'handoff/manual',
      state: {
        summary: 'handoff summary',
        cursorOrderSeq: 8
      },
      createdAt: 120
    })

    const result = store.compareAndSetSummaryState(
      's1',
      {
        summaryText: 'handoff summary',
        summaryCursorOrderSeq: 8,
        summaryUpdatedAt: 120
      },
      {
        summaryText: 'next summary',
        summaryCursorOrderSeq: 10,
        summaryUpdatedAt: 200
      },
      {
        name: 'compaction/auto',
        state: {
          summary: 'next summary',
          cursorOrderSeq: 10
        }
      }
    )

    expect(result).toEqual({
      applied: true,
      currentState: {
        summaryText: 'next summary',
        summaryCursorOrderSeq: 10,
        summaryUpdatedAt: 200
      }
    })
    expect(database.deepchatTapeEntriesTable.getLatestReconstructionAnchor('s1')).toMatchObject({
      name: 'compaction/auto',
      created_at: 200
    })

    connection.close()
  })

  it('does not apply no-anchor summary updates over tape-backed state', () => {
    const { connection, database, store } = createStore()

    store.create('s1', 'openai', 'gpt-4o', 'full_access')
    database.deepchatTapeEntriesTable.appendAnchor({
      sessionId: 's1',
      name: 'handoff/manual',
      state: {
        summary: 'handoff summary',
        cursorOrderSeq: 8
      },
      createdAt: 120
    })

    const result = store.compareAndSetSummaryState(
      's1',
      {
        summaryText: 'handoff summary',
        summaryCursorOrderSeq: 8,
        summaryUpdatedAt: 120
      },
      {
        summaryText: 'legacy-only update',
        summaryCursorOrderSeq: 10,
        summaryUpdatedAt: 200
      }
    )

    expect(result).toEqual({
      applied: false,
      currentState: {
        summaryText: 'handoff summary',
        summaryCursorOrderSeq: 8,
        summaryUpdatedAt: 120
      }
    })
    expect(store.getSummaryState('s1')).toEqual(result.currentState)

    connection.close()
  })

  it('does not write a stale anchor when summary compare-and-set fails', () => {
    const { connection, database, store } = createStore()

    store.create('s1', 'openai', 'gpt-4o', 'full_access')
    store.updateSummaryState('s1', {
      summaryText: 'newer summary',
      summaryCursorOrderSeq: 5,
      summaryUpdatedAt: 200
    })

    const result = store.compareAndSetSummaryState(
      's1',
      {
        summaryText: null,
        summaryCursorOrderSeq: 1,
        summaryUpdatedAt: null
      },
      {
        summaryText: 'stale summary',
        summaryCursorOrderSeq: 3,
        summaryUpdatedAt: 100
      },
      {
        name: 'compaction/auto',
        state: {
          summary: 'stale summary',
          cursorOrderSeq: 3
        }
      }
    )

    expect(result).toEqual({
      applied: false,
      currentState: {
        summaryText: 'newer summary',
        summaryCursorOrderSeq: 5,
        summaryUpdatedAt: 200
      }
    })
    expect(database.deepchatTapeEntriesTable.getLatestSummaryAnchor('s1')).toBeUndefined()

    connection.close()
  })

  it('rolls back summary state when the matching tape anchor cannot be appended', () => {
    const { connection, database, store } = createStore()
    const originalState = {
      summaryText: 'stable summary',
      summaryCursorOrderSeq: 3,
      summaryUpdatedAt: 50
    }

    store.create('s1', 'openai', 'gpt-4o', 'full_access')
    store.updateSummaryState('s1', originalState)
    database.getDatabase().exec(`
      CREATE TRIGGER fail_compaction_anchor
      BEFORE INSERT ON deepchat_tape_entries
      WHEN NEW.name = 'compaction/failing'
      BEGIN
        SELECT RAISE(ABORT, 'forced tape anchor failure');
      END;
    `)

    expect(() =>
      store.compareAndSetSummaryState(
        's1',
        originalState,
        {
          summaryText: 'must roll back',
          summaryCursorOrderSeq: 6,
          summaryUpdatedAt: 100
        },
        {
          name: 'compaction/failing',
          state: {
            summary: 'must roll back',
            cursorOrderSeq: 6
          }
        }
      )
    ).toThrow('forced tape anchor failure')

    expect(store.getSummaryState('s1')).toEqual(originalState)
    expect(database.deepchatTapeEntriesTable.getLatestSummaryAnchor('s1')).toBeUndefined()

    connection.close()
  })

  it('uses reset anchors to invalidate older compaction anchors', () => {
    const { connection, database, store } = createStore()

    store.create('s1', 'openai', 'gpt-4o', 'full_access')
    store.compareAndSetSummaryState(
      's1',
      {
        summaryText: null,
        summaryCursorOrderSeq: 1,
        summaryUpdatedAt: null
      },
      {
        summaryText: 'summary before edit',
        summaryCursorOrderSeq: 4,
        summaryUpdatedAt: 100
      },
      {
        name: 'compaction/auto',
        state: {
          summary: 'summary before edit',
          cursorOrderSeq: 4
        }
      }
    )

    store.resetSummaryState('s1')

    expect(store.getSummaryState('s1')).toEqual({
      summaryText: null,
      summaryCursorOrderSeq: 1,
      summaryUpdatedAt: null
    })
    expect(database.deepchatTapeEntriesTable.getLatestSummaryAnchor('s1')).toMatchObject({
      name: 'summary/reset'
    })

    connection.close()
  })
})

describeIfSqlite('Session transcript and Tape order consistency', () => {
  it('reconciles committed and stale compaction markers from Tape attempt identity', () => {
    const connection = new MainDatabaseCtor(':memory:')
    try {
      const database = new SessionDatabaseCtor(connection)
      const tape = new SessionTapeCtor(database)
      const transcript = new SessionTranscriptCtor(database, tape, undefined, tape)
      const summarizedMarkerId = transcript.createCompactionMessage('s1', 1, 'compacting', null, {
        compactionAttemptId: 'summarized-attempt'
      })
      tape.appendAnchor({
        sessionId: 's1',
        name: 'compaction/auto',
        state: {
          compactionAttemptId: 'summarized-attempt',
          summary: 'durable summary',
          cursorOrderSeq: 2
        },
        createdAt: 100
      })
      const boundaryMarkerId = transcript.createCompactionMessage('s1', 2, 'compacting', null, {
        compactionAttemptId: 'boundary-attempt'
      })
      tape.appendAnchor({
        sessionId: 's1',
        name: 'compaction/auto',
        state: {
          compactionAttemptId: 'boundary-attempt',
          cursorOrderSeq: 3,
          reason: 'summary_unavailable'
        },
        createdAt: 101
      })
      tape.appendAnchor({
        sessionId: 's1',
        name: 'handoff/later',
        state: { summary: 'later handoff', cursorOrderSeq: 4 },
        createdAt: 102
      })
      const staleMarkerId = transcript.createCompactionMessage('s1', 3, 'compacting', null, {
        compactionAttemptId: 'stale-attempt'
      })
      database.deepchatMessagesTable.insert({
        id: 'legacy-marker',
        sessionId: 's1',
        orderSeq: 4,
        role: 'assistant',
        content: '[]',
        status: 'sent',
        metadata: JSON.stringify({
          messageType: 'compaction',
          compactionStatus: 'compacting',
          summaryUpdatedAt: null
        })
      })

      expect(transcript.reconcileCompactionMessages()).toEqual({
        compacted: 2,
        retracted: 2,
        failed: 0
      })
      expect(JSON.parse(transcript.getMessage(summarizedMarkerId)?.metadata ?? '{}')).toMatchObject(
        {
          compactionStatus: 'compacted',
          compactionAttemptId: 'summarized-attempt',
          summaryUpdatedAt: 100
        }
      )
      expect(JSON.parse(transcript.getMessage(boundaryMarkerId)?.metadata ?? '{}')).toMatchObject({
        compactionStatus: 'compacted',
        compactionAttemptId: 'boundary-attempt',
        compactionBoundaryReason: 'summary_unavailable',
        summaryUpdatedAt: null
      })
      expect(transcript.getMessage(staleMarkerId)).toBeNull()
      expect(transcript.getMessage('legacy-marker')).toBeNull()

      const retractions = database.deepchatTapeEntriesTable
        .getBySession('s1')
        .filter((row) => row.name === 'message/retracted')
        .map((row) => JSON.parse(row.payload_json) as { data: Record<string, unknown> })
      expect(retractions.map((payload) => payload.data)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            messageId: staleMarkerId,
            reason: 'stale_compaction_marker_recovered'
          }),
          expect.objectContaining({
            messageId: 'legacy-marker',
            reason: 'stale_compaction_marker_recovered'
          })
        ])
      )
      expect(transcript.reconcileCompactionMessages()).toEqual({
        compacted: 0,
        retracted: 0,
        failed: 0
      })
    } finally {
      connection.close()
    }
  })

  it('continues reconciling later markers after one marker transaction fails', () => {
    const connection = new MainDatabaseCtor(':memory:')
    try {
      const database = new SessionDatabaseCtor(connection)
      const tape = new SessionTapeCtor(database)
      const transcript = new SessionTranscriptCtor(database, tape, undefined, tape)
      const failedMarkerId = transcript.createCompactionMessage('s1', 1, 'compacting', null, {
        compactionAttemptId: 'committed-attempt'
      })
      tape.appendAnchor({
        sessionId: 's1',
        name: 'compaction/auto',
        state: {
          compactionAttemptId: 'committed-attempt',
          summary: 'durable summary',
          cursorOrderSeq: 2
        },
        createdAt: 100
      })
      const staleMarkerId = transcript.createCompactionMessage('s1', 2, 'compacting', null, {
        compactionAttemptId: 'stale-attempt'
      })
      vi.spyOn(transcript, 'updateCompactionMessage').mockImplementationOnce(() => {
        throw new Error('transaction failed')
      })

      expect(transcript.reconcileCompactionMessages()).toEqual({
        compacted: 0,
        retracted: 1,
        failed: 1
      })
      expect(JSON.parse(transcript.getMessage(failedMarkerId)?.metadata ?? '{}')).toMatchObject({
        compactionStatus: 'compacting'
      })
      expect(transcript.getMessage(staleMarkerId)).toBeNull()
    } finally {
      connection.close()
    }
  })

  it('does not rewrite tool facts for repeated shifts or the following backfill', () => {
    const connection = new MainDatabaseCtor(':memory:')
    try {
      const database = new SessionDatabaseCtor(connection)
      const tape = new SessionTapeCtor(database)
      const transcript = new SessionTranscriptCtor(database, tape)
      const assistantMessageId = transcript.createAssistantMessage('s1', 1)
      transcript.finalizeAssistantMessage(
        assistantMessageId,
        [
          {
            type: 'tool_call',
            status: 'success',
            timestamp: 100,
            tool_call: {
              id: 'tool-1',
              name: 'search',
              params: '{"q":"stable"}',
              response: 'stable tool response'
            }
          }
        ],
        '{}'
      )
      const readToolRows = () =>
        database.deepchatTapeEntriesTable
          .getBySession('s1')
          .filter((row) => row.kind === 'tool_call' || row.kind === 'tool_result')

      expect(readToolRows()).toHaveLength(2)
      transcript.createCompactionMessageAtOrderSeq('s1', 1, 'compacting', null, {
        compactionAttemptId: 'compaction-attempt-1',
        shiftExistingMessages: true
      })
      transcript.createCompactionMessageAtOrderSeq('s1', 1, 'compacting', null, {
        compactionAttemptId: 'compaction-attempt-2',
        shiftExistingMessages: true
      })
      expect(readToolRows()).toHaveLength(2)

      tape.ensureSessionTapeReady('s1', transcript)

      const persistedToolRows = readToolRows()
      expect(persistedToolRows).toHaveLength(2)
      expect(persistedToolRows.map((row) => JSON.parse(row.payload_json).orderSeq)).toEqual([1, 1])
      const effectiveToolRows = buildEffectiveTapeViewFn(
        database.deepchatTapeEntriesTable.getBySession('s1'),
        { includePending: false }
      ).rows.filter((row) => row.kind === 'tool_call' || row.kind === 'tool_result')
      expect(effectiveToolRows.map((row) => JSON.parse(row.payload_json).orderSeq)).toEqual([3, 3])
      expect(
        tape.search('s1', 'stable tool response', { kinds: ['tool_result'] })[0]?.refs?.orderSeq
      ).toBe(3)
    } finally {
      connection.close()
    }
  })

  it('materializes only shifted messages in bounded batches', () => {
    const connection = new MainDatabaseCtor(':memory:')
    try {
      const database = new SessionDatabaseCtor(connection)
      const messagesTable = database.deepchatMessagesTable
      Object.defineProperty(database, 'deepchatMessagesTable', { value: messagesTable })
      const tapeFacts = {
        appendMessageRecord: vi.fn().mockReturnValue(1),
        appendMessageReplacement: vi.fn().mockReturnValue(1),
        appendMessageRetraction: vi.fn().mockReturnValue(1),
        appendCompactionModelCall: vi.fn()
      }
      const transcript = new SessionTranscriptCtor(database, tapeFacts)
      database.getDatabase().transaction(() => {
        for (let orderSeq = 1; orderSeq <= 501; orderSeq += 1) {
          messagesTable.insert({
            id: `message-${orderSeq}`,
            sessionId: 's1',
            orderSeq,
            role: 'user',
            content: JSON.stringify({ text: `${orderSeq}`, files: [], links: [] }),
            status: 'sent'
          })
        }
      })()
      const getBySessionAndIds = vi.spyOn(messagesTable, 'getBySessionAndIds')

      transcript.createCompactionMessageAtOrderSeq('s1', 1, 'compacting', null, {
        compactionAttemptId: 'compaction-attempt-1',
        shiftExistingMessages: true
      })

      expect(getBySessionAndIds).toHaveBeenCalledTimes(2)
      expect(getBySessionAndIds.mock.calls.map(([, ids]) => ids.length)).toEqual([500, 1])
      expect(tapeFacts.appendMessageReplacement).toHaveBeenCalledTimes(501)
      expect(
        tapeFacts.appendMessageReplacement.mock.calls.every(
          ([, options]) =>
            options.reason === 'compaction_order_shifted' && options.revisionKind === 'order'
        )
      ).toBe(true)
    } finally {
      connection.close()
    }
  })

  it('records replacements for messages shifted by compaction insertion', () => {
    const connection = new MainDatabaseCtor(':memory:')
    try {
      const database = new SessionDatabaseCtor(connection)
      const tape = new SessionTapeCtor(database)
      const transcript = new SessionTranscriptCtor(database, tape)
      const firstMessageId = transcript.createUserMessage('s1', 1, {
        text: 'first',
        files: [],
        links: [],
        search: false,
        think: false
      })
      const shiftedMessageId = transcript.createUserMessage('s1', 2, {
        text: 'second',
        files: [],
        links: [],
        search: false,
        think: false
      })

      const shiftedCompactionMessageId = transcript.createCompactionMessageAtOrderSeq(
        's1',
        2,
        'compacting',
        null,
        { compactionAttemptId: 'compaction-attempt-1', shiftExistingMessages: true }
      )
      const latestCompactionMessageId = transcript.createCompactionMessageAtOrderSeq(
        's1',
        2,
        'compacting',
        null,
        { compactionAttemptId: 'compaction-attempt-2', shiftExistingMessages: true }
      )

      expect(
        transcript.getMessages('s1').map((record) => ({ id: record.id, orderSeq: record.orderSeq }))
      ).toEqual([
        { id: firstMessageId, orderSeq: 1 },
        { id: latestCompactionMessageId, orderSeq: 2 },
        { id: shiftedCompactionMessageId, orderSeq: 3 },
        { id: shiftedMessageId, orderSeq: 4 }
      ])
      const tapeRows = database.deepchatTapeEntriesTable.getBySession('s1')
      expect(
        buildEffectiveTapeViewFn(tapeRows, {
          includePending: true
        }).messageRecords.map((record) => ({ id: record.id, orderSeq: record.orderSeq }))
      ).toEqual([
        { id: firstMessageId, orderSeq: 1 },
        { id: shiftedMessageId, orderSeq: 4 }
      ])

      const shiftedCompactionFacts = tapeRows.filter(
        (row) => row.source_id === shiftedCompactionMessageId
      )
      expect(shiftedCompactionFacts.map((row) => row.name)).toEqual([
        'message/compaction_indicator',
        'message/compaction_indicator'
      ])
      expect(
        shiftedCompactionFacts.map(
          (row) => (JSON.parse(row.payload_json) as { data: { orderSeq: number } }).data.orderSeq
        )
      ).toEqual([2, 3])
      expect(JSON.parse(shiftedCompactionFacts[1].meta_json)).toMatchObject({
        correction: true,
        reason: 'compaction_order_shifted',
        orderSeq: 3
      })
      expect(shiftedCompactionFacts[1].provenance_key).toContain(':order_seq:3')
      expect(
        tapeRows.some(
          (row) =>
            row.source_id === shiftedCompactionMessageId &&
            row.kind === 'message' &&
            row.name === 'message/assistant'
        )
      ).toBe(false)
    } finally {
      connection.close()
    }
  })
})
