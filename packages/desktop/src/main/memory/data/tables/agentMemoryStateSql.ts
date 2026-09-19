import {
  AGENT_MEMORY_EMBEDDING_STATES,
  AGENT_MEMORY_HEALTH_STATUS_KEYS,
  AGENT_MEMORY_LIFECYCLE_STATES
} from '@shared/types/agent-memory'

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function column(alias: string | undefined, name: string): string {
  return alias ? `${alias}.${name}` : name
}

function sqlList(values: readonly string[]): string {
  return values.map(sqlLiteral).join(', ')
}

export const AGENT_MEMORY_LEGACY_STATUS_SQL_LIST = sqlList(AGENT_MEMORY_HEALTH_STATUS_KEYS)
export const AGENT_MEMORY_LIFECYCLE_STATE_SQL_LIST = sqlList(AGENT_MEMORY_LIFECYCLE_STATES)
export const AGENT_MEMORY_EMBEDDING_STATE_SQL_LIST = sqlList(AGENT_MEMORY_EMBEDDING_STATES)

export function buildInternalKindPredicateSql(alias?: string): string {
  return `${column(alias, 'kind')} IN ('persona', 'working')`
}

export function buildCompleteEmbeddingRefsPredicateSql(alias?: string): string {
  return `${column(alias, 'embedding_id')} IS NOT NULL
    AND ${column(alias, 'embedding_dim')} IS NOT NULL
    AND ${column(alias, 'embedding_dim')} > 0
    AND ${column(alias, 'embedding_model')} IS NOT NULL
    AND length(${column(alias, 'embedding_model')}) > 0`
}

export function buildLegacyLifecycleStateSql(alias?: string): string {
  const status = column(alias, 'status')
  return `CASE ${status}
    WHEN 'archived' THEN 'archived'
    WHEN 'conflicted' THEN 'conflicted'
    ELSE 'active'
  END`
}

export function buildLegacyEmbeddingStateSql(alias?: string): string {
  const status = column(alias, 'status')
  return `CASE
    WHEN ${buildInternalKindPredicateSql(alias)} THEN 'not_applicable'
    WHEN ${status} = 'embedded' THEN 'ready'
    WHEN ${status} = 'error' THEN 'error'
    WHEN ${status} = 'fts_only' THEN 'fts_only'
    WHEN ${status} = 'pending_embedding' THEN 'pending'
    WHEN ${buildCompleteEmbeddingRefsPredicateSql(alias)} THEN 'ready'
    ELSE 'pending'
  END`
}

export function buildStatusProjectionFromExpressionsSql(
  lifecycleExpression: string,
  embeddingExpression: string
): string {
  return `CASE
    WHEN (${lifecycleExpression}) = 'archived' THEN 'archived'
    WHEN (${lifecycleExpression}) = 'conflicted' THEN 'conflicted'
    WHEN (${embeddingExpression}) = 'ready' THEN 'embedded'
    WHEN (${embeddingExpression}) = 'error' THEN 'error'
    WHEN (${embeddingExpression}) IN ('fts_only', 'not_applicable') THEN 'fts_only'
    ELSE 'pending_embedding'
  END`
}

export function buildLegacyStatusProjectionSql(alias?: string): string {
  return buildStatusProjectionFromExpressionsSql(
    column(alias, 'lifecycle_state'),
    column(alias, 'embedding_state')
  )
}

export function buildLegacyShadowMismatchPredicateSql(alias?: string): string {
  return `${column(alias, 'status')} != ${buildLegacyStatusProjectionSql(alias)}`
}

export function buildLegacyBridgeUpdateLifecycleStateSql(): string {
  return `CASE
    WHEN ${buildInternalKindPredicateSql('NEW')}
      AND NEW.status = 'fts_only'
      AND OLD.lifecycle_state IN ('archived', 'conflicted')
      THEN OLD.lifecycle_state
    ELSE ${buildLegacyLifecycleStateSql('NEW')}
  END`
}

export function buildLegacyBridgeUpdateEmbeddingStateSql(): string {
  return `CASE
    WHEN ${buildInternalKindPredicateSql('NEW')} THEN 'not_applicable'
    WHEN NEW.status IN ('archived', 'conflicted') THEN OLD.embedding_state
    WHEN NEW.status = 'embedded' THEN 'ready'
    WHEN NEW.status = 'error' THEN 'error'
    WHEN NEW.status = 'fts_only' THEN 'fts_only'
    ELSE 'pending'
  END`
}
