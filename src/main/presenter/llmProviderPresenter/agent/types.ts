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

export interface AgentSessionManager<TSession extends AgentSessionState = AgentSessionState> {
  getOrCreateSession(
    conversationId: string,
    agentId: string,
    factory: () => Promise<TSession>
  ): Promise<TSession>
  getSession(conversationId: string): TSession | null
  listSessions(): TSession[]
  clearSession(conversationId: string): void
  clearSessionsByAgent(agentId: string): void
  clearAllSessions(): void
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

export interface AgentProcessManager<THandle extends AgentProcessHandle = AgentProcessHandle> {
  getConnection(agentId: string): Promise<THandle>
  getProcess(agentId: string): THandle | null
  listProcesses(): THandle[]
  release(agentId: string): Promise<void>
  shutdown(): Promise<void>
}

export interface AgentPermissionOption {
  optionId: string
  label?: string
  kind?: string
  description?: string
}

export interface AgentPermissionRequest {
  providerId: string
  agentId: string
  toolCallId?: string
  title?: string
  description?: string
  options: AgentPermissionOption[]
}

export type AgentPermissionResult =
  | { outcome: 'cancelled' }
  | { outcome: 'selected'; optionId: string }
