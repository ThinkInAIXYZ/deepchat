import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export type DeepChatTapeEntryKind = 'event' | 'anchor' | 'message' | 'tool_call' | 'tool_result'

export type DeepChatTapeSourceType =
  | 'session'
  | 'message'
  | 'assistant_block'
  | 'tool_call'
  | 'tool_result'
  | 'runtime_event'
  | 'migration'
  | 'summary'
  | 'fork'

export interface DeepChatTapeEntryRow {
  session_id: string
  entry_id: number
  kind: DeepChatTapeEntryKind
  name: string | null
  source_type: DeepChatTapeSourceType | null
  source_id: string | null
  source_seq: number | null
  provenance_key: string | null
  payload_json: string
  meta_json: string
  created_at: number
}

export interface DeepChatTapeSourceInput {
  type: DeepChatTapeSourceType
  id: string
  seq?: number | null
}

export interface DeepChatTapeAppendInput {
  sessionId: string
  kind: DeepChatTapeEntryKind
  name?: string | null
  source?: DeepChatTapeSourceInput | null
  provenanceKey?: string | null
  payload: Record<string, unknown>
  meta?: Record<string, unknown>
  createdAt?: number
  idempotent?: boolean
}

export interface DeepChatTapeSearchInput {
  limit?: number
  kinds?: DeepChatTapeEntryKind[]
  startCreatedAt?: number
  endCreatedAt?: number
}

export const SUMMARY_ANCHOR_NAMES = [
  'compaction/auto',
  'compaction/manual',
  'compaction/context_pressure',
  'compaction/resume',
  'compaction/migrated_summary',
  'auto_handoff/context_overflow',
  'summary/reset'
] as const

const RECONSTRUCTION_ANCHOR_NAMES = SUMMARY_ANCHOR_NAMES

const TAPE_ENTRY_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_deepchat_tape_entries_session_kind
    ON deepchat_tape_entries(session_id, kind, entry_id);
  CREATE INDEX IF NOT EXISTS idx_deepchat_tape_entries_session_name
    ON deepchat_tape_entries(session_id, name, entry_id);
  CREATE INDEX IF NOT EXISTS idx_deepchat_tape_entries_session_source
    ON deepchat_tape_entries(session_id, source_type, source_id, source_seq);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_deepchat_tape_entries_session_provenance
    ON deepchat_tape_entries(session_id, provenance_key)
    WHERE provenance_key IS NOT NULL;
`

function safeJsonStringify(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(value ?? {})
}

function buildProvenanceKey(input: DeepChatTapeAppendInput): string | null {
  if (input.provenanceKey !== undefined) {
    return input.provenanceKey
  }
  if (!input.source?.type || !input.source.id) {
    return null
  }
  return [
    input.source.type,
    input.source.id,
    input.source.seq ?? 0,
    input.kind,
    input.name ?? ''
  ].join(':')
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

export class DeepChatTapeEntriesTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'deepchat_tape_entries')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS deepchat_tape_entries (
        session_id TEXT NOT NULL,
        entry_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        name TEXT,
        source_type TEXT,
        source_id TEXT,
        source_seq INTEGER,
        provenance_key TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        meta_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, entry_id)
      );
      ${TAPE_ENTRY_INDEX_SQL}
    `
  }

  public createTable(): void {
    if (!this.tableExists()) {
      this.db.exec(this.getCreateTableSQL())
      return
    }
    this.ensureProvenanceColumns()
    this.db.exec(TAPE_ENTRY_INDEX_SQL)
  }

  getMigrationSQL(_version: number): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
  }

  append(input: DeepChatTapeAppendInput): DeepChatTapeEntryRow {
    const provenanceKey = buildProvenanceKey(input)
    if (input.idempotent && provenanceKey) {
      const existing = this.getByProvenanceKey(input.sessionId, provenanceKey)
      if (existing) {
        return existing
      }
    }

    const createdAt = input.createdAt ?? Date.now()
    const nextEntryId = this.getMaxEntryId(input.sessionId) + 1
    const row = {
      session_id: input.sessionId,
      entry_id: nextEntryId,
      kind: input.kind,
      name: input.name ?? null,
      source_type: input.source?.type ?? null,
      source_id: input.source?.id ?? null,
      source_seq: input.source?.seq ?? null,
      provenance_key: provenanceKey,
      payload_json: safeJsonStringify(input.payload),
      meta_json: safeJsonStringify(input.meta),
      created_at: createdAt
    } satisfies DeepChatTapeEntryRow

    try {
      this.db
        .prepare(
          `INSERT INTO deepchat_tape_entries (
           session_id,
           entry_id,
           kind,
           name,
           source_type,
           source_id,
           source_seq,
           provenance_key,
           payload_json,
           meta_json,
           created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          row.session_id,
          row.entry_id,
          row.kind,
          row.name,
          row.source_type,
          row.source_id,
          row.source_seq,
          row.provenance_key,
          row.payload_json,
          row.meta_json,
          row.created_at
        )
    } catch (error) {
      if (input.idempotent && provenanceKey) {
        const existing = this.getByProvenanceKey(input.sessionId, provenanceKey)
        if (existing) {
          return existing
        }
      }
      throw error
    }

    return row
  }

  appendAnchor(input: {
    sessionId: string
    name: string
    state: Record<string, unknown>
    meta?: Record<string, unknown>
    source?: DeepChatTapeSourceInput | null
    provenanceKey?: string | null
    createdAt?: number
    idempotent?: boolean
  }): DeepChatTapeEntryRow {
    return this.append({
      sessionId: input.sessionId,
      kind: 'anchor',
      name: input.name,
      source: input.source,
      provenanceKey: input.provenanceKey,
      payload: {
        name: input.name,
        state: input.state
      },
      meta: input.meta,
      createdAt: input.createdAt,
      idempotent: input.idempotent
    })
  }

  appendEvent(input: {
    sessionId: string
    name: string
    data: Record<string, unknown>
    meta?: Record<string, unknown>
    source?: DeepChatTapeSourceInput | null
    provenanceKey?: string | null
    createdAt?: number
    idempotent?: boolean
  }): DeepChatTapeEntryRow {
    return this.append({
      sessionId: input.sessionId,
      kind: 'event',
      name: input.name,
      source: input.source,
      provenanceKey: input.provenanceKey,
      payload: {
        name: input.name,
        data: input.data
      },
      meta: input.meta,
      createdAt: input.createdAt,
      idempotent: input.idempotent
    })
  }

  ensureBootstrapAnchor(sessionId: string): void {
    const existing = this.db
      .prepare(
        `SELECT entry_id
         FROM deepchat_tape_entries
         WHERE session_id = ? AND kind = 'anchor'
         ORDER BY entry_id ASC
         LIMIT 1`
      )
      .get(sessionId) as { entry_id: number } | undefined

    if (existing) {
      return
    }

    this.appendAnchor({
      sessionId,
      name: 'session/start',
      source: {
        type: 'session',
        id: sessionId,
        seq: 0
      },
      state: {
        owner: 'human'
      },
      idempotent: true
    })
  }

  getBySession(sessionId: string): DeepChatTapeEntryRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ?
         ORDER BY entry_id ASC`
      )
      .all(sessionId) as DeepChatTapeEntryRow[]
  }

  listMemoryViewManifestAnchorsBySessions(
    sessionIds: string[],
    optionsOrLimit: number | { limit?: number; messageId?: string } = 100
  ): DeepChatTapeEntryRow[] {
    const uniqueSessionIds = [...new Set(sessionIds.filter((id) => id.trim().length > 0))]
    if (uniqueSessionIds.length === 0) {
      return []
    }
    const options = typeof optionsOrLimit === 'number' ? { limit: optionsOrLimit } : optionsOrLimit
    const cappedLimit = Math.min(Math.max(Math.floor(options.limit ?? 100), 1), 500)
    const placeholders = uniqueSessionIds.map(() => '?').join(', ')
    const whereClauses = [
      `session_id IN (${placeholders})`,
      "kind = 'anchor'",
      "name = 'memory/view_assembled'"
    ]
    const params: Array<string | number> = [...uniqueSessionIds]
    if (options.messageId) {
      whereClauses.push("json_extract(meta_json, '$.messageId') = ?")
      params.push(options.messageId)
    }
    params.push(cappedLimit)
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE ${whereClauses.join(' AND ')}
         ORDER BY created_at DESC, entry_id DESC
         LIMIT ?`
      )
      .all(...params) as DeepChatTapeEntryRow[]
  }

  listMemoryViewManifestAnchorsByAgent(
    agentId: string,
    options: { sessionId?: string; limit?: number; messageId?: string } = {}
  ): DeepChatTapeEntryRow[] {
    const cappedLimit = Math.min(Math.max(Math.floor(options.limit ?? 100), 1), 500)
    const whereClauses = [
      'sessions.agent_id = ?',
      "tape.kind = 'anchor'",
      "tape.name = 'memory/view_assembled'"
    ]
    const params: Array<string | number> = [agentId]
    if (options.sessionId) {
      whereClauses.push('tape.session_id = ?')
      params.push(options.sessionId)
    }
    if (options.messageId) {
      whereClauses.push("json_extract(tape.meta_json, '$.messageId') = ?")
      params.push(options.messageId)
    }
    params.push(cappedLimit)
    return this.db
      .prepare(
        `SELECT tape.*
         FROM deepchat_tape_entries AS tape
         INNER JOIN new_sessions AS sessions
           ON sessions.id = tape.session_id
         WHERE ${whereClauses.join(' AND ')}
         ORDER BY tape.created_at DESC, tape.entry_id DESC
         LIMIT ?`
      )
      .all(...params) as DeepChatTapeEntryRow[]
  }

  getEntriesAfter(sessionId: string, entryId: number): DeepChatTapeEntryRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ? AND entry_id > ?
         ORDER BY entry_id ASC`
      )
      .all(sessionId, entryId) as DeepChatTapeEntryRow[]
  }

  getLatestAnchor(sessionId: string): DeepChatTapeEntryRow | undefined {
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ? AND kind = 'anchor'
         ORDER BY entry_id DESC
         LIMIT 1`
      )
      .get(sessionId) as DeepChatTapeEntryRow | undefined
  }

  getAnchors(sessionId: string, limit: number = 20): DeepChatTapeEntryRow[] {
    const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), 100)
    const rows = this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ? AND kind = 'anchor'
         ORDER BY entry_id DESC
         LIMIT ?`
      )
      .all(sessionId, cappedLimit) as DeepChatTapeEntryRow[]

    return rows.reverse()
  }

  getLatestSummaryAnchor(sessionId: string): DeepChatTapeEntryRow | undefined {
    const placeholders = SUMMARY_ANCHOR_NAMES.map(() => '?').join(', ')
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ?
           AND kind = 'anchor'
           AND name IN (${placeholders})
         ORDER BY entry_id DESC
         LIMIT 1`
      )
      .get(sessionId, ...SUMMARY_ANCHOR_NAMES) as DeepChatTapeEntryRow | undefined
  }

  getLatestReconstructionAnchor(sessionId: string): DeepChatTapeEntryRow | undefined {
    const placeholders = RECONSTRUCTION_ANCHOR_NAMES.map(() => '?').join(', ')
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ?
           AND kind = 'anchor'
           AND (
             name IN (${placeholders})
             OR name LIKE 'handoff/%'
             OR name LIKE 'auto_handoff/%'
           )
         ORDER BY entry_id DESC
         LIMIT 1`
      )
      .get(sessionId, ...RECONSTRUCTION_ANCHOR_NAMES) as DeepChatTapeEntryRow | undefined
  }

  getByProvenanceKey(sessionId: string, provenanceKey: string): DeepChatTapeEntryRow | undefined {
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ? AND provenance_key = ?
         LIMIT 1`
      )
      .get(sessionId, provenanceKey) as DeepChatTapeEntryRow | undefined
  }

  getMaxEntryId(sessionId: string): number {
    const row = this.db
      .prepare(
        `SELECT MAX(entry_id) AS max_entry_id
         FROM deepchat_tape_entries
         WHERE session_id = ?`
      )
      .get(sessionId) as { max_entry_id: number | null } | undefined
    return row?.max_entry_id ?? 0
  }

  countAnchorsBySession(sessionId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM deepchat_tape_entries
         WHERE session_id = ? AND kind = 'anchor'`
      )
      .get(sessionId) as { count: number } | undefined
    return row?.count ?? 0
  }

  countEntriesAfter(sessionId: string, entryId: number): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM deepchat_tape_entries
         WHERE session_id = ? AND entry_id > ?`
      )
      .get(sessionId, entryId) as { count: number } | undefined
    return row?.count ?? 0
  }

  countBySession(sessionId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM deepchat_tape_entries
         WHERE session_id = ?`
      )
      .get(sessionId) as { count: number } | undefined
    return row?.count ?? 0
  }

  search(
    sessionId: string,
    query: string,
    options: DeepChatTapeSearchInput = {}
  ): DeepChatTapeEntryRow[] {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) {
      return []
    }
    const limit = Number.isFinite(options.limit) ? (options.limit as number) : 20
    const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), 100)
    const whereClauses = [
      'session_id = ?',
      "(payload_json LIKE ? ESCAPE '\\' OR meta_json LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\')"
    ]
    const queryPattern = `%${escapeLikePattern(normalizedQuery)}%`
    const params: Array<string | number> = [sessionId, queryPattern, queryPattern, queryPattern]

    if (options.kinds?.length) {
      whereClauses.push(`kind IN (${options.kinds.map(() => '?').join(', ')})`)
      params.push(...options.kinds)
    }

    if (Number.isFinite(options.startCreatedAt)) {
      whereClauses.push('created_at >= ?')
      params.push(options.startCreatedAt as number)
    }

    if (Number.isFinite(options.endCreatedAt)) {
      whereClauses.push('created_at <= ?')
      params.push(options.endCreatedAt as number)
    }

    params.push(cappedLimit)

    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_entries
         WHERE ${whereClauses.join(' AND ')}
         ORDER BY entry_id DESC
         LIMIT ?`
      )
      .all(...params) as DeepChatTapeEntryRow[]
  }

  deleteBySession(sessionId: string): void {
    this.db.prepare('DELETE FROM deepchat_tape_entries WHERE session_id = ?').run(sessionId)
  }

  private ensureProvenanceColumns(): void {
    const columns: Array<[string, string]> = [
      ['source_type', 'TEXT'],
      ['source_id', 'TEXT'],
      ['source_seq', 'INTEGER'],
      ['provenance_key', 'TEXT']
    ]
    for (const [columnName, columnType] of columns) {
      if (!this.hasColumn(columnName)) {
        this.db.exec(`ALTER TABLE deepchat_tape_entries ADD COLUMN ${columnName} ${columnType}`)
      }
    }
  }
}
