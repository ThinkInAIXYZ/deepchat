import { describe, expect, it } from 'vitest'
import type { MCPServerConfig } from '@shared/presenter'

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

  it('stores MCP settings and shared agent selections', () => {
    const { db, tables } = createTables()

    tables.replaceMcpServers({
      local: {
        command: 'bunx',
        args: ['server'],
        env: {},
        type: 'stdio',
        enabled: true
      } as MCPServerConfig
    })
    tables.setMcpSetting('mcpEnabled', true)
    expect(tables.listMcpServers().local.enabled).toBe(true)
    expect(tables.getMcpSetting('mcpEnabled')).toBe(true)

    tables.setAgentMcpSelections(['local', 'remote'])
    expect(tables.getAgentMcpSelections()).toEqual(['local', 'remote'])

    db.close()
  })
})
