import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import type { AcpAgentConfig, AgentSessionLifecycleStatus } from '@shared/presenter'

export type AcpConnectionStatus = 'starting' | 'ready' | 'auth-required' | 'error' | 'disposed'

export interface AcpConnectionRef {
  id: string
  agentId: string
  workdir: string
  protocolVersion: string
  capabilities?: schema.AgentCapabilities
  authMethods?: schema.AuthMethod[]
  status: AcpConnectionStatus
}

export interface AcpSessionRef {
  id: string
  acpSessionId: string
  conversationId: string
  connectionId: string
  workdir: string
  modeId?: string
  modelId?: string
  status: AgentSessionLifecycleStatus
}

export interface StartAcpConnectionInput {
  agent: AcpAgentConfig
  workdir?: string
}

export interface CancelAcpPromptInput {
  sessionId: string
  agentId: string
}
