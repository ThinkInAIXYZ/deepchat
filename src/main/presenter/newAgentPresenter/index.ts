import type {
  Agent,
  CreateSessionInput,
  SessionWithState,
  ChatMessageRecord
} from '@shared/types/agent-interface'
import type { IConfigPresenter } from '@shared/presenter'
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
  private configPresenter: IConfigPresenter

  constructor(
    deepchatAgent: DeepChatAgentPresenter,
    configPresenter: IConfigPresenter,
    sqlitePresenter: SQLitePresenter
  ) {
    this.configPresenter = configPresenter
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

    const agent = this.agentRegistry.resolve(agentId)

    // Resolve provider/model
    const defaultModel = this.configPresenter.getDefaultModel()
    const providerId = input.providerId ?? defaultModel?.providerId ?? ''
    const modelId = input.modelId ?? defaultModel?.modelId ?? ''
    console.log(`[NewAgentPresenter] resolved provider=${providerId} model=${modelId}`)

    if (!providerId || !modelId) {
      throw new Error('No provider or model configured. Please set a default model in settings.')
    }

    // Create session record
    const title = input.message.slice(0, 50) || 'New Chat'
    const sessionId = this.sessionManager.create(agentId, title, input.projectDir ?? null)
    console.log(`[NewAgentPresenter] session created id=${sessionId} title="${title}"`)

    // Initialize agent-side session
    await agent.initSession(sessionId, { providerId, modelId })
    console.log(`[NewAgentPresenter] agent.initSession done`)

    // Bind to window and emit activated
    this.sessionManager.bindWindow(webContentsId, sessionId)
    eventBus.sendToRenderer(SESSION_EVENTS.ACTIVATED, SendTarget.ALL_WINDOWS, {
      webContentsId,
      sessionId
    })
    eventBus.sendToRenderer(SESSION_EVENTS.LIST_UPDATED, SendTarget.ALL_WINDOWS)

    // Process the first message (non-blocking)
    console.log(`[NewAgentPresenter] firing processMessage (non-blocking)`)
    agent.processMessage(sessionId, input.message).catch((err) => {
      console.error('[NewAgentPresenter] processMessage failed:', err)
    })

    // Return enriched session
    const state = await agent.getSessionState(sessionId)
    return {
      id: sessionId,
      agentId,
      title,
      projectDir: input.projectDir ?? null,
      isPinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: state?.status ?? 'idle',
      providerId: state?.providerId ?? providerId,
      modelId: state?.modelId ?? modelId
    }
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    const agent = this.agentRegistry.resolve(session.agentId)
    await agent.processMessage(sessionId, content)
  }

  async getSessionList(filters?: {
    agentId?: string
    projectDir?: string
  }): Promise<SessionWithState[]> {
    const records = this.sessionManager.list(filters)
    const enriched: SessionWithState[] = []

    for (const record of records) {
      const agent = this.agentRegistry.resolve(record.agentId)
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
    const agent = this.agentRegistry.resolve(record.agentId)
    const state = await agent.getSessionState(sessionId)
    return {
      ...record,
      status: state?.status ?? 'idle',
      providerId: state?.providerId ?? '',
      modelId: state?.modelId ?? ''
    }
  }

  async getMessages(sessionId: string): Promise<ChatMessageRecord[]> {
    return this.messageManager.getMessages(sessionId)
  }

  async getMessageIds(sessionId: string): Promise<string[]> {
    return this.messageManager.getMessageIds(sessionId)
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
    return this.agentRegistry.getAll()
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) return
    const agent = this.agentRegistry.resolve(session.agentId)
    await agent.destroySession(sessionId)
    this.sessionManager.delete(sessionId)
    eventBus.sendToRenderer(SESSION_EVENTS.LIST_UPDATED, SendTarget.ALL_WINDOWS)
  }

  async cancelGeneration(sessionId: string): Promise<void> {
    const session = this.sessionManager.get(sessionId)
    if (!session) return
    const agent = this.agentRegistry.resolve(session.agentId)
    await agent.cancelGeneration(sessionId)
  }
}
