import type {
  AgentProcessHandle,
  AgentProcessStatus,
  AgentSessionLifecycleStatus,
  AgentSessionState
} from '@shared/presenter'

export type {
  AgentProcessHandle,
  AgentProcessStatus,
  AgentSessionLifecycleStatus,
  AgentSessionState
}

export interface AgentSessionManager<
  TSession extends AgentSessionState = AgentSessionState,
  TAgentDescriptor = string,
  TSessionOptions = unknown
> {
  getOrCreateSession(
    conversationId: string,
    agent: TAgentDescriptor,
    options: TSessionOptions
  ): Promise<TSession>
  getSession(conversationId: string): TSession | null
  listSessions(): TSession[]
  clearSession(conversationId: string): Promise<void>
  clearSessionsByAgent(agentId: string): Promise<void>
  clearAllSessions(): Promise<void>
}

export interface AgentProcessManager<
  THandle extends AgentProcessHandle = AgentProcessHandle,
  TDescriptor = string
> {
  getConnection(agent: TDescriptor): Promise<THandle>
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
