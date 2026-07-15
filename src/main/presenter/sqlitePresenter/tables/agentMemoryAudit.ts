import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import type { MemoryAuditRepositoryPort } from '../../../memory/ports'
import type {
  AgentMemoryAuditActorType,
  AgentMemoryAuditInsertInput,
  AgentMemoryAuditRow,
  AgentMemoryHealthAuditStats,
  MemoryAuditListOptions
} from '../../../memory/domain/audit'

export const AGENT_MEMORY_OPERATIONAL_AUDIT_EVENT_TYPES = [
  'memory/maintenance_llm',
  'memory/reflect',
  'memory/repair',
  'memory/conflict_repair',
  'memory/extract'
] as const
const AGENT_MEMORY_OPERATIONAL_AUDIT_EVENT_TYPES_SQL =
  AGENT_MEMORY_OPERATIONAL_AUDIT_EVENT_TYPES.map((eventType) => `'${eventType}'`).join(', ')

const AGENT_MEMORY_AUDIT_SCHEMA_VERSION = 38

const AGENT_MEMORY_AUDIT_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_agent_memory_audit_agent_created
    ON agent_memory_audit(agent_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_agent_memory_audit_agent_event
    ON agent_memory_audit(agent_id, event_type, created_at);
  CREATE INDEX IF NOT EXISTS idx_agent_memory_audit_agent_memory_ref
    ON agent_memory_audit(agent_id, memory_ref_id, created_at);
  DROP INDEX IF EXISTS idx_agent_memory_audit_operational_retention;
  CREATE INDEX IF NOT EXISTS idx_agent_memory_audit_operational_retention_v2
    ON agent_memory_audit(agent_id, created_at DESC, id DESC)
    WHERE event_type IN (${AGENT_MEMORY_OPERATIONAL_AUDIT_EVENT_TYPES_SQL});
`

const AGENT_MEMORY_AUDIT_OUTPUT_MEMORY_REF_SQL = `
  CASE
    WHEN json_valid(output_refs_json) THEN
      CASE
        WHEN json_type(output_refs_json, '$.memoryId') = 'text' THEN
          NULLIF(TRIM(CAST(json_extract(output_refs_json, '$.memoryId') AS TEXT)), '')
      END
  END
`

const AGENT_MEMORY_AUDIT_INPUT_MEMORY_REF_SQL = `
  CASE
    WHEN json_valid(input_refs_json) THEN
      CASE
        WHEN json_type(input_refs_json, '$.memoryId') = 'text' THEN
          NULLIF(TRIM(CAST(json_extract(input_refs_json, '$.memoryId') AS TEXT)), '')
      END
  END
`

const AGENT_MEMORY_AUDIT_BACKFILL_MEMORY_REF_SQL = `
  UPDATE agent_memory_audit
  SET memory_ref_id = COALESCE(
    ${AGENT_MEMORY_AUDIT_OUTPUT_MEMORY_REF_SQL},
    ${AGENT_MEMORY_AUDIT_INPUT_MEMORY_REF_SQL}
  )
  WHERE memory_ref_id IS NULL
    AND status = 'completed'
    AND (
      (event_type = 'memory/forget' AND actor_type = 'runtime')
      OR (event_type = 'memory/archive' AND actor_type = 'user')
      OR event_type = 'memory/restore'
    )
    AND COALESCE(
      ${AGENT_MEMORY_AUDIT_OUTPUT_MEMORY_REF_SQL},
      ${AGENT_MEMORY_AUDIT_INPUT_MEMORY_REF_SQL}
    ) IS NOT NULL;
`

function stringifyMetadata(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(value ?? {})
}

function extractSingleMemoryRef(metadata: Record<string, unknown> | undefined): string | null {
  const memoryId = metadata?.memoryId
  if (typeof memoryId !== 'string') return null
  const trimmed = memoryId.trim()
  return trimmed || null
}

function deriveMemoryRefId(input: AgentMemoryAuditInsertInput): string | null {
  return extractSingleMemoryRef(input.outputRefs) ?? extractSingleMemoryRef(input.inputRefs)
}

function metadataReferencesMemoryId(metadataJson: string, memoryId: string): boolean {
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>
    return metadata.memoryId === memoryId
  } catch {
    return false
  }
}

export class AgentMemoryAuditTable extends BaseTable implements MemoryAuditRepositoryPort {
  constructor(db: Database.Database) {
    super(db, 'agent_memory_audit')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS agent_memory_audit (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        session_id TEXT,
        memory_ref_id TEXT,
        input_refs_json TEXT NOT NULL DEFAULT '{}',
        output_refs_json TEXT NOT NULL DEFAULT '{}',
        model_provider_id TEXT,
        model_id TEXT,
        status TEXT NOT NULL,
        reason TEXT,
        created_at INTEGER NOT NULL
      );
      ${AGENT_MEMORY_AUDIT_INDEX_SQL}
    `
  }

  override createTable(): void {
    super.createTable()
    this.db.exec(AGENT_MEMORY_AUDIT_INDEX_SQL)
  }

  getMigrationSQL(version: number): string | null {
    if (version === 36) {
      return this.getCreateTableSQL()
    }
    if (version === 38) {
      return `
        ALTER TABLE agent_memory_audit ADD COLUMN memory_ref_id TEXT;
        ${AGENT_MEMORY_AUDIT_BACKFILL_MEMORY_REF_SQL}
        ${AGENT_MEMORY_AUDIT_INDEX_SQL}
      `
    }
    return null
  }

  getLatestVersion(): number {
    return AGENT_MEMORY_AUDIT_SCHEMA_VERSION
  }

  backfillMemoryRefIds(): void {
    this.db.exec(AGENT_MEMORY_AUDIT_BACKFILL_MEMORY_REF_SQL)
  }

  insert(input: AgentMemoryAuditInsertInput): AgentMemoryAuditRow {
    const row: AgentMemoryAuditRow = {
      id: input.id,
      agent_id: input.agentId,
      event_type: input.eventType,
      actor_type: input.actorType,
      session_id: input.sessionId ?? null,
      memory_ref_id: deriveMemoryRefId(input),
      input_refs_json: stringifyMetadata(input.inputRefs),
      output_refs_json: stringifyMetadata(input.outputRefs),
      model_provider_id: input.modelProviderId ?? null,
      model_id: input.modelId ?? null,
      status: input.status,
      reason: input.reason ?? null,
      created_at: input.createdAt ?? Date.now()
    }

    this.db
      .prepare(
        `INSERT INTO agent_memory_audit (
           id,
           agent_id,
           event_type,
           actor_type,
           session_id,
           memory_ref_id,
           input_refs_json,
           output_refs_json,
           model_provider_id,
           model_id,
           status,
           reason,
           created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.agent_id,
        row.event_type,
        row.actor_type,
        row.session_id,
        row.memory_ref_id,
        row.input_refs_json,
        row.output_refs_json,
        row.model_provider_id,
        row.model_id,
        row.status,
        row.reason,
        row.created_at
      )

    return row
  }

  listByAgent(
    agentId: string,
    optionsOrLimit: number | MemoryAuditListOptions = 100
  ): AgentMemoryAuditRow[] {
    const options = typeof optionsOrLimit === 'number' ? { limit: optionsOrLimit } : optionsOrLimit
    const whereClauses = ['agent_id = ?']
    const params: Array<string | number> = [agentId]

    if (options.eventType) {
      whereClauses.push('event_type = ?')
      params.push(options.eventType)
    }
    if (options.actorType) {
      whereClauses.push('actor_type = ?')
      params.push(options.actorType)
    }
    if (options.sessionId) {
      whereClauses.push('session_id = ?')
      params.push(options.sessionId)
    }
    if (options.status) {
      whereClauses.push('status = ?')
      params.push(options.status)
    }
    if (Number.isFinite(options.startCreatedAt)) {
      whereClauses.push('created_at >= ?')
      params.push(options.startCreatedAt as number)
    }
    if (Number.isFinite(options.endCreatedAt)) {
      whereClauses.push('created_at <= ?')
      params.push(options.endCreatedAt as number)
    }

    const limit = options.limit ?? 100
    const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), 500)
    params.push(cappedLimit)
    return this.db
      .prepare(
        `SELECT *
         FROM agent_memory_audit
         WHERE ${whereClauses.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(...params) as AgentMemoryAuditRow[]
  }

  getLatestCompletedEventAt(agentId: string, eventType: string): number | null {
    const row = this.db
      .prepare(
        `SELECT MAX(created_at) AS at
         FROM agent_memory_audit
         WHERE agent_id = ?
           AND event_type = ?
           AND status = 'completed'`
      )
      .get(agentId, eventType) as { at: number | null } | undefined
    return row?.at ?? null
  }

  hasForgetEvent(agentId: string, memoryId: string): boolean {
    return this.hasForgetEventFromRows(this.listForgetEventRows(agentId, memoryId), memoryId)
  }

  private listForgetEventRows(
    agentId: string,
    memoryId: string
  ): Array<{
    event_type: string
    actor_type: AgentMemoryAuditActorType
    memory_ref_id: string | null
    input_refs_json: string
    output_refs_json: string
  }> {
    const rows = this.db
      .prepare(
        `SELECT event_type,
                actor_type,
                memory_ref_id,
                input_refs_json,
                output_refs_json
         FROM agent_memory_audit
         WHERE agent_id = ?
           AND (memory_ref_id = ? OR memory_ref_id IS NULL)
           AND status = 'completed'
           AND (
             (event_type = 'memory/forget' AND actor_type = 'runtime')
             OR (event_type = 'memory/archive' AND actor_type = 'user')
             OR event_type = 'memory/restore'
           )
         ORDER BY created_at DESC, id DESC`
      )
      .all(agentId, memoryId) as Array<{
      event_type: string
      actor_type: AgentMemoryAuditActorType
      memory_ref_id: string | null
      input_refs_json: string
      output_refs_json: string
    }>
    return rows
  }

  private hasForgetEventFromRows(
    rows: Array<{
      event_type: string
      actor_type: AgentMemoryAuditActorType
      memory_ref_id: string | null
      input_refs_json: string
      output_refs_json: string
    }>,
    memoryId: string
  ): boolean {
    for (const row of rows) {
      const referencesMemory =
        row.memory_ref_id === memoryId ||
        metadataReferencesMemoryId(row.input_refs_json, memoryId) ||
        metadataReferencesMemoryId(row.output_refs_json, memoryId)
      if (!referencesMemory) {
        continue
      }
      if (row.event_type === 'memory/restore') return false
      return true
    }
    return false
  }

  getHealthAuditStats(
    agentId: string,
    scanLimit: number,
    failuresLimit: number
  ): AgentMemoryHealthAuditStats {
    const events = this.listByAgent(agentId, { limit: scanLimit })
    const stats: AgentMemoryHealthAuditStats = {
      completed: 0,
      skipped: 0,
      failed: 0,
      recentFailures: []
    }
    const cappedFailuresLimit = Math.max(0, Math.floor(failuresLimit))

    for (const event of events) {
      stats[event.status] += 1
      if (
        (event.status === 'failed' || event.status === 'skipped') &&
        stats.recentFailures.length < cappedFailuresLimit
      ) {
        stats.recentFailures.push({
          eventType: event.event_type,
          status: event.status,
          reason: event.reason,
          createdAt: event.created_at
        })
      }
    }

    return stats
  }

  pruneOperationalEvents(agentId: string, keep = 10_000, limit = 500): number {
    const normalizedKeep = Math.max(0, Math.floor(keep))
    const normalizedLimit = Math.min(500, Math.max(0, Math.floor(limit)))
    if (normalizedLimit === 0) return 0
    const result = this.db
      .prepare(
        `WITH prunable AS (
           SELECT id
           FROM agent_memory_audit
           WHERE agent_id = ?
             AND event_type IN (${AGENT_MEMORY_OPERATIONAL_AUDIT_EVENT_TYPES_SQL})
           ORDER BY created_at DESC, id DESC
           LIMIT ? OFFSET ?
         )
         DELETE FROM agent_memory_audit
         WHERE id IN (SELECT id FROM prunable)`
      )
      .run(agentId, normalizedLimit, normalizedKeep)
    return result.changes
  }

  clearByAgent(agentId: string): number {
    const result = this.db.prepare('DELETE FROM agent_memory_audit WHERE agent_id = ?').run(agentId)
    return result.changes
  }
}
