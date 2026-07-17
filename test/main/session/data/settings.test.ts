import { describe, expect, it } from 'vitest'

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

const Database = sqliteModule?.default
const MainDatabase = sqlitePresenterModule?.MainDatabase
const SessionSettingsStore = sessionStoreModule?.SessionSettingsStore
const SessionDatabase = sessionDatabaseModule?.SessionDatabase
const SessionTape = sessionTapeModule?.SessionTape
const MainDatabaseCtor = MainDatabase!
const SessionSettingsStoreCtor = SessionSettingsStore!
const SessionDatabaseCtor = SessionDatabase!
const SessionTapeCtor = SessionTape!

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
