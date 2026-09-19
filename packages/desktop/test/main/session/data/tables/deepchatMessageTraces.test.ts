import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const tableModule = sqliteModule
  ? await import('@/session/data/tables/deepchatMessageTraces')
  : null

const Database = sqliteModule?.default
const DeepChatMessageTracesTable = tableModule?.DeepChatMessageTracesTable
const TRACE_EVIDENCE_APPEND_INDEX_SCHEMA_VERSION =
  tableModule?.TRACE_EVIDENCE_APPEND_INDEX_SCHEMA_VERSION
const DatabaseCtor = Database!
const DeepChatMessageTracesTableCtor = DeepChatMessageTracesTable!

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

describeIfSqlite('DeepChatMessageTracesTable', () => {
  function createTable() {
    const db = new DatabaseCtor(':memory:')
    const table = new DeepChatMessageTracesTableCtor(db)
    table.createTable()
    return { db, table }
  }

  function baseRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'trace-1',
      messageId: 'a1',
      sessionId: 's1',
      providerId: 'openai',
      modelId: 'gpt-4o',
      endpoint: 'https://api.openai.test/v1/chat/completions',
      headersJson: '{}',
      bodyJson: '{}',
      truncated: false,
      createdAt: 100,
      ...overrides
    }
  }

  it('uses the explicit request seq when provided', () => {
    const { table } = createTable()

    expect(table.insert(baseRow({ id: 't1', requestSeq: 5 }))).toBe(5)
    expect(table.listByMessageId('a1')[0]).toMatchObject({
      request_seq: 5,
      logical_round: null,
      physical_attempt: null
    })
  })

  it('stores attempt identity and orders the newest physical attempt first', () => {
    const { table } = createTable()

    table.insert(
      baseRow({
        id: 't1',
        requestSeq: 5,
        logicalRound: 2,
        physicalAttempt: 1,
        createdAt: 200
      })
    )
    table.insert(
      baseRow({
        id: 't2',
        requestSeq: 5,
        logicalRound: 2,
        physicalAttempt: 2,
        createdAt: 100
      })
    )

    expect(table.listByMessageId('a1')).toMatchObject([
      { id: 't2', request_seq: 5, logical_round: 2, physical_attempt: 2 },
      { id: 't1', request_seq: 5, logical_round: 2, physical_attempt: 1 }
    ])
  })

  it('falls back to max request seq plus one when omitted', () => {
    const { table } = createTable()

    expect(table.insert(baseRow({ id: 't1' }))).toBe(1)
    expect(table.insert(baseRow({ id: 't2' }))).toBe(2)
    expect(table.insert(baseRow({ id: 't3' }))).toBe(3)
  })

  it('stores the sentinel gap seq without shifting the fallback sequence', () => {
    const { table } = createTable()

    expect(table.insert(baseRow({ id: 't1', requestSeq: 1 }))).toBe(1)
    expect(table.insert(baseRow({ id: 't-gap', requestSeq: 0 }))).toBe(0)
    expect(table.insert(baseRow({ id: 't2' }))).toBe(2)

    const seqs = table
      .listByMessageId('a1')
      .map((row) => row.request_seq)
      .sort((a, b) => a - b)
    expect(seqs).toEqual([0, 1, 2])
  })

  it('reports the max request seq per message, defaulting to 0', () => {
    const { table } = createTable()

    expect(table.maxRequestSeqByMessageId('a1')).toBe(0)

    table.insert(baseRow({ id: 't1', requestSeq: 1 }))
    table.insert(baseRow({ id: 't-gap', requestSeq: 0 }))
    table.insert(baseRow({ id: 't2', requestSeq: 2 }))

    expect(table.maxRequestSeqByMessageId('a1')).toBe(2)
    expect(table.maxRequestSeqByMessageId('other')).toBe(0)
  })

  it('defines additive nullable attempt identity migration v45', () => {
    const db = new DatabaseCtor(':memory:')
    const table = new DeepChatMessageTracesTableCtor(db)
    db.exec(table.getMigrationSQL(13)!)
    db.prepare(
      `INSERT INTO deepchat_message_traces (
         id,
         message_id,
         session_id,
         provider_id,
         model_id,
         request_seq,
         endpoint,
         headers_json,
         body_json,
         truncated,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('legacy', 'a1', 's1', 'openai', 'gpt-4o', 1, '/responses', '{}', '{}', 0, 100)

    expect(table.getMigrationSQL(45)).toContain(
      'ALTER TABLE deepchat_message_traces ADD COLUMN logical_round INTEGER'
    )
    expect(table.getMigrationSQL(45)).toContain(
      'ALTER TABLE deepchat_message_traces ADD COLUMN physical_attempt INTEGER'
    )

    db.exec(table.getMigrationSQL(45)!)

    expect(table.listByMessageId('a1')).toEqual([
      expect.objectContaining({
        id: 'legacy',
        request_seq: 1,
        logical_round: null,
        physical_attempt: null
      })
    ])
  })

  it('adds the session append index migration', () => {
    const db = new DatabaseCtor(':memory:')
    const table = new DeepChatMessageTracesTableCtor(db)
    table.createTable()
    db.exec('DROP INDEX idx_trace_session_append')

    expect(table.getLatestVersion()).toBe(TRACE_EVIDENCE_APPEND_INDEX_SCHEMA_VERSION)
    db.exec(table.getMigrationSQL(TRACE_EVIDENCE_APPEND_INDEX_SCHEMA_VERSION!)!)
    expect(
      db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'index' AND name = 'idx_trace_session_append'`
        )
        .get()
    ).toEqual({ name: 'idx_trace_session_append' })
  })

  it('keeps append cursors monotonic when a file database connection reopens', () => {
    const directory = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-trace-cursor-'))
    const databasePath = path.join(directory, 'trace.db')
    let db = new DatabaseCtor(databasePath)
    try {
      let table = new DeepChatMessageTracesTableCtor(db)
      table.createTable()
      table.insert(baseRow({ id: 't1', messageId: 'a1', requestSeq: 1 }))
      table.insert(baseRow({ id: 't2', messageId: 'a2', requestSeq: 1 }))
      table.deleteByMessageId('a2')
      db.close()

      db = new DatabaseCtor(databasePath)
      table = new DeepChatMessageTracesTableCtor(db)
      table.insert(baseRow({ id: 't3', messageId: 'a1', requestSeq: 2 }))

      expect(
        table.listInspectorMetadata({
          sessionId: 's1',
          mode: 'newer',
          cursor: { rowId: 2 },
          limit: 10
        })
      ).toMatchObject({
        rows: [{ id: 't3', row_id: 3 }],
        appendCursorRowId: 3
      })
    } finally {
      if (db.open) db.close()
      actualFs.rmSync(directory, { recursive: true, force: true })
    }
  })
})
