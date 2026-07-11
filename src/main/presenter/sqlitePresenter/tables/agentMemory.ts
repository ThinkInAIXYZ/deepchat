import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'
import {
  AGENT_MEMORY_CATEGORIES,
  AGENT_MEMORY_HEALTH_KIND_KEYS,
  AGENT_MEMORY_HEALTH_STATUS_KEYS
} from '@shared/types/agent-memory'
import { serializeAgentMemorySourceEntryIds } from '@shared/lib/agentMemoryLineage'
import { MEMORY_PAGE_MAX_LIMIT } from '@shared/contracts/routes/memory.routes'
import type { MemoryPerfObserver, MemoryRepositoryPort } from '../../memoryPresenter/ports'
import type {
  AgentMemoryHealthStats,
  AgentMemoryInsertInput,
  AgentMemoryConflictState,
  AgentMemoryKind,
  AgentMemoryLifecycleRow,
  AgentMemoryListOptions,
  AgentMemoryPersonaState,
  AgentMemoryRow,
  AgentMemoryStatus,
  AgentMemoryWorkingCandidateCursor
} from '../../memoryPresenter/domain/types'
import {
  AGENT_MEMORY_FTS_POLICY_VERSION,
  agentFtsScope,
  buildAgentFtsScopeSql,
  buildRecallablePredicate,
  isRecallableFtsRow
} from './agentMemoryFtsPolicy'

// 'working' is an internal session-open injection cache (a single blob row per agent); it is never
// recalled, embedded, reflected on, or archived. A 'crystal' kind (3+ corroborated sources) is a
// reserved future layer with no read/write path yet.

// Global migration version shared across all tables (see SQLitePresenter.migrate). v32 backfilled
// embedding_model + source_entry_ids; v33 adds the consolidation/forgetting columns; v34 adds the
// persona lifecycle column; v35 adds conflict linkage; v37 adds agentic category; v41 adds
// optimistic concurrency control for semantic decision writes.
const AGENT_MEMORY_SCHEMA_VERSION = 41

const AGENT_MEMORY_FTS_META_KEY = 'agent_memory_fts'
const AGENT_MEMORY_FTS_META_VERSION = 4
const AGENT_MEMORY_FTS_RECOVERY_COOLDOWN_MS = 30_000

type FtsCapability = { available: boolean; tokenizer: 'trigram' | 'unicode61' }
type SearchMatchMode = 'all' | 'any'
type FtsMirrorRow = AgentMemoryRow & { rowid: number }
export interface AgentMemorySearchResult {
  rows: AgentMemoryRow[]
  strategy: 'fts-only' | 'like-fallback'
}

function buildRevisionAwareEmbeddingValues<T extends { id: string; expectedRevision: number }>(
  updates: readonly T[],
  additionalValues: (update: T) => readonly unknown[] = () => []
): { valuesSql: string; params: unknown[] } {
  const unique = [...new Map(updates.map((update) => [update.id, update])).values()]
  const columnCount = 2 + (unique[0] ? additionalValues(unique[0]).length : 0)
  return {
    valuesSql: unique
      .map(() => `(${Array.from({ length: columnCount }, () => '?').join(', ')})`)
      .join(', '),
    params: unique.flatMap((update) => [
      update.id,
      update.expectedRevision,
      ...additionalValues(update)
    ])
  }
}

function isTransientFtsError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED' || code === 'SQLITE_INTERRUPT'
}

const AGENT_MEMORY_BASE_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_kind
    ON agent_memory(agent_id, kind, status);
  CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_active
    ON agent_memory(agent_id, superseded_by);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memory_provenance
    ON agent_memory(agent_id, provenance_key)
    WHERE provenance_key IS NOT NULL;
  DROP INDEX IF EXISTS idx_agent_memory_management_page;
  DROP INDEX IF EXISTS idx_agent_memory_cognitive_top;
  CREATE INDEX IF NOT EXISTS idx_agent_memory_management_page_v2
    ON agent_memory(agent_id, created_at DESC, id DESC)
    WHERE superseded_by IS NULL
      AND status != 'conflicted'
      AND kind NOT IN ('persona', 'working');
  CREATE INDEX IF NOT EXISTS idx_agent_memory_cognitive_top_v2
    ON agent_memory(agent_id, importance DESC, created_at DESC, id DESC)
    WHERE superseded_by IS NULL
      AND status NOT IN ('archived', 'conflicted')
      AND kind IN ('episodic', 'semantic', 'reflection');
  CREATE INDEX IF NOT EXISTS idx_agent_memory_recall_importance_v4
    ON agent_memory(agent_id, importance DESC, created_at DESC, id ASC)
    WHERE superseded_by IS NULL
      AND status NOT IN ('archived', 'conflicted')
      AND kind NOT IN ('persona', 'working');
  DROP INDEX IF EXISTS idx_agent_memory_recent_activity;
  CREATE INDEX IF NOT EXISTS idx_agent_memory_recent_activity_v2
    ON agent_memory(agent_id, COALESCE(last_accessed, created_at) DESC)
    WHERE status != 'archived';
`

const AGENT_MEMORY_MAINTENANCE_INDEX_SQL = `
  DROP INDEX IF EXISTS idx_agent_memory_archive_eligible;
  DROP INDEX IF EXISTS idx_agent_memory_conflict_fairness;
  CREATE INDEX IF NOT EXISTS idx_agent_memory_archive_eligible_v2
    ON agent_memory(agent_id, COALESCE(last_accessed, created_at), created_at, id)
    WHERE superseded_by IS NULL
      AND conflict_state IS NULL
      AND is_anchor = 0
      AND kind NOT IN ('persona', 'working')
      AND status NOT IN ('archived', 'conflicted');
  CREATE INDEX IF NOT EXISTS idx_agent_memory_conflict_fairness_v2
    ON agent_memory(agent_id, COALESCE(last_consolidated_at, 0), created_at, id)
    WHERE status = 'conflicted' AND superseded_by IS NULL;
`

const AGENT_MEMORY_CONFLICT_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_agent_memory_conflict_target
    ON agent_memory(agent_id, conflict_with, status, superseded_by);
  CREATE INDEX IF NOT EXISTS idx_agent_memory_conflict_link_anomaly_v2
    ON agent_memory(agent_id, status, conflict_with, id)
    WHERE conflict_with IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_agent_memory_conflict_state_anomaly_v2
    ON agent_memory(agent_id, conflict_state, id)
    WHERE conflict_state IS NOT NULL;
`

function tokenizeSearchQuery(query: string): string[] {
  return query
    .trim()
    .split(/\s+/u)
    .map((term) => term.trim())
    .filter(Boolean)
}

function unicodeCodePointLength(value: string): number {
  return Array.from(value).length
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

function readAggregateNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readAggregateNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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

export class AgentMemoryTable extends BaseTable implements MemoryRepositoryPort {
  constructor(
    db: Database.Database,
    private readonly perfObserver?: MemoryPerfObserver
  ) {
    super(db, 'agent_memory')
  }

  private ftsCapability: FtsCapability | undefined
  private ftsReady = false
  private ftsRecoveryAfter = 0

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
        persona_state TEXT,
        decision_revision INTEGER NOT NULL DEFAULT 1
      );
      ${AGENT_MEMORY_BASE_INDEX_SQL}
      ${AGENT_MEMORY_MAINTENANCE_INDEX_SQL}
      ${AGENT_MEMORY_CONFLICT_INDEX_SQL}
    `
  }

  override createTable(): void {
    this.db.function('agent_memory_fts_scope', { deterministic: true }, (agentId: unknown) =>
      agentFtsScope(typeof agentId === 'string' ? agentId : String(agentId))
    )
    if (!this.tableExists()) {
      this.db.exec(this.getCreateTableSQL())
    } else {
      this.db.exec(AGENT_MEMORY_BASE_INDEX_SQL)
      const columns = this.db.prepare('PRAGMA table_info(agent_memory)').all() as Array<{
        name: string
      }>
      if (
        columns.some((column) => column.name === 'conflict_state') &&
        columns.some((column) => column.name === 'last_consolidated_at')
      ) {
        this.db.exec(AGENT_MEMORY_MAINTENANCE_INDEX_SQL)
      }
      if (columns.some((column) => column.name === 'conflict_with')) {
        this.db.exec(AGENT_MEMORY_CONFLICT_INDEX_SQL)
      }
    }
    this.ensureFtsIndex()
  }

  assertCurrentSchema(): void {
    const columns = this.db.prepare('PRAGMA table_info(agent_memory)').all() as Array<{
      name: string
    }>
    if (!columns.some((column) => column.name === 'decision_revision')) {
      throw new Error('[Memory] agent_memory schema migration is incomplete: decision_revision')
    }
    this.db.exec(AGENT_MEMORY_BASE_INDEX_SQL)
    this.db.exec(AGENT_MEMORY_MAINTENANCE_INDEX_SQL)
    this.db.exec(AGENT_MEMORY_CONFLICT_INDEX_SQL)
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
      return [
        'ALTER TABLE agent_memory ADD COLUMN conflict_with TEXT;',
        AGENT_MEMORY_CONFLICT_INDEX_SQL
      ].join('\n')
    }
    if (version === 37) {
      return 'ALTER TABLE agent_memory ADD COLUMN category TEXT;'
    }
    if (version === 41) {
      return 'ALTER TABLE agent_memory ADD COLUMN decision_revision INTEGER NOT NULL DEFAULT 1;'
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

  private readFtsMeta():
    | {
        schema_version: number
        policy_version: number
        tokenizer: string
        mutation_generation: number
        indexed_generation: number
      }
    | undefined {
    return this.db
      .prepare(
        `SELECT schema_version, policy_version, tokenizer, mutation_generation, indexed_generation
         FROM agent_memory_fts_meta WHERE key = ?`
      )
      .get(AGENT_MEMORY_FTS_META_KEY) as
      | {
          schema_version: number
          policy_version: number
          tokenizer: string
          mutation_generation: number
          indexed_generation: number
        }
      | undefined
  }

  private writeFtsMeta(tokenizer: string, generation: number): void {
    this.db
      .prepare(
        `INSERT INTO agent_memory_fts_meta (
           key, schema_version, policy_version, tokenizer, mutation_generation, indexed_generation, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           schema_version = excluded.schema_version,
           policy_version = excluded.policy_version,
           tokenizer = excluded.tokenizer,
           mutation_generation = excluded.mutation_generation,
           indexed_generation = excluded.indexed_generation,
           updated_at = excluded.updated_at`
      )
      .run(
        AGENT_MEMORY_FTS_META_KEY,
        AGENT_MEMORY_FTS_META_VERSION,
        AGENT_MEMORY_FTS_POLICY_VERSION,
        tokenizer,
        generation,
        generation,
        Date.now()
      )
  }

  private markFtsDirty(): number {
    try {
      const result = this.db
        .prepare(
          `UPDATE agent_memory_fts_meta
           SET mutation_generation = mutation_generation + 1, updated_at = ?
           WHERE key = ?
           RETURNING mutation_generation`
        )
        .get(Date.now(), AGENT_MEMORY_FTS_META_KEY) as { mutation_generation: number } | undefined
      return result?.mutation_generation ?? -1
    } catch {
      this.ftsReady = false
      return -1
    }
  }

  private markFtsIndexed(generation: number): void {
    if (generation < 0) return
    this.db
      .prepare(
        `UPDATE agent_memory_fts_meta
         SET indexed_generation = ?, updated_at = ?
         WHERE key = ? AND mutation_generation = ?`
      )
      .run(generation, Date.now(), AGENT_MEMORY_FTS_META_KEY, generation)
  }

  private runRecallMutation<T>(mutation: () => T, maintainFts: () => void): T {
    return this.db.transaction(() => {
      const result = mutation()
      const generation = this.markFtsDirty()
      if (!this.ftsReady || generation < 0) return result
      try {
        this.db.transaction(maintainFts)()
        this.markFtsIndexed(generation)
      } catch {
        this.ftsReady = false
      }
      return result
    })()
  }

  private getFtsMirrorRow(id: string): FtsMirrorRow | undefined {
    return this.db.prepare('SELECT rowid, * FROM agent_memory WHERE id = ?').get(id) as
      | FtsMirrorRow
      | undefined
  }

  private deleteFtsMirrorRow(row: FtsMirrorRow | undefined, force = false): void {
    if (!row || (!force && !isRecallableFtsRow(row))) return
    this.db
      .prepare(
        `INSERT INTO agent_memory_fts(agent_memory_fts, rowid, content, agent_id)
         VALUES ('delete', ?, ?, ?)`
      )
      .run(row.rowid, row.content, agentFtsScope(row.agent_id))
  }

  private insertFtsMirrorRow(row: FtsMirrorRow | undefined): void {
    if (!isRecallableFtsRow(row)) return
    this.db
      .prepare('INSERT INTO agent_memory_fts(rowid, content, agent_id) VALUES (?, ?, ?)')
      .run(row.rowid, row.content, agentFtsScope(row.agent_id))
  }

  private replaceFtsMirrorRow(before: FtsMirrorRow | undefined, afterId: string): void {
    this.deleteFtsMirrorRow(before)
    this.insertFtsMirrorRow(this.getFtsMirrorRow(afterId))
  }

  private runRecallBulkDelete<T>(deleteMirror: () => void, mutation: () => T): T {
    return this.db.transaction(() => {
      const generation = this.markFtsDirty()
      let mirrorUpdated = false
      if (this.ftsReady && generation >= 0) {
        try {
          this.db.transaction(deleteMirror)()
          mirrorUpdated = true
        } catch {
          this.ftsReady = false
        }
      }
      const result = mutation()
      if (mirrorUpdated) this.markFtsIndexed(generation)
      return result
    })()
  }

  private dropFtsIndex(): void {
    this.db.exec(`
      DROP TRIGGER IF EXISTS agent_memory_fts_ai;
      DROP TRIGGER IF EXISTS agent_memory_fts_ad;
      DROP TRIGGER IF EXISTS agent_memory_fts_au;
      DROP TABLE IF EXISTS agent_memory_fts;
    `)
  }

  // Creates a filtered external-content FTS5 mirror. Authoritative mutations maintain the mirror
  // explicitly behind a nested savepoint so a rebuildable FTS failure cannot abort the main row.
  private ensureFtsIndex(): void {
    const capability = this.detectFtsCapability()
    if (!capability.available) {
      this.ftsReady = false
      if (process.env.DEEPCHAT_REQUIRE_NATIVE_SQLITE === '1') {
        throw new Error('[Memory] native SQLite FTS5 support is required')
      }
      return
    }
    if (capability.tokenizer !== 'trigram') {
      try {
        this.dropFtsIndex()
      } catch {}
      this.ftsReady = false
      return
    }
    try {
      this.db.transaction(() => {
        const metaColumns = this.db
          .prepare('PRAGMA table_info(agent_memory_fts_meta)')
          .all() as Array<{ name: string }>
        if (
          metaColumns.length > 0 &&
          (!metaColumns.some((column) => column.name === 'policy_version') ||
            !metaColumns.some((column) => column.name === 'mutation_generation') ||
            !metaColumns.some((column) => column.name === 'indexed_generation'))
        ) {
          this.db.exec('DROP TABLE IF EXISTS agent_memory_fts_meta;')
        }
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS agent_memory_fts_meta (
            key TEXT PRIMARY KEY,
            schema_version INTEGER NOT NULL,
            policy_version INTEGER NOT NULL,
            tokenizer TEXT NOT NULL,
            mutation_generation INTEGER NOT NULL,
            indexed_generation INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );
        `)
        const meta = this.readFtsMeta()
        const alreadyBuilt = this.ftsTableExists()
        if (
          alreadyBuilt &&
          (!meta ||
            meta.schema_version !== AGENT_MEMORY_FTS_META_VERSION ||
            meta.policy_version !== AGENT_MEMORY_FTS_POLICY_VERSION ||
            meta.tokenizer !== capability.tokenizer ||
            meta.mutation_generation !== meta.indexed_generation)
        ) {
          this.dropFtsIndex()
        }
        const shouldBackfill = !this.ftsTableExists()
        // Retired trigger names are removed idempotently so older derived schemas cannot keep
        // mutating FTS outside the authoritative transaction/savepoint boundary.
        this.db.exec(`
          DROP TRIGGER IF EXISTS agent_memory_fts_ai;
          DROP TRIGGER IF EXISTS agent_memory_fts_ad;
          DROP TRIGGER IF EXISTS agent_memory_fts_au;
        `)
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory_fts USING fts5(
            content,
            agent_id,
            content='agent_memory',
            content_rowid='rowid',
            tokenize='${capability.tokenizer}'
          );
        `)
        if (shouldBackfill) {
          this.db.exec(
            `INSERT INTO agent_memory_fts(rowid, content, agent_id)
             SELECT rowid, content, ${buildAgentFtsScopeSql('agent_id')} FROM agent_memory
             WHERE ${buildRecallablePredicate()};`
          )
        }
        this.writeFtsMeta(capability.tokenizer, meta?.mutation_generation ?? 0)
      })()
      this.ftsReady = true
    } catch (error) {
      try {
        this.dropFtsIndex()
      } catch {}
      this.ftsReady = false
      if (process.env.DEEPCHAT_REQUIRE_NATIVE_SQLITE === '1') throw error
    }
  }

  private recoverFtsIfNeeded(): void {
    if (this.ftsReady || this.ftsCapability?.tokenizer === 'unicode61') return
    const now = Date.now()
    if (now < this.ftsRecoveryAfter) return
    this.ftsRecoveryAfter = now + AGENT_MEMORY_FTS_RECOVERY_COOLDOWN_MS
    try {
      this.ensureFtsIndex()
      if (this.ftsReady) this.ftsRecoveryAfter = 0
    } catch {
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
      source_entry_ids: serializeAgentMemorySourceEntryIds(input.sourceEntryIds),
      confidence: null,
      last_consolidated_at: null,
      conflict_state: null,
      conflict_with: input.conflictWith ?? null,
      persona_state: input.personaState ?? null,
      decision_revision: 1
    }

    this.runRecallMutation(
      () =>
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
           persona_state,
           decision_revision
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
            row.persona_state,
            row.decision_revision
          ),
      () => this.insertFtsMirrorRow(this.getFtsMirrorRow(row.id))
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

  rekeyProvenance(agentId: string, id: string, expectedKey: string, nextKey: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE agent_memory SET provenance_key = ?
         WHERE id = ? AND agent_id = ? AND provenance_key = ?`
      )
      .run(nextKey, id, agentId, expectedKey)
    return result.changes === 1
  }

  listByIds(agentId: string, ids: string[]): AgentMemoryRow[] {
    const uniqueIds = [...new Set(ids.filter((id) => id.length > 0))]
    if (uniqueIds.length === 0) return []
    const placeholders = uniqueIds.map(() => '?').join(', ')
    return this.db
      .prepare(`SELECT * FROM agent_memory WHERE agent_id = ? AND id IN (${placeholders})`)
      .all(agentId, ...uniqueIds) as AgentMemoryRow[]
  }

  getCognitiveMaintenanceInput(
    agentId: string,
    options: { kinds: AgentMemoryKind[]; watermark: number; limit: number }
  ): {
    eligibleCount: number
    importanceAfterWatermark: number
    maxCreatedAt: number
    topRows: AgentMemoryRow[]
  } {
    const kinds = [...new Set(options.kinds)]
    const limit = Math.max(0, Math.floor(options.limit))
    if (!kinds.length || limit === 0) {
      return { eligibleCount: 0, importanceAfterWatermark: 0, maxCreatedAt: 0, topRows: [] }
    }
    const placeholders = kinds.map(() => '?').join(', ')
    const predicate = `agent_id = ?
      AND superseded_by IS NULL
      AND status NOT IN ('archived', 'conflicted')
      AND kind IN ('episodic', 'semantic', 'reflection')
      AND kind IN (${placeholders})`
    const aggregate = this.db
      .prepare(
        `SELECT COUNT(*) AS eligibleCount,
                COALESCE(SUM(CASE
                  WHEN created_at > ? THEN min(1.0, max(0.0, importance))
                  ELSE 0
                END), 0) AS importanceAfterWatermark,
                COALESCE(MAX(created_at), 0) AS maxCreatedAt
         FROM agent_memory
         WHERE ${predicate}`
      )
      .get(options.watermark, agentId, ...kinds) as
      | {
          eligibleCount: number
          importanceAfterWatermark: number
          maxCreatedAt: number
        }
      | undefined
    const topRows = this.db
      .prepare(
        `SELECT *
         FROM agent_memory INDEXED BY idx_agent_memory_cognitive_top_v2
         WHERE ${predicate}
         ORDER BY importance DESC, created_at DESC, id DESC
         LIMIT ?`
      )
      .all(agentId, ...kinds, limit) as AgentMemoryRow[]
    return {
      eligibleCount: aggregate?.eligibleCount ?? 0,
      importanceAfterWatermark: aggregate?.importanceAfterWatermark ?? 0,
      maxCreatedAt: aggregate?.maxCreatedAt ?? 0,
      topRows
    }
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

  listManagementPage(
    agentId: string,
    cursor: { createdAt: number; id: string } | null,
    limit: number
  ): AgentMemoryRow[] {
    const cappedLimit = Math.min(MEMORY_PAGE_MAX_LIMIT + 1, Math.max(1, Math.floor(limit)))
    const cursorSql = cursor ? 'AND (created_at < ? OR (created_at = ? AND id < ?))' : ''
    const params: Array<string | number> = [agentId]
    if (cursor) params.push(cursor.createdAt, cursor.createdAt, cursor.id)
    params.push(cappedLimit)
    return this.db
      .prepare(
        `SELECT *
         FROM agent_memory
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND status != 'conflicted'
           AND kind NOT IN ('persona', 'working')
           ${cursorSql}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      )
      .all(...params) as AgentMemoryRow[]
  }

  listManagementVisibleByIds(agentId: string, ids: string[]): AgentMemoryRow[] {
    const uniqueIds = [...new Set(ids.filter((id) => id.length > 0))]
    if (uniqueIds.length === 0) return []
    const placeholders = uniqueIds.map(() => '?').join(', ')
    return this.db
      .prepare(
        `SELECT *
         FROM agent_memory
         WHERE agent_id = ?
           AND id IN (${placeholders})
           AND superseded_by IS NULL
           AND status != 'conflicted'
           AND kind NOT IN ('persona', 'working')`
      )
      .all(agentId, ...uniqueIds) as AgentMemoryRow[]
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
      this.db
        .prepare(
          'UPDATE agent_memory SET persona_state = ?, decision_revision = decision_revision + 1 WHERE id = ?'
        )
        .run(state, id)
      return
    }
    this.db
      .prepare(
        'UPDATE agent_memory SET persona_state = ?, superseded_by = ?, decision_revision = decision_revision + 1 WHERE id = ?'
      )
      .run(state, supersededBy, id)
  }

  setAnchor(id: string, anchored: boolean): void {
    this.db
      .prepare(
        'UPDATE agent_memory SET is_anchor = ?, decision_revision = decision_revision + 1 WHERE id = ?'
      )
      .run(anchored ? 1 : 0, id)
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

  // Safe trigram queries stay entirely on the FTS index: BM25 supplies lexical ranking and a
  // second query with the exact same MATCH supplies the importance/recency candidates used by
  // downstream fusion. Every other tokenizer/query shape takes exactly one bounded LIKE path.
  search(
    agentId: string,
    query: string,
    limit: number = 20,
    options: { matchMode?: SearchMatchMode } = {}
  ): AgentMemoryRow[] {
    return this.searchWithStrategy(agentId, query, limit, options).rows
  }

  searchWithStrategy(
    agentId: string,
    query: string,
    limit: number = 20,
    options: { matchMode?: SearchMatchMode } = {}
  ): AgentMemorySearchResult {
    this.recoverFtsIfNeeded()
    this.perfObserver?.increment('repositoryCalls')
    const finish = (result: AgentMemorySearchResult): AgentMemorySearchResult => {
      this.perfObserver?.increment('materializedRows', result.rows.length)
      return result
    }
    const normalized = query.trim()
    if (!normalized) {
      return finish({ rows: [], strategy: this.ftsReady ? 'fts-only' : 'like-fallback' })
    }
    const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), 100)
    const matchMode = options.matchMode ?? 'all'
    const terms = tokenizeSearchQuery(normalized)
    if (!terms.length) {
      return finish({ rows: [], strategy: this.ftsReady ? 'fts-only' : 'like-fallback' })
    }
    const capability = this.ftsCapability
    const safeTrigramQuery =
      this.ftsReady &&
      capability?.available === true &&
      capability.tokenizer === 'trigram' &&
      terms.every((term) => unicodeCodePointLength(term) >= 3)
    if (!safeTrigramQuery) {
      return finish({
        rows: this.searchLike(agentId, terms, cappedLimit, matchMode),
        strategy: 'like-fallback'
      })
    }

    try {
      const match = this.buildFtsMatch(agentId, terms, matchMode)
      return finish({
        rows: this.searchFts(agentId, match, cappedLimit),
        strategy: 'fts-only'
      })
    } catch (error) {
      if (!isTransientFtsError(error)) {
        this.ftsReady = false
        this.markFtsDirty()
      }
      return finish({
        rows: this.searchLike(agentId, terms, cappedLimit, matchMode),
        strategy: 'like-fallback'
      })
    }
  }

  private buildFtsMatch(agentId: string, terms: string[], matchMode: SearchMatchMode): string {
    // Quote each token so user text cannot inject FTS5 operators; the caller chooses whether
    // all terms or any term must match.
    const operator = matchMode === 'any' ? ' OR ' : ' AND '
    const contentMatch = terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(operator)
    // Keep the selective content postings first. FTS5 evaluates the expression left-to-right for
    // this shape; leading with the per-agent scope would walk every row for a large single agent.
    return `content : (${contentMatch}) AND agent_id : "${agentFtsScope(agentId)}"`
  }

  private searchFts(agentId: string, match: string, limit: number): AgentMemoryRow[] {
    const lexicalScanLimit = Math.min(100, Math.max(1, limit))
    const importanceCandidateLimit = Math.min(800, Math.max(64, limit * 8))
    return this.db
      .prepare(
        `WITH lexical_hits AS MATERIALIZED (
           SELECT rowid AS memory_rowid,
                  bm25(agent_memory_fts, 1.0, 0.0) AS lexical_score
           FROM agent_memory_fts
           WHERE agent_memory_fts MATCH ?
           LIMIT ?
         ), lexical AS MATERIALIZED (
           SELECT am.rowid AS memory_rowid,
                  am.id,
                  am.importance,
                  am.created_at,
                  lexical_hits.lexical_score
           FROM lexical_hits
           CROSS JOIN agent_memory am NOT INDEXED
           WHERE am.rowid = lexical_hits.memory_rowid
             AND am.agent_id = ?
             AND ${buildRecallablePredicate('am')}
           ORDER BY lexical_hits.lexical_score ASC,
                    am.importance DESC,
                    am.created_at DESC,
                    am.id ASC
           LIMIT ?
         ), importance_candidates AS MATERIALIZED (
           SELECT am.rowid AS memory_rowid,
                  am.id,
                  am.importance,
                  am.created_at
           FROM agent_memory am INDEXED BY idx_agent_memory_recall_importance_v4
           WHERE am.agent_id = ?
             AND ${buildRecallablePredicate('am')}
           ORDER BY am.importance DESC, am.created_at DESC, am.id ASC
           LIMIT ?
         ), importance AS MATERIALIZED (
           SELECT candidate.memory_rowid,
                  candidate.id,
                  candidate.importance,
                  candidate.created_at
           FROM agent_memory_fts f
           CROSS JOIN importance_candidates candidate
           WHERE agent_memory_fts MATCH ?
             AND f.rowid = candidate.memory_rowid
           ORDER BY candidate.importance DESC,
                    candidate.created_at DESC,
                    candidate.id ASC
           LIMIT ?
         ), combined AS (
           SELECT memory_rowid, 0 AS source_order, lexical_score, importance, created_at, id
           FROM lexical
           UNION ALL
           SELECT importance.memory_rowid, 1, NULL, importance.importance,
                  importance.created_at, importance.id
           FROM importance
           WHERE NOT EXISTS (
             SELECT 1 FROM lexical WHERE lexical.memory_rowid = importance.memory_rowid
           )
         )
         SELECT am.*
         FROM combined
         JOIN agent_memory am ON am.rowid = combined.memory_rowid
         ORDER BY combined.source_order ASC,
                  combined.lexical_score ASC,
                  combined.importance DESC,
                  combined.created_at DESC,
                  combined.id ASC`
      )
      .all(
        match,
        lexicalScanLimit,
        agentId,
        limit,
        agentId,
        importanceCandidateLimit,
        match,
        limit
      ) as AgentMemoryRow[]
  }

  private searchLike(
    agentId: string,
    terms: string[],
    limit: number,
    matchMode: SearchMatchMode
  ): AgentMemoryRow[] {
    if (!terms.length) return []
    const clauses = terms.map(() => "content LIKE ? ESCAPE '\\'")
    const params = terms.map((term) => `%${escapeLikePattern(term)}%`)
    const operator = matchMode === 'any' ? ' OR ' : ' AND '
    return this.db
      .prepare(
        `SELECT * FROM agent_memory
         WHERE agent_id = ?
           AND ${buildRecallablePredicate()}
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
    const before = this.getFtsMirrorRow(id)
    const nextRecallable = isRecallableFtsRow(before ? { ...before, status } : undefined)
    const mutation = () =>
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
    if (isRecallableFtsRow(before) === nextRecallable) mutation()
    else this.runRecallMutation(mutation, () => this.replaceFtsMirrorRow(before, id))
  }

  activateForEmbedding(id: string): void {
    const before = this.getFtsMirrorRow(id)
    const mutation = () =>
      this.db
        .prepare(
          `UPDATE agent_memory
         SET status = ?, embedding_id = NULL, embedding_dim = NULL, embedding_model = NULL,
             decision_revision = decision_revision + 1
         WHERE id = ?`
        )
        .run('pending_embedding', id)
    if (isRecallableFtsRow(before)) mutation()
    else this.runRecallMutation(mutation, () => this.replaceFtsMirrorRow(before, id))
  }

  activateForEmbeddingIfRevision(agentId: string, id: string, expectedRevision: number): boolean {
    const before = this.getFtsMirrorRow(id)
    const mutation = () =>
      this.db
        .prepare(
          `UPDATE agent_memory
         SET status = ?, embedding_id = NULL, embedding_dim = NULL, embedding_model = NULL,
             decision_revision = decision_revision + 1
         WHERE agent_id = ? AND id = ? AND decision_revision = ?`
        )
        .run('pending_embedding', agentId, id, expectedRevision)
    const result = isRecallableFtsRow(before)
      ? mutation()
      : this.runRecallMutation(mutation, () => this.replaceFtsMirrorRow(before, id))
    return result.changes > 0
  }

  markPendingEmbeddingsReady(
    agentId: string,
    updates: ReadonlyArray<{
      id: string
      expectedRevision: number
      embeddingId: string
      embeddingDim: number
      embeddingModel: string
    }>
  ): string[] {
    if (!updates.length) return []
    const { valuesSql, params } = buildRevisionAwareEmbeddingValues(updates, (update) => [
      update.embeddingId,
      update.embeddingDim,
      update.embeddingModel
    ])
    const rows = this.db
      .prepare(
        `WITH updates(id, expected_revision, embedding_id, embedding_dim, embedding_model) AS (
           VALUES ${valuesSql}
         )
         UPDATE agent_memory
         SET status = 'embedded',
             embedding_id = (SELECT embedding_id FROM updates WHERE updates.id = agent_memory.id),
             embedding_dim = (SELECT embedding_dim FROM updates WHERE updates.id = agent_memory.id),
             embedding_model = (SELECT embedding_model FROM updates WHERE updates.id = agent_memory.id)
         WHERE agent_id = ?
           AND status = 'pending_embedding'
           AND superseded_by IS NULL
           AND kind NOT IN ('persona', 'working')
           AND EXISTS (
             SELECT 1
             FROM updates
             WHERE updates.id = agent_memory.id
               AND updates.expected_revision = agent_memory.decision_revision
           )
         RETURNING id`
      )
      .all(...params, agentId) as Array<{ id: string }>
    return rows.map((row) => row.id)
  }

  markPendingEmbeddingsError(
    agentId: string,
    updates: ReadonlyArray<{ id: string; expectedRevision: number }>,
    status: Extract<AgentMemoryStatus, 'error' | 'fts_only'> = 'error'
  ): string[] {
    if (!updates.length) return []
    const { valuesSql, params } = buildRevisionAwareEmbeddingValues(updates)
    const rows = this.db
      .prepare(
        `WITH updates(id, expected_revision) AS (
           VALUES ${valuesSql}
         )
         UPDATE agent_memory
         SET status = ?,
             embedding_id = NULL,
             embedding_dim = NULL,
             embedding_model = NULL
         WHERE agent_id = ?
           AND status = 'pending_embedding'
           AND superseded_by IS NULL
           AND kind NOT IN ('persona', 'working')
           AND EXISTS (
             SELECT 1
             FROM updates
             WHERE updates.id = agent_memory.id
               AND updates.expected_revision = agent_memory.decision_revision
           )
         RETURNING id`
      )
      .all(...params, status, agentId) as Array<{ id: string }>
    return rows.map((row) => row.id)
  }

  // Resets the embedding state of the agent's non-superseded rows in `statuses` back to
  // pending_embedding in a single statement (no per-row round trips), so a reindex/backfill can
  // re-queue a whole corpus without blocking. persona and working rows are excluded: the self-model
  // is injected verbatim and the working blob is an internal open-session cache, so neither is
  // vector-recalled and both must stay out of the vector store. Requeuing them would strand the row
  // in pending_embedding forever, since listPendingEmbedding never returns those kinds. Status
  // changes do not affect recallability or content, so derived FTS maintenance is unnecessary.
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

  listCurrentEmbeddedIds(
    agentId: string,
    embeddingDim: number,
    embeddingModel: string,
    afterId: string | null,
    limit: number
  ): string[] {
    const cappedLimit = Math.max(0, Math.floor(limit))
    if (cappedLimit === 0) return []
    const afterSql = afterId === null ? '' : 'AND id > ?'
    const params: Array<string | number> = [agentId, embeddingDim, embeddingModel]
    if (afterId !== null) params.push(afterId)
    params.push(cappedLimit)
    const rows = this.db
      .prepare(
        `SELECT id
         FROM agent_memory
         WHERE agent_id = ?
           AND status = 'embedded'
           AND superseded_by IS NULL
           AND kind NOT IN ('persona', 'working')
           AND embedding_dim = ?
           AND embedding_model = ?
           ${afterSql}
         ORDER BY id ASC
         LIMIT ?`
      )
      .all(...params) as Array<{ id: string }>
    return rows.map((row) => row.id)
  }

  markSuperseded(id: string, supersededBy: string | null): void {
    const before = this.getFtsMirrorRow(id)
    this.runRecallMutation(
      () =>
        this.db
          .prepare(
            'UPDATE agent_memory SET superseded_by = ?, decision_revision = decision_revision + 1 WHERE id = ?'
          )
          .run(supersededBy, id),
      () => this.replaceFtsMirrorRow(before, id)
    )
  }

  markSupersededIfRevision(
    agentId: string,
    id: string,
    expectedRevision: number,
    supersededBy: string
  ): boolean {
    const before = this.getFtsMirrorRow(id)
    const result = this.runRecallMutation(
      () =>
        this.db
          .prepare(
            `UPDATE agent_memory
         SET superseded_by = ?, decision_revision = decision_revision + 1
         WHERE id = ? AND agent_id = ? AND decision_revision = ?
           AND superseded_by IS NULL AND conflict_state IS NULL
           AND status NOT IN ('archived', 'conflicted')`
          )
          .run(supersededBy, id, agentId, expectedRevision),
      () => this.replaceFtsMirrorRow(before, id)
    )
    return result.changes === 1
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

  // Refreshes a row's content in place (UPDATE/merge decision), keeping its provenance_key in sync
  // with the new content so the idempotent dedup short-circuit keeps matching. last_accessed is
  // re-anchored too so a rewritten row's forgetting clock resets — a just-merged current-truth row
  // therefore cannot be archived in the same maintenance pass. Explicit savepoint-isolated FTS
  // maintenance keeps the keyword mirror aligned with the authoritative content.
  updateContent(
    id: string,
    content: string,
    provenanceKey: string | null,
    at: number = Date.now(),
    category?: string | null
  ): void {
    const before = this.getFtsMirrorRow(id)
    this.runRecallMutation(
      () => {
        if (category !== undefined) {
          return this.db
            .prepare(
              `UPDATE agent_memory
               SET content = ?, provenance_key = ?, last_accessed = ?, category = ?,
                   decision_revision = decision_revision + 1
               WHERE id = ?`
            )
            .run(content, provenanceKey, at, category, id)
        }
        return this.db
          .prepare(
            `UPDATE agent_memory
             SET content = ?, provenance_key = ?, last_accessed = ?,
                 decision_revision = decision_revision + 1
             WHERE id = ?`
          )
          .run(content, provenanceKey, at, id)
      },
      () => this.replaceFtsMirrorRow(before, id)
    )
  }

  updateDecisionContentIfRevision(input: {
    agentId: string
    id: string
    expectedRevision: number
    content: string
    provenanceKey: string | null
    at: number
    category?: string | null
  }): boolean {
    const { agentId, id, expectedRevision, content, provenanceKey, at, category } = input
    const categorySql = category === undefined ? '' : ', category = ?'
    const params: unknown[] = [content, provenanceKey, at]
    if (category !== undefined) params.push(category)
    params.push(id, agentId, expectedRevision)
    const before = this.getFtsMirrorRow(id)
    const result = this.runRecallMutation(
      () =>
        this.db
          .prepare(
            `UPDATE agent_memory
         SET content = ?, provenance_key = ?, last_accessed = ?${categorySql},
             status = 'pending_embedding',
             embedding_id = NULL, embedding_dim = NULL, embedding_model = NULL,
             decision_revision = decision_revision + 1
         WHERE id = ? AND agent_id = ? AND decision_revision = ?
           AND superseded_by IS NULL AND conflict_state IS NULL
           AND status NOT IN ('archived', 'conflicted')`
          )
          .run(...params),
      () => this.replaceFtsMirrorRow(before, id)
    )
    return result.changes === 1
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
    sets.push('decision_revision = decision_revision + 1')
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
      .prepare(
        `UPDATE agent_memory
         SET importance = ?, decision_revision = decision_revision + 1
         WHERE id = ? AND importance < ?`
      )
      .run(importance, id, importance)
  }

  markConflict(id: string, state: AgentMemoryConflictState | null): void {
    this.db
      .prepare(
        'UPDATE agent_memory SET conflict_state = ?, decision_revision = decision_revision + 1 WHERE id = ?'
      )
      .run(state, id)
  }

  markConflictIfRevision(
    agentId: string,
    id: string,
    expectedRevision: number,
    state: AgentMemoryConflictState
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE agent_memory
         SET conflict_state = ?, decision_revision = decision_revision + 1
         WHERE id = ? AND agent_id = ? AND decision_revision = ?
           AND superseded_by IS NULL AND conflict_state IS NULL
           AND status NOT IN ('archived', 'conflicted')`
      )
      .run(state, id, agentId, expectedRevision)
    return result.changes === 1
  }

  setConflictWith(id: string, targetId: string | null): void {
    this.db
      .prepare(
        'UPDATE agent_memory SET conflict_with = ?, decision_revision = decision_revision + 1 WHERE id = ?'
      )
      .run(targetId, id)
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
    const before = this.getFtsMirrorRow(id)
    this.runRecallMutation(
      () =>
        this.db
          .prepare(
            "UPDATE agent_memory SET status = 'archived', decision_revision = decision_revision + 1 WHERE id = ?"
          )
          .run(id),
      () => this.deleteFtsMirrorRow(before)
    )
  }

  archiveEligibleBatch(
    agentId: string,
    options: {
      now: number
      createdBefore: number
      minimumBaseAgeMs: number
      limit: number
    }
  ): string[] {
    const limit = Math.max(0, Math.floor(options.limit))
    if (limit === 0) return []
    let rows: Array<{ id: string }> = []
    this.runRecallMutation(
      () => {
        rows = this.db
          .prepare(
            `WITH eligible AS (
           SELECT id
           FROM agent_memory INDEXED BY idx_agent_memory_archive_eligible_v2
           WHERE agent_id = ?
             AND superseded_by IS NULL
             AND conflict_state IS NULL
             AND status NOT IN ('archived', 'conflicted')
             AND is_anchor = 0
             AND kind NOT IN ('persona', 'working')
             AND created_at < ?
             AND COALESCE(last_accessed, created_at) < ? - ?
             AND (? - COALESCE(last_accessed, created_at)) >
               ? * (1 + min(1.0, max(0.0, importance)))
           ORDER BY COALESCE(last_accessed, created_at) ASC, created_at ASC, id ASC
           LIMIT ?
         )
         UPDATE agent_memory
         SET status = 'archived', decision_revision = decision_revision + 1
         WHERE id IN (SELECT id FROM eligible)
         RETURNING id`
          )
          .all(
            agentId,
            options.createdBefore,
            options.now,
            options.minimumBaseAgeMs,
            options.now,
            options.minimumBaseAgeMs,
            limit
          ) as Array<{ id: string }>
        return rows
      },
      () => {
        for (const row of rows) this.deleteFtsMirrorRow(this.getFtsMirrorRow(row.id), true)
      }
    )
    return rows.map((row) => row.id)
  }

  countArchiveEligible(
    agentId: string,
    options: { now: number; createdBefore: number; minimumBaseAgeMs: number }
  ): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM agent_memory INDEXED BY idx_agent_memory_archive_eligible_v2
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND conflict_state IS NULL
           AND status NOT IN ('archived', 'conflicted')
           AND is_anchor = 0
           AND kind NOT IN ('persona', 'working')
           AND created_at < ?
           AND COALESCE(last_accessed, created_at) < ? - ?
           AND (? - COALESCE(last_accessed, created_at)) >
             ? * (1 + min(1.0, max(0.0, importance)))`
      )
      .get(
        agentId,
        options.createdBefore,
        options.now,
        options.minimumBaseAgeMs,
        options.now,
        options.minimumBaseAgeMs
      ) as { count: number } | undefined
    return row?.count ?? 0
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
                confidence,
                conflict_state
         FROM agent_memory
         WHERE agent_id = ?
           AND superseded_by IS NULL
           AND conflict_state IS NULL
           AND status NOT IN ('archived', 'conflicted')
           AND is_anchor = 0
           AND kind NOT IN ('persona', 'working')
           AND created_at < ?
         ORDER BY COALESCE(last_accessed, created_at) ASC, created_at ASC, id ASC
         LIMIT ?`
      )
      .all(agentId, before, cappedLimit) as AgentMemoryLifecycleRow[]
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
    const before = this.getFtsMirrorRow(id)
    this.runRecallMutation(
      () => this.db.prepare('DELETE FROM agent_memory WHERE id = ?').run(id),
      () => this.deleteFtsMirrorRow(before)
    )
  }

  clearByAgent(agentId: string): number {
    const result = this.runRecallBulkDelete(
      () =>
        this.db
          .prepare(
            `INSERT INTO agent_memory_fts(agent_memory_fts, rowid, content, agent_id)
             SELECT 'delete', rowid, content, ${buildAgentFtsScopeSql('agent_id')}
             FROM agent_memory
             WHERE agent_id = ? AND ${buildRecallablePredicate()}`
          )
          .run(agentId),
      () => this.db.prepare('DELETE FROM agent_memory WHERE agent_id = ?').run(agentId)
    )
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

  isUnresolvedConflictParticipant(agentId: string, memoryId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS found
         FROM agent_memory candidate
         WHERE candidate.agent_id = ?
           AND candidate.id = ?
           AND (
             (candidate.status = 'conflicted' AND candidate.conflict_with IS NOT NULL)
             OR EXISTS (
               SELECT 1
               FROM agent_memory challenger
               WHERE challenger.agent_id = candidate.agent_id
                 AND challenger.status = 'conflicted'
                 AND challenger.superseded_by IS NULL
                 AND challenger.conflict_with = candidate.id
             )
           )
         LIMIT 1`
      )
      .get(agentId, memoryId) as { found: number } | undefined
    return row?.found === 1
  }

  listConflictIntegrityRows(agentId: string): AgentMemoryRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM agent_memory
         WHERE agent_id = ?
           AND (status = 'conflicted' OR conflict_with IS NOT NULL OR conflict_state IS NOT NULL)
         ORDER BY created_at ASC, id ASC`
      )
      .all(agentId) as AgentMemoryRow[]
  }

  listConflictChallengersForMaintenance(agentId: string, limit: number): AgentMemoryRow[] {
    const cappedLimit = Math.max(0, Math.floor(limit))
    if (cappedLimit === 0) return []
    return this.db
      .prepare(
        `SELECT challenger.*
         FROM agent_memory challenger INDEXED BY idx_agent_memory_conflict_fairness_v2
         WHERE challenger.agent_id = ?
           AND challenger.status = 'conflicted'
           AND challenger.superseded_by IS NULL
           AND EXISTS (
             SELECT 1
             FROM agent_memory target
             WHERE target.id = challenger.conflict_with
               AND target.agent_id = challenger.agent_id
               AND target.conflict_state = 'challenged'
               AND target.superseded_by IS NULL
           )
         ORDER BY COALESCE(challenger.last_consolidated_at, 0) ASC,
                  challenger.created_at ASC,
                  challenger.id ASC
         LIMIT ?`
      )
      .all(agentId, cappedLimit) as AgentMemoryRow[]
  }

  listConflictSiblings(
    agentId: string,
    targetId: string,
    excludeChallengerId: string
  ): AgentMemoryRow[] {
    return this.db
      .prepare(
        `SELECT *
         FROM agent_memory
         WHERE agent_id = ?
           AND conflict_with = ?
           AND status = 'conflicted'
           AND superseded_by IS NULL
           AND id != ?
         ORDER BY created_at ASC, id ASC`
      )
      .all(agentId, targetId, excludeChallengerId) as AgentMemoryRow[]
  }

  retireConflictSiblings(
    agentId: string,
    targetId: string,
    excludeChallengerId: string,
    winnerId: string,
    _at: number
  ): number {
    return this.db
      .prepare(
        `UPDATE agent_memory
         SET conflict_with = NULL,
             superseded_by = ?,
             status = 'archived',
             decision_revision = decision_revision + 1
         WHERE agent_id = ?
           AND conflict_with = ?
           AND status = 'conflicted'
           AND superseded_by IS NULL
           AND id != ?`
      )
      .run(winnerId, agentId, targetId, excludeChallengerId).changes
  }

  clearTargetConflictIfNoChallengers(agentId: string, targetId: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE agent_memory AS target
         SET conflict_state = NULL, decision_revision = decision_revision + 1
         WHERE target.agent_id = ?
           AND target.id = ?
           AND target.conflict_state = 'challenged'
           AND NOT EXISTS (
             SELECT 1
             FROM agent_memory challenger
             WHERE challenger.agent_id = target.agent_id
               AND challenger.conflict_with = target.id
               AND challenger.status = 'conflicted'
               AND challenger.superseded_by IS NULL
           )`
      )
      .run(agentId, targetId)
    return result.changes === 1
  }

  repairConflictIntegrityBatch(
    agentId: string,
    limit: number
  ): {
    repairedTargets: number
    archivedChallengers: number
    clearedTargets: number
    clearedLinks: number
  } {
    const cappedLimit = Math.max(0, Math.min(256, Math.floor(limit)))
    const empty = {
      repairedTargets: 0,
      archivedChallengers: 0,
      clearedTargets: 0,
      clearedLinks: 0
    }
    if (cappedLimit === 0) return empty
    const perClassLimit = Math.ceil(cappedLimit / 4)

    return this.db.transaction(() => {
      this.db.exec(
        `CREATE TEMP TABLE IF NOT EXISTS memory_conflict_repair_batch (
           id TEXT PRIMARY KEY
         ) WITHOUT ROWID`
      )
      this.db.exec('DELETE FROM memory_conflict_repair_batch')
      this.db
        .prepare(
          `INSERT INTO memory_conflict_repair_batch (id)
           SELECT id FROM (
             SELECT id FROM (
               SELECT id
               FROM agent_memory INDEXED BY idx_agent_memory_conflict_link_anomaly_v2
               WHERE agent_id = ? AND status != 'conflicted' AND conflict_with IS NOT NULL
               LIMIT ?
             )
             UNION ALL
             SELECT id FROM (
               SELECT challenger.id
               FROM agent_memory challenger
               WHERE challenger.agent_id = ? AND challenger.status = 'conflicted'
                 AND (
                   challenger.superseded_by IS NOT NULL
                   OR challenger.conflict_with IS NULL
                   OR challenger.conflict_with = challenger.id
                   OR NOT EXISTS (
                     SELECT 1 FROM agent_memory target
                     WHERE target.id = challenger.conflict_with
                       AND target.agent_id = challenger.agent_id
                       AND target.status NOT IN ('archived', 'conflicted')
                       AND target.superseded_by IS NULL
                   )
                 )
               LIMIT ?
             )
             UNION ALL
             SELECT id FROM (
               SELECT target.id
               FROM agent_memory target
               WHERE target.agent_id = ? AND target.conflict_state IS NOT 'challenged'
                 AND EXISTS (
                   SELECT 1 FROM agent_memory challenger
                   WHERE challenger.agent_id = target.agent_id
                     AND challenger.conflict_with = target.id
                     AND challenger.status = 'conflicted'
                     AND challenger.superseded_by IS NULL
                 )
               LIMIT ?
             )
             UNION ALL
             SELECT id FROM (
               SELECT target.id
               FROM agent_memory target INDEXED BY idx_agent_memory_conflict_state_anomaly_v2
               WHERE target.agent_id = ? AND target.conflict_state = 'challenged'
                 AND NOT EXISTS (
                   SELECT 1 FROM agent_memory challenger
                   WHERE challenger.agent_id = target.agent_id
                     AND challenger.conflict_with = target.id
                     AND challenger.status = 'conflicted'
                     AND challenger.superseded_by IS NULL
                 )
               LIMIT ?
             )
           )
           LIMIT ?`
        )
        .run(
          agentId,
          perClassLimit,
          agentId,
          perClassLimit,
          agentId,
          perClassLimit,
          agentId,
          perClassLimit,
          cappedLimit
        )

      const clearedLinks = this.db
        .prepare(
          `UPDATE agent_memory
           SET conflict_with = NULL, decision_revision = decision_revision + 1
           WHERE id IN (SELECT id FROM memory_conflict_repair_batch)
             AND agent_id = ?
             AND status != 'conflicted'
             AND conflict_with IS NOT NULL`
        )
        .run(agentId).changes
      const archivedChallengers = this.db
        .prepare(
          `UPDATE agent_memory AS challenger
           SET conflict_with = NULL,
               status = 'archived',
               decision_revision = decision_revision + 1
           WHERE challenger.id IN (SELECT id FROM memory_conflict_repair_batch)
             AND challenger.agent_id = ?
             AND challenger.status = 'conflicted'
             AND (
               challenger.superseded_by IS NOT NULL
               OR challenger.conflict_with IS NULL
               OR challenger.conflict_with = challenger.id
               OR NOT EXISTS (
                 SELECT 1
                 FROM agent_memory target
                 WHERE target.id = challenger.conflict_with
                   AND target.agent_id = challenger.agent_id
                   AND target.status NOT IN ('archived', 'conflicted')
                   AND target.superseded_by IS NULL
               )
             )`
        )
        .run(agentId).changes
      const repairedTargets = this.db
        .prepare(
          `UPDATE agent_memory AS target
           SET conflict_state = 'challenged', decision_revision = decision_revision + 1
           WHERE target.agent_id = ?
             AND target.id IN (SELECT id FROM memory_conflict_repair_batch)
             AND target.conflict_state IS NOT 'challenged'
             AND EXISTS (
               SELECT 1
               FROM agent_memory challenger
               WHERE challenger.agent_id = target.agent_id
                 AND challenger.conflict_with = target.id
                 AND challenger.status = 'conflicted'
                 AND challenger.superseded_by IS NULL
             )`
        )
        .run(agentId).changes
      const clearedTargets = this.db
        .prepare(
          `UPDATE agent_memory AS target
           SET conflict_state = NULL, decision_revision = decision_revision + 1
           WHERE target.id IN (SELECT id FROM memory_conflict_repair_batch)
             AND target.agent_id = ?
             AND target.conflict_state = 'challenged'
             AND NOT EXISTS (
               SELECT 1
               FROM agent_memory challenger
               WHERE challenger.agent_id = target.agent_id
                 AND challenger.conflict_with = target.id
                 AND challenger.status = 'conflicted'
                 AND challenger.superseded_by IS NULL
             )`
        )
        .run(agentId).changes

      return { repairedTargets, archivedChallengers, clearedTargets, clearedLinks }
    })()
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

  listRecentlyActiveAgentIds(candidateAgentIds: readonly string[], limit: number): string[] {
    const candidates = [...new Set(candidateAgentIds.filter((agentId) => agentId.length > 0))]
    const cappedLimit = Math.max(0, Math.floor(limit))
    if (cappedLimit === 0 || candidates.length === 0) return []
    const values = candidates.map(() => '(?)').join(', ')
    const rows = this.db
      .prepare(
        `WITH candidates(agent_id) AS (VALUES ${values}), activity AS (
           SELECT candidates.agent_id,
                  (
                    SELECT COALESCE(memory.last_accessed, memory.created_at)
                    FROM agent_memory memory INDEXED BY idx_agent_memory_recent_activity_v2
                    WHERE memory.agent_id = candidates.agent_id AND memory.status != 'archived'
                    ORDER BY COALESCE(memory.last_accessed, memory.created_at) DESC
                    LIMIT 1
                  ) AS activity_at
           FROM candidates
         )
         SELECT agent_id
         FROM activity
         WHERE activity_at IS NOT NULL
         ORDER BY activity_at DESC, agent_id ASC
         LIMIT ?`
      )
      .all(...candidates, cappedLimit) as Array<{ agent_id: string }>
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
