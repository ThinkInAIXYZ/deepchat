import type {
  Agent,
  SessionListItem,
  SessionLightweightListResult,
  SessionPageCursor,
  MessagePageCursor,
  ChatMessagePageResult,
  CreateSessionInput,
  CreateDetachedSessionInput,
  SessionWithState,
  ChatMessageRecord,
  MessageTraceRecord,
  PermissionMode,
  SessionGenerationSettings,
  SessionCompactionState,
  LegacyImportStatus,
  PendingSessionInputRecord,
  SendMessageInput,
  MessageStartResult,
  ToolInteractionResponse,
  ToolInteractionResult,
  UsageDashboardData,
  AgentTapeInfo,
  AgentTapeAnchorsOptions,
  AgentTapeContextOptions,
  AgentTapeContextResult,
  AgentTapeSearchOptions,
  AgentTapeSearchResult,
  AgentTapeAnchorResult,
  AgentTransferImpact
} from '../agent-interface'
import type { DeepChatTapeViewManifestRecord } from '../tape-view-manifest'
import type { DeepChatTapeReplayExportOptions, DeepChatTapeReplaySlice } from '../tape-replay'
import type { AcpConfigState } from './llmprovider.presenter'
import type { SearchResult } from './thread.presenter'

export interface HistorySearchOptions {
  limit?: number
}

export interface HistorySearchSessionHit {
  kind: 'session'
  sessionId: string
  title: string
  projectDir: string | null
  updatedAt: number
}

export interface HistorySearchMessageHit {
  kind: 'message'
  sessionId: string
  messageId: string
  title: string
  role: 'user' | 'assistant'
  snippet: string
  updatedAt: number
}

export type HistorySearchHit = HistorySearchSessionHit | HistorySearchMessageHit

export interface IAgentSessionPresenter {
  createSession(input: CreateSessionInput, webContentsId: number): Promise<SessionWithState>
  createDetachedSession(input: CreateDetachedSessionInput): Promise<SessionWithState>
  ensureAcpDraftSession(input: {
    agentId: string
    projectDir: string
    permissionMode?: PermissionMode
  }): Promise<SessionWithState>
  listPendingInputs(sessionId: string): Promise<PendingSessionInputRecord[]>
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
  deletePendingInput(sessionId: string, itemId: string): Promise<void>
  sendMessage(sessionId: string, content: string | SendMessageInput): Promise<MessageStartResult>
  steerActiveTurn(sessionId: string, content: string | SendMessageInput): Promise<void>
  retryMessage(sessionId: string, messageId: string): Promise<void>
  deleteMessage(sessionId: string, messageId: string): Promise<void>
  editUserMessage(sessionId: string, messageId: string, text: string): Promise<ChatMessageRecord>
  forkSession(
    sourceSessionId: string,
    targetMessageId: string,
    newTitle?: string
  ): Promise<SessionWithState>
  getSessionList(filters?: {
    agentId?: string
    projectDir?: string
    includeSubagents?: boolean
    parentSessionId?: string
  }): Promise<SessionWithState[]>
  getSession(sessionId: string): Promise<SessionWithState | null>
  getMessages(sessionId: string): Promise<ChatMessageRecord[]>
  listMessagesPage(
    sessionId: string,
    options?: {
      limit?: number
      cursor?: MessagePageCursor | null
    }
  ): Promise<ChatMessagePageResult>
  searchHistory(query: string, options?: HistorySearchOptions): Promise<HistorySearchHit[]>
  getSessionCompactionState(sessionId: string): Promise<SessionCompactionState>
  compactSession(sessionId: string): Promise<{ compacted: boolean; state: SessionCompactionState }>
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
    state?: Record<string, unknown>
  ): Promise<AgentTapeAnchorResult>
  mergeSubagentTape(
    parentSessionId: string,
    childSessionId: string,
    meta?: Record<string, unknown>
  ): Promise<void>
  discardSubagentTape(
    parentSessionId: string,
    childSessionId: string,
    meta?: Record<string, unknown>
  ): Promise<void>
  getSearchResults(messageId: string, searchId?: string): Promise<SearchResult[]>
  getLegacyImportStatus(): Promise<LegacyImportStatus>
  retryLegacyImport(): Promise<LegacyImportStatus>
  listMessageTraces(messageId: string): Promise<MessageTraceRecord[]>
  listMessageViewManifests(messageId: string): Promise<DeepChatTapeViewManifestRecord[]>
  exportMessageTapeReplaySlice(
    messageId: string,
    options?: DeepChatTapeReplayExportOptions
  ): Promise<DeepChatTapeReplaySlice | null>
  getMessageTraceCount(messageId: string): Promise<number>
  getMessageIds(sessionId: string): Promise<string[]>
  getMessage(messageId: string): Promise<ChatMessageRecord | null>
  translateText(text: string, locale?: string, agentId?: string): Promise<string>
  activateSession(webContentsId: number, sessionId: string): Promise<void>
  deactivateSession(webContentsId: number): Promise<void>
  getActiveSession(webContentsId: number): Promise<SessionWithState | null>
  getActiveSessionId(webContentsId: number): string | null
  getAgents(): Promise<Agent[]>
  getLightweightSessionList(options?: {
    limit?: number
    cursor?: SessionPageCursor | null
    includeSubagents?: boolean
    agentId?: string
    prioritizeSessionId?: string
  }): Promise<SessionLightweightListResult>
  getLightweightSessionsByIds(sessionIds: string[]): Promise<SessionListItem[]>
  renameSession(sessionId: string, title: string): Promise<void>
  toggleSessionPinned(sessionId: string, pinned: boolean): Promise<void>
  clearSessionMessages(sessionId: string): Promise<void>
  exportSession(
    sessionId: string,
    format: 'markdown' | 'html' | 'txt' | 'nowledge-mem'
  ): Promise<{ filename: string; content: string }>
  deleteSession(sessionId: string): Promise<void>
  getAgentTransferImpact(agentId: string): Promise<AgentTransferImpact>
  moveAgentSessions(
    fromAgentId: string,
    toAgentId: string
  ): Promise<{ movedSessionIds: string[]; deletedSessionIds: string[] }>
  deleteAgentSessions(agentId: string): Promise<string[]>
  moveSessionToAgent(sessionId: string, toAgentId: string): Promise<SessionWithState>
  cancelGeneration(sessionId: string): Promise<void>
  respondToolInteraction(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult>
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
  setSessionSubagentEnabled(sessionId: string, enabled: boolean): Promise<SessionWithState>
  setSessionModel(sessionId: string, providerId: string, modelId: string): Promise<SessionWithState>
  setSessionProjectDir(sessionId: string, projectDir: string | null): Promise<SessionWithState>
  getSessionGenerationSettings(sessionId: string): Promise<SessionGenerationSettings | null>
  getSessionDisabledAgentTools(sessionId: string): Promise<string[]>
  updateSessionDisabledAgentTools(
    sessionId: string,
    disabledAgentTools: string[]
  ): Promise<string[]>
  updateSessionGenerationSettings(
    sessionId: string,
    settings: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings>
  getUsageDashboard(): Promise<UsageDashboardData>
  retryRtkHealthCheck(): Promise<void>
}
