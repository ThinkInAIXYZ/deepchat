import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3-multiple-ciphers'
import type { SQLitePresenter } from '../sqlitePresenter'
import type {
  AssistantMessageBlock,
  LegacyImportStatus,
  UserMessageContent
} from '@shared/types/agent-interface'
import type { SearchResult } from '@shared/types/core/search'

type LegacyRow = Record<string, unknown>

const IMPORT_KEY = 'legacy_chat_db_import_v1'
const SKILL_REPAIR_KEY = 'legacy_chat_skill_repair_v1'

const DEFAULT_USER_CONTENT: UserMessageContent = {
  text: '',
  files: [],
  links: [],
  search: false,
  think: false
}

export class LegacyChatImportService {
  private readonly sqlitePresenter: SQLitePresenter
  private readonly sourceDbPath: string
  private runningPromise: Promise<LegacyImportStatus> | null = null
  private skillRepairPromise: Promise<void> | null = null

  constructor(sqlitePresenter: SQLitePresenter, sourceDbPath?: string) {
    this.sqlitePresenter = sqlitePresenter
    this.sourceDbPath = sourceDbPath ?? path.join(app.getPath('userData'), 'app_db', 'chat.db')
  }

  startInBackground(force: boolean = false): void {
    void this.start(force).catch((error) => {
      console.error('[LegacyChatImport] Background import failed:', error)
    })
  }

  async start(force: boolean = false): Promise<LegacyImportStatus> {
    if (this.runningPromise) {
      return this.runningPromise
    }

    this.runningPromise = this.runImport(force).finally(() => {
      this.runningPromise = null
    })

    return this.runningPromise
  }

  async retry(): Promise<LegacyImportStatus> {
    return this.start(true)
  }

  async repairImportedLegacySessionSkills(sessionId: string): Promise<string[]> {
    const normalizedSessionId = sessionId?.trim()
    if (!normalizedSessionId.startsWith('legacy-session-')) {
      return this.sqlitePresenter.newSessionsTable.getActiveSkills(normalizedSessionId)
    }

    const currentSkills = this.sqlitePresenter.newSessionsTable.getActiveSkills(normalizedSessionId)
    if (currentSkills.length > 0) {
      return currentSkills
    }

    await this.ensureImportedLegacySkillRepair()
    return this.sqlitePresenter.newSessionsTable.getActiveSkills(normalizedSessionId)
  }

  async importFromSourceDb(
    sourceDbPath: string,
    mode: 'increment' | 'overwrite' = 'increment'
  ): Promise<{
    importedSessions: number
    importedMessages: number
    importedSearchResults: number
  }> {
    const normalizedPath = sourceDbPath?.trim()
    if (!normalizedPath) {
      throw new Error('Legacy source database path is required')
    }

    if (!fs.existsSync(normalizedPath)) {
      throw new Error(`Legacy source database not found: ${normalizedPath}`)
    }

    let legacyDb: Database.Database | null = null
    const closeLegacyDb = () => {
      if (!legacyDb) return
      try {
        legacyDb.close()
      } catch (error) {
        console.warn('[LegacyChatImport] Failed to close source database handle:', error)
      } finally {
        legacyDb = null
      }
    }

    try {
      legacyDb = new Database(normalizedPath, { readonly: true, fileMustExist: true })
      legacyDb.pragma('query_only = TRUE')

      const conversations = this.readTableRows(legacyDb, 'conversations')
      const messageRows = this.readTableRows(legacyDb, 'messages')
      const attachmentRows = this.readTableRows(legacyDb, 'message_attachments')
      const acpSessionRows = this.readTableRows(legacyDb, 'acp_sessions')
      closeLegacyDb()

      if (mode === 'overwrite') {
        await this.sqlitePresenter.clearNewAgentData()
      }

      if (conversations.length === 0) {
        return {
          importedSessions: 0,
          importedMessages: 0,
          importedSearchResults: 0
        }
      }

      return await this.importRows({
        conversations,
        messageRows,
        attachmentRows,
        acpSessionRows
      })
    } finally {
      closeLegacyDb()
      this.cleanupSidecarFiles(normalizedPath)
    }
  }

  getStatus(): LegacyImportStatus {
    const row = this.sqlitePresenter.legacyImportStatusTable.get(IMPORT_KEY)
    if (!row) {
      return {
        status: 'idle',
        sourceDbPath: this.sourceDbPath,
        startedAt: null,
        finishedAt: null,
        importedSessions: 0,
        importedMessages: 0,
        importedSearchResults: 0,
        error: null,
        updatedAt: Date.now()
      }
    }
    return {
      status: row.status,
      sourceDbPath: row.source_db_path,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      importedSessions: row.imported_sessions,
      importedMessages: row.imported_messages,
      importedSearchResults: row.imported_search_results,
      error: row.error,
      updatedAt: row.updated_at
    }
  }

  private async runImport(force: boolean): Promise<LegacyImportStatus> {
    const current = this.sqlitePresenter.legacyImportStatusTable.get(IMPORT_KEY)
    if (!force && current?.status === 'completed') {
      return this.getStatus()
    }

    if (!fs.existsSync(this.sourceDbPath)) {
      const now = Date.now()
      this.sqlitePresenter.legacyImportStatusTable.upsert(IMPORT_KEY, {
        status: 'skipped',
        sourceDbPath: this.sourceDbPath,
        startedAt: now,
        finishedAt: now,
        importedSessions: 0,
        importedMessages: 0,
        importedSearchResults: 0,
        error: null,
        updatedAt: now
      })
      return this.getStatus()
    }

    const startedAt = Date.now()
    this.sqlitePresenter.legacyImportStatusTable.upsert(IMPORT_KEY, {
      status: 'running',
      sourceDbPath: this.sourceDbPath,
      startedAt,
      finishedAt: null,
      importedSessions: 0,
      importedMessages: 0,
      importedSearchResults: 0,
      error: null,
      updatedAt: startedAt
    })

    let legacyDb: Database.Database | null = null
    const closeLegacyDb = () => {
      if (!legacyDb) {
        return
      }
      try {
        legacyDb.close()
      } catch (error) {
        console.warn('[LegacyChatImport] Failed to close legacy database handle:', error)
      } finally {
        legacyDb = null
      }
    }
    try {
      legacyDb = new Database(this.sourceDbPath, { readonly: true, fileMustExist: true })
      legacyDb.pragma('query_only = TRUE')

      const conversations = this.readTableRows(legacyDb, 'conversations')
      if (conversations.length === 0) {
        const finishedAt = Date.now()
        this.sqlitePresenter.legacyImportStatusTable.upsert(IMPORT_KEY, {
          status: 'completed',
          sourceDbPath: this.sourceDbPath,
          startedAt,
          finishedAt,
          importedSessions: 0,
          importedMessages: 0,
          importedSearchResults: 0,
          error: null,
          updatedAt: finishedAt
        })
        return this.getStatus()
      }

      const messageRows = this.readTableRows(legacyDb, 'messages')
      const attachmentRows = this.readTableRows(legacyDb, 'message_attachments')
      const acpSessionRows = this.readTableRows(legacyDb, 'acp_sessions')
      // Release legacy database handle immediately after snapshot read.
      // Import write path below may be long-running.
      closeLegacyDb()

      const summary = await this.importRows({
        conversations,
        messageRows,
        attachmentRows,
        acpSessionRows
      })

      const finishedAt = Date.now()
      this.sqlitePresenter.legacyImportStatusTable.upsert(IMPORT_KEY, {
        status: 'completed',
        sourceDbPath: this.sourceDbPath,
        startedAt,
        finishedAt,
        importedSessions: summary.importedSessions,
        importedMessages: summary.importedMessages,
        importedSearchResults: summary.importedSearchResults,
        error: null,
        updatedAt: finishedAt
      })
      return this.getStatus()
    } catch (error) {
      const finishedAt = Date.now()
      this.sqlitePresenter.legacyImportStatusTable.upsert(IMPORT_KEY, {
        status: 'failed',
        sourceDbPath: this.sourceDbPath,
        startedAt,
        finishedAt,
        importedSessions: 0,
        importedMessages: 0,
        importedSearchResults: 0,
        error: error instanceof Error ? error.message : String(error),
        updatedAt: finishedAt
      })
      return this.getStatus()
    } finally {
      closeLegacyDb()
      this.cleanupSidecarFiles(this.sourceDbPath)
    }
  }

  private cleanupSidecarFiles(dbPath: string): void {
    const walPath = `${dbPath}-wal`
    const shmPath = `${dbPath}-shm`

    if (fs.existsSync(walPath)) {
      try {
        const walStat = fs.statSync(walPath)
        // Non-empty WAL may still contain committed frames; do not delete it.
        if (walStat.size > 0) {
          return
        }
        fs.unlinkSync(walPath)
      } catch (error) {
        console.warn('[LegacyChatImport] Failed to cleanup WAL sidecar:', error)
      }
    }

    if (fs.existsSync(shmPath)) {
      try {
        fs.unlinkSync(shmPath)
      } catch (error) {
        console.warn('[LegacyChatImport] Failed to cleanup SHM sidecar:', error)
      }
    }
  }

  private async importRows(payload: {
    conversations: LegacyRow[]
    messageRows: LegacyRow[]
    attachmentRows: LegacyRow[]
    acpSessionRows: LegacyRow[]
  }): Promise<{
    importedSessions: number
    importedMessages: number
    importedSearchResults: number
  }> {
    let importedSessions = 0
    let importedMessages = 0
    let importedSearchResults = 0

    const rowsByConversation = new Map<string, LegacyRow[]>()
    for (const row of payload.messageRows) {
      const conversationId = this.pickString(row, ['conversation_id'])
      if (!conversationId) continue
      const list = rowsByConversation.get(conversationId) ?? []
      list.push(row)
      rowsByConversation.set(conversationId, list)
    }

    const attachmentRowsByMessage = new Map<string, LegacyRow[]>()
    for (const row of payload.attachmentRows) {
      const type = this.pickString(row, ['type'])?.toLowerCase() ?? ''
      if (type !== 'search_result' && type !== 'search_results') {
        continue
      }
      const messageId = this.pickString(row, ['message_id'])
      if (!messageId) continue
      const list = attachmentRowsByMessage.get(messageId) ?? []
      list.push(row)
      attachmentRowsByMessage.set(messageId, list)
    }

    const acpWorkdirByConversationAndAgent = new Map<string, string>()
    for (const row of payload.acpSessionRows) {
      const conversationId = this.pickString(row, ['conversation_id'])
      const agentId = this.pickString(row, ['agent_id'])
      const workdir = this.pickString(row, ['workdir'])
      if (!conversationId || !agentId || !workdir) continue
      acpWorkdirByConversationAndAgent.set(`${conversationId}::${agentId}`, workdir)
    }

    await this.sqlitePresenter.runTransaction(() => {
      for (const conversation of payload.conversations) {
        const oldConversationId = this.pickString(conversation, ['conv_id', 'id'])
        if (!oldConversationId) {
          continue
        }

        const sessionId = this.toLegacySessionId(oldConversationId)
        const title = this.pickString(conversation, ['title']) || 'Imported Chat'
        const providerId = this.pickString(conversation, ['provider_id']) || 'openai'
        const modelId = this.pickString(conversation, ['model_id']) || 'gpt-4'
        const agentId = providerId === 'acp' && modelId ? modelId : 'deepchat'
        const isPinned = this.pickNumber(conversation, ['is_pinned']) === 1
        const createdAt = this.pickNumber(conversation, ['created_at']) ?? Date.now()
        const updatedAt = this.pickNumber(conversation, ['updated_at']) ?? createdAt
        const importedActiveSkills = this.parseStringArray(
          this.pickString(conversation, ['active_skills']) ?? ''
        )

        let projectDir = this.pickString(conversation, ['agent_workspace_path', 'workdir']) ?? null
        if (!projectDir && agentId !== 'deepchat') {
          const workdirMap = this.parseJsonRecord(
            this.pickString(conversation, ['acp_workdir_map']) ?? ''
          )
          if (workdirMap && typeof workdirMap[agentId] === 'string') {
            projectDir = workdirMap[agentId] as string
          }
        }
        if (!projectDir && agentId !== 'deepchat') {
          projectDir =
            acpWorkdirByConversationAndAgent.get(`${oldConversationId}::${agentId}`) ?? null
        }

        if (!this.sqlitePresenter.newSessionsTable.get(sessionId)) {
          this.sqlitePresenter.newSessionsTable.create(sessionId, agentId, title, projectDir, {
            isPinned,
            isDraft: false,
            activeSkills: importedActiveSkills,
            createdAt,
            updatedAt
          })
          importedSessions += 1
        }

        if (!this.sqlitePresenter.deepchatSessionsTable.get(sessionId)) {
          this.sqlitePresenter.deepchatSessionsTable.create(
            sessionId,
            providerId,
            modelId,
            'full_access',
            {
              systemPrompt: this.pickString(conversation, ['system_prompt']) ?? undefined,
              temperature: this.pickNumber(conversation, ['temperature']) ?? undefined,
              contextLength: this.pickNumber(conversation, ['context_length']) ?? undefined,
              maxTokens: this.pickNumber(conversation, ['max_tokens']) ?? undefined,
              thinkingBudget: this.pickNumber(conversation, ['thinking_budget']) ?? undefined,
              reasoningEffort:
                this.pickString(conversation, ['reasoning_effort']) === 'minimal' ||
                this.pickString(conversation, ['reasoning_effort']) === 'low' ||
                this.pickString(conversation, ['reasoning_effort']) === 'medium' ||
                this.pickString(conversation, ['reasoning_effort']) === 'high'
                  ? (this.pickString(conversation, ['reasoning_effort']) as
                      | 'minimal'
                      | 'low'
                      | 'medium'
                      | 'high')
                  : undefined,
              verbosity:
                this.pickString(conversation, ['verbosity']) === 'low' ||
                this.pickString(conversation, ['verbosity']) === 'medium' ||
                this.pickString(conversation, ['verbosity']) === 'high'
                  ? (this.pickString(conversation, ['verbosity']) as 'low' | 'medium' | 'high')
                  : undefined
            }
          )
        }

        const messageRows = (rowsByConversation.get(oldConversationId) ?? []).sort((a, b) =>
          this.compareMessageRows(a, b)
        )
        const variantByParent = new Map<string, LegacyRow>()
        for (const row of messageRows) {
          const isVariant = this.pickNumber(row, ['is_variant']) === 1
          const role = this.pickString(row, ['role'])
          const parentId = this.pickString(row, ['parent_id'])
          if (isVariant && role === 'assistant' && parentId) {
            variantByParent.set(parentId, row)
          }
        }

        const oldToNewMessageId = new Map<string, string>()
        const messageToSession = new Map<string, string>()
        let nextOrderSeq = 1

        for (const row of messageRows) {
          if (this.pickNumber(row, ['is_variant']) === 1) {
            continue
          }

          const role = this.pickString(row, ['role'])
          if (role !== 'user' && role !== 'assistant') {
            continue
          }

          const oldMessageId = this.pickString(row, ['msg_id', 'id'])
          if (!oldMessageId) {
            continue
          }

          const parentId = this.pickString(row, ['parent_id']) || ''
          const selectedVariant =
            role === 'assistant' && parentId ? (variantByParent.get(parentId) ?? row) : row
          const selectedVariantId =
            this.pickString(selectedVariant, ['msg_id', 'id']) || oldMessageId
          const messageId = this.toLegacyMessageId(oldMessageId)

          oldToNewMessageId.set(oldMessageId, messageId)
          oldToNewMessageId.set(selectedVariantId, messageId)
          messageToSession.set(messageId, sessionId)

          if (this.sqlitePresenter.deepchatMessagesTable.get(messageId)) {
            nextOrderSeq += 1
            continue
          }

          const normalizedContent =
            role === 'user'
              ? this.normalizeUserContent(this.pickString(selectedVariant, ['content']) || '')
              : this.normalizeAssistantContent(this.pickString(selectedVariant, ['content']) || '')

          this.sqlitePresenter.deepchatMessagesTable.insert({
            id: messageId,
            sessionId,
            orderSeq: nextOrderSeq,
            role: role as 'user' | 'assistant',
            content: normalizedContent,
            status: this.normalizeMessageStatus(
              this.pickString(selectedVariant, ['status']) || 'sent'
            ),
            isContextEdge: this.pickNumber(selectedVariant, ['is_context_edge']) === 1 ? 1 : 0,
            metadata: this.normalizeMetadata(
              this.pickString(selectedVariant, ['metadata']) || '{}'
            ),
            createdAt:
              this.pickNumber(selectedVariant, ['created_at']) ??
              this.pickNumber(row, ['created_at']) ??
              Date.now(),
            updatedAt:
              this.pickNumber(selectedVariant, ['created_at']) ??
              this.pickNumber(row, ['created_at']) ??
              Date.now()
          })

          importedMessages += 1
          nextOrderSeq += 1
        }

        for (const [oldMessageId, attachmentRows] of attachmentRowsByMessage.entries()) {
          const messageId = oldToNewMessageId.get(oldMessageId)
          if (!messageId) {
            continue
          }
          const bindSessionId = messageToSession.get(messageId)
          if (!bindSessionId) {
            continue
          }

          for (const attachmentRow of attachmentRows) {
            const raw = this.pickString(attachmentRow, ['content']) || ''
            const parsedResults = this.parseSearchResults(raw)
            for (const result of parsedResults) {
              const inserted = this.sqlitePresenter.deepchatMessageSearchResultsTable.add({
                sessionId: bindSessionId,
                messageId,
                searchId: result.searchId ?? null,
                rank: typeof result.rank === 'number' ? result.rank : null,
                content: JSON.stringify(result)
              })
              if (inserted) {
                importedSearchResults += 1
              }
            }
          }
        }
      }
    })
    this.sqlitePresenter.newEnvironmentsTable.rebuildFromSessions()

    return {
      importedSessions,
      importedMessages,
      importedSearchResults
    }
  }

  private parseSearchResults(raw: string): SearchResult[] {
    if (!raw.trim()) {
      return []
    }

    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => this.normalizeSearchResult(item))
          .filter((item): item is SearchResult => item !== null)
      }
      const normalized = this.normalizeSearchResult(parsed)
      return normalized ? [normalized] : []
    } catch (error) {
      console.warn('[LegacyChatImport] Failed to parse search attachment payload:', error)
      return []
    }
  }

  private normalizeSearchResult(value: unknown): SearchResult | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null
    }
    const row = value as Record<string, unknown>
    const url = typeof row.url === 'string' ? row.url.trim() : ''
    if (!url) {
      return null
    }

    return {
      title: typeof row.title === 'string' ? row.title : '',
      url,
      snippet:
        typeof row.snippet === 'string'
          ? row.snippet
          : typeof row.description === 'string'
            ? row.description
            : undefined,
      content: typeof row.content === 'string' ? row.content : undefined,
      description: typeof row.description === 'string' ? row.description : undefined,
      icon: typeof row.icon === 'string' ? row.icon : undefined,
      favicon: typeof row.favicon === 'string' ? row.favicon : undefined,
      rank: typeof row.rank === 'number' ? row.rank : undefined,
      searchId: typeof row.searchId === 'string' ? row.searchId : undefined
    }
  }

  private normalizeUserContent(raw: string): string {
    if (!raw.trim()) {
      return JSON.stringify(DEFAULT_USER_CONTENT)
    }

    try {
      const parsed = JSON.parse(raw) as unknown
      if (typeof parsed === 'string') {
        return JSON.stringify({
          ...DEFAULT_USER_CONTENT,
          text: parsed
        })
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return JSON.stringify(DEFAULT_USER_CONTENT)
      }

      const row = parsed as Record<string, unknown>
      const normalized: UserMessageContent & { content?: unknown } = {
        ...DEFAULT_USER_CONTENT,
        text: typeof row.text === 'string' ? row.text : '',
        files: Array.isArray(row.files) ? (row.files as UserMessageContent['files']) : [],
        links: Array.isArray(row.links)
          ? row.links.filter((item): item is string => typeof item === 'string')
          : [],
        search: row.search === true,
        think: row.think === true
      }

      if (Array.isArray(row.content)) {
        normalized.content = row.content
      }

      return JSON.stringify(normalized)
    } catch {
      return JSON.stringify({
        ...DEFAULT_USER_CONTENT,
        text: raw
      })
    }
  }

  private normalizeAssistantContent(raw: string): string {
    const buildTextBlock = (content: string): AssistantMessageBlock[] => [
      {
        type: 'content',
        content,
        status: 'success',
        timestamp: Date.now()
      }
    ]

    if (!raw.trim()) {
      return JSON.stringify([])
    }

    try {
      const parsed = JSON.parse(raw) as unknown
      if (typeof parsed === 'string') {
        return JSON.stringify(buildTextBlock(parsed))
      }
      if (Array.isArray(parsed)) {
        return JSON.stringify(parsed)
      }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return JSON.stringify([parsed])
      }
      return JSON.stringify(buildTextBlock(raw))
    } catch {
      return JSON.stringify(buildTextBlock(raw))
    }
  }

  private normalizeMetadata(raw: string): string {
    if (!raw.trim()) {
      return '{}'
    }
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object') {
        return JSON.stringify(parsed)
      }
      return '{}'
    } catch {
      return '{}'
    }
  }

  private normalizeMessageStatus(status: string): 'pending' | 'sent' | 'error' {
    if (status === 'pending' || status === 'sent' || status === 'error') {
      return status
    }
    return 'sent'
  }

  private toLegacySessionId(oldConversationId: string): string {
    return `legacy-session-${oldConversationId}`
  }

  private toLegacyMessageId(oldMessageId: string): string {
    return `legacy-msg-${oldMessageId}`
  }

  private compareMessageRows(a: LegacyRow, b: LegacyRow): number {
    const orderSeqA = this.pickNumber(a, ['order_seq']) ?? 0
    const orderSeqB = this.pickNumber(b, ['order_seq']) ?? 0
    if (orderSeqA !== orderSeqB) {
      return orderSeqA - orderSeqB
    }

    const createdAtA = this.pickNumber(a, ['created_at']) ?? 0
    const createdAtB = this.pickNumber(b, ['created_at']) ?? 0
    if (createdAtA !== createdAtB) {
      return createdAtA - createdAtB
    }

    const idA = this.pickString(a, ['msg_id', 'id']) ?? ''
    const idB = this.pickString(b, ['msg_id', 'id']) ?? ''
    return idA.localeCompare(idB)
  }

  private readTableRows(db: Database.Database, tableName: string): LegacyRow[] {
    const exists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName)
    if (!exists) {
      return []
    }
    return db.prepare(`SELECT * FROM "${tableName}"`).all() as LegacyRow[]
  }

  private parseJsonRecord(raw: string): Record<string, unknown> | null {
    if (!raw.trim()) {
      return null
    }
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
      return null
    } catch {
      return null
    }
  }

  private pickString(row: LegacyRow, keys: string[]): string | null {
    for (const key of keys) {
      const value = row[key]
      if (typeof value === 'string') {
        return value
      }
    }
    return null
  }

  private pickNumber(row: LegacyRow, keys: string[]): number | null {
    for (const key of keys) {
      const value = row[key]
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value
      }
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) {
          return parsed
        }
      }
    }
    return null
  }

  private parseStringArray(raw: string): string[] {
    if (!raw.trim()) {
      return []
    }

    try {
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : []
    } catch {
      return []
    }
  }

  private async ensureImportedLegacySkillRepair(): Promise<void> {
    const status = this.sqlitePresenter.legacyImportStatusTable.get(SKILL_REPAIR_KEY)
    if (status?.status === 'completed') {
      return
    }

    if (this.skillRepairPromise) {
      await this.skillRepairPromise
      return
    }

    this.skillRepairPromise = (async () => {
      const startedAt = status?.started_at ?? Date.now()
      this.sqlitePresenter.legacyImportStatusTable.upsert(SKILL_REPAIR_KEY, {
        status: 'running',
        sourceDbPath: this.sourceDbPath,
        startedAt,
        finishedAt: null,
        importedSessions: status?.imported_sessions ?? 0,
        importedMessages: 0,
        importedSearchResults: 0,
        error: null,
        updatedAt: Date.now()
      })

      try {
        const repairedSessions = await this.backfillImportedLegacySessionSkills()
        const finishedAt = Date.now()
        this.sqlitePresenter.legacyImportStatusTable.upsert(SKILL_REPAIR_KEY, {
          status: 'completed',
          sourceDbPath: this.sourceDbPath,
          startedAt,
          finishedAt,
          importedSessions: repairedSessions,
          importedMessages: 0,
          importedSearchResults: 0,
          error: null,
          updatedAt: finishedAt
        })
      } catch (error) {
        const finishedAt = Date.now()
        this.sqlitePresenter.legacyImportStatusTable.upsert(SKILL_REPAIR_KEY, {
          status: 'failed',
          sourceDbPath: this.sourceDbPath,
          startedAt,
          finishedAt,
          importedSessions: status?.imported_sessions ?? 0,
          importedMessages: 0,
          importedSearchResults: 0,
          error: error instanceof Error ? error.message : String(error),
          updatedAt: finishedAt
        })
        throw error
      }
    })().finally(() => {
      this.skillRepairPromise = null
    })

    await this.skillRepairPromise
  }

  private async backfillImportedLegacySessionSkills(): Promise<number> {
    try {
      const total = await this.sqlitePresenter.getConversationCount()
      if (total <= 0) {
        return 0
      }

      const pageSize = 200
      const totalPages = Math.ceil(total / pageSize)
      let repairedSessions = 0

      for (let page = 1; page <= totalPages; page += 1) {
        const { list } = await this.sqlitePresenter.getConversationList(page, pageSize)
        await this.sqlitePresenter.runTransaction(() => {
          for (const conversation of list) {
            const legacySkills = Array.isArray(conversation.settings?.activeSkills)
              ? conversation.settings.activeSkills.filter(
                  (item): item is string => typeof item === 'string'
                )
              : []
            if (legacySkills.length === 0) {
              continue
            }

            const sessionId = this.toLegacySessionId(conversation.id)
            const sessionRow = this.sqlitePresenter.newSessionsTable.get(sessionId)
            if (!sessionRow) {
              continue
            }

            const currentSkills = this.sqlitePresenter.newSessionsTable.getActiveSkills(sessionId)
            if (currentSkills.length > 0) {
              continue
            }

            this.sqlitePresenter.newSessionsTable.updateActiveSkills(sessionId, legacySkills)
            repairedSessions += 1
          }
        })
      }

      return repairedSessions
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('no such table')) {
        return 0
      }
      throw error
    }
  }
}
