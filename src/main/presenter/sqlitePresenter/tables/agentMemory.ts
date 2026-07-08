import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'
import {
  AGENT_MEMORY_CATEGORIES,
  AGENT_MEMORY_HEALTH_KIND_KEYS,
  AGENT_MEMORY_HEALTH_STATUS_KEYS,
  type AgentMemoryCategory,
  type AgentMemoryHealthCategory
} from '@shared/types/agent-memory'

// 'working' is an internal session-open injection cache (a single blob row per agent); it is never
// recalled, embedded, reflected on, or archived. A 'crystal' kind (3+ corroborated sources) is a
// reserved future layer with no read/write path yet.
export type AgentMemoryKind = (typeof AGENT_MEMORY_HEALTH_KIND_KEYS)[number]

export type AgentMemoryStatus = (typeof AGENT_MEMORY_HEALTH_STATUS_KEYS)[number]

export type AgentMemoryConflictState = 'challenged'

// Persona lifecycle, only meaningful for kind='persona' (NULL for every other kind). A new self-model
// lands as 'draft' and is never injected until the user approves it ('active'). Legacy persona rows
// predate this column (NULL) and are read as active only while not superseded.
export type AgentMemoryPersonaState = 'draft' | 'active' | 'superseded' | 'rejected'

export interface AgentMemoryRow {
  id: string
  agent_id: string
  user_scope: string | null
  kind: AgentMemoryKind
  category: string | null
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
  confidence: number | null
  last_consolidated_at: number | null
  conflict_state: string | null
  conflict_with: string | null
  persona_state: string | null
}

export interface AgentMemoryWorkingCandidateCursor {
  importance: number
  accessCount: number
  createdAt: number
  id: string
}

export type AgentMemoryLifecycleRow = Pick<
  AgentMemoryRow,
  | 'id'
  | 'agent_id'
  | 'kind'
  | 'importance'
  | 'status'
  | 'is_anchor'
  | 'superseded_by'
  | 'created_at'
  | 'last_accessed'
  | 'access_count'
  | 'decay_score'
  | 'confidence'
>

export interface AgentMemoryInsertInput {
  id: string
  agentId: string
  kind: AgentMemoryKind
  category?: AgentMemoryCategory | null
  content: string
  importance?: number
  status?: AgentMemoryStatus
  userScope?: string | null
  sourceSession?: string | null
  provenanceKey?: string | null
  isAnchor?: boolean
  createdAt?: number
  sourceEntryIds?: number[] | null
  conflictWith?: string | null
  personaState?: AgentMemoryPersonaState | null
}

export interface AgentMemoryListOptions {
  kinds?: AgentMemoryKind[]
  statuses?: AgentMemoryStatus[]
  includeSuperseded?: boolean
  includeArchived?: boolean
  limit?: number
}

export interface AgentMemoryHealthStats {
  totalRows: number
  byKind: Record<AgentMemoryKind, number>
  byCategory: Record<AgentMemoryHealthCategory, number>
  byStatus: Record<AgentMemoryStatus, number>
  neverAccessed: number
  importanceAvg: number | null
  importanceMedian: number | null
  confidenceAvg: number | null
  conflicted: number
  challenged: number
}

// Global migration version shared across all tables (see SQLitePresenter.migrate). v32 backfilled
// embedding_model + source_entry_ids; v33 adds the consolidation/forgetting columns; v34 adds the
// persona lifecycle column; v35 adds conflict linkage; v37 adds agentic category.
const AGENT_MEMORY_SCHEMA_VERSION = 37

const AGENT_MEMORY_FTS_META_KEY = 'agent_memory_fts'
const AGENT_MEMORY_FTS_META_VERSION = 1

type FtsCapability = { available: boolean; tokenizer: 'trigram' | 'unicode61' }
type MathFunctionCapability = { available: boolean }
type SearchMatchMode = 'all' | 'any'
type RecallKeywordTermStat = { term: string; hitCount: number; totalRows: number }

const AGENT_MEMORY_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_kind
    ON agent_memory(agent_id, kind, status);
  CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_active
    ON agent_memory(agent_id, superseded_by);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memory_provenance
    ON agent_memory(agent_id, provenance_key)
    WHERE provenance_key IS NOT NULL;
`

function tokenizeSearchQuery(query: string): string[] {
  return query
    .trim()
    .split(/\s+/u)
    .map((term) => term.trim())
    .filter(Boolean)
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

function serializeSourceEntryIds(ids: number[] | null | undefined): string | null {
  if (!ids?.length) return null
  const valid = ids.filter((id) => Number.isInteger(id) && id >= 0)
  return valid.length ? JSON.stringify(valid) : null
}

function readAggregateNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readAggregateNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function calculateDecayScoreForRow(row: AgentMemoryRow, now: number, halfLifeMs: number): number {
  const anchor = row.last_accessed ?? row.created_at
  const age = Math.max(0, now - anchor)
  const importance = Math.min(1, Math.max(0, row.importance))
  return Math.pow(0.5, age / (halfLifeMs * (1 + importance)))
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function aggregateAlias(prefix: string, key: string): string {
  return `${prefix}_${key}`
}

function buildCountCaseAggregates(
  column: 'kind' | 'category' | 'status',
  prefix: string,
  keys: readonly string[]
): string {
  return keys
    .map(
      (key) =>
        `SUM(CASE WHEN ${column} = ${sqlLiteral(key)} THEN 1 ELSE 0 END) AS ${aggregateAlias(
          prefix,
          key
        )}`
    )
    .join(',\n           ')
}

function readAggregateRecord<const Keys extends readonly string[]>(
  row: Record<string, unknown> | undefined,
  prefix: string,
  keys: Keys
): Record<Keys[number], number> {
  return Object.fromEntries(
    keys.map((key) => [key, readAggregateNumber(row?.[aggregateAlias(prefix, key)])])
  ) as Record<Keys[number], number>
}

export class AgentMemoryTable extends BaseTable {
  private ftsCapability: FtsCapability | undefined
  private mathFunctionCapability: MathFunctionCapability | undefined
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
        category TEXT,
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
        source_entry_ids TEXT,
        confidence REAL,
        last_consolidated_at INTEGER,
        conflict_state TEXT,
        conflict_with TEXT,
        persona_state TEXT
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
    if (version === 32) {
      // FTS5 objects are (re)built idempotently in ensureFtsIndex() because the tokenizer is
      // chosen from runtime capabilities; only columns land here for existing databases.
      // source_entry_ids first shipped without its own migration, so older tables lack it; it is
      // backfilled alongside embedding_model. Duplicate ADD COLUMN is ignored by the runner.
      return [
        'ALTER TABLE agent_memory ADD COLUMN embedding_model TEXT;',
        'ALTER TABLE agent_memory ADD COLUMN source_entry_ids TEXT;'
      ].join('\n')
    }
    if (version === 33) {
      return [
        'ALTER TABLE agent_memory ADD COLUMN confidence REAL;',
        'ALTER TABLE agent_memory ADD COLUMN last_consolidated_at INTEGER;',
        'ALTER TABLE agent_memory ADD COLUMN conflict_state TEXT;'
      ].join('\n')
    }
    if (version === 34) {
      return 'ALTER TABLE agent_memory ADD COLUMN persona_state TEXT;'
    }
    if (version === 35) {
      return 'ALTER TABLE agent_memory ADD COLUMN conflict_with TEXT;'
    }
    if (version === 37) {
      return 'ALTER TABLE agent_memory ADD COLUMN category TEXT;'
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

  private detectMathFunctionCapability(): MathFunctionCapability {
    if (this.mathFunctionCapability) return this.mathFunctionCapability
    try {
      const row = this.db.prepare('SELECT pow(2.0, 2.0) AS value').get() as
        | { value: number }
        | undefined
      this.mathFunctionCapability = { available: row?.value === 4 }
    } catch {
      this.mathFunctionCapability = { available: false }
    }
    return this.mathFunctionCapability
  }

  private ftsTableExists(): boolean {
    const row = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_memory_fts'`)
      .get()
    return !!row
  }

  private readFtsMeta(): { schema_version: number; tokenizer: string } | undefined {
    return this.db
      .prepare('SELECT schema_version, tokenizer FROM agent_memory_fts_meta WHERE key = ?')
      .get(AGENT_MEMORY_FTS_META_KEY) as { schema_version: number; tokenizer: string } | undefined
  }

  private writeFtsMeta(tokenizer: string): void {
    this.db
      .prepare(
        `INSERT INTO agent_memory_fts_meta (key, schema_version, tokenizer, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           schema_version = excluded.schema_version,
           tokenizer = excluded.tokenizer,
           updated_at = excluded.updated_at`
      )
      .run(AGENT_MEMORY_FTS_META_KEY, AGENT_MEMORY_FTS_META_VERSION, tokenizer, Date.now())
  }

  private dropFtsIndex(): void {
    this.db.exec(`
      DROP TRIGGER IF EXISTS agent_memory_fts_ai;
      DROP TRIGGER IF EXISTS agent_memory_fts_ad;
      DROP TRIGGER IF EXISTS agent_memory_fts_au;
      DROP TABLE IF EXISTS agent_memory_fts;
    `)
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
    try {
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS agent_memory_fts_meta (
            key TEXT PRIMARY KEY,
            schema_version INTEGER NOT NULL,
            tokenizer TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          );
        `)
        const meta = this.readFtsMeta()
        const alreadyBuilt = this.ftsTableExists()
        if (
          alreadyBuilt &&
          (!meta ||
            meta.schema_version !== AGENT_MEMORY_FTS_META_VERSION ||
            meta.tokenizer !== capability.tokenizer)
        ) {
          this.dropFtsIndex()
        }
        const shouldBackfill = !this.ftsTableExists()
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
        if (shouldBackfill) {
          this.db.exec(
            `INSERT INTO agent_memory_fts(rowid, content, agent_id)
             SELECT rowid, content, agent_id FROM agent_memory;`
          )
        }
        this.writeFtsMeta(capability.tokenizer)
      })()
      this.ftsReady = true
    } catch {
      this.dropFtsIndex()
      this.ftsReady = false
    }
  }

  insert(input: AgentMemoryInsertInput): AgentMemoryRow {
    const row: AgentMemoryRow = {
      id: input.id,
      agent_id: input.agentId,
      user_scope: input.userScope ?? null,
      kind: input.kind,
      category: input.category ?? null,
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
      source_entry_ids: serializeSourceEntryIds(input.sourceEntryIds),
      confidence: null,
      last_consolidated_at: null,
      conflict_state: null,
      conflict_with: input.conflictWith ?? null,
      persona_state: input.personaState ?? null
    }

    this.db
      .prepare(
        `INSERT INTO agent_memory (
           id,
           agent_id,
           user_scope,
           kind,
           category,
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
           source_entry_ids,
           confidence,
           last_consolidated_at,
           conflict_state,
           conflict_with,
           persona_state
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.agent_id,
        row.user_scope,
        row.kind,
        row.category,
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
        row.source_entry_ids,
        row.confidence,
        row.last_consolidated_at,
        row.conflict_state,
        row.conflict_with,
        row.persona_state
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

  listByIds(agentId: string, ids: string[]): AgentMemoryRow[] {
    const uniqueIds = [...new Set(ids.filter((id) => id.length > 0))]
    if (uniqueIds.length === 0) return []
    const placeholders = uniqueIds.map(() => '?').join(', ')
    return this.db
      .prepare(`SELECT * FROM agent_memory WHERE agent_id = ? AND id IN (${placeholders})`)
      .all(agentId, ...uniqueIds) as AgentMemoryRow[]
  }

  listByAgent(agentId: string, options: AgentMemoryListOptions = {}): AgentMemoryRow[] {
    const where: string[] = ['agent_id = ?']
    const params: Array<string | number> = [agentId]

    if (!options.includeSuperseded) {
      where.push('superseded_by IS NULL')
    }
    if (!options.includeArchived && !options.statuses?.includes('archived')) {
      where.push("status != 'archived'")
    }
    if (!options.statuses?.includes('conflicted')) {
      where.push("status != 'conflicted'")
    }
    if (options.kinds?.length) {
      where.push(`kind IN (${options.kinds.map(() => '?').join(', ')})`)
      params.push(...options.kinds)
    } else {
      // The working-memory cache row is internal; hide it from every generic listing (recall feeds,
      // consolidation, decay, management UI). Callers that need it ask for it via `kinds`.
      where.push("kind != 'working'")
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

  // Active = the approved self-model. A draft persona also has superseded_by IS NULL, so the state
  // must be checked explicitly; legacy rows (persona_state NULL) stay active only while not
  // superseded. The superseded_by guard on legacy rows is load-bearing: a row left with a later
  // created_at by an old rollback must not resurface, so COALESCE(persona_state,'active') alone is wrong.
  getActivePersona(agentId: string): AgentMemoryRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM agent_memory
         WHERE agent_id = ? AND kind = 'persona'
           AND (
             persona_state = 'active'
             OR (persona_state IS NULL AND superseded_by IS NULL)
           )
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(agentId) as AgentMemoryRow | undefined
  }

  getDraftPersona(agentId: string): AgentMemoryRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM agent_memory
         WHERE agent_id = ? AND kind = 'persona' AND persona_state = 'draft'
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(agentId) as AgentMemoryRow | undefined
  }

  // Persona state-machine transition. superseded_by is only written when supersededBy is passed
  // (including an explicit null to clear it on re-activation); omitting it leaves the link untouched.
  setPersonaState(id: string, state: AgentMemoryPersonaState, supersededBy?: string | null): void {
    if (supersededBy === undefined) {
      this.db.prepare('UPDATE agent_memory SET persona_state = ? WHERE id = ?').run(state, id)
      return
    }
    this.db
      .prepare('UPDATE agent_memory SET persona_state = ?, superseded_by = ? WHERE id = ?')
      .run(state, supersededBy, id)
  }

  setAnchor(id: string, anchored: boolean): void {
    this.db.prepare('UPDATE agent_memory SET is_anchor = ? WHERE id = ?').run(anchored ? 1 : 0, id)
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
  search(
    agentId: string,
    query: string,
    limit: number = 20,
    options: { matchMode?: SearchMatchMode } = {}
  ): AgentMemoryRow[] {
    const normalized = query.trim()
    if (!normalized) {
      return []
    }
    const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), 100)
    const matchMode = options.matchMode ?? 'all'
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
      collect(this.searchFts(agentId, normalized, cappedLimit, matchMode))
    }
    collect(this.searchLike(agentId, normalized, cappedLimit, matchMode))
    return ordered
  }

  getRecallKeywordTermStats(agentId: string, terms: string[]): RecallKeywordTermStat[] {
    const normalizedTerms = [...new Set(terms.map((term) => term.trim().toLowerCase()))].filter(
      Boolean
    )
    if (!normalizedTerms.length) return []
    const hitColumns = normalizedTerms
      .map(
        (_term, index) =>
          `SUM(CASE WHEN content LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END) AS hit_${index}`
      )
      .join(',\n               ')
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS totalRows,
                ${hitColumns}
       FROM agent_memory
       WHERE agent_id = ?
         AND superseded_by IS NULL
         AND status != 'archived'
         AND status != 'conflicted'
         AND kind NOT IN ('persona', 'working')`
      )
      .get(...normalizedTerms.map((term) => `%${escapeLikePattern(term)}%`), agentId) as Record<
      string,
      number | null
    >
    const totalRows = Number(row.totalRows ?? 0)
    return normalizedTerms.map((term, index) => {
      return {
        term,
        hitCount: Number(row[`hit_${index}`] ?? 0),
        totalRows
      }
    })
  }

  private searchFts(
    agentId: string,
    normalized: string,
    limit: number,
    matchMode: SearchMatchMode
  ): AgentMemoryRow[] {
    const terms = tokenizeSearchQuery(normalized)
    if (!terms.length) return []
    // Quote each token so user text cannot inject FTS5 operators; the caller chooses whether
    // all terms or any term must match.
    const operator = matchMode === 'any' ? ' OR ' : ' AND '
    const match = terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(operator)
    try {
      return this.db
        .prepare(
          `SELECT am.* FROM agent_memory_fts f
           JOIN agent_memory am ON am.rowid = f.rowid
           WHERE agent_memory_fts MATCH ?
             AND am.agent_id = ?
             AND am.superseded_by IS NULL
             AND am.status != 'archived'
             AND am.status != 'conflicted'
             AND am.kind NOT IN ('persona', 'working')
           ORDER BY bm25(agent_memory_fts)
           LIMIT ?`
        )
        .all(match, agentId, limit) as AgentMemoryRow[]
    } catch {
      // A query the tokenizer cannot match (too short, odd syntax) yields no FTS hits; LIKE covers it.
      return []
    }
  }

  private searchLike(
    agentId: string,
    normalized: string,
    limit: number,
    matchMode: SearchMatchMode
  ): AgentMemoryRow[] {
    const terms = tokenizeSearchQuery(normalized)
    if (!terms.length) return []
    const clauses = terms.map(() => "content LIKE ? ESCAPE '\\'")
    const params = terms.map((term) => `%${escapeLikePattern(term)}%`)
    const operator = matchMode === 'any' ? ' OR ' : ' AND '
    return this.db
      .prepare(
        `SELECT * FROM agent_memory
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND status != 'archived'
           AND status != 'conflicted'
           AND kind NOT IN ('persona', 'working')
           AND (${clauses.join(operator)})
         ORDER BY importance DESC, created_at DESC
         LIMIT ?`
      )
      .all(agentId, ...params, limit) as AgentMemoryRow[]
  }

  listPendingEmbedding(limit: number = 50, agentId?: string): AgentMemoryRow[] {
    const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), 500)
    if (agentId) {
      return this.db
        .prepare(
          `SELECT * FROM agent_memory
           WHERE status = 'pending_embedding'
             AND superseded_by IS NULL
             AND kind NOT IN ('persona', 'working')
             AND agent_id = ?
           ORDER BY created_at ASC
           LIMIT ?`
        )
        .all(agentId, cappedLimit) as AgentMemoryRow[]
    }
    return this.db
      .prepare(
        `SELECT * FROM agent_memory
         WHERE status = 'pending_embedding'
           AND superseded_by IS NULL
           AND kind NOT IN ('persona', 'working')
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

  updatePendingEmbeddingStatus(
    agentId: string,
    id: string,
    status: AgentMemoryStatus,
    embedding?: {
      embeddingId?: string | null
      embeddingDim?: number | null
      embeddingModel?: string | null
    }
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE agent_memory
         SET status = ?, embedding_id = ?, embedding_dim = ?, embedding_model = ?
         WHERE id = ?
           AND agent_id = ?
           AND status = 'pending_embedding'
           AND superseded_by IS NULL
           AND kind NOT IN ('persona', 'working')`
      )
      .run(
        status,
        embedding?.embeddingId ?? null,
        embedding?.embeddingDim ?? null,
        embedding?.embeddingModel ?? null,
        id,
        agentId
      )
    return result.changes > 0
  }

  // Resets the embedding state of the agent's non-superseded rows in `statuses` back to
  // pending_embedding in a single statement (no per-row round trips), so a reindex/backfill can
  // re-queue a whole corpus without blocking. persona and working rows are excluded: the self-model
  // is injected verbatim and the working blob is an internal open-session cache, so neither is
  // vector-recalled and both must stay out of the vector store. Requeuing them would strand the row
  // in pending_embedding forever, since listPendingEmbedding never returns those kinds. Status
  // changes do not touch content, so the FTS triggers (UPDATE OF content) never fire here.
  // Returns the number of rows changed.
  requeueForEmbedding(
    agentId: string,
    statuses: AgentMemoryStatus[],
    limit?: number,
    afterId?: string | null
  ): number {
    if (!statuses.length) return 0
    const placeholders = statuses.map(() => '?').join(', ')
    if (limit !== undefined) {
      const cappedLimit = Math.max(0, Math.floor(limit))
      if (cappedLimit === 0) return 0
      const afterSql = afterId ? 'AND id > ?' : ''
      const params: unknown[] = [agentId, ...statuses]
      if (afterId) params.push(afterId)
      params.push(cappedLimit)
      const result = this.db
        .prepare(
          `UPDATE agent_memory
           SET status = 'pending_embedding',
               embedding_id = NULL,
               embedding_dim = NULL,
               embedding_model = NULL
           WHERE id IN (
             SELECT id
             FROM agent_memory
             WHERE agent_id = ?
               AND superseded_by IS NULL
               AND kind NOT IN ('persona', 'working')
               AND status IN (${placeholders})
               ${afterSql}
             ORDER BY id ASC
             LIMIT ?
           )`
        )
        .run(...params)
      return result.changes
    }
    const result = this.db
      .prepare(
        `UPDATE agent_memory
         SET status = 'pending_embedding',
             embedding_id = NULL,
             embedding_dim = NULL,
             embedding_model = NULL
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND kind NOT IN ('persona', 'working')
           AND status IN (${placeholders})`
      )
      .run(agentId, ...statuses)
    return result.changes
  }

  listEmbeddingStatusIds(
    agentId: string,
    statuses: AgentMemoryStatus[],
    limit: number,
    afterId?: string | null
  ): string[] {
    if (!statuses.length) return []
    const cappedLimit = Math.max(0, Math.floor(limit))
    if (cappedLimit === 0) return []
    const placeholders = statuses.map(() => '?').join(', ')
    const afterSql = afterId ? 'AND id > ?' : ''
    const params: unknown[] = [agentId, ...statuses]
    if (afterId) params.push(afterId)
    params.push(cappedLimit)
    const rows = this.db
      .prepare(
        `SELECT id
         FROM agent_memory
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND kind NOT IN ('persona', 'working')
           AND status IN (${placeholders})
           ${afterSql}
         ORDER BY id ASC
         LIMIT ?`
      )
      .all(...params) as Array<{ id: string }>
    return rows.map((row) => row.id)
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

  recordAccessBatch(ids: string[], accessedAt: number = Date.now()): void {
    const uniqueIds = [...new Set(ids.filter((id) => id.trim()))]
    if (!uniqueIds.length) return
    const placeholders = uniqueIds.map(() => '?').join(', ')
    this.db
      .prepare(
        `UPDATE agent_memory
         SET last_accessed = ?, access_count = access_count + 1
         WHERE id IN (${placeholders})`
      )
      .run(accessedAt, ...uniqueIds)
  }

  // Omitting `consolidatedAt` (COALESCE keeps the prior value) leaves the LLM consolidation marker
  // untouched for callers that only refresh decay.
  updateDecayScore(
    id: string,
    decayScore: number | null,
    consolidatedAt: number | null = null
  ): void {
    this.db
      .prepare(
        `UPDATE agent_memory
         SET decay_score = ?, last_consolidated_at = COALESCE(?, last_consolidated_at)
         WHERE id = ?`
      )
      .run(decayScore, consolidatedAt, id)
  }

  refreshDecayScoresForAgent(agentId: string, now: number, halfLifeMs: number): void {
    if (this.detectMathFunctionCapability().available) {
      this.db
        .prepare(
          `UPDATE agent_memory
           SET decay_score = pow(
             0.5,
             max(0, ? - COALESCE(last_accessed, created_at)) /
               (? * (1 + min(1.0, max(0.0, importance))))
           )
           WHERE agent_id = ?
             AND kind != 'persona'
             AND kind != 'working'
             AND superseded_by IS NULL
             AND status NOT IN ('archived', 'conflicted')`
        )
        .run(now, halfLifeMs, agentId)
      return
    }

    const rows = this.listByAgent(agentId).filter((row) => row.kind !== 'persona')
    this.runInTransaction(() => {
      for (const row of rows) {
        this.updateDecayScore(row.id, calculateDecayScoreForRow(row, now, halfLifeMs), null)
      }
    })
  }

  stampConsolidationForAgent(agentId: string, at: number): void {
    this.db
      .prepare(
        `UPDATE agent_memory
         SET last_consolidated_at = ?
         WHERE agent_id = ?
           AND kind != 'persona'
           AND kind != 'working'
           AND superseded_by IS NULL
           AND status NOT IN ('archived', 'conflicted')`
      )
      .run(at, agentId)
  }

  // Refreshes a row's content in place (UPDATE/merge decision), keeping its provenance_key in sync
  // with the new content so the idempotent dedup short-circuit keeps matching. last_accessed is
  // re-anchored too so a rewritten row's forgetting clock resets — a just-merged current-truth row
  // therefore cannot be archived in the same maintenance pass. The FTS trigger fires on content
  // change so the keyword index follows automatically.
  updateContent(
    id: string,
    content: string,
    provenanceKey: string | null,
    at: number = Date.now(),
    category?: string | null
  ): void {
    if (category !== undefined) {
      this.db
        .prepare(
          `UPDATE agent_memory
           SET content = ?, provenance_key = ?, last_accessed = ?, category = ?
           WHERE id = ?`
        )
        .run(content, provenanceKey, at, category, id)
      return
    }
    this.db
      .prepare(
        `UPDATE agent_memory
         SET content = ?, provenance_key = ?, last_accessed = ?
         WHERE id = ?`
      )
      .run(content, provenanceKey, at, id)
  }

  updateUserMetadata(
    id: string,
    patch: {
      category?: string | null
      importance?: number
    }
  ): void {
    const sets: string[] = []
    const params: unknown[] = []
    if (Object.prototype.hasOwnProperty.call(patch, 'category')) {
      sets.push('category = ?')
      params.push(patch.category ?? null)
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'importance')) {
      sets.push('importance = ?')
      params.push(patch.importance)
    }
    if (!sets.length) return
    params.push(id)
    this.db.prepare(`UPDATE agent_memory SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }

  // Confidence only ever rises: NULL seeds the first value, otherwise keep the larger.
  setConfidence(id: string, confidence: number): void {
    this.db
      .prepare(
        `UPDATE agent_memory
         SET confidence = CASE WHEN confidence IS NULL THEN ? ELSE max(confidence, ?) END
         WHERE id = ?`
      )
      .run(confidence, confidence, id)
  }

  // Importance only ever rises during consolidation so folding two rows never downgrades the
  // survivor below the more important of the pair (keeps the importance floor honest).
  setImportance(id: string, importance: number): void {
    this.db
      .prepare('UPDATE agent_memory SET importance = max(importance, ?) WHERE id = ?')
      .run(importance, id)
  }

  markConflict(id: string, state: AgentMemoryConflictState | null): void {
    this.db.prepare('UPDATE agent_memory SET conflict_state = ? WHERE id = ?').run(state, id)
  }

  setConflictWith(id: string, targetId: string | null): void {
    this.db.prepare('UPDATE agent_memory SET conflict_with = ? WHERE id = ?').run(targetId, id)
  }

  setLastConsolidatedAt(id: string, at: number = Date.now()): void {
    this.db.prepare('UPDATE agent_memory SET last_consolidated_at = ? WHERE id = ?').run(at, id)
  }

  // Most recent row-level LLM consolidation timestamp across the agent's rows.
  getLastConsolidatedAt(agentId: string): number | null {
    const row = this.db
      .prepare(
        `SELECT MAX(last_consolidated_at) AS at FROM agent_memory
         WHERE agent_id = ? AND last_consolidated_at IS NOT NULL`
      )
      .get(agentId) as { at: number | null } | undefined
    return row?.at ?? null
  }

  getCurrentEmbeddingDimension(agentId: string, fingerprint: string): number | null {
    const row = this.db
      .prepare(
        `SELECT embedding_dim AS dim
         FROM agent_memory
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND status = 'embedded'
           AND kind NOT IN ('persona', 'working')
           AND embedding_model = ?
           AND embedding_dim IS NOT NULL
           AND embedding_dim > 0
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1`
      )
      .get(agentId, fingerprint) as { dim: number | null } | undefined
    return row?.dim ?? null
  }

  getHealthStats(agentId: string): AgentMemoryHealthStats {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS totalRows,
           ${buildCountCaseAggregates('kind', 'kind', AGENT_MEMORY_HEALTH_KIND_KEYS)},
           ${buildCountCaseAggregates('category', 'category', AGENT_MEMORY_CATEGORIES)},
           SUM(
             CASE
               WHEN category IS NULL OR category NOT IN (
                 ${AGENT_MEMORY_CATEGORIES.map(sqlLiteral).join(',\n                 ')}
               ) THEN 1
               ELSE 0
             END
           ) AS categoryUncategorized,
           ${buildCountCaseAggregates('status', 'status', AGENT_MEMORY_HEALTH_STATUS_KEYS)},
           SUM(CASE WHEN access_count = 0 THEN 1 ELSE 0 END) AS neverAccessed,
           AVG(importance) AS importanceAvg,
           AVG(confidence) AS confidenceAvg,
           SUM(CASE WHEN status = 'conflicted' THEN 1 ELSE 0 END) AS conflicted,
           SUM(
             CASE WHEN conflict_state = 'challenged' AND superseded_by IS NULL THEN 1 ELSE 0 END
           ) AS challenged
         FROM agent_memory
         WHERE agent_id = ?`
      )
      .get(agentId) as Record<string, unknown> | undefined
    const totalRows = readAggregateNumber(row?.totalRows)

    return {
      totalRows,
      byKind: readAggregateRecord(row, 'kind', AGENT_MEMORY_HEALTH_KIND_KEYS),
      byCategory: {
        ...readAggregateRecord(row, 'category', AGENT_MEMORY_CATEGORIES),
        uncategorized: readAggregateNumber(row?.categoryUncategorized)
      },
      byStatus: readAggregateRecord(row, 'status', AGENT_MEMORY_HEALTH_STATUS_KEYS),
      neverAccessed: readAggregateNumber(row?.neverAccessed),
      importanceAvg: readAggregateNullableNumber(row?.importanceAvg),
      importanceMedian: this.getImportanceMedian(agentId, totalRows),
      confidenceAvg: readAggregateNullableNumber(row?.confidenceAvg),
      conflicted: readAggregateNumber(row?.conflicted),
      challenged: readAggregateNumber(row?.challenged)
    }
  }

  private getImportanceMedian(agentId: string, totalRows: number): number | null {
    if (totalRows <= 0) return null
    const limit = totalRows % 2 === 0 ? 2 : 1
    const offset = Math.floor((totalRows - 1) / 2)
    const rows = this.db
      .prepare(
        `SELECT importance
         FROM agent_memory
         WHERE agent_id = ?
         ORDER BY importance ASC
         LIMIT ? OFFSET ?`
      )
      .all(agentId, limit, offset) as Array<{ importance: number }>
    if (!rows.length) return null
    return rows.reduce((sum, item) => sum + item.importance, 0) / rows.length
  }

  hasStaleEmbeddings(agentId: string, currentDim: number, fingerprint: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS stale
         FROM agent_memory
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND status = 'embedded'
           AND kind NOT IN ('persona', 'working')
           AND (
             embedding_dim IS NULL OR
             embedding_dim != ? OR
             embedding_model IS NULL OR
             embedding_model != ?
           )
         LIMIT 1`
      )
      .get(agentId, currentDim, fingerprint) as { stale: number } | undefined
    return row !== undefined
  }

  countStaleEmbeddings(agentId: string, currentDim: number, fingerprint: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM agent_memory
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND status = 'embedded'
           AND kind NOT IN ('persona', 'working')
           AND (
             embedding_dim IS NULL OR
             embedding_dim != ? OR
             embedding_model IS NULL OR
             embedding_model != ?
           )`
      )
      .get(agentId, currentDim, fingerprint) as { count: number } | undefined
    return row?.count ?? 0
  }

  // Soft delete: archived rows stay on disk (and in the vector store) but drop out of recall.
  archive(id: string, _at: number = Date.now()): void {
    this.db.prepare("UPDATE agent_memory SET status = 'archived' WHERE id = ?").run(id)
  }

  // SQL-expressible subset of the archive conditions: active, never accessed, aged out, decayed,
  // and exempt rows (anchors / persona) excluded. The caller may still defensively recheck.
  listArchiveCandidates(agentId: string, before: number, decayBelow: number): AgentMemoryRow[] {
    return this.db
      .prepare(
        `SELECT * FROM agent_memory
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND status != 'archived'
           AND status != 'conflicted'
           AND is_anchor = 0
           AND kind NOT IN ('persona', 'working')
           AND access_count = 0
           AND created_at < ?
           AND decay_score IS NOT NULL
           AND decay_score < ?`
      )
      .all(agentId, before, decayBelow) as AgentMemoryRow[]
  }

  listArchiveCandidateLifecycleRows(
    agentId: string,
    before: number,
    limit: number
  ): AgentMemoryLifecycleRow[] {
    const cappedLimit = Math.max(0, Math.floor(limit))
    if (cappedLimit === 0) return []
    return this.db
      .prepare(
        `SELECT id,
                agent_id,
                kind,
                importance,
                status,
                is_anchor,
                superseded_by,
                created_at,
                last_accessed,
                access_count,
                decay_score,
                confidence
         FROM agent_memory
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND status NOT IN ('archived', 'conflicted')
           AND is_anchor = 0
           AND kind NOT IN ('persona', 'working')
           AND access_count = 0
           AND created_at < ?
         ORDER BY COALESCE(last_accessed, created_at) ASC, created_at ASC, id ASC
         LIMIT ?`
      )
      .all(agentId, before, cappedLimit) as AgentMemoryLifecycleRow[]
  }

  countArchiveCandidates(agentId: string, before: number, decayBelow: number): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM agent_memory
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND status != 'archived'
           AND status != 'conflicted'
           AND is_anchor = 0
           AND kind NOT IN ('persona', 'working')
           AND access_count = 0
           AND created_at < ?
           AND decay_score IS NOT NULL
           AND decay_score < ?`
      )
      .get(agentId, before, decayBelow) as { count: number } | undefined
    return row?.count ?? 0
  }

  listTopAccessed(agentId: string, limit: number): AgentMemoryRow[] {
    const cappedLimit = Math.max(0, Math.floor(limit))
    if (cappedLimit === 0) return []
    return this.db
      .prepare(
        `SELECT *
         FROM agent_memory
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND status != 'archived'
           AND status != 'conflicted'
           AND kind != 'working'
           AND access_count > 0
         ORDER BY access_count DESC, last_accessed DESC
         LIMIT ?`
      )
      .all(agentId, cappedLimit) as AgentMemoryRow[]
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

  countStatusView(agentId: string): {
    total: number
    pendingEmbedding: number
    activeMemoryCount: number
    archivedMemoryCount: number
  } {
    const row = this.db
      .prepare(
        `SELECT
                SUM(CASE WHEN status != 'archived' THEN 1 ELSE 0 END) AS activeMemoryCount,
                SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archivedMemoryCount,
                SUM(CASE WHEN status = 'pending_embedding' THEN 1 ELSE 0 END) AS pendingEmbedding
         FROM agent_memory
         WHERE agent_id = ?
           AND status != 'conflicted'
           AND superseded_by IS NULL
           AND kind NOT IN ('persona', 'working')`
      )
      .get(agentId) as
      | {
          activeMemoryCount: number | null
          archivedMemoryCount: number | null
          pendingEmbedding: number | null
        }
      | undefined
    const activeMemoryCount = row?.activeMemoryCount ?? 0
    const archivedMemoryCount = row?.archivedMemoryCount ?? 0
    return {
      total: activeMemoryCount,
      pendingEmbedding: row?.pendingEmbedding ?? 0,
      activeMemoryCount,
      archivedMemoryCount
    }
  }

  // Mirrors the pair-validity predicate in ConflictService.listConflicts exactly (challenger is a
  // live 'conflicted' row; its conflict_with target belongs to the same agent, is still
  // 'challenged', and hasn't itself been superseded). Keep both in sync.
  countConflictPairs(agentId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM agent_memory challenger
         JOIN agent_memory target ON target.id = challenger.conflict_with
         WHERE challenger.agent_id = ?
           AND challenger.status = 'conflicted'
           AND challenger.superseded_by IS NULL
           AND target.agent_id = challenger.agent_id
           AND target.conflict_state = 'challenged'
           AND target.superseded_by IS NULL`
      )
      .get(agentId) as { count: number } | undefined
    return row?.count ?? 0
  }

  getPersonaCounts(agentId: string): { total: number; draft: number } {
    const row = this.db
      .prepare(
        `SELECT
           SUM(CASE
             WHEN persona_state IS NULL OR persona_state IN ('active', 'superseded') THEN 1
             ELSE 0
           END) AS total,
           SUM(CASE WHEN persona_state = 'draft' THEN 1 ELSE 0 END) AS draft
         FROM agent_memory
         WHERE agent_id = ? AND kind = 'persona'`
      )
      .get(agentId) as { total: number | null; draft: number | null } | undefined
    return { total: row?.total ?? 0, draft: row?.draft ?? 0 }
  }

  runInTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  listWorkingCandidates(
    agentId: string,
    limit: number,
    after?: AgentMemoryWorkingCandidateCursor
  ): AgentMemoryRow[] {
    const cappedLimit = Math.max(0, Math.floor(limit))
    if (cappedLimit === 0) return []
    const cursorSql = after
      ? `AND (
           importance < ?
           OR (importance = ? AND access_count < ?)
           OR (importance = ? AND access_count = ? AND created_at < ?)
           OR (importance = ? AND access_count = ? AND created_at = ? AND id < ?)
         )`
      : ''
    const params: unknown[] = [agentId]
    if (after) {
      params.push(
        after.importance,
        after.importance,
        after.accessCount,
        after.importance,
        after.accessCount,
        after.createdAt,
        after.importance,
        after.accessCount,
        after.createdAt,
        after.id
      )
    }
    params.push(cappedLimit)
    return this.db
      .prepare(
        `SELECT *
         FROM agent_memory
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND status != 'archived'
           AND status != 'conflicted'
           AND kind IN ('semantic', 'reflection', 'episodic')
           ${cursorSql}
         ORDER BY importance DESC, access_count DESC, created_at DESC, id DESC
         LIMIT ?`
      )
      .all(...params) as AgentMemoryRow[]
  }

  hasActiveMemory(agentId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS present
         FROM agent_memory
         WHERE agent_id = ? AND status != 'archived'
         LIMIT 1`
      )
      .get(agentId) as { present: number } | undefined
    return row !== undefined
  }

  listAgentIdsWithMemories(): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT agent_id
         FROM agent_memory
         WHERE status != 'archived'`
      )
      .all() as Array<{ agent_id: string }>
    return rows.map((row) => row.agent_id)
  }

  listConsolidationScanRows(
    agentId: string,
    options: {
      embeddingDim: number
      embeddingModel: string
      after?: { createdAt: number; id: string }
      limit: number
    }
  ): AgentMemoryRow[] {
    const cappedLimit = Math.max(0, Math.floor(options.limit))
    if (cappedLimit === 0) return []
    const params: Array<string | number> = [agentId, options.embeddingDim, options.embeddingModel]
    const cursorClause = options.after ? 'AND (created_at > ? OR (created_at = ? AND id > ?))' : ''
    if (options.after) {
      params.push(options.after.createdAt, options.after.createdAt, options.after.id)
    }
    params.push(cappedLimit)
    return this.db
      .prepare(
        `SELECT *
         FROM agent_memory
         WHERE agent_id = ?
           AND status = 'embedded'
           AND superseded_by IS NULL
           AND kind NOT IN ('persona', 'working')
           AND embedding_dim = ?
           AND embedding_model = ?
           ${cursorClause}
         ORDER BY created_at ASC, id ASC
         LIMIT ?`
      )
      .all(...params) as AgentMemoryRow[]
  }

  repairInternalKindStatuses(agentId: string): number {
    const result = this.db
      .prepare(
        `UPDATE agent_memory
         SET status = 'fts_only'
         WHERE agent_id = ?
           AND kind IN ('persona', 'working')
           AND status != 'fts_only'`
      )
      .run(agentId)
    return result.changes
  }

  listPrunableVectorRefs(
    agentId: string,
    options: { limit: number; embeddingModel?: string; embeddingDim?: number }
  ): Array<{ id: string; embeddingDim: number; embeddingModel: string }> {
    const cappedLimit = Math.max(0, Math.floor(options.limit))
    if (cappedLimit === 0) return []
    const params: Array<string | number> = [agentId]
    const embeddingModelClause = options.embeddingModel ? 'AND embedding_model = ?' : ''
    if (options.embeddingModel) params.push(options.embeddingModel)
    const embeddingDimClause = options.embeddingDim !== undefined ? 'AND embedding_dim = ?' : ''
    if (options.embeddingDim !== undefined) params.push(options.embeddingDim)
    params.push(cappedLimit)
    const rows = this.db
      .prepare(
        `SELECT id,
                embedding_dim AS embeddingDim,
                embedding_model AS embeddingModel
         FROM agent_memory
         WHERE agent_id = ?
           AND embedding_id IS NOT NULL
           AND embedding_dim IS NOT NULL
           AND embedding_dim > 0
           AND embedding_model IS NOT NULL
           ${embeddingModelClause}
           ${embeddingDimClause}
           AND (
             kind IN ('persona', 'working') OR
             superseded_by IS NOT NULL OR
             status = 'archived'
           )
         ORDER BY created_at ASC, id ASC
         LIMIT ?`
      )
      .all(...params) as Array<{
      id: string
      embeddingDim: number
      embeddingModel: string
    }>
    return rows
  }

  filterPrunableVectorRefs(
    agentId: string,
    ids: string[],
    embeddingDim: number,
    embeddingModel: string
  ): string[] {
    const uniqueIds = [...new Set(ids.filter((id) => id.trim()))]
    if (!uniqueIds.length) return []
    const placeholders = uniqueIds.map(() => '?').join(', ')
    const existingRows = this.db
      .prepare(
        `SELECT id,
                embedding_id,
                embedding_dim,
                embedding_model,
                kind,
                superseded_by,
                status
         FROM agent_memory
         WHERE agent_id = ?
           AND id IN (${placeholders})`
      )
      .all(agentId, ...uniqueIds) as Array<{
      id: string
      embedding_id: string | null
      embedding_dim: number | null
      embedding_model: string | null
      kind: AgentMemoryKind
      superseded_by: string | null
      status: AgentMemoryStatus
    }>
    const existingIds = new Set(existingRows.map((row) => row.id))
    const prunableIds = new Set(
      existingRows
        .filter(
          (row) =>
            row.embedding_id !== null &&
            row.embedding_dim === embeddingDim &&
            row.embedding_model === embeddingModel &&
            (row.kind === 'persona' ||
              row.kind === 'working' ||
              row.superseded_by !== null ||
              row.status === 'archived')
        )
        .map((row) => row.id)
    )
    return uniqueIds.filter((id) => !existingIds.has(id) || prunableIds.has(id))
  }

  clearPrunableEmbeddingRefs(
    agentId: string,
    ids: string[],
    embeddingDim: number,
    embeddingModel: string
  ): number {
    const uniqueIds = [...new Set(ids.filter((id) => id.trim()))]
    if (!uniqueIds.length) return 0
    const placeholders = uniqueIds.map(() => '?').join(', ')
    const result = this.db
      .prepare(
        `UPDATE agent_memory
         SET embedding_id = NULL,
             embedding_dim = NULL,
             embedding_model = NULL
         WHERE agent_id = ?
           AND id IN (${placeholders})
           AND embedding_id IS NOT NULL
           AND embedding_dim = ?
           AND embedding_model = ?
           AND (
             kind IN ('persona', 'working') OR
             superseded_by IS NOT NULL OR
             status = 'archived'
           )`
      )
      .run(agentId, ...uniqueIds, embeddingDim, embeddingModel)
    return result.changes
  }
}
