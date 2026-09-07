import { describe, expect, it } from 'vitest'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const appSettingsTableModule = sqliteModule
  ? await import('@/settings/data/tables/appSettingsTable')
  : null

const Database = sqliteModule?.default
const AppSettingsTable = appSettingsTableModule?.AppSettingsTable
const DatabaseCtor = Database!
const AppSettingsTableCtor = AppSettingsTable!

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

describeIfSqlite('AppSettingsTable storage', () => {
  const createTables = () => {
    const db = new DatabaseCtor(':memory:')
    const tables = new AppSettingsTableCtor(db)
    tables.createTable()
    return { db, tables }
  }

  it('stores app settings', () => {
    const { db, tables } = createTables()

    tables.setAppSetting('customPrompts', [{ id: 'prompt' }], true)
    expect(tables.getAppSetting('customPrompts')).toEqual([{ id: 'prompt' }])

    db.close()
  })
})
