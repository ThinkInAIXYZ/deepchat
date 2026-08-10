import type { ReasoningEffort, ReasoningVisibility, Verbosity } from './model-db'
import type { ImageGenerationOptions } from '../imageGenerationSettings'
import type { VideoGenerationOptions } from '../videoGenerationSettings'
import type { PersistedMcpToolResult, ToolCallImagePreview } from './core/mcp'
import type { AgentPlanDisplayItem, AgentPlanTerminalReason } from './agent-plan'
import type { DeepChatTapeViewManifestRecord } from './tape-view-manifest'
import type { DeepChatTapeReplayExportOptions, DeepChatTapeReplaySlice } from './tape-replay'
import type {
  AttachmentFallbackPolicy,
  AttachmentPreparationSummary,
  AttachmentRepresentationPreference,
  AttachmentResolvedRepresentation,
  PdfEmbeddedTextCoverage
} from './attachment'
import type { OrchestrationPolicy } from '../orchestration/policy'

export type {
  AttachmentFallbackPolicy,
  AttachmentPreparationAction,
  AttachmentPreparationIssue,
  AttachmentPreparationStatus,
  AttachmentPreparationSummary,
  AttachmentRepresentationPreference,
  AttachmentResolvedRepresentation,
  AttachmentUnavailableReason
} from './attachment'

/** Shared route, session, message and persistence DTOs for agent features. */

export type SessionStatus = 'idle' | 'generating' | 'error'
export type PermissionMode = 'default' | 'auto_approve' | 'full_access'
export type SessionCompactionStatus = 'idle' | 'compacting' | 'compacted'

export interface SessionCompactionState {
  status: SessionCompactionStatus
  cursorOrderSeq: number
  summaryUpdatedAt: number | null
}

export interface SessionGenerationSettings {
  systemPrompt: string
  temperature: number
  topP?: number
  contextLength: number
  maxTokens: number
  timeout: number
  thinkingBudget?: number
  reasoningEffort?: ReasoningEffort
  reasoningVisibility?: ReasoningVisibility
  verbosity?: Verbosity
  forceInterleavedThinkingCompat?: boolean
  imageGeneration?: ImageGenerationOptions
  videoGeneration?: VideoGenerationOptions
}

export interface AgentTapeInfo {
  sessionId: string
  entries: number
  anchors: number
  lastAnchor: string | null
  lastAnchorEntryId: number | null
  entriesSinceLastAnchor: number
  lastTokenUsage: number | null
  lastTokenCacheHitRate?: number | null
  lastCacheReadTokens?: number | null
  lastCacheWriteTokens?: number | null
  migrationState: 'none' | 'ready'
}

export type AgentTapeEntryKind = 'event' | 'anchor' | 'message' | 'tool_call' | 'tool_result'

export type AgentTapeViewScope = 'current' | 'linked_subagents' | 'current_and_linked'

export interface AgentTapeSearchOptions {
  limit?: number
  kinds?: AgentTapeEntryKind[]
  start?: string
  end?: string
  scope?: AgentTapeViewScope
}

export interface AgentTapeSearchResult {
  sessionId: string
  entryId: number
  kind: string
  name: string | null
  createdAt: number
  summary?: string
  refs?: Record<string, unknown>
  score?: number
}

export interface AgentTapeAnchorResult {
  sessionId: string
  entryId: number
  kind: string
  name: string | null
  payload: Record<string, unknown>
  meta: Record<string, unknown>
  createdAt: number
}

export type AgentTapeHandoffState = Record<string, unknown> & {
  summary: string
}

export interface AgentTapeAnchorsOptions {
  limit?: number
}

export interface AgentTapeContextOptions {
  before?: number
  after?: number
  limit?: number
  maxBytesPerEntry?: number
  maxTotalBytes?: number
  sourceSessionId?: string
}

export interface AgentTapeContextEntry {
  entryId: number
  kind: string
  name: string | null
  summary: string
  refs: Record<string, unknown>
  evidence: {
    text: string
    truncated: boolean
    bytes: number
  }
  createdAt: number
}

export interface AgentTapeContextResult {
  sessionId: string
  sourceSessionId: string
  requestedEntryIds: number[]
  matchedEntryIds: number[]
  entries: AgentTapeContextEntry[]
}

export type SubagentTapeLinkOutcome = 'completed' | 'error' | 'cancelled'

export interface SubagentTapeLinkInput {
  parentSessionId: string
  childSessionId: string
  runId: string
  taskId: string
  slotId: string
  taskTitle: string
  outcome: SubagentTapeLinkOutcome
  resultSummary: string | null
}

export interface SubagentTapeLinkReceipt {
  linkEntry: {
    sessionId: string
    entryId: number
  }
  childSessionId: string
  childHeadEntryId: number
  childEntryCount: number
  outcome: SubagentTapeLinkOutcome
}

export interface DeepChatSessionState {
  status: SessionStatus
  providerId: string
  modelId: string
  permissionMode: PermissionMode
}

export type PendingInputEnqueueSource = 'send' | 'queue'

export interface QueuePendingInputOptions {
  source?: PendingInputEnqueueSource
  projectDir?: string | null
  signal?: AbortSignal
}

export interface SessionAgentContextUpdate {
  agentId: string
  providerId: string
  modelId: string
  projectDir?: string | null
  permissionMode: PermissionMode
  generationSettings?: Partial<SessionGenerationSettings>
}

// ---- Message Types ----

export type UserMessageInlineItem =
  | {
      type: 'skill'
      offset: number
      skillName: string
    }
  | {
      type: 'file'
      offset: number
      fileName: string
      filePath: string
      mimeType?: string
    }

export interface UserMessageContent {
  text: string
  files: MessageFile[]
  links: string[]
  search: boolean
  think: boolean
  activeSkills?: string[]
  inlineItems?: UserMessageInlineItem[]
}

export interface LegacyImportStatus {
  status: 'idle' | 'running' | 'completed' | 'failed' | 'skipped'
  sourceDbPath: string
  startedAt: number | null
  finishedAt: number | null
  importedSessions: number
  importedMessages: number
  importedSearchResults: number
  error: string | null
  updatedAt: number
}

export interface MessageFile {
  name: string
  path: string
  type?: string
  size?: number
  content?: string
  mimeType?: string
  token?: number
  thumbnail?: string
  requestedRepresentation?: AttachmentRepresentationPreference
  resolvedRepresentation?: AttachmentResolvedRepresentation
  pdfTextCoverage?: PdfEmbeddedTextCoverage
  metadata?: {
    fileName?: string
    fileSize?: number
    fileDescription?: string
    fileCreated?: string
    fileModified?: string
    [key: string]: unknown
  }
}

export interface SendMessageInput {
  text: string
  files?: MessageFile[]
  search?: boolean
  activeSkills?: string[]
  inlineItems?: UserMessageInlineItem[]
  attachmentFallbackPolicy?: AttachmentFallbackPolicy
}

export type PendingSessionInputMode = 'queue' | 'steer'
export type PendingSessionInputState =
  | 'pending'
  | 'claimed'
  | 'blocked'
  | 'retry_required'
  | 'consumed'

export interface PendingSessionInputRecord {
  id: string
  sessionId: string
  mode: PendingSessionInputMode
  state: PendingSessionInputState
  payload: SendMessageInput
  messageIds: string[]
  assistantMessageId: string | null
  blocking: AttachmentPreparationSummary | null
  queueOrder: number | null
  claimedAt: number | null
  consumedAt: number | null
  createdAt: number
  updatedAt: number
}

export type AssistantBlockType =
  | 'content'
  | 'search'
  | 'reasoning_content'
  | 'plan'
  | 'error'
  | 'tool_call'
  | 'action'
  | 'image'

export interface ToolCallBlockData {
  id?: string
  name?: string
  params?: string
  response?: string
  rtkApplied?: boolean
  rtkMode?: 'rewrite' | 'direct' | 'bypass'
  rtkFallbackReason?: string
  imagePreviews?: ToolCallImagePreview[]
  server_name?: string
  server_icons?: string
  server_description?: string
  mcpResult?: PersistedMcpToolResult
}

export interface QuestionOption {
  label: string
  description?: string
}

export interface AssistantMessageExtra {
  needsUserAction?: boolean
  permissionType?: 'read' | 'write' | 'all' | 'command'
  grantedPermissions?: 'read' | 'write' | 'all' | 'command'
  toolName?: string
  toolSource?: 'agent' | 'mcp'
  serverName?: string
  providerId?: string
  permissionRequestId?: string
  permissionRequest?: string
  executionContractBinding?: string
  commandInfo?: string
  rememberable?: boolean
  questionHeader?: string
  questionText?: string
  questionOptions?: QuestionOption[] | string
  questionMultiple?: boolean
  questionCustom?: boolean
  questionResolution?: 'asked' | 'replied' | 'rejected'
  questionFollowUpPending?: boolean
  answerText?: string
  answerMessageId?: string
  skillDraftAction?: string
  skillDraftId?: string
  skillDraftName?: string
  skillDraftPreview?: string
  skillDraftStatus?: string
  skillDraftError?: string
  internalTool?: boolean
  plan_entries?: AgentPlanDisplayItem[]
  plan_explanation?: string
  plan_revision?: number
  plan_updated_at?: string
  plan_terminal_reason?: AgentPlanTerminalReason
  subagentProgress?: string
  subagentFinal?: string
  autoApproveReviewStatus?: 'reviewing'
  toolCallSkippedReason?: 'max_tool_calls' | 'max_tokens'
  toolCallIncompleteReason?: 'max_tokens'
  [key: string]: string | number | boolean | object[] | undefined
}

export interface AssistantMessageBlock {
  id?: string
  type: AssistantBlockType
  content?: string
  status: 'pending' | 'success' | 'error' | 'loading' | 'granted' | 'denied'
  timestamp: number
  reasoning_time?:
    | number
    | {
        start: number
        end: number
      }
  image_data?: {
    data: string
    mimeType: string
  }
  tool_call?: ToolCallBlockData
  extra?: AssistantMessageExtra
  action_type?: 'tool_call_permission' | 'question_request' | 'rate_limit'
}

export interface AgentNoProgressToolLoopMetadata {
  fingerprint: string
  repeatedBatchCount: number
  evidence: 'strong' | 'weak'
}

export interface MessageMetadata {
  runId?: string
  runOutcome?: 'completed' | 'paused' | 'aborted' | 'error'
  runStopReason?: string
  noProgressToolLoop?: AgentNoProgressToolLoopMetadata
  totalTokens?: number
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  cacheWriteInputTokens?: number
  providerRounds?: number
  maxProviderRounds?: number
  toolCalls?: number
  generationTime?: number
  firstTokenTime?: number
  reasoningStartTime?: number
  reasoningEndTime?: number
  tokensPerSecond?: number
  model?: string
  provider?: string
  messageType?: 'compaction' | 'workflow_result'
  compactionStatus?: 'compacting' | 'compacted'
  summaryUpdatedAt?: number | null
  workflowRunId?: string
  workflowResultDeliveryId?: string
  inputReceipt?: {
    mode: 'steer'
    readAt: number | null
  }
}

export interface ChatMessageRecord {
  id: string
  sessionId: string
  orderSeq: number
  role: 'user' | 'assistant'
  content: string // JSON string: UserMessageContent or AssistantMessageBlock[]
  status: 'pending' | 'sent' | 'error'
  isContextEdge: number
  metadata: string // JSON string: MessageMetadata
  traceCount?: number
  createdAt: number
  updatedAt: number
}

export interface MessagePageCursor {
  orderSeq: number
  id: string
}

export interface ChatMessagePageResult {
  messages: ChatMessageRecord[]
  nextCursor: MessagePageCursor | null
  hasMore: boolean
}

export interface MessageStartResult {
  requestId: string | null
  messageId: string | null
  userMessage?: ChatMessageRecord
  attachmentPreparation?: AttachmentPreparationSummary
}

export interface UsageStatsBackfillStatus {
  status: 'idle' | 'running' | 'completed' | 'failed'
  startedAt: number | null
  finishedAt: number | null
  error: string | null
  updatedAt: number
  processedCount?: number
  durationMs?: number
}

export interface UsageDashboardSummary {
  messageCount: number
  sessionCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
  cacheHitRate: number
  mostActiveDay: {
    date: string | null
    messageCount: number
  }
}

export interface UsageDashboardCalendarDay {
  date: string
  messageCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
  level: 0 | 1 | 2 | 3 | 4
}

export interface UsageDashboardBreakdownItem {
  id: string
  label: string
  messageCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
}

export type RtkHealthStatus = 'checking' | 'healthy' | 'unhealthy'
export type RtkRuntimeSource = 'bundled' | 'system' | 'none'
export type RtkFailureStage = 'resolve' | 'version' | 'rewrite' | 'smoke' | 'gain' | 'runtime'

export interface UsageDashboardRtkSummary {
  totalCommands: number
  totalInputTokens: number
  totalOutputTokens: number
  totalSavedTokens: number
  avgSavingsPct: number
  totalTimeMs: number
  avgTimeMs: number
}

export interface UsageDashboardRtkDay {
  date: string
  commands: number
  inputTokens: number
  outputTokens: number
  savedTokens: number
  savingsPct: number
  totalTimeMs: number
  avgTimeMs: number
}

export interface UsageDashboardRtkData {
  scope: 'deepchat'
  enabled: boolean
  effectiveEnabled: boolean
  available: boolean
  health: RtkHealthStatus
  checkedAt: number | null
  source: RtkRuntimeSource
  failureStage: RtkFailureStage | null
  failureMessage: string | null
  summary: UsageDashboardRtkSummary
  daily: UsageDashboardRtkDay[]
}

export interface UsageDashboardData {
  recordingStartedAt: number | null
  backfillStatus: UsageStatsBackfillStatus
  summary: UsageDashboardSummary
  calendar: UsageDashboardCalendarDay[]
  providerBreakdown: UsageDashboardBreakdownItem[]
  modelBreakdown: UsageDashboardBreakdownItem[]
  rtk: UsageDashboardRtkData
}

export interface MessageTraceRecord {
  id: string
  messageId: string
  sessionId: string
  providerId: string
  modelId: string
  requestSeq: number
  logicalRound: number | null
  physicalAttempt: number | null
  endpoint: string
  headersJson: string
  bodyJson: string
  truncated: boolean
  createdAt: number
}

// ---- Session / Agent Types ----

export type AgentType = 'deepchat' | 'acp'
export type AgentSource = 'builtin' | 'manual' | 'registry'

export interface AgentAvatarLucide {
  kind: 'lucide'
  icon: string
  lightColor?: string | null
  darkColor?: string | null
}

export interface AgentAvatarMonogram {
  kind: 'monogram'
  text: string
  backgroundColor?: string | null
}

export type AgentAvatar = AgentAvatarLucide | AgentAvatarMonogram

export interface DeepChatAgentModelSelection {
  providerId: string
  modelId: string
}

export interface DeepChatAgentModelPreset extends DeepChatAgentModelSelection {
  temperature?: number
  contextLength?: number
  maxTokens?: number
  thinkingBudget?: number
  reasoningEffort?: SessionGenerationSettings['reasoningEffort']
  verbosity?: SessionGenerationSettings['verbosity']
  forceInterleavedThinkingCompat?: boolean
}

export interface DeepChatSubagentSlot {
  id: string
  targetType: 'self' | 'agent'
  targetAgentId?: string
  displayName: string
  description: string
}

export type DeepChatSubagentCapability =
  | {
      available: true
      slots: DeepChatSubagentSlot[]
      cacheKey: string
    }
  | {
      available: false
      reason: 'policy_disabled' | 'unsupported_session' | 'no_valid_slots'
      cacheKey: string
    }

export type SessionKind = 'regular' | 'subagent'

export interface DeepChatSubagentMeta {
  slotId: string
  displayName: string
  targetAgentId?: string | null
  liveDelegation?: import('../orchestration/liveDelegation').LiveDelegationSubagentContext
}

export interface DeepChatAgentMemoryEmbedding {
  providerId: string
  modelId: string
}

export interface DeepChatAgentMemoryRetrieval {
  topK?: number
  rrfK?: number
  similarityThreshold?: number
  weights?: {
    similarity: number
    recency: number
    importance: number
  }
}

export interface DeepChatAgentConfig {
  defaultModelPreset?: DeepChatAgentModelPreset | null
  assistantModel?: DeepChatAgentModelSelection | null
  visionModel?: DeepChatAgentModelSelection | null
  imageGenerationModel?: DeepChatAgentModelSelection | null
  defaultProjectPath?: string | null
  systemPrompt?: string
  permissionMode?: PermissionMode
  disabledAgentTools?: string[]
  enabledSkillNames?: string[] | null
  enabledMcpServerIds?: string[] | null
  subagentEnabled?: boolean
  subagents?: DeepChatSubagentSlot[]
  autoCompactionEnabled?: boolean
  autoCompactionTriggerThreshold?: number
  autoCompactionRetainRecentPairs?: number
  readFileAutoTruncateChars?: number
  toolOutputInlineChars?: number
  commandOutputInlineChars?: number
  memoryEnabled?: boolean
  memoryEmbedding?: DeepChatAgentMemoryEmbedding | null
  memoryExtractionModel?: DeepChatAgentModelSelection | null
  memoryRetrieval?: DeepChatAgentMemoryRetrieval | null
  // Approximate token ceiling for the assembled memory injection (persona + working + recalled).
  memoryInjectionTokenBudget?: number | null
  // Opt-in, experimental guarded persona evolution. Independent of memoryEnabled and default false:
  // when off, reflection still runs but no persona draft is ever produced or injected.
  personaEvolutionEnabled?: boolean
}

export interface CreateDeepChatAgentInput {
  name: string
  enabled?: boolean
  description?: string
  icon?: string
  avatar?: AgentAvatar | null
  config?: DeepChatAgentConfig | null
}

export interface UpdateDeepChatAgentInput {
  name?: string
  enabled?: boolean
  description?: string
  icon?: string
  avatar?: AgentAvatar | null
  config?: DeepChatAgentConfig | null
}

export interface Agent {
  id: string
  name: string
  type: AgentType
  agentType?: AgentType
  enabled: boolean
  protected?: boolean
  icon?: string
  description?: string
  source?: AgentSource
  avatar?: AgentAvatar | null
  config?: DeepChatAgentConfig | null
  installState?: {
    status: 'not_installed' | 'installing' | 'installed' | 'error'
    distributionType?: 'binary' | 'npx' | 'uvx' | 'manual' | null
    version?: string | null
    installedAt?: number | null
    lastCheckedAt?: number | null
    installDir?: string | null
    error?: string | null
  } | null
}

export interface AgentBootstrapItem {
  id: string
  name: string
  type: AgentType
  agentType?: AgentType
  enabled: boolean
  protected?: boolean
  icon?: string
  description?: string
  source?: AgentSource
  avatar?: AgentAvatar | null
}

export interface SessionRecord {
  id: string
  agentId: string
  title: string
  projectDir: string | null
  isPinned: boolean
  isDraft?: boolean
  sessionKind: SessionKind
  parentSessionId?: string | null
  subagentMeta?: DeepChatSubagentMeta | null
  orchestrationPolicy: OrchestrationPolicy
  createdAt: number
  updatedAt: number
  /** Monotonic durable revision for ordering snapshots of one session. */
  revision?: number
  metadata?: SessionMetadata | null
}

export interface SessionListItem extends SessionRecord {
  status: SessionStatus
}

export interface SessionWithState extends SessionRecord {
  status: SessionStatus
  providerId: string
  modelId: string
}

export interface ActiveSessionSummary extends SessionWithState {}

export type AgentTransferBlockReason = 'active' | 'pending-input' | 'missing-session' | 'same-agent'

export interface AgentTransferImpactSample {
  id: string
  title: string
  sessionKind: SessionKind
  isDraft: boolean
  projectDir: string | null
  status: SessionStatus
  blockReason?: AgentTransferBlockReason
}

export interface AgentTransferImpact {
  agentId: string
  totalSessions: number
  regularSessions: number
  subagentSessions: number
  emptyDrafts: number
  movableSessions: number
  blockedSessions: number
  samples: AgentTransferImpactSample[]
}

export interface SessionPageCursor {
  updatedAt: number
  id: string
}

export interface SessionLightweightListResult {
  items: SessionListItem[]
  nextCursor: SessionPageCursor | null
  hasMore: boolean
}

export interface StartupBootstrapShell {
  startupRunId: string
  activeSessionId: string | null
  activeSession?: SessionListItem | null
  agents: AgentBootstrapItem[]
  defaultProjectPath: string | null
}

export type ToolInteractionResponse =
  | {
      kind: 'permission'
      granted: boolean
    }
  | {
      kind: 'question_option'
      optionLabel: string
    }
  | {
      kind: 'question_custom'
      answerText: string
    }
  | {
      kind: 'question_other'
    }

export interface ToolInteractionResult {
  resumed?: boolean
  waitingForUserMessage?: boolean
  handledInline?: boolean
}

export interface CreateSessionInput {
  agentId: string
  message: string
  files?: MessageFile[]
  search?: boolean
  inlineItems?: UserMessageInlineItem[]
  projectDir?: string | null
  providerId?: string
  modelId?: string
  permissionMode?: PermissionMode
  activeSkills?: string[]
  disabledAgentTools?: string[]
  orchestrationPolicy?: OrchestrationPolicy
  generationSettings?: Partial<SessionGenerationSettings>
}

export interface CreateDetachedSessionInput {
  agentId?: string
  title?: string
  projectDir?: string
  providerId?: string
  modelId?: string
  permissionMode?: PermissionMode
  activeSkills?: string[]
  disabledAgentTools?: string[]
  orchestrationPolicy?: OrchestrationPolicy
  generationSettings?: Partial<SessionGenerationSettings>
  metadata?: SessionMetadata | null
}

export type SessionMetadata =
  | {
      source: 'cron_job'
      cronJobId: string
      cronJobRunId: string
      scheduledAt: number
    }
  | {
      source: 'cli_run'
    }

// ---- Project Types ----

export type EnvironmentStatus = 'active' | 'archived' | 'removed'

export interface Project {
  path: string
  name: string
  icon: string | null
  lastAccessedAt: number
  exists: boolean
}

export interface EnvironmentSummary {
  path: string
  name: string
  sessionCount: number
  lastUsedAt: number
  isTemp: boolean
  exists: boolean
  status: EnvironmentStatus
  sortOrder: number
  archivedAt: number | null
  removedAt: number | null
}
