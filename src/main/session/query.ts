import logger from '@shared/logger'
import type {
  AgentTapeAnchorResult,
  AgentTapeAnchorsOptions,
  AgentTapeContextOptions,
  AgentTapeContextResult,
  AgentTapeHandoffState,
  AgentTapeInfo,
  AgentTapeSearchOptions,
  AgentTapeSearchResult,
  AssistantMessageBlock,
  ChatMessagePageResult,
  ChatMessageRecord,
  MessagePageCursor,
  MessageTraceRecord,
  SessionLightweightListResult,
  SessionListItem,
  SessionRecord,
  SessionWithState,
  UserMessageContent
} from '@shared/types/agent-interface'
import type { SearchResult } from '@shared/types/core/search'
import type { DeepChatTapeViewManifestRecord } from '@shared/types/tape-view-manifest'
import type {
  DeepChatTapeReplayExportOptions,
  DeepChatTapeReplaySlice
} from '@shared/types/tape-replay'
import type {
  SessionLightweightOptions,
  SessionListFilters,
  SessionProjectionAgentConfigPort,
  SessionProjectionEventPort,
  SessionProjectionMessageLookupPort,
  SessionProjectionMutationPort,
  SessionProjectionReadPort,
  SessionProjectionRuntimePort,
  SessionProjectionSearchResultStorePort,
  SessionProjectionStorePort,
  SessionProjectionTapePort,
  SessionProjectionTitlePort,
  SessionProjectionTraceStorePort,
  SessionProjectionTranscriptPort,
  SessionProjectionUiPort,
  SessionProjectionUpdate,
  TitleGenerationInput
} from './contracts'

export interface SessionQueryDependencies {
  sessions: SessionProjectionStorePort
  runtime: SessionProjectionRuntimePort
  transcript: SessionProjectionTranscriptPort
  tape: SessionProjectionTapePort
  messages: SessionProjectionMessageLookupPort
  searchResults: SessionProjectionSearchResultStorePort
  traces: SessionProjectionTraceStorePort
  titles: SessionProjectionTitlePort
  agentConfig: SessionProjectionAgentConfigPort
  events: SessionProjectionEventPort
  ui: SessionProjectionUiPort
}

export class SessionQuery implements SessionProjectionReadPort, SessionProjectionMutationPort {
  constructor(private readonly dependencies: SessionQueryDependencies) {}

  async listSessions(filters?: SessionListFilters): Promise<SessionWithState[]> {
    const records = this.dependencies.sessions.list(filters)
    const enriched: SessionWithState[] = []

    for (const record of records) {
      const session = await this.tryMaterializeRecord(record, 'list')
      if (session) enriched.push(session)
    }

    return enriched
  }

  async listLightweight(
    options?: SessionLightweightOptions
  ): Promise<SessionLightweightListResult> {
    const page = this.dependencies.sessions.listPage({
      limit: options?.limit,
      cursor: options?.cursor,
      agentId: options?.agentId,
      includeSubagents: options?.includeSubagents
    })
    const items = await Promise.all(
      page.records.map((record) => this.mapSessionRecordToListItem(record))
    )
    const prioritizeSessionId = options?.prioritizeSessionId?.trim()

    if (prioritizeSessionId) {
      const prioritizedRecord = this.dependencies.sessions.get(prioritizeSessionId)
      if (prioritizedRecord && this.matchesLightweightFilter(prioritizedRecord, options)) {
        items.unshift(await this.mapSessionRecordToListItem(prioritizedRecord))
      }
    }

    return {
      items: this.dedupeAndSortSessionListItems(items),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore
    }
  }

  async getLightweightByIds(sessionIds: string[]): Promise<SessionListItem[]> {
    const dedupedIds = Array.from(
      new Set(sessionIds.map((sessionId) => sessionId.trim()).filter(Boolean))
    )
    return this.dedupeAndSortSessionListItems(
      await Promise.all(
        this.dependencies.sessions
          .getMany(dedupedIds)
          .map((record) => this.mapSessionRecordToListItem(record))
      )
    )
  }

  async getSession(sessionId: string): Promise<SessionWithState | null> {
    return await this.materialize(sessionId)
  }

  async materialize(sessionId: string): Promise<SessionWithState | null> {
    const record = this.dependencies.sessions.get(sessionId)
    if (!record) return null
    return await this.tryMaterializeRecord(record)
  }

  async materializeRequired(sessionId: string): Promise<SessionWithState> {
    const record = this.dependencies.sessions.get(sessionId)
    if (!record) throw new Error(`Session not found: ${sessionId}`)
    return await this.materializeRecord(record)
  }

  async getMessages(sessionId: string): Promise<ChatMessageRecord[]> {
    this.requireSession(sessionId)
    return await this.dependencies.transcript.getMessages(sessionId)
  }

  async listMessagesPage(
    sessionId: string,
    options?: { limit?: number; cursor?: MessagePageCursor | null }
  ): Promise<ChatMessagePageResult> {
    this.requireSession(sessionId)
    return await this.dependencies.transcript.listMessagesPage(sessionId, options)
  }

  async getTapeInfo(sessionId: string): Promise<AgentTapeInfo> {
    this.requireSession(sessionId)
    return await this.dependencies.tape.getTapeInfo(sessionId)
  }

  async searchTape(
    sessionId: string,
    query: string,
    options?: AgentTapeSearchOptions
  ): Promise<AgentTapeSearchResult[]> {
    this.requireSession(sessionId)
    return await this.dependencies.tape.searchTape(sessionId, query, options)
  }

  async getTapeContext(
    sessionId: string,
    entryIds: number[],
    options?: AgentTapeContextOptions
  ): Promise<AgentTapeContextResult> {
    this.requireSession(sessionId)
    return await this.dependencies.tape.getTapeContext(sessionId, entryIds, options)
  }

  async listTapeAnchors(
    sessionId: string,
    options?: AgentTapeAnchorsOptions
  ): Promise<AgentTapeAnchorResult[]> {
    this.requireSession(sessionId)
    return await this.dependencies.tape.listTapeAnchors(sessionId, options)
  }

  async handoffTape(
    sessionId: string,
    name: string,
    state: AgentTapeHandoffState
  ): Promise<AgentTapeAnchorResult> {
    this.requireSession(sessionId)
    return await this.dependencies.tape.handoffTape(sessionId, name, state)
  }

  async listMessageViewManifests(messageId: string): Promise<DeepChatTapeViewManifestRecord[]> {
    const normalizedMessageId = messageId?.trim()
    if (!normalizedMessageId) return []

    const message = this.dependencies.messages.get(normalizedMessageId)
    if (!message || !this.dependencies.sessions.get(message.session_id)) return []

    try {
      return await this.dependencies.tape.listMessageViewManifests(
        message.session_id,
        normalizedMessageId
      )
    } catch (error) {
      logger.warn('[SessionQuery] Failed to list message view manifests', {
        messageId: normalizedMessageId,
        error
      })
      return []
    }
  }

  async exportMessageTapeReplaySlice(
    messageId: string,
    options?: DeepChatTapeReplayExportOptions
  ): Promise<DeepChatTapeReplaySlice | null> {
    const normalizedMessageId = messageId?.trim()
    if (!normalizedMessageId) return null

    const message = this.dependencies.messages.get(normalizedMessageId)
    if (!message || !this.dependencies.sessions.get(message.session_id)) return null

    try {
      return await this.dependencies.tape.exportMessageTapeReplaySlice(
        message.session_id,
        normalizedMessageId,
        options
      )
    } catch (error) {
      logger.warn('[SessionQuery] Failed to export tape replay slice', {
        messageId: normalizedMessageId,
        error
      })
      return null
    }
  }

  async getSearchResults(messageId: string, searchId?: string): Promise<SearchResult[]> {
    const normalizedMessageId = messageId?.trim()
    if (!normalizedMessageId) return []

    const parsed: SearchResult[] = []
    for (const row of this.dependencies.searchResults.listByMessageId(normalizedMessageId)) {
      try {
        const result = JSON.parse(row.content) as SearchResult
        parsed.push({
          ...result,
          rank: typeof result.rank === 'number' ? result.rank : (row.rank ?? undefined),
          searchId: result.searchId ?? row.search_id ?? undefined
        })
      } catch (error) {
        console.warn('[SessionQuery] Failed to parse search result row:', error)
      }
    }

    if (searchId) {
      const filtered = parsed.filter((item) => item.searchId === searchId)
      if (filtered.length > 0) return filtered
      const legacy = parsed.filter((item) => !item.searchId)
      if (legacy.length > 0) return legacy
    }

    return parsed
  }

  async listMessageTraces(messageId: string): Promise<MessageTraceRecord[]> {
    if (!messageId?.trim()) return []
    return this.dependencies.traces.listByMessageId(messageId).map((row) => ({
      id: row.id,
      messageId: row.message_id,
      sessionId: row.session_id,
      providerId: row.provider_id,
      modelId: row.model_id,
      requestSeq: row.request_seq,
      endpoint: row.endpoint,
      headersJson: row.headers_json,
      bodyJson: row.body_json,
      truncated: row.truncated === 1,
      createdAt: row.created_at
    }))
  }

  async getMessageTraceCount(messageId: string): Promise<number> {
    const normalizedMessageId = messageId?.trim()
    if (!normalizedMessageId) return 0
    return this.dependencies.traces.countByMessageId(normalizedMessageId)
  }

  async getMessageIds(sessionId: string): Promise<string[]> {
    this.requireSession(sessionId)
    return await this.dependencies.transcript.getMessageIds(sessionId)
  }

  async getMessage(messageId: string): Promise<ChatMessageRecord | null> {
    return await this.dependencies.transcript.getMessage(messageId)
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    this.requireSession(sessionId)
    const normalized = title.trim()
    if (!normalized) throw new Error('Session title cannot be empty.')

    this.dependencies.sessions.update(sessionId, { title: normalized })
    this.notify({ sessionIds: [sessionId], reason: 'updated' })
  }

  async toggleSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
    this.requireSession(sessionId)
    this.dependencies.sessions.update(sessionId, { isPinned: pinned })
    this.notify({ sessionIds: [sessionId], reason: 'updated' })
  }

  notify(options: SessionProjectionUpdate = {}): void {
    const sessionIds = Array.from(
      new Set(options.sessionIds?.map((sessionId) => sessionId.trim()).filter(Boolean) ?? [])
    )
    const reason = options.reason ?? (sessionIds.length > 0 ? 'updated' : 'list-refreshed')

    this.dependencies.events.publish({
      sessionIds,
      reason,
      activeSessionId: options.activeSessionId,
      webContentsId: options.webContentsId
    })
    if (reason !== 'activated' && reason !== 'deactivated') {
      this.dependencies.ui.refreshSessionUi()
    }
  }

  scheduleTitleGeneration(input: TitleGenerationInput): void {
    void this.generateSessionTitle(input)
  }

  private requireSession(sessionId: string): SessionRecord {
    const session = this.dependencies.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return session
  }

  private async materializeRecord(
    record: SessionRecord,
    mode: 'full' | 'list' = 'full'
  ): Promise<SessionWithState> {
    const state = await this.dependencies.runtime.snapshot(record.id, {
      lightweight: mode === 'list'
    })
    const status = state?.status ?? 'idle'
    return {
      ...record,
      status,
      providerId: state?.providerId ?? '',
      modelId: state?.modelId ?? ''
    }
  }

  private async tryMaterializeRecord(
    record: SessionRecord,
    mode: 'full' | 'list' = 'full'
  ): Promise<SessionWithState | null> {
    try {
      return await this.materializeRecord(record, mode)
    } catch (error) {
      console.warn(
        `[SessionQuery] Skipping unavailable session id=${record.id} agent=${record.agentId}:`,
        error
      )
      return null
    }
  }

  private async mapSessionRecordToListItem(record: SessionRecord): Promise<SessionListItem> {
    let status: SessionListItem['status'] = 'idle'
    try {
      status = (await this.dependencies.runtime.snapshotIfHydrated(record.id))?.status ?? 'idle'
    } catch {
      // Lightweight reads remain available when an Agent is unavailable.
    }
    return {
      ...record,
      status
    }
  }

  private dedupeAndSortSessionListItems(items: SessionListItem[]): SessionListItem[] {
    const sessionMap = new Map<string, SessionListItem>()
    for (const item of items) sessionMap.set(item.id, item)

    return Array.from(sessionMap.values()).sort((left, right) => {
      if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt
      return right.id.localeCompare(left.id)
    })
  }

  private matchesLightweightFilter(
    record: SessionRecord,
    options?: Pick<SessionLightweightOptions, 'includeSubagents' | 'agentId'>
  ): boolean {
    if (options?.agentId && record.agentId !== options.agentId) return false
    return options?.includeSubagents === true || record.sessionKind !== 'subagent'
  }

  private async generateSessionTitle(input: TitleGenerationInput): Promise<void> {
    const { sessionId, initialTitle, fallbackProviderId, fallbackModelId } = input
    try {
      const titleMessages = await this.waitForSessionTitleMessages(sessionId)
      if (!titleMessages) return

      const currentSession = this.dependencies.sessions.get(sessionId)
      if (!currentSession || currentSession.title !== initialTitle) return

      const assistantSelection = await this.resolveAssistantModelSelection(
        currentSession.agentId,
        fallbackProviderId,
        fallbackModelId
      )

      let generatedTitle: string
      try {
        generatedTitle = await this.dependencies.titles.summaryTitles(
          titleMessages,
          assistantSelection.providerId,
          assistantSelection.modelId
        )
      } catch (error) {
        const shouldFallback =
          assistantSelection.providerId !== fallbackProviderId ||
          assistantSelection.modelId !== fallbackModelId
        if (!shouldFallback) throw error
        generatedTitle = await this.dependencies.titles.summaryTitles(
          titleMessages,
          fallbackProviderId,
          fallbackModelId
        )
      }

      const normalized = this.normalizeGeneratedTitle(generatedTitle)
      if (!normalized || normalized === initialTitle) return

      const latest = this.dependencies.sessions.get(sessionId)
      if (!latest || latest.title !== initialTitle) return

      this.dependencies.sessions.update(sessionId, { title: normalized })
      this.notify({ sessionIds: [sessionId], reason: 'updated' })
    } catch (error) {
      console.warn(`[SessionQuery] title generation skipped for session=${sessionId}:`, error)
    }
  }

  private async resolveAssistantModelSelection(
    agentId: string,
    fallbackProviderId: string,
    fallbackModelId: string
  ): Promise<{ providerId: string; modelId: string }> {
    if (this.dependencies.runtime.getAgentKind(agentId) === 'deepchat') {
      const assistantModel = await this.dependencies.agentConfig.getAssistantModel(agentId)
      const providerId = assistantModel?.providerId?.trim()
      const modelId = assistantModel?.modelId?.trim()
      if (providerId && modelId) return { providerId, modelId }
    }

    return { providerId: fallbackProviderId, modelId: fallbackModelId }
  }

  private async waitForSessionTitleMessages(
    sessionId: string
  ): Promise<Array<{ role: 'system' | 'user' | 'assistant'; content: string }> | null> {
    const maxWaitMs = 30000
    const pollMs = 250
    const startedAt = Date.now()
    const readTitleMessages = async () => {
      const titleMessages = this.buildTitleMessages(
        await this.dependencies.transcript.getMessages(sessionId)
      )
      return titleMessages.length > 0 ? titleMessages : null
    }

    while (Date.now() - startedAt < maxWaitMs) {
      if (!this.dependencies.sessions.get(sessionId)) return null

      const state = await this.dependencies.runtime.snapshot(sessionId)
      if (!state || state.status === 'error') return null
      if (state.status === 'idle') {
        const titleMessages = await readTitleMessages()
        if (titleMessages) return titleMessages
      }

      const remainingMs = maxWaitMs - (Date.now() - startedAt)
      const ready = await this.dependencies.runtime.waitForFirstTurnReady(sessionId, {
        timeoutMs: Math.min(pollMs, Math.max(0, remainingMs))
      })
      if (!ready) continue

      const titleMessages = await readTitleMessages()
      if (titleMessages) return titleMessages
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }

    return null
  }

  private buildTitleMessages(
    records: ChatMessageRecord[]
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const sorted = [...records].sort((left, right) => left.orderSeq - right.orderSeq)
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []

    for (const record of sorted) {
      if (record.role === 'user') {
        const text = this.extractUserText(record.content)
        if (text) messages.push({ role: 'user', content: text })
      } else if (record.role === 'assistant') {
        const text = this.extractAssistantText(record.content)
        if (text) messages.push({ role: 'assistant', content: text })
      }
    }

    return messages.slice(0, 6)
  }

  private extractUserText(content: string): string {
    try {
      const parsed = JSON.parse(content) as UserMessageContent | string
      if (typeof parsed === 'string') return parsed.trim()
      return typeof parsed.text === 'string' ? parsed.text.trim() : ''
    } catch {
      return content.trim()
    }
  }

  private extractAssistantText(content: string): string {
    try {
      const parsed = JSON.parse(content) as AssistantMessageBlock[] | string
      if (typeof parsed === 'string') return parsed.trim()
      if (!Array.isArray(parsed)) return ''
      return parsed
        .filter((block) => block.type === 'content')
        .map((block) => block.content)
        .join('\n')
        .trim()
    } catch {
      return content.trim()
    }
  }

  private normalizeGeneratedTitle(rawTitle: string): string {
    if (!rawTitle) return ''
    let cleaned = rawTitle.replace(/<think>.*?<\/think>/gs, '').trim()
    cleaned = cleaned.replace(/^<think>/, '').trim()
    cleaned = cleaned.replace(/^["'`]+|["'`]+$/g, '').trim()
    return cleaned.length > 80 ? cleaned.slice(0, 80).trim() : cleaned
  }
}
