import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import type { MCPServerConfig } from '@shared/types/mcp'

type McpServerRow = {
  name: string
  config_json: string
  sort_order: number
  created_at: number
  updated_at: number
}

type McpSettingRow = {
  key: string
  value_json: string
}

const parseJson = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback

  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const stringifyJson = (value: unknown): string => JSON.stringify(value ?? null)
const now = (): number => Date.now()

export class McpSettingsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'mcp_servers')
  }

  override createTable(): void {
    this.db.exec(this.getCreateTableSQL())
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS mcp_servers (
        name TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mcp_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `
  }

  getMigrationSQL(version: number): string | null {
    return version === 25 ? this.getCreateTableSQL() : null
  }

  getLatestVersion(): number {
    return 25
  }

  listMcpServers(): Record<string, MCPServerConfig> {
    const rows = this.db
      .prepare('SELECT * FROM mcp_servers ORDER BY sort_order ASC, created_at ASC')
      .all() as McpServerRow[]
    return Object.fromEntries(
      rows.map((row) => [
        row.name,
        parseJson<MCPServerConfig>(row.config_json, {} as MCPServerConfig)
      ])
    )
  }

  replaceMcpServers(servers: Record<string, MCPServerConfig>): void {
    this.db.transaction(() => {
      this.replaceMcpServersInCurrentTransaction(servers)
    })()
  }

  setRouterApiKeyAndServers(apiKey: string, servers?: Record<string, MCPServerConfig>): void {
    this.db.transaction(() => {
      this.setMcpSetting('mcprouterApiKey', apiKey)
      if (servers) {
        this.replaceMcpServersInCurrentTransaction(servers)
      }
    })()
  }

  getMcpSetting<TValue = unknown>(key: string): TValue | undefined {
    const row = this.db.prepare('SELECT value_json FROM mcp_settings WHERE key = ?').get(key) as
      | McpSettingRow
      | undefined
    return row ? parseJson<TValue | undefined>(row.value_json, undefined) : undefined
  }

  setMcpSetting(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO mcp_settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`
      )
      .run(key, stringifyJson(value), now())
  }

  deleteMcpSetting(key: string): void {
    this.db.prepare('DELETE FROM mcp_settings WHERE key = ?').run(key)
  }

  clearMcpSettings(): void {
    this.db.exec('DELETE FROM mcp_settings')
  }

  listMcpSettings(): Record<string, unknown> {
    const rows = this.db
      .prepare('SELECT key, value_json FROM mcp_settings')
      .all() as McpSettingRow[]
    return Object.fromEntries(rows.map((row) => [row.key, parseJson(row.value_json, null)]))
  }

  private upsertMcpServer(name: string, config: MCPServerConfig, sortOrder: number): void {
    const timestamp = now()
    const existing = this.db
      .prepare('SELECT created_at FROM mcp_servers WHERE name = ?')
      .get(name) as { created_at: number } | undefined
    this.db
      .prepare(
        `INSERT INTO mcp_servers (name, config_json, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           config_json = excluded.config_json,
           sort_order = excluded.sort_order,
           updated_at = excluded.updated_at`
      )
      .run(name, stringifyJson(config), sortOrder, existing?.created_at ?? timestamp, timestamp)
  }

  private replaceMcpServersInCurrentTransaction(servers: Record<string, MCPServerConfig>): void {
    this.db.exec('DELETE FROM mcp_servers')
    Object.entries(servers).forEach(([name, config], index) => {
      this.upsertMcpServer(name, config, index)
    })
  }
}
