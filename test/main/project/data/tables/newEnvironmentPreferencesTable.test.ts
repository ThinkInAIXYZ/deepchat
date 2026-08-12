import { afterEach, beforeEach, describe, expect, it } from 'vitest'
const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const tableModule = sqliteModule
  ? await import('@/project/data/tables/newEnvironmentPreferences').catch(() => null)
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

  it('reactivates one existing path without resetting its explicit order', () => {
    table.reorderActive(['/work/a', '/work/b'])
    table.markArchived('/work/a')
    table.markRemoved('/work/b')

    table.markActive('/work/a')
    table.markActive('/work/b')
    table.markActive('/work/a')

    expect(table.list()).toHaveLength(2)
    expect(table.get('/work/a')).toMatchObject({
      status: 'active',
      sort_order: 0,
      archived_at: null,
      removed_at: null
    })
    expect(table.get('/work/b')).toMatchObject({
      status: 'active',
      sort_order: 1,
      archived_at: null,
      removed_at: null
    })
  })

  it('atomically prepends newly active paths without moving an active duplicate', () => {
    table.reorderActive(['/work/a', '/work/b'])

    table.activateAtTop('/work/new')
    expect(table.get('/work/new')).toMatchObject({ status: 'active', sort_order: 0 })
    expect(table.get('/work/a')).toMatchObject({ status: 'active', sort_order: 1 })
    expect(table.get('/work/b')).toMatchObject({ status: 'active', sort_order: 2 })

    table.activateAtTop('/work/newer')
    expect(table.get('/work/newer')).toMatchObject({ status: 'active', sort_order: 0 })
    expect(table.get('/work/new')).toMatchObject({ status: 'active', sort_order: 1 })
    expect(table.get('/work/a')).toMatchObject({ status: 'active', sort_order: 2 })
    expect(table.get('/work/b')).toMatchObject({ status: 'active', sort_order: 3 })

    table.activateAtTop('/work/b')
    expect(table.get('/work/b')).toMatchObject({ status: 'active', sort_order: 3 })
    expect(table.get('/work/newer')).toMatchObject({ status: 'active', sort_order: 0 })

    table.markArchived('/work/a')
    table.activateAtTop('/work/a')
    expect(table.get('/work/a')).toMatchObject({
      status: 'active',
      sort_order: 0,
      archived_at: null,
      removed_at: null
    })
    expect(
      table
        .list()
        .filter((row) => row.status === 'active')
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((row) => row.path)
    ).toEqual(['/work/a', '/work/newer', '/work/new', '/work/b'])
  })

  it('rolls back order shifts when prepending fails', () => {
    table.reorderActive(['/work/a', '/work/b'])
    db!.exec(`
      CREATE TRIGGER fail_environment_prepend
      BEFORE INSERT ON new_environment_preferences
      WHEN NEW.path = '/work/fail'
      BEGIN
        SELECT RAISE(ABORT, 'injected prepend failure');
      END;
    `)

    expect(() => table.activateAtTop('/work/fail')).toThrow('injected prepend failure')
    expect(
      table
        .list()
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((row) => ({ path: row.path, sort_order: row.sort_order }))
    ).toEqual([
      { path: '/work/a', sort_order: 0 },
      { path: '/work/b', sort_order: 1 }
    ])
  })
})
