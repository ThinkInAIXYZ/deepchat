import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export interface NewSessionRow {
  id: string
  agent_id: string
  title: string
  project_dir: string | null
  is_pinned: number
  is_draft: number
  active_skills: string
  disabled_agent_tools: string
  subagent_enabled: number
  session_kind: 'regular' | 'subagent'
  parent_session_id: string | null
  subagent_meta_json: string | null
  created_at: number
  updated_at: number
}

export class NewSessionsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'new_sessions')
  }

  getCreateTableSQL(): string {
    return this.getCreateTableSQLForVersion(0)
  }

  override createTable(): void {
    if (this.tableExists()) {
      return
    }

    this.db.exec(this.getCreateTableSQLForVersion(this.getRecordedSchemaVersion()))
  }

  private getCreateTableSQLForVersion(version: number): string {
    const columns = [
      'id TEXT PRIMARY KEY',
      'agent_id TEXT NOT NULL',
      'title TEXT NOT NULL',
      'project_dir TEXT',
      'is_pinned INTEGER DEFAULT 0'
    ]

    if (version >= 11) {
      columns.push('is_draft INTEGER NOT NULL DEFAULT 0')
    }
    if (version >= 15) {
      columns.push("active_skills TEXT NOT NULL DEFAULT '[]'")
    }
    if (version >= 16) {
      columns.push("disabled_agent_tools TEXT NOT NULL DEFAULT '[]'")
    }
    if (version >= 20) {
      columns.push(
        'subagent_enabled INTEGER NOT NULL DEFAULT 0',
        "session_kind TEXT NOT NULL DEFAULT 'regular'",
        'parent_session_id TEXT',
        'subagent_meta_json TEXT'
      )
    }

    columns.push('created_at INTEGER NOT NULL', 'updated_at INTEGER NOT NULL')

    return `
      CREATE TABLE IF NOT EXISTS new_sessions (
        ${columns.join(',\n        ')}
      );
      CREATE INDEX IF NOT EXISTS idx_new_sessions_agent ON new_sessions(agent_id);
      CREATE INDEX IF NOT EXISTS idx_new_sessions_updated ON new_sessions(updated_at DESC);
    `
  }

  getMigrationSQL(version: number): string | null {
    if (version === 11) {
      return `ALTER TABLE new_sessions ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0;`
    }
    if (version === 15) {
      return `ALTER TABLE new_sessions ADD COLUMN active_skills TEXT NOT NULL DEFAULT '[]';`
    }
    if (version === 16) {
      return `ALTER TABLE new_sessions ADD COLUMN disabled_agent_tools TEXT NOT NULL DEFAULT '[]';`
    }
    if (version === 20) {
      return `
        ALTER TABLE new_sessions ADD COLUMN subagent_enabled INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE new_sessions ADD COLUMN session_kind TEXT NOT NULL DEFAULT 'regular';
        ALTER TABLE new_sessions ADD COLUMN parent_session_id TEXT;
        ALTER TABLE new_sessions ADD COLUMN subagent_meta_json TEXT;
      `
    }
    return null
  }

  getLatestVersion(): number {
    return 20
  }

  create(
    id: string,
    agentId: string,
    title: string,
    projectDir: string | null,
    options?: {
      isDraft?: boolean
      isPinned?: boolean
      activeSkills?: string[]
      disabledAgentTools?: string[]
      subagentEnabled?: boolean
      sessionKind?: 'regular' | 'subagent'
      parentSessionId?: string | null
      subagentMetaJson?: string | null
      createdAt?: number
      updatedAt?: number
    }
  ): void {
    const now = Date.now()
    const createdAt = options?.createdAt ?? now
    const updatedAt = options?.updatedAt ?? createdAt
    this.db
      .prepare(
        `INSERT INTO new_sessions (
          id,
          agent_id,
          title,
          project_dir,
          is_pinned,
          is_draft,
          active_skills,
          disabled_agent_tools,
          subagent_enabled,
          session_kind,
          parent_session_id,
          subagent_meta_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        agentId,
        title,
        projectDir,
        options?.isPinned ? 1 : 0,
        options?.isDraft ? 1 : 0,
        JSON.stringify(options?.activeSkills ?? []),
        JSON.stringify(options?.disabledAgentTools ?? []),
        options?.subagentEnabled ? 1 : 0,
        options?.sessionKind === 'subagent' ? 'subagent' : 'regular',
        options?.parentSessionId ?? null,
        options?.subagentMetaJson ?? null,
        createdAt,
        updatedAt
      )
  }

  get(id: string): NewSessionRow | undefined {
    return this.db.prepare('SELECT * FROM new_sessions WHERE id = ?').get(id) as
      | NewSessionRow
      | undefined
  }

  list(filters?: {
    agentId?: string
    projectDir?: string
    includeSubagents?: boolean
    parentSessionId?: string
  }): NewSessionRow[] {
    let sql = 'SELECT * FROM new_sessions'
    const conditions: string[] = []
    const params: unknown[] = []

    if (filters?.agentId) {
      conditions.push('agent_id = ?')
      params.push(filters.agentId)
    }
    if (filters?.projectDir) {
      conditions.push('project_dir = ?')
      params.push(filters.projectDir)
    }
    if (filters?.includeSubagents !== true) {
      conditions.push("session_kind = 'regular'")
    }
    if (filters?.parentSessionId !== undefined) {
      conditions.push('parent_session_id = ?')
      params.push(filters.parentSessionId)
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }
    sql += ' ORDER BY updated_at DESC'

    return this.db.prepare(sql).all(...params) as NewSessionRow[]
  }

  update(
    id: string,
    fields: Partial<
      Pick<
        NewSessionRow,
        | 'title'
        | 'project_dir'
        | 'is_pinned'
        | 'is_draft'
        | 'active_skills'
        | 'disabled_agent_tools'
        | 'subagent_enabled'
        | 'session_kind'
        | 'parent_session_id'
        | 'subagent_meta_json'
      >
    >
  ): void {
    const setClauses: string[] = []
    const params: unknown[] = []

    if (fields.title !== undefined) {
      setClauses.push('title = ?')
      params.push(fields.title)
    }
    if (fields.project_dir !== undefined) {
      setClauses.push('project_dir = ?')
      params.push(fields.project_dir)
    }
    if (fields.is_pinned !== undefined) {
      setClauses.push('is_pinned = ?')
      params.push(fields.is_pinned)
    }
    if (fields.is_draft !== undefined) {
      setClauses.push('is_draft = ?')
      params.push(fields.is_draft)
    }
    if (fields.active_skills !== undefined) {
      setClauses.push('active_skills = ?')
      params.push(fields.active_skills)
    }
    if (fields.disabled_agent_tools !== undefined) {
      setClauses.push('disabled_agent_tools = ?')
      params.push(fields.disabled_agent_tools)
    }
    if (fields.subagent_enabled !== undefined) {
      setClauses.push('subagent_enabled = ?')
      params.push(fields.subagent_enabled)
    }
    if (fields.session_kind !== undefined) {
      setClauses.push('session_kind = ?')
      params.push(fields.session_kind)
    }
    if (fields.parent_session_id !== undefined) {
      setClauses.push('parent_session_id = ?')
      params.push(fields.parent_session_id)
    }
    if (fields.subagent_meta_json !== undefined) {
      setClauses.push('subagent_meta_json = ?')
      params.push(fields.subagent_meta_json)
    }

    if (setClauses.length === 0) return

    setClauses.push('updated_at = ?')
    params.push(Date.now())
    params.push(id)

    this.db.prepare(`UPDATE new_sessions SET ${setClauses.join(', ')} WHERE id = ?`).run(...params)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM new_sessions WHERE id = ?').run(id)
  }

  getActiveSkills(id: string): string[] {
    const row = this.db.prepare('SELECT active_skills FROM new_sessions WHERE id = ?').get(id) as
      | { active_skills?: string | null }
      | undefined

    return this.parseActiveSkills(row?.active_skills)
  }

  updateActiveSkills(id: string, activeSkills: string[]): void {
    this.update(id, { active_skills: JSON.stringify(activeSkills) })
  }

  getDisabledAgentTools(id: string): string[] {
    const row = this.db
      .prepare('SELECT disabled_agent_tools FROM new_sessions WHERE id = ?')
      .get(id) as { disabled_agent_tools?: string | null } | undefined

    return this.parseStringArray(row?.disabled_agent_tools)
  }

  updateDisabledAgentTools(id: string, disabledAgentTools: string[]): void {
    this.update(id, { disabled_agent_tools: JSON.stringify(disabledAgentTools) })
  }

  reassignAgentId(fromAgentId: string, toAgentId: string): void {
    this.db
      .prepare('UPDATE new_sessions SET agent_id = ?, updated_at = ? WHERE agent_id = ?')
      .run(toAgentId, Date.now(), fromAgentId)
  }

  private parseActiveSkills(raw: string | null | undefined): string[] {
    return this.parseStringArray(raw)
  }

  private parseStringArray(raw: string | null | undefined): string[] {
    if (!raw) {
      return []
    }

    try {
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : []
    } catch {
      return []
    }
  }
}
