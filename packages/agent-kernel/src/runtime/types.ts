import type {
  AssistantMessageBlock,
  MessageMetadata,
  PermissionMode,
  QuestionOption
} from '@deepchat/shared/types/agent-interface'
import type {
  LLMCoreStreamEvent,
  ProviderRoundStopReason,
  ToolCallExecutionOwner
} from '@deepchat/shared/types/core/llm-events'
import type {
  ChatMessage,
  ChatMessageProviderOptions,
  ChatMessageProviderReplayProjector
} from '@deepchat/shared/types/core/chat-message'
import type { MCPToolDefinition } from '@deepchat/shared/types/core/mcp'
import type { ModelConfig } from '@deepchat/shared/types/provider'
import type { DeepChatProviderAttemptIdentity } from '@deepchat/shared/types/provider-attempt'
import type { DeepChatInternalSessionUpdate } from './sessionUpdates.js'

import type { AgentPlanSnapshot, AgentPlanTerminalReason } from '@deepchat/shared/types/agent-plan'
import type { LoopRun } from '../loop/loopRun.js'
import type {
  DeepChatLoopNotificationObserver,
  PendingToolInteractionOrigin,
  PersistedToolBatchState,
  ToolCatalogPort,
  ToolExecutionPort,
  ToolResultPort
} from '../loop/ports.js'
import type { CommandShellProfile } from '@deepchat/shared/commandShell'
import type {
  ExecutionJournalWriter,
  NestedExecutionJournalWriter,
  TapeToolFactWriter
} from '../tape/ports/capabilities.js'
import type { EffectiveSkillContentResolution } from '@deepchat/shared/types/skill'
import type {
  ExecutionOperationIdentity,
  ExecutionRunOutcome
} from '../tape/domain/executionJournal.js'

import type { ToolSurfaceDeferredDispatchBindingV1 } from './toolSurface.js'
import { type TranscriptStorePort } from '../contracts/transcriptStore.js'
import { type CacheImageOptions, type ToolImagePreviewPort } from '../contracts/imagePreview.js'
import { type SessionPermissionGrant } from '../contracts/sessionPermission.js'
import { type ProgrammaticToolAuthorityPort } from '../contracts/programmaticToolAuthority.js'

interface RunJournalObservationIdentity {
  runId: string
  sessionId: string
  messageId: string
}

export type RunJournalObservation =
  | (RunJournalObservationIdentity &
      (
        | {
            type: 'started'
            runKind: 'loop'
            initialRequestSeq: number
          }
        | {
            type: 'started'
            runKind: 'deferred_tool'
          }
      ))
  | (RunJournalObservationIdentity & {
      type: 'terminal'
      outcome: ExecutionRunOutcome
      stopReason: string
      durationMs?: number
    } & (
        | {
            runKind: 'loop'
            logicalRounds: number
            toolCalls: number
          }
        | {
            runKind: 'deferred_tool'
          }
      ))

export type RunJournalObserver = (observation: RunJournalObservation) => void

export function notifyRunJournalObserver(
  observer: RunJournalObserver | undefined,
  observation: RunJournalObservation
): void {
  try {
    observer?.(observation)
  } catch {
    // Diagnostics must never alter the durable Run lifecycle.
  }
}

export interface InterleavedReasoningConfig {
  preserveReasoningContent: boolean
  preserveEmptyReasoningContent?: boolean
  forcedBySessionSetting: boolean
  portraitInterleaved: boolean
  reasoningSupported: boolean
  providerDbSourceUrl: string
}

export interface ToolCallResult {
  id: string
  name: string
  arguments: string
  providerOptions?: ChatMessageProviderOptions
  serverName?: string
  serverIcons?: string
  serverDescription?: string
}

export interface StreamState {
  blocks: AssistantMessageBlock[]
  metadata: MessageMetadata
  startTime: number
  firstTokenTime: number | null
  pendingToolCalls: Map<
    string,
    {
      name: string
      arguments: string
      blockIndex: number
      executionOwner: ToolCallExecutionOwner
      providerOptions?: ChatMessageProviderOptions
    }
  >
  completedToolCalls: ToolCallResult[]
  stopReason: ProviderRoundStopReason | null
  latestAgentPlanSnapshot?: AgentPlanSnapshot
  planTerminalReason?: AgentPlanTerminalReason
  roundUsage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cachedInputTokens?: number
    cacheWriteInputTokens?: number
  } | null
  toolCallCount: number
  dirty: boolean
  blocksRevision: number
}

/**
 * Event names the kernel publishes. The host maps these onto its full event catalog; the kernel
 * itself carries no app-wide event vocabulary, so this union stays closed over the literals the
 * runtime owners actually emit.
 */
export type DeepChatKernelEventName =
  | 'chat.plan.updated'
  | 'chat.stream.completed'
  | 'chat.stream.failed'
  | 'chat.stream.updated'
  | 'sessions.compaction.changed'
  | 'sessions.status.changed'
  | 'sessions.updated'

export type DeepChatEventPublisher = (name: DeepChatKernelEventName, payload: unknown) => void
export type DeepChatSessionUpdatePublisher = (update: DeepChatInternalSessionUpdate) => void

/**
 * Kernel-facing invalidation signal. The kernel states what changed; the host decides which of its
 * projections (widgets, lists, badges) that invalidates, so the kernel carries no UI vocabulary.
 */
export interface SessionInvalidationPort {
  invalidate(input: { sessionId: string; reason: 'status-changed' }): void
}

export interface IoParams {
  sessionId: string
  requestId: string
  messageId: string
  providerId: string
  modelId: string
  messageStore: TranscriptStorePort
  abortSignal: AbortSignal
  publishEvent: DeepChatEventPublisher
  publishSessionUpdate: DeepChatSessionUpdatePublisher
}

export type ProcessIoParams = Pick<
  IoParams,
  'messageStore' | 'publishEvent' | 'publishSessionUpdate'
> & {
  tapeToolFactWriter: TapeToolFactWriter
  executionJournalWriter: Pick<ExecutionJournalWriter, 'commitDispatch' | 'commitToolOutcome'> &
    Partial<NestedExecutionJournalWriter>
}

export type SkillActivationPreparation =
  | {
      readonly kind: 'prepared'
      apply(): void
    }
  | {
      readonly kind: 'rejected'
    }

export interface ProcessControlCollaborators {
  autoGrantPermission?: (
    permission: NonNullable<PendingToolInteraction['permission']>
  ) => Promise<SessionPermissionGrant | null>
  revokeOneShotCommandPermission?: (signature: string, oneShotGrantId: string) => void
  reviewToolPermission?: (
    request: ToolPermissionReviewRequest
  ) => Promise<ToolPermissionReviewResult>
  onStreamingProviderPermission?: (
    permission: NonNullable<PendingToolInteraction['permission']>,
    tool: {
      callId?: string
      name?: string
      params?: string
    },
    commitDecision: (granted: boolean) => void
  ) => void
  getActiveSkillNames?: () => string[]
  getEnabledMcpServerIds?: () => string[] | null | undefined
  getAgentId?: () => string | undefined
  prepareSkillActivation?: (skillName: string) => Promise<SkillActivationPreparation>
  activateSkill?: (skillName: string) => Promise<string[]>
  commitRuntimeSkillView?: (input: {
    resolution: EffectiveSkillContentResolution
    toolCallId: string
    responseText: string
    blockIndex: number
    timestamp: number
    operation: ExecutionOperationIdentity
    outcomeEntryId: number
  }) => Promise<void> | void
  cacheImage?: (data: string, options?: CacheImageOptions) => Promise<string>
}

export interface ProcessInternalDiagnostics {
  onInterleavedReasoningGap?: (gap: {
    providerId: string
    modelId: string
    providerDbSourceUrl: string
    reasoningContentLength: number
    toolCallCount: number
  }) => void
}

export interface ToolDispatchCollaborators {
  notificationObserver?: DeepChatLoopNotificationObserver
  controls?: ProcessControlCollaborators
  diagnostics?: ProcessInternalDiagnostics
  onToolCallStarted?: (toolCallId: string) => void
}

export interface ToolPermissionReviewRequest {
  sessionId: string
  messageId: string
  toolCallId: string
  toolName: string
  toolArgs: string
  toolSource?: 'agent' | 'mcp'
  serverName?: string
  permission?: NonNullable<PendingToolInteraction['permission']>
  reason: 'tool_call' | 'precheck' | 'requires_permission'
}

export interface ToolPermissionReviewResult {
  decision: 'auto_allow' | 'ask_user' | 'block'
  riskLevel?: 'low' | 'medium' | 'high' | 'critical'
  userAuthorization?: 'unknown' | 'low' | 'medium' | 'high'
  rationale?: string
  actionHash?: string
}

export interface PendingToolInteraction {
  type: 'question' | 'permission'
  origin: PendingToolInteractionOrigin | 'acp-permission'
  order: number
  messageId: string
  toolCallId: string
  toolName: string
  toolArgs: string
  serverName?: string
  serverIcons?: string
  serverDescription?: string
  toolSurfaceBinding?: ToolSurfaceDeferredDispatchBindingV1
  question?: {
    header?: string
    question: string
    options: QuestionOption[]
    custom: boolean
    multiple: boolean
  }
  permission?: {
    permissionType: 'read' | 'write' | 'all' | 'command'
    description: string
    toolName?: string
    serverName?: string
    providerId?: string
    requestId?: string
    rememberable?: boolean
    requiresUserConfirmation?: boolean
    command?: string
    commandSignature?: string
    shellProfile?: CommandShellProfile
    paths?: string[]
    commandInfo?: {
      command: string
      riskLevel: 'low' | 'medium' | 'high' | 'critical'
      suggestion: string
      signature?: string
      baseCommand?: string
    }
  }
}

export type ToolBatchInteraction = Omit<PendingToolInteraction, 'origin'> & {
  origin: PendingToolInteractionOrigin
}

export interface ProcessResult {
  status: 'completed' | 'paused' | 'aborted' | 'error'
  pendingInteractions?: ToolBatchInteraction[]
  toolBatchExecutionState?: PersistedToolBatchState
  terminalError?: string
  stopReason?: string
  usage?: Record<string, number>
  errorMessage?: string
}

export interface ProcessTerminalSelection {
  outcome: ProcessResult['status']
  stopReason: string
  errorMessage?: string
}

export interface ProcessParams {
  run: LoopRun<StreamState>
  toolCatalog: ToolCatalogPort
  toolExecution: ToolExecutionPort
  toolResults: ToolResultPort
  coreStream: (
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    tools: MCPToolDefinition[]
  ) => AsyncGenerator<LLMCoreStreamEvent>
  providerId: string
  modelId: string
  modelConfig: ModelConfig
  temperature: number
  maxTokens: number
  prepareToolContinuationContext?: (
    requestedMaxTokens: number,
    messages: ChatMessage[],
    tools: MCPToolDefinition[]
  ) =>
    | { contextLength: number; outputCapContextLength: number }
    | Promise<{ contextLength: number; outputCapContextLength: number }>
  interleavedReasoning: InterleavedReasoningConfig
  permissionMode: PermissionMode
  initialBlocks?: AssistantMessageBlock[]
  initialAccounting?: MessageMetadata
  providerReplayProjector?: ChatMessageProviderReplayProjector
  providerAttemptIdentity?: () => DeepChatProviderAttemptIdentity | null
  onFirstProviderRoundReady?: () => void
  onConversationMessagesChange?: (messages: ChatMessage[]) => void
  shouldYieldForPendingInput?: () => boolean
  maxProviderRounds?: number
  notificationObserver?: DeepChatLoopNotificationObserver
  controls?: ProcessControlCollaborators
  diagnostics?: ProcessInternalDiagnostics
  programmaticToolParents?: Pick<ProgrammaticToolAuthorityPort, 'prepare'>
  imagePreviews: ToolImagePreviewPort
  commitRunTerminal(selection: ProcessTerminalSelection): void
  io: ProcessIoParams
}

export function createState(): StreamState {
  return {
    blocks: [],
    metadata: {},
    startTime: Date.now(),
    firstTokenTime: null,
    pendingToolCalls: new Map(),
    completedToolCalls: [],
    stopReason: null,
    roundUsage: null,
    toolCallCount: 0,
    dirty: false,
    blocksRevision: 0
  }
}

export function markStreamChanged(state: StreamState): void {
  state.dirty = true
  state.blocksRevision += 1
}
