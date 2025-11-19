export type AgentSessionLifecycleStatus = 'idle' | 'active' | 'error'

export interface AgentSessionState {
  providerId: string
  agentId: string
  conversationId: string
  sessionId: string
  status: AgentSessionLifecycleStatus
  createdAt: number
  updatedAt: number
  metadata?: Record<string, unknown>
}

export type AgentProcessStatus = 'spawning' | 'ready' | 'error'

export interface AgentProcessHandle {
  providerId: string
  agentId: string
  status: AgentProcessStatus
  pid?: number
  restarts?: number
  lastHeartbeatAt?: number
  metadata?: Record<string, unknown>
}

export interface AgentProviderMetadata {
  providerId: string
  label: string
  isEnabled: boolean
  sessionCount: number
  processCount: number
}
