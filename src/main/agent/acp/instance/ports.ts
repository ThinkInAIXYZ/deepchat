import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import type { AcpAgentConfig } from '@shared/presenter'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { LLMCoreStreamEvent, PermissionRequestPayload } from '@shared/types/core/llm-events'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type {
  MessageStartResult,
  SendMessageInput,
  UserMessageContent
} from '@shared/types/agent-interface'
import type { AppSessionId, AcpRemoteSessionId } from '@/agent/shared/agentSessionIds'

export type AcpInstanceScope = 'regular' | 'subagent'

export interface AcpCompatibilityPromptSections {
  configured: string
  runtime: string
  environment: string
  skills: string
  activeSkills: string
  tooling: string
  permission: string
  verification: string
}

export interface AcpPromptResourceSnapshot {
  latestUserMessage: ChatMessage
  userContent: UserMessageContent
  sections: AcpCompatibilityPromptSections
  localToolDefinitions: MCPToolDefinition[]
  requestTimeoutMs?: number
  traceEnabled: boolean
}

export interface AcpPromptResourcePort {
  resolve(input: {
    sessionId: AppSessionId
    agent: AcpAgentConfig
    scope: AcpInstanceScope
    workdir: string
    content: string | SendMessageInput
    signal: AbortSignal
  }): Promise<AcpPromptResourceSnapshot>
}

export interface AcpBuiltCompatibilityPrompt {
  messages: ChatMessage[]
  localToolDefinitions: MCPToolDefinition[]
}

export interface AcpCompatibilityPromptPort {
  build(input: {
    scope: AcpInstanceScope
    latestUserMessage: ChatMessage
    sections: AcpCompatibilityPromptSections
    localToolDefinitions: readonly MCPToolDefinition[]
  }): AcpBuiltCompatibilityPrompt
}

export interface AcpProjectionHandle extends MessageStartResult {
  requestId: string
  messageId: string
  userMessageId: string
  requestSeq: number
}

export interface AcpViewManifestInput {
  sessionId: AppSessionId
  messageId: string
  requestSeq: number
  providerId: 'acp'
  modelId: string
  messages: ChatMessage[]
  localToolDefinitions: MCPToolDefinition[]
}

export type AcpProjectionSettlement =
  | { status: 'completed'; stopReason: 'complete' }
  | { status: 'error'; stopReason: 'error'; errorMessage: string }
  | { status: 'aborted'; stopReason: 'user_stop'; errorMessage: string }

export interface AcpCompatibilityProjectionPort {
  setStatus(status: 'generating' | 'idle' | 'error'): void
  begin(input: { sessionId: AppSessionId; userContent: UserMessageContent }): AcpProjectionHandle
  attemptViewManifest(input: AcpViewManifestInput): void | Promise<void>
  applyEvents(handle: AcpProjectionHandle, events: readonly LLMCoreStreamEvent[]): void
  presentPermission(handle: AcpProjectionHandle, payload: PermissionRequestPayload): void
  settlePermission(handle: AcpProjectionHandle, requestId: string, granted: boolean): void
  complete(
    handle: AcpProjectionHandle,
    stopReason: schema.PromptResponse['stopReason']
  ): AcpProjectionSettlement
  fail(handle: AcpProjectionHandle, error: unknown): AcpProjectionSettlement
  cancel(handle: AcpProjectionHandle): AcpProjectionSettlement
}

export interface AcpRequestTracePort {
  writePrompt(input: {
    enabled: boolean
    sessionId: AppSessionId
    messageId: string
    providerId: 'acp'
    modelId: string
    requestSeq: number
    remoteSessionId: AcpRemoteSessionId
    prompt: schema.ContentBlock[]
  }): void | Promise<void>
}

export interface AcpRateGatePort {
  wait(signal: AbortSignal): Promise<void>
}

export interface AcpTurnPersistencePort {
  startTurn(input: {
    id: string
    acpSessionId: AcpRemoteSessionId
    conversationId: AppSessionId
    userMessageId: null
    startedAt: number
  }): void | Promise<void>
  finishTurn(input: {
    id: string
    status: 'completed' | 'cancelled' | 'error'
    stopReason: string | null
    completedAt: number
  }): void | Promise<void>
}

export interface AcpDebugPort {
  appendDebugEvent(
    agentId: string,
    entry: {
      kind: 'request' | 'response' | 'error'
      action: 'session/prompt'
      sessionId: AcpRemoteSessionId
      message?: string
      payload: unknown
    }
  ): void
}

export interface AcpPermissionPresentationPort {
  present(payload: PermissionRequestPayload): void
  settle(requestId: string, granted: boolean): void
}
