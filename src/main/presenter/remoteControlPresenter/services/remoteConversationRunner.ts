import { BrowserWindow } from 'electron'
import type {
  ChatMessageRecord,
  SessionWithState,
  ToolInteractionResponse
} from '@shared/types/agent-interface'
import type { SearchResult } from '@shared/types/core/search'
import type {
  IConfigPresenter,
  IAgentSessionPresenter,
  RemoteChannel,
  ITabPresenter,
  IWindowPresenter
} from '@shared/presenter'
import type { AgentRuntimePresenter } from '../../agentRuntimePresenter'
import {
  TELEGRAM_RECENT_SESSION_LIMIT,
  type RemoteDeliverySegment,
  TELEGRAM_STREAM_POLL_INTERVAL_MS,
  type RemoteEndpointBindingMeta,
  type RemoteRenderableBlock,
  type RemotePendingInteraction,
  type TelegramModelProviderOption
} from '../types'
import { safeParseAssistantBlocks } from '../telegram/telegramOutbound'
import {
  REMOTE_NO_RESPONSE_TEXT,
  REMOTE_WAITING_STATUS_TEXT,
  buildRemoteDeliverySegments,
  buildRemoteDraftText,
  buildRemoteFinalText,
  buildRemoteFullText,
  buildRemoteRenderableBlocks,
  buildRemoteTraceText,
  buildRemoteStreamText,
  buildRemoteStatusText
} from './remoteBlockRenderer'
import { RemoteBindingStore } from './remoteBindingStore'
import { collectPendingInteraction } from './remoteInteraction'

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export interface RemoteConversationSnapshot {
  messageId: string | null
  text: string
  traceText?: string
  deliverySegments?: RemoteDeliverySegment[]
  statusText?: string
  finalText?: string
  draftText?: string
  renderBlocks?: RemoteRenderableBlock[]
  fullText?: string
  completed: boolean
  pendingInteraction: RemotePendingInteraction | null
}

export interface RemoteConversationExecution {
  sessionId: string
  eventId: string | null
  getSnapshot(): Promise<RemoteConversationSnapshot>
}

export interface RemoteRunnerStatus {
  session: SessionWithState | null
  activeEventId: string | null
  isGenerating: boolean
  pendingInteraction: RemotePendingInteraction | null
}

export type RemoteOpenSessionResult =
  | {
      status: 'noSession'
    }
  | {
      status: 'windowNotFound'
    }
  | {
      status: 'ok'
      session: SessionWithState
    }

type RemoteConversationRunnerDeps = {
  configPresenter: IConfigPresenter
  agentSessionPresenter: IAgentSessionPresenter
  agentRuntimePresenter: AgentRuntimePresenter
  windowPresenter: IWindowPresenter
  tabPresenter: ITabPresenter
  resolveDefaultAgentId: () => Promise<string>
}

type ChatWindowLookupPresenter = ITabPresenter & {
  getWindowType(windowId: number): 'chat' | 'browser'
}

type PendingInteractionDetails = RemotePendingInteraction & {
  messageOrderSeq: number
}

export class RemoteConversationRunner {
  constructor(
    private readonly deps: RemoteConversationRunnerDeps,
    private readonly bindingStore: RemoteBindingStore
  ) {}

  async createNewSession(
    endpointKey: string,
    title?: string,
    bindingMeta?: RemoteEndpointBindingMeta
  ): Promise<SessionWithState> {
    const agentId = await this.deps.resolveDefaultAgentId()
    const agentType = await this.deps.configPresenter.getAgentType(agentId)
    const projectDir =
      agentType === 'acp' ? await this.resolveDefaultWorkdirForAgent(endpointKey, agentId) : null
    if (agentType === 'acp' && !projectDir) {
      throw new Error(
        'ACP agent requires a workdir. Set a Remote default directory or global default directory first.'
      )
    }

    const session = await this.deps.agentSessionPresenter.createDetachedSession({
      title: title?.trim() || 'New Chat',
      agentId,
      ...(agentType === 'acp'
        ? {
            providerId: 'acp',
            modelId: agentId,
            projectDir: projectDir ?? undefined
          }
        : {})
    })
    if (bindingMeta) {
      this.bindingStore.setBinding(endpointKey, session.id, bindingMeta)
    } else {
      this.bindingStore.setBinding(endpointKey, session.id)
    }
    return session
  }

  async getCurrentSession(endpointKey: string): Promise<SessionWithState | null> {
    const binding = this.bindingStore.getBinding(endpointKey)
    if (!binding) {
      return null
    }

    const session = await this.deps.agentSessionPresenter.getSession(binding.sessionId)
    if (!session) {
      this.bindingStore.clearBinding(endpointKey)
      return null
    }

    return session
  }

  async ensureBoundSession(
    endpointKey: string,
    bindingMeta?: RemoteEndpointBindingMeta
  ): Promise<SessionWithState> {
    const existing = await this.getCurrentSession(endpointKey)
    if (existing) {
      return existing
    }

    return await this.createNewSession(endpointKey, undefined, bindingMeta)
  }

  async listSessions(endpointKey: string): Promise<SessionWithState[]> {
    const agentId = await this.resolveSessionListAgentId(endpointKey)
    const sessions = await this.deps.agentSessionPresenter.getSessionList({
      agentId
    })
    const sorted = [...sessions]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, TELEGRAM_RECENT_SESSION_LIMIT)
    this.bindingStore.rememberSessionSnapshot(
      endpointKey,
      sorted.map((session) => session.id)
    )
    return sorted
  }

  async useSessionByIndex(
    endpointKey: string,
    index: number,
    bindingMeta?: RemoteEndpointBindingMeta
  ): Promise<SessionWithState> {
    const snapshot = this.bindingStore.getSessionSnapshot(endpointKey)
    if (snapshot.length === 0) {
      throw new Error('Run /sessions first before using /use.')
    }

    const sessionId = snapshot[index]
    if (!sessionId) {
      throw new Error('Session index is out of range.')
    }

    const session = await this.deps.agentSessionPresenter.getSession(sessionId)
    if (!session) {
      throw new Error('Selected session no longer exists.')
    }

    if (bindingMeta) {
      this.bindingStore.setBinding(endpointKey, session.id, bindingMeta)
    } else {
      this.bindingStore.setBinding(endpointKey, session.id)
    }
    return session
  }

  async listAvailableModelProviders(): Promise<TelegramModelProviderOption[]> {
    const enabledProviders = this.deps.configPresenter.getEnabledProviders()
    const enabledModelGroups = await this.deps.configPresenter.getAllEnabledModels()
    const providerNameById = new Map(
      enabledProviders.map((provider) => [provider.id, provider.name])
    )

    return enabledModelGroups
      .filter((group) => providerNameById.has(group.providerId) && group.models.length > 0)
      .map((group) => ({
        providerId: group.providerId,
        providerName: providerNameById.get(group.providerId) ?? group.providerId,
        models: group.models.map((model) => ({
          modelId: model.id,
          modelName: model.name || model.id
        }))
      }))
  }

  async setSessionModel(
    endpointKey: string,
    providerId: string,
    modelId: string
  ): Promise<SessionWithState> {
    const session = await this.getCurrentSession(endpointKey)
    if (!session) {
      throw new Error('No bound session. Send a message, /new, or /use first.')
    }

    return await this.deps.agentSessionPresenter.setSessionModel(session.id, providerId, modelId)
  }

  async sendText(
    endpointKey: string,
    text: string,
    bindingMeta?: RemoteEndpointBindingMeta
  ): Promise<RemoteConversationExecution> {
    const session = await this.ensureBoundSession(endpointKey, bindingMeta)
    const beforeMessages = await this.deps.agentSessionPresenter.getMessages(session.id)
    const lastOrderSeq = beforeMessages.at(-1)?.orderSeq ?? 0
    const previousActiveEventId =
      this.deps.agentRuntimePresenter.getActiveGeneration(session.id)?.eventId ?? null

    await this.deps.agentSessionPresenter.sendMessage(session.id, text)

    const seededMessage = await this.waitForAssistantMessage(session.id, lastOrderSeq, 800, {
      ignoreMessageId: previousActiveEventId
    })
    if (seededMessage) {
      this.bindingStore.rememberActiveEvent(endpointKey, seededMessage.id)
    }

    return this.createExecution(endpointKey, session.id, {
      afterOrderSeq: lastOrderSeq,
      preferredMessageId: seededMessage?.id ?? null,
      ignoreMessageId: previousActiveEventId
    })
  }

  async getPendingInteraction(endpointKey: string): Promise<RemotePendingInteraction | null> {
    const session = await this.getCurrentSession(endpointKey)
    if (!session) {
      return null
    }

    const interaction = await this.getCurrentPendingInteractionDetails(session.id)
    if (!interaction) {
      return null
    }

    const { messageOrderSeq: _messageOrderSeq, ...rest } = interaction
    return rest
  }

  async respondToPendingInteraction(
    endpointKey: string,
    response: ToolInteractionResponse
  ): Promise<{
    waitingForUserMessage: boolean
    execution: RemoteConversationExecution | null
  }> {
    const session = await this.getCurrentSession(endpointKey)
    if (!session) {
      throw new Error('No bound session. Send a message, /new, or /use first.')
    }

    const interaction = await this.getCurrentPendingInteractionDetails(session.id)
    if (!interaction) {
      throw new Error('No pending interaction was found.')
    }

    const result = await this.deps.agentSessionPresenter.respondToolInteraction(
      session.id,
      interaction.messageId,
      interaction.toolCallId,
      response
    )

    this.bindingStore.clearActiveEvent(endpointKey)

    if (result.waitingForUserMessage) {
      return {
        waitingForUserMessage: true,
        execution: null
      }
    }

    return {
      waitingForUserMessage: false,
      execution: this.createExecution(endpointKey, session.id, {
        afterOrderSeq: Math.max(0, interaction.messageOrderSeq - 1),
        preferredMessageId: interaction.messageId,
        ignoreMessageId: null
      })
    }
  }

  async stop(endpointKey: string): Promise<boolean> {
    const session = await this.getCurrentSession(endpointKey)
    if (!session) {
      return false
    }

    const activeEventId =
      this.bindingStore.getActiveEvent(endpointKey) ??
      this.deps.agentRuntimePresenter.getActiveGeneration(session.id)?.eventId ??
      null

    if (!activeEventId) {
      return false
    }

    const stopped = await this.deps.agentRuntimePresenter.cancelGenerationByEventId(
      session.id,
      activeEventId
    )
    if (stopped) {
      this.bindingStore.clearActiveEvent(endpointKey)
    }
    return stopped
  }

  async open(endpointKey: string): Promise<RemoteOpenSessionResult> {
    const session = await this.getCurrentSession(endpointKey)
    if (!session) {
      return {
        status: 'noSession'
      }
    }

    const window = await this.resolveChatWindow()
    if (!window || window.isDestroyed()) {
      return {
        status: 'windowNotFound'
      }
    }

    await this.deps.agentSessionPresenter.activateSession(window.webContents.id, session.id)
    this.deps.windowPresenter.show(window.id, true)
    return {
      status: 'ok',
      session
    }
  }

  async getStatus(endpointKey: string): Promise<RemoteRunnerStatus> {
    const session = await this.getCurrentSession(endpointKey)
    if (!session) {
      return {
        session: null,
        activeEventId: null,
        isGenerating: false,
        pendingInteraction: null
      }
    }

    const pendingInteraction = await this.getCurrentPendingInteractionDetails(session.id)

    const activeEventId =
      this.bindingStore.getActiveEvent(endpointKey) ??
      this.deps.agentRuntimePresenter.getActiveGeneration(session.id)?.eventId ??
      null

    return {
      session,
      activeEventId,
      isGenerating:
        !pendingInteraction && (Boolean(activeEventId) || session.status === 'generating'),
      pendingInteraction: pendingInteraction
        ? this.stripPendingInteractionDetails(pendingInteraction)
        : null
    }
  }

  async getDefaultAgentId(): Promise<string> {
    return await this.deps.resolveDefaultAgentId()
  }

  async getDefaultWorkdir(endpointKey: string): Promise<string | null> {
    const agentId = await this.deps.resolveDefaultAgentId()
    return await this.resolveDefaultWorkdirForAgent(endpointKey, agentId)
  }

  async isSessionModelLocked(session: Pick<SessionWithState, 'agentId'>): Promise<boolean> {
    return (await this.deps.configPresenter.getAgentType(session.agentId)) === 'acp'
  }

  private async resolveSessionListAgentId(endpointKey: string): Promise<string> {
    const currentSession = await this.getCurrentSession(endpointKey)
    return currentSession?.agentId ?? (await this.deps.resolveDefaultAgentId())
  }

  private resolveChannelFromEndpointKey(endpointKey: string): RemoteChannel {
    if (endpointKey.startsWith('feishu:')) {
      return 'feishu'
    }

    if (endpointKey.startsWith('qqbot:')) {
      return 'qqbot'
    }

    if (endpointKey.startsWith('weixin-ilink:')) {
      return 'weixin-ilink'
    }

    return 'telegram'
  }

  private getConfiguredDefaultWorkdir(endpointKey: string): string | null {
    const channel = this.resolveChannelFromEndpointKey(endpointKey)
    const config =
      channel === 'feishu'
        ? this.bindingStore.getFeishuConfig()
        : channel === 'qqbot'
          ? this.bindingStore.getQQBotConfig()
          : this.bindingStore.getTelegramConfig()
    const normalized = config.defaultWorkdir?.trim()
    return normalized ? normalized : null
  }

  private getGlobalDefaultWorkdir(): string | null {
    const projectDir = this.deps.configPresenter.getDefaultProjectPath()
    const normalized = projectDir?.trim()
    return normalized ? normalized : null
  }

  private async resolveDefaultWorkdirForAgent(
    endpointKey: string,
    agentId: string
  ): Promise<string | null> {
    if ((await this.deps.configPresenter.getAgentType(agentId)) !== 'acp') {
      return null
    }

    return this.getConfiguredDefaultWorkdir(endpointKey) ?? this.getGlobalDefaultWorkdir()
  }

  private async getConversationSnapshot(
    endpointKey: string,
    sessionId: string,
    tracking: {
      afterOrderSeq: number
      preferredMessageId: string | null
      ignoreMessageId: string | null
    }
  ): Promise<RemoteConversationSnapshot> {
    const session = await this.deps.agentSessionPresenter.getSession(sessionId)
    if (!session) {
      this.bindingStore.clearBinding(endpointKey)
      return {
        messageId: null,
        text: 'The bound session no longer exists.',
        traceText: '',
        deliverySegments: [],
        statusText: '',
        finalText: 'The bound session no longer exists.',
        draftText: '',
        renderBlocks: [],
        fullText: 'The bound session no longer exists.',
        completed: true,
        pendingInteraction: null
      }
    }

    const activeGeneration = this.deps.agentRuntimePresenter.getActiveGeneration(sessionId)
    const trackedMessage = await this.resolveTrackedAssistantMessage(
      sessionId,
      tracking,
      activeGeneration
    )
    if (trackedMessage) {
      this.bindingStore.rememberActiveEvent(endpointKey, trackedMessage.id)
    } else if (activeGeneration?.eventId && activeGeneration.eventId !== tracking.ignoreMessageId) {
      this.bindingStore.rememberActiveEvent(endpointKey, activeGeneration.eventId)
    }

    if (!trackedMessage) {
      const completed = !activeGeneration && session.status !== 'generating'
      if (completed) {
        this.bindingStore.clearActiveEvent(endpointKey)
      }
      return {
        messageId: null,
        text: completed ? 'No assistant response was produced.' : '',
        traceText: '',
        deliverySegments: [],
        statusText: completed ? '' : buildRemoteStatusText([]),
        finalText: completed ? REMOTE_NO_RESPONSE_TEXT : '',
        draftText: '',
        renderBlocks: [],
        fullText: completed ? REMOTE_NO_RESPONSE_TEXT : '',
        completed,
        pendingInteraction: null
      }
    }

    const blocks = safeParseAssistantBlocks(trackedMessage.content)
    const streamText = buildRemoteStreamText(blocks)
    const traceText = buildRemoteTraceText(blocks)
    const draftText = buildRemoteDraftText(blocks)
    const deliverySegments = buildRemoteDeliverySegments(trackedMessage.id, blocks)
    const renderBlocks = await buildRemoteRenderableBlocks({
      messageId: trackedMessage.id,
      blocks,
      loadSearchResults: async (messageId, searchId) =>
        await this.loadSearchResults(messageId, searchId)
    })
    const fullText = buildRemoteFullText(renderBlocks)
    const pendingInteraction = collectPendingInteraction(
      trackedMessage.id,
      trackedMessage.orderSeq,
      blocks
    )
    const statusText = buildRemoteStatusText(blocks, Boolean(pendingInteraction))
    const finalText = buildRemoteFinalText(blocks, {
      preferTerminalError: trackedMessage.status === 'error',
      fallbackErrorText:
        trackedMessage.status === 'error' ? 'The conversation ended with an error.' : undefined,
      fallbackNoResponseText: REMOTE_NO_RESPONSE_TEXT
    })
    const completed =
      Boolean(pendingInteraction) ||
      (trackedMessage.status !== 'pending' &&
        (!activeGeneration || activeGeneration.eventId !== trackedMessage.id))

    if (completed) {
      this.bindingStore.clearActiveEvent(endpointKey)
    }

    return {
      messageId: trackedMessage.id,
      text: streamText,
      traceText,
      deliverySegments,
      statusText: pendingInteraction ? REMOTE_WAITING_STATUS_TEXT : statusText,
      finalText,
      draftText,
      renderBlocks,
      fullText,
      completed,
      pendingInteraction: pendingInteraction
        ? this.stripPendingInteractionDetails(pendingInteraction)
        : null
    }
  }

  private async loadSearchResults(messageId: string, searchId?: string): Promise<SearchResult[]> {
    if (typeof this.deps.agentSessionPresenter.getSearchResults !== 'function') {
      return []
    }

    try {
      return await this.deps.agentSessionPresenter.getSearchResults(messageId, searchId)
    } catch (error) {
      console.warn('[RemoteConversationRunner] Failed to load search results:', {
        messageId,
        searchId,
        error
      })
      return []
    }
  }

  private async waitForAssistantMessage(
    sessionId: string,
    afterOrderSeq: number,
    timeoutMs: number,
    options?: {
      ignoreMessageId?: string | null
    }
  ): Promise<ChatMessageRecord | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const activeGeneration = this.deps.agentRuntimePresenter.getActiveGeneration(sessionId)
      if (activeGeneration?.eventId && activeGeneration.eventId !== options?.ignoreMessageId) {
        const message = await this.deps.agentSessionPresenter.getMessage(activeGeneration.eventId)
        if (message?.role === 'assistant') {
          return message
        }
      }

      const fallback = await this.findLatestAssistantMessageAfter(
        sessionId,
        afterOrderSeq,
        options?.ignoreMessageId
      )
      if (fallback) {
        return fallback
      }

      await sleep(Math.min(TELEGRAM_STREAM_POLL_INTERVAL_MS, 120))
    }

    return null
  }

  private async resolveTrackedAssistantMessage(
    sessionId: string,
    tracking: {
      afterOrderSeq: number
      preferredMessageId: string | null
      ignoreMessageId: string | null
    },
    activeGeneration: { eventId: string; runId: string } | null
  ): Promise<ChatMessageRecord | null> {
    const candidateIds = [activeGeneration?.eventId ?? null, tracking.preferredMessageId]
    for (const messageId of candidateIds) {
      if (!messageId || messageId === tracking.ignoreMessageId) {
        continue
      }

      const message = await this.deps.agentSessionPresenter.getMessage(messageId)
      if (message?.role === 'assistant') {
        return message
      }
    }

    return await this.findLatestAssistantMessageAfter(
      sessionId,
      tracking.afterOrderSeq,
      tracking.ignoreMessageId
    )
  }

  private async findLatestAssistantMessageAfter(
    sessionId: string,
    afterOrderSeq: number,
    ignoreMessageId?: string | null
  ): Promise<ChatMessageRecord | null> {
    const messages = await this.deps.agentSessionPresenter.getMessages(sessionId)
    const assistants = messages.filter(
      (message) =>
        message.role === 'assistant' &&
        message.orderSeq > afterOrderSeq &&
        message.id !== ignoreMessageId
    )
    if (assistants.length === 0) {
      return null
    }

    return assistants.sort((left, right) => right.orderSeq - left.orderSeq)[0]
  }

  private createExecution(
    endpointKey: string,
    sessionId: string,
    tracking: {
      afterOrderSeq: number
      preferredMessageId: string | null
      ignoreMessageId: string | null
    }
  ): RemoteConversationExecution {
    return {
      sessionId,
      eventId: tracking.preferredMessageId,
      getSnapshot: async () => await this.getConversationSnapshot(endpointKey, sessionId, tracking)
    }
  }

  private async getCurrentPendingInteractionDetails(
    sessionId: string
  ): Promise<PendingInteractionDetails | null> {
    const messages = await this.deps.agentSessionPresenter.getMessages(sessionId)
    const assistants = [...messages]
      .filter((message) => message.role === 'assistant')
      .sort((left, right) => right.orderSeq - left.orderSeq)

    for (const message of assistants) {
      const blocks = safeParseAssistantBlocks(message.content)
      const interaction = collectPendingInteraction(message.id, message.orderSeq, blocks)
      if (interaction) {
        return interaction
      }
    }

    return null
  }

  private stripPendingInteractionDetails(
    interaction: PendingInteractionDetails
  ): RemotePendingInteraction {
    const { messageOrderSeq: _messageOrderSeq, ...rest } = interaction
    return rest
  }

  private async resolveChatWindow(): Promise<BrowserWindow | null> {
    const tabPresenter = this.deps.tabPresenter as ChatWindowLookupPresenter
    const chatWindows = this.deps.windowPresenter
      .getAllWindows()
      .filter((window) => !window.isDestroyed() && tabPresenter.getWindowType(window.id) === 'chat')

    const focusedWindow = this.deps.windowPresenter.getFocusedWindow()
    if (
      focusedWindow &&
      !focusedWindow.isDestroyed() &&
      chatWindows.some((window) => window.id === focusedWindow.id)
    ) {
      return focusedWindow
    }

    if (chatWindows.length > 0) {
      return chatWindows[0]
    }

    const createdWindowId = await this.deps.windowPresenter.createAppWindow({
      initialRoute: 'chat'
    })
    if (!createdWindowId) {
      return null
    }

    return BrowserWindow.fromId(createdWindowId)
  }
}
