import { describe, expect, it, vi } from 'vitest'

vi.mock('better-sqlite3-multiple-ciphers', () => ({
  default: class MockDatabase {}
}))

vi.mock('../../../../src/main/presenter/sqlitePresenter/connectionConfig', () => ({
  configureSQLiteConnection: vi.fn()
}))

async function getTablesInOrder(
  rows: Array<{ name: string; sql: string | null }>
): Promise<string[]> {
  const { DataImporter } = await import('../../../../src/main/presenter/sqlitePresenter/importData')
  const importer = Object.create(DataImporter.prototype) as {
    sourceDb: {
      prepare: ReturnType<typeof vi.fn>
    }
    getTablesInOrder: () => string[]
  }
  importer.sourceDb = {
    prepare: vi.fn(() => ({
      all: vi.fn(() => rows)
    }))
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
})
