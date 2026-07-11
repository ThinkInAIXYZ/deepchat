import type {
  AgentMemoryAuditActorType,
  AgentMemoryAuditFailureStatus,
  AgentMemoryAuditStatus
} from '@shared/types/agent-memory'

export type { AgentMemoryAuditActorType, AgentMemoryAuditStatus } from '@shared/types/agent-memory'

export interface AgentMemoryAuditRow {
  id: string
  agent_id: string
  event_type: string
  actor_type: AgentMemoryAuditActorType
  session_id: string | null
  memory_ref_id: string | null
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

export interface MemoryAuditListOptions {
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
  status: AgentMemoryAuditFailureStatus
  reason: string | null
  createdAt: number
}

export interface AgentMemoryHealthAuditStats {
  completed: number
  skipped: number
  failed: number
  recentFailures: AgentMemoryHealthRecentFailureRow[]
}
