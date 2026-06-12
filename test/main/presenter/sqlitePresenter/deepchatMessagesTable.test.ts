import { describe, expect, it, vi } from 'vitest'
import { DeepChatMessagesTable } from '@/presenter/sqlitePresenter/tables/deepchatMessages'

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
