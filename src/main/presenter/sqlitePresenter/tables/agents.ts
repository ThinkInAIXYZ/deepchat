import { BaseTable } from './baseTable'
import type Database from 'better-sqlite3-multiple-ciphers'
import { nanoid } from 'nanoid'
import type {
  Agent,
  AgentType,
  TemplateAgent,
  AcpAgent,
  AcpAgentProfile,
  CreateAgentParams,
  UpdateAgentParams
} from '@shared/presenter'
import type { AcpBuiltinAgentId } from '@shared/types/presenters/legacy.presenters'

type AgentRow = {
  id: string
  name: string
  type: string
  icon: string | null
  provider_id: string | null
  model_id: string | null
  system_prompt: string | null
  temperature: number | null
  context_length: number | null
  max_tokens: number | null
  thinking_budget: number | null
  reasoning_effort: string | null
  command: string | null
  args: string | null
  env: string | null
  cwd: string | null
  enabled: number | null
  is_builtin: number | null
  builtin_id: string | null
  profiles: string | null
  active_profile_id: string | null
  mcp_selections: string | null
  created_at: number
  updated_at: number
}

function parseJsonField<T>(val: string | null, fallback: T): T {
  if (!val) return fallback
  try {
    return JSON.parse(val)
  } catch {
    return fallback
  }
}

export class AgentsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'agents')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('template', 'acp')),
        icon TEXT,

        provider_id TEXT,
        model_id TEXT,
        system_prompt TEXT,
        temperature REAL,
        context_length INTEGER,
        max_tokens INTEGER,
        thinking_budget INTEGER,
        reasoning_effort TEXT,

        command TEXT,
        args TEXT,
        env TEXT,
        cwd TEXT,
        enabled INTEGER DEFAULT 1,
        is_builtin INTEGER DEFAULT 0,
        builtin_id TEXT,
        profiles TEXT,
        active_profile_id TEXT,
        mcp_selections TEXT,

        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(type);
      CREATE INDEX IF NOT EXISTS idx_agents_enabled ON agents(enabled);
    `
  }

  getMigrationSQL(_version: number): string | null {
    return null
  }

  getLatestVersion(): number {
    return 1
  }

  runMigration(version: number): void {
    if (version === 1) {
      const columns = this.db.pragma('table_info(agents)') as { name: string }[]
      const columnNames = new Set(columns.map((c) => c.name))

      if (!columnNames.has('is_builtin')) {
        this.db.exec('ALTER TABLE agents ADD COLUMN is_builtin INTEGER DEFAULT 0')
      }
      if (!columnNames.has('builtin_id')) {
        this.db.exec('ALTER TABLE agents ADD COLUMN builtin_id TEXT')
      }
      if (!columnNames.has('profiles')) {
        this.db.exec('ALTER TABLE agents ADD COLUMN profiles TEXT')
      }
      if (!columnNames.has('active_profile_id')) {
        this.db.exec('ALTER TABLE agents ADD COLUMN active_profile_id TEXT')
      }
      if (!columnNames.has('mcp_selections')) {
        this.db.exec('ALTER TABLE agents ADD COLUMN mcp_selections TEXT')
      }
    }
  }

  async list(): Promise<Agent[]> {
    const rows = this.db
      .prepare(`SELECT * FROM agents ORDER BY created_at DESC`)
      .all() as AgentRow[]

    return rows.map((row) => this.rowToAgent(row))
  }

  async listByType(type: AgentType): Promise<Agent[]> {
    const rows = this.db
      .prepare(`SELECT * FROM agents WHERE type = ? ORDER BY created_at DESC`)
      .all(type) as AgentRow[]

    return rows.map((row) => this.rowToAgent(row))
  }

  async listEnabledAcpAgents(): Promise<AcpAgent[]> {
    const rows = this.db
      .prepare(`SELECT * FROM agents WHERE type = 'acp' AND enabled = 1 ORDER BY name ASC`)
      .all() as AgentRow[]

    return rows.map((row) => this.rowToAgent(row) as AcpAgent)
  }

  async listBuiltinAcpAgents(): Promise<AcpAgent[]> {
    const rows = this.db
      .prepare(`SELECT * FROM agents WHERE type = 'acp' AND is_builtin = 1 ORDER BY name ASC`)
      .all() as AgentRow[]

    return rows.map((row) => this.rowToAgent(row) as AcpAgent)
  }

  async listCustomAcpAgents(): Promise<AcpAgent[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM agents WHERE type = 'acp' AND (is_builtin = 0 OR is_builtin IS NULL) ORDER BY created_at DESC`
      )
      .all() as AgentRow[]

    return rows.map((row) => this.rowToAgent(row) as AcpAgent)
  }

  async get(id: string): Promise<Agent | null> {
    const row = this.db.prepare(`SELECT * FROM agents WHERE id = ?`).get(id) as AgentRow | undefined

    return row ? this.rowToAgent(row) : null
  }

  async getByBuiltinId(builtinId: string): Promise<AcpAgent | null> {
    const row = this.db
      .prepare(`SELECT * FROM agents WHERE type = 'acp' AND builtin_id = ?`)
      .get(builtinId) as AgentRow | undefined

    return row ? (this.rowToAgent(row) as AcpAgent) : null
  }

  async create(params: CreateAgentParams & { id?: string }): Promise<string> {
    const id = params.id || nanoid(10)
    const now = Date.now()

    if (params.type === 'template') {
      const stmt = this.db.prepare(`
        INSERT INTO agents (
          id, name, type, icon,
          provider_id, model_id, system_prompt, temperature,
          context_length, max_tokens, thinking_budget, reasoning_effort,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      stmt.run(
        id,
        params.name,
        'template',
        params.icon || null,
        params.providerId,
        params.modelId,
        params.systemPrompt || null,
        params.temperature ?? null,
        params.contextLength ?? null,
        params.maxTokens ?? null,
        params.thinkingBudget ?? null,
        params.reasoningEffort || null,
        now,
        now
      )
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO agents (
          id, name, type, icon,
          command, args, env, cwd, enabled,
          is_builtin, builtin_id, profiles, active_profile_id, mcp_selections,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      stmt.run(
        id,
        params.name,
        'acp',
        params.icon || null,
        params.command,
        params.args ? JSON.stringify(params.args) : null,
        params.env ? JSON.stringify(params.env) : null,
        params.cwd || null,
        params.enabled !== false ? 1 : 0,
        params.isBuiltin ? 1 : 0,
        params.builtinId || null,
        params.profiles ? JSON.stringify(params.profiles) : null,
        params.activeProfileId || null,
        params.mcpSelections ? JSON.stringify(params.mcpSelections) : null,
        now,
        now
      )
    }

    return id
  }

  async update(id: string, params: UpdateAgentParams, agentType: AgentType): Promise<void> {
    const fields: string[] = ['updated_at = ?']
    const values: (string | number | null)[] = [Date.now()]

    if (params.name !== undefined) {
      fields.push('name = ?')
      values.push(params.name)
    }
    if (params.icon !== undefined) {
      fields.push('icon = ?')
      values.push(params.icon || null)
    }

    if (agentType === 'template') {
      const tp = params as Partial<TemplateAgent>
      if (tp.providerId !== undefined) {
        fields.push('provider_id = ?')
        values.push(tp.providerId)
      }
      if (tp.modelId !== undefined) {
        fields.push('model_id = ?')
        values.push(tp.modelId)
      }
      if (tp.systemPrompt !== undefined) {
        fields.push('system_prompt = ?')
        values.push(tp.systemPrompt || null)
      }
      if (tp.temperature !== undefined) {
        fields.push('temperature = ?')
        values.push(tp.temperature)
      }
      if (tp.contextLength !== undefined) {
        fields.push('context_length = ?')
        values.push(tp.contextLength)
      }
      if (tp.maxTokens !== undefined) {
        fields.push('max_tokens = ?')
        values.push(tp.maxTokens)
      }
      if (tp.thinkingBudget !== undefined) {
        fields.push('thinking_budget = ?')
        values.push(tp.thinkingBudget)
      }
      if (tp.reasoningEffort !== undefined) {
        fields.push('reasoning_effort = ?')
        values.push(tp.reasoningEffort || null)
      }
    } else {
      const ap = params as Partial<AcpAgent>
      if (ap.command !== undefined) {
        fields.push('command = ?')
        values.push(ap.command)
      }
      if (ap.args !== undefined) {
        fields.push('args = ?')
        values.push(ap.args ? JSON.stringify(ap.args) : null)
      }
      if (ap.env !== undefined) {
        fields.push('env = ?')
        values.push(ap.env ? JSON.stringify(ap.env) : null)
      }
      if (ap.cwd !== undefined) {
        fields.push('cwd = ?')
        values.push(ap.cwd || null)
      }
      if (ap.enabled !== undefined) {
        fields.push('enabled = ?')
        values.push(ap.enabled ? 1 : 0)
      }
      if (ap.isBuiltin !== undefined) {
        fields.push('is_builtin = ?')
        values.push(ap.isBuiltin ? 1 : 0)
      }
      if (ap.builtinId !== undefined) {
        fields.push('builtin_id = ?')
        values.push(ap.builtinId || null)
      }
      if (ap.profiles !== undefined) {
        fields.push('profiles = ?')
        values.push(ap.profiles ? JSON.stringify(ap.profiles) : null)
      }
      if (ap.activeProfileId !== undefined) {
        fields.push('active_profile_id = ?')
        values.push(ap.activeProfileId || null)
      }
      if (ap.mcpSelections !== undefined) {
        fields.push('mcp_selections = ?')
        values.push(ap.mcpSelections ? JSON.stringify(ap.mcpSelections) : null)
      }
    }

    values.push(id)

    this.db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM agents WHERE id = ?').run(id)
  }

  async hasAcpAgents(): Promise<boolean> {
    const row = this.db
      .prepare(`SELECT COUNT(*) as count FROM agents WHERE type = 'acp'`)
      .get() as { count: number }
    return row.count > 0
  }

  private rowToAgent(row: AgentRow): Agent {
    const base = {
      id: row.id,
      name: row.name,
      icon: row.icon || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }

    if (row.type === 'template') {
      return {
        ...base,
        type: 'template' as const,
        providerId: row.provider_id || '',
        modelId: row.model_id || '',
        systemPrompt: row.system_prompt || undefined,
        temperature: row.temperature ?? undefined,
        contextLength: row.context_length ?? undefined,
        maxTokens: row.max_tokens ?? undefined,
        thinkingBudget: row.thinking_budget ?? undefined,
        reasoningEffort: (row.reasoning_effort as TemplateAgent['reasoningEffort']) || undefined
      } as TemplateAgent
    }

    const profiles = parseJsonField<AcpAgentProfile[] | undefined>(row.profiles, undefined)
    return {
      ...base,
      type: 'acp' as const,
      command: row.command || '',
      args: parseJsonField<string[] | undefined>(row.args, undefined),
      env: parseJsonField<Record<string, string> | undefined>(row.env, undefined),
      cwd: row.cwd || undefined,
      enabled: row.enabled === 1,
      isBuiltin: row.is_builtin === 1 || undefined,
      builtinId: (row.builtin_id as AcpBuiltinAgentId) || undefined,
      profiles,
      activeProfileId: row.active_profile_id || undefined,
      mcpSelections: parseJsonField<string[] | undefined>(row.mcp_selections, undefined)
    } as AcpAgent
  }
}
