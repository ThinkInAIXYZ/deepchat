import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export interface NewEnvironmentRow {
  path: string
  session_count: number
  last_used_at: number
}

export class NewEnvironmentsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'new_environments')
  }

  private getEnvironmentUsageSQL(pathFilter: boolean = false): string {
    return `
      WITH environment_usage AS (
        SELECT
          id AS session_id,
          project_dir AS path,
          updated_at AS activity_at
        FROM new_sessions
        WHERE is_draft = 0
          AND project_dir IS NOT NULL
          AND TRIM(project_dir) <> ''

        UNION ALL

        SELECT
          acp.conversation_id AS session_id,
          acp.workdir AS path,
          MAX(COALESCE(ns.updated_at, 0), COALESCE(acp.updated_at, 0)) AS activity_at
        FROM acp_sessions acp
        INNER JOIN new_sessions ns ON ns.id = acp.conversation_id
        WHERE ns.is_draft = 0
          AND (ns.project_dir IS NULL OR TRIM(ns.project_dir) = '')
          AND acp.workdir IS NOT NULL
          AND TRIM(acp.workdir) <> ''
      ),
      normalized_usage AS (
        SELECT
          session_id,
          path,
          MAX(activity_at) AS activity_at
        FROM environment_usage
        ${pathFilter ? 'WHERE path = ?' : ''}
        GROUP BY session_id, path
      )
      SELECT
        path,
        COUNT(*) AS session_count,
        MAX(activity_at) AS last_used_at
      FROM normalized_usage
      GROUP BY path
    `
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS new_environments (
        path TEXT PRIMARY KEY,
        session_count INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_new_environments_last_used
        ON new_environments(last_used_at DESC);
    `
  }

  getMigrationSQL(version: number): string | null {
    if (version === 17) {
      return `
        CREATE TABLE IF NOT EXISTS new_environments (
          path TEXT PRIMARY KEY,
          session_count INTEGER NOT NULL,
          last_used_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_new_environments_last_used
          ON new_environments(last_used_at DESC);
        DELETE FROM new_environments;
        INSERT INTO new_environments (path, session_count, last_used_at)
        SELECT project_dir, COUNT(*), MAX(updated_at)
        FROM new_sessions
        WHERE project_dir IS NOT NULL
          AND TRIM(project_dir) <> ''
          AND is_draft = 0
        GROUP BY project_dir;
      `
    }

    if (version === 18) {
      return `
        DELETE FROM new_environments;
        INSERT INTO new_environments (path, session_count, last_used_at)
        ${this.getEnvironmentUsageSQL()};
      `
    }

    return null
  }

  getLatestVersion(): number {
    return 18
  }

  list(): NewEnvironmentRow[] {
    return this.db
      .prepare('SELECT * FROM new_environments ORDER BY last_used_at DESC, path ASC')
      .all() as NewEnvironmentRow[]
  }

  rebuildFromSessions(): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM new_environments').run()
      this.db.exec(`
        INSERT INTO new_environments (path, session_count, last_used_at)
        ${this.getEnvironmentUsageSQL()}
      `)
    })()
  }

  syncPath(projectPath: string | null | undefined): void {
    const normalizedPath = projectPath?.trim()
    if (!normalizedPath) {
      return
    }

    const aggregate = this.db.prepare(this.getEnvironmentUsageSQL(true)).get(normalizedPath) as
      | { session_count: number; last_used_at: number | null }
      | undefined

    if (!aggregate?.session_count || !aggregate.last_used_at) {
      this.db.prepare('DELETE FROM new_environments WHERE path = ?').run(normalizedPath)
      return
    }

    this.db
      .prepare(
        `INSERT INTO new_environments (path, session_count, last_used_at)
         VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           session_count = excluded.session_count,
           last_used_at = excluded.last_used_at`
      )
      .run(normalizedPath, aggregate.session_count, aggregate.last_used_at)
  }

  listPathsForSession(sessionId: string): string[] {
    return this.db
      .prepare(
        `
          SELECT DISTINCT path
          FROM (
            SELECT project_dir AS path
            FROM new_sessions
            WHERE id = ?
              AND is_draft = 0
              AND project_dir IS NOT NULL
              AND TRIM(project_dir) <> ''

            UNION

            SELECT acp.workdir AS path
            FROM acp_sessions acp
            INNER JOIN new_sessions ns ON ns.id = acp.conversation_id
            WHERE ns.id = ?
              AND ns.is_draft = 0
              AND (ns.project_dir IS NULL OR TRIM(ns.project_dir) = '')
              AND acp.workdir IS NOT NULL
              AND TRIM(acp.workdir) <> ''
          )
        `
      )
      .all(sessionId, sessionId)
      .map((row) => (row as { path: string }).path)
  }

  syncSessionPaths(sessionId: string): void {
    for (const path of this.listPathsForSession(sessionId)) {
      this.syncPath(path)
    }
  }

  syncForSession(sessionId: string): void {
    this.syncSessionPaths(sessionId)
  }

  clear(): void {
    this.db.prepare('DELETE FROM new_environments').run()
  }
}
