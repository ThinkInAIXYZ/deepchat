import { describe, expect, it } from 'vitest'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const tableModule = sqliteModule
  ? await import('../../../../src/main/presenter/sqlitePresenter/tables/deepchatMessageTraces')
  : null

const Database = sqliteModule?.default
const DeepChatMessageTracesTable = tableModule?.DeepChatMessageTracesTable
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
    expect(table.listByMessageId('a1')[0].request_seq).toBe(5)
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
})
