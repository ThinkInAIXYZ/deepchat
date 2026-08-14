import type {
  AssistantMessageBlock,
  MessageMetadata,
  PermissionMode,
  QuestionOption
} from '@shared/types/agent-interface'
import type {
  LLMCoreStreamEvent,
  ProviderRoundStopReason,
  ToolCallExecutionOwner
} from '@shared/types/core/llm-events'
import type {
  ChatMessage,
  ChatMessageProviderOptions,
  ChatMessageProviderReplayProjector
} from '@shared/types/core/chat-message'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { ModelConfig } from '@shared/types/provider'
import type { DeepchatEventName } from '@shared/contracts/events'
import type { DeepChatInternalSessionUpdate } from './sessionUpdates'
import type { SessionTranscript } from '@/session/data/transcript'
import type { AgentPlanSnapshot, AgentPlanTerminalReason } from '@shared/types/agent-plan'
import type { LoopRun } from '@/agent/deepchat/loop/loopRun'
import type {
  DeepChatLoopNotificationObserver,
  PendingToolInteractionOrigin,
  PersistedToolBatchState,
  ToolCatalogPort,
  ToolExecutionPort,
  ToolResultPort
} from '@/agent/deepchat/loop/ports'
import type { CommandShellProfile } from '@shared/commandShell'
import type { ExecutionJournalWriter, TapeToolFactWriter } from '@/tape/ports/capabilities'
import type { EffectiveSkillContentResolution } from '@shared/types/skill'
import type {
  ExecutionOperationIdentity,
  ExecutionRunOutcome
} from '@/tape/domain/executionJournal'
import type { SessionPermissionGrant } from '@/session/contracts'
import type { ToolSurfaceDeferredDispatchBindingV1 } from './toolSurface'
import type { ProgrammaticToolParentRegistry } from '@/cli/programmaticToolParentRegistry'

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
}

export type DeepChatEventPublisher = (name: DeepchatEventName, payload: unknown) => void
export type DeepChatSessionUpdatePublisher = (update: DeepChatInternalSessionUpdate) => void

export interface IoParams {
  sessionId: string
  requestId: string
  messageId: string
  providerId: string
  modelId: string
  messageStore: SessionTranscript
  abortSignal: AbortSignal
  publishEvent: DeepChatEventPublisher
  publishSessionUpdate: DeepChatSessionUpdatePublisher
}

export type ProcessIoParams = Pick<
  IoParams,
  'messageStore' | 'publishEvent' | 'publishSessionUpdate'
> & {
  tapeToolFactWriter: TapeToolFactWriter
  executionJournalWriter: Pick<ExecutionJournalWriter, 'commitDispatch' | 'commitToolOutcome'>
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
  cacheImage?: (data: string) => Promise<string>
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
  interleavedReasoning: InterleavedReasoningConfig
  permissionMode: PermissionMode
  initialBlocks?: AssistantMessageBlock[]
  initialAccounting?: MessageMetadata
  providerReplayProjector?: ChatMessageProviderReplayProjector
  onFirstProviderRoundReady?: () => void
  onConversationMessagesChange?: (messages: ChatMessage[]) => void
  shouldYieldForPendingInput?: () => boolean
  maxProviderRounds?: number
  notificationObserver?: DeepChatLoopNotificationObserver
  controls?: ProcessControlCollaborators
  diagnostics?: ProcessInternalDiagnostics
  programmaticToolParents?: Pick<ProgrammaticToolParentRegistry, 'prepare'>
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
    dirty: false
  }
}
