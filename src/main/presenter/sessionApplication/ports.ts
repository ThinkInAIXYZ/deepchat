import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { AgentTapePort, AgentTranscriptReadPort } from '@/agent/shared/agentSharedData'
import type {
  DeepChatSessionState,
  SessionLightweightListResult,
  SessionListItem,
  SessionPageCursor,
  SessionRecord,
  SessionWithState
} from '@shared/types/agent-interface'
import type { DeepChatMessageRow } from '../sqlitePresenter/tables/deepchatMessages'
import type { DeepChatMessageSearchResultRow } from '../sqlitePresenter/tables/deepchatMessageSearchResults'
import type { DeepChatMessageTraceRow } from '../sqlitePresenter/tables/deepchatMessageTraces'

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
  bindWindow(webContentsId: number, sessionId: AppSessionId): void
  unbindWindow(webContentsId: number): void
  getActiveSessionId(webContentsId: number): AppSessionId | null
}

export interface SessionProjectionRuntimePort {
  getAgentKind(agentId: string): 'deepchat' | 'acp'
  snapshot(
    sessionId: string,
    options?: { lightweight?: boolean }
  ): Promise<DeepChatSessionState | null>
  waitForFirstTurnReady(sessionId: string, options: { timeoutMs: number }): Promise<boolean>
}

export type SessionProjectionTranscriptPort = Pick<
  AgentTranscriptReadPort,
  'getMessages' | 'listMessagesPage' | 'getMessageIds' | 'getMessage'
>

export type SessionProjectionTapePort = Pick<
  AgentTapePort,
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
  reason?: 'created' | 'updated' | 'deleted' | 'list-refreshed'
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

export interface SessionWindowProjectionPort {
  activate(webContentsId: number, sessionId: string): Promise<void>
  deactivate(webContentsId: number): Promise<void>
  getActive(webContentsId: number): Promise<SessionWithState | null>
  getActiveId(webContentsId: number): string | null
}

export interface SessionProjectionMutationPort {
  bindWindow(webContentsId: number, sessionId: string): void
  materialize(sessionId: string): Promise<SessionWithState | null>
  notify(input?: SessionProjectionUpdate): void
  forgetStatus(sessionIds: string[]): void
  scheduleTitleGeneration(input: TitleGenerationInput): void
}
