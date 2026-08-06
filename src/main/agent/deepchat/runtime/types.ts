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
import type { TapeToolFactWriter } from '@/tape/ports/capabilities'

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
}

export interface ProcessControlCollaborators {
  autoGrantPermission?: (
    permission: NonNullable<PendingToolInteraction['permission']>
  ) => Promise<void>
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
  activateSkill?: (skillName: string) => Promise<string[]>
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

export interface ProcessParams {
  run: LoopRun<StreamState>
  toolCatalog: ToolCatalogPort
  refreshSystemPrompt?: (
    activeSkillNames: string[] | undefined,
    toolDefinitions: MCPToolDefinition[]
  ) => Promise<string>
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
