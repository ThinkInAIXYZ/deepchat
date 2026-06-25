import { describe, expect, it, vi } from 'vitest'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const tableModule = sqliteModule
  ? await import('@/presenter/sqlitePresenter/tables/settingsActivity').catch(() => null)
  : null

const Database = sqliteModule?.default
const SettingsActivityTable = tableModule?.SettingsActivityTable
const DatabaseCtor = Database!
const SettingsActivityTableCtor = SettingsActivityTable!

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

const describeIfSqlite = sqliteAvailable && SettingsActivityTable ? describe : describe.skip

describeIfSqlite('SettingsActivityTable', () => {
  it('lists newest records first and caps list requests at 200', () => {
    const db = new DatabaseCtor(':memory:')
    vi.useFakeTimers()
    try {
      const table = new SettingsActivityTableCtor(db)
      table.createTable()

      const baseTime = 1_700_000_000_000
      for (let index = 0; index < 210; index += 1) {
        vi.setSystemTime(baseTime + index)
        table.record({
          category: 'provider',
          action: 'updated',
          targetType: 'provider',
          targetId: `provider-${index}`,
          targetLabel: `Provider ${index}`,
          routeName: 'settings-provider',
          summaryKey: 'settings.controlCenter.activity.providerUpdated',
          summaryParams: {
            name: `Provider ${index}`
          }
        })
      }

      const records = table.list(500)

      expect(records).toHaveLength(200)
      expect(records[0]?.targetLabel).toBe('Provider 209')
      expect(records.at(-1)?.targetLabel).toBe('Provider 10')
    } finally {
      vi.useRealTimers()
      db.close()
    }
  })

  it('retains only the newest 2000 rows', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new SettingsActivityTableCtor(db)
      table.createTable()

      for (let index = 0; index < 2005; index += 1) {
        table.record({
          category: 'mcp',
          action: 'updated',
          targetType: 'mcp-server',
          targetId: `server-${index}`,
          targetLabel: `Server ${index}`,
          routeName: 'settings-mcp',
          summaryKey: 'settings.controlCenter.activity.mcpServerUpdated',
          summaryParams: {
            name: `Server ${index}`
          }
        })
      }

      const count = db.prepare('SELECT COUNT(*) as count FROM settings_activity').get() as {
        count: number
      }

      expect(count.count).toBe(2000)
    } finally {
      db.close()
    }
  })
})
