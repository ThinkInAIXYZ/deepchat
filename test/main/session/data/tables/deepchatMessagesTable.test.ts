import { describe, expect, it, vi } from 'vitest'
import { DeepChatMessagesTable } from '@/session/data/tables/deepchatMessages'
import { DeepChatMessageTracesTable } from '@/session/data/tables/deepchatMessageTraces'
import { Database, nativeSqliteDescribeIf } from '../../../nativeSqliteHarness'

const DatabaseCtor = Database!
const describeIfNativeSqlite = nativeSqliteDescribeIf()

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

describeIfNativeSqlite('DeepChatMessagesTable runtime projection', () => {
  function createTable() {
    const db = new DatabaseCtor(':memory:')
    const table = new DeepChatMessagesTable(db)
    table.createTable()
    return { db, table }
  }

  it('distinguishes empty and non-empty sessions', () => {
    const { db, table } = createTable()
    try {
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
    } finally {
      db.close()
    }
  })

  it('loads ordered runtime history without the trace table', () => {
    const { db, table } = createTable()
    try {
      table.insert({
        id: 'm2',
        sessionId: 's1',
        orderSeq: 2,
        role: 'assistant',
        content: '[]',
        status: 'sent'
      })
      table.insert({
        id: 'other',
        sessionId: 's2',
        orderSeq: 1,
        role: 'user',
        content: '{}',
        status: 'sent'
      })
      table.insert({
        id: 'm1',
        sessionId: 's1',
        orderSeq: 1,
        role: 'user',
        content: '{}',
        status: 'sent'
      })

      const rows = table.getBySession('s1')

      expect(rows.map((row) => row.id)).toEqual(['m1', 'm2'])
      expect(rows.every((row) => row.trace_count === undefined)).toBe(true)
      expect(table.get('m1')?.trace_count).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it('keeps trace counts on the UI pagination projection', () => {
    const { db, table } = createTable()
    try {
      const traces = new DeepChatMessageTracesTable(db)
      traces.createTable()
      table.insert({
        id: 'm1',
        sessionId: 's1',
        orderSeq: 1,
        role: 'assistant',
        content: '[]',
        status: 'sent'
      })
      for (let requestSeq = 1; requestSeq <= 2; requestSeq += 1) {
        traces.insert({
          id: `t${requestSeq}`,
          messageId: 'm1',
          sessionId: 's1',
          providerId: 'openai',
          modelId: 'gpt-4o',
          requestSeq,
          endpoint: 'https://api.openai.test/v1/responses',
          headersJson: '{}',
          bodyJson: '{}',
          truncated: false
        })
      }

      expect(table.listPageBySession('s1', { limit: 100 })[0]?.trace_count).toBe(2)
    } finally {
      db.close()
    }
  })

  it('uses the existing session index', () => {
    const { db } = createTable()
    try {
      const plan = db
        .prepare(
          'EXPLAIN QUERY PLAN SELECT * FROM deepchat_messages WHERE session_id = ? ORDER BY order_seq'
        )
        .all('s1') as Array<{ detail: string }>

      expect(plan.some((row) => /idx_deepchat_messages_session/i.test(row.detail))).toBe(true)
      expect(plan.some((row) => /\bSCAN deepchat_messages\b/i.test(row.detail))).toBe(false)
      expect(plan.some((row) => /deepchat_message_traces|materialize/i.test(row.detail))).toBe(
        false
      )
    } finally {
      db.close()
    }
  })
})
