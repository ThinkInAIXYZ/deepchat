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

function buildFtsMatchQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(' AND ')
}

export class DeepChatSearchDocumentsTable extends BaseTable {
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
    const row = this.db
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name = 'deepchat_search_documents_fts'`
      )
      .get() as { name?: string } | undefined
    return row?.name === 'deepchat_search_documents_fts'
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

    this.refreshFtsRow(row.documentKey)
  }

  refreshSessionTitle(sessionId: string, title: string, updatedAt: number = Date.now()): void {
    this.db
      .prepare(
        `UPDATE deepchat_search_documents
         SET title = ?, updated_at = ?
         WHERE session_id = ?`
      )
      .run(title, updatedAt, sessionId)

    if (!this.isFtsAvailable()) {
      return
    }

    const rows = this.db
      .prepare(
        `SELECT document_key
         FROM deepchat_search_documents
         WHERE session_id = ?`
      )
      .all(sessionId) as Array<{ document_key: string }>
    rows.forEach((row) => this.refreshFtsRow(row.document_key))
  }

  delete(documentKey: string): void {
    this.deleteFtsRow(documentKey)
    this.db.prepare('DELETE FROM deepchat_search_documents WHERE document_key = ?').run(documentKey)
  }

  deleteByMessageIds(messageIds: string[]): void {
    if (messageIds.length === 0) {
      return
    }

    const placeholders = messageIds.map(() => '?').join(', ')
    const rows = this.db
      .prepare(
        `SELECT document_key
         FROM deepchat_search_documents
         WHERE message_id IN (${placeholders})`
      )
      .all(...messageIds) as Array<{ document_key: string }>
    rows.forEach((row) => this.deleteFtsRow(row.document_key))
    this.db
      .prepare(
        `DELETE FROM deepchat_search_documents
         WHERE message_id IN (${placeholders})`
      )
      .run(...messageIds)
  }

  deleteBySession(sessionId: string): void {
    const rows = this.db
      .prepare(
        `SELECT document_key
         FROM deepchat_search_documents
         WHERE session_id = ?`
      )
      .all(sessionId) as Array<{ document_key: string }>
    rows.forEach((row) => this.deleteFtsRow(row.document_key))
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
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS deepchat_search_documents_fts
        USING fts5(title, content, content='');
      `)
    } catch (error) {
      console.warn(
        '[DeepChatSearchDocumentsTable] FTS5 unavailable, falling back to LIKE search.',
        error
      )
    }
  }

  private refreshFtsRow(documentKey: string): void {
    if (!this.isFtsAvailable()) {
      return
    }

    const row = this.db
      .prepare(
        `SELECT rowid, title, content
         FROM deepchat_search_documents
         WHERE document_key = ?`
      )
      .get(documentKey) as { rowid: number; title: string; content: string } | undefined
    if (!row) {
      return
    }

    this.db
      .prepare(
        "INSERT INTO deepchat_search_documents_fts(deepchat_search_documents_fts, rowid, title, content) VALUES('delete', ?, ?, ?)"
      )
      .run(row.rowid, row.title, row.content)
    this.db
      .prepare('INSERT INTO deepchat_search_documents_fts(rowid, title, content) VALUES (?, ?, ?)')
      .run(row.rowid, row.title, row.content)
  }

  private deleteFtsRow(documentKey: string): void {
    if (!this.isFtsAvailable()) {
      return
    }

    const row = this.db
      .prepare(
        `SELECT rowid, title, content
         FROM deepchat_search_documents
         WHERE document_key = ?`
      )
      .get(documentKey) as { rowid: number; title: string; content: string } | undefined
    if (!row) {
      return
    }

    this.db
      .prepare(
        "INSERT INTO deepchat_search_documents_fts(deepchat_search_documents_fts, rowid, title, content) VALUES('delete', ?, ?, ?)"
      )
      .run(row.rowid, row.title, row.content)
  }
}
