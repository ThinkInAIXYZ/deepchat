import { describe, expect, it } from 'vitest'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const tableModule = sqliteModule
  ? await import('../../../../src/main/presenter/sqlitePresenter/tables/deepchatTapeEntries')
  : null

const Database = sqliteModule?.default
const DeepChatTapeEntriesTable = tableModule?.DeepChatTapeEntriesTable
const DatabaseCtor = Database!
const DeepChatTapeEntriesTableCtor = DeepChatTapeEntriesTable!

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

describeIfSqlite('DeepChatTapeEntriesTable', () => {
  function createTable() {
    const db = new DatabaseCtor(':memory:')
    const table = new DeepChatTapeEntriesTableCtor(db)
    table.createTable()
    return { db, table }
  }

  it('keeps memory/persona anchors out of context reconstruction (C7, AC-7.3)', () => {
    const { db, table } = createTable()

    table.appendAnchor({
      sessionId: 's1',
      name: 'compaction/manual',
      state: { summary: 'one', cursorOrderSeq: 3 },
      createdAt: 100
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'memory/extract',
      state: { memoryIds: ['m1'], count: 1 },
      createdAt: 101
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'persona/evolve',
      state: { personaId: 'p1' },
      createdAt: 102
    })

    const anchor = table.getLatestReconstructionAnchor('s1')
    expect(anchor?.name).toBe('compaction/manual')

    db.close()
  })

  it('assigns monotonic entry ids per session', () => {
    const { db, table } = createTable()

    table.appendEvent({
      sessionId: 's1',
      name: 'run/start',
      data: { step: 1 },
      createdAt: 100
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'compaction/manual',
      state: { summary: 'one', cursorOrderSeq: 3 },
      createdAt: 101
    })
    table.appendEvent({
      sessionId: 's2',
      name: 'run/start',
      data: { step: 1 },
      createdAt: 102
    })

    expect(table.getBySession('s1').map((entry) => entry.entry_id)).toEqual([1, 2])
    expect(table.getBySession('s2').map((entry) => entry.entry_id)).toEqual([1])

    db.close()
  })

  it('tracks the latest summary-related anchor only within the requested session', () => {
    const { db, table } = createTable()

    table.ensureBootstrapAnchor('s1')
    table.appendAnchor({
      sessionId: 's1',
      name: 'compaction/manual',
      state: { summary: 'old', cursorOrderSeq: 3 },
      createdAt: 100
    })
    table.appendAnchor({
      sessionId: 's2',
      name: 'compaction/manual',
      state: { summary: 'other', cursorOrderSeq: 8 },
      createdAt: 101
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'summary/reset',
      state: { cursorOrderSeq: 1, reason: 'summary_reset' },
      createdAt: 102
    })

    expect(table.getLatestSummaryAnchor('s1')).toMatchObject({
      session_id: 's1',
      name: 'summary/reset',
      entry_id: 3
    })
    expect(table.getLatestSummaryAnchor('s2')).toMatchObject({
      session_id: 's2',
      name: 'compaction/manual',
      entry_id: 1
    })

    db.close()
  })

  it('uses handoff anchors as reconstruction anchors without changing summary anchor lookup', () => {
    const { db, table } = createTable()

    table.ensureBootstrapAnchor('s1')
    table.appendAnchor({
      sessionId: 's1',
      name: 'compaction/manual',
      state: { summary: 'old', cursorOrderSeq: 3 },
      createdAt: 100
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'handoff/phase_done',
      state: { summary: 'handoff state', cursorOrderSeq: 8 },
      createdAt: 101
    })

    expect(table.getLatestSummaryAnchor('s1')).toMatchObject({
      name: 'compaction/manual',
      entry_id: 2
    })
    expect(table.getLatestReconstructionAnchor('s1')).toMatchObject({
      name: 'handoff/phase_done',
      entry_id: 3
    })

    db.close()
  })

  it('uses custom auto handoff anchors as reconstruction anchors', () => {
    const { db, table } = createTable()

    table.ensureBootstrapAnchor('s1')
    table.appendAnchor({
      sessionId: 's1',
      name: 'auto_handoff/custom',
      state: { summary: 'auto state', cursorOrderSeq: 8 },
      createdAt: 101
    })

    expect(table.getLatestReconstructionAnchor('s1')).toMatchObject({
      name: 'auto_handoff/custom',
      entry_id: 2
    })

    db.close()
  })

  it('lists recent anchors in chronological order after applying the limit', () => {
    const { db, table } = createTable()

    table.ensureBootstrapAnchor('s1')
    table.appendEvent({
      sessionId: 's1',
      name: 'run/ignored',
      data: { step: 1 },
      createdAt: 100
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'handoff/first',
      state: { summary: 'first' },
      createdAt: 101
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'handoff/second',
      state: { summary: 'second' },
      createdAt: 102
    })
    table.appendAnchor({
      sessionId: 's2',
      name: 'handoff/other',
      state: { summary: 'other' },
      createdAt: 103
    })

    expect(table.getAnchors('s1', 2).map((entry) => entry.name)).toEqual([
      'handoff/first',
      'handoff/second'
    ])

    db.close()
  })

  it('filters tape search by kind and created-at range', () => {
    const { db, table } = createTable()

    table.appendEvent({
      sessionId: 's1',
      name: 'run/auth',
      data: { text: 'auth event' },
      createdAt: 100
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'handoff/auth',
      state: { summary: 'auth anchor' },
      createdAt: 200
    })
    table.appendEvent({
      sessionId: 's2',
      name: 'run/auth',
      data: { text: 'auth other' },
      createdAt: 300
    })

    expect(
      table.search('s1', 'auth', {
        kinds: ['anchor'],
        startCreatedAt: 150
      })
    ).toMatchObject([{ session_id: 's1', kind: 'anchor', name: 'handoff/auth' }])
    expect(
      table.search('s1', 'auth', {
        endCreatedAt: 150
      })
    ).toMatchObject([{ session_id: 's1', kind: 'event', name: 'run/auth' }])

    db.close()
  })

  it('treats tape search query as literal text', () => {
    const { db, table } = createTable()

    table.appendEvent({
      sessionId: 's1',
      name: 'run/literal-percent',
      data: { text: '100% literal' },
      createdAt: 100
    })
    table.appendEvent({
      sessionId: 's1',
      name: 'run/literal-letter',
      data: { text: '100x literal' },
      createdAt: 101
    })

    expect(table.search('s1', '100%')).toMatchObject([
      { session_id: 's1', name: 'run/literal-percent' }
    ])

    db.close()
  })
})
