import type { OrchestrationPolicy } from '../shared/orchestration/policy.js'
import type { ToolModeOverride } from '../shared/toolMode.js'

/**
 * Session-agent row projection the built-in kernel reads: identity, lineage, and the persisted
 * tool-policy columns. The host `new_sessions` table satisfies the store port structurally.
 */
export type SessionAgentRow = {
  agent_id: string
  parent_session_id: string | null
  session_kind: 'regular' | 'subagent'
  project_dir: string | null
  orchestration_policy: OrchestrationPolicy
  tool_mode_override: ToolModeOverride
}

export interface SessionAgentRowStorePort {
  get(id: string): SessionAgentRow | null | undefined
  getDisabledAgentTools(id: string): string[]
}

/**
 * Session-agent row projection surface the built-in kernel needs. Declared here so kernel
 * modules depend on this structural port instead of the SQLite-backed session database; the host
 * database satisfies it through its `newSessionsTable` getter.
 */
export interface SessionAgentRowPort {
  newSessionsTable: SessionAgentRowStorePort
}
