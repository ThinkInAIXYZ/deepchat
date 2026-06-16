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
  source_session: string | null
  provenance_key: string | null
  is_anchor: number
  superseded_by: string | null
  created_at: number
  last_accessed: number | null
  access_count: number
  decay_score: number | null
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
}

export interface AgentMemoryListOptions {
  kinds?: AgentMemoryKind[]
  statuses?: AgentMemoryStatus[]
  includeSuperseded?: boolean
  limit?: number
}

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

export class AgentMemoryTable extends BaseTable {
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
        source_session TEXT,
        provenance_key TEXT,
        is_anchor INTEGER NOT NULL DEFAULT 0,
        superseded_by TEXT,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER,
        access_count INTEGER NOT NULL DEFAULT 0,
        decay_score REAL
      );
      ${AGENT_MEMORY_INDEX_SQL}
    `
  }

  override createTable(): void {
    if (!this.tableExists()) {
      this.db.exec(this.getCreateTableSQL())
      return
    }
    this.db.exec(AGENT_MEMORY_INDEX_SQL)
  }

  getMigrationSQL(_version: number): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
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
      source_session: input.sourceSession ?? null,
      provenance_key: input.provenanceKey ?? null,
      is_anchor: input.isAnchor ? 1 : 0,
      superseded_by: null,
      created_at: input.createdAt ?? Date.now(),
      last_accessed: null,
      access_count: 0,
      decay_score: null
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
           source_session,
           provenance_key,
           is_anchor,
           superseded_by,
           created_at,
           last_accessed,
           access_count,
           decay_score
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        row.source_session,
        row.provenance_key,
        row.is_anchor,
        row.superseded_by,
        row.created_at,
        row.last_accessed,
        row.access_count,
        row.decay_score
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

  search(agentId: string, query: string, limit: number = 20): AgentMemoryRow[] {
    const normalized = query.trim()
    if (!normalized) {
      return []
    }
    const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), 100)
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
      .all(agentId, pattern, cappedLimit) as AgentMemoryRow[]
  }

  listPendingEmbedding(limit: number = 50): AgentMemoryRow[] {
    const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), 500)
    return this.db
      .prepare(
        `SELECT * FROM agent_memory
         WHERE status = 'pending_embedding'
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .all(cappedLimit) as AgentMemoryRow[]
  }

  updateStatus(
    id: string,
    status: AgentMemoryStatus,
    embedding?: { embeddingId?: string | null; embeddingDim?: number | null }
  ): void {
    this.db
      .prepare(
        `UPDATE agent_memory
         SET status = ?, embedding_id = ?, embedding_dim = ?
         WHERE id = ?`
      )
      .run(status, embedding?.embeddingId ?? null, embedding?.embeddingDim ?? null, id)
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
