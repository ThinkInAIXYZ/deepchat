import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export interface NewSessionRow {
  id: string
  agent_id: string
  title: string
  project_dir: string | null
  is_pinned: number
  created_at: number
  updated_at: number
}

export class NewSessionsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'new_sessions')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS new_sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        title TEXT NOT NULL,
        project_dir TEXT,
        is_pinned INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_new_sessions_agent ON new_sessions(agent_id);
      CREATE INDEX IF NOT EXISTS idx_new_sessions_updated ON new_sessions(updated_at DESC);
    `
  }

  getMigrationSQL(_version: number): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
  }

  create(id: string, agentId: string, title: string, projectDir: string | null): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO new_sessions (id, agent_id, title, project_dir, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, agentId, title, projectDir, now, now)
  }

  get(id: string): NewSessionRow | undefined {
    return this.db.prepare('SELECT * FROM new_sessions WHERE id = ?').get(id) as
      | NewSessionRow
      | undefined
  }

  list(filters?: { agentId?: string; projectDir?: string }): NewSessionRow[] {
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

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }
    sql += ' ORDER BY updated_at DESC'

    return this.db.prepare(sql).all(...params) as NewSessionRow[]
  }

  update(
    id: string,
    fields: Partial<Pick<NewSessionRow, 'title' | 'project_dir' | 'is_pinned'>>
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

    if (setClauses.length === 0) return

    setClauses.push('updated_at = ?')
    params.push(Date.now())
    params.push(id)

    this.db.prepare(`UPDATE new_sessions SET ${setClauses.join(', ')} WHERE id = ?`).run(...params)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM new_sessions WHERE id = ?').run(id)
  }
}
