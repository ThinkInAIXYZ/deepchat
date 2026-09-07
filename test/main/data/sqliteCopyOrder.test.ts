import { describe, expect, it, vi } from 'vitest'
import { orderSqliteTablesForCopy } from '@/data/sqliteCopyOrder'

function createDatabase(foreignKeys: Record<string, string[]>) {
  return {
    prepare: vi.fn((sql: string) => {
      const match = sql.match(/foreign_key_list\("([^"]+)"\)/u)
      const tableName = match?.[1] ?? ''
      return {
        all: vi.fn(() => (foreignKeys[tableName] ?? []).map((table) => ({ table })))
      }
    })
  }
}

describe('SQLite copy ordering', () => {
  it('orders foreign-key and trigger-enforced parents before children', () => {
    const database = createDatabase({
      messages: ['conversations'],
      attachments: ['messages'],
      message_attachments: ['messages'],
      live_delegation_turns: ['live_delegations'],
      live_delegation_events: ['live_delegations', 'live_delegation_turns']
    })
    const tables = [
      'messages',
      'live_delegation_turns',
      'new_sessions',
      'message_attachments',
      'live_delegation_events',
      'conversations',
      'live_delegations',
      'attachments'
    ].map((name) => ({ name }))

    expect(orderSqliteTablesForCopy(database as never, tables).map((table) => table.name)).toEqual([
      'conversations',
      'messages',
      'attachments',
      'message_attachments',
      'new_sessions',
      'live_delegations',
      'live_delegation_turns',
      'live_delegation_events'
    ])
  })

  it('rejects cyclic immediate dependencies instead of using an unsafe fallback', () => {
    const database = createDatabase({ left: ['right'], right: ['left'] })

    expect(() =>
      orderSqliteTablesForCopy(database as never, [{ name: 'left' }, { name: 'right' }])
    ).toThrow('Cyclic SQLite copy dependencies: left, right')
  })
})
