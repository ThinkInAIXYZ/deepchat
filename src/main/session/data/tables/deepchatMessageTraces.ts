import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import type {
  TapeInspectorTraceBinding,
  TapeInspectorTraceBindingCount,
  TapeInspectorTraceMetadataPage,
  TapeInspectorTraceMetadataPageInput
} from '@/tape/ports/application'

export interface DeepChatMessageTraceRow {
  id: string
  message_id: string
  session_id: string
  provider_id: string
  model_id: string
  request_seq: number
  logical_round: number | null
  physical_attempt: number | null
  endpoint: string
  headers_json: string
  body_json: string
  truncated: number
  created_at: number
}

export class DeepChatMessageTracesTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'deepchat_message_traces')
  }

  getCreateTableSQL(): string {
    return this.getCreateTableSQLForVersion(this.getLatestVersion())
  }

  private getCreateTableSQLForVersion(version: number): string {
    const attemptIdentityColumns =
      version >= 45 ? 'logical_round INTEGER,\n        physical_attempt INTEGER,\n        ' : ''
    const messageIndexColumns =
      version >= 45
        ? `message_id,
          request_seq DESC,
          physical_attempt DESC,
          created_at DESC`
        : 'message_id, request_seq DESC'
    return `
      CREATE TABLE IF NOT EXISTS deepchat_message_traces (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        request_seq INTEGER NOT NULL,
        ${attemptIdentityColumns}endpoint TEXT NOT NULL,
        headers_json TEXT NOT NULL,
        body_json TEXT NOT NULL,
        truncated INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_trace_message_seq
        ON deepchat_message_traces(${messageIndexColumns});
      CREATE INDEX IF NOT EXISTS idx_trace_session_time
        ON deepchat_message_traces(session_id, created_at DESC);
    `
  }

  getMigrationSQL(version: number): string | null {
    if (version === 13) {
      return this.getCreateTableSQLForVersion(version)
    }
    if (version === 45) {
      return `
        ALTER TABLE deepchat_message_traces ADD COLUMN logical_round INTEGER;
        ALTER TABLE deepchat_message_traces ADD COLUMN physical_attempt INTEGER;
        DROP INDEX IF EXISTS idx_trace_message_seq;
        CREATE INDEX idx_trace_message_seq
          ON deepchat_message_traces(
            message_id,
            request_seq DESC,
            physical_attempt DESC,
            created_at DESC
          );
      `
    }
    return null
  }

  getLatestVersion(): number {
    return 45
  }

  insert(row: {
    id: string
    messageId: string
    sessionId: string
    providerId: string
    modelId: string
    endpoint: string
    headersJson: string
    bodyJson: string
    truncated: boolean
    createdAt?: number
    requestSeq?: number
    logicalRound?: number | null
    physicalAttempt?: number | null
  }): number {
    const tx = this.db.transaction((insertRow: typeof row) => {
      let requestSeq = insertRow.requestSeq
      if (requestSeq === undefined) {
        const nextSeqRow = this.db
          .prepare(
            'SELECT COALESCE(MAX(request_seq), 0) + 1 AS next_seq FROM deepchat_message_traces WHERE message_id = ?'
          )
          .get(insertRow.messageId) as { next_seq: number }
        requestSeq = nextSeqRow.next_seq
      }
      this.db
        .prepare(
          `INSERT INTO deepchat_message_traces (
             id,
             message_id,
             session_id,
             provider_id,
             model_id,
             request_seq,
             logical_round,
             physical_attempt,
             endpoint,
             headers_json,
             body_json,
             truncated,
             created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          insertRow.id,
          insertRow.messageId,
          insertRow.sessionId,
          insertRow.providerId,
          insertRow.modelId,
          requestSeq,
          insertRow.logicalRound ?? null,
          insertRow.physicalAttempt ?? null,
          insertRow.endpoint,
          insertRow.headersJson,
          insertRow.bodyJson,
          insertRow.truncated ? 1 : 0,
          insertRow.createdAt ?? Date.now()
        )

      return requestSeq
    })

    return tx(row)
  }

  listByMessageId(messageId: string): DeepChatMessageTraceRow[] {
    return this.db
      .prepare(
        `SELECT * FROM deepchat_message_traces
         WHERE message_id = ?
         ORDER BY request_seq DESC, physical_attempt DESC, created_at DESC, id DESC`
      )
      .all(messageId) as DeepChatMessageTraceRow[]
  }

  listInspectorMetadata(
    input: TapeInspectorTraceMetadataPageInput
  ): TapeInspectorTraceMetadataPage {
    const limit = Math.min(Math.max(Math.floor(input.limit), 1), 200)
    const where = ['session_id = ?']
    const params: Array<string | number | null> = [input.sessionId]
    if (input.cursor) {
      where.push('(created_at < ? OR (created_at = ? AND id < ?))')
      params.push(input.cursor.createdAt, input.cursor.createdAt, input.cursor.traceId)
    }
    if (input.messageId !== undefined) {
      where.push('message_id = ?')
      params.push(input.messageId)
    }
    if (input.requestSeq !== undefined) {
      where.push('request_seq = ?')
      params.push(input.requestSeq)
    }
    if (input.physicalAttempt === null) {
      where.push('physical_attempt IS NULL')
    } else if (input.physicalAttempt !== undefined) {
      where.push('physical_attempt = ?')
      params.push(input.physicalAttempt)
    }
    params.push(limit + 1)
    const rows = this.db
      .prepare(
        `SELECT
           id,
           message_id,
           session_id,
           provider_id,
           model_id,
           request_seq,
           logical_round,
           physical_attempt,
           truncated,
           created_at
         FROM deepchat_message_traces
         WHERE ${where.join(' AND ')}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      )
      .all(...params) as TapeInspectorTraceMetadataPage['rows']

    return {
      rows: rows.slice(0, limit),
      hasMore: rows.length > limit
    }
  }

  countInspectorBindings(
    sessionId: string,
    bindings: readonly TapeInspectorTraceBinding[]
  ): TapeInspectorTraceBindingCount[] {
    const uniqueBindings = [
      ...new Map(
        bindings.map((binding) => [
          JSON.stringify([
            binding.scope,
            binding.messageId,
            binding.requestSeq,
            binding.scope === 'attempt' ? binding.physicalAttempt : '*'
          ]),
          binding
        ])
      ).values()
    ]
    if (uniqueBindings.length === 0) return []

    return this.db
      .prepare(
        `WITH requested_bindings AS (
           SELECT
             json_extract(value, '$.messageId') AS message_id,
             json_extract(value, '$.requestSeq') AS request_seq,
             json_extract(value, '$.attemptScoped') AS attempt_scoped,
             json_extract(value, '$.physicalAttempt') AS physical_attempt
           FROM json_each(?)
         )
         SELECT
           binding.message_id,
           binding.request_seq,
           binding.attempt_scoped,
           binding.physical_attempt,
           COUNT(trace.id) AS count
         FROM requested_bindings AS binding
         LEFT JOIN deepchat_message_traces AS trace
           ON trace.session_id = ?
          AND trace.message_id = binding.message_id
          AND trace.request_seq = binding.request_seq
          AND (
            binding.attempt_scoped = 0
            OR trace.physical_attempt = binding.physical_attempt
            OR (
              binding.attempt_scoped = 1
              AND trace.physical_attempt IS NULL
              AND binding.physical_attempt IS NULL
            )
          )
         GROUP BY
           binding.message_id,
           binding.request_seq,
           binding.attempt_scoped,
           binding.physical_attempt`
      )
      .all(
        JSON.stringify(
          uniqueBindings.map((binding) => ({
            messageId: binding.messageId,
            requestSeq: binding.requestSeq,
            attemptScoped: binding.scope === 'attempt' ? 1 : 0,
            physicalAttempt: binding.scope === 'attempt' ? binding.physicalAttempt : null
          }))
        ),
        sessionId
      )
      .map((row) => {
        const value = row as {
          message_id: string
          request_seq: number
          attempt_scoped: number
          physical_attempt: number | null
          count: number
        }
        if (value.attempt_scoped === 1) {
          return {
            scope: 'attempt' as const,
            messageId: value.message_id,
            requestSeq: value.request_seq,
            physicalAttempt: value.physical_attempt,
            count: value.count
          }
        }
        return {
          scope: 'request' as const,
          messageId: value.message_id,
          requestSeq: value.request_seq,
          count: value.count
        }
      })
  }

  countByMessageId(messageId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM deepchat_message_traces WHERE message_id = ?')
      .get(messageId) as { count: number }
    return row.count
  }

  maxRequestSeqByMessageId(messageId: string): number {
    const row = this.db
      .prepare(
        'SELECT COALESCE(MAX(request_seq), 0) AS max_seq FROM deepchat_message_traces WHERE message_id = ?'
      )
      .get(messageId) as { max_seq: number }
    return row.max_seq
  }

  deleteByMessageId(messageId: string): void {
    this.db.prepare('DELETE FROM deepchat_message_traces WHERE message_id = ?').run(messageId)
  }

  deleteByMessageIds(messageIds: string[]): void {
    if (messageIds.length === 0) return
    const placeholders = messageIds.map(() => '?').join(', ')
    this.db
      .prepare(`DELETE FROM deepchat_message_traces WHERE message_id IN (${placeholders})`)
      .run(...messageIds)
  }

  deleteBySessionId(sessionId: string): void {
    this.db.prepare('DELETE FROM deepchat_message_traces WHERE session_id = ?').run(sessionId)
  }
}
