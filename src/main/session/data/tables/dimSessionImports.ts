import type Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import type { DimSessionBinding } from './dimSessionBindings'
import type { DimHistoryPlan } from '@/agent/dim/historyImport'

export interface DimSessionImport {
  sessionId: string
  dimSessionId: string
  branchId: string
  migrationId: string
  digest: string
  chunks: number
  sealed: boolean
  cursor: string | null
}
interface Row {
  session_id: string
  dim_session_id: string
  branch_id: string
  migration_id: string
  digest: string
  chunks: number
  sealed_cursor: string | null
}

/** Import identity/progress only. The snapshot and its canonical receipt live in dim. */
export class DimSessionImportsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'dim_session_imports')
  }
  getCreateTableSQL(): string {
    return `CREATE TABLE IF NOT EXISTS dim_session_imports (
      session_id TEXT NOT NULL, dim_session_id TEXT NOT NULL, branch_id TEXT NOT NULL,
      migration_id TEXT NOT NULL, digest TEXT NOT NULL, chunks INTEGER NOT NULL,
      sealed_cursor TEXT, created_at INTEGER NOT NULL,
      PRIMARY KEY(dim_session_id,branch_id)
    ); CREATE INDEX IF NOT EXISTS idx_dim_session_imports_product ON dim_session_imports(session_id);`
  }
  getLatestVersion(): number {
    return 0
  }
  getMigrationSQL(): null {
    return null
  }
  get(
    binding: Pick<DimSessionBinding, 'sessionId' | 'dimSessionId' | 'branchId'>
  ): DimSessionImport | null {
    const row = this.db
      .prepare(
        'SELECT * FROM dim_session_imports WHERE session_id=? AND dim_session_id=? AND branch_id=?'
      )
      .get(binding.sessionId, binding.dimSessionId, binding.branchId) as Row | undefined
    return row
      ? {
          sessionId: row.session_id,
          dimSessionId: row.dim_session_id,
          branchId: row.branch_id,
          migrationId: row.migration_id,
          digest: row.digest,
          chunks: row.chunks,
          sealed: row.sealed_cursor !== null,
          cursor: row.sealed_cursor
        }
      : null
  }
  begin(binding: DimSessionBinding, plan: DimHistoryPlan): DimSessionImport {
    this.db
      .prepare(
        `INSERT INTO dim_session_imports (session_id,dim_session_id,branch_id,migration_id,digest,chunks,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(dim_session_id,branch_id) DO NOTHING`
      )
      .run(
        binding.sessionId,
        binding.dimSessionId,
        binding.branchId,
        plan.migrationId,
        plan.digest,
        plan.chunks.length,
        Date.now()
      )
    const record = this.get(binding)
    if (
      !record ||
      record.migrationId !== plan.migrationId ||
      record.digest !== plan.digest ||
      record.chunks !== plan.chunks.length
    )
      throw new Error('Native import identity is already bound to another snapshot')
    return record
  }
  seal(record: DimSessionImport, cursor: string): void {
    if (!/^\d+$/.test(cursor)) throw new Error('Invalid native history receipt')
    const updated = this.db
      .prepare(
        'UPDATE dim_session_imports SET sealed_cursor=? WHERE session_id=? AND dim_session_id=? AND branch_id=? AND migration_id=? AND digest=? AND (sealed_cursor IS NULL OR sealed_cursor=?)'
      )
      .run(
        cursor,
        record.sessionId,
        record.dimSessionId,
        record.branchId,
        record.migrationId,
        record.digest,
        cursor
      )
    if (updated.changes !== 1) throw new Error('Native import receipt belongs to another scope')
  }
  list(sessionId: string): Array<{ dimSessionId: string; branchId: string }> {
    const rows = this.db
      .prepare('SELECT dim_session_id,branch_id FROM dim_session_imports WHERE session_id=?')
      .all(sessionId) as Array<{ dim_session_id: string; branch_id: string }>
    return rows.map((row) => ({ dimSessionId: row.dim_session_id, branchId: row.branch_id }))
  }
  deleteBySession(sessionId: string): void {
    this.db.prepare('DELETE FROM dim_session_imports WHERE session_id=?').run(sessionId)
  }
}
