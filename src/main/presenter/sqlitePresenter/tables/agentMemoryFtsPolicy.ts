import { createHash } from 'node:crypto'

export const AGENT_MEMORY_FTS_POLICY_VERSION = 2

export const AGENT_MEMORY_FTS_EXCLUDED_STATUSES = ['archived', 'conflicted'] as const
export const AGENT_MEMORY_FTS_EXCLUDED_KINDS = ['persona', 'working'] as const

export interface AgentMemoryFtsPolicyRow {
  agent_id: string
  kind: string
  status: string
  superseded_by: string | null
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function isRecallableFtsRow<T extends AgentMemoryFtsPolicyRow>(
  row: T | undefined
): row is T {
  return (
    !!row &&
    row.superseded_by === null &&
    !AGENT_MEMORY_FTS_EXCLUDED_STATUSES.includes(
      row.status as (typeof AGENT_MEMORY_FTS_EXCLUDED_STATUSES)[number]
    ) &&
    !AGENT_MEMORY_FTS_EXCLUDED_KINDS.includes(
      row.kind as (typeof AGENT_MEMORY_FTS_EXCLUDED_KINDS)[number]
    )
  )
}

export function buildRecallablePredicate(alias?: string): string {
  const column = (name: string): string => (alias ? `${alias}.${name}` : name)
  const excludedStatuses = AGENT_MEMORY_FTS_EXCLUDED_STATUSES.map(sqlLiteral).join(', ')
  const excludedKinds = AGENT_MEMORY_FTS_EXCLUDED_KINDS.map(sqlLiteral).join(', ')
  return [
    `${column('superseded_by')} IS NULL`,
    `${column('status')} NOT IN (${excludedStatuses})`,
    `${column('kind')} NOT IN (${excludedKinds})`
  ].join(' AND ')
}

export function agentFtsScope(agentId: string): string {
  // Four base64url characters keep trigram scope matching bounded. A collision can only reduce
  // recall because every returned row is still revalidated with the authoritative agent_id.
  return createHash('sha256').update(agentId, 'utf8').digest('base64url').slice(0, 4)
}

export function buildAgentFtsScopeSql(column: string): string {
  return `agent_memory_fts_scope(CAST(${column} AS TEXT))`
}
