import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import type { AcpAgentConfig, AcpConfigState, AgentSessionLifecycleStatus } from '@shared/presenter'
import type { AssistantMessageBlock } from '@shared/chat'

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
  | { type: 'message.delta'; conversationId: string; text: string }
  | { type: 'content.block'; conversationId: string; block: AssistantMessageBlock }
  | {
      type: 'tool.created' | 'tool.updated'
      conversationId: string
      toolCallId?: string
      block: AssistantMessageBlock
    }
  | { type: 'plan.updated'; conversationId: string; entries: unknown[] }
  | { type: 'terminal.updated'; conversationId: string; terminal: unknown }
  | { type: 'permission.requested'; conversationId: string; request: unknown }
  | { type: 'config.updated'; conversationId: string; configState: AcpConfigState }
  | { type: 'turn.completed'; conversationId: string; stopReason: string }

export interface StartAcpConnectionInput {
  agent: AcpAgentConfig
  workdir?: string
}

export interface CancelAcpPromptInput {
  sessionId: string
  agentId: string
}
