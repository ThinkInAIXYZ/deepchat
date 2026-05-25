import { describe, expect, it } from 'vitest'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const sqlitePresenterModule = sqliteModule
  ? await import('../../../../src/main/presenter/sqlitePresenter')
  : null
const sessionStoreModule = sqliteModule
  ? await import('../../../../src/main/presenter/agentRuntimePresenter/sessionStore')
  : null

const Database = sqliteModule?.default
const SQLitePresenter = sqlitePresenterModule?.SQLitePresenter
const DeepChatSessionStore = sessionStoreModule?.DeepChatSessionStore
const SQLitePresenterCtor = SQLitePresenter!
const DeepChatSessionStoreCtor = DeepChatSessionStore!

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

describeIfSqlite('DeepChatSessionStore tape summary state', () => {
  function createStore() {
    const sqlitePresenter = new SQLitePresenterCtor(':memory:')
    const store = new DeepChatSessionStoreCtor(sqlitePresenter)
    return { sqlitePresenter, store }
  }

  it('creates a bootstrap anchor for each session', () => {
    const { sqlitePresenter, store } = createStore()

    store.create('s1', 'openai', 'gpt-4o')
    store.create('s2', 'openai', 'gpt-4o-mini')

    expect(sqlitePresenter.deepchatTapeEntriesTable.getBySession('s1')).toMatchObject([
      {
        session_id: 's1',
        entry_id: 1,
        kind: 'anchor',
        name: 'session/start'
      }
    ])
    expect(sqlitePresenter.deepchatTapeEntriesTable.getBySession('s2')).toMatchObject([
      {
        session_id: 's2',
        entry_id: 1,
        kind: 'anchor',
        name: 'session/start'
      }
    ])

    sqlitePresenter.close()
  })

  it('prefers compaction summary anchors over legacy summary columns', () => {
    const { sqlitePresenter, store } = createStore()

    store.create('s1', 'openai', 'gpt-4o')
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
    expect(sqlitePresenter.deepchatTapeEntriesTable.getLatestSummaryAnchor('s1')).toMatchObject({
      name: 'compaction/manual',
      created_at: 100
    })

    sqlitePresenter.close()
  })

  it('uses handoff anchors as context reconstruction state', () => {
    const { sqlitePresenter, store } = createStore()

    store.create('s1', 'openai', 'gpt-4o')
    store.updateSummaryState('s1', {
      summaryText: 'legacy summary',
      summaryCursorOrderSeq: 2,
      summaryUpdatedAt: 50
    })
    sqlitePresenter.deepchatTapeEntriesTable.appendAnchor({
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

    sqlitePresenter.close()
  })

  it('uses handoff cursor even when handoff state has no summary', () => {
    const { sqlitePresenter, store } = createStore()

    store.create('s1', 'openai', 'gpt-4o')
    sqlitePresenter.deepchatTapeEntriesTable.appendAnchor({
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

    sqlitePresenter.close()
  })

  it('compares summary state against tape reconstruction anchors before writing compaction anchors', () => {
    const { sqlitePresenter, store } = createStore()

    store.create('s1', 'openai', 'gpt-4o')
    store.updateSummaryState('s1', {
      summaryText: 'legacy summary',
      summaryCursorOrderSeq: 2,
      summaryUpdatedAt: 50
    })
    sqlitePresenter.deepchatTapeEntriesTable.appendAnchor({
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
    expect(
      sqlitePresenter.deepchatTapeEntriesTable.getLatestReconstructionAnchor('s1')
    ).toMatchObject({
      name: 'compaction/auto',
      created_at: 200
    })

    sqlitePresenter.close()
  })

  it('does not apply no-anchor summary updates over tape-backed state', () => {
    const { sqlitePresenter, store } = createStore()

    store.create('s1', 'openai', 'gpt-4o')
    sqlitePresenter.deepchatTapeEntriesTable.appendAnchor({
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

    sqlitePresenter.close()
  })

  it('does not write a stale anchor when summary compare-and-set fails', () => {
    const { sqlitePresenter, store } = createStore()

    store.create('s1', 'openai', 'gpt-4o')
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
    expect(sqlitePresenter.deepchatTapeEntriesTable.getLatestSummaryAnchor('s1')).toBeUndefined()

    sqlitePresenter.close()
  })

  it('uses reset anchors to invalidate older compaction anchors', () => {
    const { sqlitePresenter, store } = createStore()

    store.create('s1', 'openai', 'gpt-4o')
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
    expect(sqlitePresenter.deepchatTapeEntriesTable.getLatestSummaryAnchor('s1')).toMatchObject({
      name: 'summary/reset'
    })

    sqlitePresenter.close()
  })
})
