import type {
  Agent,
  IAgentImplementation,
  CreateSessionInput,
  CreateDetachedSessionInput,
  SessionRecord,
  SessionWithState,
  ChatMessageRecord,
  MessageTraceRecord,
  MessageFile,
  SendMessageInput,
  UserMessageContent,
  AssistantMessageBlock,
  LegacyImportStatus,
  PermissionMode,
  SessionCompactionState,
  SessionGenerationSettings,
  DeepChatSubagentMeta,
  ToolInteractionResponse,
  ToolInteractionResult,
  UsageDashboardData,
  UsageDashboardBreakdownItem,
  UsageStatsBackfillStatus
} from '@shared/types/agent-interface'
import type { Message } from '@shared/chat'
import type { SearchResult } from '@shared/types/core/search'
import type {
  AcpConfigState,
  IConfigPresenter,
  HistorySearchHit,
  HistorySearchOptions,
  HistorySearchSessionHit,
  HistorySearchMessageHit,
  ILlmProviderPresenter,
  ISkillPresenter,
  CONVERSATION
} from '@shared/presenter'
import type { SQLitePresenter } from '../sqlitePresenter'
import type { DeepChatAgentPresenter } from '../deepchatAgentPresenter'
import { AgentRegistry } from './agentRegistry'
import { NewSessionManager } from './sessionManager'
import { NewMessageManager } from './messageManager'
import { LegacyChatImportService } from './legacyImportService'
import { eventBus, SendTarget } from '@/eventbus'
import { SESSION_EVENTS } from '@/events'
import { presenter } from '@/presenter'
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
import { rtkRuntimeService } from '@/lib/agentRuntime/rtkRuntimeService'
import { resolveAcpAgentAlias } from '../configPresenter/acpRegistryConstants'

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

const RETIRED_DEFAULT_AGENT_TOOLS = new Set(['find', 'grep', 'ls'])
const LEGACY_AGENT_TOOL_NAME_MAP: Record<string, string> = {
  yo_browser_cdp_send: 'cdp_send',
  yo_browser_window_open: 'load_url',
  yo_browser_window_list: 'get_browser_status'
}

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

export class NewAgentPresenter {
  private agentRegistry: AgentRegistry
  private sessionManager: NewSessionManager
  private messageManager: NewMessageManager
  private sqlitePresenter: SQLitePresenter
  private llmProviderPresenter: ILlmProviderPresenter
  private configPresenter: IConfigPresenter
  private legacyImportService: LegacyChatImportService
  private skillPresenter?: Pick<ISkillPresenter, 'setActiveSkills' | 'clearNewAgentSessionSkills'>
  private usageStatsBackfillPromise: Promise<void> | null = null

  constructor(
    deepchatAgent: DeepChatAgentPresenter,
    llmProviderPresenter: ILlmProviderPresenter,
    configPresenter: IConfigPresenter,
    sqlitePresenter: SQLitePresenter,
    skillPresenter?: Pick<ISkillPresenter, 'setActiveSkills' | 'clearNewAgentSessionSkills'>
  ) {
    this.sqlitePresenter = sqlitePresenter
    this.llmProviderPresenter = llmProviderPresenter
    this.configPresenter = configPresenter
    this.skillPresenter = skillPresenter
    this.agentRegistry = new AgentRegistry()
    this.sessionManager = new NewSessionManager(sqlitePresenter)
    this.messageManager = new NewMessageManager(this.agentRegistry)
    this.legacyImportService = new LegacyChatImportService(sqlitePresenter)

    // Register the built-in deepchat agent
    this.agentRegistry.register(
      { id: 'deepchat', name: 'DeepChat', type: 'deepchat', enabled: true },
      deepchatAgent
    )
  }

  // ---- IPC-facing methods ----

  async createSession(input: CreateSessionInput, webContentsId: number): Promise<SessionWithState> {
    const agentId = input.agentId || 'deepchat'
    console.log(`[NewAgentPresenter] createSession agent=${agentId} webContentsId=${webContentsId}`)
    const normalizedInput = this.normalizeCreateSessionInput(input)
    const agentType = await this.getAgentType(agentId)
    const deepChatAgentConfig =
      agentType === 'deepchat'
        ? await this.configPresenter.resolveDeepChatAgentConfig(agentId)
        : null
    const projectDir =
      input.projectDir?.trim() ||
      deepChatAgentConfig?.defaultProjectPath?.trim() ||
      this.configPresenter.getDefaultProjectPath() ||
      null
    const disabledAgentTools =
      agentType === 'deepchat'
        ? this.normalizeDisabledAgentTools(
            input.disabledAgentTools ?? deepChatAgentConfig?.disabledAgentTools
          )
        : []
    const subagentEnabled = this.resolveSessionSubagentEnabled(
      agentType,
      input.subagentEnabled,
      deepChatAgentConfig?.subagentEnabled
    )

    const agent = await this.resolveAgentImplementation(agentId)

    // Resolve provider/model
    const defaultModel = this.configPresenter.getDefaultModel()
    const providerId =
      input.providerId ??
      deepChatAgentConfig?.defaultModelPreset?.providerId ??
      defaultModel?.providerId ??
      ''
    const modelId =
      input.modelId ??
      deepChatAgentConfig?.defaultModelPreset?.modelId ??
      defaultModel?.modelId ??
      ''
    const permissionMode: PermissionMode =
      input.permissionMode !== undefined
        ? input.permissionMode === 'default'
          ? 'default'
          : 'full_access'
        : deepChatAgentConfig?.permissionMode === 'default'
          ? 'default'
          : 'full_access'
    const generationSettings = this.mergeDeepChatDefaultGenerationSettings(
      deepChatAgentConfig,
      input.generationSettings
    )
    console.log(`[NewAgentPresenter] resolved provider=${providerId} model=${modelId}`)

    if (!providerId || !modelId) {
      throw new Error('No provider or model configured. Please set a default model in settings.')
    }
    this.assertAcpSessionHasWorkdir(providerId, projectDir)

    // Create session record
    const title = normalizedInput.text.slice(0, 50) || 'New Chat'
    const sessionId = this.sessionManager.create(agentId, title, projectDir, {
      isDraft: false,
      disabledAgentTools,
      subagentEnabled
    })
    console.log(`[NewAgentPresenter] session created id=${sessionId} title="${title}"`)

    // Initialize agent-side session
    const initConfig: {
      agentId?: string
      providerId: string
      modelId: string
      projectDir: string | null
      permissionMode: PermissionMode
      generationSettings?: Partial<SessionGenerationSettings>
    } = {
      agentId,
      providerId,
      modelId,
      projectDir,
      permissionMode
    }
    if (generationSettings) {
      initConfig.generationSettings = generationSettings
    }
    try {
      await this.initializeSessionRuntime(agent, sessionId, initConfig)
    } catch (error) {
      await this.cleanupFailedSessionInitialization(agent, sessionId)
      throw error
    }
    console.log(`[NewAgentPresenter] agent.initSession done`)

    // Bind to window and emit activated
    this.sessionManager.bindWindow(webContentsId, sessionId)
    eventBus.sendToRenderer(SESSION_EVENTS.ACTIVATED, SendTarget.ALL_WINDOWS, {
      webContentsId,
      sessionId
    })
    this.emitSessionListUpdated()

    if (input.activeSkills && input.activeSkills.length > 0 && this.skillPresenter) {
      await this.skillPresenter.setActiveSkills(sessionId, input.activeSkills)
    }

    // Return enriched session first
    const state = await agent.getSessionState(sessionId)
    const sessionResult: SessionWithState = {
      id: sessionId,
      agentId,
      title,
      projectDir,
      isPinned: false,
      isDraft: false,
      sessionKind: 'regular',
      parentSessionId: null,
      subagentEnabled,
      subagentMeta: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: state?.status ?? 'idle',
      providerId: state?.providerId ?? providerId,
      modelId: state?.modelId ?? modelId
    }

    // Queue the first message (non-blocking) after returning session ID
    if (normalizedInput.text.trim() || (normalizedInput.files?.length ?? 0) > 0) {
      console.log(`[NewAgentPresenter] firing queuePendingInput (non-blocking)`)
      if (agent.queuePendingInput) {
        agent.queuePendingInput(sessionId, normalizedInput).catch((err) => {
          console.error('[NewAgentPresenter] queuePendingInput failed:', err)
        })
      } else {
        agent.processMessage(sessionId, normalizedInput, { projectDir }).catch((err) => {
          console.error('[NewAgentPresenter] processMessage failed:', err)
        })
      }
    }
    void this.generateSessionTitle(sessionId, title, providerId, modelId)

    return sessionResult
  }

  async createDetachedSession(input: CreateDetachedSessionInput): Promise<SessionWithState> {
    const agentId = input.agentId?.trim() || 'deepchat'
    const title = input.title?.trim() || 'New Chat'
    const agentType = await this.getAgentType(agentId)
    const deepChatAgentConfig =
      agentType === 'deepchat'
        ? await this.configPresenter.resolveDeepChatAgentConfig(agentId)
        : null
    const projectDir =
      input.projectDir?.trim() ||
      deepChatAgentConfig?.defaultProjectPath?.trim() ||
      this.configPresenter.getDefaultProjectPath() ||
      null
    const disabledAgentTools =
      agentType === 'deepchat'
        ? this.normalizeDisabledAgentTools(
            input.disabledAgentTools ?? deepChatAgentConfig?.disabledAgentTools
          )
        : []
    const subagentEnabled = this.resolveSessionSubagentEnabled(
      agentType,
      input.subagentEnabled,
      deepChatAgentConfig?.subagentEnabled
    )
    const agent = await this.resolveAgentImplementation(agentId)

    const defaultModel = this.configPresenter.getDefaultModel()
    const providerId =
      input.providerId ??
      deepChatAgentConfig?.defaultModelPreset?.providerId ??
      defaultModel?.providerId ??
      ''
    const modelId =
      input.modelId ??
      deepChatAgentConfig?.defaultModelPreset?.modelId ??
      defaultModel?.modelId ??
      ''
    const permissionMode: PermissionMode =
      input.permissionMode !== undefined
        ? input.permissionMode === 'default'
          ? 'default'
          : 'full_access'
        : deepChatAgentConfig?.permissionMode === 'default'
          ? 'default'
          : 'full_access'
    const generationSettings = this.mergeDeepChatDefaultGenerationSettings(
      deepChatAgentConfig,
      input.generationSettings
    )

    if (!providerId || !modelId) {
      throw new Error('No provider or model configured. Please set a default model in settings.')
    }
    this.assertAcpSessionHasWorkdir(providerId, projectDir)

    const sessionId = this.sessionManager.create(agentId, title, projectDir, {
      isDraft: false,
      disabledAgentTools,
      subagentEnabled
    })

    try {
      await this.initializeSessionRuntime(agent, sessionId, {
        agentId,
        providerId,
        modelId,
        projectDir,
        permissionMode,
        generationSettings
      })
    } catch (error) {
      await this.cleanupFailedSessionInitialization(agent, sessionId)
      throw error
    }

    if (input.activeSkills && input.activeSkills.length > 0 && this.skillPresenter) {
      await this.skillPresenter.setActiveSkills(sessionId, input.activeSkills)
    }

    this.emitSessionListUpdated()

    const state = await agent.getSessionState(sessionId)
    return {
      id: sessionId,
      agentId,
      title,
      projectDir,
      isPinned: false,
      isDraft: false,
      sessionKind: 'regular',
      parentSessionId: null,
      subagentEnabled,
      subagentMeta: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: state?.status ?? 'idle',
      providerId: state?.providerId ?? providerId,
      modelId: state?.modelId ?? modelId
    }
  }

  async createSubagentSession(input: {
    parentSessionId: string
    agentId: string
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
  }): Promise<SessionWithState> {
    const parentSessionId = input.parentSessionId?.trim()
    if (!parentSessionId) {
      throw new Error('Subagent session requires a parentSessionId.')
    }

    const slotId = input.slotId?.trim()
    if (!slotId) {
      throw new Error('Subagent session requires a slotId.')
    }

    const displayName = input.displayName?.trim() || 'Subagent'
    const agentId = input.agentId?.trim()
    if (!agentId) {
      throw new Error('Subagent session requires an agentId.')
    }

    const projectDir = input.projectDir?.trim() || null
    const disabledAgentTools = this.normalizeDisabledAgentTools(input.disabledAgentTools)
    const subagentMeta: DeepChatSubagentMeta = {
      slotId,
      displayName,
      targetAgentId: input.targetAgentId?.trim() || null
    }

    this.assertAcpSessionHasWorkdir(input.providerId, projectDir)

    const agent = await this.resolveAgentImplementation(agentId)
    const sessionId = this.sessionManager.create(agentId, displayName, projectDir, {
      isDraft: false,
      disabledAgentTools,
      subagentEnabled: false,
      sessionKind: 'subagent',
      parentSessionId,
      subagentMeta
    })

    try {
      await this.initializeSessionRuntime(agent, sessionId, {
        agentId,
        providerId: input.providerId,
        modelId: input.modelId,
        projectDir,
        permissionMode: input.permissionMode,
        generationSettings: input.generationSettings
      })
    } catch (error) {
      await this.cleanupFailedSessionInitialization(agent, sessionId)
      throw error
    }

    if (input.activeSkills && input.activeSkills.length > 0 && this.skillPresenter) {
      await this.skillPresenter.setActiveSkills(sessionId, input.activeSkills)
    }

    this.emitSessionListUpdated()

    const record = this.sessionManager.get(sessionId)
    if (!record) {
      throw new Error(`Subagent session not found after creation: ${sessionId}`)
    }

    return (await this.buildSessionWithState(record)) as SessionWithState
  }

  async ensureAcpDraftSession(input: {
    agentId: string
    projectDir: string
    permissionMode?: PermissionMode
  }): Promise<SessionWithState> {
    const agentId = input.agentId?.trim()
    if (!agentId) {
      throw new Error('ACP draft session requires an agentId.')
    }

    const projectDir = input.projectDir?.trim()
    if (!projectDir) {
      throw new Error('ACP draft session requires a non-empty projectDir.')
    }

    await this.assertAcpAgent(agentId)
    const agent = await this.resolveAgentImplementation(agentId)
    const permissionMode: PermissionMode =
      input.permissionMode === 'default' ? 'default' : 'full_access'

    let record = await this.findReusableDraftSession(agentId, projectDir, agent)
    if (!record) {
      const sessionId = this.sessionManager.create(agentId, 'New Chat', projectDir, {
        isDraft: true,
        subagentEnabled: false
      })
      try {
        await this.ensureSessionRuntimeInitialized(agent, sessionId, {
          agentId,
          providerId: 'acp',
          modelId: agentId,
          projectDir,
          permissionMode
        })
      } catch (error) {
        await this.cleanupFailedSessionInitialization(agent, sessionId)
        throw error
      }
      record = this.sessionManager.get(sessionId)
      if (!record) {
        throw new Error(`Failed to read created ACP draft session: ${sessionId}`)
      }
    } else {
      await this.ensureSessionRuntimeInitialized(agent, record.id, {
        agentId,
        providerId: 'acp',
        modelId: agentId,
        projectDir,
        permissionMode
      })
    }

    await this.llmProviderPresenter.prepareAcpSession(record.id, agentId, projectDir)
    this.emitSessionListUpdated()

    const state = await agent.getSessionState(record.id)
    return {
      ...record,
      status: state?.status ?? 'idle',
      providerId: state?.providerId ?? 'acp',
      modelId: state?.modelId ?? agentId
    }
  }

  async sendMessage(sessionId: string, content: string | SendMessageInput): Promise<void> {
    let session = this.sessionManager.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    const wasDraft = session.isDraft
    const normalizedInput = this.normalizeSendMessageInput(content)

    if (session.isDraft) {
      const title = normalizedInput.text.trim().slice(0, 50) || 'New Chat'
      this.sessionManager.update(sessionId, { isDraft: false, title })
      this.emitSessionListUpdated()
      session = this.sessionManager.get(sessionId)
      if (!session) throw new Error(`Session not found: ${sessionId}`)
    }

    const agent = await this.resolveAgentImplementation(session.agentId)
    const state = await agent.getSessionState(sessionId)
    const hadMessages = (await agent.getMessages(sessionId)).length > 0
    let providerId = state?.providerId ?? ''
    if (!providerId) {
      if ((await this.getAgentType(session.agentId)) === 'acp') {
        providerId = 'acp'
      }
    }
    this.assertAcpSessionHasWorkdir(providerId, session.projectDir ?? null)
    await this.syncAcpSessionWorkdir(
      providerId,
      sessionId,
      session.agentId,
      session.projectDir ?? null
    )
    if (agent.queuePendingInput) {
      await agent.queuePendingInput(sessionId, normalizedInput)
      if (!hadMessages && !wasDraft) {
        void this.generateSessionTitle(sessionId, session.title, providerId, state?.modelId ?? '')
      }
      return
    }
    await agent.processMessage(sessionId, normalizedInput, {
      projectDir: session.projectDir ?? null
    })
    if (!hadMessages && !wasDraft) {
      void this.generateSessionTitle(sessionId, session.title, providerId, state?.modelId ?? '')
    }
  }

  async listPendingInputs(sessionId: string) {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const agent = await this.resolveAgentImplementation(session.agentId)
    if (!agent.listPendingInputs) {
      return []
    }
    return await agent.listPendingInputs(sessionId)
  }

  async queuePendingInput(sessionId: string, content: string | SendMessageInput) {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    let currentSession = session
    const normalizedInput = this.normalizeSendMessageInput(content)
    if (currentSession.isDraft) {
      const title = normalizedInput.text.trim().slice(0, 50) || 'New Chat'
      this.sessionManager.update(sessionId, { isDraft: false, title })
      this.emitSessionListUpdated()
      currentSession = this.sessionManager.get(sessionId) ?? currentSession
    }

    const agent = await this.resolveAgentImplementation(currentSession.agentId)
    if (!agent.queuePendingInput) {
      throw new Error(`Agent ${currentSession.agentId} does not support pending inputs.`)
    }

    let providerId = (await agent.getSessionState(sessionId))?.providerId ?? ''
    if (!providerId) {
      if ((await this.getAgentType(currentSession.agentId)) === 'acp') {
        providerId = 'acp'
      }
    }
    this.assertAcpSessionHasWorkdir(providerId, currentSession.projectDir ?? null)
    await this.syncAcpSessionWorkdir(
      providerId,
      sessionId,
      currentSession.agentId,
      currentSession.projectDir ?? null
    )
    return await agent.queuePendingInput(sessionId, normalizedInput)
  }

  async updateQueuedInput(sessionId: string, itemId: string, content: string | SendMessageInput) {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const agent = await this.resolveAgentImplementation(session.agentId)
    if (!agent.updateQueuedInput) {
      throw new Error(`Agent ${session.agentId} does not support pending input edits.`)
    }
    return await agent.updateQueuedInput(sessionId, itemId, this.normalizeSendMessageInput(content))
  }

  async moveQueuedInput(sessionId: string, itemId: string, toIndex: number) {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const agent = await this.resolveAgentImplementation(session.agentId)
    if (!agent.moveQueuedInput) {
      throw new Error(`Agent ${session.agentId} does not support pending input sorting.`)
    }
    return await agent.moveQueuedInput(sessionId, itemId, toIndex)
  }

  async convertPendingInputToSteer(sessionId: string, itemId: string) {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const agent = await this.resolveAgentImplementation(session.agentId)
    if (!agent.convertPendingInputToSteer) {
      throw new Error(`Agent ${session.agentId} does not support steer conversion.`)
    }
    return await agent.convertPendingInputToSteer(sessionId, itemId)
  }

  async deletePendingInput(sessionId: string, itemId: string): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const agent = await this.resolveAgentImplementation(session.agentId)
    if (!agent.deletePendingInput) {
      throw new Error(`Agent ${session.agentId} does not support pending input deletion.`)
    }
    await agent.deletePendingInput(sessionId, itemId)
  }

  async resumePendingQueue(sessionId: string): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const agent = await this.resolveAgentImplementation(session.agentId)
    if (!agent.resumePendingQueue) {
      throw new Error(`Agent ${session.agentId} does not support pending queue resume.`)
    }
    await agent.resumePendingQueue(sessionId)
  }

  async retryMessage(sessionId: string, messageId: string): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const agent = await this.resolveAgentImplementation(session.agentId)
    if (!agent.retryMessage) {
      throw new Error(`Agent ${session.agentId} does not support message retry.`)
    }
    await agent.retryMessage(sessionId, messageId)
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const agent = await this.resolveAgentImplementation(session.agentId)
    if (!agent.deleteMessage) {
      throw new Error(`Agent ${session.agentId} does not support message deletion.`)
    }
    await agent.deleteMessage(sessionId, messageId)
  }

  async editUserMessage(
    sessionId: string,
    messageId: string,
    text: string
  ): Promise<ChatMessageRecord> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const agent = await this.resolveAgentImplementation(session.agentId)
    if (!agent.editUserMessage) {
      throw new Error(`Agent ${session.agentId} does not support user message editing.`)
    }
    return await agent.editUserMessage(sessionId, messageId, text)
  }

  async forkSession(
    sourceSessionId: string,
    targetMessageId: string,
    newTitle?: string
  ): Promise<SessionWithState> {
    const sourceSession = this.sessionManager.get(sourceSessionId)
    if (!sourceSession) {
      throw new Error(`Session not found: ${sourceSessionId}`)
    }

    const agent = await this.resolveAgentImplementation(sourceSession.agentId)
    if (!agent.forkSessionFromMessage) {
      throw new Error(`Agent ${sourceSession.agentId} does not support session fork.`)
    }

    const sourceState = await agent.getSessionState(sourceSessionId)
    if (!sourceState) {
      throw new Error(`Session state not found: ${sourceSessionId}`)
    }

    const generationSettings = agent.getGenerationSettings
      ? await agent.getGenerationSettings(sourceSessionId)
      : null

    const title = this.buildForkTitle(sourceSession.title, newTitle)
    const targetSessionId = this.sessionManager.create(
      sourceSession.agentId,
      title,
      sourceSession.projectDir ?? null,
      { isDraft: false }
    )

    try {
      await this.initializeSessionRuntime(agent, targetSessionId, {
        agentId: sourceSession.agentId,
        providerId: sourceState.providerId,
        modelId: sourceState.modelId,
        projectDir: sourceSession.projectDir ?? null,
        permissionMode: sourceState.permissionMode,
        generationSettings: generationSettings ?? undefined
      })
      await agent.forkSessionFromMessage(sourceSessionId, targetSessionId, targetMessageId)
    } catch (error) {
      try {
        await agent.destroySession(targetSessionId)
      } catch (cleanupError) {
        console.warn(
          `[NewAgentPresenter] Failed to cleanup forked session runtime ${targetSessionId}:`,
          cleanupError
        )
      }
      this.sessionManager.delete(targetSessionId)
      throw error
    }

    this.emitSessionListUpdated()

    const record = this.sessionManager.get(targetSessionId)
    if (!record) {
      throw new Error(`Forked session not found: ${targetSessionId}`)
    }

    const targetState = await agent.getSessionState(targetSessionId)
    return {
      ...record,
      status: targetState?.status ?? 'idle',
      providerId: targetState?.providerId ?? sourceState.providerId,
      modelId: targetState?.modelId ?? sourceState.modelId
    }
  }

  async getSessionList(filters?: {
    agentId?: string
    projectDir?: string
    includeSubagents?: boolean
    parentSessionId?: string
  }): Promise<SessionWithState[]> {
    const records = this.sessionManager.list(filters)
    const enriched: SessionWithState[] = []

    for (const record of records) {
      const session = await this.tryBuildSessionWithState(record)
      if (session) {
        enriched.push(session)
      }
    }

    return enriched
  }

  async getSession(sessionId: string): Promise<SessionWithState | null> {
    const record = this.sessionManager.get(sessionId)
    if (!record) return null
    return await this.tryBuildSessionWithState(record)
  }

  async getMessages(sessionId: string): Promise<ChatMessageRecord[]> {
    const session = this.sessionManager.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    const agent = await this.resolveAgentImplementation(session.agentId)
    return agent.getMessages(sessionId)
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
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const agent = await this.resolveAgentImplementation(session.agentId)
    if (!agent.getSessionCompactionState) {
      return {
        status: 'idle',
        cursorOrderSeq: 1,
        summaryUpdatedAt: null
      }
    }

    return await agent.getSessionCompactionState(sessionId)
  }

  async getSearchResults(messageId: string, searchId?: string): Promise<SearchResult[]> {
    const normalizedMessageId = messageId?.trim()
    if (!normalizedMessageId) {
      return []
    }
    const parsed: SearchResult[] = []
    const rows =
      this.sqlitePresenter.deepchatMessageSearchResultsTable.listByMessageId(normalizedMessageId)
    for (const row of rows) {
      try {
        const result = JSON.parse(row.content) as SearchResult
        parsed.push({
          ...result,
          rank: typeof result.rank === 'number' ? result.rank : (row.rank ?? undefined),
          searchId: result.searchId ?? row.search_id ?? undefined
        })
      } catch (error) {
        console.warn('[NewAgentPresenter] Failed to parse search result row:', error)
      }
    }

    if (searchId) {
      const filtered = parsed.filter((item) => item.searchId === searchId)
      if (filtered.length > 0) {
        return filtered
      }
      const legacy = parsed.filter((item) => !item.searchId)
      if (legacy.length > 0) {
        return legacy
      }
    }

    return parsed
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

  async startUsageStatsBackfill(): Promise<void> {
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

    this.usageStatsBackfillPromise = this.runUsageStatsBackfill().finally(() => {
      this.usageStatsBackfillPromise = null
    })

    return await this.usageStatsBackfillPromise
  }

  async startRtkHealthCheck(): Promise<void> {
    await rtkRuntimeService.startHealthCheck()
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
    if (!messageId?.trim()) return []
    return this.sqlitePresenter.deepchatMessageTracesTable
      .listByMessageId(messageId)
      .map((row) => ({
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
    return this.sqlitePresenter.deepchatMessageTracesTable.countByMessageId(normalizedMessageId)
  }

  async getMessageIds(sessionId: string): Promise<string[]> {
    const session = this.sessionManager.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    const agent = await this.resolveAgentImplementation(session.agentId)
    return agent.getMessageIds(sessionId)
  }

  async getMessage(messageId: string): Promise<ChatMessageRecord | null> {
    return this.messageManager.getMessage(messageId)
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
    this.sessionManager.bindWindow(webContentsId, sessionId)
    eventBus.sendToRenderer(SESSION_EVENTS.ACTIVATED, SendTarget.ALL_WINDOWS, {
      webContentsId,
      sessionId
    })
  }

  async deactivateSession(webContentsId: number): Promise<void> {
    this.sessionManager.unbindWindow(webContentsId)
    eventBus.sendToRenderer(SESSION_EVENTS.DEACTIVATED, SendTarget.ALL_WINDOWS, {
      webContentsId
    })
  }

  async getActiveSession(webContentsId: number): Promise<SessionWithState | null> {
    const sessionId = this.sessionManager.getActiveSessionId(webContentsId)
    if (!sessionId) return null
    const session = await this.getSession(sessionId)
    if (!session) {
      this.sessionManager.unbindWindow(webContentsId)
    }
    return session
  }

  async getAgents(): Promise<Agent[]> {
    const [agents, acpEnabled] = await Promise.all([
      this.configPresenter.listAgents(),
      this.configPresenter.getAcpEnabled()
    ])

    return agents.filter((agent) => agent.type === 'deepchat' || acpEnabled)
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const normalized = title.trim()
    if (!normalized) {
      throw new Error('Session title cannot be empty.')
    }

    this.sessionManager.update(sessionId, { title: normalized })
    this.emitSessionListUpdated()
  }

  async toggleSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    this.sessionManager.update(sessionId, { isPinned: pinned })
    this.emitSessionListUpdated()
  }

  async clearSessionMessages(sessionId: string): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const agent = await this.resolveAgentImplementation(session.agentId)
    if (!agent.clearMessages) {
      throw new Error(`Agent ${session.agentId} does not support clearing messages.`)
    }

    await agent.clearMessages(sessionId)
    this.emitSessionListUpdated()
  }

  async exportSession(
    sessionId: string,
    format: ConversationExportFormat
  ): Promise<{ filename: string; content: string }> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const agent = await this.resolveAgentImplementation(session.agentId)
    const state = await agent.getSessionState(sessionId)
    const generationSettings = agent.getGenerationSettings
      ? await agent.getGenerationSettings(sessionId)
      : null
    const providerId = state?.providerId?.trim() ?? ''
    const modelId = state?.modelId?.trim() ?? ''

    const conversation = await this.buildExportConversation(
      session,
      providerId,
      modelId,
      generationSettings
    )
    const records = await agent.getMessages(sessionId)
    const exportMessages = records
      .filter((record) => record.status === 'sent')
      .sort((a, b) => a.orderSeq - b.orderSeq)
      .map((record) => this.mapRecordToExportMessage(record, providerId, modelId))

    const filename = generateExportFilename(format, conversation)
    const content = buildConversationExportContent(conversation, exportMessages, format)
    return { filename, content }
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.deleteSessionInternal(sessionId)
    this.emitSessionListUpdated()
  }

  async cancelGeneration(sessionId: string): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) return
    const agent = await this.resolveAgentImplementation(session.agentId)
    await agent.cancelGeneration(sessionId)
  }

  async respondToolInteraction(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const agent = await this.resolveAgentImplementation(session.agentId)
    if (!agent.respondToolInteraction) {
      throw new Error(`Agent ${session.agentId} does not support tool interaction response.`)
    }
    return await agent.respondToolInteraction(sessionId, messageId, toolCallId, response)
  }

  async getAcpSessionCommands(sessionId: string): Promise<
    Array<{
      name: string
      description: string
      input?: { hint: string } | null
    }>
  > {
    const session = this.sessionManager.get(sessionId)
    if (!session) return []
    if (!(await this.isAcpBackedSession(sessionId, session.agentId))) {
      return []
    }
    return await this.llmProviderPresenter.getAcpSessionCommands(sessionId)
  }

  async getAcpSessionConfigOptions(sessionId: string): Promise<AcpConfigState | null> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      return null
    }
    if (!(await this.isAcpBackedSession(sessionId, session.agentId))) {
      return null
    }
    return await this.llmProviderPresenter.getAcpSessionConfigOptions(sessionId)
  }

  async setAcpSessionConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean
  ): Promise<AcpConfigState | null> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    if (!(await this.isAcpBackedSession(sessionId, session.agentId))) {
      throw new Error('ACP session config options are only available for ACP sessions.')
    }
    return await this.llmProviderPresenter.setAcpSessionConfigOption(sessionId, configId, value)
  }

  async getPermissionMode(sessionId: string): Promise<PermissionMode> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const agent = await this.resolveAgentImplementation(session.agentId)
    if (!agent.getPermissionMode) {
      return 'full_access'
    }
    return await agent.getPermissionMode(sessionId)
  }

  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const agent = await this.resolveAgentImplementation(session.agentId)
    if (!agent.setPermissionMode) {
      return
    }
    await agent.setPermissionMode(sessionId, mode)
  }

  async setSessionSubagentEnabled(sessionId: string, enabled: boolean): Promise<SessionWithState> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    if (session.sessionKind !== 'regular') {
      throw new Error('Only regular sessions can change subagent state.')
    }

    if ((await this.getAgentType(session.agentId)) !== 'deepchat') {
      throw new Error('Only DeepChat sessions can change subagent state.')
    }

    this.sessionManager.update(sessionId, { subagentEnabled: enabled })
    const updated = this.sessionManager.get(sessionId)
    if (!updated) {
      throw new Error(`Session not found after update: ${sessionId}`)
    }

    this.emitSessionListUpdated()
    const sessionWithState = await this.tryBuildSessionWithState(updated)
    if (!sessionWithState) {
      throw new Error(`Failed to build session state for sessionId: ${sessionId}`)
    }

    return sessionWithState
  }

  async setSessionModel(
    sessionId: string,
    providerId: string,
    modelId: string
  ): Promise<SessionWithState> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const nextProviderId = providerId?.trim()
    const nextModelId = modelId?.trim()
    if (!nextProviderId || !nextModelId) {
      throw new Error('setSessionModel requires providerId and modelId.')
    }

    if ((await this.getAgentType(session.agentId)) === 'acp') {
      throw new Error('ACP session model is locked.')
    }

    const agent = await this.resolveAgentImplementation(session.agentId)
    if (!agent.setSessionModel) {
      throw new Error(`Agent ${session.agentId} does not support session model switching.`)
    }

    await agent.setSessionModel(sessionId, nextProviderId, nextModelId)
    const state = await agent.getSessionState(sessionId)
    const updated: SessionWithState = {
      ...session,
      status: state?.status ?? 'idle',
      providerId: state?.providerId ?? nextProviderId,
      modelId: state?.modelId ?? nextModelId
    }
    this.emitSessionListUpdated()
    return updated
  }

  async getSessionGenerationSettings(sessionId: string): Promise<SessionGenerationSettings | null> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const agent = await this.resolveAgentImplementation(session.agentId)
    if (!agent.getGenerationSettings) {
      return null
    }
    return await agent.getGenerationSettings(sessionId)
  }

  async getSessionDisabledAgentTools(sessionId: string): Promise<string[]> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    return this.sessionManager.getDisabledAgentTools(sessionId)
  }

  async updateSessionDisabledAgentTools(
    sessionId: string,
    disabledAgentTools: string[]
  ): Promise<string[]> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const normalized = this.normalizeDisabledAgentTools(disabledAgentTools)
    this.sessionManager.updateDisabledAgentTools(sessionId, normalized)

    const agent = await this.resolveAgentImplementation(session.agentId)
    if (
      'invalidateSessionSystemPromptCache' in agent &&
      typeof agent.invalidateSessionSystemPromptCache === 'function'
    ) {
      agent.invalidateSessionSystemPromptCache(sessionId)
    }

    return normalized
  }

  async updateSessionGenerationSettings(
    sessionId: string,
    settings: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const agent = await this.resolveAgentImplementation(session.agentId)
    if (!agent.updateGenerationSettings) {
      throw new Error(`Agent ${session.agentId} does not support generation settings updates.`)
    }
    return await agent.updateGenerationSettings(sessionId, settings)
  }

  private async generateSessionTitle(
    sessionId: string,
    initialTitle: string,
    fallbackProviderId: string,
    fallbackModelId: string
  ): Promise<void> {
    try {
      const settled = await this.waitForSessionIdle(sessionId)
      if (!settled) return

      const currentSession = this.sessionManager.get(sessionId)
      if (!currentSession) return
      if (currentSession.title !== initialTitle) return

      const agent = await this.resolveAgentImplementation(currentSession.agentId)
      const records = await agent.getMessages(sessionId)
      const titleMessages = this.buildTitleMessages(records)
      if (titleMessages.length === 0) return

      const assistantSelection = await this.resolveAssistantModelSelection(
        currentSession.agentId,
        fallbackProviderId,
        fallbackModelId
      )
      const preferredProviderId = assistantSelection.providerId
      const preferredModelId = assistantSelection.modelId

      let generatedTitle: string
      try {
        generatedTitle = await this.llmProviderPresenter.summaryTitles(
          titleMessages,
          preferredProviderId,
          preferredModelId
        )
      } catch (error) {
        const shouldFallback =
          preferredProviderId !== fallbackProviderId || preferredModelId !== fallbackModelId
        if (!shouldFallback) throw error
        generatedTitle = await this.llmProviderPresenter.summaryTitles(
          titleMessages,
          fallbackProviderId,
          fallbackModelId
        )
      }

      const normalized = this.normalizeGeneratedTitle(generatedTitle)
      if (!normalized || normalized === initialTitle) return

      const latest = this.sessionManager.get(sessionId)
      if (!latest) return
      if (latest.title !== initialTitle) return

      this.sessionManager.update(sessionId, { title: normalized })
      this.emitSessionListUpdated()
    } catch (error) {
      console.warn(`[NewAgentPresenter] title generation skipped for session=${sessionId}:`, error)
    }
  }

  private emitSessionListUpdated(): void {
    eventBus.sendToRenderer(SESSION_EVENTS.LIST_UPDATED, SendTarget.ALL_WINDOWS)

    try {
      void presenter.floatingButtonPresenter.refreshWidgetState()
    } catch (error) {
      console.warn('[NewAgentPresenter] Failed to refresh floating widget state:', error)
    }
  }

  private async waitForSessionIdle(sessionId: string): Promise<boolean> {
    const MAX_WAIT_MS = 30000
    const POLL_MS = 250
    const startedAt = Date.now()
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    while (Date.now() - startedAt < MAX_WAIT_MS) {
      const session = this.sessionManager.get(sessionId)
      if (!session) return false

      const agent = await this.resolveAgentImplementation(session.agentId)
      const state = await agent.getSessionState(sessionId)
      if (!state) return false
      if (state.status === 'idle') return true
      if (state.status === 'error') return false

      await sleep(POLL_MS)
    }

    return false
  }

  private async buildSessionWithState(record: SessionRecord): Promise<SessionWithState> {
    const agent = await this.resolveAgentImplementation(record.agentId)
    const state = await agent.getSessionState(record.id)
    return {
      ...record,
      status: state?.status ?? 'idle',
      providerId: state?.providerId ?? '',
      modelId: state?.modelId ?? ''
    }
  }

  private async tryBuildSessionWithState(record: SessionRecord): Promise<SessionWithState | null> {
    try {
      return await this.buildSessionWithState(record)
    } catch (error) {
      console.warn(
        `[NewAgentPresenter] Skipping unavailable session id=${record.id} agent=${record.agentId}:`,
        error
      )
      return null
    }
  }

  private async resolveAgentImplementation(agentId: string): Promise<IAgentImplementation> {
    const resolvedAgentId = resolveAcpAgentAlias(agentId)

    if (this.agentRegistry.has(resolvedAgentId)) {
      return this.agentRegistry.resolve(resolvedAgentId)
    }

    const agentType = await this.getAgentType(resolvedAgentId)
    if (agentType === 'deepchat' || agentType === 'acp') {
      return this.agentRegistry.resolve('deepchat')
    }

    throw new Error(`Agent not found: ${agentId}`)
  }

  private async assertAcpAgent(agentId: string): Promise<void> {
    const resolvedAgentId = resolveAcpAgentAlias(agentId)
    if ((await this.getAgentType(resolvedAgentId)) !== 'acp') {
      throw new Error(`Agent ${agentId} is not an ACP agent.`)
    }
  }

  private async getAgentType(agentId: string): Promise<'deepchat' | 'acp' | null> {
    return await this.configPresenter.getAgentType(resolveAcpAgentAlias(agentId))
  }

  private async resolveAssistantModelSelection(
    agentId: string,
    fallbackProviderId: string,
    fallbackModelId: string
  ): Promise<{ providerId: string; modelId: string }> {
    if ((await this.getAgentType(agentId)) === 'deepchat') {
      const config = await this.configPresenter.resolveDeepChatAgentConfig(agentId)
      const providerId = config.assistantModel?.providerId?.trim()
      const modelId = config.assistantModel?.modelId?.trim()
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

  private mergeDeepChatDefaultGenerationSettings(
    config: Awaited<ReturnType<IConfigPresenter['resolveDeepChatAgentConfig']>> | null,
    overrides?: Partial<SessionGenerationSettings>
  ): Partial<SessionGenerationSettings> | undefined {
    const defaults: Partial<SessionGenerationSettings> = {}

    if (typeof config?.systemPrompt === 'string') {
      defaults.systemPrompt = config.systemPrompt
    }

    const merged = {
      ...defaults,
      ...overrides
    }

    return Object.keys(merged).length > 0 ? merged : undefined
  }

  private resolveSessionSubagentEnabled(
    agentType: 'deepchat' | 'acp' | null,
    inputEnabled?: boolean,
    configEnabled?: boolean
  ): boolean {
    if (agentType !== 'deepchat') {
      return false
    }

    if (typeof inputEnabled === 'boolean') {
      return inputEnabled
    }

    return configEnabled === true
  }

  private async deleteSessionInternal(sessionId: string): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) return

    if (session.sessionKind === 'regular') {
      const children = this.sessionManager.list({
        includeSubagents: true,
        parentSessionId: sessionId
      })
      for (const child of children) {
        await this.deleteSessionInternal(child.id)
      }
    }

    const agent = await this.resolveAgentImplementation(session.agentId)
    const state = await agent.getSessionState(sessionId)
    let providerId = state?.providerId ?? ''
    if (!providerId && (await this.getAgentType(session.agentId)) === 'acp') {
      providerId = 'acp'
    }
    if (providerId === 'acp') {
      await this.llmProviderPresenter.clearAcpSession(sessionId)
    }
    await agent.destroySession(sessionId)
    presenter.commandPermissionService.clearConversation(sessionId)
    presenter.filePermissionService?.clearConversation(sessionId)
    presenter.settingsPermissionService?.clearConversation(sessionId)
    await this.skillPresenter?.clearNewAgentSessionSkills?.(sessionId)
    this.sessionManager.delete(sessionId)
  }

  private async isAcpBackedSession(sessionId: string, agentId: string): Promise<boolean> {
    const resolvedAgentId = resolveAcpAgentAlias(agentId)
    const agent = await this.resolveAgentImplementation(agentId)
    const state = await agent.getSessionState(sessionId)
    let providerId = state?.providerId ?? ''
    if (!providerId) {
      if ((await this.getAgentType(resolvedAgentId)) === 'acp') {
        providerId = 'acp'
      }
    }
    return providerId === 'acp'
  }

  private async findReusableDraftSession(
    agentId: string,
    projectDir: string,
    agent: IAgentImplementation
  ): Promise<SessionRecord | null> {
    const candidates = this.sessionManager.list({ agentId, projectDir })
    for (const session of candidates) {
      if (!session.isDraft) continue
      const hasMessages = await this.hasSessionMessages(agent, session.id)
      if (!hasMessages) {
        return session
      }
    }
    return null
  }

  private async hasSessionMessages(
    agent: IAgentImplementation,
    sessionId: string
  ): Promise<boolean> {
    try {
      const ids = await agent.getMessageIds(sessionId)
      return ids.length > 0
    } catch (error) {
      console.warn(
        `[NewAgentPresenter] Failed to inspect message ids for session=${sessionId}:`,
        error
      )
      return true
    }
  }

  private async ensureSessionRuntimeInitialized(
    agent: IAgentImplementation,
    sessionId: string,
    config: {
      agentId?: string
      providerId: string
      modelId: string
      projectDir: string
      permissionMode: PermissionMode
    }
  ): Promise<void> {
    const state = await agent.getSessionState(sessionId)
    if (!state) {
      await this.initializeSessionRuntime(agent, sessionId, config)
      return
    }

    if (
      state.permissionMode &&
      state.permissionMode !== config.permissionMode &&
      agent.setPermissionMode
    ) {
      await agent.setPermissionMode(sessionId, config.permissionMode)
    }

    await this.syncAcpSessionWorkdir(
      config.providerId,
      sessionId,
      config.agentId ?? config.modelId,
      config.projectDir
    )
  }

  private async initializeSessionRuntime(
    agent: IAgentImplementation,
    sessionId: string,
    config: {
      agentId?: string
      providerId: string
      modelId: string
      projectDir?: string | null
      permissionMode: PermissionMode
      generationSettings?: Partial<SessionGenerationSettings>
    }
  ): Promise<void> {
    await agent.initSession(sessionId, config)
    await this.syncAcpSessionWorkdir(
      config.providerId,
      sessionId,
      config.agentId ?? config.modelId,
      config.projectDir ?? null
    )
  }

  private async syncAcpSessionWorkdir(
    providerId: string,
    conversationId: string,
    agentId: string,
    projectDir?: string | null
  ): Promise<void> {
    if (providerId !== 'acp') {
      return
    }

    const normalizedProjectDir = projectDir?.trim()
    if (!normalizedProjectDir) {
      return
    }

    try {
      await this.llmProviderPresenter.setAcpWorkdir(
        conversationId,
        resolveAcpAgentAlias(agentId),
        normalizedProjectDir
      )
    } catch (error) {
      console.warn('[NewAgentPresenter] Failed to sync ACP workdir for session:', {
        conversationId,
        agentId,
        projectDir: normalizedProjectDir,
        error
      })
      throw error
    }
  }

  private async cleanupFailedSessionInitialization(
    agent: IAgentImplementation,
    sessionId: string
  ): Promise<void> {
    try {
      await agent.destroySession(sessionId)
    } catch (cleanupError) {
      console.warn(
        `[NewAgentPresenter] Failed to cleanup session runtime after initialization error ${sessionId}:`,
        cleanupError
      )
    }

    this.sessionManager.delete(sessionId)
  }

  private async buildExportConversation(
    session: SessionRecord,
    providerId: string,
    modelId: string,
    generationSettings: SessionGenerationSettings | null
  ): Promise<CONVERSATION> {
    const isAcpAgent = (await this.getAgentType(session.agentId)) === 'acp'
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

  private async runUsageStatsBackfill(): Promise<void> {
    const startedAt = Date.now()
    this.setUsageStatsBackfillStatus({
      status: 'running',
      startedAt,
      finishedAt: null,
      error: null,
      updatedAt: startedAt
    })

    try {
      const usageStatsTable = this.sqlitePresenter.deepchatUsageStatsTable
      const candidates = this.sqlitePresenter.deepchatMessagesTable.listAssistantUsageCandidates()

      let processedCount = 0
      for (const row of candidates) {
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

        if (processedCount % 200 === 0) {
          this.setUsageStatsBackfillStatus({
            status: 'running',
            startedAt,
            finishedAt: null,
            error: null,
            updatedAt: Date.now()
          })
          await this.yieldToEventLoop()
        }
      }

      this.setUsageStatsBackfillStatus({
        status: 'completed',
        startedAt,
        finishedAt: Date.now(),
        error: null,
        updatedAt: Date.now()
      })
    } catch (error) {
      this.setUsageStatsBackfillStatus({
        status: 'failed',
        startedAt,
        finishedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now()
      })
      throw error
    }
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

  private buildTitleMessages(
    records: ChatMessageRecord[]
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const sorted = [...records].sort((a, b) => a.orderSeq - b.orderSeq)
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []

    for (const record of sorted) {
      if (record.role === 'user') {
        const text = this.extractUserText(record.content)
        if (text) {
          messages.push({ role: 'user', content: text })
        }
        continue
      }

      if (record.role === 'assistant') {
        const text = this.extractAssistantText(record.content)
        if (text) {
          messages.push({ role: 'assistant', content: text })
        }
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
    if (cleaned.length > 80) {
      cleaned = cleaned.slice(0, 80).trim()
    }
    return cleaned
  }

  private buildForkTitle(sourceTitle: string, customTitle?: string): string {
    const normalizedCustom = customTitle?.trim()
    if (normalizedCustom) {
      return normalizedCustom
    }
    const base = sourceTitle?.trim() || 'New Chat'
    if (base.length >= 60) {
      return base.slice(0, 60).trim()
    }
    return `${base} - Fork`
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

  private assertAcpSessionHasWorkdir(providerId: string, projectDir: string | null): void {
    if (providerId !== 'acp') {
      return
    }
    if (projectDir?.trim()) {
      return
    }
    throw new Error('ACP agent requires selecting a workdir before sending messages.')
  }

  private normalizeSendMessageInput(content: string | SendMessageInput): SendMessageInput {
    if (typeof content === 'string') {
      return { text: content, files: [] }
    }

    if (!content || typeof content !== 'object') {
      return { text: '', files: [] }
    }

    const text = typeof content.text === 'string' ? content.text : ''
    const files = Array.isArray(content.files)
      ? content.files.filter((file): file is MessageFile => Boolean(file))
      : []
    return { text, files }
  }

  private normalizeCreateSessionInput(input: CreateSessionInput): SendMessageInput {
    const text = typeof input.message === 'string' ? input.message : ''
    const files = Array.isArray(input.files)
      ? input.files.filter((file): file is MessageFile => Boolean(file))
      : []
    return { text, files }
  }

  private normalizeDisabledAgentTools(disabledAgentTools?: string[]): string[] {
    if (!Array.isArray(disabledAgentTools)) {
      return []
    }

    return Array.from(
      new Set(
        disabledAgentTools
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .map((item) => LEGACY_AGENT_TOOL_NAME_MAP[item] ?? item)
          .filter((item) => Boolean(item) && !RETIRED_DEFAULT_AGENT_TOOLS.has(item))
      )
    ).sort((left, right) => left.localeCompare(right))
  }
}
