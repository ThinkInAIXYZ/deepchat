export const AGENT_MEMORY_CATEGORIES = [
  'user_preference',
  'project_fact',
  'task_outcome',
  'heuristic',
  'anti_pattern'
] as const

export type AgentMemoryCategory = (typeof AGENT_MEMORY_CATEGORIES)[number]

export const AGENT_MEMORY_HEALTH_KIND_KEYS = [
  'episodic',
  'semantic',
  'reflection',
  'persona',
  'working'
] as const

export type AgentMemoryHealthKind = (typeof AGENT_MEMORY_HEALTH_KIND_KEYS)[number]

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
