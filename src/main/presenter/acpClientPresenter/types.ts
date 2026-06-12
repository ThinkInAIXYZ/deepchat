import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import type { AcpAgentConfig, AgentSessionLifecycleStatus } from '@shared/presenter'
import type { AssistantMessageBlock } from '@shared/chat'
import type { DeepChatAgentEvent as SharedDeepChatAgentEvent } from '@shared/contracts/acp'

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

export type DeepChatAgentEvent =
  | SharedDeepChatAgentEvent
  | {
      type: 'tool.created' | 'tool.updated'
      conversationId: string
      toolCallId?: string
      block: AssistantMessageBlock
    }

export interface StartAcpConnectionInput {
  agent: AcpAgentConfig
  workdir?: string
}

export interface CancelAcpPromptInput {
  sessionId: string
  agentId: string
}
