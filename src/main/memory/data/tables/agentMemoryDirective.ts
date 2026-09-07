import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import {
  AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT,
  AGENT_MEMORY_DIRECTIVE_CONTENT_MAX_CHARS,
  AGENT_MEMORY_DIRECTIVE_TOPIC_MAX_CHARS
} from '@shared/types/agent-memory'

import type {
  AgentMemoryDirectiveRow,
  MemoryDirectiveCounts,
  MemoryDirectiveInsertResult,
  MemoryDirectiveTransitionResult,
  MemoryDirectiveWriteInput,
  MemoryDirectiveWriteResult
} from '../../domain/directives'
import type { MemoryDirectiveRepositoryPort } from '../../ports'

export const AGENT_MEMORY_DIRECTIVE_SCHEMA_VERSION = 50
const DIRECTIVE_REPOSITORY_LIMIT = 200

const AGENT_MEMORY_DIRECTIVE_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_agent_memory_directive_management_v1
    ON agent_memory_directive(agent_id, updated_at DESC, id);
  CREATE INDEX IF NOT EXISTS idx_agent_memory_directive_status_v1
    ON agent_memory_directive(agent_id, status, updated_at DESC, id);
  CREATE INDEX IF NOT EXISTS idx_agent_memory_directive_active_kind_v1
    ON agent_memory_directive(agent_id, kind, updated_at DESC, id)
    WHERE status = 'active';
`

const AGENT_MEMORY_DIRECTIVE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS agent_memory_directive (
    agent_id TEXT NOT NULL,
    id TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
    kind TEXT NOT NULL CHECK (kind IN ('instruction', 'suppress_topic')),
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'rejected')),
    source TEXT NOT NULL CHECK (source IN ('explicit_user', 'manual', 'derived_suggestion')),
    content TEXT NOT NULL
      CHECK (length(trim(content)) BETWEEN 1 AND ${AGENT_MEMORY_DIRECTIVE_CONTENT_MAX_CHARS}),
    normalized_topic TEXT
      CHECK (
        (kind = 'instruction' AND normalized_topic IS NULL)
        OR (
          kind = 'suppress_topic'
          AND length(normalized_topic) BETWEEN 1 AND ${AGENT_MEMORY_DIRECTIVE_TOPIC_MAX_CHARS}
          AND normalized_topic = trim(normalized_topic)
        )
      ),
    identity_hash TEXT NOT NULL
      CHECK (length(identity_hash) = 64 AND identity_hash NOT GLOB '*[^0-9a-f]*'),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    PRIMARY KEY (agent_id, id),
    UNIQUE (agent_id, kind, identity_hash)
  ) WITHOUT ROWID;
  ${AGENT_MEMORY_DIRECTIVE_INDEX_SQL}
`

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return 100
  if (value === Number.POSITIVE_INFINITY) return DIRECTIVE_REPOSITORY_LIMIT
  if (!Number.isFinite(value)) return 0
  return Math.min(DIRECTIVE_REPOSITORY_LIMIT, Math.max(0, Math.floor(value)))
}

function assertWriteInput(input: MemoryDirectiveWriteInput): void {
  if (
    !input.agentId ||
    !input.id ||
    !Number.isFinite(input.createdAt) ||
    !Number.isFinite(input.updatedAt) ||
    input.createdAt < 0 ||
    input.updatedAt < input.createdAt
  ) {
    throw new Error('[Memory] invalid directive persistence input')
  }
}

export class AgentMemoryDirectiveTable extends BaseTable implements MemoryDirectiveRepositoryPort {
  constructor(db: Database.Database) {
    super(db, 'agent_memory_directive')
  }

  getCreateTableSQL(): string {
    return AGENT_MEMORY_DIRECTIVE_TABLE_SQL
  }

  override createTable(): void {
    super.createTable()
    this.db.exec(AGENT_MEMORY_DIRECTIVE_INDEX_SQL)
  }

  getMigrationSQL(version: number): string | null {
    return version === AGENT_MEMORY_DIRECTIVE_SCHEMA_VERSION
      ? AGENT_MEMORY_DIRECTIVE_TABLE_SQL
      : null
  }

  getLatestVersion(): number {
    return AGENT_MEMORY_DIRECTIVE_SCHEMA_VERSION
  }

  assertCurrentSchema(): void {
    const tableSql = (
      this.db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_memory_directive'"
        )
        .get() as { sql?: string } | undefined
    )?.sql?.replace(/\s+/gu, ' ')
    if (
      !tableSql?.includes("kind IN ('instruction', 'suppress_topic')") ||
      !tableSql.includes("status IN ('draft', 'active', 'rejected')") ||
      !tableSql.includes("source IN ('explicit_user', 'manual', 'derived_suggestion')") ||
      !tableSql.includes('UNIQUE (agent_id, kind, identity_hash)') ||
      !tableSql.includes('WITHOUT ROWID')
    ) {
      throw new Error('[Memory] agent_memory_directive constraints are incomplete')
    }
    for (const indexName of [
      'idx_agent_memory_directive_management_v1',
      'idx_agent_memory_directive_status_v1',
      'idx_agent_memory_directive_active_kind_v1'
    ]) {
      const found = this.db
        .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get(indexName)
      if (!found) throw new Error(`[Memory] required index is missing: ${indexName}`)
    }
  }

  getDirective(agentId: string, directiveId: string): AgentMemoryDirectiveRow | undefined {
    return this.db
      .prepare('SELECT * FROM agent_memory_directive WHERE agent_id = ? AND id = ?')
      .get(agentId, directiveId) as AgentMemoryDirectiveRow | undefined
  }

  private getByIdentity(
    agentId: string,
    kind: AgentMemoryDirectiveRow['kind'],
    identityHash: string
  ): AgentMemoryDirectiveRow | undefined {
    return this.db
      .prepare(
        `SELECT *
         FROM agent_memory_directive
         WHERE agent_id = ? AND kind = ? AND identity_hash = ?`
      )
      .get(agentId, kind, identityHash) as AgentMemoryDirectiveRow | undefined
  }

  private countActive(agentId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM agent_memory_directive
         WHERE agent_id = ? AND status = 'active'`
      )
      .get(agentId) as { count: number }
    return row.count
  }

  listDirectives(
    agentId: string,
    options: {
      statuses?: readonly AgentMemoryDirectiveRow['status'][]
      limit?: number
    } = {}
  ): AgentMemoryDirectiveRow[] {
    const limit = normalizeLimit(options.limit)
    if (limit === 0) return []
    const statuses = [...new Set(options.statuses ?? [])]
    const statusSql = statuses.length ? `AND status IN (${statuses.map(() => '?').join(', ')})` : ''
    return this.db
      .prepare(
        `SELECT *
         FROM agent_memory_directive
         WHERE agent_id = ? ${statusSql}
         ORDER BY updated_at DESC, id ASC
         LIMIT ?`
      )
      .all(agentId, ...statuses, limit) as AgentMemoryDirectiveRow[]
  }

  listActiveDirectives(agentId: string, limit: number): AgentMemoryDirectiveRow[] {
    const cappedLimit = normalizeLimit(limit)
    if (cappedLimit === 0) return []
    return this.db
      .prepare(
        `SELECT *
         FROM agent_memory_directive INDEXED BY idx_agent_memory_directive_status_v1
         WHERE agent_id = ? AND status = 'active'
         ORDER BY updated_at DESC, id ASC
         LIMIT ?`
      )
      .all(agentId, cappedLimit) as AgentMemoryDirectiveRow[]
  }

  upsertExplicitDirective(input: MemoryDirectiveWriteInput): MemoryDirectiveWriteResult {
    assertWriteInput(input)
    if (input.status !== 'active' || input.source === 'derived_suggestion') {
      throw new Error('[Memory] explicit directives must enter the active trust state')
    }
    return this.db.transaction(() => {
      const existing = this.getByIdentity(input.agentId, input.kind, input.identityHash)
      if (
        existing?.status !== 'active' &&
        this.countActive(input.agentId) >= AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT
      ) {
        return { action: 'capacity' as const, row: null }
      }
      const unchanged =
        existing?.status === input.status &&
        existing.source === input.source &&
        existing.content === input.content &&
        existing.normalized_topic === input.normalizedTopic
      if (unchanged) return { action: 'unchanged' as const, row: existing }

      this.db
        .prepare(
          `INSERT INTO agent_memory_directive (
             agent_id, id, kind, status, source, content, normalized_topic,
             identity_hash, created_at, updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (agent_id, kind, identity_hash) DO UPDATE SET
             status = excluded.status,
             source = excluded.source,
             content = excluded.content,
             normalized_topic = excluded.normalized_topic,
             updated_at = max(agent_memory_directive.updated_at, excluded.updated_at)`
        )
        .run(
          input.agentId,
          input.id,
          input.kind,
          input.status,
          input.source,
          input.content,
          input.normalizedTopic,
          input.identityHash,
          input.createdAt,
          input.updatedAt
        )
      const row = this.getByIdentity(input.agentId, input.kind, input.identityHash)
      if (!row) throw new Error('[Memory] explicit directive upsert did not materialize')
      return { action: existing ? ('updated' as const) : ('created' as const), row }
    })()
  }

  insertDerivedDirectiveDraft(input: MemoryDirectiveWriteInput): MemoryDirectiveInsertResult {
    assertWriteInput(input)
    if (input.status !== 'draft' || input.source !== 'derived_suggestion') {
      throw new Error('[Memory] derived directives must enter the draft trust state')
    }
    return this.db.transaction(() => {
      const existing = this.getByIdentity(input.agentId, input.kind, input.identityHash)
      if (existing) return { inserted: false, row: existing }
      const result = this.db
        .prepare(
          `INSERT OR IGNORE INTO agent_memory_directive (
             agent_id, id, kind, status, source, content, normalized_topic,
             identity_hash, created_at, updated_at
           )
           VALUES (?, ?, ?, 'draft', 'derived_suggestion', ?, ?, ?, ?, ?)`
        )
        .run(
          input.agentId,
          input.id,
          input.kind,
          input.content,
          input.normalizedTopic,
          input.identityHash,
          input.createdAt,
          input.updatedAt
        )
      const row = this.getByIdentity(input.agentId, input.kind, input.identityHash)
      if (!row) throw new Error('[Memory] directive draft insert did not materialize')
      return { inserted: result.changes === 1, row }
    })()
  }

  transitionDirective(
    agentId: string,
    directiveId: string,
    fromStatus: AgentMemoryDirectiveRow['status'],
    toStatus: AgentMemoryDirectiveRow['status'],
    updatedAt: number
  ): MemoryDirectiveTransitionResult {
    if (
      fromStatus !== 'draft' ||
      (toStatus !== 'active' && toStatus !== 'rejected') ||
      !Number.isFinite(updatedAt)
    ) {
      throw new Error('[Memory] invalid directive trust transition')
    }
    return this.db.transaction(() => {
      const current = this.getDirective(agentId, directiveId)
      if (!current || current.status !== fromStatus) {
        return { action: 'not-found' as const, row: null }
      }
      if (
        toStatus === 'active' &&
        this.countActive(agentId) >= AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT
      ) {
        return { action: 'capacity' as const, row: null }
      }
      const row = this.db
        .prepare(
          `UPDATE agent_memory_directive
           SET status = ?, updated_at = max(updated_at, ?)
           WHERE agent_id = ? AND id = ? AND status = ?
           RETURNING *`
        )
        .get(toStatus, Math.max(0, Math.floor(updatedAt)), agentId, directiveId, fromStatus) as
        | AgentMemoryDirectiveRow
        | undefined
      if (!row) throw new Error('[Memory] directive transition did not materialize')
      return { action: 'transitioned' as const, row }
    })()
  }

  deleteDirective(agentId: string, directiveId: string): AgentMemoryDirectiveRow | null {
    return (
      (this.db
        .prepare(
          `DELETE FROM agent_memory_directive
           WHERE agent_id = ? AND id = ?
           RETURNING *`
        )
        .get(agentId, directiveId) as AgentMemoryDirectiveRow | undefined) ?? null
    )
  }

  countDirectivesByStatus(agentId: string): MemoryDirectiveCounts {
    const row = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
         FROM agent_memory_directive
         WHERE agent_id = ?`
      )
      .get(agentId) as
      | { draft: number | null; active: number | null; rejected: number | null }
      | undefined
    return {
      draft: row?.draft ?? 0,
      active: row?.active ?? 0,
      rejected: row?.rejected ?? 0
    }
  }

  retireDirectiveNamespace(agentId: string): number {
    return this.db.prepare('DELETE FROM agent_memory_directive WHERE agent_id = ?').run(agentId)
      .changes
  }
}
