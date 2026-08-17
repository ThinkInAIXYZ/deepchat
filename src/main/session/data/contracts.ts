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
  SubagentTapeLinkReceipt
} from '@shared/types/agent-interface'
import type { DeepChatTapeViewManifestRecord } from '@shared/types/tape-view-manifest'
import type {
  DeepChatTapeReplayExportOptions,
  DeepChatTapeReplaySlice
} from '@shared/types/tape-replay'
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
  ): Promise<{ content: SendMessageInput; projectDir: string | null; sourceOrderSeq: number }>
  commitRetryMessage(sessionId: string, sourceOrderSeq: number): void
  deleteMessage(sessionId: string, messageId: string): Promise<void>
  editUserMessage(sessionId: string, messageId: string, text: string): Promise<ChatMessageRecord>
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
  claimSteerInput(sessionId: string, itemId: string): PendingSessionInputRecord
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
  exportMessageTapeReplaySlice(
    sessionId: string,
    messageId: string,
    options?: DeepChatTapeReplayExportOptions
  ): Promise<DeepChatTapeReplaySlice | null>
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
