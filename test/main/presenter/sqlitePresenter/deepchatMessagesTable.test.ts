import { describe, expect, it, vi } from 'vitest'
import { DeepChatMessagesTable } from '@/presenter/sqlitePresenter/tables/deepchatMessages'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const Database = sqliteModule?.default
const DatabaseCtor = Database!

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

function createMessageRow(orderSeq: number) {
  return {
    id: `m${orderSeq}`,
    session_id: 's1',
    order_seq: orderSeq,
    role: 'user' as const,
    content: '{}',
    status: 'sent' as const,
    is_context_edge: 0,
    metadata: '{}',
    created_at: orderSeq,
    updated_at: orderSeq,
    trace_count: 0
  }
}

function createMockDb(rows: ReturnType<typeof createMessageRow>[]) {
  return {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('FROM deepchat_messages m') && sql.includes('ORDER BY m.order_seq DESC')) {
        return {
          all: (
            _sessionId: string,
            _orderSeqOrLimit: number,
            _maybeOrderSeq?: number,
            _maybeId?: string,
            limit?: number
          ) => {
            const cursorOrderSeq = sql.includes('m.order_seq < ?')
              ? (_orderSeqOrLimit as number)
              : null
            const cursorId = sql.includes('m.order_seq < ?') ? (_maybeId as string) : null

            const filtered = rows
              .filter((row) => {
                if (cursorOrderSeq === null || cursorId === null) {
                  return true
                }
                return (
                  row.order_seq < cursorOrderSeq ||
                  (row.order_seq === cursorOrderSeq && row.id < cursorId)
                )
              })
              .sort(
                (left, right) => right.order_seq - left.order_seq || right.id.localeCompare(left.id)
              )

            return filtered.slice(0, limit ?? _orderSeqOrLimit)
          }
        }
      }

      return {
        all: vi.fn(),
        get: vi.fn()
      }
    }),
    exec: vi.fn()
  } as any
}

describe('DeepChatMessagesTable', () => {
  it('allows fetching 501 rows for hasMore detection when the requested page size is 500', () => {
    const rows = Array.from({ length: 502 }, (_, index) => createMessageRow(index + 1))
    const db = createMockDb(rows)
    const table = new DeepChatMessagesTable(db)

    const page = table.listPageBySession('s1', { limit: 501 })

    expect(page).toHaveLength(501)
    expect(page[0]?.order_seq).toBe(502)
    expect(page[500]?.order_seq).toBe(2)
  })
})

describeIfSqlite('DeepChatMessagesTable queries', () => {
  function createTable() {
    const db = new DatabaseCtor(':memory:')
    const table = new DeepChatMessagesTable(db)
    table.createTable()
    db.exec('CREATE TABLE deepchat_message_traces (message_id TEXT NOT NULL)')
    return { db, table }
  }

  it('distinguishes empty and non-empty sessions', () => {
    const { db, table } = createTable()

    expect(table.hasBySession('s1')).toBe(false)
    table.insert({
      id: 'm1',
      sessionId: 's1',
      orderSeq: 1,
      role: 'user',
      content: '{}',
      status: 'sent'
    })
    expect(table.hasBySession('s1')).toBe(true)
    expect(table.hasBySession('s2')).toBe(false)

    db.close()
  })

  it('uses the session index without scanning message rows', () => {
    const { db } = createTable()
    const plan = (
      db
        .prepare('EXPLAIN QUERY PLAN SELECT 1 FROM deepchat_messages WHERE session_id = ? LIMIT 1')
        .all('s1') as Array<{ detail: string }>
    )
      .map((row) => row.detail)
      .join('\n')

    expect(plan).toMatch(
      /SEARCH deepchat_messages USING COVERING INDEX idx_deepchat_messages_session/i
    )
    expect(plan).not.toMatch(/\bSCAN deepchat_messages\b/i)

    db.close()
  })

  it('keeps runtime history trace-free while rich history returns the real count', () => {
    const { db, table } = createTable()
    table.insert({
      id: 'm1',
      sessionId: 's1',
      orderSeq: 1,
      role: 'user',
      content: '{}',
      status: 'sent'
    })
    db.prepare('INSERT INTO deepchat_message_traces (message_id) VALUES (?)').run('m1')
    db.prepare('INSERT INTO deepchat_message_traces (message_id) VALUES (?)').run('m1')

    expect(table.getBySessionForRuntime('s1')).toMatchObject([{ id: 'm1', trace_count: 0 }])
    expect(table.getBySession('s1')).toMatchObject([{ id: 'm1', trace_count: 2 }])

    const runtimePlan = (
      db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT m.*, 0 AS trace_count
           FROM deepchat_messages m
           WHERE m.session_id = ?
           ORDER BY m.order_seq`
        )
        .all('s1') as Array<{ detail: string }>
    )
      .map((row) => row.detail)
      .join('\n')

    expect(runtimePlan).not.toMatch(/deepchat_message_traces/i)
    expect(runtimePlan).not.toMatch(/MATERIALIZE t/i)
    expect(runtimePlan).toMatch(/idx_deepchat_messages_session/i)

    db.close()
  })
})
