import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import type {
  TapeInspectorSort,
  TapeInspectorPageMode,
  TapeInspectorFactRecord
} from '@shared/types/tape-inspector'
import type { DimSessionBinding } from './dimSessionBindings'

export interface DimInspectorHead {
  id: string
  sessionId: string
  nativeSessionId: string
  branchId: string
  generation: number
  cursor: string
}
interface HeadRow {
  id: string
  session_id: string
  native_session_id: string
  branch_id: string
  generation: number
  cursor: string
}

/** Rebuildable inspector metadata only. Canonical payloads remain with dim's storage owner. */
export class DimTimelineInspectorTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'dim_timeline_inspector_heads')
  }
  getCreateTableSQL(): string {
    return `CREATE TABLE IF NOT EXISTS dim_timeline_inspector_heads (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, native_session_id TEXT NOT NULL,
      branch_id TEXT NOT NULL, generation INTEGER NOT NULL, cursor TEXT NOT NULL DEFAULT '0',
      UNIQUE(session_id, native_session_id, branch_id, generation)
    );
    CREATE TABLE IF NOT EXISTS dim_timeline_inspector_facts (
      entry_id INTEGER PRIMARY KEY AUTOINCREMENT, head_id TEXT NOT NULL,
      event_id TEXT NOT NULL, ordinal INTEGER NOT NULL, sequence TEXT NOT NULL,
      turn_id TEXT, request_id TEXT, request_seq INTEGER,
      name TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL,
      fact_json TEXT NOT NULL,
      UNIQUE(head_id,event_id,ordinal),
      FOREIGN KEY(head_id) REFERENCES dim_timeline_inspector_heads(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_dim_inspector_order ON dim_timeline_inspector_facts(head_id,entry_id);
    CREATE INDEX IF NOT EXISTS idx_dim_inspector_name ON dim_timeline_inspector_facts(head_id,name,entry_id);
    CREATE INDEX IF NOT EXISTS idx_dim_inspector_kind ON dim_timeline_inspector_facts(head_id,kind,entry_id);
    CREATE INDEX IF NOT EXISTS idx_dim_inspector_created ON dim_timeline_inspector_facts(head_id,created_at,entry_id);
    CREATE INDEX IF NOT EXISTS idx_dim_inspector_requests ON dim_timeline_inspector_facts(head_id,turn_id,request_id);`
  }
  override createTable(): void {
    this.db.exec(this.getCreateTableSQL())
  }

  getLatestVersion(): number {
    return 0
  }
  getMigrationSQL(): null {
    return null
  }

  head(
    scope: Pick<DimSessionBinding, 'sessionId' | 'dimSessionId' | 'branchId' | 'generation'>
  ): DimInspectorHead {
    const read = this.db.prepare(`SELECT * FROM dim_timeline_inspector_heads
      WHERE session_id=? AND native_session_id=? AND branch_id=? AND generation=?`)
    const values = [scope.sessionId, scope.dimSessionId, scope.branchId, scope.generation]
    let row = read.get(...values) as HeadRow | undefined
    // Every committed native event yields a row. Losing the entire derived index resets cursors.
    if (
      row &&
      row.cursor !== '0' &&
      !this.db
        .prepare('SELECT 1 FROM dim_timeline_inspector_facts WHERE head_id=? LIMIT 1')
        .get(row.id)
    ) {
      this.db.prepare('DELETE FROM dim_timeline_inspector_heads WHERE id=?').run(row.id)
      row = undefined
    }
    if (!row) {
      this.db
        .prepare(`INSERT INTO dim_timeline_inspector_heads
        (id,session_id,native_session_id,branch_id,generation) VALUES (?,?,?,?,?)`)
        .run(randomUUID(), ...values)
      row = read.get(...values) as HeadRow
    }
    return {
      id: row.id,
      sessionId: row.session_id,
      nativeSessionId: row.native_session_id,
      branchId: row.branch_id,
      generation: row.generation,
      cursor: row.cursor
    }
  }

  requestSequence(head: DimInspectorHead, turnId?: string, requestId?: string): number | undefined {
    if (!turnId || !requestId) return undefined
    const existing = this.db
      .prepare(`SELECT request_seq FROM dim_timeline_inspector_facts
      WHERE head_id=? AND turn_id=? AND request_id=? LIMIT 1`)
      .get(head.id, turnId, requestId) as { request_seq: number } | undefined
    if (existing) return existing.request_seq
    const row = this.db
      .prepare(`SELECT COALESCE(MAX(request_seq),0)+1 AS next FROM dim_timeline_inspector_facts
      WHERE head_id=? AND turn_id=?`)
      .get(head.id, turnId) as { next: number }
    return row.next
  }

  put(
    head: DimInspectorHead,
    event: { id: string; sequence: string; createdAt: number; name: string },
    ordinal: number,
    fact: Omit<TapeInspectorFactRecord, 'entryId' | 'key'>,
    requestId?: string
  ): number {
    return this.db.transaction(() => {
      this.db
        .prepare(`INSERT OR IGNORE INTO dim_timeline_inspector_facts
        (head_id,event_id,ordinal,sequence,turn_id,request_id,request_seq,name,kind,created_at,fact_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(
          head.id,
          event.id,
          ordinal,
          event.sequence,
          fact.runId ?? null,
          requestId ?? null,
          fact.requestSeq ?? null,
          event.name,
          fact.kind,
          event.createdAt,
          '{}'
        )
      const row = this.db
        .prepare(
          `SELECT entry_id FROM dim_timeline_inspector_facts WHERE head_id=? AND event_id=? AND ordinal=?`
        )
        .get(head.id, event.id, ordinal) as { entry_id: number }
      this.db
        .prepare(
          'UPDATE dim_timeline_inspector_facts SET fact_json=? WHERE entry_id=? AND head_id=?'
        )
        .run(
          JSON.stringify({ ...fact, entryId: row.entry_id, key: `entry:${row.entry_id}` }),
          row.entry_id,
          head.id
        )
      return row.entry_id
    })()
  }

  advance(head: DimInspectorHead, cursor: string): void {
    this.db
      .prepare('UPDATE dim_timeline_inspector_heads SET cursor=? WHERE id=?')
      .run(cursor, head.id)
  }
  max(head: DimInspectorHead): number {
    return (
      this.db
        .prepare(
          'SELECT COALESCE(MAX(entry_id),0) AS max FROM dim_timeline_inspector_facts WHERE head_id=?'
        )
        .get(head.id) as { max: number }
    ).max
  }
  get(head: DimInspectorHead, id: number): TapeInspectorFactRecord | null {
    const row = this.db
      .prepare('SELECT fact_json FROM dim_timeline_inspector_facts WHERE head_id=? AND entry_id=?')
      .get(head.id, id) as { fact_json: string } | undefined
    return row ? JSON.parse(row.fact_json) : null
  }
  scan(
    head: DimInspectorHead,
    input: {
      sort: TapeInspectorSort
      mode: TapeInspectorPageMode
      cursor?: TapeInspectorFactRecord
      snapshot: number
      limit: number
    }
  ): { records: TapeInspectorFactRecord[]; hasMore: boolean } {
    const { sort, cursor } = input
    if (sort.column !== 'entryId' && input.mode === 'newer')
      throw new Error('Live pages require canonical ordering')
    const column = { entryId: 'entry_id', name: 'name', kind: 'kind', createdAt: 'created_at' }[
      sort.column
    ]
    const direction =
      sort.column === 'entryId'
        ? input.mode === 'newer'
          ? 'ASC'
          : 'DESC'
        : sort.direction === 'asc'
          ? 'ASC'
          : 'DESC'
    const compare = direction === 'ASC' ? '>' : '<'
    const params: Array<string | number> = [head.id, input.snapshot]
    let seek = ''
    if (cursor) {
      if (sort.column === 'entryId') {
        seek = `AND entry_id ${compare} ?`
        params.push(cursor.entryId)
      } else {
        const value =
          sort.column === 'name'
            ? (cursor.name ?? '')
            : sort.column === 'kind'
              ? cursor.kind
              : cursor.createdAt
        seek = `AND (${column} ${compare} ? OR (${column} = ? AND entry_id ${compare} ?))`
        params.push(value, value, cursor.entryId)
      }
    }
    const limit = Math.max(1, Math.min(500, Math.floor(input.limit)))
    const rows = this.db
      .prepare(`SELECT fact_json FROM dim_timeline_inspector_facts
      WHERE head_id=? AND entry_id<=? ${seek} ORDER BY ${column} ${direction}${sort.column === 'entryId' ? '' : `, entry_id ${direction}`} LIMIT ?`)
      .all(...params, limit + 1) as Array<{ fact_json: string }>
    return {
      records: rows.slice(0, limit).map((row) => JSON.parse(row.fact_json)),
      hasMore: rows.length > limit
    }
  }

  toolFact(
    head: DimInspectorHead,
    requestId: string,
    callId: string
  ): TapeInspectorFactRecord | null {
    const rows = this.db
      .prepare(`SELECT fact_json FROM dim_timeline_inspector_facts WHERE head_id=? AND request_id=?
      AND json_extract(fact_json,'$.providerToolCallId')=? ORDER BY entry_id DESC LIMIT 1`)
      .get(head.id, requestId, callId) as { fact_json: string } | undefined
    return rows ? JSON.parse(rows.fact_json) : null
  }

  deleteBySession(sessionId: string): void {
    this.db
      .prepare(
        'DELETE FROM dim_timeline_inspector_facts WHERE head_id IN (SELECT id FROM dim_timeline_inspector_heads WHERE session_id=?)'
      )
      .run(sessionId)
    this.db.prepare('DELETE FROM dim_timeline_inspector_heads WHERE session_id=?').run(sessionId)
  }
}
