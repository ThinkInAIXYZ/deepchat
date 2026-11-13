import type Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import type { DimSessionBinding } from './dimSessionBindings'

export type DimOwnedScope = Pick<
  DimSessionBinding,
  'sessionId' | 'dimSessionId' | 'branchId' | 'generation'
>

/** Ownership survives binding replacement so Inspector and deletion can reach every generation. */
export class DimSessionScopesTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'dim_session_scopes')
  }
  getCreateTableSQL(): string {
    return `CREATE TABLE IF NOT EXISTS dim_session_scopes (
      session_id TEXT NOT NULL, generation INTEGER NOT NULL, dim_session_id TEXT NOT NULL,
      branch_id TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(session_id,generation), UNIQUE(dim_session_id,branch_id)
    );`
  }
  getLatestVersion(): number {
    return 0
  }
  getMigrationSQL(): null {
    return null
  }
  register(scope: DimOwnedScope): void {
    this.db
      .prepare(`INSERT INTO dim_session_scopes
      (session_id,generation,dim_session_id,branch_id,created_at) VALUES (?,?,?,?,?)
      ON CONFLICT(session_id,generation) DO NOTHING`)
      .run(scope.sessionId, scope.generation, scope.dimSessionId, scope.branchId, Date.now())
    const stored = this.list(scope.sessionId).find((item) => item.generation === scope.generation)
    if (stored?.dimSessionId !== scope.dimSessionId || stored.branchId !== scope.branchId)
      throw new Error('Native generation ownership conflicts')
  }
  list(sessionId: string): DimOwnedScope[] {
    const rows = this.db
      .prepare('SELECT * FROM dim_session_scopes WHERE session_id=? ORDER BY generation')
      .all(sessionId) as Array<{
      session_id: string
      dim_session_id: string
      branch_id: string
      generation: number
    }>
    return rows.map((row) => ({
      sessionId: row.session_id,
      dimSessionId: row.dim_session_id,
      branchId: row.branch_id,
      generation: row.generation
    }))
  }
  delete(sessionId: string): void {
    this.db.prepare('DELETE FROM dim_session_scopes WHERE session_id=?').run(sessionId)
  }
}
