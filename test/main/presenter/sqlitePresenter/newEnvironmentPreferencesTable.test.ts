import { afterEach, beforeEach, describe, expect, it } from 'vitest'
const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const tableModule = sqliteModule
  ? await import('@/presenter/sqlitePresenter/tables/newEnvironmentPreferences').catch(() => null)
  : null
const Database = sqliteModule?.default
const NewEnvironmentPreferencesTable = tableModule?.NewEnvironmentPreferencesTable
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
const DatabaseCtor = Database!
const NewEnvironmentPreferencesTableCtor = NewEnvironmentPreferencesTable!
const describeIfSqlite =
  sqliteAvailable && NewEnvironmentPreferencesTable ? describe : describe.skip

describeIfSqlite('NewEnvironmentPreferencesTable', () => {
  let db: InstanceType<typeof DatabaseCtor> | null
  let table: InstanceType<typeof NewEnvironmentPreferencesTableCtor>

  beforeEach(() => {
    db = new DatabaseCtor(':memory:')
    table = new NewEnvironmentPreferencesTableCtor(db)
    table.createTable()
  })

  afterEach(() => {
    db?.close()
    db = null
  })

  it('stores dense active order and ignores duplicate paths', () => {
    table.reorderActive(['/work/b', '/work/a', '/work/b'])

    expect(
      table
        .list()
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((row) => ({
          path: row.path,
          status: row.status,
          sort_order: row.sort_order
        }))
    ).toEqual([
      {
        path: '/work/b',
        status: 'active',
        sort_order: 0
      },
      {
        path: '/work/a',
        status: 'active',
        sort_order: 1
      }
    ])
  })

  it('does not move archived or removed paths back to active when reordered', () => {
    table.markArchived('/work/a')
    table.markRemoved('/work/b')

    table.reorderActive(['/work/b', '/work/a'])

    expect(table.get('/work/b')).toMatchObject({
      status: 'removed',
      archived_at: null,
      removed_at: expect.any(Number)
    })
    expect(table.get('/work/a')).toMatchObject({
      status: 'archived',
      archived_at: expect.any(Number),
      removed_at: null
    })
  })

  it('records archive and remove timestamps independently', () => {
    table.markArchived('/work/archive')
    table.markRemoved('/work/remove')

    expect(table.get('/work/archive')).toMatchObject({
      status: 'archived',
      removed_at: null
    })
    expect(table.get('/work/archive')?.archived_at).toEqual(expect.any(Number))
    expect(table.get('/work/remove')).toMatchObject({
      status: 'removed',
      archived_at: null
    })
    expect(table.get('/work/remove')?.removed_at).toEqual(expect.any(Number))
  })
})
