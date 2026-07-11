import Database from 'better-sqlite3-multiple-ciphers'
import type {
  CreateSessionOperationCode,
  CreateSessionOperationStage,
  CreateSessionOperationState
} from '@shared/contracts/routes/sessions.routes'
import { BaseTable } from './baseTable'

export interface SessionCreateOperationRow {
  operation_id: string
  session_id: string
  input_fingerprint: string
  state: CreateSessionOperationState
  stage: CreateSessionOperationStage
  error_code: CreateSessionOperationCode | null
  dismissed_at: number | null
  created_at: number
  updated_at: number
}

export interface SessionCreateOperationCursor {
  createdAt: number
  operationId: string
}

export class SessionCreateOperationsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'session_create_operations')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS session_create_operations (
        operation_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE,
        input_fingerprint TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'succeeded', 'failed', 'unknown')),
        stage TEXT NOT NULL CHECK (stage IN (
          'accepted',
          'record_created',
          'runtime_ready',
          'input_not_required',
          'input_accepted',
          'completed'
        )),
        error_code TEXT,
        dismissed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_session_create_operations_fingerprint_state
        ON session_create_operations(input_fingerprint, state);
      CREATE INDEX IF NOT EXISTS idx_session_create_operations_history
        ON session_create_operations(created_at DESC, operation_id ASC);
    `
  }

  getMigrationSQL(_version: number): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
  }

  create(input: {
    operationId: string
    sessionId: string
    inputFingerprint: string
    now: number
  }): SessionCreateOperationRow {
    this.db
      .prepare(
        `INSERT INTO session_create_operations (
          operation_id,
          session_id,
          input_fingerprint,
          state,
          stage,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, 'pending', 'accepted', ?, ?)`
      )
      .run(input.operationId, input.sessionId, input.inputFingerprint, input.now, input.now)
    return this.get(input.operationId) as SessionCreateOperationRow
  }

  get(operationId: string): SessionCreateOperationRow | null {
    return (
      (this.db
        .prepare('SELECT * FROM session_create_operations WHERE operation_id = ?')
        .get(operationId) as SessionCreateOperationRow | undefined) ?? null
    )
  }

  findUnresolvedByFingerprint(inputFingerprint: string): SessionCreateOperationRow | null {
    return (
      (this.db
        .prepare(
          `SELECT *
           FROM session_create_operations
           WHERE input_fingerprint = ? AND state IN ('pending', 'unknown')
           ORDER BY created_at ASC, operation_id ASC
           LIMIT 1`
        )
        .get(inputFingerprint) as SessionCreateOperationRow | undefined) ?? null
    )
  }

  updateStage(operationId: string, stage: CreateSessionOperationStage, now: number): void {
    this.db
      .prepare(
        `UPDATE session_create_operations
         SET stage = ?, updated_at = ?
         WHERE operation_id = ? AND state = 'pending'`
      )
      .run(stage, now, operationId)
  }

  settle(
    operationId: string,
    input: {
      state: Exclude<CreateSessionOperationState, 'pending'>
      stage?: CreateSessionOperationStage
      errorCode: CreateSessionOperationCode | null
      now: number
    }
  ): void {
    this.db
      .prepare(
        `UPDATE session_create_operations
         SET state = ?, stage = COALESCE(?, stage), error_code = ?, updated_at = ?
         WHERE operation_id = ? AND state = 'pending'`
      )
      .run(input.state, input.stage ?? null, input.errorCode, input.now, operationId)
  }

  markPendingUnknown(now: number): number {
    return this.db
      .prepare(
        `UPDATE session_create_operations
         SET state = 'unknown', error_code = 'CREATE_OPERATION_RESTARTED', updated_at = ?
         WHERE state = 'pending'`
      )
      .run(now).changes
  }

  recoverAfterRestart(now: number): { succeeded: number; unknown: number } {
    const succeeded = this.db
      .prepare(
        `UPDATE session_create_operations
         SET state = 'succeeded', stage = 'completed', error_code = NULL, updated_at = ?
         WHERE state = 'pending'
           AND stage IN ('input_not_required', 'input_accepted')
           AND EXISTS (
             SELECT 1 FROM new_sessions WHERE new_sessions.id = session_create_operations.session_id
           )`
      )
      .run(now).changes
    return {
      succeeded,
      unknown: this.markPendingUnknown(now)
    }
  }

  setSucceededCode(
    operationId: string,
    errorCode: CreateSessionOperationCode | null,
    now: number
  ): void {
    this.db
      .prepare(
        `UPDATE session_create_operations
         SET error_code = ?, updated_at = ?
         WHERE operation_id = ? AND state = 'succeeded'`
      )
      .run(errorCode, now, operationId)
  }

  reconcileUnknownSucceeded(operationId: string, now: number): void {
    this.db
      .prepare(
        `UPDATE session_create_operations
         SET state = 'succeeded', stage = 'completed', error_code = NULL, updated_at = ?
         WHERE operation_id = ? AND state = 'unknown'`
      )
      .run(now, operationId)
  }

  dismiss(operationId: string, now: number): SessionCreateOperationRow | null {
    this.db
      .prepare(
        `UPDATE session_create_operations
         SET dismissed_at = COALESCE(dismissed_at, ?), updated_at = ?
         WHERE operation_id = ?`
      )
      .run(now, now, operationId)
    return this.get(operationId)
  }

  listPage(input: { limit: number; cursor?: SessionCreateOperationCursor | null }): {
    rows: SessionCreateOperationRow[]
    hasMore: boolean
  } {
    const params: Array<string | number> = []
    let where = ''
    if (input.cursor) {
      where = 'WHERE created_at < ? OR (created_at = ? AND operation_id > ?)'
      params.push(input.cursor.createdAt, input.cursor.createdAt, input.cursor.operationId)
    }
    params.push(input.limit + 1)
    const rows = this.db
      .prepare(
        `SELECT *
         FROM session_create_operations
         ${where}
         ORDER BY created_at DESC, operation_id ASC
         LIMIT ?`
      )
      .all(...params) as SessionCreateOperationRow[]
    return {
      rows: rows.slice(0, input.limit),
      hasMore: rows.length > input.limit
    }
  }

  deleteSucceededBySession(sessionId: string): void {
    this.db
      .prepare(
        `DELETE FROM session_create_operations
         WHERE session_id = ? AND state = 'succeeded'`
      )
      .run(sessionId)
  }

  deleteSucceededOperation(operationId: string): void {
    this.db
      .prepare(
        `DELETE FROM session_create_operations
         WHERE operation_id = ? AND state = 'succeeded'`
      )
      .run(operationId)
  }
}
