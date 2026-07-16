import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import type { MCPServerConfig } from '@shared/presenter'

type SettingsRow = {
  key: string
  value_json: string
  sensitive?: number
  updated_at: number
}

type McpServerRow = {
  name: string
  config_json: string
  sort_order: number
  created_at: number
  updated_at: number
}

const CONFIG_STORAGE_MIGRATION_ID = 'config-presenter-sqlite-v1'
const SHARED_AGENT_MCP_SELECTION_ID = '__shared__'

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

export class SettingsTables extends BaseTable {
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

      CREATE TABLE IF NOT EXISTS agent_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        sensitive INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_mcp_selections (
        agent_id TEXT NOT NULL,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        mcp_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (agent_id, is_builtin, mcp_id)
      );

      CREATE TABLE IF NOT EXISTS config_migrations (
        id TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `
  }

  getMigrationSQL(version: number): string | null {
    if (version === 25) return this.getCreateTableSQL()
    if (version === 26) {
      return `
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          sensitive INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        );
      `
    }
    return null
  }

  getLatestVersion(): number {
    return 26
  }

  hasConfigMigration(id = CONFIG_STORAGE_MIGRATION_ID): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM config_migrations WHERE id = ?').get(id))
  }

  markConfigMigrationApplied(id = CONFIG_STORAGE_MIGRATION_ID): void {
    this.db
      .prepare(
        `INSERT INTO config_migrations (id, applied_at)
         VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET applied_at = excluded.applied_at`
      )
      .run(id, now())
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
      this.db.exec('DELETE FROM mcp_servers')
      Object.entries(servers).forEach(([name, config], index) => {
        this.upsertMcpServer(name, config, index)
      })
    })()
  }

  getMcpSetting<TValue = unknown>(key: string): TValue | undefined {
    return this.getJsonSetting<TValue>('mcp_settings', key)
  }

  setMcpSetting(key: string, value: unknown): void {
    this.setJsonSetting('mcp_settings', key, value)
  }

  deleteMcpSetting(key: string): void {
    this.deleteJsonSetting('mcp_settings', key)
  }

  clearMcpSettings(): void {
    this.db.exec('DELETE FROM mcp_settings')
  }

  listMcpSettings(): Record<string, unknown> {
    return this.listJsonSettings('mcp_settings')
  }

  getAgentSetting<TValue = unknown>(key: string): TValue | undefined {
    return this.getJsonSetting<TValue>('agent_settings', key)
  }

  setAgentSetting(key: string, value: unknown): void {
    this.setJsonSetting('agent_settings', key, value)
  }

  deleteAgentSetting(key: string): void {
    this.deleteJsonSetting('agent_settings', key)
  }

  clearAgentSettings(): void {
    this.db.exec('DELETE FROM agent_settings')
  }

  listAgentSettings(): Record<string, unknown> {
    return this.listJsonSettings('agent_settings')
  }

  getAppSetting<TValue = unknown>(key: string): TValue | undefined {
    return this.getJsonSetting<TValue>('app_settings', key)
  }

  setAppSetting(key: string, value: unknown, sensitive = true): void {
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value_json, sensitive, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           sensitive = excluded.sensitive,
           updated_at = excluded.updated_at`
      )
      .run(key, stringifyJson(value), sensitive ? 1 : 0, now())
  }

  deleteAppSetting(key: string): void {
    this.deleteJsonSetting('app_settings', key)
  }

  hasAppSetting(key: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(key))
  }

  listAppSettings(): Record<string, unknown> {
    return this.listJsonSettings('app_settings')
  }

  getAgentMcpSelections(agentId = SHARED_AGENT_MCP_SELECTION_ID, isBuiltin = false): string[] {
    const rows = this.db
      .prepare(
        `SELECT mcp_id FROM agent_mcp_selections
         WHERE agent_id = ? AND is_builtin = ?
         ORDER BY sort_order ASC`
      )
      .all(agentId, isBuiltin ? 1 : 0) as Array<{ mcp_id: string }>
    return rows.map((row) => row.mcp_id)
  }

  setAgentMcpSelections(
    selections: string[],
    agentId = SHARED_AGENT_MCP_SELECTION_ID,
    isBuiltin = false
  ): void {
    const uniqueSelections = Array.from(new Set(selections.filter(Boolean)))
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM agent_mcp_selections WHERE agent_id = ? AND is_builtin = ?')
        .run(agentId, isBuiltin ? 1 : 0)
      uniqueSelections.forEach((mcpId, index) => {
        this.db
          .prepare(
            `INSERT INTO agent_mcp_selections (agent_id, is_builtin, mcp_id, sort_order)
             VALUES (?, ?, ?, ?)`
          )
          .run(agentId, isBuiltin ? 1 : 0, mcpId, index)
      })
    })()
  }

  clearAgentMcpSelections(): void {
    this.db.exec('DELETE FROM agent_mcp_selections')
  }

  runInTransaction(fn: () => void): void {
    this.db.transaction(fn)()
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

  private getJsonSetting<TValue = unknown>(
    table: 'mcp_settings' | 'agent_settings' | 'app_settings',
    key: string
  ): TValue | undefined {
    const row = this.db.prepare(`SELECT value_json FROM ${table} WHERE key = ?`).get(key) as
      | SettingsRow
      | undefined
    return row ? parseJson<TValue | undefined>(row.value_json, undefined) : undefined
  }

  private setJsonSetting(
    table: 'mcp_settings' | 'agent_settings' | 'app_settings',
    key: string,
    value: unknown
  ): void {
    this.db
      .prepare(
        `INSERT INTO ${table} (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`
      )
      .run(key, stringifyJson(value), now())
  }

  private deleteJsonSetting(
    table: 'mcp_settings' | 'agent_settings' | 'app_settings',
    key: string
  ): void {
    this.db.prepare(`DELETE FROM ${table} WHERE key = ?`).run(key)
  }

  private listJsonSettings(
    table: 'mcp_settings' | 'agent_settings' | 'app_settings'
  ): Record<string, unknown> {
    const rows = this.db.prepare(`SELECT key, value_json FROM ${table}`).all() as SettingsRow[]
    return Object.fromEntries(rows.map((row) => [row.key, parseJson(row.value_json, null)]))
  }
}

export { CONFIG_STORAGE_MIGRATION_ID, SHARED_AGENT_MCP_SELECTION_ID }
