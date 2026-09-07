import { describe, expect, it, vi } from 'vitest'

vi.mock('better-sqlite3-multiple-ciphers', () => ({
  default: class MockDatabase {}
}))

vi.mock('../../../src/main/data/connectionConfig', () => ({
  configureSQLiteConnection: vi.fn()
}))

async function getTablesInOrder(
  rows: Array<{ name: string; sql: string | null }>,
  foreignKeys: Record<string, string[]> = {}
): Promise<string[]> {
  const { DataImporter } = await import('../../../src/main/sync/dataImporter')
  const importer = Object.create(DataImporter.prototype) as {
    sourceDb: {
      prepare: ReturnType<typeof vi.fn>
    }
    targetDb: {
      prepare: ReturnType<typeof vi.fn>
    }
    getTablesInOrder: () => string[]
  }
  importer.sourceDb = {
    prepare: vi.fn(() => ({
      all: vi.fn(() => rows)
    }))
  }
  importer.targetDb = {
    prepare: vi.fn((sql: string) => {
      const tableName = sql.match(/foreign_key_list\("([^"]+)"\)/u)?.[1] ?? ''
      return {
        all: vi.fn(() => (foreignKeys[tableName] ?? []).map((table) => ({ table })))
      }
    })
  }
  return importer.getTablesInOrder()
}

describe('DataImporter table filtering', () => {
  it('excludes FTS virtual and shadow tables', async () => {
    const rows = [
      {
        name: 'deepchat_tape_search_projection',
        sql: 'CREATE TABLE deepchat_tape_search_projection (id TEXT)'
      },
      {
        name: 'deepchat_tape_search_projection_meta',
        sql: 'CREATE TABLE deepchat_tape_search_projection_meta (id TEXT)'
      },
      {
        name: 'deepchat_tape_search_fts',
        sql: 'CREATE VIRTUAL TABLE deepchat_tape_search_fts USING fts5(search_text)'
      },
      {
        name: 'deepchat_tape_search_fts_data',
        sql: 'CREATE TABLE deepchat_tape_search_fts_data (id INTEGER)'
      },
      { name: 'messages', sql: 'CREATE TABLE messages (id TEXT)' }
    ]

    const tables = await getTablesInOrder(rows)

    expect(tables).toContain('messages')
    expect(tables).toContain('deepchat_tape_search_projection')
    expect(tables).toContain('deepchat_tape_search_projection_meta')
    expect(tables).not.toContain('deepchat_tape_search_fts')
    expect(tables).not.toContain('deepchat_tape_search_fts_data')
  })

  it('excludes tape FTS freshness metadata even when no FTS virtual table exists', async () => {
    const tables = await getTablesInOrder([
      {
        name: 'deepchat_tape_search_projection',
        sql: 'CREATE TABLE deepchat_tape_search_projection (id TEXT)'
      },
      {
        name: 'deepchat_tape_search_projection_meta',
        sql: 'CREATE TABLE deepchat_tape_search_projection_meta (id TEXT)'
      },
      {
        name: 'deepchat_tape_search_fts_meta',
        sql: 'CREATE TABLE deepchat_tape_search_fts_meta (id TEXT)'
      },
      { name: 'messages', sql: 'CREATE TABLE messages (id TEXT)' }
    ])

    expect(tables).toContain('messages')
    expect(tables).toContain('deepchat_tape_search_projection')
    expect(tables).toContain('deepchat_tape_search_projection_meta')
    expect(tables).not.toContain('deepchat_tape_search_fts_meta')
  })

  it('orders trigger-enforced delegation parents before child tables', async () => {
    const tables = await getTablesInOrder(
      [
        {
          name: 'live_delegation_events',
          sql: 'CREATE TABLE live_delegation_events (id INTEGER)'
        },
        {
          name: 'live_delegation_turns',
          sql: 'CREATE TABLE live_delegation_turns (id INTEGER)'
        },
        { name: 'live_delegations', sql: 'CREATE TABLE live_delegations (id INTEGER)' },
        { name: 'new_sessions', sql: 'CREATE TABLE new_sessions (id TEXT)' }
      ],
      {
        live_delegation_turns: ['live_delegations'],
        live_delegation_events: ['live_delegations', 'live_delegation_turns']
      }
    )

    expect(tables).toEqual([
      'new_sessions',
      'live_delegations',
      'live_delegation_turns',
      'live_delegation_events'
    ])
  })
})
