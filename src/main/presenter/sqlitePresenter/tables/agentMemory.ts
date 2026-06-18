import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export type AgentMemoryKind = 'episodic' | 'semantic' | 'reflection' | 'persona'

export type AgentMemoryStatus = 'pending_embedding' | 'embedded' | 'error' | 'fts_only'

export interface AgentMemoryRow {
  id: string
  agent_id: string
  user_scope: string | null
  kind: AgentMemoryKind
  content: string
  importance: number
  status: AgentMemoryStatus
  embedding_id: string | null
  embedding_dim: number | null
  embedding_model: string | null
  source_session: string | null
  provenance_key: string | null
  is_anchor: number
  superseded_by: string | null
  created_at: number
  last_accessed: number | null
  access_count: number
  decay_score: number | null
  source_entry_ids: string | null
}

export interface AgentMemoryInsertInput {
  id: string
  agentId: string
  kind: AgentMemoryKind
  content: string
  importance?: number
  status?: AgentMemoryStatus
  userScope?: string | null
  sourceSession?: string | null
  provenanceKey?: string | null
  isAnchor?: boolean
  createdAt?: number
  sourceEntryIds?: number[] | null
}

export interface AgentMemoryListOptions {
  kinds?: AgentMemoryKind[]
  statuses?: AgentMemoryStatus[]
  includeSuperseded?: boolean
  limit?: number
}

// Global migration version shared across all tables (see SQLitePresenter.migrate). This is the
// first agent_memory migration and must stay above the previous ceiling so it actually runs.
const AGENT_MEMORY_SCHEMA_VERSION = 32

type FtsCapability = { available: boolean; tokenizer: 'trigram' | 'unicode61' }

const AGENT_MEMORY_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_kind
    ON agent_memory(agent_id, kind, status);
  CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_active
    ON agent_memory(agent_id, superseded_by);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memory_provenance
    ON agent_memory(agent_id, provenance_key)
    WHERE provenance_key IS NOT NULL;
`

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

function serializeSourceEntryIds(ids: number[] | null | undefined): string | null {
  if (!ids?.length) return null
  const valid = ids.filter((id) => Number.isInteger(id) && id >= 0)
  return valid.length ? JSON.stringify(valid) : null
}

export class AgentMemoryTable extends BaseTable {
  private ftsCapability: FtsCapability | undefined
  private ftsReady = false

  constructor(db: Database.Database) {
    super(db, 'agent_memory')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS agent_memory (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        user_scope TEXT,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5,
        status TEXT NOT NULL DEFAULT 'pending_embedding',
        embedding_id TEXT,
        embedding_dim INTEGER,
        embedding_model TEXT,
        source_session TEXT,
        provenance_key TEXT,
        is_anchor INTEGER NOT NULL DEFAULT 0,
        superseded_by TEXT,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER,
        access_count INTEGER NOT NULL DEFAULT 0,
        decay_score REAL,
        source_entry_ids TEXT
      );
      ${AGENT_MEMORY_INDEX_SQL}
    `
  }

  override createTable(): void {
    if (!this.tableExists()) {
      this.db.exec(this.getCreateTableSQL())
    } else {
      this.db.exec(AGENT_MEMORY_INDEX_SQL)
    }
    this.ensureFtsIndex()
  }

  getMigrationSQL(version: number): string | null {
    if (version === AGENT_MEMORY_SCHEMA_VERSION) {
      // FTS5 objects are (re)built idempotently in ensureFtsIndex() because the tokenizer is
      // chosen from runtime capabilities; only columns land here for existing databases.
      // source_entry_ids first shipped without its own migration, so older tables lack it; it is
      // backfilled alongside embedding_model. Duplicate ADD COLUMN is ignored by the runner.
      return [
        'ALTER TABLE agent_memory ADD COLUMN embedding_model TEXT;',
        'ALTER TABLE agent_memory ADD COLUMN source_entry_ids TEXT;'
      ].join('\n')
    }
    return null
  }

  getLatestVersion(): number {
    return AGENT_MEMORY_SCHEMA_VERSION
  }

  // Detects the best available FTS5 tokenizer once per connection. trigram gives substring
  // matching across languages (including CJK) but only indexes >=3 character fragments;
  // unicode61 is the word-boundary fallback; neither means FTS5 is unavailable.
  private detectFtsCapability(): FtsCapability {
    if (this.ftsCapability) return this.ftsCapability
    const probe = (tokenizer: string): boolean => {
      const name = `temp.fts5_probe_${tokenizer}`
      try {
        this.db.exec(
          `CREATE VIRTUAL TABLE IF NOT EXISTS ${name} USING fts5(c, tokenize='${tokenizer}');`
        )
        this.db.exec(`DROP TABLE IF EXISTS ${name};`)
        return true
      } catch {
        return false
      }
    }
    if (probe('trigram')) this.ftsCapability = { available: true, tokenizer: 'trigram' }
    else if (probe('unicode61')) this.ftsCapability = { available: true, tokenizer: 'unicode61' }
    else this.ftsCapability = { available: false, tokenizer: 'unicode61' }
    return this.ftsCapability
  }

  private ftsTableExists(): boolean {
    const row = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_memory_fts'`)
      .get()
    return !!row
  }

  // Creates the external-content FTS5 mirror of agent_memory and the triggers that keep it in
  // sync, then backfills existing rows the first time it is built. Idempotent and a no-op when
  // FTS5 is unavailable (search falls back to LIKE). superseded rows stay in the index and are
  // filtered at query time, so supersede updates need not touch it.
  private ensureFtsIndex(): void {
    const capability = this.detectFtsCapability()
    if (!capability.available) {
      this.ftsReady = false
      return
    }
    const alreadyBuilt = this.ftsTableExists()
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory_fts USING fts5(
        content,
        agent_id UNINDEXED,
        content='agent_memory',
        content_rowid='rowid',
        tokenize='${capability.tokenizer}'
      );
      CREATE TRIGGER IF NOT EXISTS agent_memory_fts_ai AFTER INSERT ON agent_memory BEGIN
        INSERT INTO agent_memory_fts(rowid, content, agent_id)
        VALUES (new.rowid, new.content, new.agent_id);
      END;
      CREATE TRIGGER IF NOT EXISTS agent_memory_fts_ad AFTER DELETE ON agent_memory BEGIN
        INSERT INTO agent_memory_fts(agent_memory_fts, rowid, content, agent_id)
        VALUES ('delete', old.rowid, old.content, old.agent_id);
      END;
      CREATE TRIGGER IF NOT EXISTS agent_memory_fts_au AFTER UPDATE OF content ON agent_memory BEGIN
        INSERT INTO agent_memory_fts(agent_memory_fts, rowid, content, agent_id)
        VALUES ('delete', old.rowid, old.content, old.agent_id);
        INSERT INTO agent_memory_fts(rowid, content, agent_id)
        VALUES (new.rowid, new.content, new.agent_id);
      END;
    `)
    if (!alreadyBuilt) {
      this.db.exec(
        `INSERT INTO agent_memory_fts(rowid, content, agent_id)
         SELECT rowid, content, agent_id FROM agent_memory;`
      )
    }
    this.ftsReady = true
  }

  insert(input: AgentMemoryInsertInput): AgentMemoryRow {
    const row: AgentMemoryRow = {
      id: input.id,
      agent_id: input.agentId,
      user_scope: input.userScope ?? null,
      kind: input.kind,
      content: input.content,
      importance: input.importance ?? 0.5,
      status: input.status ?? 'pending_embedding',
      embedding_id: null,
      embedding_dim: null,
      embedding_model: null,
      source_session: input.sourceSession ?? null,
      provenance_key: input.provenanceKey ?? null,
      is_anchor: input.isAnchor ? 1 : 0,
      superseded_by: null,
      created_at: input.createdAt ?? Date.now(),
      last_accessed: null,
      access_count: 0,
      decay_score: null,
      source_entry_ids: serializeSourceEntryIds(input.sourceEntryIds)
    }

    this.db
      .prepare(
        `INSERT INTO agent_memory (
           id,
           agent_id,
           user_scope,
           kind,
           content,
           importance,
           status,
           embedding_id,
           embedding_dim,
           embedding_model,
           source_session,
           provenance_key,
           is_anchor,
           superseded_by,
           created_at,
           last_accessed,
           access_count,
           decay_score,
           source_entry_ids
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.agent_id,
        row.user_scope,
        row.kind,
        row.content,
        row.importance,
        row.status,
        row.embedding_id,
        row.embedding_dim,
        row.embedding_model,
        row.source_session,
        row.provenance_key,
        row.is_anchor,
        row.superseded_by,
        row.created_at,
        row.last_accessed,
        row.access_count,
        row.decay_score,
        row.source_entry_ids
      )

    return row
  }

  getById(id: string): AgentMemoryRow | undefined {
    return this.db.prepare('SELECT * FROM agent_memory WHERE id = ?').get(id) as
      | AgentMemoryRow
      | undefined
  }

  getByProvenanceKey(agentId: string, provenanceKey: string): AgentMemoryRow | undefined {
    return this.db
      .prepare('SELECT * FROM agent_memory WHERE agent_id = ? AND provenance_key = ? LIMIT 1')
      .get(agentId, provenanceKey) as AgentMemoryRow | undefined
  }

  listByAgent(agentId: string, options: AgentMemoryListOptions = {}): AgentMemoryRow[] {
    const where: string[] = ['agent_id = ?']
    const params: Array<string | number> = [agentId]

    if (!options.includeSuperseded) {
      where.push('superseded_by IS NULL')
    }
    if (options.kinds?.length) {
      where.push(`kind IN (${options.kinds.map(() => '?').join(', ')})`)
      params.push(...options.kinds)
    }
    if (options.statuses?.length) {
      where.push(`status IN (${options.statuses.map(() => '?').join(', ')})`)
      params.push(...options.statuses)
    }

    let sql = `SELECT * FROM agent_memory WHERE ${where.join(' AND ')} ORDER BY created_at DESC`
    if (Number.isFinite(options.limit)) {
      sql += ' LIMIT ?'
      params.push(Math.max(1, Math.floor(options.limit as number)))
    }

    return this.db.prepare(sql).all(...params) as AgentMemoryRow[]
  }

  getActivePersona(agentId: string): AgentMemoryRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM agent_memory
         WHERE agent_id = ? AND kind = 'persona' AND superseded_by IS NULL
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(agentId) as AgentMemoryRow | undefined
  }

  listPersonaVersions(agentId: string): AgentMemoryRow[] {
    return this.db
      .prepare(
        `SELECT * FROM agent_memory
         WHERE agent_id = ? AND kind = 'persona'
         ORDER BY created_at DESC`
      )
      .all(agentId) as AgentMemoryRow[]
  }

  // Keyword recall: BM25-ranked FTS5 hits first, then any LIKE-only substring matches the
  // tokenizer missed (e.g. <3 character queries under trigram). LIKE always runs and is unioned
  // in full so the result is never a subset of the old LIKE behavior — gating LIKE behind the cap
  // would silently drop high-importance rows whenever FTS5 alone filled it. Each path is bounded
  // by `limit`, so the union is bounded by `2 * limit`; downstream RRF reranks and trims.
  search(agentId: string, query: string, limit: number = 20): AgentMemoryRow[] {
    const normalized = query.trim()
    if (!normalized) {
      return []
    }
    const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), 100)
    const ordered: AgentMemoryRow[] = []
    const seen = new Set<string>()
    const collect = (rows: AgentMemoryRow[]): void => {
      for (const row of rows) {
        if (seen.has(row.id)) continue
        seen.add(row.id)
        ordered.push(row)
      }
    }
    if (this.ftsReady) {
      collect(this.searchFts(agentId, normalized, cappedLimit))
    }
    collect(this.searchLike(agentId, normalized, cappedLimit))
    return ordered
  }

  private searchFts(agentId: string, normalized: string, limit: number): AgentMemoryRow[] {
    // Quote the whole query as a phrase so FTS5 operators in user text can never break the MATCH.
    const match = `"${normalized.replace(/"/g, '""')}"`
    try {
      return this.db
        .prepare(
          `SELECT am.* FROM agent_memory_fts f
           JOIN agent_memory am ON am.rowid = f.rowid
           WHERE agent_memory_fts MATCH ?
             AND am.agent_id = ?
             AND am.superseded_by IS NULL
           ORDER BY bm25(agent_memory_fts)
           LIMIT ?`
        )
        .all(match, agentId, limit) as AgentMemoryRow[]
    } catch {
      // A query the tokenizer cannot match (too short, odd syntax) yields no FTS hits; LIKE covers it.
      return []
    }
  }

  private searchLike(agentId: string, normalized: string, limit: number): AgentMemoryRow[] {
    const pattern = `%${escapeLikePattern(normalized)}%`
    return this.db
      .prepare(
        `SELECT * FROM agent_memory
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND content LIKE ? ESCAPE '\\'
         ORDER BY importance DESC, created_at DESC
         LIMIT ?`
      )
      .all(agentId, pattern, limit) as AgentMemoryRow[]
  }

  listPendingEmbedding(limit: number = 50, agentId?: string): AgentMemoryRow[] {
    const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), 500)
    if (agentId) {
      return this.db
        .prepare(
          `SELECT * FROM agent_memory
           WHERE status = 'pending_embedding' AND kind != 'persona' AND agent_id = ?
           ORDER BY created_at ASC
           LIMIT ?`
        )
        .all(agentId, cappedLimit) as AgentMemoryRow[]
    }
    return this.db
      .prepare(
        `SELECT * FROM agent_memory
         WHERE status = 'pending_embedding' AND kind != 'persona'
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .all(cappedLimit) as AgentMemoryRow[]
  }

  updateStatus(
    id: string,
    status: AgentMemoryStatus,
    embedding?: {
      embeddingId?: string | null
      embeddingDim?: number | null
      embeddingModel?: string | null
    }
  ): void {
    this.db
      .prepare(
        `UPDATE agent_memory
         SET status = ?, embedding_id = ?, embedding_dim = ?, embedding_model = ?
         WHERE id = ?`
      )
      .run(
        status,
        embedding?.embeddingId ?? null,
        embedding?.embeddingDim ?? null,
        embedding?.embeddingModel ?? null,
        id
      )
  }

  // Resets the embedding state of the agent's non-superseded rows in `statuses` back to
  // pending_embedding in a single statement (no per-row round trips), so a reindex/backfill can
  // re-queue a whole corpus without blocking. persona rows are excluded: the self-model is
  // injected verbatim, never vector-recalled, so it must stay out of the vector store. Status
  // changes do not touch content, so the FTS triggers (UPDATE OF content) never fire here.
  // Returns the number of rows changed.
  requeueForEmbedding(agentId: string, statuses: AgentMemoryStatus[]): number {
    if (!statuses.length) return 0
    const placeholders = statuses.map(() => '?').join(', ')
    const result = this.db
      .prepare(
        `UPDATE agent_memory
         SET status = 'pending_embedding',
             embedding_id = NULL,
             embedding_dim = NULL,
             embedding_model = NULL
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND kind != 'persona'
           AND status IN (${placeholders})`
      )
      .run(agentId, ...statuses)
    return result.changes
  }

  markSuperseded(id: string, supersededBy: string | null): void {
    this.db.prepare('UPDATE agent_memory SET superseded_by = ? WHERE id = ?').run(supersededBy, id)
  }

  recordAccess(id: string, accessedAt: number = Date.now()): void {
    this.db
      .prepare(
        `UPDATE agent_memory
         SET last_accessed = ?, access_count = access_count + 1
         WHERE id = ?`
      )
      .run(accessedAt, id)
  }

  updateDecayScore(id: string, decayScore: number | null): void {
    this.db.prepare('UPDATE agent_memory SET decay_score = ? WHERE id = ?').run(decayScore, id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM agent_memory WHERE id = ?').run(id)
  }

  clearByAgent(agentId: string): number {
    const result = this.db.prepare('DELETE FROM agent_memory WHERE agent_id = ?').run(agentId)
    return result.changes
  }

  countByAgent(agentId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM agent_memory WHERE agent_id = ?')
      .get(agentId) as { count: number } | undefined
    return row?.count ?? 0
  }
}
