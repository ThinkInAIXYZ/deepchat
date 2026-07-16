import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import type { AcpAgentConfig, AcpConfigState } from '@shared/types/acp'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { LLMCoreStreamEvent, PermissionRequestPayload } from '@shared/types/core/llm-events'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type {
  MessageStartResult,
  SendMessageInput,
  UserMessageContent
} from '@shared/types/agent-interface'
import type { AppSessionId, AcpRemoteSessionId } from '@/agent/shared/agentSessionIds'
import type { AcpSessionCommand, AcpSessionRecord } from '@/agent/acp/runtime'
import type {
  DeepChatTapeViewPolicy,
  DeepChatTapeViewTaskType,
  DeepChatTapeViewTokenBudget
} from '@shared/types/tape-view-manifest'

export type AcpInstanceScope = 'regular' | 'subagent'
export type AcpAgentStatus = 'initializing' | 'idle' | 'generating' | 'error' | 'closed'

export interface AcpAgentSnapshot {
  sessionId: AppSessionId
  agentId: string
  scope: AcpInstanceScope
  workdir: string
  status: AcpAgentStatus
  ready: boolean
  active: boolean
  remoteSessionId: AcpRemoteSessionId | null
}

export interface AcpAgentSessionHandle {
  readonly kind: 'acp'
  readonly sessionId: AppSessionId
  send(content: SendMessageInput): Promise<MessageStartResult>
  cancel(): Promise<void>
  snapshot(): Promise<AcpAgentSnapshot>
  waitForFirstTurnReady(options?: { timeoutMs?: number }): Promise<boolean>
  close(): Promise<void>
}

export interface AcpSessionLifecycleFacet {
  prepare(): Promise<void>
  updateWorkdir(workdir: string | null): Promise<string>
  getWorkdir(): string
}

export interface AcpSessionCapabilityFacet {
  getModes(): { current: string; available: AcpMode[] } | null
  setMode(modeId: string): Promise<void>
  getConfigOptions(): AcpConfigState | null
  setConfigOption(configId: string, value: string | boolean): Promise<AcpConfigState | null>
  getCommands(): AcpSessionCommand[]
}

export interface AcpPermissionFacet {
  resolvePermissionRequest(requestId: string, granted: boolean): boolean
}

export interface AcpMode {
  id: string
  name: string
  description: string
}

export interface AcpSessionRuntimePort {
  open(
    conversationId: AppSessionId,
    agent: AcpAgentConfig,
    hooks: {
      onEvents?(events: readonly LLMCoreStreamEvent[]): void
      onPermission(
        request: schema.RequestPermissionRequest
      ): Promise<schema.RequestPermissionResponse>
      onProcessExit?(sessionId: AcpRemoteSessionId): void
      signal?: AbortSignal
    },
    workdir?: string | null
  ): Promise<AcpSessionRecord>
  prepare(
    conversationId: AppSessionId,
    agent: AcpAgentConfig,
    workdir?: string | null,
    hooks?: { onProcessExit?(sessionId: AcpRemoteSessionId): void; signal?: AbortSignal }
  ): Promise<AcpSessionRecord>
  updateWorkdir(
    conversationId: AppSessionId,
    agentId: string,
    workdir: string | null
  ): Promise<string>
  getSession(conversationId: AppSessionId): AcpSessionRecord | null
  clearMappedSession(sessionId: AcpRemoteSessionId): void
  clear(conversationId: AppSessionId): Promise<void>
  getModes(conversationId: AppSessionId): { current: string; available: AcpMode[] } | null
  setMode(conversationId: AppSessionId, modeId: string): Promise<void>
  getConfigOptions(conversationId: AppSessionId): AcpConfigState | null
  setConfigOption(
    conversationId: AppSessionId,
    configId: string,
    value: string | boolean
  ): Promise<AcpConfigState | null>
  getCommands(conversationId: AppSessionId): AcpSessionCommand[]
}

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
  viewManifest: Pick<
    AcpViewManifestInput,
    | 'taskType'
    | 'policy'
    | 'policyVersion'
    | 'tokenBudget'
    | 'summaryCursorOrderSeq'
    | 'supportsVision'
    | 'supportsAudioInput'
    | 'traceDebugEnabled'
  >
}

export interface AcpPromptResourcePort {
  resolve(input: {
    sessionId: AppSessionId
    agent: AcpAgentConfig
    scope: AcpInstanceScope
    workdir: string
    content: SendMessageInput
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
  taskType: DeepChatTapeViewTaskType
  policy: DeepChatTapeViewPolicy
  policyVersion: number | null
  tokenBudget: Omit<DeepChatTapeViewTokenBudget, 'estimatedPromptTokens'>
  summaryCursorOrderSeq: number
  supportsVision: boolean
  supportsAudioInput: boolean
  traceDebugEnabled: boolean
}

export type AcpProjectionSettlement =
  | {
      status: 'completed'
      stopReason: 'complete' | 'max_tokens' | 'max_turn_requests'
    }
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
  clearWaiting(): void
}

export interface AcpObserverPort {
  userPromptSubmitted(input: {
    sessionId: AppSessionId
    messageId: string
    promptPreview: string
    agentId: string
    workdir: string
  }): void
  terminal(input: {
    sessionId: AppSessionId
    agentId: string
    workdir: string
    status: AcpProjectionSettlement['status']
    stopReason: AcpProjectionSettlement['stopReason']
    errorMessage?: string
  }): void
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
