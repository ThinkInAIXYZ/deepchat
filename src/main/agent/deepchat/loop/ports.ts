import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type {
  MCPToolCall,
  MCPToolDefinition,
  MCPToolResponse,
  ToolDispatchCommit
} from '@shared/types/core/mcp'
import type { ToolCallOptions, ToolPermissionPreCheckResult } from '@shared/types/tool'
import type { ModelConfig } from '@shared/types/provider'
import type { DeepChatPromptAssembly } from '@shared/types/prompt-assembly'
import type { MemorySessionHandle } from '@/agent/deepchat/memory/memoryPromptContributor'
import type { ContextRuntimeContributions } from '@/agent/deepchat/runtime/contextContributions'
import type {
  ToolSurfaceDeferredDispatch,
  ToolSurfaceExecutionContext,
  ToolSurfaceSnapshot
} from '@/agent/deepchat/runtime/toolSurface'
import type { ProgrammaticToolCapabilityV1 } from '@/agent/deepchat/runtime/programmaticToolSurface'
import type { DeepChatExecutionContract } from '@shared/types/execution-contract'
import type { DeepChatTaskContractContext } from '@shared/types/task-contract'
import type { ResolvedCommandShell } from '@shared/commandShell'
import type { ProgrammaticToolParentRegistration } from '@/cli/programmaticToolParentRegistry'

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

export interface ToolCatalogRequest {
  activeSkillNames?: string[]
  failClosed?: boolean
}

export interface ToolCatalogPort {
  resolve(input?: ToolCatalogRequest): Promise<MCPToolDefinition[]>
}

export interface DeepChatTaskContractContextPort {
  prepare(sessionId: string): DeepChatTaskContractContext | null
}

export type ToolExecutionOptions = Omit<ToolCallOptions, 'commitDispatch' | 'commandShell'> & {
  commitDispatch: ToolDispatchCommit
  commandShell: ResolvedCommandShell
  toolSurfaceDeferredDispatch?: ToolSurfaceDeferredDispatch
  toolSurfaceContext?: ToolSurfaceExecutionContext
  toolSurfaceSnapshot?: ToolSurfaceSnapshot
  programmaticToolCapability?: ProgrammaticToolCapabilityV1
  programmaticToolParent?: ProgrammaticToolParentRegistration
}

export type ToolExecutionPreCheckOptions = Pick<
  ToolExecutionOptions,
  | 'permissionMode'
  | 'signal'
  | 'activeSkillNames'
  | 'commandShell'
  | 'messageId'
  | 'runId'
  | 'requestSeq'
  | 'toolSurfaceSnapshot'
>

export interface ToolExecutionPort {
  assertAuthority(call: MCPToolCall, options: ToolExecutionPreCheckOptions): void
  preCheck(
    call: MCPToolCall,
    options: ToolExecutionPreCheckOptions
  ): Promise<ToolPermissionPreCheckResult | null>
  execute(
    call: MCPToolCall,
    options: ToolExecutionOptions
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
  isObserved(event: DeepChatLoopNotification['event']): boolean
  notify(notification: DeepChatLoopNotification): void
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
  readonly executionContract?: DeepChatExecutionContract
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
  existingOffloadPath?: string
  requiresInline?: boolean
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
    ownerPluginId?: string
    signal?: AbortSignal
  }): Promise<MCPToolResponse['content']>
  prepare(input: {
    sessionId: string
    toolCallId: string
    toolName: string
    rawContent: string
  }): Promise<PreparedToolOutput>
  fitBatch(input: {
    sessionId: string
    conversationMessages: ChatMessage[]
    toolDefinitions: MCPToolDefinition[]
    contextLength: number
    outputCapContextLength?: number
    maxTokens: number
    results: ToolBatchOutputCandidate[]
  }): Promise<ToolBatchOutputFit>
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
  sessionActiveSkillNames: readonly string[]
  sessionSkillBodiesOverride?: readonly Readonly<{ name: string; content: string }>[]
  contextLength: number
  commandShell: ResolvedCommandShell
}

export interface BasePromptAssembler {
  assemble(input: BasePromptAssemblyInput): Promise<string>
  assembleWithProvenance(input: BasePromptAssemblyInput): Promise<DeepChatPromptAssembly>
}

export interface PromptReconstructionAnchor {
  entryId: number
  name: string
  state: Record<string, unknown>
  createdAt: number
}

export interface PostCompactionPromptAssemblyInput {
  memorySession: MemorySessionHandle
  summaryText: string | null
  reconstructionAnchor: PromptReconstructionAnchor | null
  memoryQuery: string
  memoryMessageId?: string | null
}

export interface PostCompactionPromptAssembler {
  assemble(input: PostCompactionPromptAssemblyInput): Promise<ContextRuntimeContributions>
}
