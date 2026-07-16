import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { AssistantMessageBlock, ChatMessageRecord } from '@shared/types/agent-interface'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { MCPToolCall, MCPToolDefinition, MCPToolResponse } from '@shared/types/core/mcp'
import type { ToolCallOptions, ToolPermissionPreCheckResult } from '@shared/types/tool'
import type { ModelConfig } from '@shared/types/provider'
import type { DeepChatTapeViewManifest } from '@shared/types/tape-view-manifest'
import type { MemorySessionHandle } from '@/agent/deepchat/memory/memoryPromptContributor'

export interface ProviderRequest {
  runId: string
  requestSeq: number
  messages: readonly ChatMessage[]
  tools: readonly MCPToolDefinition[]
  providerId: string
  modelId: string
  modelConfig: ModelConfig
  temperature: number
  maxTokens: number
  signal: AbortSignal
}

export interface ProviderPort {
  prepare(request: ProviderRequest): Promise<ProviderRequest>
  stream(request: ProviderRequest): AsyncGenerator<LLMCoreStreamEvent>
  cancel(input: { runId: string; abortController: AbortController }): void
}

export interface ToolCatalogPort {
  resolve(input?: { activeSkillNames?: string[] }): Promise<MCPToolDefinition[]>
}

export type ToolExecutionOptions = ToolCallOptions

export interface ToolExecutionPort {
  preCheck(
    call: MCPToolCall,
    options?: Pick<ToolExecutionOptions, 'permissionMode' | 'signal'>
  ): Promise<ToolPermissionPreCheckResult | null>
  execute(
    call: MCPToolCall,
    options?: ToolExecutionOptions
  ): Promise<{ content: unknown; rawData: MCPToolResponse }>
}

export interface DeepChatLoopToolNotification {
  readonly callId?: string
  readonly name?: string
  readonly params?: string
  readonly response?: string
  readonly error?: string
}

export type DeepChatLoopNotification =
  | {
      readonly event: 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure'
      readonly tool: DeepChatLoopToolNotification
    }
  | {
      readonly event: 'PermissionRequest'
      readonly permission: Readonly<Record<string, unknown>>
      readonly tool: DeepChatLoopToolNotification
    }

export interface DeepChatLoopNotificationObserver {
  notify(notification: DeepChatLoopNotification): void | PromiseLike<void>
}

export type PendingToolInteractionOrigin =
  | 'pre-check-permission'
  | 'question'
  | 'post-call-permission'
  | 'skill-draft-confirmation'

export interface PersistedToolBatchState {
  readonly callOrder: readonly string[]
  readonly invokedCallIds: readonly string[]
  readonly committedResultCallIds: readonly string[]
  readonly pendingInteractionCallIds: readonly string[]
}

export type ToolBatchOutcome<
  TInteraction extends {
    readonly origin: PendingToolInteractionOrigin
    readonly order: number
  }
> =
  | {
      type: 'completed'
      executed: number
      toolsChanged: boolean
      executionState: PersistedToolBatchState
      terminalError?: string
    }
  | {
      type: 'paused'
      executed: number
      toolsChanged: boolean
      interactions: readonly TInteraction[]
      executionState: PersistedToolBatchState
    }

export interface ToolBatchOutputCandidate {
  toolCallId: string
  toolName: string
  responseText: string
  isError: boolean
  offloadPath?: string
}

export interface ToolBatchOutputFitItem extends ToolBatchOutputCandidate {
  contextResponseText: string
  downgraded: boolean
}

export type PreparedToolOutput =
  | {
      kind: 'ok'
      content: string
      offloaded: boolean
      offloadPath?: string
    }
  | {
      kind: 'tool_error'
      message: string
    }

export type ToolBatchOutputFit =
  | {
      kind: 'ok'
      results: ToolBatchOutputFitItem[]
    }
  | {
      kind: 'terminal_error'
      message: string
      results: ToolBatchOutputFitItem[]
    }

export interface ToolResultPort {
  normalize(input: {
    sessionId: string
    toolCallId: string
    toolName: string
    toolArgs: string
    content: MCPToolResponse['content']
    isError: boolean
    signal?: AbortSignal
  }): Promise<MCPToolResponse['content']>
  prepare(input: {
    sessionId: string
    toolCallId: string
    toolName: string
    rawContent: string
  }): Promise<PreparedToolOutput>
  fitBatch(input: {
    conversationMessages: ChatMessage[]
    toolDefinitions: MCPToolDefinition[]
    contextLength: number
    maxTokens: number
    results: ToolBatchOutputCandidate[]
  }): Promise<ToolBatchOutputFit>
}

export interface TapeEntryRef {
  sessionId: AppSessionId
  entryId: number
}

export interface TapeHead {
  sessionId: AppSessionId
  latestEntryId: number
}

export interface TapeFactProvenance {
  source: 'message' | 'tool_call' | 'tool_result' | 'runtime_event'
  sourceId: string
  sequence: number
}

export interface TapeToolFactInput {
  sessionId: AppSessionId
  messageId: string
  orderSeq: number
  blockIndex: number
  block: AssistantMessageBlock
  provenance: TapeFactProvenance
}

export interface TapeAnchorInput {
  sessionId: AppSessionId
  name: string
  state: Readonly<Record<string, unknown>>
  meta: Readonly<Record<string, unknown>>
  provenance: TapeFactProvenance
}

export interface TapeEffectiveView {
  sessionId: AppSessionId
  records: ChatMessageRecord[]
}

export interface TapeRecorder {
  ensureSession(input: { sessionId: AppSessionId }): Promise<TapeHead>
  appendUserMessage(input: { record: ChatMessageRecord }): Promise<TapeEntryRef>
  appendViewManifest(manifest: DeepChatTapeViewManifest): Promise<TapeEntryRef | null>
  appendAssistantFact(input: { record: ChatMessageRecord }): Promise<TapeEntryRef>
  appendToolFact(input: TapeToolFactInput): Promise<TapeEntryRef>
  appendAnchor(input: TapeAnchorInput): Promise<TapeEntryRef>
  readEffectiveView(input: { sessionId: AppSessionId }): Promise<TapeEffectiveView>
}

export interface OutputSink {
  update(input: {
    runId: string
    sessionId: AppSessionId
    messageId: string
    blocks: readonly AssistantMessageBlock[]
  }): void
  complete(input: {
    runId: string
    sessionId: AppSessionId
    messageId: string
    blocks: readonly AssistantMessageBlock[]
    metadata: Readonly<Record<string, unknown>>
  }): void
  fail(input: { runId: string; sessionId: AppSessionId; messageId: string; error: unknown }): void
}

export interface BasePromptAssemblyInput {
  sessionId: AppSessionId
  configuredPrompt: string
  toolDefinitions: readonly MCPToolDefinition[]
  activeSkillNames: readonly string[]
}

export interface BasePromptAssembler {
  assemble(input: BasePromptAssemblyInput): Promise<string>
}

export interface PromptReconstructionAnchor {
  name: string
  state: Record<string, unknown>
  createdAt: number
}

export interface PostCompactionPromptAssemblyInput {
  memorySession: MemorySessionHandle
  basePrompt: string
  summaryText: string | null
  reconstructionAnchor: PromptReconstructionAnchor | null
  memoryQuery: string
  memoryMessageId?: string | null
}

export interface PostCompactionPromptAssembler {
  assemble(input: PostCompactionPromptAssemblyInput): Promise<string>
}
