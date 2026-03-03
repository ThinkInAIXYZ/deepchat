import type {
  Agent,
  IAgentImplementation,
  CreateSessionInput,
  SessionRecord,
  SessionWithState,
  ChatMessageRecord,
  UserMessageContent,
  AssistantMessageBlock,
  PermissionMode,
  SessionGenerationSettings,
  ToolInteractionResponse,
  ToolInteractionResult
} from '@shared/types/agent-interface'
import type { IConfigPresenter, ILlmProviderPresenter, ISkillPresenter } from '@shared/presenter'
import type { SQLitePresenter } from '../sqlitePresenter'
import type { DeepChatAgentPresenter } from '../deepchatAgentPresenter'
import { AgentRegistry } from './agentRegistry'
import { NewSessionManager } from './sessionManager'
import { NewMessageManager } from './messageManager'
import { eventBus, SendTarget } from '@/eventbus'
import { SESSION_EVENTS } from '@/events'

export class NewAgentPresenter {
  private agentRegistry: AgentRegistry
  private sessionManager: NewSessionManager
  private messageManager: NewMessageManager
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
