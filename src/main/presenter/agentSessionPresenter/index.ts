import logger from '@shared/logger'
import type { AgentManager } from '@/agent/manager/agentManager'
import type {
  Agent,
  AgentTapeAnchorResult,
  AgentTapeAnchorsOptions,
  AgentTapeContextOptions,
  AgentTapeContextResult,
  AgentTapeInfo,
  AgentTapeSearchOptions,
  AgentTapeSearchResult,
  AgentTransferImpact,
  ChatMessagePageResult,
  SessionListItem,
  SessionLightweightListResult,
  SessionPageCursor,
  CreateSessionInput,
  CreateDetachedSessionInput,
  SessionRecord,
  SessionWithState,
  ChatMessageRecord,
  MessagePageCursor,
  MessageTraceRecord,
  MessageStartResult,
  MessageFile,
  SendMessageInput,
  UserMessageContent,
  AssistantMessageBlock,
  LegacyImportStatus,
  PermissionMode,
  SessionCompactionState,
  SessionGenerationSettings,
  ToolInteractionResponse,
  ToolInteractionResult,
  UsageDashboardData,
  UsageDashboardBreakdownItem,
  UsageStatsBackfillStatus
} from '@shared/types/agent-interface'
import type { Message } from '@shared/chat'
import type { SearchResult } from '@shared/types/core/search'
import type { DeepChatTapeViewManifestRecord } from '@shared/types/tape-view-manifest'
import type {
  DeepChatTapeReplayExportOptions,
  DeepChatTapeReplaySlice
} from '@shared/types/tape-replay'
import type {
  AcpConfigState,
  IConfigPresenter,
  HistorySearchHit,
  HistorySearchOptions,
  HistorySearchSessionHit,
  HistorySearchMessageHit,
  ILlmProviderPresenter,
  CONVERSATION
} from '@shared/presenter'
import type { SQLitePresenter } from '../sqlitePresenter'
import type { StartupWorkloadTaskContext } from '../startupWorkloadCoordinator'
import type {
  DeepChatMessageRow,
  DeepChatMessageUsageCandidateRow
} from '../sqlitePresenter/tables/deepchatMessages'
import { AppSessionService } from '@/agent/shared/appSessionService'
import type { AgentSharedDataPorts } from '@/agent/shared/agentSharedData'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { LegacyChatImportService } from './legacyImportService'
import { SessionProjectionCoordinator } from '../sessionApplication/projectionCoordinator'
import type {
  SessionAgentAssignmentPort,
  SessionLifecyclePort,
  SessionLifecycleSubagentInput,
  SessionTurnPort
} from '../sessionApplication/ports'
import {
  normalizeActiveSkills,
  normalizeDisabledAgentTools
} from '@/agent/shared/agentSessionNormalization'
import {
  buildConversationExportContent,
  generateExportFilename,
  type ConversationExportFormat
} from '../exporter/formats/conversationExporter'
import {
  DASHBOARD_STATS_BACKFILL_KEY,
  buildUsageDashboardCalendar,
  buildUsageStatsRecord,
  getModelLabel,
  getProviderLabel,
  isUsageBackfillRunningStale,
  normalizeUsageStatsBackfillStatus,
  parseMessageMetadata as parseUsageMetadata,
  resolveUsageModelId,
  resolveUsageProviderId
} from '../usageStats'
import { rtkRuntimeService } from '@/agent/shared/process/rtkRuntimeService'
import type { SessionPermissionPort } from '../runtimePorts'

type SearchableSessionRow = {
  id: string
  title: string
  projectDir: string | null
  updatedAt: number
}

type SearchableMessageRow = {
  id: string
  sessionId: string
  title: string
  role: 'user' | 'assistant'
  content: string
  updatedAt: number
}

const SQLITE_MAINLINE_NORMALIZATION_KEY = 'sqlite-mainline-normalization-v1'
const DISABLED_SEARCH_TOOL_CLEANUP_KEY = 'agent-disabled-search-tool-cleanup-v1'

const clampHistorySearchLimit = (value: number | undefined): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 12
  }

  return Math.min(Math.max(Math.floor(value), 1), 50)
}

const normalizeSearchText = (value: string): string => value.trim().toLowerCase()
const SESSION_SEARCH_OVERQUERY_FACTOR = 2
const MESSAGE_SEARCH_OVERQUERY_FACTOR = 4

const buildSearchSnippet = (content: string, query: string, maxLength: number = 120): string => {
  const normalizedContent = content.trim()
  if (!normalizedContent) {
    return ''
  }

  const lowerContent = normalizedContent.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const index = lowerContent.indexOf(lowerQuery)

  if (index === -1) {
    return normalizedContent.length > maxLength
      ? normalizedContent.slice(0, maxLength).trimEnd() + '…'
      : normalizedContent
  }

  const start = Math.max(0, index - 48)
  const end = Math.min(normalizedContent.length, index + query.length + 48)
  let snippet = normalizedContent.slice(start, end).trim()

  if (start > 0) {
    snippet = '…' + snippet
  }
  if (end < normalizedContent.length) {
    snippet += '…'
  }

  return snippet
}

const scoreSessionHit = (session: SearchableSessionRow, normalizedQuery: string): number => {
  const title = session.title.toLowerCase()
  if (title.startsWith(normalizedQuery)) {
    return 400
  }
  if (title.includes(normalizedQuery)) {
    return 320
  }
  return 0
}

const scoreMessageHit = (message: SearchableMessageRow, normalizedQuery: string): number => {
  const title = message.title.toLowerCase()
  const content = message.content.toLowerCase()

  if (title.startsWith(normalizedQuery)) {
    return 280
  }
  if (title.includes(normalizedQuery)) {
    return 220
  }
  if (content.startsWith(normalizedQuery)) {
    return 180
  }
  if (content.includes(normalizedQuery)) {
    return 140
  }
  return 0
}

const extractSearchableMessageContent = (rawContent: string): string => {
  try {
    const parsed = JSON.parse(rawContent) as
      | { text?: string; content?: Array<{ type?: string; text?: string }> }
      | Array<{
          type?: string
          content?: string
          text?: string
          error?: string
        }>

    if (Array.isArray(parsed)) {
      const segments = parsed
        .flatMap((block) => {
          if (!block || typeof block !== 'object') {
            return []
          }

          const values = [block.content, block.text, block.error]
          return values.filter(
            (value): value is string => typeof value === 'string' && !!value.trim()
          )
        })
        .map((value) => value.trim())

      if (segments.length > 0) {
        return segments.join('\n')
      }
    } else if (parsed && typeof parsed === 'object') {
      if (typeof parsed.text === 'string' && parsed.text.trim()) {
        return parsed.text.trim()
      }

      if (Array.isArray(parsed.content)) {
        const segments = parsed.content
          .filter(
            (item): item is { type?: string; text?: string } =>
              typeof item?.text === 'string' && item.text.trim().length > 0
          )
          .map((item) => item.text!.trim())

        if (segments.length > 0) {
          return segments.join('\n')
        }
      }
    }
  } catch {
    // Plain-text messages are expected here; fall through and return the raw string content.
  }

  return rawContent
}

export class AgentSessionPresenter {
  private agentManager: AgentManager
  private sessionManager: AppSessionService
  private sqlitePresenter: SQLitePresenter
  private llmProviderPresenter: ILlmProviderPresenter
  private configPresenter: IConfigPresenter
  private sharedData: AgentSharedDataPorts
  private legacyImportService: LegacyChatImportService
  private sessionProjection: SessionProjectionCoordinator
  private sessionLifecycle: SessionLifecyclePort
  private sessionAssignment: SessionAgentAssignmentPort
  private sessionTurn: SessionTurnPort
  private sessionPermissionPort?: SessionPermissionPort
  private usageStatsBackfillPromise: Promise<void> | null = null
  private mainlineNormalizationPromise: Promise<void> | null = null
  private disabledSearchToolCleanupPromise: Promise<void> | null = null

  constructor(
    agentManager: AgentManager,
    appSessionService: AppSessionService,
    llmProviderPresenter: ILlmProviderPresenter,
    configPresenter: IConfigPresenter,
    sqlitePresenter: SQLitePresenter,
    sharedData: AgentSharedDataPorts,
    sessionProjection: SessionProjectionCoordinator,
    sessionLifecycle: SessionLifecyclePort,
    sessionAssignment: SessionAgentAssignmentPort,
    sessionTurn: SessionTurnPort,
    runtimePorts?: {
      sessionPermissionPort?: SessionPermissionPort
    }
  ) {
    this.agentManager = agentManager
    this.sqlitePresenter = sqlitePresenter
    this.llmProviderPresenter = llmProviderPresenter
    this.configPresenter = configPresenter
    this.sharedData = sharedData
    this.sessionProjection = sessionProjection
    this.sessionLifecycle = sessionLifecycle
    this.sessionAssignment = sessionAssignment
    this.sessionTurn = sessionTurn
    this.sessionManager = appSessionService
    this.legacyImportService = new LegacyChatImportService(sqlitePresenter)
    this.sessionPermissionPort = runtimePorts?.sessionPermissionPort
  }

  // ---- IPC-facing methods ----

  async createSession(input: CreateSessionInput, webContentsId: number): Promise<SessionWithState> {
    return await this.sessionLifecycle.createSession(input, webContentsId)
  }

  async createDetachedSession(input: CreateDetachedSessionInput): Promise<SessionWithState> {
    return await this.sessionLifecycle.createDetachedSession(input)
  }

  async createSubagentSession(input: SessionLifecycleSubagentInput): Promise<SessionWithState> {
    return await this.sessionLifecycle.createSubagentSession(input)
  }

  async ensureAcpDraftSession(input: {
    agentId: string
    projectDir: string
    permissionMode?: PermissionMode
  }): Promise<SessionWithState> {
    return await this.sessionLifecycle.ensureAcpDraftSession(input)
  }

  async sendMessage(
    sessionId: string,
    content: string | SendMessageInput,
    options?: { maxProviderRounds?: number }
  ): Promise<MessageStartResult> {
    return await this.sessionTurn.sendMessage(sessionId, content, options)
  }

  async steerActiveTurn(sessionId: string, content: string | SendMessageInput): Promise<void> {
    await this.sessionTurn.steerActiveTurn(sessionId, content)
  }

  async listPendingInputs(sessionId: string) {
    return await this.sessionTurn.listPendingInputs(sessionId)
  }

  async queuePendingInput(sessionId: string, content: string | SendMessageInput) {
    return await this.sessionTurn.queuePendingInput(sessionId, content)
  }

  async updateQueuedInput(sessionId: string, itemId: string, content: string | SendMessageInput) {
    return await this.sessionTurn.updateQueuedInput(sessionId, itemId, content)
  }

  async moveQueuedInput(sessionId: string, itemId: string, toIndex: number) {
    return await this.sessionTurn.moveQueuedInput(sessionId, itemId, toIndex)
  }

  async convertPendingInputToSteer(sessionId: string, itemId: string) {
    return await this.sessionTurn.convertPendingInputToSteer(sessionId, itemId)
  }

  async steerPendingInput(sessionId: string, itemId: string) {
    return await this.sessionTurn.steerPendingInput(sessionId, itemId)
  }

  async deletePendingInput(sessionId: string, itemId: string): Promise<void> {
    await this.sessionTurn.deletePendingInput(sessionId, itemId)
  }

  async retryMessage(sessionId: string, messageId: string): Promise<void> {
    await this.sessionTurn.retryMessage(sessionId, messageId)
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    await this.sessionTurn.deleteMessage(sessionId, messageId)
  }

  async editUserMessage(
    sessionId: string,
    messageId: string,
    text: string
  ): Promise<ChatMessageRecord> {
    return await this.sessionTurn.editUserMessage(sessionId, messageId, text)
  }

  async forkSession(
    sourceSessionId: string,
    targetMessageId: string,
    newTitle?: string
  ): Promise<SessionWithState> {
    return await this.sessionLifecycle.forkSession(sourceSessionId, targetMessageId, newTitle)
  }

  async getSessionList(filters?: {
    agentId?: string
    projectDir?: string
    includeSubagents?: boolean
    parentSessionId?: string
  }): Promise<SessionWithState[]> {
    return await this.sessionProjection.listSessions(filters)
  }

  async getLightweightSessionList(options?: {
    limit?: number
    cursor?: SessionPageCursor | null
    includeSubagents?: boolean
    agentId?: string
    prioritizeSessionId?: string
  }): Promise<SessionLightweightListResult> {
    return await this.sessionProjection.listLightweight(options)
  }

  async getLightweightSessionsByIds(sessionIds: string[]): Promise<SessionListItem[]> {
    return await this.sessionProjection.getLightweightByIds(sessionIds)
  }

  async getSession(sessionId: string): Promise<SessionWithState | null> {
    return await this.sessionProjection.getSession(sessionId)
  }

  async getMessages(sessionId: string): Promise<ChatMessageRecord[]> {
    return await this.sessionProjection.getMessages(sessionId)
  }

  async listMessagesPage(
    sessionId: string,
    options?: {
      limit?: number
      cursor?: MessagePageCursor | null
    }
  ): Promise<ChatMessagePageResult> {
    return await this.sessionProjection.listMessagesPage(sessionId, options)
  }

  async searchHistory(query: string, options?: HistorySearchOptions): Promise<HistorySearchHit[]> {
    const normalizedQuery = normalizeSearchText(query)
    if (!normalizedQuery) {
      return []
    }

    const limit = clampHistorySearchLimit(options?.limit)
    const db = this.sqlitePresenter.getDatabase()
    if (!db) {
      return []
    }

    const searchDocumentLimit = limit * MESSAGE_SEARCH_OVERQUERY_FACTOR
    const searchDocumentRows = this.sqlitePresenter.deepchatSearchDocumentsTable.searchFts(
      normalizedQuery,
      searchDocumentLimit
    )
    const candidateSearchRows =
      searchDocumentRows.length > 0
        ? searchDocumentRows
        : this.sqlitePresenter.deepchatSearchDocumentsTable.searchLike(
            normalizedQuery,
            searchDocumentLimit
          )

    if (candidateSearchRows.length > 0) {
      const hits = candidateSearchRows
        .map((row) => {
          if (row.document_kind === 'session') {
            const session = this.sessionManager.get(row.session_id)
            if (!session) {
              return null
            }

            return {
              kind: 'session' as const,
              sessionId: session.id,
              title: row.title,
              projectDir: session.projectDir,
              updatedAt: row.updated_at,
              rank: row.rank
            }
          }

          if (!row.message_id || (row.role !== 'user' && row.role !== 'assistant')) {
            return null
          }

          return {
            kind: 'message' as const,
            sessionId: row.session_id,
            messageId: row.message_id,
            title: row.title,
            role: row.role,
            snippet: buildSearchSnippet(row.content, normalizedQuery),
            updatedAt: row.updated_at,
            rank: row.rank
          }
        })
        .filter((item): item is HistorySearchHit & { rank: number } => item !== null)

      if (hits.length > 0) {
        const deduped = new Map<string, HistorySearchHit & { rank: number }>()
        for (const hit of hits) {
          const key =
            hit.kind === 'session' ? `session:${hit.sessionId}` : `message:${hit.messageId}`
          if (!deduped.has(key)) {
            deduped.set(key, hit)
          }
        }

        return Array.from(deduped.values())
          .sort((left, right) => {
            if (left.rank !== right.rank) {
              return left.rank - right.rank
            }
            return right.updatedAt - left.updatedAt
          })
          .slice(0, limit)
          .map(({ rank: _rank, ...item }) => item)
      }
    }

    const likeQuery = `%${normalizedQuery}%`

    const sessionRows = db
      .prepare(
        `
          SELECT
            id,
            title,
            project_dir AS projectDir,
            updated_at AS updatedAt
          FROM new_sessions
          WHERE session_kind = 'regular'
            AND lower(title) LIKE ?
          ORDER BY updated_at DESC
          LIMIT ?
        `
      )
      // Pull a slightly larger working set so this method can score and trim cleaner matches.
      .all(likeQuery, limit * SESSION_SEARCH_OVERQUERY_FACTOR) as SearchableSessionRow[]

    const messageRows = db
      .prepare(
        `
          SELECT
            m.id AS id,
            m.session_id AS sessionId,
            s.title AS title,
            m.role AS role,
            m.content AS content,
            m.updated_at AS updatedAt
          FROM deepchat_messages m
          INNER JOIN new_sessions s
            ON s.id = m.session_id
          WHERE s.session_kind = 'regular'
            AND lower(m.content) LIKE ?
          ORDER BY m.updated_at DESC
          LIMIT ?
        `
      )
      // Message hits are noisier than title hits, so fetch more candidates before final sorting here.
      .all(likeQuery, limit * MESSAGE_SEARCH_OVERQUERY_FACTOR) as SearchableMessageRow[]

    const sessionHits: Array<HistorySearchSessionHit & { score: number }> = sessionRows
      .map((session) => ({
        kind: 'session' as const,
        sessionId: session.id,
        title: session.title,
        projectDir: session.projectDir,
        updatedAt: Number(session.updatedAt ?? 0),
        score: scoreSessionHit(session, normalizedQuery)
      }))
      .filter((item) => item.score > 0)

    const messageHits: Array<HistorySearchMessageHit & { score: number }> = messageRows
      .map((message) => {
        const content = extractSearchableMessageContent(message.content)
        return {
          kind: 'message' as const,
          sessionId: message.sessionId,
          messageId: message.id,
          title: message.title,
          role: message.role,
          snippet: buildSearchSnippet(content, normalizedQuery),
          updatedAt: Number(message.updatedAt ?? 0),
          score: scoreMessageHit({ ...message, content }, normalizedQuery)
        }
      })
      .filter((item) => item.score > 0)

    return [...sessionHits, ...messageHits]
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score
        }
        return right.updatedAt - left.updatedAt
      })
      .slice(0, limit)
      .map(({ score: _score, ...item }) => item)
  }

  async getSessionCompactionState(sessionId: string): Promise<SessionCompactionState> {
    return await this.sessionTurn.getSessionCompactionState(sessionId)
  }

  async compactSession(
    sessionId: string
  ): Promise<{ compacted: boolean; state: SessionCompactionState }> {
    return await this.sessionTurn.compactSession(sessionId)
  }

  async getTapeInfo(sessionId: string): Promise<AgentTapeInfo> {
    return await this.sessionProjection.getTapeInfo(sessionId)
  }

  async searchTape(
    sessionId: string,
    query: string,
    options?: AgentTapeSearchOptions
  ): Promise<AgentTapeSearchResult[]> {
    return await this.sessionProjection.searchTape(sessionId, query, options)
  }

  async getTapeContext(
    sessionId: string,
    entryIds: number[],
    options?: AgentTapeContextOptions
  ): Promise<AgentTapeContextResult> {
    return await this.sessionProjection.getTapeContext(sessionId, entryIds, options)
  }

  async listTapeAnchors(
    sessionId: string,
    options?: AgentTapeAnchorsOptions
  ): Promise<AgentTapeAnchorResult[]> {
    return await this.sessionProjection.listTapeAnchors(sessionId, options)
  }

  async handoffTape(
    sessionId: string,
    name: string,
    state: Record<string, unknown> = {}
  ): Promise<AgentTapeAnchorResult> {
    return await this.sessionProjection.handoffTape(sessionId, name, state)
  }

  async listMessageViewManifests(messageId: string): Promise<DeepChatTapeViewManifestRecord[]> {
    return await this.sessionProjection.listMessageViewManifests(messageId)
  }

  async exportMessageTapeReplaySlice(
    messageId: string,
    options?: DeepChatTapeReplayExportOptions
  ): Promise<DeepChatTapeReplaySlice | null> {
    return await this.sessionProjection.exportMessageTapeReplaySlice(messageId, options)
  }

  async mergeSubagentTape(
    parentSessionId: string,
    childSessionId: string,
    meta: Record<string, unknown> = {}
  ): Promise<void> {
    await this.sessionAssignment.mergeSubagentTape(parentSessionId, childSessionId, meta)
  }

  async discardSubagentTape(
    parentSessionId: string,
    childSessionId: string,
    meta: Record<string, unknown> = {}
  ): Promise<void> {
    await this.sessionAssignment.discardSubagentTape(parentSessionId, childSessionId, meta)
  }

  async getSearchResults(messageId: string, searchId?: string): Promise<SearchResult[]> {
    return await this.sessionProjection.getSearchResults(messageId, searchId)
  }

  async getLegacyImportStatus(): Promise<LegacyImportStatus> {
    return this.legacyImportService.getStatus()
  }

  async retryLegacyImport(): Promise<LegacyImportStatus> {
    return await this.legacyImportService.retry()
  }

  async startLegacyImport(): Promise<void> {
    this.legacyImportService.startInBackground(false)
  }

  async startLegacyImportTask(): Promise<void> {
    await this.legacyImportService.start(false)
  }

  async startUsageStatsBackfill(): Promise<void> {
    return await this.startUsageStatsBackfillTask()
  }

  async startUsageStatsBackfillTask(taskContext?: StartupWorkloadTaskContext): Promise<void> {
    const currentStatus = this.getUsageStatsBackfillStatus()
    if (currentStatus.status === 'completed') {
      return
    }

    if (currentStatus.status === 'running' && !isUsageBackfillRunningStale(currentStatus)) {
      return
    }

    if (this.usageStatsBackfillPromise) {
      return await this.usageStatsBackfillPromise
    }

    this.usageStatsBackfillPromise = this.runUsageStatsBackfill(taskContext).finally(() => {
      this.usageStatsBackfillPromise = null
    })

    return await this.usageStatsBackfillPromise
  }

  async startMainlineNormalizationBackfill(): Promise<void> {
    return await this.startMainlineNormalizationBackfillTask()
  }

  async startMainlineNormalizationBackfillTask(
    taskContext?: StartupWorkloadTaskContext
  ): Promise<void> {
    const current =
      this.sqlitePresenter.configTables.getAgentSetting<{
        status?: 'running' | 'completed' | 'failed'
        updatedAt?: number
      }>(SQLITE_MAINLINE_NORMALIZATION_KEY) ?? null

    if (current?.status === 'completed') {
      return
    }

    if (this.mainlineNormalizationPromise) {
      return await this.mainlineNormalizationPromise
    }

    this.mainlineNormalizationPromise = this.runMainlineNormalizationBackfill(taskContext).finally(
      () => {
        this.mainlineNormalizationPromise = null
      }
    )

    return await this.mainlineNormalizationPromise
  }

  async startDisabledSearchToolCleanupBackfill(): Promise<void> {
    return await this.startDisabledSearchToolCleanupBackfillTask()
  }

  async startDisabledSearchToolCleanupBackfillTask(
    taskContext?: StartupWorkloadTaskContext
  ): Promise<void> {
    const current =
      this.sqlitePresenter.configTables.getAgentSetting<{
        status?: 'running' | 'completed' | 'failed'
        updatedAt?: number
      }>(DISABLED_SEARCH_TOOL_CLEANUP_KEY) ?? null

    if (current?.status === 'completed') {
      return
    }

    if (this.disabledSearchToolCleanupPromise) {
      return await this.disabledSearchToolCleanupPromise
    }

    this.disabledSearchToolCleanupPromise = this.runDisabledSearchToolCleanupBackfill(
      taskContext
    ).finally(() => {
      this.disabledSearchToolCleanupPromise = null
    })

    return await this.disabledSearchToolCleanupPromise
  }

  async startRtkHealthCheck(taskContext?: StartupWorkloadTaskContext): Promise<void> {
    await this.startRtkHealthCheckTask(taskContext)
  }

  async startRtkHealthCheckTask(taskContext?: StartupWorkloadTaskContext): Promise<void> {
    taskContext?.reportProgress(0)
    await taskContext?.yield()
    await rtkRuntimeService.startHealthCheck()
    taskContext?.reportProgress(1)
  }

  async retryRtkHealthCheck(): Promise<void> {
    await rtkRuntimeService.retryHealthCheck()
  }

  async getUsageDashboard(): Promise<UsageDashboardData> {
    const backfillStatus = this.getUsageStatsBackfillStatus()
    const usageStatsTable = this.sqlitePresenter.deepchatUsageStatsTable
    const summaryRow = usageStatsTable.getSummary()
    const mostActiveDay = usageStatsTable.getMostActiveDay()
    const recordingStartedAt = usageStatsTable.getRecordingStartedAt()
    const cacheHitRate =
      summaryRow.inputTokens > 0 ? summaryRow.cachedInputTokens / summaryRow.inputTokens : 0

    const dateFrom = new Date()
    dateFrom.setHours(0, 0, 0, 0)
    dateFrom.setDate(dateFrom.getDate() - 364)

    const calendar = buildUsageDashboardCalendar(
      usageStatsTable.getDailyCalendarRows(this.toLocalDateKey(dateFrom.getTime()))
    )

    const providerBreakdown = this.sortUsageBreakdown(
      usageStatsTable.getProviderBreakdownRows().map((row) => ({
        id: row.id,
        label: getProviderLabel(this.configPresenter, row.id),
        messageCount: row.messageCount,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        cachedInputTokens: row.cachedInputTokens,
        estimatedCostUsd: row.estimatedCostUsd
      }))
    )

    const modelBreakdown = this.sortUsageBreakdown(
      usageStatsTable.getModelBreakdownRows(10).map((row) => ({
        id: row.id,
        label: getModelLabel('', row.id),
        messageCount: row.messageCount,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        cachedInputTokens: row.cachedInputTokens,
        estimatedCostUsd: row.estimatedCostUsd
      }))
    )

    return {
      recordingStartedAt,
      backfillStatus,
      summary: {
        messageCount: summaryRow.messageCount,
        sessionCount: summaryRow.sessionCount,
        inputTokens: summaryRow.inputTokens,
        outputTokens: summaryRow.outputTokens,
        totalTokens: summaryRow.totalTokens,
        cachedInputTokens: summaryRow.cachedInputTokens,
        cacheHitRate,
        estimatedCostUsd: summaryRow.estimatedCostUsd,
        mostActiveDay
      },
      calendar,
      providerBreakdown,
      modelBreakdown,
      rtk: await rtkRuntimeService.getDashboardData(this.configPresenter)
    }
  }

  async repairImportedLegacySessionSkills(sessionId: string): Promise<string[]> {
    return await this.legacyImportService.repairImportedLegacySessionSkills(sessionId)
  }

  async listMessageTraces(messageId: string): Promise<MessageTraceRecord[]> {
    return await this.sessionProjection.listMessageTraces(messageId)
  }

  async getMessageTraceCount(messageId: string): Promise<number> {
    return await this.sessionProjection.getMessageTraceCount(messageId)
  }

  async getMessageIds(sessionId: string): Promise<string[]> {
    return await this.sessionProjection.getMessageIds(sessionId)
  }

  async getMessage(messageId: string): Promise<ChatMessageRecord | null> {
    return await this.sessionProjection.getMessage(messageId)
  }

  async translateText(text: string, locale?: string, agentId?: string): Promise<string> {
    const input = text?.trim()
    if (!input) {
      return ''
    }

    const defaultModel = this.configPresenter.getDefaultModel()
    const assistantSelection = await this.resolveAssistantModelSelection(
      agentId ?? 'deepchat',
      defaultModel?.providerId || '',
      defaultModel?.modelId || ''
    )
    const providerId = assistantSelection.providerId
    const modelId = assistantSelection.modelId
    if (!providerId || !modelId) {
      throw new Error('No provider or model configured. Please set a default model in settings.')
    }

    const targetLanguage = this.resolveTranslateLanguage(locale)
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content: `You are a translation assistant. Translate the user input into ${targetLanguage}. Return only the translated text with no explanations.`
      },
      {
        role: 'user',
        content: input
      }
    ]

    const translated = await this.llmProviderPresenter.generateCompletion(
      providerId,
      messages,
      modelId,
      0.2,
      1024
    )
    return translated.trim()
  }

  async activateSession(webContentsId: number, sessionId: string): Promise<void> {
    await this.sessionProjection.activate(webContentsId, sessionId)
  }

  async deactivateSession(webContentsId: number): Promise<void> {
    await this.sessionProjection.deactivate(webContentsId)
  }

  async getActiveSession(webContentsId: number): Promise<SessionWithState | null> {
    return await this.sessionProjection.getActive(webContentsId)
  }

  getActiveSessionId(webContentsId: number): string | null {
    return this.sessionProjection.getActiveId(webContentsId)
  }

  async getAgents(): Promise<Agent[]> {
    const [agents, acpEnabled] = await Promise.all([
      this.configPresenter.listAgents(),
      this.configPresenter.getAcpEnabled()
    ])

    return agents.filter((agent) => agent.type === 'deepchat' || acpEnabled)
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    await this.sessionProjection.renameSession(sessionId, title)
  }

  async toggleSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
    await this.sessionProjection.toggleSessionPinned(sessionId, pinned)
  }

  async clearSessionMessages(sessionId: string): Promise<void> {
    await this.sessionTurn.clearSessionMessages(sessionId)
  }

  async exportSession(
    sessionId: string,
    format: ConversationExportFormat
  ): Promise<{ filename: string; content: string }> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const handle = this.agentManager.resolveSessionHandle(toAppSessionId(sessionId)).handle
    const state = await handle.snapshot()
    const generationSettings = await handle.settings.getGenerationSettings()
    const providerId = state?.providerId?.trim() ?? ''
    const modelId = state?.modelId?.trim() ?? ''

    const conversation = await this.buildExportConversation(
      session,
      providerId,
      modelId,
      generationSettings
    )
    const records = await this.sharedData.transcript.getMessages(sessionId)
    const exportMessages = records
      .filter((record) => record.status === 'sent')
      .sort((a, b) => a.orderSeq - b.orderSeq)
      .map((record) => this.mapRecordToExportMessage(record, providerId, modelId))

    const filename = generateExportFilename(format, conversation)
    const content = buildConversationExportContent(conversation, exportMessages, format)
    return { filename, content }
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.sessionLifecycle.deleteSession(sessionId)
  }

  async getAgentTransferImpact(agentId: string): Promise<AgentTransferImpact> {
    return await this.sessionAssignment.getAgentTransferImpact(agentId)
  }

  async moveAgentSessions(
    fromAgentId: string,
    toAgentId: string
  ): Promise<{ movedSessionIds: string[]; deletedSessionIds: string[] }> {
    return await this.sessionAssignment.moveAgentSessions(fromAgentId, toAgentId)
  }

  async deleteAgentSessions(agentId: string): Promise<string[]> {
    return await this.sessionAssignment.deleteAgentSessions(agentId)
  }

  async moveSessionToAgent(sessionId: string, toAgentId: string): Promise<SessionWithState> {
    return await this.sessionAssignment.moveSessionToAgent(sessionId, toAgentId)
  }

  async cancelGeneration(sessionId: string): Promise<void> {
    await this.sessionTurn.cancelGeneration(sessionId)
  }

  clearSessionPermissions(sessionId: string): void {
    this.sessionPermissionPort?.clearSessionPermissions(sessionId)
  }

  async respondToolInteraction(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult> {
    return await this.sessionTurn.respondToolInteraction(sessionId, messageId, toolCallId, response)
  }

  async getAcpSessionCommands(sessionId: string): Promise<
    Array<{
      name: string
      description: string
      input?: { hint: string } | null
    }>
  > {
    return await this.sessionAssignment.getAcpSessionCommands(sessionId)
  }

  async getAcpSessionConfigOptions(sessionId: string): Promise<AcpConfigState | null> {
    return await this.sessionAssignment.getAcpSessionConfigOptions(sessionId)
  }

  async setAcpSessionConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean
  ): Promise<AcpConfigState | null> {
    return await this.sessionAssignment.setAcpSessionConfigOption(sessionId, configId, value)
  }

  async getPermissionMode(sessionId: string): Promise<PermissionMode> {
    return await this.sessionAssignment.getPermissionMode(sessionId)
  }

  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    await this.sessionAssignment.setPermissionMode(sessionId, mode)
  }

  async setSessionSubagentEnabled(sessionId: string, enabled: boolean): Promise<SessionWithState> {
    return await this.sessionAssignment.setSessionSubagentEnabled(sessionId, enabled)
  }

  async setSessionModel(
    sessionId: string,
    providerId: string,
    modelId: string
  ): Promise<SessionWithState> {
    return await this.sessionAssignment.setSessionModel(sessionId, providerId, modelId)
  }

  async setSessionProjectDir(
    sessionId: string,
    projectDir: string | null
  ): Promise<SessionWithState> {
    return await this.sessionAssignment.setSessionProjectDir(sessionId, projectDir)
  }

  async getSessionGenerationSettings(sessionId: string): Promise<SessionGenerationSettings | null> {
    return await this.sessionAssignment.getSessionGenerationSettings(sessionId)
  }

  async getSessionDisabledAgentTools(sessionId: string): Promise<string[]> {
    return await this.sessionAssignment.getSessionDisabledAgentTools(sessionId)
  }

  async updateSessionDisabledAgentTools(
    sessionId: string,
    disabledAgentTools: string[]
  ): Promise<string[]> {
    return await this.sessionAssignment.updateSessionDisabledAgentTools(
      sessionId,
      disabledAgentTools
    )
  }

  async updateSessionGenerationSettings(
    sessionId: string,
    settings: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings> {
    return await this.sessionAssignment.updateSessionGenerationSettings(sessionId, settings)
  }

  private async resolveDeepChatAgentConfigCompat(
    agentId: string
  ): Promise<Awaited<ReturnType<IConfigPresenter['resolveDeepChatAgentConfig']>> | null> {
    if (typeof this.configPresenter.resolveDeepChatAgentConfig !== 'function') {
      return {} as Awaited<ReturnType<IConfigPresenter['resolveDeepChatAgentConfig']>>
    }

    return await this.configPresenter.resolveDeepChatAgentConfig(agentId)
  }

  private async resolveAssistantModelSelection(
    agentId: string,
    fallbackProviderId: string,
    fallbackModelId: string
  ): Promise<{ providerId: string; modelId: string }> {
    if (this.agentManager.resolveBackend(agentId).kind === 'deepchat') {
      const config = await this.resolveDeepChatAgentConfigCompat(agentId)
      const providerId = config?.assistantModel?.providerId?.trim()
      const modelId = config?.assistantModel?.modelId?.trim()
      if (providerId && modelId) {
        return {
          providerId,
          modelId
        }
      }
    }

    return {
      providerId: fallbackProviderId,
      modelId: fallbackModelId
    }
  }

  private async buildExportConversation(
    session: SessionRecord,
    providerId: string,
    modelId: string,
    generationSettings: SessionGenerationSettings | null
  ): Promise<CONVERSATION> {
    const isAcpAgent = this.agentManager.resolveBackend(session.agentId).kind === 'acp'
    const resolvedProviderId = providerId || (isAcpAgent ? 'acp' : '')
    const resolvedModelId = modelId || (isAcpAgent ? session.agentId : '')
    const modelConfig =
      resolvedProviderId && resolvedModelId
        ? this.configPresenter.getModelConfig(resolvedModelId, resolvedProviderId)
        : undefined

    return {
      id: session.id,
      title: session.title,
      settings: {
        systemPrompt: generationSettings?.systemPrompt ?? '',
        temperature: generationSettings?.temperature ?? modelConfig?.temperature ?? 0.7,
        contextLength: generationSettings?.contextLength ?? modelConfig?.contextLength ?? 32000,
        maxTokens: generationSettings?.maxTokens ?? modelConfig?.maxTokens ?? 8000,
        providerId: resolvedProviderId,
        modelId: resolvedModelId,
        artifacts: 0,
        thinkingBudget: generationSettings?.thinkingBudget,
        reasoningEffort: generationSettings?.reasoningEffort,
        verbosity: generationSettings?.verbosity
      },
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      is_pinned: session.isPinned ? 1 : 0
    }
  }

  private mapRecordToExportMessage(
    record: ChatMessageRecord,
    fallbackProviderId: string,
    fallbackModelId: string
  ): Message {
    const metadata = this.parseMessageMetadata(record.metadata)
    const usage = {
      context_usage: 0,
      tokens_per_second: metadata.tokensPerSecond ?? 0,
      total_tokens: metadata.totalTokens ?? 0,
      generation_time: metadata.generationTime ?? 0,
      first_token_time: metadata.firstTokenTime ?? 0,
      reasoning_start_time: 0,
      reasoning_end_time: 0,
      input_tokens: metadata.inputTokens ?? 0,
      output_tokens: metadata.outputTokens ?? 0
    }

    const base: Omit<Message, 'content' | 'role'> = {
      id: record.id,
      timestamp: record.createdAt,
      avatar: '',
      name: record.role === 'user' ? 'You' : 'Assistant',
      model_name: metadata.model ?? fallbackModelId,
      model_id: metadata.model ?? fallbackModelId,
      model_provider: metadata.provider ?? fallbackProviderId,
      status: record.status,
      error: '',
      usage,
      conversationId: record.sessionId,
      is_variant: 0
    }

    if (record.role === 'user') {
      return {
        ...base,
        role: 'user',
        content: this.parseUserExportContent(record.content)
      }
    }

    return {
      ...base,
      role: 'assistant',
      content: this.parseAssistantExportBlocks(record.content, record.createdAt)
    }
  }

  private parseUserExportContent(content: string): Message['content'] {
    const fallback = {
      text: '',
      files: [],
      links: [],
      search: false,
      think: false
    }

    try {
      const parsed = JSON.parse(content) as UserMessageContent | Record<string, unknown> | string
      if (typeof parsed === 'string') {
        return { ...fallback, text: parsed }
      }
      if (!parsed || typeof parsed !== 'object') {
        return fallback
      }
      const parsedRecord = parsed as Record<string, unknown>

      const files = Array.isArray(parsedRecord.files)
        ? (parsedRecord.files as Array<Record<string, unknown>>).map((file) => ({
            name: typeof file.name === 'string' ? file.name : '',
            content: '',
            mimeType:
              typeof file.mimeType === 'string'
                ? file.mimeType
                : typeof file.type === 'string'
                  ? file.type
                  : 'application/octet-stream',
            metadata: {
              fileName: typeof file.name === 'string' ? file.name : '',
              fileSize: typeof file.size === 'number' ? file.size : 0,
              fileCreated: new Date(),
              fileModified: new Date()
            },
            token: 0,
            path: typeof file.path === 'string' ? file.path : ''
          }))
        : []

      const links = Array.isArray(parsedRecord.links)
        ? (parsedRecord.links as unknown[]).filter(
            (link): link is string => typeof link === 'string'
          )
        : []

      return {
        ...fallback,
        text: typeof parsedRecord.text === 'string' ? parsedRecord.text : '',
        files,
        links,
        search: Boolean(parsedRecord.search),
        think: Boolean(parsedRecord.think)
      }
    } catch {
      return {
        ...fallback,
        text: content.trim()
      }
    }
  }

  private parseAssistantExportBlocks(content: string, timestamp: number): Message['content'] {
    try {
      const parsed = JSON.parse(content) as AssistantMessageBlock[] | string
      if (typeof parsed === 'string') {
        return [
          {
            type: 'content',
            content: parsed,
            status: 'success',
            timestamp
          }
        ]
      }
      if (Array.isArray(parsed)) {
        return parsed as unknown as Message['content']
      }
      return []
    } catch {
      if (!content.trim()) return []
      return [
        {
          type: 'content',
          content: content.trim(),
          status: 'success',
          timestamp
        }
      ]
    }
  }

  private parseMessageMetadata(raw: string): {
    totalTokens?: number
    inputTokens?: number
    outputTokens?: number
    cachedInputTokens?: number
    cacheWriteInputTokens?: number
    generationTime?: number
    firstTokenTime?: number
    tokensPerSecond?: number
    model?: string
    provider?: string
  } {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (!parsed || typeof parsed !== 'object') return {}
      return {
        totalTokens: typeof parsed.totalTokens === 'number' ? parsed.totalTokens : undefined,
        inputTokens: typeof parsed.inputTokens === 'number' ? parsed.inputTokens : undefined,
        outputTokens: typeof parsed.outputTokens === 'number' ? parsed.outputTokens : undefined,
        cachedInputTokens:
          typeof parsed.cachedInputTokens === 'number' ? parsed.cachedInputTokens : undefined,
        cacheWriteInputTokens:
          typeof parsed.cacheWriteInputTokens === 'number'
            ? parsed.cacheWriteInputTokens
            : undefined,
        generationTime:
          typeof parsed.generationTime === 'number' ? parsed.generationTime : undefined,
        firstTokenTime:
          typeof parsed.firstTokenTime === 'number' ? parsed.firstTokenTime : undefined,
        tokensPerSecond:
          typeof parsed.tokensPerSecond === 'number' ? parsed.tokensPerSecond : undefined,
        model: typeof parsed.model === 'string' ? parsed.model : undefined,
        provider: typeof parsed.provider === 'string' ? parsed.provider : undefined
      }
    } catch {
      return {}
    }
  }

  private async runMainlineNormalizationBackfill(
    taskContext?: StartupWorkloadTaskContext
  ): Promise<void> {
    const startedAt = Date.now()
    const batchSize = 50
    this.sqlitePresenter.configTables.setAgentSetting(SQLITE_MAINLINE_NORMALIZATION_KEY, {
      status: 'running',
      startedAt,
      finishedAt: null,
      updatedAt: startedAt,
      processedCount: 0
    })

    try {
      const db = this.sqlitePresenter.getDatabase()
      let processedCount = 0
      let batchCount = 0
      const yieldForBatch = async (): Promise<void> => {
        this.sqlitePresenter.configTables.setAgentSetting(SQLITE_MAINLINE_NORMALIZATION_KEY, {
          status: 'running',
          startedAt,
          finishedAt: null,
          updatedAt: Date.now(),
          processedCount
        })
        await (taskContext?.yield() ?? this.yieldToEventLoop())
      }

      let sessionCursor: { updatedAt: number; id: string } | null = null
      while (true) {
        const sessionRows = sessionCursor
          ? db
              .prepare<
                [number, number, string, number],
                { id: string; title: string; updated_at: number }
              >(
                `SELECT id, title, updated_at
                 FROM new_sessions
                 WHERE updated_at > ? OR (updated_at = ? AND id > ?)
                 ORDER BY updated_at ASC, id ASC
                 LIMIT ?`
              )
              .all(sessionCursor.updatedAt, sessionCursor.updatedAt, sessionCursor.id, batchSize)
          : db
              .prepare<[number], { id: string; title: string; updated_at: number }>(
                `SELECT id, title, updated_at
                 FROM new_sessions
                 ORDER BY updated_at ASC, id ASC
                 LIMIT ?`
              )
              .all(batchSize)

        if (sessionRows.length === 0) {
          break
        }

        for (const sessionRow of sessionRows) {
          const activeSkills = this.sqlitePresenter.newSessionsTable.getActiveSkills(sessionRow.id)
          const disabledAgentTools = this.sqlitePresenter.newSessionsTable.getDisabledAgentTools(
            sessionRow.id
          )
          this.sqlitePresenter.newSessionActiveSkillsTable.replaceForSession(
            sessionRow.id,
            activeSkills
          )
          this.sqlitePresenter.newSessionDisabledAgentToolsTable.replaceForSession(
            sessionRow.id,
            disabledAgentTools
          )
          this.sqlitePresenter.deepchatSearchDocumentsTable.upsert({
            documentKey: `session:${sessionRow.id}`,
            sessionId: sessionRow.id,
            documentKind: 'session',
            title: sessionRow.title,
            content: '',
            updatedAt: sessionRow.updated_at
          })

          sessionCursor = { updatedAt: sessionRow.updated_at, id: sessionRow.id }
          processedCount += 1
          batchCount += 1
          if (batchCount >= batchSize) {
            batchCount = 0
            await yieldForBatch()
          }
        }
      }

      let messageCursor: { createdAt: number; id: string } | null = null
      while (true) {
        const messageRows = messageCursor
          ? db
              .prepare<[number, number, string, number], DeepChatMessageRow>(
                `SELECT id, session_id, role, status, content, updated_at, created_at
                 FROM deepchat_messages
                 WHERE created_at > ? OR (created_at = ? AND id > ?)
                 ORDER BY created_at ASC, id ASC
                 LIMIT ?`
              )
              .all(messageCursor.createdAt, messageCursor.createdAt, messageCursor.id, batchSize)
          : db
              .prepare<[number], DeepChatMessageRow>(
                `SELECT id, session_id, role, status, content, updated_at, created_at
                 FROM deepchat_messages
                 ORDER BY created_at ASC, id ASC
                 LIMIT ?`
              )
              .all(batchSize)

        if (messageRows.length === 0) {
          break
        }

        for (const row of messageRows) {
          this.backfillNormalizedMessageRow(row)
          messageCursor = { createdAt: row.created_at, id: row.id }
          processedCount += 1
          batchCount += 1
          if (batchCount >= batchSize) {
            batchCount = 0
            await yieldForBatch()
          }
        }
      }

      const finishedAt = Date.now()
      const durationMs = finishedAt - startedAt
      this.sqlitePresenter.configTables.setAgentSetting(SQLITE_MAINLINE_NORMALIZATION_KEY, {
        status: 'completed',
        startedAt,
        finishedAt,
        updatedAt: finishedAt,
        processedCount,
        durationMs
      })
      logger.info('[SQLiteMainlineNormalization] Backfill completed', {
        processedCount,
        durationMs
      })
    } catch (error) {
      const finishedAt = Date.now()
      this.sqlitePresenter.configTables.setAgentSetting(SQLITE_MAINLINE_NORMALIZATION_KEY, {
        status: 'failed',
        startedAt,
        finishedAt,
        updatedAt: finishedAt,
        error: error instanceof Error ? error.message : String(error),
        durationMs: finishedAt - startedAt
      })
      throw error
    }
  }

  private async runDisabledSearchToolCleanupBackfill(
    taskContext?: StartupWorkloadTaskContext
  ): Promise<void> {
    const startedAt = Date.now()
    this.sqlitePresenter.configTables.setAgentSetting(DISABLED_SEARCH_TOOL_CLEANUP_KEY, {
      status: 'running',
      startedAt,
      finishedAt: null,
      updatedAt: startedAt
    })

    try {
      const db = this.sqlitePresenter.getDatabase()
      const sessionRowsStatement = db.prepare<[], { id: string }>(
        'SELECT id FROM new_sessions ORDER BY updated_at ASC'
      )
      const sessionRows = sessionRowsStatement.all()

      let processedCount = 0
      let updatedCount = 0
      const batchSize = 50
      for (const sessionRow of sessionRows) {
        const disabledAgentTools = this.sqlitePresenter.newSessionsTable.getDisabledAgentTools(
          sessionRow.id
        )
        const normalized = normalizeDisabledAgentTools(disabledAgentTools, {
          dropLegacySearchTools: true
        })

        if (!this.areStringArraysEqual(disabledAgentTools, normalized)) {
          this.sessionManager.updateDisabledAgentTools(sessionRow.id, normalized)
          updatedCount += 1
        }

        processedCount += 1
        if (processedCount % batchSize === 0) {
          await (taskContext?.yield() ?? this.yieldToEventLoop())
        }
      }

      const configUpdatedCount = await this.cleanupDeepChatAgentConfigDisabledTools()

      this.sqlitePresenter.configTables.setAgentSetting(DISABLED_SEARCH_TOOL_CLEANUP_KEY, {
        status: 'completed',
        startedAt,
        finishedAt: Date.now(),
        updatedAt: Date.now(),
        processedCount,
        updatedCount,
        configUpdatedCount
      })
    } catch (error) {
      this.sqlitePresenter.configTables.setAgentSetting(DISABLED_SEARCH_TOOL_CLEANUP_KEY, {
        status: 'failed',
        startedAt,
        finishedAt: Date.now(),
        updatedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  private async cleanupDeepChatAgentConfigDisabledTools(): Promise<number> {
    const agents = await this.configPresenter.listAgents()
    let updatedCount = 0

    for (const agent of agents) {
      if (agent.type !== 'deepchat') {
        continue
      }

      const config = await this.configPresenter.getDeepChatAgentConfig(agent.id)
      if (!Array.isArray(config?.disabledAgentTools)) {
        continue
      }

      const normalized = normalizeDisabledAgentTools(config.disabledAgentTools, {
        dropLegacySearchTools: true
      })
      if (this.areStringArraysEqual(config.disabledAgentTools, normalized)) {
        continue
      }

      await this.configPresenter.updateDeepChatAgent(agent.id, {
        config: {
          disabledAgentTools: normalized
        }
      })
      updatedCount += 1
    }

    return updatedCount
  }

  private backfillNormalizedMessageRow(row: DeepChatMessageRow): void {
    if (row.role === 'user') {
      const content = this.parseBackfillUserMessageContent(row.content)
      if (content) {
        this.sqlitePresenter.deepchatUserMessagesTable.upsert({
          messageId: row.id,
          text: content.text,
          searchEnabled: content.search === true,
          thinkEnabled: content.think === true
        })
        this.sqlitePresenter.deepchatUserMessageFilesTable.replaceForMessage(
          row.id,
          content.files.map((file) => ({
            name: file.name,
            path: file.path,
            mimeType: file.mimeType ?? file.type,
            size: file.size,
            metadataJson: JSON.stringify({
              type: file.type,
              content: file.content,
              token: file.token,
              thumbnail: file.thumbnail,
              metadata: file.metadata
            })
          }))
        )
        this.sqlitePresenter.deepchatUserMessageLinksTable.replaceForMessage(row.id, content.links)
      }
    } else {
      this.sqlitePresenter.deepchatAssistantBlocksTable.replaceForMessage(
        row.id,
        this.parseBackfillAssistantBlocks(row.content)
      )
    }

    if (row.status === 'sent' || row.status === 'error') {
      const title = this.sqlitePresenter.newSessionsTable.get(row.session_id)?.title ?? ''
      this.sqlitePresenter.deepchatSearchDocumentsTable.upsert({
        documentKey: `message:${row.id}`,
        sessionId: row.session_id,
        messageId: row.id,
        documentKind: 'message',
        role: row.role,
        title,
        content: extractSearchableMessageContent(row.content),
        updatedAt: row.updated_at
      })
    }
  }

  private parseBackfillUserMessageContent(rawContent: string): UserMessageContent | null {
    try {
      const parsed = JSON.parse(rawContent) as Partial<UserMessageContent>
      if (!parsed || typeof parsed !== 'object') {
        return null
      }

      return {
        text: typeof parsed.text === 'string' ? parsed.text : '',
        files: Array.isArray(parsed.files) ? (parsed.files.filter(Boolean) as MessageFile[]) : [],
        links: Array.isArray(parsed.links)
          ? parsed.links.filter((item): item is string => typeof item === 'string')
          : [],
        search: parsed.search === true,
        think: parsed.think === true,
        activeSkills: normalizeActiveSkills(parsed.activeSkills)
      }
    } catch {
      return null
    }
  }

  private parseBackfillAssistantBlocks(rawContent: string): AssistantMessageBlock[] {
    try {
      const parsed = JSON.parse(rawContent) as AssistantMessageBlock[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  private async runUsageStatsBackfill(taskContext?: StartupWorkloadTaskContext): Promise<void> {
    const startedAt = Date.now()
    const batchSize = 50
    this.setUsageStatsBackfillStatus({
      status: 'running',
      startedAt,
      finishedAt: null,
      error: null,
      updatedAt: startedAt,
      processedCount: 0
    })

    try {
      const usageStatsTable = this.sqlitePresenter.deepchatUsageStatsTable

      let processedCount = 0
      let scannedSinceYield = 0
      const yieldUsageStatsBackfillProgress = async (): Promise<void> => {
        this.setUsageStatsBackfillStatus({
          status: 'running',
          startedAt,
          finishedAt: null,
          error: null,
          updatedAt: Date.now(),
          processedCount
        })
        await (taskContext?.yield() ?? this.yieldToEventLoop())
      }

      let candidateCursor: { createdAt: number; id: string } | null = null
      while (true) {
        const candidates = this.listAssistantUsageCandidatePage(candidateCursor, batchSize)
        if (candidates.length === 0) {
          break
        }

        for (const row of candidates) {
          candidateCursor = { createdAt: row.created_at, id: row.id }
          scannedSinceYield += 1

          const metadata = parseUsageMetadata(row.metadata)
          if (metadata.messageType === 'compaction') {
            continue
          }

          const providerId = resolveUsageProviderId(metadata, row.provider_id)
          const modelId = resolveUsageModelId(metadata, row.model_id)
          if (!providerId || !modelId) {
            continue
          }

          const usageRecord = buildUsageStatsRecord({
            messageId: row.id,
            sessionId: row.session_id,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            providerId,
            modelId,
            metadata: {
              ...metadata,
              cachedInputTokens: metadata.cachedInputTokens ?? 0,
              cacheWriteInputTokens: metadata.cacheWriteInputTokens ?? 0
            },
            source: 'backfill'
          })

          if (!usageRecord) {
            continue
          }

          usageStatsTable.upsert(usageRecord)
          processedCount += 1
        }

        if (scannedSinceYield >= batchSize) {
          scannedSinceYield = 0
          await yieldUsageStatsBackfillProgress()
        }
      }

      const finishedAt = Date.now()
      const durationMs = finishedAt - startedAt
      this.setUsageStatsBackfillStatus({
        status: 'completed',
        startedAt,
        finishedAt,
        error: null,
        updatedAt: finishedAt,
        processedCount,
        durationMs
      })
      logger.info('[UsageStatsBackfill] Backfill completed', { processedCount, durationMs })
    } catch (error) {
      const finishedAt = Date.now()
      this.setUsageStatsBackfillStatus({
        status: 'failed',
        startedAt,
        finishedAt,
        error: error instanceof Error ? error.message : String(error),
        updatedAt: finishedAt,
        durationMs: finishedAt - startedAt
      })
      throw error
    }
  }

  private listAssistantUsageCandidatePage(
    cursor: { createdAt: number; id: string } | null,
    limit: number
  ): DeepChatMessageUsageCandidateRow[] {
    const table = this.sqlitePresenter.deepchatMessagesTable as {
      listAssistantUsageCandidatesPage?: (
        cursor: { createdAt: number; id: string } | null,
        limit: number
      ) => DeepChatMessageUsageCandidateRow[]
      listAssistantUsageCandidates: () => DeepChatMessageUsageCandidateRow[]
    }

    if (table.listAssistantUsageCandidatesPage) {
      return table.listAssistantUsageCandidatesPage(cursor, limit)
    }

    const candidates = [...table.listAssistantUsageCandidates()].sort(
      (left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id)
    )
    if (!cursor) {
      return candidates.slice(0, limit)
    }
    return candidates
      .filter(
        (row) =>
          row.created_at > cursor.createdAt ||
          (row.created_at === cursor.createdAt && row.id > cursor.id)
      )
      .slice(0, limit)
  }

  private getUsageStatsBackfillStatus(): UsageStatsBackfillStatus {
    const normalized = this.normalizeUsageStatsBackfillStatus(
      this.configPresenter.getSetting<UsageStatsBackfillStatus>(DASHBOARD_STATS_BACKFILL_KEY)
    )
    if (normalized.status === 'failed' && normalized.error === 'Usage stats backfill timed out') {
      this.configPresenter.setSetting(DASHBOARD_STATS_BACKFILL_KEY, normalized)
    }
    return normalized
  }

  private setUsageStatsBackfillStatus(status: UsageStatsBackfillStatus): void {
    this.configPresenter.setSetting(DASHBOARD_STATS_BACKFILL_KEY, status)
  }

  private normalizeUsageStatsBackfillStatus(status: unknown): UsageStatsBackfillStatus {
    const normalized = normalizeUsageStatsBackfillStatus(status)
    if (isUsageBackfillRunningStale(normalized)) {
      return {
        status: 'failed',
        startedAt: normalized.startedAt,
        finishedAt: normalized.finishedAt,
        error: normalized.error ?? 'Usage stats backfill timed out',
        updatedAt: Date.now()
      }
    }
    return normalized
  }

  private sortUsageBreakdown(items: UsageDashboardBreakdownItem[]): UsageDashboardBreakdownItem[] {
    return [...items].sort((left, right) => {
      const leftCost = left.estimatedCostUsd ?? -1
      const rightCost = right.estimatedCostUsd ?? -1
      if (rightCost !== leftCost) {
        return rightCost - leftCost
      }
      if (right.totalTokens !== left.totalTokens) {
        return right.totalTokens - left.totalTokens
      }
      return left.label.localeCompare(right.label)
    })
  }

  private toLocalDateKey(timestamp: number): string {
    const date = new Date(timestamp)
    const year = date.getFullYear()
    const month = `${date.getMonth() + 1}`.padStart(2, '0')
    const day = `${date.getDate()}`.padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  private async yieldToEventLoop(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }

  private resolveTranslateLanguage(locale?: string): string {
    const normalized = locale?.trim().toLowerCase() || ''
    if (!normalized) {
      return 'English'
    }
    if (normalized.startsWith('zh-cn') || normalized.startsWith('zh-hans')) {
      return 'Simplified Chinese'
    }
    if (
      normalized.startsWith('zh-tw') ||
      normalized.startsWith('zh-hk') ||
      normalized.startsWith('zh-hant')
    ) {
      return 'Traditional Chinese'
    }
    if (normalized.startsWith('ja')) {
      return 'Japanese'
    }
    if (normalized.startsWith('ko')) {
      return 'Korean'
    }
    if (normalized.startsWith('fr')) {
      return 'French'
    }
    if (normalized.startsWith('de')) {
      return 'German'
    }
    if (normalized.startsWith('es')) {
      return 'Spanish'
    }
    if (normalized.startsWith('pt')) {
      return 'Portuguese'
    }
    if (normalized.startsWith('ru')) {
      return 'Russian'
    }
    if (normalized.startsWith('it')) {
      return 'Italian'
    }
    if (normalized.startsWith('tr')) {
      return 'Turkish'
    }
    if (normalized.startsWith('pl')) {
      return 'Polish'
    }
    if (normalized.startsWith('da')) {
      return 'Danish'
    }
    if (normalized.startsWith('fa')) {
      return 'Persian'
    }
    if (normalized.startsWith('he')) {
      return 'Hebrew'
    }
    if (normalized.startsWith('en')) {
      return 'English'
    }
    return 'English'
  }

  private areStringArraysEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
      return false
    }
    return left.every((item, index) => item === right[index])
  }
}
