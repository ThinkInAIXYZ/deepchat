/** Persisted fields from the retired plan capability. Read compatibility only; no new producer. */
export interface LegacyAgentPlanMetadata {
  plan_entries?: LegacyAgentPlanEntry[]
  plan_explanation?: string
  plan_revision?: number
  plan_updated_at?: string
  plan_terminal_reason?: 'aborted' | 'max_steps' | 'error'
}

export interface LegacyAgentPlanEntry {
  step?: string
  content?: string
  status?: string | null
  priority?: string | null
}
