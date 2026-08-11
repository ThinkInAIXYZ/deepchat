import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type {
  SessionStatePort,
  SessionTapePort,
  SessionTranscriptMutationPort,
  SessionTranscriptReadPort
} from '@/session/data/contracts'
import type { AgentSessionSendInput } from '@/agent/shared/agentSessionHandle'
import type {
  AgentPendingInputFacet,
  AgentToolInteractionFacet
} from '@/agent/manager/sessionHandles'
import type {
  ResolvedAgentSession,
  ResolvedDeepChatTransferTarget,
  ResolvedSubagentFacet,
  ResolvedTransferSource
} from '@/agent/manager/agentManager'
import type {
  AgentTransferImpact,
  AttachmentFallbackPolicy,
  ChatMessageRecord,
  CreateDetachedSessionInput,
  CreateSessionInput,
  DeepChatAgentConfig,
  DeepChatSubagentMeta,
  DeepChatSessionState,
  MessageStartResult,
  PendingSessionInputRecord,
  PermissionMode,
  SendMessageInput,
  SessionCompactionState,
  SessionGenerationSettings,
  SessionKind,
  SessionLightweightListResult,
  SessionListItem,
  SessionPageCursor,
  SessionRecord,
  SessionWithState,
  SessionMetadata,
  SubagentTapeLinkInput,
  SubagentTapeLinkReceipt,
  ToolInteractionResponse,
  ToolInteractionResult
} from '@shared/types/agent-interface'
import type { OrchestrationPolicy } from '@shared/orchestration/policy'
import type { LiveDelegationSubagentContext } from '@shared/orchestration/liveDelegation'
import type { AcpConfigState } from '@shared/types/acp'
import type { AcpAsLlmProviderSessionControlPort } from '@/provider/ports'
import type { CommandShellProfile } from '@shared/commandShell'
import type { DeepChatMessageRow } from '../session/data/tables/deepchatMessages'
import type { DeepChatMessageSearchResultRow } from '../session/data/tables/deepchatMessageSearchResults'
import type { DeepChatMessageTraceRow } from '../session/data/tables/deepchatMessageTraces'

export type SessionPermissionRequest = {
  permissionType: 'read' | 'write' | 'all' | 'command'
  serverName?: string
  toolName?: string
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
  requestId?: string
}

export type SessionPermissionGrant =
  | Readonly<{
      kind: 'command'
      signature: string
      oneShotGrantId: string
    }>
  | Readonly<{ kind: 'granted' }>

export interface SessionPermissionPort {
  clearSessionPermissions(sessionId: string): void
  cloneSessionPermissions?(sourceSessionId: string, targetSessionId: string): void
  approvePermission(
    sessionId: string,
    permission: SessionPermissionRequest
  ): Promise<SessionPermissionGrant>
  revokeOneShotCommandPermission(sessionId: string, signature: string, oneShotGrantId: string): void
  denyPermission?(sessionId: string, requestId: string): Promise<void>
}

export interface SessionUiPort {
  refreshSessionUi(): void
}

export interface SessionProjectionStorePort {
  get(sessionId: string): SessionRecord | null
  getMany(sessionIds: string[]): SessionRecord[]
  list(filters?: SessionListFilters): SessionRecord[]
  listPage(options?: SessionLightweightOptions): {
    records: SessionRecord[]
    nextCursor: SessionPageCursor | null
    hasMore: boolean
  }
  update(sessionId: string, fields: Partial<Pick<SessionRecord, 'title' | 'isPinned'>>): void
}

export interface SessionProjectionRuntimePort {
  getAgentKind(agentId: string): 'deepchat' | 'acp'
  snapshot(
    sessionId: string,
    options?: { lightweight?: boolean }
  ): Promise<DeepChatSessionState | null>
  snapshotIfHydrated(sessionId: string): Promise<DeepChatSessionState | null>
  waitForFirstTurnReady(sessionId: string, options: { timeoutMs: number }): Promise<boolean>
}

export type SessionProjectionTranscriptPort = Pick<
  SessionTranscriptReadPort,
  'getMessages' | 'listMessagesPage' | 'getMessageIds' | 'getMessage'
>

export type SessionProjectionTapePort = Pick<
  SessionTapePort,
  | 'getTapeInfo'
  | 'searchTape'
  | 'getTapeContext'
  | 'listTapeAnchors'
  | 'handoffTape'
  | 'listMessageViewManifests'
  | 'exportMessageTapeReplaySlice'
>

export interface SessionProjectionMessageLookupPort {
  get(messageId: string): Pick<DeepChatMessageRow, 'session_id'> | null | undefined
}

export interface SessionProjectionSearchResultStorePort {
  listByMessageId(messageId: string): DeepChatMessageSearchResultRow[]
}

export interface SessionProjectionTraceStorePort {
  listByMessageId(messageId: string): DeepChatMessageTraceRow[]
  countByMessageId(messageId: string): number
}

export interface SessionProjectionTitlePort {
  summaryTitles(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    providerId: string,
    modelId: string
  ): Promise<string>
}

export interface SessionProjectionAgentConfigPort {
  getAssistantModel(
    agentId: string
  ): Promise<{ providerId?: string | null; modelId?: string | null } | null>
}

export type SessionProjectionEventReason =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'list-refreshed'
  | 'activated'
  | 'deactivated'

export interface SessionProjectionEventPort {
  publish(payload: {
    sessionIds: string[]
    reason: SessionProjectionEventReason
    activeSessionId?: string | null
    webContentsId?: number
  }): void
}

export interface SessionProjectionUiPort {
  refreshSessionUi(): void
}

export interface SessionListFilters {
  agentId?: string
  projectDir?: string
  includeSubagents?: boolean
  parentSessionId?: string
}

export interface SessionLightweightOptions {
  limit?: number
  cursor?: SessionPageCursor | null
  includeSubagents?: boolean
  agentId?: string
  prioritizeSessionId?: string
}

export interface SessionProjectionUpdate {
  sessionIds?: string[]
  reason?: SessionProjectionEventReason
  activeSessionId?: string | null
  webContentsId?: number
}

export interface TitleGenerationInput {
  sessionId: string
  initialTitle: string
  fallbackProviderId: string
  fallbackModelId: string
}

export interface SessionProjectionReadPort {
  getSession(sessionId: string): Promise<SessionWithState | null>
  listSessions(filters?: SessionListFilters): Promise<SessionWithState[]>
  listLightweight(options?: SessionLightweightOptions): Promise<SessionLightweightListResult>
  getLightweightByIds(sessionIds: string[]): Promise<SessionListItem[]>
}

export interface SessionProjectionMutationPort {
  materialize(sessionId: string): Promise<SessionWithState | null>
  notify(input?: SessionProjectionUpdate): void
  scheduleTitleGeneration(input: TitleGenerationInput): void
}

export interface SessionTurnStorePort {
  get(sessionId: string): SessionRecord | null
  update(sessionId: string, fields: Partial<Pick<SessionRecord, 'isDraft' | 'title'>>): void
}

interface SessionTurnRuntimeBase {
  readonly pending: AgentPendingInputFacet
  readonly toolInteractions: AgentToolInteractionFacet
  send(input: AgentSessionSendInput): Promise<MessageStartResult>
  cancel(): Promise<void>
  snapshot(): Promise<DeepChatSessionState | null>
}

export type SessionTurnRuntimeSession =
  | (SessionTurnRuntimeBase & {
      readonly kind: 'deepchat'
      readonly compaction: {
        getState(): Promise<SessionCompactionState>
        compact(): Promise<{ compacted: boolean; state: SessionCompactionState }>
      }
      isPendingQueueResumeAvailable(): Promise<boolean>
      resumePendingQueue(): Promise<boolean>
      retryPendingQueueInput(itemId: string): Promise<{ accepted: boolean; started: boolean }>
    })
  | (SessionTurnRuntimeBase & { readonly kind: 'acp' })

export interface SessionTurnRuntimePort {
  resolveSession(sessionId: AppSessionId): SessionTurnRuntimeSession
}

export type SessionTurnTranscriptPort = Pick<SessionTranscriptReadPort, 'hasMessages'> &
  Pick<
    SessionTranscriptMutationPort,
    | 'clearMessages'
    | 'prepareRetryMessage'
    | 'commitRetryMessage'
    | 'deleteMessage'
    | 'editUserMessage'
  >

export type SessionTurnProjectionPort = Pick<
  SessionProjectionMutationPort,
  'notify' | 'scheduleTitleGeneration'
>

export interface SessionInitialTurnInput {
  sessionId: string
  content: SendMessageInput
  projectDir: string | null
  initialTitle: string
  fallbackProviderId: string
  fallbackModelId: string
  signal?: AbortSignal
}

export interface SessionInitialTurnPort {
  startInitialTurn(input: SessionInitialTurnInput): Promise<MessageStartResult | undefined>
}

export interface SessionTurnPort {
  sendMessage(
    sessionId: string,
    content: string | SendMessageInput,
    options?: { maxProviderRounds?: number; signal?: AbortSignal }
  ): Promise<MessageStartResult>
  steerActiveTurn(
    sessionId: string,
    content: string | SendMessageInput,
    options?: { signal?: AbortSignal }
  ): Promise<MessageStartResult>
  listPendingInputs(sessionId: string): Promise<PendingSessionInputRecord[]>
  isPendingQueueResumeAvailable(sessionId: string): Promise<boolean>
  resumePendingQueue(sessionId: string): Promise<boolean>
  retryPendingQueueInput(
    sessionId: string,
    itemId: string
  ): Promise<{ accepted: boolean; started: boolean }>
  queuePendingInput(
    sessionId: string,
    content: string | SendMessageInput
  ): Promise<PendingSessionInputRecord>
  updateQueuedInput(
    sessionId: string,
    itemId: string,
    content: string | SendMessageInput
  ): Promise<PendingSessionInputRecord>
  moveQueuedInput(
    sessionId: string,
    itemId: string,
    toIndex: number
  ): Promise<PendingSessionInputRecord[]>
  convertPendingInputToSteer(sessionId: string, itemId: string): Promise<PendingSessionInputRecord>
  steerPendingInput(sessionId: string, itemId: string): Promise<PendingSessionInputRecord>
  resolveBlockedPendingInput(
    sessionId: string,
    itemId: string,
    action: 'retry' | 'send_without_image_content'
  ): Promise<PendingSessionInputRecord>
  deletePendingInput(sessionId: string, itemId: string): Promise<void>
  retryMessage(
    sessionId: string,
    messageId: string,
    options?: { attachmentFallbackPolicy?: AttachmentFallbackPolicy }
  ): Promise<MessageStartResult>
  deleteMessage(sessionId: string, messageId: string): Promise<void>
  editUserMessage(sessionId: string, messageId: string, text: string): Promise<ChatMessageRecord>
  getSessionCompactionState(sessionId: string): Promise<SessionCompactionState>
  compactSession(sessionId: string): Promise<{ compacted: boolean; state: SessionCompactionState }>
  clearSessionMessages(sessionId: string): Promise<void>
  cancelGeneration(sessionId: string): Promise<void>
  respondToolInteraction(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult>
}

export interface SessionAssignmentCatalogPort {
  resolveAgent(agentId: string): { id: string; kind: 'deepchat' | 'acp' }
}

export interface SessionAssignmentConfigPort {
  getDefaultModel(): { providerId: string; modelId: string } | null | undefined
  getDefaultProjectPath(): string | null
  resolveDeepChatAgentConfig(agentId: string): Promise<DeepChatAgentConfig | null>
}

export interface CreateAssignmentInput {
  agentId: string
  providerId?: string
  modelId?: string
  projectDir?: string | null
  permissionMode?: PermissionMode
  generationSettings?: Partial<SessionGenerationSettings>
  disabledAgentTools?: string[]
  preserveExplicitNullProjectDir: boolean
}

export interface ResolvedSessionAssignment {
  agentId: string
  agentType: 'deepchat' | 'acp'
  providerId: string
  modelId: string
  projectDir: string | null
  permissionMode: PermissionMode
  generationSettings?: Partial<SessionGenerationSettings>
  disabledAgentTools: string[]
}

export interface SubagentAssignmentInput {
  agentId: string
  parentAgentId?: string | null
  targetAgentId?: string | null
  projectDir: string | null
  providerId: string
  modelId: string
  permissionMode?: PermissionMode
  generationSettings?: Partial<SessionGenerationSettings>
  disabledAgentTools?: string[]
  activeSkills?: string[]
}

export interface ResolvedSubagentAssignment {
  agentId: string
  targetAgentId: string | null
  providerId: string
  modelId: string
  permissionMode: PermissionMode
  generationSettings?: Partial<SessionGenerationSettings>
  disabledAgentTools: string[]
  activeSkills: string[]
}

export interface ResolvedTransferTarget {
  agentId: string
  providerId: string
  modelId: string
  projectDir: string | null
  permissionMode: PermissionMode
  generationSettings?: Partial<SessionGenerationSettings>
  disabledAgentTools: string[]
}

export interface SessionAssignmentPolicyPort {
  resolveCreateAssignment(input: CreateAssignmentInput): Promise<ResolvedSessionAssignment>
  resolveAcpDraftAssignment(
    agentId: string,
    permissionMode?: PermissionMode
  ): { agentId: string; permissionMode: PermissionMode }
  resolveSubagentAssignment(input: SubagentAssignmentInput): Promise<ResolvedSubagentAssignment>
  resolveTransferTarget(
    targetAgentId: string,
    currentProjectDir: string | null
  ): Promise<ResolvedTransferTarget>
  assertAcpSessionHasWorkdir(providerId: string, projectDir: string | null): void
}

export interface SessionAssignmentStorePort {
  get(sessionId: string): SessionRecord | null
  list(filters?: SessionListFilters): SessionRecord[]
  update(
    sessionId: string,
    fields: Partial<Pick<SessionRecord, 'projectDir' | 'orchestrationPolicy'>>
  ): void
  updateAgentId(sessionId: string, agentId: string): void
  getDisabledAgentTools(sessionId: string): string[]
  updateDisabledAgentTools(sessionId: string, disabledAgentTools: string[]): void
  getOrchestrationPolicy(sessionId: string): OrchestrationPolicy
  updateOrchestrationPolicy(sessionId: string, policy: OrchestrationPolicy): void
}

export interface SessionAssignmentRuntimePort {
  getSessionAgentKind(sessionId: AppSessionId): 'deepchat' | 'acp'
  resolveSession(sessionId: AppSessionId): ResolvedAgentSession
  resolveTransferSource(sessionId: AppSessionId): ResolvedTransferSource
  resolveDeepChatTransferTarget(agentId: string): ResolvedDeepChatTransferTarget
  resolveSubagentFacet(sessionId: AppSessionId): ResolvedSubagentFacet
}

export interface SessionAssignmentEnvironmentPort {
  syncPath(projectDir: string): void
}

export type SessionAssignmentProjectionPort = Pick<
  SessionProjectionMutationPort,
  'materialize' | 'notify'
>

export interface SessionLifecycleDeletionPort {
  deleteSessionTree(sessionId: string): Promise<string[]>
}

export interface SessionAssignmentWorkdirPort {
  runWithSessionOperationGate<T>(sessionId: string, operation: () => Promise<T>): Promise<T>
  assertAcpSessionHasWorkdir(providerId: string, projectDir: string | null): void
  syncAcpSessionWorkdir(
    providerId: string,
    sessionId: string,
    agentId: string,
    projectDir?: string | null
  ): Promise<void>
  prepareDirectAcpSession(sessionId: string): Promise<void>
  clearCompatibilityAcpSession(sessionId: string): Promise<void>
}

export interface SessionLifecycleStorePort {
  create(
    agentId: string,
    title: string,
    projectDir: string | null,
    options?: {
      isDraft?: boolean
      disabledAgentTools?: string[]
      orchestrationPolicy?: OrchestrationPolicy
      sessionKind?: SessionKind
      parentSessionId?: string | null
      subagentMeta?: DeepChatSubagentMeta | null
      metadata?: SessionMetadata | null
    }
  ): AppSessionId
  get(sessionId: string): SessionRecord | null
  getDisabledAgentTools(sessionId: string): string[]
  list(filters?: SessionListFilters): SessionRecord[]
  delete(sessionId: string): void
}

export interface SessionLifecycleRuntimeConfig {
  agentId?: string
  providerId: string
  modelId: string
  projectDir?: string | null
  permissionMode: PermissionMode
  generationSettings?: Partial<SessionGenerationSettings>
}

export interface SessionLifecycleRuntimeSession {
  readonly kind: 'deepchat' | 'acp'
  initialize(config: SessionLifecycleRuntimeConfig): Promise<void>
  isInitialized(): Promise<boolean>
  snapshot(): Promise<DeepChatSessionState | null>
  getGenerationSettings(): Promise<SessionGenerationSettings | null>
  setPermissionMode(mode: PermissionMode): Promise<void>
  close(): Promise<void>
}

export interface SessionLifecycleRuntimePort {
  resolveSession(sessionId: AppSessionId): SessionLifecycleRuntimeSession
}

export type SessionLifecycleTranscriptPort = Pick<SessionTranscriptReadPort, 'hasMessages'> &
  Pick<SessionTranscriptMutationPort, 'forkSessionFromMessage'>

export interface SessionLifecycleSkillPort {
  setActiveSkills(sessionId: string, activeSkills: string[]): Promise<void>
}

export type SessionLifecycleProjectionPort = Pick<SessionProjectionMutationPort, 'notify'> & {
  materializeRequired(sessionId: string): Promise<SessionWithState>
}

export interface SessionLifecycleDesktopPort {
  bind(webContentsId: number, sessionId: string): void
  unbind(webContentsId: number): void
  getActiveId(webContentsId: number): string | null
}

export interface SessionLifecycleSubagentInput {
  parentSessionId: string
  agentId: string
  parentAgentId?: string | null
  slotId: string
  displayName: string
  targetAgentId?: string | null
  projectDir?: string | null
  providerId: string
  modelId: string
  permissionMode: PermissionMode
  generationSettings?: Partial<SessionGenerationSettings>
  disabledAgentTools?: string[]
  activeSkills?: string[]
  liveDelegationContext?: LiveDelegationSubagentContext
}

export interface SessionLifecyclePort {
  createSession(
    input: CreateSessionInput,
    webContentsId: number,
    options?: { signal?: AbortSignal }
  ): Promise<SessionWithState & { initialTurn?: MessageStartResult }>
  createDetachedSession(input: CreateDetachedSessionInput): Promise<SessionWithState>
  createSubagentSession(input: SessionLifecycleSubagentInput): Promise<SessionWithState>
  ensureAcpDraftSession(input: {
    agentId: string
    projectDir: string
    permissionMode?: PermissionMode
  }): Promise<SessionWithState>
  forkSession(
    sourceSessionId: string,
    targetMessageId: string,
    newTitle?: string
  ): Promise<SessionWithState>
  deleteSession(sessionId: string): Promise<void>
}

export interface SessionAgentAssignmentPort {
  linkSubagentTape(input: SubagentTapeLinkInput): Promise<SubagentTapeLinkReceipt>
  getAgentTransferImpact(agentId: string): Promise<AgentTransferImpact>
  moveAgentSessions(
    fromAgentId: string,
    toAgentId: string
  ): Promise<{ movedSessionIds: string[]; deletedSessionIds: string[] }>
  deleteAgentSessions(agentId: string): Promise<string[]>
  moveSessionToAgent(sessionId: string, toAgentId: string): Promise<SessionWithState>
  getAcpSessionCommands(sessionId: string): Promise<
    Array<{
      name: string
      description: string
      input?: { hint: string } | null
    }>
  >
  getAcpSessionConfigOptions(sessionId: string): Promise<AcpConfigState | null>
  setAcpSessionConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean
  ): Promise<AcpConfigState | null>
  getPermissionMode(sessionId: string): Promise<PermissionMode>
  setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void>
  setSessionModel(sessionId: string, providerId: string, modelId: string): Promise<SessionWithState>
  setSessionProjectDir(sessionId: string, projectDir: string | null): Promise<SessionWithState>
  getSessionGenerationSettings(sessionId: string): Promise<SessionGenerationSettings | null>
  getSessionDisabledAgentTools(sessionId: string): Promise<string[]>
  getOrchestrationPolicy(sessionId: string): Promise<OrchestrationPolicy>
  updateOrchestrationPolicy(
    sessionId: string,
    policy: OrchestrationPolicy
  ): Promise<OrchestrationPolicy>
  updateSessionDisabledAgentTools(
    sessionId: string,
    disabledAgentTools: string[]
  ): Promise<string[]>
  updateSessionGenerationSettings(
    sessionId: string,
    settings: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings>
}

export interface SessionDeletionStorePort {
  get(sessionId: string): SessionRecord | null
  list(filters?: SessionListFilters): SessionRecord[]
  delete(sessionId: string): void
}

export interface SessionDeletionRuntimePort {
  cleanupSessionBackends(sessionId: AppSessionId): Promise<void>
  destroySessionBrowser(sessionId: AppSessionId): Promise<void>
}

export interface SessionDeletionOrchestrationPort {
  prepareSessionDeletion(sessionId: string): Promise<void>
}

export type SessionDeletionStatePort = Pick<SessionStatePort, 'destroySession'>

export interface SessionDeletionPermissionPort {
  clearSessionPermissions(sessionId: string): void
}

export interface SessionLifecyclePermissionPort {
  clearSessionPermissions(sessionId: string): void
  cloneSessionPermissions?(sourceSessionId: string, targetSessionId: string): void
}

export interface SessionDeletionSkillPort {
  clearNewAgentSessionSkills(sessionId: string): Promise<void>
}

export type SessionAssignmentAcpControlPort = AcpAsLlmProviderSessionControlPort
