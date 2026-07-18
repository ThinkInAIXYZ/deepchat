import { describe, expect, it, vi } from 'vitest'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const tableModule = sqliteModule ? await import('@/session/data/tables/deepchatTapeEntries') : null
const lifecycleModule = sqliteModule
  ? await import('@/tape/infrastructure/sqlite/tapeLifecycleAdapter')
  : null

const Database = sqliteModule?.default
const DeepChatTapeEntriesTable = tableModule?.DeepChatTapeEntriesTable
const SqliteTapeLifecycleAdapter = lifecycleModule?.SqliteTapeLifecycleAdapter
const DatabaseCtor = Database!
const DeepChatTapeEntriesTableCtor = DeepChatTapeEntriesTable!
const SqliteTapeLifecycleAdapterCtor = SqliteTapeLifecycleAdapter!

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
    const lifecycle = new SqliteTapeLifecycleAdapterCtor(db)
    return { db, table, lifecycle }
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

  it('assigns a new Tape incarnation when a session Tape is rebuilt', () => {
    const { db, table, lifecycle } = createTable()
    table.ensureBootstrapAnchor('s1')
    table.ensureBootstrapAnchor('s2')

    const firstRows = table.getFirstEntriesBySessions(['s2', 'missing', 's1'])
    const firstIncarnation = JSON.parse(
      firstRows.find((row) => row.session_id === 's1')!.meta_json
    ).tapeIncarnationId
    const secondIncarnation = JSON.parse(
      firstRows.find((row) => row.session_id === 's2')!.meta_json
    ).tapeIncarnationId
    expect(firstIncarnation).toEqual(expect.any(String))
    expect(secondIncarnation).toEqual(expect.any(String))
    expect(secondIncarnation).not.toBe(firstIncarnation)

    lifecycle.deleteBySession('s1')
    table.ensureBootstrapAnchor('s1')
    const rebuiltIncarnation = JSON.parse(
      table.getFirstEntriesBySessions(['s1'])[0].meta_json
    ).tapeIncarnationId
    expect(rebuiltIncarnation).toEqual(expect.any(String))
    expect(rebuiltIncarnation).not.toBe(firstIncarnation)

    db.close()
  })

  it('deletes Tape and its mutation projection through the lifecycle adapter', () => {
    const db = new DatabaseCtor(':memory:')
    const projection = {
      applyAppendedEntry: vi.fn(() => true),
      invalidateSession: vi.fn(),
      deleteBySession: vi.fn()
    }
    const table = new DeepChatTapeEntriesTableCtor(db, projection)
    table.createTable()
    const lifecycle = new SqliteTapeLifecycleAdapterCtor(db, projection)
    table.ensureBootstrapAnchor('s1')

    lifecycle.deleteBySession('s1')

    expect(table.getBySession('s1')).toEqual([])
    expect(projection.deleteBySession).toHaveBeenCalledWith('s1')
    db.close()
  })

  it('rolls back Tape deletion when mutation projection cleanup fails', () => {
    const db = new DatabaseCtor(':memory:')
    const table = new DeepChatTapeEntriesTableCtor(db)
    table.createTable()
    table.ensureBootstrapAnchor('s1')
    const lifecycle = new SqliteTapeLifecycleAdapterCtor(db, {
      applyAppendedEntry: vi.fn(() => true),
      invalidateSession: vi.fn(),
      deleteBySession: vi.fn(() => {
        throw new Error('projection cleanup failed')
      })
    })

    expect(() => lifecycle.deleteBySession('s1')).toThrow('projection cleanup failed')
    expect(table.getBySession('s1')).toHaveLength(1)
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
