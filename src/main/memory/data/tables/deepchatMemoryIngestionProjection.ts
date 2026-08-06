import type Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import type { DeepChatTapeEntryRow } from '@/tape/domain/entry'
import type { TapeMutationProjection } from '@/tape/ports/storage'
import type { MemoryPerfObserver } from '../../../memory/ports'
import {
  readTapeMessageRetractionId,
  readTapeToolIdentity,
  messageRecordHasFinalToolUse,
  tapeEntryToMessageRecord,
  tapeMessageRank,
  tapeToolRank
} from '@/tape/domain/effectiveSemantics'
import { isRetiredWorkflowResultMessageMetadata } from '@shared/orchestration/retiredWorkflowData'

export const DEEPCHAT_MEMORY_INGESTION_PROJECTION_VERSION = 1

export interface DeepChatMemoryIngestionProjectionInput {
  sessionId: string
  messageId: string
  orderSeq: number
  entryId: number
  role: 'user' | 'assistant'
  content: string
  status: 'sent' | 'error'
  hadToolUse: boolean
}

export interface DeepChatMemoryIngestionProjectionRow {
  session_id: string
  message_id: string
  order_seq: number
  entry_id: number
  role: 'user' | 'assistant'
  content: string
  status: 'sent' | 'error'
  had_tool_use: number
}

export interface DeepChatMemoryIngestionProjectionMeta {
  session_id: string
  projection_version: number
  max_entry_id: number
  updated_at: number
}

export interface DeepChatMemoryIngestionCurrentRange {
  current: boolean
  maxEntryId: number
  rows: DeepChatMemoryIngestionProjectionRow[]
}

const REPLACE_MESSAGE_SQL = `
  INSERT INTO deepchat_memory_ingestion_projection (
    session_id,
    message_id,
    order_seq,
    entry_id,
    role,
    content,
    status,
    had_tool_use
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(session_id, message_id) DO UPDATE SET
    order_seq = excluded.order_seq,
    entry_id = excluded.entry_id,
    role = excluded.role,
    content = excluded.content,
    status = excluded.status,
    had_tool_use = excluded.had_tool_use
`

const MEMORY_INGESTION_PROJECTION_SQL = `
  CREATE TABLE IF NOT EXISTS deepchat_memory_ingestion_projection (
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    order_seq INTEGER NOT NULL,
    entry_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('sent', 'error')),
    had_tool_use INTEGER NOT NULL DEFAULT 0 CHECK (had_tool_use IN (0, 1)),
    PRIMARY KEY (session_id, message_id)
  );

  CREATE INDEX IF NOT EXISTS idx_memory_ingestion_projection_range
    ON deepchat_memory_ingestion_projection(session_id, order_seq, message_id);

  CREATE TABLE IF NOT EXISTS deepchat_memory_ingestion_projection_meta (
    session_id TEXT PRIMARY KEY,
    projection_version INTEGER NOT NULL,
    max_entry_id INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`

export class DeepChatMemoryIngestionProjectionTable
  extends BaseTable
  implements TapeMutationProjection
{
  constructor(
    db: Database.Database,
    private readonly perfObserver?: MemoryPerfObserver
  ) {
    super(db, 'deepchat_memory_ingestion_projection')
  }

  getCreateTableSQL(): string {
    return MEMORY_INGESTION_PROJECTION_SQL
  }

  public createTable(): void {
    this.db.exec(MEMORY_INGESTION_PROJECTION_SQL)
  }

  getMigrationSQL(_version: number): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
  }

  getSessionMeta(sessionId: string): DeepChatMemoryIngestionProjectionMeta | null {
    return (
      (this.db
        .prepare(
          `SELECT session_id, projection_version, max_entry_id, updated_at
           FROM deepchat_memory_ingestion_projection_meta
           WHERE session_id = ?`
        )
        .get(sessionId) as DeepChatMemoryIngestionProjectionMeta | undefined) ?? null
    )
  }

  isCurrent(sessionId: string, maxEntryId: number): boolean {
    const meta = this.getSessionMeta(sessionId)
    return (
      meta?.projection_version === DEEPCHAT_MEMORY_INGESTION_PROJECTION_VERSION &&
      meta.max_entry_id === maxEntryId
    )
  }

  /**
   * Applies one authoritative Tape append when the projection was current immediately before it.
   * Returning false means the projection is deliberately stale and must be rebuilt before reading.
   */
  applyAppendedEntry(row: DeepChatTapeEntryRow, previousSessionMaxEntryId: number): boolean {
    const meta = this.getSessionMeta(row.session_id)
    const canInitialize = meta === null && previousSessionMaxEntryId === 0
    const isSequential =
      meta?.projection_version === DEEPCHAT_MEMORY_INGESTION_PROJECTION_VERSION &&
      meta.max_entry_id === previousSessionMaxEntryId

    if (!canInitialize && !isSequential) {
      this.invalidateSession(row.session_id)
      return false
    }

    const retractedMessageId = readTapeMessageRetractionId(row)
    if (retractedMessageId) {
      this.db
        .prepare(
          `DELETE FROM deepchat_memory_ingestion_projection
           WHERE session_id = ? AND message_id = ?`
        )
        .run(row.session_id, retractedMessageId)
      this.invalidateSession(row.session_id)
      return false
    }

    if (row.kind === 'message') {
      const record = tapeEntryToMessageRecord(row)
      if (
        record &&
        tapeMessageRank(record, false) > 0 &&
        !isRetiredWorkflowResultMessageMetadata(record.metadata)
      ) {
        this.upsertMessage({
          sessionId: row.session_id,
          messageId: record.id,
          orderSeq: record.orderSeq,
          entryId: row.entry_id,
          role: record.role,
          content: record.content,
          status: record.status as 'sent' | 'error',
          hadToolUse: messageRecordHasFinalToolUse(record)
        })
      }
    } else if (row.kind === 'tool_call' && tapeToolRank(row, false) > 0) {
      const identity = readTapeToolIdentity(row)
      if (identity) {
        this.db
          .prepare(
            `UPDATE deepchat_memory_ingestion_projection
             SET had_tool_use = 1
             WHERE session_id = ? AND message_id = ?`
          )
          .run(row.session_id, identity.messageId)
        // Final tool facts legitimately arrive before the sent/error assistant message in the live
        // tool loop. The later message derives the same flag from shared effective semantics.
      }
    }

    this.writeMeta(row.session_id, row.entry_id)
    return true
  }

  replaceSession(
    sessionId: string,
    rows: readonly DeepChatMemoryIngestionProjectionInput[],
    maxEntryId: number
  ): void {
    if (!Number.isSafeInteger(maxEntryId) || maxEntryId < 0) {
      throw new Error('Invalid Tape max entry ID for memory ingestion projection rebuild.')
    }

    const replace = this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM deepchat_memory_ingestion_projection WHERE session_id = ?')
        .run(sessionId)
      const insert = this.db.prepare(REPLACE_MESSAGE_SQL)
      for (const row of rows) {
        if (row.sessionId !== sessionId) {
          throw new Error('Memory ingestion projection row belongs to another session.')
        }
        this.assertInput(row)
        insert.run(
          row.sessionId,
          row.messageId,
          row.orderSeq,
          row.entryId,
          row.role,
          row.content,
          row.status,
          row.hadToolUse ? 1 : 0
        )
      }
      this.writeMeta(sessionId, maxEntryId)
    })
    replace()
  }

  listRange(
    sessionId: string,
    fromOrderSeqExclusive: number,
    toOrderSeqInclusive: number
  ): DeepChatMemoryIngestionProjectionRow[] {
    this.perfObserver?.increment('repositoryCalls')
    const rows = this.db
      .prepare(
        `SELECT session_id, message_id, order_seq, entry_id, role, content, status, had_tool_use
         FROM deepchat_memory_ingestion_projection
         WHERE session_id = ?
           AND order_seq > ?
           AND order_seq <= ?
           AND status IN ('sent', 'error')
         ORDER BY order_seq ASC, message_id ASC`
      )
      .all(
        sessionId,
        fromOrderSeqExclusive,
        toOrderSeqInclusive
      ) as DeepChatMemoryIngestionProjectionRow[]

    for (const row of rows) {
      this.assertStoredRow(row)
    }
    this.perfObserver?.increment('materializedRows', rows.length)
    return rows
  }

  readCurrentRange(
    sessionId: string,
    fromOrderSeqExclusive: number,
    toOrderSeqInclusive: number
  ): DeepChatMemoryIngestionCurrentRange {
    this.perfObserver?.increment('repositoryCalls')
    // Read-only infrastructure exception: the Tape head and projection head must be observed by
    // one SQL statement so concurrent appends cannot create a false-current projection window.
    const records = this.db
      .prepare(
        `WITH state AS (
           SELECT
             COALESCE((
               SELECT MAX(entry_id)
               FROM deepchat_tape_entries
               WHERE session_id = ?
             ), 0) AS tape_max_entry_id,
             (
               SELECT max_entry_id
               FROM deepchat_memory_ingestion_projection_meta
               WHERE session_id = ? AND projection_version = ?
             ) AS projection_max_entry_id
         )
         SELECT
           state.tape_max_entry_id,
           state.projection_max_entry_id,
           projection.session_id,
           projection.message_id,
           projection.order_seq,
           projection.entry_id,
           projection.role,
           projection.content,
           projection.status,
           projection.had_tool_use
         FROM state
         LEFT JOIN deepchat_memory_ingestion_projection projection
           ON state.tape_max_entry_id = state.projection_max_entry_id
          AND projection.session_id = ?
          AND projection.order_seq > ?
          AND projection.order_seq <= ?
          AND projection.status IN ('sent', 'error')
         ORDER BY projection.order_seq ASC, projection.message_id ASC`
      )
      .all(
        sessionId,
        sessionId,
        DEEPCHAT_MEMORY_INGESTION_PROJECTION_VERSION,
        sessionId,
        fromOrderSeqExclusive,
        toOrderSeqInclusive
      ) as Array<
      {
        tape_max_entry_id: number
        projection_max_entry_id: number | null
      } & Partial<DeepChatMemoryIngestionProjectionRow>
    >
    const state = records[0]
    const maxEntryId = state?.tape_max_entry_id ?? 0
    const current = state?.projection_max_entry_id === maxEntryId
    if (!current) return { current: false, maxEntryId, rows: [] }
    const rows = records
      .filter(
        (record): record is typeof record & DeepChatMemoryIngestionProjectionRow =>
          record.message_id !== null && record.message_id !== undefined
      )
      .map(
        ({ tape_max_entry_id: _tapeMax, projection_max_entry_id: _projectionMax, ...row }) => row
      )
    rows.forEach((row) => this.assertStoredRow(row))
    this.perfObserver?.increment('materializedRows', rows.length)
    return { current: true, maxEntryId, rows }
  }

  invalidateSession(sessionId: string): void {
    this.db
      .prepare('DELETE FROM deepchat_memory_ingestion_projection_meta WHERE session_id = ?')
      .run(sessionId)
  }

  deleteBySession(sessionId: string): void {
    const remove = this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM deepchat_memory_ingestion_projection WHERE session_id = ?')
        .run(sessionId)
      this.invalidateSession(sessionId)
    })
    remove()
  }

  clearAll(): void {
    const clear = this.db.transaction(() => {
      this.db.prepare('DELETE FROM deepchat_memory_ingestion_projection').run()
      this.db.prepare('DELETE FROM deepchat_memory_ingestion_projection_meta').run()
    })
    clear()
  }

  private upsertMessage(input: DeepChatMemoryIngestionProjectionInput): void {
    this.assertInput(input)
    this.db
      .prepare(
        `INSERT INTO deepchat_memory_ingestion_projection (
           session_id,
           message_id,
           order_seq,
           entry_id,
           role,
           content,
           status,
           had_tool_use
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, message_id) DO UPDATE SET
           order_seq = excluded.order_seq,
           entry_id = excluded.entry_id,
           role = excluded.role,
           content = excluded.content,
           status = excluded.status,
           had_tool_use = deepchat_memory_ingestion_projection.had_tool_use
         WHERE excluded.entry_id > deepchat_memory_ingestion_projection.entry_id`
      )
      .run(
        input.sessionId,
        input.messageId,
        input.orderSeq,
        input.entryId,
        input.role,
        input.content,
        input.status,
        input.hadToolUse ? 1 : 0
      )
  }

  private writeMeta(sessionId: string, maxEntryId: number): void {
    this.db
      .prepare(
        `INSERT INTO deepchat_memory_ingestion_projection_meta (
           session_id,
           projection_version,
           max_entry_id,
           updated_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           projection_version = excluded.projection_version,
           max_entry_id = excluded.max_entry_id,
           updated_at = excluded.updated_at`
      )
      .run(sessionId, DEEPCHAT_MEMORY_INGESTION_PROJECTION_VERSION, maxEntryId, Date.now())
  }

  private assertInput(input: DeepChatMemoryIngestionProjectionInput): void {
    if (
      input.sessionId.length === 0 ||
      input.messageId.length === 0 ||
      !Number.isSafeInteger(input.orderSeq) ||
      !Number.isSafeInteger(input.entryId) ||
      input.entryId <= 0 ||
      (input.role !== 'user' && input.role !== 'assistant') ||
      (input.status !== 'sent' && input.status !== 'error')
    ) {
      throw new Error('Malformed memory ingestion projection input.')
    }
  }

  private assertStoredRow(row: DeepChatMemoryIngestionProjectionRow): void {
    if (
      row.session_id.length === 0 ||
      row.message_id.length === 0 ||
      !Number.isSafeInteger(row.order_seq) ||
      !Number.isSafeInteger(row.entry_id) ||
      row.entry_id <= 0 ||
      (row.role !== 'user' && row.role !== 'assistant') ||
      (row.status !== 'sent' && row.status !== 'error') ||
      (row.had_tool_use !== 0 && row.had_tool_use !== 1)
    ) {
      throw new Error('Malformed memory ingestion projection row.')
    }
  }
}
