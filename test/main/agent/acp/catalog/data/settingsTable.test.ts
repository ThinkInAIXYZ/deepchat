import { describe, expect, it } from 'vitest'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const tableModule = sqliteModule ? await import('@/agent/acp/catalog/data/settingsTable') : null

const Database = sqliteModule?.default
const AgentCatalogSettingsTable = tableModule?.AgentCatalogSettingsTable
const DatabaseCtor = Database!
const AgentCatalogSettingsTableCtor = AgentCatalogSettingsTable!

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

describeIfSqlite('AgentCatalogSettingsTable', () => {
  it('stores Agent settings and shared MCP selections', () => {
    const db = new DatabaseCtor(':memory:')
    const table = new AgentCatalogSettingsTableCtor(db)
    table.createTable()

    table.setAgentSetting('enabled', true)
    table.setAgentMcpSelections(['local', 'remote'])

    expect(table.getAgentSetting('enabled')).toBe(true)
    expect(table.getAgentMcpSelections()).toEqual(['local', 'remote'])

    db.close()
  })
})
