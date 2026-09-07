import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'

type AgentSettingRow = {
  key: string
  value_json: string
}

export const SHARED_AGENT_MCP_SELECTION_ID = '__shared__'

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

export class AgentCatalogSettingsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'agent_settings')
  }

  override createTable(): void {
    this.db.exec(this.getCreateTableSQL())
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS agent_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_mcp_selections (
        agent_id TEXT NOT NULL,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        mcp_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (agent_id, is_builtin, mcp_id)
      );
    `
  }

  getMigrationSQL(version: number): string | null {
    return version === 25 ? this.getCreateTableSQL() : null
  }

  getLatestVersion(): number {
    return 25
  }

  getAgentSetting<TValue = unknown>(key: string): TValue | undefined {
    const row = this.db.prepare('SELECT value_json FROM agent_settings WHERE key = ?').get(key) as
      | AgentSettingRow
      | undefined
    return row ? parseJson<TValue | undefined>(row.value_json, undefined) : undefined
  }

  setAgentSetting(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO agent_settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`
      )
      .run(key, stringifyJson(value), now())
  }

  deleteAgentSetting(key: string): void {
    this.db.prepare('DELETE FROM agent_settings WHERE key = ?').run(key)
  }

  clearAgentSettings(): void {
    this.db.exec('DELETE FROM agent_settings')
  }

  listAgentSettings(): Record<string, unknown> {
    const rows = this.db
      .prepare('SELECT key, value_json FROM agent_settings')
      .all() as AgentSettingRow[]
    return Object.fromEntries(rows.map((row) => [row.key, parseJson(row.value_json, null)]))
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
}
