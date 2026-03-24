import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export interface AgentRow {
  id: string
  agent_type: 'deepchat' | 'acp'
  source: 'builtin' | 'manual' | 'registry'
  name: string
  enabled: number
  protected: number
  description: string | null
  icon: string | null
  avatar_json: string | null
  config_json: string | null
  state_json: string | null
  created_at: number
  updated_at: number
}

type AgentCreateInput = {
  id: string
  agentType: AgentRow['agent_type']
  source: AgentRow['source']
  name: string
  enabled?: boolean
  protected?: boolean
  description?: string | null
  icon?: string | null
  avatarJson?: string | null
  configJson?: string | null
  stateJson?: string | null
  createdAt?: number
  updatedAt?: number
}

type AgentUpdateInput = Partial<{
  name: string
  enabled: boolean
  protected: boolean
  description: string | null
  icon: string | null
  avatarJson: string | null
  configJson: string | null
  stateJson: string | null
}>

export class AgentsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'agents')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        agent_type TEXT NOT NULL,
        source TEXT NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        protected INTEGER NOT NULL DEFAULT 0,
        description TEXT,
        icon TEXT,
        avatar_json TEXT,
        config_json TEXT,
        state_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(agent_type);
      CREATE INDEX IF NOT EXISTS idx_agents_enabled ON agents(enabled);
    `
  }

  getMigrationSQL(version: number): string | null {
    if (version === 20) {
      return this.getCreateTableSQL()
    }
    return null
  }

  getLatestVersion(): number {
    return 20
  }

  create(input: AgentCreateInput): void {
    const now = Date.now()
    const createdAt = input.createdAt ?? now
    const updatedAt = input.updatedAt ?? createdAt
    this.db
      .prepare(
        `INSERT INTO agents (
          id,
          agent_type,
          source,
          name,
          enabled,
          protected,
          description,
          icon,
          avatar_json,
          config_json,
          state_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.agentType,
        input.source,
        input.name,
        input.enabled === false ? 0 : 1,
        input.protected ? 1 : 0,
        input.description ?? null,
        input.icon ?? null,
        input.avatarJson ?? null,
        input.configJson ?? null,
        input.stateJson ?? null,
        createdAt,
        updatedAt
      )
  }

  upsert(input: AgentCreateInput): void {
    const now = Date.now()
    const createdAt = input.createdAt ?? now
    const updatedAt = input.updatedAt ?? now
    this.db
      .prepare(
        `INSERT INTO agents (
          id,
          agent_type,
          source,
          name,
          enabled,
          protected,
          description,
          icon,
          avatar_json,
          config_json,
          state_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          agent_type = excluded.agent_type,
          source = excluded.source,
          name = excluded.name,
          enabled = excluded.enabled,
          protected = excluded.protected,
          description = excluded.description,
          icon = excluded.icon,
          avatar_json = excluded.avatar_json,
          config_json = excluded.config_json,
          state_json = excluded.state_json,
          updated_at = excluded.updated_at`
      )
      .run(
        input.id,
        input.agentType,
        input.source,
        input.name,
        input.enabled === false ? 0 : 1,
        input.protected ? 1 : 0,
        input.description ?? null,
        input.icon ?? null,
        input.avatarJson ?? null,
        input.configJson ?? null,
        input.stateJson ?? null,
        createdAt,
        updatedAt
      )
  }

  get(id: string): AgentRow | undefined {
    return this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined
  }

  list(filters?: {
    agentType?: AgentRow['agent_type']
    source?: AgentRow['source']
    enabled?: boolean
  }): AgentRow[] {
    let sql = 'SELECT * FROM agents'
    const conditions: string[] = []
    const params: unknown[] = []

    if (filters?.agentType) {
      conditions.push('agent_type = ?')
      params.push(filters.agentType)
    }

    if (filters?.source) {
      conditions.push('source = ?')
      params.push(filters.source)
    }

    if (typeof filters?.enabled === 'boolean') {
      conditions.push('enabled = ?')
      params.push(filters.enabled ? 1 : 0)
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`
    }

    sql += ' ORDER BY protected DESC, updated_at DESC, created_at ASC'
    return this.db.prepare(sql).all(...params) as AgentRow[]
  }

  update(id: string, input: AgentUpdateInput): void {
    const updates: string[] = []
    const params: unknown[] = []

    if (Object.prototype.hasOwnProperty.call(input, 'name')) {
      updates.push('name = ?')
      params.push(input.name)
    }
    if (Object.prototype.hasOwnProperty.call(input, 'enabled')) {
      updates.push('enabled = ?')
      params.push(input.enabled ? 1 : 0)
    }
    if (Object.prototype.hasOwnProperty.call(input, 'protected')) {
      updates.push('protected = ?')
      params.push(input.protected ? 1 : 0)
    }
    if (Object.prototype.hasOwnProperty.call(input, 'description')) {
      updates.push('description = ?')
      params.push(input.description ?? null)
    }
    if (Object.prototype.hasOwnProperty.call(input, 'icon')) {
      updates.push('icon = ?')
      params.push(input.icon ?? null)
    }
    if (Object.prototype.hasOwnProperty.call(input, 'avatarJson')) {
      updates.push('avatar_json = ?')
      params.push(input.avatarJson ?? null)
    }
    if (Object.prototype.hasOwnProperty.call(input, 'configJson')) {
      updates.push('config_json = ?')
      params.push(input.configJson ?? null)
    }
    if (Object.prototype.hasOwnProperty.call(input, 'stateJson')) {
      updates.push('state_json = ?')
      params.push(input.stateJson ?? null)
    }

    if (updates.length === 0) {
      return
    }

    updates.push('updated_at = ?')
    params.push(Date.now())
    params.push(id)

    this.db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM agents WHERE id = ?').run(id)
  }
}
