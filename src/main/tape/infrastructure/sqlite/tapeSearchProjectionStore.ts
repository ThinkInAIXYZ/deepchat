import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import { buildDeepChatTapeFtsMatch, buildDeepChatTapeLikeSearchPredicate } from './tapeEntryStore'
import {
  normalizeDeepChatTapeReadSources,
  serializeDeepChatTapeReadSources
} from '@/tape/domain/entry'
import type { DeepChatTapeReadSource, DeepChatTapeSearchInput } from '@/tape/domain/entry'
import type {
  TapeSearchProjectionInput,
  TapeSearchProjectionMeta,
  TapeSearchProjectionReadResult,
  TapeSearchProjectionResultRow,
  TapeSearchProjectionRow,
  TapeSearchProjectionStore
} from '@/tape/ports/application'

// Version 3 invalidates projections that may predate atomic Tape generation transitions. A
// matching entry-id head alone cannot prove that a version 2 row belongs to the current
// incarnation after a previously interrupted reset.
export const DEEPCHAT_TAPE_SEARCH_PROJECTION_VERSION = 3

export type DeepChatTapeSearchProjectionInput = TapeSearchProjectionInput
export type DeepChatTapeSearchProjectionRow = TapeSearchProjectionRow
export type DeepChatTapeSearchProjectionResultRow = TapeSearchProjectionResultRow
export type DeepChatTapeSearchProjectionMeta = TapeSearchProjectionMeta
export type DeepChatTapeSearchProjectionReadResult = TapeSearchProjectionReadResult

type FtsCapability = { available: boolean; tokenizer: 'trigram' | 'unicode61' }

const FTS_CAPABILITY_BY_DATABASE = new WeakMap<Database.Database, FtsCapability>()

const TAPE_SEARCH_PROJECTION_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_deepchat_tape_search_projection_session_kind
    ON deepchat_tape_search_projection(session_id, kind, entry_id);
  CREATE INDEX IF NOT EXISTS idx_deepchat_tape_search_projection_session_created
    ON deepchat_tape_search_projection(session_id, created_at, entry_id);
`

function normalizeLimit(limit: number | undefined): number {
  return Math.min(Math.max(Math.floor(Number.isFinite(limit) ? (limit as number) : 20), 1), 100)
}

function safeJsonStringify(value: Record<string, unknown>): string {
  return JSON.stringify(value ?? {})
}

function parseRefs(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export class DeepChatTapeSearchProjectionTable
  extends BaseTable
  implements TapeSearchProjectionStore
{
  private ftsCapability: FtsCapability | undefined
  private ftsReady = false

  constructor(db: Database.Database) {
    super(db, 'deepchat_tape_search_projection')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS deepchat_tape_search_projection (
        session_id TEXT NOT NULL,
        entry_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        name TEXT,
        source_type TEXT,
        source_id TEXT,
        source_seq INTEGER,
        search_text TEXT NOT NULL,
        summary_text TEXT NOT NULL,
        refs_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, entry_id)
      );
      CREATE TABLE IF NOT EXISTS deepchat_tape_search_projection_meta (
        session_id TEXT PRIMARY KEY,
        projection_version INTEGER NOT NULL,
        max_entry_id INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS deepchat_tape_search_fts_meta (
        session_id TEXT PRIMARY KEY,
        projection_version INTEGER NOT NULL,
        max_entry_id INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      ${TAPE_SEARCH_PROJECTION_INDEX_SQL}
    `
  }

  override createTable(): void {
    this.db.exec(this.getCreateTableSQL())
    this.pruneInvalidProjectionRows()
    if (!this.ftsReady) {
      this.ensureFtsIndex()
    }
  }

  getMigrationSQL(_version: number): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
  }

  getSessionMeta(sessionId: string): DeepChatTapeSearchProjectionMeta | null {
    const row = this.db
      .prepare(
        `SELECT projection_version, max_entry_id
         FROM deepchat_tape_search_projection_meta
         WHERE session_id = ?`
      )
      .get(sessionId) as
      | {
          projection_version: number
          max_entry_id: number
        }
      | undefined
    if (!row) return null
    return {
      projectionVersion: row.projection_version,
      maxEntryId: row.max_entry_id
    }
  }

  isCurrent(
    sessionId: string,
    maxEntryId: number,
    projectionVersion = DEEPCHAT_TAPE_SEARCH_PROJECTION_VERSION
  ): boolean {
    const row = this.getSessionMeta(sessionId)
    return row?.projectionVersion === projectionVersion && row.maxEntryId === maxEntryId
  }

  getProjectedEntryIds(sessionId: string): number[] {
    return (
      this.db
        .prepare(
          `SELECT entry_id
           FROM deepchat_tape_search_projection
           WHERE session_id = ?
           ORDER BY entry_id ASC`
        )
        .all(sessionId) as Array<{ entry_id: number }>
    ).map((row) => row.entry_id)
  }

  appendSession(
    sessionId: string,
    rows: DeepChatTapeSearchProjectionInput[],
    maxEntryId: number,
    projectionVersion = DEEPCHAT_TAPE_SEARCH_PROJECTION_VERSION
  ): void {
    const previousMeta = this.getSessionMeta(sessionId)
    try {
      this.db.transaction(() => {
        if (!this.ftsReady) {
          this.clearSessionFtsForBaseWrite(sessionId)
        }
        this.insertProjectionRows(rows)
        if (this.ftsReady) {
          if (previousMeta && this.isFtsCurrent(sessionId, previousMeta)) {
            this.insertFtsRows(rows)
          } else {
            this.replaceSessionFtsRows(sessionId, this.getSessionProjectionInputs(sessionId))
          }
          this.upsertFtsMeta(sessionId, projectionVersion, maxEntryId)
        }
        this.upsertMeta(sessionId, projectionVersion, maxEntryId)
      })()
    } catch (error) {
      if (this.ftsReady) {
        this.ftsReady = false
      }
      throw error
    }
  }

  replaceSession(
    sessionId: string,
    rows: DeepChatTapeSearchProjectionInput[],
    maxEntryId: number,
    projectionVersion = DEEPCHAT_TAPE_SEARCH_PROJECTION_VERSION
  ): void {
    try {
      this.db.transaction(() => {
        if (this.ftsReady) {
          this.db
            .prepare('DELETE FROM deepchat_tape_search_fts WHERE session_id = ?')
            .run(sessionId)
          this.db
            .prepare('DELETE FROM deepchat_tape_search_fts_meta WHERE session_id = ?')
            .run(sessionId)
        } else {
          this.clearSessionFtsForBaseWrite(sessionId)
        }
        this.db
          .prepare('DELETE FROM deepchat_tape_search_projection WHERE session_id = ?')
          .run(sessionId)
        this.db
          .prepare('DELETE FROM deepchat_tape_search_projection_meta WHERE session_id = ?')
          .run(sessionId)
        this.insertProjectionRows(rows)
        if (this.ftsReady) {
          this.insertFtsRows(rows)
          this.upsertFtsMeta(sessionId, projectionVersion, maxEntryId)
        }
        this.upsertMeta(sessionId, projectionVersion, maxEntryId)
      })()
    } catch (error) {
      if (this.ftsReady) {
        this.ftsReady = false
      }
      throw error
    }
  }

  private insertProjectionRows(rows: DeepChatTapeSearchProjectionInput[]): void {
    if (!rows.length) return
    const insertProjection = this.db.prepare(
      `INSERT OR REPLACE INTO deepchat_tape_search_projection (
         session_id,
         entry_id,
         kind,
         name,
         source_type,
         source_id,
         source_seq,
         search_text,
         summary_text,
         refs_json,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const row of rows) {
      insertProjection.run(
        row.sessionId,
        row.entryId,
        row.kind,
        row.name,
        row.sourceType,
        row.sourceId,
        row.sourceSeq,
        row.searchText,
        row.summaryText,
        safeJsonStringify(row.refs),
        row.createdAt
      )
    }
  }

  private upsertMeta(sessionId: string, projectionVersion: number, maxEntryId: number): void {
    this.db
      .prepare(
        `INSERT INTO deepchat_tape_search_projection_meta (
           session_id,
           projection_version,
           max_entry_id,
           updated_at
         )
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           projection_version = excluded.projection_version,
           max_entry_id = excluded.max_entry_id,
           updated_at = excluded.updated_at`
      )
      .run(sessionId, projectionVersion, maxEntryId, Date.now())
  }

  private getFtsMeta(sessionId: string): DeepChatTapeSearchProjectionMeta | null {
    const row = this.db
      .prepare(
        `SELECT projection_version, max_entry_id
         FROM deepchat_tape_search_fts_meta
         WHERE session_id = ?`
      )
      .get(sessionId) as
      | {
          projection_version: number
          max_entry_id: number
        }
      | undefined
    if (!row) return null
    return {
      projectionVersion: row.projection_version,
      maxEntryId: row.max_entry_id
    }
  }

  private isFtsCurrent(sessionId: string, meta: DeepChatTapeSearchProjectionMeta): boolean {
    const row = this.getFtsMeta(sessionId)
    return row?.projectionVersion === meta.projectionVersion && row.maxEntryId === meta.maxEntryId
  }

  private upsertFtsMeta(sessionId: string, projectionVersion: number, maxEntryId: number): void {
    this.db
      .prepare(
        `INSERT INTO deepchat_tape_search_fts_meta (
           session_id,
           projection_version,
           max_entry_id,
           updated_at
         )
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           projection_version = excluded.projection_version,
           max_entry_id = excluded.max_entry_id,
           updated_at = excluded.updated_at`
      )
      .run(sessionId, projectionVersion, maxEntryId, Date.now())
  }

  getByEntryIds(sessionId: string, entryIds: number[]): DeepChatTapeSearchProjectionRow[] {
    const ids = [...new Set(entryIds.filter((id) => Number.isInteger(id) && id > 0))]
    if (!ids.length) return []
    const placeholders = ids.map(() => '?').join(', ')
    return this.db
      .prepare(
        `SELECT *
         FROM deepchat_tape_search_projection
         WHERE session_id = ? AND entry_id IN (${placeholders})
         ORDER BY entry_id ASC`
      )
      .all(sessionId, ...ids) as DeepChatTapeSearchProjectionRow[]
  }

  getByEntryIdsIfCurrent(
    sessionId: string,
    maxEntryId: number,
    entryIds: number[],
    projectionVersion = DEEPCHAT_TAPE_SEARCH_PROJECTION_VERSION
  ): DeepChatTapeSearchProjectionRow[] {
    const ids = [...new Set(entryIds.filter((id) => Number.isInteger(id) && id > 0))]
    if (!ids.length) return []
    const placeholders = ids.map(() => '?').join(', ')
    return this.db
      .prepare(
        `SELECT projection.*
         FROM deepchat_tape_search_projection AS projection
         INNER JOIN deepchat_tape_search_projection_meta AS meta
           ON meta.session_id = projection.session_id
           AND meta.projection_version = ?
           AND meta.max_entry_id = ?
         WHERE projection.session_id = ? AND projection.entry_id IN (${placeholders})
         ORDER BY projection.entry_id ASC`
      )
      .all(projectionVersion, maxEntryId, sessionId, ...ids) as DeepChatTapeSearchProjectionRow[]
  }

  searchSourcesReadOnly(
    sources: readonly DeepChatTapeReadSource[],
    query: string,
    options: DeepChatTapeSearchInput = {}
  ): DeepChatTapeSearchProjectionReadResult {
    const normalizedSources = normalizeDeepChatTapeReadSources(sources)
    const coveredSources = this.getCurrentReadSources(
      normalizedSources,
      'deepchat_tape_search_projection_meta'
    )
    const normalizedQuery = query.trim()
    if (coveredSources.length === 0 || !normalizedQuery) {
      return { rows: [], coveredSources }
    }
    if (coveredSources.length !== normalizedSources.length) {
      return { rows: [], coveredSources }
    }

    const limit = normalizeLimit(options.limit)
    const ordered: DeepChatTapeSearchProjectionResultRow[] = []
    const seen = new Set<string>()
    const collect = (rows: DeepChatTapeSearchProjectionResultRow[]): void => {
      for (const row of rows) {
        const key = `${row.session_id}:${row.entry_id}`
        if (seen.has(key)) continue
        seen.add(key)
        ordered.push(row)
      }
    }

    if (this.ftsReady) {
      const ftsSources = this.getCurrentReadSources(coveredSources, 'deepchat_tape_search_fts_meta')
      if (ftsSources.length === coveredSources.length) {
        try {
          collect(this.searchFtsSourcesReadOnly(ftsSources, normalizedQuery, options, limit))
        } catch {
          // The base projection remains a complete read-only fallback.
        }
      }
    }
    if (ordered.length < limit) {
      collect(this.searchLikeSourcesReadOnly(coveredSources, normalizedQuery, options, limit))
    }

    return { rows: ordered.slice(0, limit), coveredSources }
  }

  search(
    sessionId: string,
    query: string,
    options: DeepChatTapeSearchInput = {}
  ): DeepChatTapeSearchProjectionResultRow[] {
    const normalized = query.trim()
    if (!normalized) return []
    const limit = normalizeLimit(options.limit)
    const ordered: DeepChatTapeSearchProjectionResultRow[] = []
    const seen = new Set<number>()
    const collect = (rows: DeepChatTapeSearchProjectionResultRow[]): void => {
      for (const row of rows) {
        if (seen.has(row.entry_id)) continue
        seen.add(row.entry_id)
        ordered.push(row)
      }
    }
    this.recoverSessionFts(sessionId)
    if (this.ftsReady) {
      collect(this.searchFts(sessionId, normalized, options, limit))
    }
    if (!this.ftsReady || ordered.length < limit) {
      collect(this.searchLike(sessionId, normalized, options, limit))
    }
    return ordered.slice(0, limit)
  }

  deleteBySession(sessionId: string): void {
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM deepchat_tape_search_projection WHERE session_id = ?')
        .run(sessionId)
      this.db
        .prepare('DELETE FROM deepchat_tape_search_projection_meta WHERE session_id = ?')
        .run(sessionId)
      this.deleteSessionFts(sessionId, true)
    })()
  }

  clearAll(): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM deepchat_tape_search_projection').run()
      this.db.prepare('DELETE FROM deepchat_tape_search_projection_meta').run()
      if (this.ftsMetaTableExists()) {
        this.db.prepare('DELETE FROM deepchat_tape_search_fts_meta').run()
      }
      this.clearFts(true)
    })()
  }

  private detectFtsCapability(): FtsCapability {
    if (this.ftsCapability) return this.ftsCapability
    const cached = FTS_CAPABILITY_BY_DATABASE.get(this.db)
    if (cached) {
      this.ftsCapability = cached
      return cached
    }
    const probe = (tokenizer: string): boolean => {
      const name = `temp.tape_search_fts_probe_${tokenizer}`
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
    FTS_CAPABILITY_BY_DATABASE.set(this.db, this.ftsCapability)
    return this.ftsCapability
  }

  private ensureFtsIndex(): void {
    const capability = this.detectFtsCapability()
    if (!capability.available) {
      this.ftsReady = false
      return
    }
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS deepchat_tape_search_fts USING fts5(
          search_text,
          name,
          session_id UNINDEXED,
          entry_id UNINDEXED,
          kind UNINDEXED,
          source_type UNINDEXED,
          source_id UNINDEXED,
          source_seq UNINDEXED,
          summary_text UNINDEXED,
          refs_json UNINDEXED,
          created_at UNINDEXED,
          tokenize='${capability.tokenizer}'
        );
      `)
      this.ftsReady = true
    } catch {
      this.ftsReady = false
    }
  }

  private toProjectionInput(
    row: DeepChatTapeSearchProjectionRow
  ): DeepChatTapeSearchProjectionInput {
    return {
      sessionId: row.session_id,
      entryId: row.entry_id,
      kind: row.kind,
      name: row.name,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceSeq: row.source_seq,
      searchText: row.search_text,
      summaryText: row.summary_text,
      refs: parseRefs(row.refs_json),
      createdAt: row.created_at
    }
  }

  private getSessionProjectionInputs(sessionId: string): DeepChatTapeSearchProjectionInput[] {
    return (
      this.db
        .prepare(
          `SELECT *
           FROM deepchat_tape_search_projection
           WHERE session_id = ?
           ORDER BY entry_id ASC`
        )
        .all(sessionId) as DeepChatTapeSearchProjectionRow[]
    ).map((row) => this.toProjectionInput(row))
  }

  private ftsTableExists(): boolean {
    const row = this.db
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table' AND name = 'deepchat_tape_search_fts'
         LIMIT 1`
      )
      .get() as { name: string } | undefined
    return Boolean(row)
  }

  private ftsMetaTableExists(): boolean {
    const row = this.db
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table' AND name = 'deepchat_tape_search_fts_meta'
         LIMIT 1`
      )
      .get() as { name: string } | undefined
    return Boolean(row)
  }

  private clearSessionFtsForBaseWrite(sessionId: string): void {
    if (this.ftsMetaTableExists()) {
      this.db
        .prepare('DELETE FROM deepchat_tape_search_fts_meta WHERE session_id = ?')
        .run(sessionId)
    }
    if (this.ftsTableExists()) {
      this.db.prepare('DELETE FROM deepchat_tape_search_fts WHERE session_id = ?').run(sessionId)
    }
  }

  private getProjectionRowId(sessionId: string, entryId: number): number {
    const row = this.db
      .prepare(
        `SELECT rowid
         FROM deepchat_tape_search_projection
         WHERE session_id = ? AND entry_id = ?`
      )
      .get(sessionId, entryId) as { rowid: number } | undefined
    if (!row) {
      throw new Error(`Missing tape search projection row for ${sessionId}:${entryId}`)
    }
    return row.rowid
  }

  private insertFtsRows(rows: DeepChatTapeSearchProjectionInput[]): void {
    if (!rows.length) return
    const insertFts = this.db.prepare(
      `INSERT INTO deepchat_tape_search_fts (
         rowid,
         search_text,
         name,
         session_id,
         entry_id,
         kind,
         source_type,
         source_id,
         source_seq,
         summary_text,
         refs_json,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const row of rows) {
      this.db
        .prepare('DELETE FROM deepchat_tape_search_fts WHERE session_id = ? AND entry_id = ?')
        .run(row.sessionId, row.entryId)
      insertFts.run(
        this.getProjectionRowId(row.sessionId, row.entryId),
        row.searchText,
        row.name ?? '',
        row.sessionId,
        row.entryId,
        row.kind,
        row.sourceType,
        row.sourceId,
        row.sourceSeq,
        row.summaryText,
        safeJsonStringify(row.refs),
        row.createdAt
      )
    }
  }

  private replaceSessionFtsRows(
    sessionId: string,
    rows: DeepChatTapeSearchProjectionInput[]
  ): void {
    this.db.prepare('DELETE FROM deepchat_tape_search_fts WHERE session_id = ?').run(sessionId)
    this.insertFtsRows(rows)
  }

  private replaceSessionFts(
    sessionId: string,
    rows: DeepChatTapeSearchProjectionInput[],
    projectionVersion: number,
    maxEntryId: number
  ): boolean {
    if (!this.ftsReady) return false
    try {
      this.db.transaction(() => {
        this.replaceSessionFtsRows(sessionId, rows)
        this.upsertFtsMeta(sessionId, projectionVersion, maxEntryId)
      })()
      return true
    } catch {
      this.ftsReady = false
      return false
    }
  }

  private recoverSessionFts(sessionId: string): void {
    const meta = this.getSessionMeta(sessionId)
    if (!meta) {
      this.deleteSessionFts(sessionId)
      return
    }
    if (this.ftsReady && this.isFtsCurrent(sessionId, meta)) return
    if (!this.ftsReady) {
      this.ensureFtsIndex()
    }
    if (!this.ftsReady) return
    if (this.isFtsCurrent(sessionId, meta)) return
    this.replaceSessionFts(
      sessionId,
      this.getSessionProjectionInputs(sessionId),
      meta.projectionVersion,
      meta.maxEntryId
    )
  }

  hasFtsReadyForTesting(): boolean {
    return this.ftsReady
  }

  disableFtsForTesting(): void {
    this.ftsReady = false
  }

  dropFtsForTesting(): void {
    this.dropFtsIndex()
  }

  private deleteSessionFts(sessionId: string, dropOnFailure = false): void {
    if (this.ftsMetaTableExists()) {
      this.db
        .prepare('DELETE FROM deepchat_tape_search_fts_meta WHERE session_id = ?')
        .run(sessionId)
    }
    if (!this.ftsTableExists()) return
    try {
      this.db.prepare('DELETE FROM deepchat_tape_search_fts WHERE session_id = ?').run(sessionId)
    } catch {
      this.ftsReady = false
      if (dropOnFailure) {
        this.dropFtsIndex()
      }
    }
  }

  private clearFts(dropOnFailure = false): void {
    if (this.ftsMetaTableExists()) {
      this.db.prepare('DELETE FROM deepchat_tape_search_fts_meta').run()
    }
    if (!this.ftsTableExists()) return
    try {
      this.db.prepare('DELETE FROM deepchat_tape_search_fts').run()
    } catch {
      this.ftsReady = false
      if (dropOnFailure) {
        this.dropFtsIndex()
      }
    }
  }

  private dropFtsIndex(): void {
    this.ftsReady = false
    this.db.exec('DROP TABLE IF EXISTS deepchat_tape_search_fts')
    if (this.ftsMetaTableExists()) {
      this.db.prepare('DELETE FROM deepchat_tape_search_fts_meta').run()
    }
  }

  private pruneInvalidProjectionRows(): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM deepchat_tape_search_projection
           WHERE NOT EXISTS (
             SELECT 1
             FROM deepchat_tape_search_projection_meta AS meta
             WHERE meta.session_id = deepchat_tape_search_projection.session_id
               AND meta.projection_version >= ?
           )`
        )
        .run(DEEPCHAT_TAPE_SEARCH_PROJECTION_VERSION)
      this.db
        .prepare(
          `DELETE FROM deepchat_tape_search_projection_meta
           WHERE projection_version < ?`
        )
        .run(DEEPCHAT_TAPE_SEARCH_PROJECTION_VERSION)

      if (this.ftsTableExists()) {
        try {
          this.db
            .prepare(
              `DELETE FROM deepchat_tape_search_fts
               WHERE NOT EXISTS (
                 SELECT 1
                 FROM deepchat_tape_search_fts_meta AS meta
                 WHERE meta.session_id = deepchat_tape_search_fts.session_id
                   AND meta.projection_version >= ?
               )
               OR NOT EXISTS (
                 SELECT 1
                 FROM deepchat_tape_search_projection_meta AS meta
                 WHERE meta.session_id = deepchat_tape_search_fts.session_id
                   AND meta.projection_version >= ?
               )`
            )
            .run(DEEPCHAT_TAPE_SEARCH_PROJECTION_VERSION, DEEPCHAT_TAPE_SEARCH_PROJECTION_VERSION)
        } catch {
          this.dropFtsIndex()
        }
      }
      if (this.ftsMetaTableExists()) {
        this.db
          .prepare(
            `DELETE FROM deepchat_tape_search_fts_meta
             WHERE projection_version < ?
                OR NOT EXISTS (
                  SELECT 1
                  FROM deepchat_tape_search_projection_meta AS projection_meta
                  WHERE projection_meta.session_id = deepchat_tape_search_fts_meta.session_id
                    AND projection_meta.projection_version >= ?
                )`
          )
          .run(DEEPCHAT_TAPE_SEARCH_PROJECTION_VERSION, DEEPCHAT_TAPE_SEARCH_PROJECTION_VERSION)
      }
    })()
  }

  private searchFts(
    sessionId: string,
    normalized: string,
    options: DeepChatTapeSearchInput,
    limit: number
  ): DeepChatTapeSearchProjectionResultRow[] {
    const match = buildDeepChatTapeFtsMatch(normalized)
    const whereClauses = [
      'deepchat_tape_search_fts MATCH ?',
      'deepchat_tape_search_fts.session_id = ?',
      'projection.session_id = ?'
    ]
    const params: Array<string | number> = [match, sessionId, sessionId]
    this.addFilters(whereClauses, params, options, true, 'projection')
    params.push(limit)
    try {
      return this.db
        .prepare(
          `SELECT
             projection.session_id,
             projection.entry_id,
             projection.kind,
             projection.name,
             projection.source_type,
             projection.source_id,
             projection.source_seq,
             projection.search_text,
             projection.summary_text,
             projection.refs_json,
             projection.created_at,
             bm25(deepchat_tape_search_fts) AS score
           FROM deepchat_tape_search_fts
           INNER JOIN deepchat_tape_search_projection AS projection
             ON projection.session_id = deepchat_tape_search_fts.session_id
             AND projection.entry_id = CAST(deepchat_tape_search_fts.entry_id AS INTEGER)
             AND projection.search_text = deepchat_tape_search_fts.search_text
           WHERE ${whereClauses.join(' AND ')}
           ORDER BY score ASC, projection.entry_id DESC
           LIMIT ?`
        )
        .all(...params) as DeepChatTapeSearchProjectionResultRow[]
    } catch {
      try {
        this.dropFtsIndex()
      } catch {
        this.ftsReady = false
      }
      return []
    }
  }

  private getCurrentReadSources(
    sources: readonly DeepChatTapeReadSource[],
    metaTable: 'deepchat_tape_search_projection_meta' | 'deepchat_tape_search_fts_meta'
  ): DeepChatTapeReadSource[] {
    const normalizedSources = normalizeDeepChatTapeReadSources(sources)
    if (normalizedSources.length === 0) {
      return []
    }
    const rows = this.db
      .prepare(
        `WITH requested_sources(session_id, max_entry_id) AS (
           SELECT
             json_extract(value, '$.sessionId'),
             CAST(json_extract(value, '$.maxEntryId') AS INTEGER)
           FROM json_each(?)
         )
         SELECT requested.session_id, requested.max_entry_id
         FROM requested_sources AS requested
         INNER JOIN ${metaTable} AS meta
           ON meta.session_id = requested.session_id
           AND meta.max_entry_id = requested.max_entry_id
           AND meta.projection_version = ?
         ORDER BY requested.session_id ASC`
      )
      .all(
        serializeDeepChatTapeReadSources(normalizedSources),
        DEEPCHAT_TAPE_SEARCH_PROJECTION_VERSION
      ) as Array<{ session_id: string; max_entry_id: number }>
    return rows.map((row) => ({ sessionId: row.session_id, maxEntryId: row.max_entry_id }))
  }

  private searchFtsSourcesReadOnly(
    sources: readonly DeepChatTapeReadSource[],
    normalized: string,
    options: DeepChatTapeSearchInput,
    limit: number
  ): DeepChatTapeSearchProjectionResultRow[] {
    const match = buildDeepChatTapeFtsMatch(normalized)
    const whereClauses = ['deepchat_tape_search_fts MATCH ?']
    const params: Array<string | number> = [serializeDeepChatTapeReadSources(sources), match]
    this.addFilters(whereClauses, params, options, true, 'projection')
    params.push(limit)
    return this.db
      .prepare(
        `WITH authorized_sources(session_id, max_entry_id) AS (
           SELECT
             json_extract(value, '$.sessionId'),
             CAST(json_extract(value, '$.maxEntryId') AS INTEGER)
           FROM json_each(?)
         )
         SELECT
           projection.session_id,
           projection.entry_id,
           projection.kind,
           projection.name,
           projection.source_type,
           projection.source_id,
           projection.source_seq,
           projection.search_text,
           projection.summary_text,
           projection.refs_json,
           projection.created_at,
           bm25(deepchat_tape_search_fts) AS score
         FROM deepchat_tape_search_fts
         INNER JOIN deepchat_tape_search_projection AS projection
           ON projection.session_id = deepchat_tape_search_fts.session_id
           AND projection.entry_id = CAST(deepchat_tape_search_fts.entry_id AS INTEGER)
           AND projection.search_text = deepchat_tape_search_fts.search_text
         INNER JOIN authorized_sources AS source
           ON source.session_id = projection.session_id
           AND projection.entry_id <= source.max_entry_id
         WHERE ${whereClauses.join(' AND ')}
         ORDER BY score ASC, projection.created_at DESC, projection.session_id ASC,
           projection.entry_id DESC
         LIMIT ?`
      )
      .all(...params) as DeepChatTapeSearchProjectionResultRow[]
  }

  private searchLikeSourcesReadOnly(
    sources: readonly DeepChatTapeReadSource[],
    normalized: string,
    options: DeepChatTapeSearchInput,
    limit: number
  ): DeepChatTapeSearchProjectionResultRow[] {
    const queryPredicate = buildDeepChatTapeLikeSearchPredicate(
      ['projection.search_text', 'projection.summary_text', 'projection.name'],
      normalized
    )
    const whereClauses = [queryPredicate.sql]
    const params: Array<string | number> = [serializeDeepChatTapeReadSources(sources)]
    params.push(...queryPredicate.params)
    this.addFilters(whereClauses, params, options, false, 'projection')
    params.push(limit)
    return this.db
      .prepare(
        `WITH authorized_sources(session_id, max_entry_id) AS (
           SELECT
             json_extract(value, '$.sessionId'),
             CAST(json_extract(value, '$.maxEntryId') AS INTEGER)
           FROM json_each(?)
         )
         SELECT projection.*, NULL AS score
         FROM deepchat_tape_search_projection AS projection
         INNER JOIN authorized_sources AS source
           ON source.session_id = projection.session_id
           AND projection.entry_id <= source.max_entry_id
         WHERE ${whereClauses.join(' AND ')}
         ORDER BY projection.created_at DESC, projection.session_id ASC, projection.entry_id DESC
         LIMIT ?`
      )
      .all(...params) as DeepChatTapeSearchProjectionResultRow[]
  }

  private searchLike(
    sessionId: string,
    normalized: string,
    options: DeepChatTapeSearchInput,
    limit: number
  ): DeepChatTapeSearchProjectionResultRow[] {
    const queryPredicate = buildDeepChatTapeLikeSearchPredicate(
      ['search_text', 'summary_text', 'name'],
      normalized
    )
    const whereClauses = ['session_id = ?', queryPredicate.sql]
    const params: Array<string | number> = [sessionId]
    params.push(...queryPredicate.params)
    this.addFilters(whereClauses, params, options)
    params.push(limit)
    return this.db
      .prepare(
        `SELECT *, NULL AS score
         FROM deepchat_tape_search_projection
         WHERE ${whereClauses.join(' AND ')}
         ORDER BY entry_id DESC
         LIMIT ?`
      )
      .all(...params) as DeepChatTapeSearchProjectionResultRow[]
  }

  private addFilters(
    whereClauses: string[],
    params: Array<string | number>,
    options: DeepChatTapeSearchInput,
    castCreatedAt = false,
    tableAlias?: string
  ): void {
    const column = (name: string) => (tableAlias ? `${tableAlias}.${name}` : name)
    if (options.kinds?.length) {
      whereClauses.push(`${column('kind')} IN (${options.kinds.map(() => '?').join(', ')})`)
      params.push(...options.kinds)
    }
    const createdAtColumn = castCreatedAt
      ? `CAST(${column('created_at')} AS INTEGER)`
      : column('created_at')
    if (Number.isFinite(options.startCreatedAt)) {
      whereClauses.push(`${createdAtColumn} >= ?`)
      params.push(options.startCreatedAt as number)
    }
    if (Number.isFinite(options.endCreatedAt)) {
      whereClauses.push(`${createdAtColumn} <= ?`)
      params.push(options.endCreatedAt as number)
    }
  }
}
