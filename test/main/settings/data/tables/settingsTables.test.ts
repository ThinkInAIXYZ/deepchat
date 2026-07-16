import { describe, expect, it } from 'vitest'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const settingsTablesModule = sqliteModule
  ? await import('@/settings/data/tables/settingsTables')
  : null

const Database = sqliteModule?.default
const SettingsTables = settingsTablesModule?.SettingsTables
const DatabaseCtor = Database!
const SettingsTablesCtor = SettingsTables!

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

describeIfSqlite('SettingsTables', () => {
  const createTables = () => {
    const db = new DatabaseCtor(':memory:')
    const tables = new SettingsTablesCtor(db)
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
