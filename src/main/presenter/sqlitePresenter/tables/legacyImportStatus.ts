import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export type LegacyImportState = 'idle' | 'running' | 'completed' | 'failed' | 'skipped'

export interface LegacyImportStatusRow {
  import_key: string
  status: LegacyImportState
  source_db_path: string
  started_at: number | null
  finished_at: number | null
  imported_sessions: number
  imported_messages: number
  imported_search_results: number
  error: string | null
  updated_at: number
}

export class LegacyImportStatusTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'legacy_import_status')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS legacy_import_status (
        import_key TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK(status IN ('idle', 'running', 'completed', 'failed', 'skipped')),
        source_db_path TEXT NOT NULL,
        started_at INTEGER DEFAULT NULL,
        finished_at INTEGER DEFAULT NULL,
        imported_sessions INTEGER NOT NULL DEFAULT 0,
        imported_messages INTEGER NOT NULL DEFAULT 0,
        imported_search_results INTEGER NOT NULL DEFAULT 0,
        error TEXT DEFAULT NULL,
        updated_at INTEGER NOT NULL
      );
    `
  }

  getMigrationSQL(_version: number): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
  }

  get(importKey: string): LegacyImportStatusRow | undefined {
    return this.db
      .prepare('SELECT * FROM legacy_import_status WHERE import_key = ?')
      .get(importKey) as LegacyImportStatusRow | undefined
  }

  upsert(
    importKey: string,
    data: {
      status: LegacyImportState
      sourceDbPath: string
      startedAt?: number | null
      finishedAt?: number | null
      importedSessions?: number
      importedMessages?: number
      importedSearchResults?: number
      error?: string | null
      updatedAt?: number
    }
  ): void {
    const now = data.updatedAt ?? Date.now()
    this.db
      .prepare(
        `
        INSERT INTO legacy_import_status (
          import_key,
          status,
          source_db_path,
          started_at,
          finished_at,
          imported_sessions,
          imported_messages,
          imported_search_results,
          error,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(import_key) DO UPDATE SET
          status = excluded.status,
          source_db_path = excluded.source_db_path,
          started_at = excluded.started_at,
          finished_at = excluded.finished_at,
          imported_sessions = excluded.imported_sessions,
          imported_messages = excluded.imported_messages,
          imported_search_results = excluded.imported_search_results,
          error = excluded.error,
          updated_at = excluded.updated_at
      `
      )
      .run(
        importKey,
        data.status,
        data.sourceDbPath,
        data.startedAt ?? null,
        data.finishedAt ?? null,
        data.importedSessions ?? 0,
        data.importedMessages ?? 0,
        data.importedSearchResults ?? 0,
        data.error ?? null,
        now
      )
  }
}
