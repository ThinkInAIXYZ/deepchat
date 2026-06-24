export const AGENT_MEMORY_CATEGORIES = [
  'user_preference',
  'project_fact',
  'task_outcome',
  'heuristic',
  'anti_pattern'
] as const

export type AgentMemoryCategory = (typeof AGENT_MEMORY_CATEGORIES)[number]

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
