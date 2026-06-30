import type { ReasoningEffort, ReasoningVisibility, Verbosity } from './model-db'
import type { ImageGenerationOptions } from '../imageGenerationSettings'
import type { VideoGenerationOptions } from '../videoGenerationSettings'
import type { ToolCallImagePreview } from './core/mcp'
import type { AgentPlanDisplayItem, AgentPlanTerminalReason } from './agent-plan'
import type { DeepChatTapeViewManifestRecord } from './tape-view-manifest'
import type { DeepChatTapeReplayExportOptions, DeepChatTapeReplaySlice } from './tape-replay'

/**
 * Agent Interface Protocol
 *
 * The unified contract every agent implementation must satisfy.
 * v2: multi-turn chat with MCP tool calling, no permission checks.
 */

export type SessionStatus = 'idle' | 'generating' | 'error'
export type PermissionMode = 'default' | 'full_access'
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
  migrationState: 'none' | 'ready'
}

export type AgentTapeEntryKind = 'event' | 'anchor' | 'message' | 'tool_call' | 'tool_result'

export interface AgentTapeSearchOptions {
  limit?: number
  kinds?: AgentTapeEntryKind[]
  start?: string
  end?: string
}

export interface AgentTapeSearchResult {
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

export interface AgentTapeAnchorsOptions {
  limit?: number
}

export interface AgentTapeContextOptions {
  before?: number
  after?: number
  limit?: number
  maxBytesPerEntry?: number
  maxTotalBytes?: number
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
  requestedEntryIds: number[]
  matchedEntryIds: number[]
  entries: AgentTapeContextEntry[]
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
}

export interface SessionAgentContextUpdate {
  agentId: string
  providerId: string
  modelId: string
  projectDir?: string | null
  permissionMode?: PermissionMode
  generationSettings?: Partial<SessionGenerationSettings>
}

export interface IAgentImplementation {
  /** Initialize a new session for this agent */
  initSession(
    sessionId: string,
    config: Partial<SessionAgentContextUpdate> &
      Pick<SessionAgentContextUpdate, 'providerId' | 'modelId'>
  ): Promise<void>

  /** Update the persisted runtime context for a session without deleting its messages */
  setSessionAgentContext?(sessionId: string, config: SessionAgentContextUpdate): Promise<void>

  /** Destroy a session and all its data */
  destroySession(sessionId: string): Promise<void>

  /** Get runtime state for a session */
  getSessionState(sessionId: string): Promise<DeepChatSessionState | null>

  /** Get lightweight runtime state for session list hydration */
  getSessionListState?(sessionId: string): Promise<DeepChatSessionState | null>

  /** Wait until the first provider round has been persisted for title generation */
  waitForFirstTurnReady?(sessionId: string, options?: { timeoutMs?: number }): Promise<boolean>

  /** Process a user message: persist, call LLM, stream response */
  processMessage(
    sessionId: string,
    content: string | SendMessageInput,
    context?: {
      projectDir?: string | null
      emitRefreshBeforeStream?: boolean
      pendingQueueItemId?: string
      pendingQueueItemSource?: PendingInputEnqueueSource
    }
  ): Promise<MessageStartResult>

  /** Steer an active turn, or start a normal turn if the session is idle */
  steerActiveTurn?(sessionId: string, content: string | SendMessageInput): Promise<void>

  /** Manage waiting lane inputs */
  listPendingInputs?(sessionId: string): Promise<PendingSessionInputRecord[]>
  queuePendingInput?(
    sessionId: string,
    content: string | SendMessageInput,
    options?: QueuePendingInputOptions
  ): Promise<PendingSessionInputRecord>
  updateQueuedInput?(
    sessionId: string,
    itemId: string,
    content: string | SendMessageInput
  ): Promise<PendingSessionInputRecord>
  moveQueuedInput?(
    sessionId: string,
    itemId: string,
    toIndex: number
  ): Promise<PendingSessionInputRecord[]>
  convertPendingInputToSteer?(sessionId: string, itemId: string): Promise<PendingSessionInputRecord>
  /** Promote a queued input to steer and interrupt the active turn so it runs next */
  steerPendingInput?(sessionId: string, itemId: string): Promise<PendingSessionInputRecord>
  deletePendingInput?(sessionId: string, itemId: string): Promise<void>

  /** Cancel an in-progress generation */
  cancelGeneration(sessionId: string): Promise<void>

  /** Get all messages for a session, ordered by order_seq */
  getMessages(sessionId: string): Promise<ChatMessageRecord[]>

  /** Get a page of messages for a session, ordered by order_seq ASC */
  listMessagesPage?(
    sessionId: string,
    options?: {
      limit?: number
      cursor?: MessagePageCursor | null
    }
  ): Promise<ChatMessagePageResult>

  /** Get only message IDs for a session, ordered by order_seq */
  getMessageIds(sessionId: string): Promise<string[]>

  /** Get a single message by ID */
  getMessage(messageId: string): Promise<ChatMessageRecord | null>

  /** Get current runtime/persisted compaction state for the session */
  getSessionCompactionState?(sessionId: string): Promise<SessionCompactionState>

  /** Manually compact old conversation context without threshold checks */
  compactSession?(sessionId: string): Promise<{ compacted: boolean; state: SessionCompactionState }>

  /** Inspect the append-only tape for this session */
  getTapeInfo?(sessionId: string): Promise<AgentTapeInfo>

  /** Search append-only tape entries for this session */
  searchTape?(
    sessionId: string,
    query: string,
    options?: AgentTapeSearchOptions
  ): Promise<AgentTapeSearchResult[]>

  getTapeContext?(
    sessionId: string,
    entryIds: number[],
    options?: AgentTapeContextOptions
  ): Promise<AgentTapeContextResult>

  /** List recent anchors for this session tape */
  listTapeAnchors?(
    sessionId: string,
    options?: AgentTapeAnchorsOptions
  ): Promise<AgentTapeAnchorResult[]>

  /** Write a handoff anchor to this session tape */
  handoffTape?(
    sessionId: string,
    name: string,
    state?: Record<string, unknown>
  ): Promise<AgentTapeAnchorResult>

  /** List prompt view manifests associated with a message */
  listMessageViewManifests?(
    sessionId: string,
    messageId: string
  ): Promise<DeepChatTapeViewManifestRecord[]>

  /** Export a deterministic tape replay slice for a message request */
  exportMessageTapeReplaySlice?(
    sessionId: string,
    messageId: string,
    options?: DeepChatTapeReplayExportOptions
  ): Promise<DeepChatTapeReplaySlice | null>

  /** Record a completed child session as a merged tape fork */
  mergeSubagentTape?(
    parentSessionId: string,
    childSessionId: string,
    meta?: Record<string, unknown>
  ): Promise<void>

  /** Record an abandoned child session as a discarded tape fork */
  discardSubagentTape?(
    parentSessionId: string,
    childSessionId: string,
    meta?: Record<string, unknown>
  ): Promise<void>

  /** Clear all messages in this session while keeping the session record */
  clearMessages?(sessionId: string): Promise<void>

  /** Retry generation from the selected message context */
  retryMessage?(sessionId: string, messageId: string): Promise<void>

  /** Delete a message and following history in this session */
  deleteMessage?(sessionId: string, messageId: string): Promise<void>

  /** Edit the text part of a user message */
  editUserMessage?(sessionId: string, messageId: string, text: string): Promise<ChatMessageRecord>

  /** Copy sent history up to target message into another session */
  forkSessionFromMessage?(
    sourceSessionId: string,
    targetSessionId: string,
    targetMessageId: string
  ): Promise<void>

  /** Handle pending tool interaction response (question/permission) */
  respondToolInteraction?(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult>

  /** Set permission mode for this session */
  setPermissionMode?(sessionId: string, mode: PermissionMode): Promise<void>

  /** Set provider/model for this session (takes effect on next user message) */
  setSessionModel?(sessionId: string, providerId: string, modelId: string): Promise<void>

  /** Set project/workspace directory for this session (takes effect on next user message) */
  setSessionProjectDir?(sessionId: string, projectDir: string | null): Promise<void>

  /** Get permission mode for this session */
  getPermissionMode?(sessionId: string): Promise<PermissionMode>

  /** Get generation settings for this session */
  getGenerationSettings?(sessionId: string): Promise<SessionGenerationSettings | null>

  /** Update generation settings for this session */
  updateGenerationSettings?(
    sessionId: string,
    settings: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings>
}

// ---- Message Types ----

export interface UserMessageContent {
  text: string
  files: MessageFile[]
  links: string[]
  search: boolean
  think: boolean
  activeSkills?: string[]
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
  activeSkills?: string[]
}

export type PendingSessionInputMode = 'queue' | 'steer'
export type PendingSessionInputState = 'pending' | 'claimed' | 'consumed'

export interface PendingSessionInputRecord {
  id: string
  sessionId: string
  mode: PendingSessionInputMode
  state: PendingSessionInputState
  payload: SendMessageInput
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
  serverName?: string
  providerId?: string
  permissionRequestId?: string
  permissionRequest?: string
  commandInfo?: string
  rememberable?: boolean
  questionHeader?: string
  questionText?: string
  questionOptions?: QuestionOption[] | string
  questionMultiple?: boolean
  questionCustom?: boolean
  questionResolution?: 'asked' | 'replied' | 'rejected'
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

export interface MessageMetadata {
  totalTokens?: number
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  cacheWriteInputTokens?: number
  generationTime?: number
  firstTokenTime?: number
  reasoningStartTime?: number
  reasoningEndTime?: number
  tokensPerSecond?: number
  model?: string
  provider?: string
  messageType?: 'compaction'
  compactionStatus?: 'compacting' | 'compacted'
  summaryUpdatedAt?: number | null
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
}

export interface UsageStatsBackfillStatus {
  status: 'idle' | 'running' | 'completed' | 'failed'
  startedAt: number | null
  finishedAt: number | null
  error: string | null
  updatedAt: number
}

export interface UsageDashboardSummary {
  messageCount: number
  sessionCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
  cacheHitRate: number
  estimatedCostUsd: number | null
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
  estimatedCostUsd: number | null
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
  estimatedCostUsd: number | null
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

export type SessionKind = 'regular' | 'subagent'

export interface DeepChatSubagentMeta {
  slotId: string
  displayName: string
  targetAgentId?: string | null
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
  enabledPluginIds?: string[] | null
  enabledSkillNames?: string[] | null
  enabledMcpServerIds?: string[] | null
  subagentEnabled?: boolean
  subagents?: DeepChatSubagentSlot[]
  autoCompactionEnabled?: boolean
  autoCompactionTriggerThreshold?: number
  autoCompactionRetainRecentPairs?: number
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
  subagentEnabled: boolean
  subagentMeta?: DeepChatSubagentMeta | null
  createdAt: number
  updatedAt: number
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
  projectDir?: string | null
  providerId?: string
  modelId?: string
  permissionMode?: PermissionMode
  activeSkills?: string[]
  disabledAgentTools?: string[]
  subagentEnabled?: boolean
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
  subagentEnabled?: boolean
  generationSettings?: Partial<SessionGenerationSettings>
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
