import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export interface DeepChatSearchDocumentRow {
  rowid: number
  document_key: string
  session_id: string
  message_id: string | null
  document_kind: 'session' | 'message'
  role: 'user' | 'assistant' | null
  title: string
  content: string
  updated_at: number
}

const NORMALIZATION_SCHEMA_VERSION = 26
const FTS_TABLE_NAME = 'deepchat_search_documents_fts'
const FTS_TRIGGER_NAMES = [
  'deepchat_search_documents_ai',
  'deepchat_search_documents_ad',
  'deepchat_search_documents_au'
] as const

function buildFtsMatchQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(' AND ')
}

export class DeepChatSearchDocumentsTable extends BaseTable {
  private ftsUnavailable = false

  constructor(db: Database.Database) {
    super(db, 'deepchat_search_documents')
  }

  override createTable(): void {
    this.db.exec(this.getCreateTableSQL())
    this.ensureFtsTable()
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS deepchat_search_documents (
        document_key TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        message_id TEXT,
        document_kind TEXT NOT NULL,
        role TEXT,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_deepchat_search_documents_session
        ON deepchat_search_documents(session_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_deepchat_search_documents_message
        ON deepchat_search_documents(message_id);
    `
  }

  getMigrationSQL(version: number): string | null {
    if (version === NORMALIZATION_SCHEMA_VERSION) {
      return this.getCreateTableSQL()
    }
    return null
  }

  getLatestVersion(): number {
    return NORMALIZATION_SCHEMA_VERSION
  }

  isFtsAvailable(): boolean {
    if (this.ftsUnavailable) {
      return false
    }

    return this.hasCompatibleFtsTable()
  }

  private hasFtsTable(): boolean {
    const row = this.db
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name = ?`
      )
      .get(FTS_TABLE_NAME) as { name?: string } | undefined
    return row?.name === FTS_TABLE_NAME
  }

  private getFtsTableSql(): string | null {
    const row = this.db
      .prepare(
        `SELECT sql
         FROM sqlite_master
         WHERE type = 'table'
           AND name = ?`
      )
      .get(FTS_TABLE_NAME) as { sql?: string | null } | undefined
    return row?.sql ?? null
  }

  private hasCompatibleFtsTable(): boolean {
    const sql = this.getFtsTableSql()
    if (!sql) {
      return false
    }

    const normalized = sql.replace(/\s+/g, ' ').toLowerCase()
    return (
      normalized.includes('using fts5') &&
      /content\s*=\s*'deepchat_search_documents'/.test(normalized) &&
      /content_rowid\s*=\s*'rowid'/.test(normalized)
    )
  }

  private hasFtsTriggers(): boolean {
    const rows = this.db
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'trigger'
           AND name IN (${FTS_TRIGGER_NAMES.map(() => '?').join(', ')})`
      )
      .all(...FTS_TRIGGER_NAMES) as Array<{ name: string }>
    const existing = new Set(rows.map((row) => row.name))
    return FTS_TRIGGER_NAMES.every((name) => existing.has(name))
  }

  upsert(row: {
    documentKey: string
    sessionId: string
    messageId?: string | null
    documentKind: 'session' | 'message'
    role?: 'user' | 'assistant' | null
    title: string
    content: string
    updatedAt?: number
  }): void {
    const updatedAt = row.updatedAt ?? Date.now()
    this.db
      .prepare(
        `INSERT INTO deepchat_search_documents (
          document_key,
          session_id,
          message_id,
          document_kind,
          role,
          title,
          content,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(document_key) DO UPDATE SET
          session_id = excluded.session_id,
          message_id = excluded.message_id,
          document_kind = excluded.document_kind,
          role = excluded.role,
          title = excluded.title,
          content = excluded.content,
          updated_at = excluded.updated_at`
      )
      .run(
        row.documentKey,
        row.sessionId,
        row.messageId ?? null,
        row.documentKind,
        row.role ?? null,
        row.title,
        row.content,
        updatedAt
      )
  }

  refreshSessionTitle(sessionId: string, title: string, updatedAt: number = Date.now()): void {
    this.db
      .prepare(
        `UPDATE deepchat_search_documents
         SET title = ?, updated_at = ?
         WHERE session_id = ?`
      )
      .run(title, updatedAt, sessionId)
  }

  delete(documentKey: string): void {
    this.db.prepare('DELETE FROM deepchat_search_documents WHERE document_key = ?').run(documentKey)
  }

  deleteByMessageIds(messageIds: string[]): void {
    if (messageIds.length === 0) {
      return
    }

    const placeholders = messageIds.map(() => '?').join(', ')
    this.db
      .prepare(
        `DELETE FROM deepchat_search_documents
         WHERE message_id IN (${placeholders})`
      )
      .run(...messageIds)
  }

  deleteBySession(sessionId: string): void {
    this.db.prepare('DELETE FROM deepchat_search_documents WHERE session_id = ?').run(sessionId)
  }

  searchFts(query: string, limit: number): Array<DeepChatSearchDocumentRow & { rank: number }> {
    if (!this.isFtsAvailable()) {
      return []
    }

    const matchQuery = buildFtsMatchQuery(query)
    if (!matchQuery) {
      return []
    }

    return this.db
      .prepare(
        `SELECT
           d.rowid,
           d.document_key,
           d.session_id,
           d.message_id,
           d.document_kind,
           d.role,
           d.title,
           d.content,
           d.updated_at,
           bm25(deepchat_search_documents_fts) AS rank
         FROM deepchat_search_documents_fts
         JOIN deepchat_search_documents d
           ON d.rowid = deepchat_search_documents_fts.rowid
         WHERE deepchat_search_documents_fts MATCH ?
         ORDER BY rank ASC, d.updated_at DESC
         LIMIT ?`
      )
      .all(matchQuery, limit) as Array<DeepChatSearchDocumentRow & { rank: number }>
  }

  searchLike(query: string, limit: number): Array<DeepChatSearchDocumentRow & { rank: number }> {
    const likeQuery = `%${query.trim().toLowerCase()}%`
    return this.db
      .prepare(
        `SELECT
           rowid,
           document_key,
           session_id,
           message_id,
           document_kind,
           role,
           title,
           content,
           updated_at,
           0 AS rank
         FROM deepchat_search_documents
         WHERE lower(title) LIKE ?
            OR lower(content) LIKE ?
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(likeQuery, likeQuery, limit) as Array<DeepChatSearchDocumentRow & { rank: number }>
  }

  private ensureFtsTable(): void {
    try {
      this.db.transaction(() => {
        const shouldRecreateFtsTable = this.hasFtsTable() && !this.hasCompatibleFtsTable()
        const shouldRebuildFtsIndex =
          shouldRecreateFtsTable || !this.hasFtsTable() || !this.hasFtsTriggers()

        if (shouldRecreateFtsTable) {
          this.dropFtsTriggers()
          this.db.exec(`DROP TABLE IF EXISTS ${FTS_TABLE_NAME};`)
        }

        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE_NAME}
          USING fts5(
            title,
            content,
            content='deepchat_search_documents',
            content_rowid='rowid'
          );
        `)
        this.ensureFtsTriggers()

        if (shouldRebuildFtsIndex) {
          this.rebuildFtsIndex()
        }
      })()

      this.ftsUnavailable = false
    } catch (error) {
      this.ftsUnavailable = true
      console.warn(
        '[DeepChatSearchDocumentsTable] FTS5 unavailable, falling back to LIKE search.',
        error
      )
    }
  }

  private dropFtsTriggers(): void {
    this.db.exec(FTS_TRIGGER_NAMES.map((name) => `DROP TRIGGER IF EXISTS ${name};`).join('\n'))
  }

  private ensureFtsTriggers(): void {
    this.dropFtsTriggers()
    this.db.exec(`
      CREATE TRIGGER deepchat_search_documents_ai
      AFTER INSERT ON deepchat_search_documents
      BEGIN
        INSERT INTO ${FTS_TABLE_NAME}(rowid, title, content)
        VALUES (new.rowid, new.title, new.content);
      END;

      CREATE TRIGGER deepchat_search_documents_ad
      AFTER DELETE ON deepchat_search_documents
      BEGIN
        INSERT INTO ${FTS_TABLE_NAME}(${FTS_TABLE_NAME}, rowid, title, content)
        VALUES('delete', old.rowid, old.title, old.content);
      END;

      CREATE TRIGGER deepchat_search_documents_au
      AFTER UPDATE OF title, content ON deepchat_search_documents
      BEGIN
        INSERT INTO ${FTS_TABLE_NAME}(${FTS_TABLE_NAME}, rowid, title, content)
        VALUES('delete', old.rowid, old.title, old.content);
        INSERT INTO ${FTS_TABLE_NAME}(rowid, title, content)
        VALUES (new.rowid, new.title, new.content);
      END;
    `)
  }

  private rebuildFtsIndex(): void {
    this.db.prepare(`INSERT INTO ${FTS_TABLE_NAME}(${FTS_TABLE_NAME}) VALUES('rebuild')`).run()
  }
}
