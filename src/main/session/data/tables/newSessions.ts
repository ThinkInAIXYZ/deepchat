import Database from 'better-sqlite3-multiple-ciphers'
import {
  DEFAULT_ORCHESTRATION_POLICY,
  normalizeOrchestrationPolicy,
  type OrchestrationPolicy
} from '@shared/orchestration/policy'
import { BaseTable } from '@/data/baseTable'

const ADD_REVISION_COLUMN_SQL =
  'ALTER TABLE new_sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;'
export const SESSION_ORCHESTRATION_POLICY_SCHEMA_VERSION = 59

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
  orchestration_policy: OrchestrationPolicy
  created_at: number
  updated_at: number
  revision: number
}

export type SessionListPageCursor = {
  updatedAt: number
  id: string
}

export type SessionListPageResult = {
  rows: NewSessionRow[]
  hasMore: boolean
}

export class NewSessionsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'new_sessions')
  }

  getCreateTableSQL(): string {
    return this.getCreateTableSQLForVersion(this.getLatestVersion())
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
    if (version >= 21) {
      columns.push('revision INTEGER NOT NULL DEFAULT 0')
    }
    if (version >= SESSION_ORCHESTRATION_POLICY_SCHEMA_VERSION) {
      columns.push(
        "orchestration_policy TEXT NOT NULL DEFAULT 'explicit' CHECK (orchestration_policy IN ('explicit', 'proactive'))"
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
    if (version === 21) {
      return ADD_REVISION_COLUMN_SQL
    }
    if (version === 44) {
      // The original v21 migration shipped after existing databases had already advanced past
      // that global version, so they need a forward recovery migration.
      return ADD_REVISION_COLUMN_SQL
    }
    if (version === SESSION_ORCHESTRATION_POLICY_SCHEMA_VERSION) {
      return `
        ALTER TABLE new_sessions
          ADD COLUMN orchestration_policy TEXT NOT NULL DEFAULT 'explicit'
          CHECK (orchestration_policy IN ('explicit', 'proactive'));
      `
    }
    return null
  }

  getLatestVersion(): number {
    return SESSION_ORCHESTRATION_POLICY_SCHEMA_VERSION
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
      orchestrationPolicy?: OrchestrationPolicy
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
          session_kind,
          parent_session_id,
          subagent_meta_json,
          orchestration_policy,
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
        options?.sessionKind === 'subagent' ? 'subagent' : 'regular',
        options?.parentSessionId ?? null,
        options?.subagentMetaJson ?? null,
        normalizeOrchestrationPolicy(options?.orchestrationPolicy),
        createdAt,
        updatedAt
      )

    this.replaceActiveSkillsRows(id, options?.activeSkills ?? [])
    this.replaceDisabledAgentToolRows(id, options?.disabledAgentTools ?? [])
  }

  get(id: string): NewSessionRow | undefined {
    return this.db.prepare('SELECT * FROM new_sessions WHERE id = ?').get(id) as
      | NewSessionRow
      | undefined
  }

  getMany(ids: string[]): NewSessionRow[] {
    if (ids.length === 0) {
      return []
    }

    return this.db
      .prepare(
        `SELECT *
         FROM new_sessions
         WHERE id IN (SELECT value FROM json_each(?))`
      )
      .all(JSON.stringify(ids)) as NewSessionRow[]
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
    if (filters?.includeSubagents !== true && filters?.parentSessionId === undefined) {
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

  listPage(options?: {
    limit?: number
    cursor?: SessionListPageCursor | null
    agentId?: string
    includeSubagents?: boolean
    parentSessionId?: string
  }): SessionListPageResult {
    const requestedLimit = Math.max(1, Math.min(options?.limit ?? 30, 100))
    let sql = 'SELECT * FROM new_sessions'
    const conditions: string[] = []
    const params: unknown[] = []

    if (options?.agentId) {
      conditions.push('agent_id = ?')
      params.push(options.agentId)
    }

    if (options?.includeSubagents !== true && options?.parentSessionId === undefined) {
      conditions.push("session_kind = 'regular'")
    }

    if (options?.parentSessionId !== undefined) {
      conditions.push('parent_session_id = ?')
      params.push(options.parentSessionId)
    }

    if (options?.cursor) {
      conditions.push('(updated_at < ? OR (updated_at = ? AND id < ?))')
      params.push(options.cursor.updatedAt, options.cursor.updatedAt, options.cursor.id)
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }

    sql += ' ORDER BY updated_at DESC, id DESC LIMIT ?'
    params.push(requestedLimit + 1)

    const rows = this.db.prepare(sql).all(...params) as NewSessionRow[]
    const hasMore = rows.length > requestedLimit

    return {
      rows: hasMore ? rows.slice(0, requestedLimit) : rows,
      hasMore
    }
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
        | 'session_kind'
        | 'parent_session_id'
        | 'subagent_meta_json'
        | 'orchestration_policy'
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
    if (fields.orchestration_policy !== undefined) {
      setClauses.push('orchestration_policy = ?')
      params.push(normalizeOrchestrationPolicy(fields.orchestration_policy))
    }

    if (setClauses.length === 0) return

    setClauses.push('updated_at = ?', 'revision = revision + 1')
    params.push(Date.now())
    params.push(id)

    this.db.prepare(`UPDATE new_sessions SET ${setClauses.join(', ')} WHERE id = ?`).run(...params)

    if (fields.active_skills !== undefined) {
      this.replaceActiveSkillsRows(id, this.parseActiveSkills(fields.active_skills))
    }
    if (fields.disabled_agent_tools !== undefined) {
      this.replaceDisabledAgentToolRows(id, this.parseStringArray(fields.disabled_agent_tools))
    }
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM new_session_active_skills WHERE session_id = ?').run(id)
    this.db.prepare('DELETE FROM new_session_disabled_agent_tools WHERE session_id = ?').run(id)
    this.db.prepare('DELETE FROM new_sessions WHERE id = ?').run(id)
  }

  getActiveSkills(id: string): string[] {
    const normalizedRows = this.db
      .prepare(
        `SELECT skill_name
         FROM new_session_active_skills
         WHERE session_id = ?
         ORDER BY ordinal`
      )
      .all(id) as Array<{ skill_name: string }>
    if (normalizedRows.length > 0) {
      return normalizedRows.map((row) => row.skill_name)
    }

    const row = this.db.prepare('SELECT active_skills FROM new_sessions WHERE id = ?').get(id) as
      | { active_skills?: string | null }
      | undefined
    return this.parseActiveSkills(row?.active_skills)
  }

  updateActiveSkills(id: string, activeSkills: string[]): void {
    this.update(id, { active_skills: JSON.stringify(activeSkills) })
  }

  getDisabledAgentTools(id: string): string[] {
    const normalizedRows = this.db
      .prepare(
        `SELECT tool_name
         FROM new_session_disabled_agent_tools
         WHERE session_id = ?
         ORDER BY ordinal`
      )
      .all(id) as Array<{ tool_name: string }>
    if (normalizedRows.length > 0) {
      return normalizedRows.map((row) => row.tool_name)
    }

    const row = this.db
      .prepare('SELECT disabled_agent_tools FROM new_sessions WHERE id = ?')
      .get(id) as { disabled_agent_tools?: string | null } | undefined

    return this.parseStringArray(row?.disabled_agent_tools)
  }

  updateDisabledAgentTools(id: string, disabledAgentTools: string[]): void {
    this.update(id, { disabled_agent_tools: JSON.stringify(disabledAgentTools) })
  }

  getOrchestrationPolicy(id: string): OrchestrationPolicy {
    const row = this.db
      .prepare('SELECT orchestration_policy FROM new_sessions WHERE id = ?')
      .get(id) as { orchestration_policy?: unknown } | undefined
    return normalizeOrchestrationPolicy(row?.orchestration_policy ?? DEFAULT_ORCHESTRATION_POLICY)
  }

  updateOrchestrationPolicy(id: string, policy: OrchestrationPolicy): void {
    this.update(id, { orchestration_policy: normalizeOrchestrationPolicy(policy) })
  }

  updateAgentId(id: string, agentId: string): void {
    this.db
      .prepare(
        'UPDATE new_sessions SET agent_id = ?, updated_at = ?, revision = revision + 1 WHERE id = ?'
      )
      .run(agentId, Date.now(), id)
  }

  clearProjectDir(projectDir: string): string[] {
    const normalizedProjectDir = projectDir.trim()
    if (!normalizedProjectDir) {
      return []
    }

    const rows = this.db
      .prepare(
        `SELECT id
         FROM new_sessions
         WHERE project_dir = ?
           AND session_kind = 'regular'`
      )
      .all(normalizedProjectDir) as Array<{ id: string }>

    if (rows.length === 0) {
      return []
    }

    this.db
      .prepare(
        `UPDATE new_sessions
         SET project_dir = NULL,
             updated_at = ?,
             revision = revision + 1
         WHERE project_dir = ?
           AND session_kind = 'regular'`
      )
      .run(Date.now(), normalizedProjectDir)

    return rows.map((row) => row.id)
  }

  reassignAgentId(fromAgentId: string, toAgentId: string): void {
    this.db
      .prepare(
        'UPDATE new_sessions SET agent_id = ?, updated_at = ?, revision = revision + 1 WHERE agent_id = ?'
      )
      .run(toAgentId, Date.now(), fromAgentId)
  }

  private parseActiveSkills(raw: string | null | undefined): string[] {
    return this.parseStringArray(raw)
  }

  private replaceActiveSkillsRows(sessionId: string, activeSkills: string[]): void {
    const insert = this.db.prepare(
      `INSERT INTO new_session_active_skills (
        session_id,
        ordinal,
        skill_name
      ) VALUES (?, ?, ?)`
    )

    this.db.transaction(() => {
      this.db.prepare('DELETE FROM new_session_active_skills WHERE session_id = ?').run(sessionId)
      activeSkills.forEach((skillName, index) => {
        insert.run(sessionId, index, skillName)
      })
    })()
  }

  private replaceDisabledAgentToolRows(sessionId: string, toolNames: string[]): void {
    const insert = this.db.prepare(
      `INSERT INTO new_session_disabled_agent_tools (
        session_id,
        ordinal,
        tool_name
      ) VALUES (?, ?, ?)`
    )

    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM new_session_disabled_agent_tools WHERE session_id = ?')
        .run(sessionId)
      toolNames.forEach((toolName, index) => {
        insert.run(sessionId, index, toolName)
      })
    })()
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
