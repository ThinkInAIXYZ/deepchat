import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export type EnvironmentPreferenceStatus = 'active' | 'archived' | 'removed'

export interface NewEnvironmentPreferenceRow {
  path: string
  status: EnvironmentPreferenceStatus
  sort_order: number
  archived_at: number | null
  removed_at: number | null
  updated_at: number
}

export const DEFAULT_ENVIRONMENT_SORT_ORDER = 2147483647

export class NewEnvironmentPreferencesTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'new_environment_preferences')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS new_environment_preferences (
        path TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'archived', 'removed')),
        sort_order INTEGER NOT NULL DEFAULT ${DEFAULT_ENVIRONMENT_SORT_ORDER},
        archived_at INTEGER,
        removed_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_new_environment_preferences_status_order
        ON new_environment_preferences(status, sort_order, updated_at DESC);
    `
  }

  getMigrationSQL(version: number): string | null {
    if (version === 32) {
      return this.getCreateTableSQL()
    }

    return null
  }

  getLatestVersion(): number {
    return 32
  }

  list(): NewEnvironmentPreferenceRow[] {
    return this.db
      .prepare('SELECT * FROM new_environment_preferences')
      .all() as NewEnvironmentPreferenceRow[]
  }

  get(environmentPath: string): NewEnvironmentPreferenceRow | undefined {
    const normalizedPath = this.normalizePath(environmentPath)
    if (!normalizedPath) {
      return undefined
    }

    return this.db
      .prepare('SELECT * FROM new_environment_preferences WHERE path = ?')
      .get(normalizedPath) as NewEnvironmentPreferenceRow | undefined
  }

  markActive(environmentPath: string): void {
    this.setStatus(environmentPath, 'active')
  }

  markArchived(environmentPath: string): void {
    this.setStatus(environmentPath, 'archived')
  }

  markRemoved(environmentPath: string): void {
    this.setStatus(environmentPath, 'removed')
  }

  reorderActive(environmentPaths: string[]): void {
    const uniquePaths = this.normalizeUniquePaths(environmentPaths)
    if (uniquePaths.length === 0) {
      return
    }

    const now = Date.now()
    const upsert = this.db.prepare(
      `INSERT INTO new_environment_preferences (
        path,
        status,
        sort_order,
        archived_at,
        removed_at,
        updated_at
      ) VALUES (?, 'active', ?, NULL, NULL, ?)
      ON CONFLICT(path) DO UPDATE SET
        status = 'active',
        sort_order = excluded.sort_order,
        archived_at = NULL,
        removed_at = NULL,
        updated_at = excluded.updated_at
      WHERE new_environment_preferences.status = 'active'`
    )

    this.db.transaction(() => {
      uniquePaths.forEach((path, index) => {
        upsert.run(path, index, now)
      })
    })()
  }

  private setStatus(environmentPath: string, status: EnvironmentPreferenceStatus): void {
    const normalizedPath = this.normalizePath(environmentPath)
    if (!normalizedPath) {
      return
    }

    const now = Date.now()
    const archivedAt = status === 'archived' ? now : null
    const removedAt = status === 'removed' ? now : null

    this.db
      .prepare(
        `INSERT INTO new_environment_preferences (
          path,
          status,
          sort_order,
          archived_at,
          removed_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          status = excluded.status,
          archived_at = excluded.archived_at,
          removed_at = excluded.removed_at,
          updated_at = excluded.updated_at`
      )
      .run(normalizedPath, status, DEFAULT_ENVIRONMENT_SORT_ORDER, archivedAt, removedAt, now)
  }

  private normalizeUniquePaths(environmentPaths: string[]): string[] {
    const seen = new Set<string>()
    const normalizedPaths: string[] = []

    for (const environmentPath of environmentPaths) {
      const normalizedPath = this.normalizePath(environmentPath)
      if (!normalizedPath || seen.has(normalizedPath)) {
        continue
      }

      seen.add(normalizedPath)
      normalizedPaths.push(normalizedPath)
    }

    return normalizedPaths
  }

  private normalizePath(environmentPath: string | null | undefined): string | null {
    const normalizedPath = environmentPath?.trim()
    return normalizedPath || null
  }
}
