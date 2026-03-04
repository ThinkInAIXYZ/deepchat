import type {
  Agent,
  IAgentImplementation,
  CreateSessionInput,
  SessionRecord,
  SessionWithState,
  ChatMessageRecord,
  MessageTraceRecord,
  UserMessageContent,
  AssistantMessageBlock,
  PermissionMode,
  SessionGenerationSettings,
  ToolInteractionResponse,
  ToolInteractionResult
} from '@shared/types/agent-interface'
import type { Message } from '@shared/chat'
import type {
  IConfigPresenter,
  ILlmProviderPresenter,
  ISkillPresenter,
  CONVERSATION
} from '@shared/presenter'
import type { SQLitePresenter } from '../sqlitePresenter'
import type { DeepChatAgentPresenter } from '../deepchatAgentPresenter'
import { AgentRegistry } from './agentRegistry'
import { NewSessionManager } from './sessionManager'
import { NewMessageManager } from './messageManager'
import { eventBus, SendTarget } from '@/eventbus'
import { SESSION_EVENTS } from '@/events'
import {
  buildConversationExportContent,
  generateExportFilename,
  type ConversationExportFormat
} from '../exporter/formats/conversationExporter'

export class NewAgentPresenter {
  private agentRegistry: AgentRegistry
  private sessionManager: NewSessionManager
  private messageManager: NewMessageManager
  private sqlitePresenter: SQLitePresenter
  private llmProviderPresenter: ILlmProviderPresenter
  private configPresenter: IConfigPresenter
  private skillPresenter?: Pick<ISkillPresenter, 'setActiveSkills' | 'clearNewAgentSessionSkills'>

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
    this.messageManager = new NewMessageManager(this.agentRegistry, this.sessionManager)

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
    const projectDir = input.projectDir?.trim() ? input.projectDir.trim() : null

    const agent = await this.resolveAgentImplementation(agentId)

    // Resolve provider/model
    const defaultModel = this.configPresenter.getDefaultModel()
    const providerId = input.providerId ?? defaultModel?.providerId ?? ''
    const modelId = input.modelId ?? defaultModel?.modelId ?? ''
    const permissionMode: PermissionMode =
      input.permissionMode === 'default' ? 'default' : 'full_access'
    console.log(`[NewAgentPresenter] resolved provider=${providerId} model=${modelId}`)

    if (!providerId || !modelId) {
      throw new Error('No provider or model configured. Please set a default model in settings.')
    }
    this.assertAcpSessionHasWorkdir(providerId, projectDir)

    // Create session record
    const title = input.message.slice(0, 50) || 'New Chat'
    const sessionId = this.sessionManager.create(agentId, title, projectDir, { isDraft: false })
    console.log(`[NewAgentPresenter] session created id=${sessionId} title="${title}"`)

    // Initialize agent-side session
    const initConfig: {
      providerId: string
      modelId: string
      projectDir: string | null
      permissionMode: PermissionMode
      generationSettings?: Partial<SessionGenerationSettings>
    } = {
      providerId,
      modelId,
      projectDir,
      permissionMode
    }
    if (input.generationSettings) {
      initConfig.generationSettings = input.generationSettings
    }
    await agent.initSession(sessionId, initConfig)
    console.log(`[NewAgentPresenter] agent.initSession done`)

    // Bind to window and emit activated
    this.sessionManager.bindWindow(webContentsId, sessionId)
    eventBus.sendToRenderer(SESSION_EVENTS.ACTIVATED, SendTarget.ALL_WINDOWS, {
      webContentsId,
      sessionId
    })
    eventBus.sendToRenderer(SESSION_EVENTS.LIST_UPDATED, SendTarget.ALL_WINDOWS)

    if (input.activeSkills && input.activeSkills.length > 0 && this.skillPresenter) {
      await this.skillPresenter.setActiveSkills(sessionId, input.activeSkills)
    }

    // Process the first message (non-blocking)
    console.log(`[NewAgentPresenter] firing processMessage (non-blocking)`)
    agent.processMessage(sessionId, input.message, { projectDir }).catch((err) => {
      console.error('[NewAgentPresenter] processMessage failed:', err)
    })
    void this.generateSessionTitle(sessionId, title, providerId, modelId)

    // Return enriched session
    const state = await agent.getSessionState(sessionId)
    return {
      id: sessionId,
      agentId,
      title,
      projectDir,
      isPinned: false,
      isDraft: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: state?.status ?? 'idle',
      providerId: state?.providerId ?? providerId,
      modelId: state?.modelId ?? modelId
    }
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
        isDraft: true
      })
      await this.ensureSessionRuntimeInitialized(agent, sessionId, {
        providerId: 'acp',
        modelId: agentId,
        projectDir,
        permissionMode
      })
      record = this.sessionManager.get(sessionId)
      if (!record) {
        throw new Error(`Failed to read created ACP draft session: ${sessionId}`)
      }
    } else {
      await this.ensureSessionRuntimeInitialized(agent, record.id, {
        providerId: 'acp',
        modelId: agentId,
        projectDir,
        permissionMode
      })
    }

    await this.llmProviderPresenter.prepareAcpSession(record.id, agentId, projectDir)
    eventBus.sendToRenderer(SESSION_EVENTS.LIST_UPDATED, SendTarget.ALL_WINDOWS)

    const state = await agent.getSessionState(record.id)
    return {
      ...record,
      status: state?.status ?? 'idle',
      providerId: state?.providerId ?? 'acp',
      modelId: state?.modelId ?? agentId
    }
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    let session = this.sessionManager.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    if (session.isDraft) {
      const title = content.trim().slice(0, 50) || 'New Chat'
      this.sessionManager.update(sessionId, { isDraft: false, title })
      eventBus.sendToRenderer(SESSION_EVENTS.LIST_UPDATED, SendTarget.ALL_WINDOWS)
      session = this.sessionManager.get(sessionId)
      if (!session) throw new Error(`Session not found: ${sessionId}`)
    }

    const agent = await this.resolveAgentImplementation(session.agentId)
    const state = await agent.getSessionState(sessionId)
    let providerId = state?.providerId ?? ''
    if (!providerId) {
      const acpAgents = await this.configPresenter.getAcpAgents()
      if (acpAgents.some((item) => item.id === session.agentId)) {
        providerId = 'acp'
      }
    }
    this.assertAcpSessionHasWorkdir(providerId, session.projectDir ?? null)
    await agent.processMessage(sessionId, content, {
      projectDir: session.projectDir ?? null
    })
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
      await agent.initSession(targetSessionId, {
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

    eventBus.sendToRenderer(SESSION_EVENTS.LIST_UPDATED, SendTarget.ALL_WINDOWS)

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
  }): Promise<SessionWithState[]> {
    const records = this.sessionManager.list(filters)
    const enriched: SessionWithState[] = []

    for (const record of records) {
      const agent = await this.resolveAgentImplementation(record.agentId)
      const state = await agent.getSessionState(record.id)
      enriched.push({
        ...record,
        status: state?.status ?? 'idle',
        providerId: state?.providerId ?? '',
        modelId: state?.modelId ?? ''
      })
    }

    return enriched
  }

  async getSession(sessionId: string): Promise<SessionWithState | null> {
    const record = this.sessionManager.get(sessionId)
    if (!record) return null
    const agent = await this.resolveAgentImplementation(record.agentId)
    const state = await agent.getSessionState(sessionId)
    return {
      ...record,
      status: state?.status ?? 'idle',
      providerId: state?.providerId ?? '',
      modelId: state?.modelId ?? ''
    }
  }

  async getMessages(sessionId: string): Promise<ChatMessageRecord[]> {
    const session = this.sessionManager.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    const agent = await this.resolveAgentImplementation(session.agentId)
    return agent.getMessages(sessionId)
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
    if (!messageId?.trim()) return 0
    return this.sqlitePresenter.deepchatMessageTracesTable.countByMessageId(messageId)
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
    return this.getSession(sessionId)
  }

  async getAgents(): Promise<Agent[]> {
    const builtins = this.agentRegistry.getAll()
    const acpAgents = await this.configPresenter.getAcpAgents()
    const acpList: Agent[] = acpAgents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      type: 'acp',
      enabled: true
    }))

    const map = new Map<string, Agent>()
    for (const item of [...builtins, ...acpList]) {
      map.set(item.id, item)
    }
    return Array.from(map.values())
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
    eventBus.sendToRenderer(SESSION_EVENTS.LIST_UPDATED, SendTarget.ALL_WINDOWS)
  }

  async toggleSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    this.sessionManager.update(sessionId, { isPinned: pinned })
    eventBus.sendToRenderer(SESSION_EVENTS.LIST_UPDATED, SendTarget.ALL_WINDOWS)
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
    eventBus.sendToRenderer(SESSION_EVENTS.LIST_UPDATED, SendTarget.ALL_WINDOWS)
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

    const conversation = this.buildExportConversation(
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
    const session = this.sessionManager.get(sessionId)
    if (!session) return
    const agent = await this.resolveAgentImplementation(session.agentId)
    const state = await agent.getSessionState(sessionId)
    let providerId = state?.providerId ?? ''
    if (!providerId) {
      const acpAgents = await this.configPresenter.getAcpAgents()
      if (acpAgents.some((item) => item.id === session.agentId)) {
        providerId = 'acp'
      }
    }
    if (providerId === 'acp') {
      await this.llmProviderPresenter.clearAcpSession(sessionId)
    }
    await agent.destroySession(sessionId)
    await this.skillPresenter?.clearNewAgentSessionSkills?.(sessionId)
    this.sessionManager.delete(sessionId)
    eventBus.sendToRenderer(SESSION_EVENTS.LIST_UPDATED, SendTarget.ALL_WINDOWS)
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
    const agent = await this.resolveAgentImplementation(session.agentId)
    const state = await agent.getSessionState(sessionId)
    let providerId = state?.providerId ?? ''
    if (!providerId) {
      const acpAgents = await this.configPresenter.getAcpAgents()
      if (acpAgents.some((item) => item.id === session.agentId)) {
        providerId = 'acp'
      }
    }
    if (providerId !== 'acp') {
      return []
    }
    return await this.llmProviderPresenter.getAcpSessionCommands(sessionId)
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

    const acpAgents = await this.configPresenter.getAcpAgents()
    if (session.agentId !== 'deepchat' && acpAgents.some((item) => item.id === session.agentId)) {
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
    eventBus.sendToRenderer(SESSION_EVENTS.LIST_UPDATED, SendTarget.ALL_WINDOWS)
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

      const assistantModel = this.configPresenter.getSetting<{
        providerId: string
        modelId: string
      }>('assistantModel')
      const preferredProviderId = assistantModel?.providerId || fallbackProviderId
      const preferredModelId = assistantModel?.modelId || fallbackModelId

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
      eventBus.sendToRenderer(SESSION_EVENTS.LIST_UPDATED, SendTarget.ALL_WINDOWS)
    } catch (error) {
      console.warn(`[NewAgentPresenter] title generation skipped for session=${sessionId}:`, error)
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

  private async resolveAgentImplementation(agentId: string): Promise<IAgentImplementation> {
    if (this.agentRegistry.has(agentId)) {
      return this.agentRegistry.resolve(agentId)
    }

    const acpAgents = await this.configPresenter.getAcpAgents()
    const isAcpAgent = acpAgents.some((agent) => agent.id === agentId)
    if (isAcpAgent) {
      return this.agentRegistry.resolve('deepchat')
    }

    throw new Error(`Agent not found: ${agentId}`)
  }

  private async assertAcpAgent(agentId: string): Promise<void> {
    const acpAgents = await this.configPresenter.getAcpAgents()
    if (!acpAgents.some((agent) => agent.id === agentId)) {
      throw new Error(`Agent ${agentId} is not an ACP agent.`)
    }
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
      providerId: string
      modelId: string
      projectDir: string
      permissionMode: PermissionMode
    }
  ): Promise<void> {
    const state = await agent.getSessionState(sessionId)
    if (!state) {
      await agent.initSession(sessionId, config)
      return
    }

    if (
      state.permissionMode &&
      state.permissionMode !== config.permissionMode &&
      agent.setPermissionMode
    ) {
      await agent.setPermissionMode(sessionId, config.permissionMode)
    }
  }

  private buildExportConversation(
    session: SessionRecord,
    providerId: string,
    modelId: string,
    generationSettings: SessionGenerationSettings | null
  ): CONVERSATION {
    const resolvedProviderId = providerId || (session.agentId !== 'deepchat' ? 'acp' : '')
    const resolvedModelId = modelId || (session.agentId !== 'deepchat' ? session.agentId : '')
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

  private assertAcpSessionHasWorkdir(providerId: string, projectDir: string | null): void {
    if (providerId !== 'acp') {
      return
    }
    if (projectDir?.trim()) {
      return
    }
    throw new Error('ACP agent requires selecting a workdir before sending messages.')
  }
}
