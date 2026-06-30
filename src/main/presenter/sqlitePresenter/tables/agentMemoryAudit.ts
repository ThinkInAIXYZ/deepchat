import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export type AgentMemoryAuditActorType = 'scheduler' | 'user' | 'runtime'
export type AgentMemoryAuditStatus = 'completed' | 'skipped' | 'failed'

export interface AgentMemoryAuditRow {
  id: string
  agent_id: string
  event_type: string
  actor_type: AgentMemoryAuditActorType
  session_id: string | null
  input_refs_json: string
  output_refs_json: string
  model_provider_id: string | null
  model_id: string | null
  status: AgentMemoryAuditStatus
  reason: string | null
  created_at: number
}

export interface AgentMemoryAuditInsertInput {
  id: string
  agentId: string
  eventType: string
  actorType: AgentMemoryAuditActorType
  sessionId?: string | null
  inputRefs?: Record<string, unknown>
  outputRefs?: Record<string, unknown>
  modelProviderId?: string | null
  modelId?: string | null
  status: AgentMemoryAuditStatus
  reason?: string | null
  createdAt?: number
}

export interface AgentMemoryAuditListOptions {
  eventType?: string
  actorType?: AgentMemoryAuditActorType
  sessionId?: string
  status?: AgentMemoryAuditStatus
  startCreatedAt?: number
  endCreatedAt?: number
  limit?: number
}

export interface AgentMemoryHealthRecentFailureRow {
  eventType: string
  status: Extract<AgentMemoryAuditStatus, 'failed' | 'skipped'>
  reason: string | null
  createdAt: number
}

export interface AgentMemoryHealthAuditStats {
  completed: number
  skipped: number
  failed: number
  recentFailures: AgentMemoryHealthRecentFailureRow[]
}

const AGENT_MEMORY_AUDIT_SCHEMA_VERSION = 36

const AGENT_MEMORY_AUDIT_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_agent_memory_audit_agent_created
    ON agent_memory_audit(agent_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_agent_memory_audit_agent_event
    ON agent_memory_audit(agent_id, event_type, created_at);
`

function stringifyMetadata(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(value ?? {})
}

export class AgentMemoryAuditTable extends BaseTable {
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
    return null
  }

  getLatestVersion(): number {
    return AGENT_MEMORY_AUDIT_SCHEMA_VERSION
  }

  insert(input: AgentMemoryAuditInsertInput): AgentMemoryAuditRow {
    const row: AgentMemoryAuditRow = {
      id: input.id,
      agent_id: input.agentId,
      event_type: input.eventType,
      actor_type: input.actorType,
      session_id: input.sessionId ?? null,
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
           input_refs_json,
           output_refs_json,
           model_provider_id,
           model_id,
           status,
           reason,
           created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.agent_id,
        row.event_type,
        row.actor_type,
        row.session_id,
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
    optionsOrLimit: number | AgentMemoryAuditListOptions = 100
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

  clearByAgent(agentId: string): number {
    const result = this.db.prepare('DELETE FROM agent_memory_audit WHERE agent_id = ?').run(agentId)
    return result.changes
  }
}
