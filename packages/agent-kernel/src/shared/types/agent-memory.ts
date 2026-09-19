export const AGENT_MEMORY_CATEGORIES = [
  'user_preference',
  'project_fact',
  'task_outcome',
  'heuristic',
  'anti_pattern'
] as const

export const AGENT_MEMORY_TEMPORAL_KINDS = [
  'atemporal',
  'state',
  'event',
  'plan',
  'recurring'
] as const

export const AGENT_MEMORY_TEMPORAL_PRECISIONS = [
  'exact',
  'day',
  'week',
  'month',
  'quarter',
  'year',
  'unknown'
] as const

export const AGENT_MEMORY_SCOPE_TYPES = ['agent', 'user', 'project', 'session'] as const

export const AGENT_MEMORY_DIRECTIVE_KINDS = ['instruction', 'suppress_topic'] as const
export const AGENT_MEMORY_DIRECTIVE_STATUSES = ['draft', 'active', 'rejected'] as const
export const AGENT_MEMORY_DIRECTIVE_SOURCES = [
  'explicit_user',
  'manual',
  'derived_suggestion'
] as const

export const AGENT_MEMORY_AUDIT_ACTOR_TYPES = ['scheduler', 'user', 'runtime'] as const
export const AGENT_MEMORY_AUDIT_STATUSES = ['completed', 'skipped', 'failed'] as const
export const AGENT_MEMORY_AUDIT_FAILURE_STATUSES = ['failed', 'skipped'] as const

export const MEMORY_RECALL_LATENCY_STAGES = [
  'keyword',
  'queryEmbedding',
  'vector',
  'authoritativeRevalidation',
  'assembly',
  'total'
] as const

export const MEMORY_RETRIEVAL_PURPOSES = ['recall', 'decision', 'search', 'injection'] as const

export const MEMORY_RETRIEVAL_OUTCOMES = [
  'completed',
  'disabled',
  'emptyQuery',
  'cancelled',
  'failed'
] as const

export const MEMORY_RETRIEVAL_DEGRADATION_CAUSES = [
  'vectorCold',
  'embeddingTimeout',
  'embeddingError',
  'embeddingCircuitOpen',
  'storeUnusable',
  'storeTimeout',
  'storeError',
  'revisionChanged',
  'ftsUnavailable',
  'candidateBudgetExhausted',
  'unknown'
] as const

export const MEMORY_MAINTENANCE_BUDGET_STEPS = [
  'challenge',
  'merge',
  'reflection',
  'persona'
] as const

export type MemoryRecallLatencyStage = (typeof MEMORY_RECALL_LATENCY_STAGES)[number]
export type MemoryRetrievalPurpose = (typeof MEMORY_RETRIEVAL_PURPOSES)[number]
export type MemoryRetrievalOutcome = (typeof MEMORY_RETRIEVAL_OUTCOMES)[number]
export type MemoryRetrievalDegradationCause = (typeof MEMORY_RETRIEVAL_DEGRADATION_CAUSES)[number]
export type MemoryMaintenanceBudgetStep = (typeof MEMORY_MAINTENANCE_BUDGET_STEPS)[number]

export type AgentMemoryAuditActorType = (typeof AGENT_MEMORY_AUDIT_ACTOR_TYPES)[number]
export type AgentMemoryAuditStatus = (typeof AGENT_MEMORY_AUDIT_STATUSES)[number]
export type AgentMemoryAuditFailureStatus = (typeof AGENT_MEMORY_AUDIT_FAILURE_STATUSES)[number]

export const AGENT_MEMORY_MANUAL_CONTENT_MAX_CHARS = 12_000
export const AGENT_MEMORY_AUTO_CONTENT_MAX_CHARS = 2_000
export const AGENT_MEMORY_DIRECTIVE_CONTENT_MAX_CHARS = 2_000
export const AGENT_MEMORY_DIRECTIVE_TOPIC_MAX_CHARS = 512
export const AGENT_MEMORY_DIRECTIVE_CJK_TOPIC_MIN_VISIBLE_CHARS = 2
export const AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT = 64
export const AGENT_MEMORY_SCOPE_ID_MAX_CHARS = 256

export const AGENT_MEMORY_AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/

export function isSafeAgentId(agentId: unknown): agentId is string {
  return typeof agentId === 'string' && AGENT_MEMORY_AGENT_ID_PATTERN.test(agentId)
}

export type AgentMemoryCategory = (typeof AGENT_MEMORY_CATEGORIES)[number]
export type AgentMemoryTemporalKind = (typeof AGENT_MEMORY_TEMPORAL_KINDS)[number]
export type AgentMemoryTemporalPrecision = (typeof AGENT_MEMORY_TEMPORAL_PRECISIONS)[number]
export type AgentMemoryScopeType = (typeof AGENT_MEMORY_SCOPE_TYPES)[number]
export type AgentMemoryDirectiveKind = (typeof AGENT_MEMORY_DIRECTIVE_KINDS)[number]
export type AgentMemoryDirectiveStatus = (typeof AGENT_MEMORY_DIRECTIVE_STATUSES)[number]
export type AgentMemoryDirectiveSource = (typeof AGENT_MEMORY_DIRECTIVE_SOURCES)[number]

export const AGENT_MEMORY_HEALTH_KIND_KEYS = [
  'episodic',
  'semantic',
  'reflection',
  'persona',
  'working'
] as const

export const AGENT_MEMORY_LIFECYCLE_STATES = ['active', 'archived', 'conflicted'] as const

export const AGENT_MEMORY_EMBEDDING_STATES = [
  'pending',
  'ready',
  'error',
  'fts_only',
  'not_applicable'
] as const

export type AgentMemoryHealthKind = (typeof AGENT_MEMORY_HEALTH_KIND_KEYS)[number]
export type AgentMemoryLifecycleState = (typeof AGENT_MEMORY_LIFECYCLE_STATES)[number]
export type AgentMemoryEmbeddingState = (typeof AGENT_MEMORY_EMBEDDING_STATES)[number]

function asNonEmptyTuple<T extends string>(values: readonly T[]): readonly [T, ...T[]] {
  if (values.length === 0) throw new Error('Expected a non-empty tuple')
  return values as unknown as readonly [T, ...T[]]
}

export const AGENT_MEMORY_HEALTH_TOP_KIND_KEYS = asNonEmptyTuple(
  AGENT_MEMORY_HEALTH_KIND_KEYS.filter(
    (kind): kind is Exclude<AgentMemoryHealthKind, 'working'> => kind !== 'working'
  )
)

export type AgentMemoryHealthTopKind = (typeof AGENT_MEMORY_HEALTH_TOP_KIND_KEYS)[number]

export const AGENT_MEMORY_HEALTH_STATUS_KEYS = [
  'pending_embedding',
  'embedded',
  'error',
  'fts_only',
  'archived',
  'conflicted'
] as const

export type AgentMemoryHealthStatus = (typeof AGENT_MEMORY_HEALTH_STATUS_KEYS)[number]
export type LegacyAgentMemoryStatus = AgentMemoryHealthStatus

export const AGENT_MEMORY_HEALTH_CATEGORY_KEYS = [
  ...AGENT_MEMORY_CATEGORIES,
  'uncategorized'
] as const

export type AgentMemoryHealthCategory = (typeof AGENT_MEMORY_HEALTH_CATEGORY_KEYS)[number]

export const CATEGORY_IMPORTANCE_FLOOR: Record<AgentMemoryCategory, number> = {
  user_preference: 0.5,
  project_fact: 0.6,
  task_outcome: 0.55,
  heuristic: 0.5,
  anti_pattern: 0.6
}

const AGENT_MEMORY_CATEGORY_SET: ReadonlySet<string> = new Set(AGENT_MEMORY_CATEGORIES)

export function isAgentMemoryCategory(value: unknown): value is AgentMemoryCategory {
  return typeof value === 'string' && AGENT_MEMORY_CATEGORY_SET.has(value)
}
