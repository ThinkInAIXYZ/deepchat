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
  contextLength: number
  maxTokens: number
  thinkingBudget?: number
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  verbosity?: 'low' | 'medium' | 'high'
  forceInterleavedThinkingCompat?: boolean
}

export interface DeepChatSessionState {
  status: SessionStatus
  providerId: string
  modelId: string
  permissionMode: PermissionMode
}

export interface IAgentImplementation {
  /** Initialize a new session for this agent */
  initSession(
    sessionId: string,
    config: {
      agentId?: string
      providerId: string
      modelId: string
      projectDir?: string | null
      permissionMode?: PermissionMode
      generationSettings?: Partial<SessionGenerationSettings>
    }
  ): Promise<void>

  /** Destroy a session and all its data */
  destroySession(sessionId: string): Promise<void>

  /** Get runtime state for a session */
  getSessionState(sessionId: string): Promise<DeepChatSessionState | null>

  /** Process a user message: persist, call LLM, stream response */
  processMessage(
    sessionId: string,
    content: string | SendMessageInput,
    context?: { projectDir?: string | null; emitRefreshBeforeStream?: boolean }
  ): Promise<void>

  /** Manage waiting lane inputs */
  listPendingInputs?(sessionId: string): Promise<PendingSessionInputRecord[]>
  queuePendingInput?(
    sessionId: string,
    content: string | SendMessageInput
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
  deletePendingInput?(sessionId: string, itemId: string): Promise<void>
  resumePendingQueue?(sessionId: string): Promise<void>

  /** Cancel an in-progress generation */
  cancelGeneration(sessionId: string): Promise<void>

  /** Get all messages for a session, ordered by order_seq */
  getMessages(sessionId: string): Promise<ChatMessageRecord[]>

  /** Get only message IDs for a session, ordered by order_seq */
  getMessageIds(sessionId: string): Promise<string[]>

  /** Get a single message by ID */
  getMessage(messageId: string): Promise<ChatMessageRecord | null>

  /** Get current runtime/persisted compaction state for the session */
  getSessionCompactionState?(sessionId: string): Promise<SessionCompactionState>

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
    fileCreated?: Date
    fileModified?: Date
    [key: string]: unknown
  }
}

export interface SendMessageInput {
  text: string
  files?: MessageFile[]
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
  action_type?: 'tool_call_permission' | 'question_request'
}

export interface MessageMetadata {
  totalTokens?: number
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
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

export interface DeepChatAgentConfig {
  defaultModelPreset?: DeepChatAgentModelPreset | null
  assistantModel?: DeepChatAgentModelSelection | null
  visionModel?: DeepChatAgentModelSelection | null
  defaultProjectPath?: string | null
  systemPrompt?: string
  permissionMode?: PermissionMode
  disabledAgentTools?: string[]
  autoCompactionEnabled?: boolean
  autoCompactionTriggerThreshold?: number
  autoCompactionRetainRecentPairs?: number
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

export interface SessionRecord {
  id: string
  agentId: string
  title: string
  projectDir: string | null
  isPinned: boolean
  isDraft?: boolean
  createdAt: number
  updatedAt: number
}

export interface SessionWithState extends SessionRecord {
  status: SessionStatus
  providerId: string
  modelId: string
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
}

export interface CreateSessionInput {
  agentId: string
  message: string
  files?: MessageFile[]
  projectDir?: string
  providerId?: string
  modelId?: string
  permissionMode?: PermissionMode
  activeSkills?: string[]
  disabledAgentTools?: string[]
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
  generationSettings?: Partial<SessionGenerationSettings>
}

// ---- Project Types ----

export interface Project {
  path: string
  name: string
  icon: string | null
  lastAccessedAt: number
}

export interface EnvironmentSummary {
  path: string
  name: string
  sessionCount: number
  lastUsedAt: number
  isTemp: boolean
  exists: boolean
}
