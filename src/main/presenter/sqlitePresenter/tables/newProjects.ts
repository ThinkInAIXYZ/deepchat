import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export interface NewProjectRow {
  path: string
  name: string
  icon: string | null
  last_accessed_at: number
}

export class NewProjectsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'new_projects')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS new_projects (
        path TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT DEFAULT NULL,
        last_accessed_at INTEGER NOT NULL
      );
    `
  }

  getMigrationSQL(_version: number): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
  }

  upsert(projectPath: string, name: string, icon: string | null = null): void {
    this.db
      .prepare(
        `INSERT INTO new_projects (path, name, icon, last_accessed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           name = excluded.name,
           icon = COALESCE(excluded.icon, new_projects.icon),
           last_accessed_at = excluded.last_accessed_at`
      )
      .run(projectPath, name, icon, Date.now())
  }

  getAll(): NewProjectRow[] {
    return this.db
      .prepare('SELECT * FROM new_projects ORDER BY last_accessed_at DESC')
      .all() as NewProjectRow[]
  }

  getRecent(limit: number): NewProjectRow[] {
    return this.db
      .prepare('SELECT * FROM new_projects ORDER BY last_accessed_at DESC LIMIT ?')
      .all(limit) as NewProjectRow[]
  }

  delete(projectPath: string): void {
    this.db.prepare('DELETE FROM new_projects WHERE path = ?').run(projectPath)
  }
}
