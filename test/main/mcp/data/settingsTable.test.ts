import { describe, expect, it } from 'vitest'
import type { MCPServerConfig } from '@shared/types/mcp'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const tableModule = sqliteModule ? await import('@/mcp/data/settingsTable') : null

const Database = sqliteModule?.default
const McpSettingsTable = tableModule?.McpSettingsTable
const DatabaseCtor = Database!
const McpSettingsTableCtor = McpSettingsTable!

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

describeIfSqlite('McpSettingsTable', () => {
  it('stores MCP servers and settings', () => {
    const db = new DatabaseCtor(':memory:')
    const table = new McpSettingsTableCtor(db)
    table.createTable()

    table.replaceMcpServers({
      local: {
        command: 'bunx',
        args: ['server'],
        env: {},
        type: 'stdio',
        enabled: true
      } as MCPServerConfig
    })
    table.setMcpSetting('mcpEnabled', true)

    expect(table.listMcpServers().local.enabled).toBe(true)
    expect(table.getMcpSetting('mcpEnabled')).toBe(true)

    db.close()
  })
})
