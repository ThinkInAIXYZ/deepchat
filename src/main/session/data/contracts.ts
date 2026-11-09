import type {
  AssistantMessageBlock,
  AttachmentPreparationSummary,
  MessageMetadata,
  MessageTraceRecord,
  SessionCompactionBoundaryReason,
  UserMessageContent
} from '@shared/types/agent-interface'
import type { SearchResult } from '@shared/types/core/search'
import type { TapeProjectionCursor } from '@/tape/ports/capabilities'
import type { DeepChatTapeEntryRow } from '@/tape/domain/entry'
import type { TapeCompactionModelCallInput } from '@/tape/domain/compactionUsage'
import type { SessionKind } from '@shared/types/agent-interface'
import type { OrchestrationPolicy } from '@shared/orchestration/policy'
import type { ToolModeOverride } from '@shared/toolMode'
import type {
  AgentTapeAnchorResult,
  AgentTapeAnchorsOptions,
  AgentTapeContextOptions,
  AgentTapeContextResult,
  AgentTapeHandoffState,
  AgentTapeInfo,
  AgentTapeSearchOptions,
  AgentTapeSearchResult,
  ChatMessagePageResult,
  ChatMessageRecord,
  DeepChatSessionState,
  MessagePageCursor,
  PendingSessionInputRecord,
  PendingSessionInputState,
  PermissionMode,
  SendMessageInput,
  SessionAgentContextUpdate,
  SessionGenerationSettings,
  SubagentTapeLinkInput,
  SubagentTapeLinkReceipt,
  UserMessageInlineItem
} from '@shared/types/agent-interface'
import type { DeepChatTapeViewManifestRecord } from '@shared/types/tape-view-manifest'
import type { DeepChatNestedExecutionAudit } from '@shared/types/execution-journal-audit'
import type {
  ExportTapeInspectorSupportFactsInput,
  ExportTapeInspectorSupportFactsOutput,
  GetTapeInspectorRecordDetailInput,
  GetTapeInspectorRecordDetailOutput,
  ListTapeInspectorPageInput,
  ListTapeInspectorPageOutput,
  ResolveTapeInspectorEvidenceEntriesInput,
  ResolveTapeInspectorEvidenceEntriesOutput
} from '@shared/types/tape-inspector'

export interface SessionStatePort {
  initSession(
    sessionId: string,
    config: Partial<SessionAgentContextUpdate> &
      Pick<SessionAgentContextUpdate, 'providerId' | 'modelId'>
  ): Promise<void>
  destroySession(sessionId: string): Promise<void>
  getSessionState(sessionId: string): Promise<DeepChatSessionState | null>
  getSessionListState(sessionId: string): Promise<DeepChatSessionState | null>
  getPermissionMode(sessionId: string): Promise<PermissionMode>
  setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void>
  getGenerationSettings(sessionId: string): Promise<SessionGenerationSettings | null>
  updateGenerationSettings(
    sessionId: string,
    settings: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings>
  setSessionProjectDir(sessionId: string, projectDir: string | null): Promise<void>
}

export interface SessionTranscriptReadPort {
  getMessages(sessionId: string): ChatMessageRecord[] | Promise<ChatMessageRecord[]>
  hasMessages(sessionId: string): boolean | Promise<boolean>
  listMessagesPage(
    sessionId: string,
    options?: { limit?: number; cursor?: MessagePageCursor | null }
  ): ChatMessagePageResult | Promise<ChatMessagePageResult>
  getMessageIds(sessionId: string): string[] | Promise<string[]>
  getMessage(messageId: string): ChatMessageRecord | null | Promise<ChatMessageRecord | null>
}

export interface SessionTranscriptMutationPort {
  clearMessages(sessionId: string): Promise<void>
  prepareRetryMessage(
    sessionId: string,
    messageId: string
  ): Promise<{
    content: SendMessageInput
    projectDir: string | null
    sourceOrderSeq: number
    retryFromOrderSeq: number
    sourceMessageId: string | null
    reuseUserMessage?: { messageId: string; orderSeq: number; createdAt: number }
  }>
  commitRetryMessage(sessionId: string, orderSeq: number): void | Promise<void>
  deleteMessage(sessionId: string, messageId: string): Promise<void>
  editUserMessage(
    sessionId: string,
    messageId: string,
    text: string,
    inlineItems?: UserMessageInlineItem[]
  ): Promise<ChatMessageRecord>
  forkSessionFromMessage(
    sourceSessionId: string,
    targetSessionId: string,
    targetMessageId: string
  ): Promise<void>
}

export interface SessionPendingInputRuntimePort {
  listPendingInputs(sessionId: string): PendingSessionInputRecord[]
  queuePendingInput(
    sessionId: string,
    input: string | SendMessageInput,
    options?: { state?: PendingSessionInputState }
  ): PendingSessionInputRecord
  acceptSteerMessage(
    sessionId: string,
    input: SendMessageInput,
    options?: {
      mergeItemId?: string | null
      preStreamAnchorMessageId?: string | null
    }
  ): {
    pendingInput: PendingSessionInputRecord
    message: ChatMessageRecord
    sourceMessage?: ChatMessageRecord
  }
  promoteQueuedInputToSteerMessage(
    sessionId: string,
    itemId: string,
    options?: { preStreamAnchorMessageId?: string | null }
  ): {
    pendingInput: PendingSessionInputRecord
    message: ChatMessageRecord
    sourceMessage?: ChatMessageRecord
  }
  updateQueuedInput(
    sessionId: string,
    itemId: string,
    input: string | SendMessageInput
  ): PendingSessionInputRecord
  moveQueuedInput(sessionId: string, itemId: string, toIndex: number): PendingSessionInputRecord[]
  deletePendingInput(sessionId: string, itemId: string): void
  getNextQueuedInput(sessionId: string): PendingSessionInputRecord | null
  getNextSteerInput(sessionId: string): PendingSessionInputRecord | null
  claimQueuedInput(sessionId: string, itemId: string): PendingSessionInputRecord
  claimSteerInput(
    sessionId: string,
    itemId: string,
    options?: { activeAssistantMessageId: string }
  ): PendingSessionInputRecord
  settleSteerInputReceipt(
    sessionId: string,
    itemId: string,
    delivery: 'applied' | 'failed' | 'unknown'
  ): void
  releaseClaimedInput(sessionId: string, itemId: string): PendingSessionInputRecord
  consumeQueuedInput(sessionId: string, itemId: string): void
  consumeSteerInput(sessionId: string, itemId: string): void
  hasPendingTurnInput(sessionId: string): boolean
}

export interface SessionTapePort {
  getTapeInfo(sessionId: string): Promise<AgentTapeInfo>
  searchTape(
    sessionId: string,
    query: string,
    options?: AgentTapeSearchOptions
  ): Promise<AgentTapeSearchResult[]>
  getTapeContext(
    sessionId: string,
    entryIds: number[],
    options?: AgentTapeContextOptions
  ): Promise<AgentTapeContextResult>
  listTapeAnchors(
    sessionId: string,
    options?: AgentTapeAnchorsOptions
  ): Promise<AgentTapeAnchorResult[]>
  handoffTape(
    sessionId: string,
    name: string,
    state: AgentTapeHandoffState
  ): Promise<AgentTapeAnchorResult>
  listMessageViewManifests(
    sessionId: string,
    messageId: string
  ): Promise<DeepChatTapeViewManifestRecord[]>
  listNestedExecutionAuditForMessage(
    sessionId: string,
    messageId: string
  ): Promise<DeepChatNestedExecutionAudit>
  listTapeInspectorPage(input: ListTapeInspectorPageInput): ListTapeInspectorPageOutput
  resolveTapeInspectorEvidenceEntries(
    input: ResolveTapeInspectorEvidenceEntriesInput
  ): ResolveTapeInspectorEvidenceEntriesOutput
  getTapeInspectorRecordDetail(
    input: GetTapeInspectorRecordDetailInput
  ): GetTapeInspectorRecordDetailOutput
  exportTapeInspectorSupportFacts(
    input: ExportTapeInspectorSupportFactsInput
  ): ExportTapeInspectorSupportFactsOutput
  linkSubagentTape(input: SubagentTapeLinkInput): Promise<SubagentTapeLinkReceipt>
}

export interface SessionResourceReadPort {
  getIdentity(sessionId: string): {
    agentId: string | undefined
    parentSessionId: string | undefined
    kind: SessionKind | null
    projectDir: string | null
  } | null
  getOrchestrationPolicy(sessionId: string): OrchestrationPolicy
  getToolModeOverride(sessionId: string): ToolModeOverride
  getDisabledAgentTools(sessionId: string): string[]
}

export type PersistedSessionGenerationRow = {
  provider_id: string
  model_id: string
  permission_mode: PermissionMode
  system_prompt: string | null
  temperature: number | null
  top_p: number | null
  context_length: number | null
  max_tokens: number | null
  timeout_ms: number | null
  thinking_budget: number | null
  reasoning_effort: SessionGenerationSettings['reasoningEffort'] | null
  reasoning_visibility: SessionGenerationSettings['reasoningVisibility'] | null
  verbosity: SessionGenerationSettings['verbosity'] | null
  force_interleaved_thinking_compat: number | null
  image_generation_options_json: string | null
  video_generation_options_json: string | null
}

export type SessionSummaryState = {
  summaryText: string | null
  summaryCursorOrderSeq: number
  summaryUpdatedAt: number | null
}

export type ReconstructionAnchorPromptState = {
  entryId: number
  name: string
  state: Record<string, unknown>
  createdAt: number
}

export type SummaryStateCompareAndSetResult = {
  applied: boolean
  currentState: SessionSummaryState
}

export type SummaryTapeAnchorInput = {
  name: string
  state: Record<string, unknown>
  meta?: Record<string, unknown>
}

export type CompactionMessageOptions = {
  compactionAttemptId: string
  boundaryReason?: SessionCompactionBoundaryReason | null
  error?: string
}

export interface PendingInputRestartRecovery {
  affectedSessionIds: Set<string>
  heldQueueInputIds: Set<string>
}

export interface SessionSettingsPort extends SessionResourceReadPort {
  create(
    id: string,
    providerId: string,
    modelId: string,
    permissionMode: PermissionMode,
    generationSettings?: Partial<SessionGenerationSettings>
  ): void
  get(id: string): PersistedSessionGenerationRow | undefined
  getMemoryCursorOrderSeq(sessionId: string): number | null
  updateMemoryCursorOrderSeq(sessionId: string, orderSeq: number): void
  rewindMemoryCursorOrderSeq(sessionId: string, orderSeq: number): void
  delete(id: string): void
  updatePermissionMode(id: string, mode: PermissionMode): void
  updateSessionModel(id: string, providerId: string, modelId: string): void
  getGenerationSettings(id: string): Partial<SessionGenerationSettings> | null
  updateGenerationSettings(id: string, settings: Partial<SessionGenerationSettings>): void
  updateSessionConfiguration(
    id: string,
    providerId: string,
    modelId: string,
    generationSettings: Partial<SessionGenerationSettings>,
    permissionMode?: PermissionMode
  ): void
  getSummaryState(id: string): SessionSummaryState
  getReconstructionAnchorPromptState(id: string): ReconstructionAnchorPromptState | null
  getReconstructionAnchorPromptStateByCompactionAttemptId(
    id: string,
    compactionAttemptId: string
  ): ReconstructionAnchorPromptState | null
  updateSummaryState(id: string, state: SessionSummaryState): void
  compareAndSetSummaryState(
    id: string,
    expectedState: SessionSummaryState,
    nextState: SessionSummaryState,
    tapeAnchor?: SummaryTapeAnchorInput
  ): SummaryStateCompareAndSetResult
  resetSummaryState(id: string): void
  resetTape(id: string): void
}

export interface SessionTranscriptPort {
  readProjectionCursor(sessionId: string): TapeProjectionCursor | null
  writeProjectionCursor(sessionId: string, cursor: TapeProjectionCursor): void
  applyTapeEntries(rows: readonly DeepChatTapeEntryRow[]): void
  createUserMessage(
    sessionId: string,
    orderSeq: number,
    content: UserMessageContent,
    options?: {
      status?: 'pending' | 'sent'
      metadata?: MessageMetadata
    }
  ): string
  createAssistantMessage(sessionId: string, orderSeq: number): string
  createCompactionMessage(
    sessionId: string,
    orderSeq: number,
    status: 'compacting' | 'compacted',
    summaryUpdatedAt: number | null,
    options: CompactionMessageOptions
  ): string
  createCompactionMessageAtOrderSeq(
    sessionId: string,
    orderSeq: number,
    status: 'compacting' | 'compacted',
    summaryUpdatedAt: number | null,
    options: CompactionMessageOptions & { shiftExistingMessages?: boolean }
  ): string
  updateAssistantContent(
    messageId: string,
    blocks: AssistantMessageBlock[],
    metadata?: string
  ): void
  updateAssistantMetadata(messageId: string, metadata: string): void
  updateMessageStatus(messageId: string, status: 'pending'): void
  markSteerMessagesRead(messageIds: string[], readAt: number): ChatMessageRecord[]
  updateSteerDelivery(
    messageIds: string[],
    delivery: 'accepted' | 'applied' | 'failed' | 'unknown'
  ): ChatMessageRecord[]
  settleSteerMessages(messageIds: string[]): ChatMessageRecord[]
  failPendingSteerMessages(messageIds: string[]): ChatMessageRecord[]
  restoreUserMessage(messageId: string): void
  finalizeAssistantMessage(
    messageId: string,
    blocks: AssistantMessageBlock[],
    metadata: string
  ): void
  updateCompactionMessage(
    messageId: string,
    status: 'compacting' | 'compacted' | 'failed',
    summaryUpdatedAt: number | null,
    options: CompactionMessageOptions
  ): void
  recordCompactionModelCall(input: TapeCompactionModelCallInput): void
  setMessageError(messageId: string, blocks: AssistantMessageBlock[], metadata?: string): void
  getMessages(sessionId: string): ChatMessageRecord[]
  getPendingAssistantMessages(sessionId: string): ChatMessageRecord[]
  hasMessages(sessionId: string): boolean
  listMessagesPage(
    sessionId: string,
    options?: {
      limit?: number
      cursor?: MessagePageCursor | null
    }
  ): ChatMessagePageResult
  getMessagesUpToOrderSeq(sessionId: string, maxOrderSeq: number): ChatMessageRecord[]
  getMessageIds(sessionId: string): string[]
  getMessage(messageId: string): ChatMessageRecord | null
  getLastUserMessageBeforeOrAt(sessionId: string, orderSeq: number): ChatMessageRecord | null
  updateMessageContent(messageId: string, content: string): void
  getNextOrderSeq(sessionId: string): number
  deleteBySession(sessionId: string): void
  deleteMessage(messageId: string): void
  deleteFromOrderSeq(sessionId: string, fromOrderSeq: number): void
  addSearchResult(row: {
    sessionId: string
    messageId: string
    searchId?: string | null
    rank?: number | null
    result: SearchResult
  }): void
  getSearchResults(messageId: string, searchId?: string): SearchResult[]
  insertMessageTrace(row: {
    id: string
    messageId: string
    sessionId: string
    providerId: string
    modelId: string
    endpoint: string
    headersJson: string
    bodyJson: string
    truncated: boolean
    createdAt?: number
    requestSeq?: number
    logicalRound?: number | null
    physicalAttempt?: number | null
  }): number
  listMessageTraces(messageId: string): MessageTraceRecord[]
  getMessageTraceCount(messageId: string): number
  getMaxMessageTraceRequestSeq(messageId: string): number
  cloneSentMessagesToSession(
    sourceSessionId: string,
    targetSessionId: string,
    maxOrderSeq: number
  ): number
  recoverPendingMessages(options?: {
    forceRecoverMessagesBySession?: ReadonlyMap<string, ReadonlySet<string>>
  }): number
  reconcileCompactionMessages(): { compacted: number; retracted: number; failed: number }
}

export interface SessionPendingInputsPort extends SessionPendingInputRuntimePort {
  getInput(sessionId: string, itemId: string): PendingSessionInputRecord | null
  createClaimedQueueUserMessage(
    sessionId: string,
    itemId: string,
    content: UserMessageContent
  ): string
  hasUnconsumedInputs(sessionId: string): boolean
  hasBlockingInput(sessionId: string): boolean
  hasClaimedInput(sessionId: string): boolean
  releaseClaimedQueueInput(sessionId: string, itemId: string): PendingSessionInputRecord
  releaseClaimedQueueInputForRetry(sessionId: string, itemId: string): PendingSessionInputRecord
  retryReleasedQueueInput(sessionId: string, itemId: string): PendingSessionInputRecord
  blockClaimedInput(
    sessionId: string,
    itemId: string,
    blocking: AttachmentPreparationSummary
  ): PendingSessionInputRecord
  retryBlockedInput(sessionId: string, itemId: string): PendingSessionInputRecord
  degradeBlockedInput(sessionId: string, itemId: string): PendingSessionInputRecord
  recoverInputsAfterRestart(): PendingInputRestartRecovery
  hasActiveInputs(sessionId: string): boolean
  isAtCapacity(sessionId: string): boolean
  deleteBySession(sessionId: string): void
}

export interface SessionTranscriptRuntimePort {
  prepareClearMessages(sessionId: string): Promise<void>
  finishClearMessages(sessionId: string): void
  prepareRetry(
    sessionId: string,
    options?: { allowRestartHeldQueue?: boolean }
  ): Promise<{ projectDir: string | null }>
  assertNoActivePendingInputs(sessionId: string): void
  cancelForTranscriptMutation(sessionId: string): Promise<void>
  invalidateTranscriptFrom(sessionId: string, orderSeq: number): void
  finishTranscriptTruncate(sessionId: string): void
  resetForkTarget(sessionId: string, clonedMemoryCursorOrderSeq: number): void
}
