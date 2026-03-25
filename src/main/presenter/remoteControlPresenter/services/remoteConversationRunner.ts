import { BrowserWindow } from 'electron'
import type { ChatMessageRecord, SessionWithState } from '@shared/types/agent-interface'
import type {
  IConfigPresenter,
  INewAgentPresenter,
  ITabPresenter,
  IWindowPresenter
} from '@shared/presenter'
import type { DeepChatAgentPresenter } from '../../deepchatAgentPresenter'
import {
  TELEGRAM_RECENT_SESSION_LIMIT,
  TELEGRAM_STREAM_POLL_INTERVAL_MS,
  type RemoteEndpointBindingMeta,
  type TelegramModelProviderOption
} from '../types'
import {
  buildTelegramFinalText,
  extractTelegramDraftText,
  safeParseAssistantBlocks
} from '../telegram/telegramOutbound'
import { RemoteBindingStore } from './remoteBindingStore'

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export interface RemoteConversationSnapshot {
  messageId: string | null
  text: string
  completed: boolean
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
}

type RemoteConversationRunnerDeps = {
  configPresenter: IConfigPresenter
  newAgentPresenter: INewAgentPresenter
  deepchatAgentPresenter: DeepChatAgentPresenter
  windowPresenter: IWindowPresenter
  tabPresenter: ITabPresenter
  resolveDefaultAgentId: () => Promise<string>
}

type ChatWindowLookupPresenter = ITabPresenter & {
  getWindowType(windowId: number): 'chat' | 'browser'
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
    const session = await this.deps.newAgentPresenter.createDetachedSession({
      title: title?.trim() || 'New Chat',
      agentId
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

    const session = await this.deps.newAgentPresenter.getSession(binding.sessionId)
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
    const sessions = await this.deps.newAgentPresenter.getSessionList({
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

    const session = await this.deps.newAgentPresenter.getSession(sessionId)
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

    return await this.deps.newAgentPresenter.setSessionModel(session.id, providerId, modelId)
  }

  async sendText(
    endpointKey: string,
    text: string,
    bindingMeta?: RemoteEndpointBindingMeta
  ): Promise<RemoteConversationExecution> {
    const session = await this.ensureBoundSession(endpointKey, bindingMeta)
    const beforeMessages = await this.deps.newAgentPresenter.getMessages(session.id)
    const lastOrderSeq = beforeMessages.at(-1)?.orderSeq ?? 0
    const previousActiveEventId =
      this.deps.deepchatAgentPresenter.getActiveGeneration(session.id)?.eventId ?? null

    await this.deps.newAgentPresenter.sendMessage(session.id, text)

    const seededMessage = await this.waitForAssistantMessage(session.id, lastOrderSeq, 800, {
      ignoreMessageId: previousActiveEventId
    })
    if (seededMessage) {
      this.bindingStore.rememberActiveEvent(endpointKey, seededMessage.id)
    }

    return {
      sessionId: session.id,
      eventId: seededMessage?.id ?? null,
      getSnapshot: async () =>
        await this.getConversationSnapshot(endpointKey, session.id, {
          afterOrderSeq: lastOrderSeq,
          preferredMessageId: seededMessage?.id ?? null,
          ignoreMessageId: previousActiveEventId
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
      this.deps.deepchatAgentPresenter.getActiveGeneration(session.id)?.eventId ??
      null

    if (!activeEventId) {
      return false
    }

    const stopped = await this.deps.deepchatAgentPresenter.cancelGenerationByEventId(
      session.id,
      activeEventId
    )
    if (stopped) {
      this.bindingStore.clearActiveEvent(endpointKey)
    }
    return stopped
  }

  async open(endpointKey: string): Promise<SessionWithState | null> {
    const session = await this.getCurrentSession(endpointKey)
    if (!session) {
      return null
    }

    const window = await this.resolveChatWindow()
    if (!window || window.isDestroyed()) {
      return null
    }

    await this.deps.newAgentPresenter.activateSession(window.webContents.id, session.id)
    this.deps.windowPresenter.show(window.id, true)
    return session
  }

  async getStatus(endpointKey: string): Promise<RemoteRunnerStatus> {
    const session = await this.getCurrentSession(endpointKey)
    if (!session) {
      return {
        session: null,
        activeEventId: null,
        isGenerating: false
      }
    }

    const activeEventId =
      this.bindingStore.getActiveEvent(endpointKey) ??
      this.deps.deepchatAgentPresenter.getActiveGeneration(session.id)?.eventId ??
      null

    return {
      session,
      activeEventId,
      isGenerating: Boolean(activeEventId) || session.status === 'generating'
    }
  }

  async getDefaultAgentId(): Promise<string> {
    return await this.deps.resolveDefaultAgentId()
  }

  private async resolveSessionListAgentId(endpointKey: string): Promise<string> {
    const currentSession = await this.getCurrentSession(endpointKey)
    return currentSession?.agentId ?? (await this.deps.resolveDefaultAgentId())
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
    const session = await this.deps.newAgentPresenter.getSession(sessionId)
    if (!session) {
      this.bindingStore.clearBinding(endpointKey)
      return {
        messageId: null,
        text: 'The bound session no longer exists.',
        completed: true
      }
    }

    const activeGeneration = this.deps.deepchatAgentPresenter.getActiveGeneration(sessionId)
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
        completed
      }
    }

    const blocks = safeParseAssistantBlocks(trackedMessage.content)
    const completed =
      trackedMessage.status !== 'pending' &&
      (!activeGeneration || activeGeneration.eventId !== trackedMessage.id)

    if (completed) {
      this.bindingStore.clearActiveEvent(endpointKey)
    }

    return {
      messageId: trackedMessage.id,
      text: completed ? buildTelegramFinalText(blocks) : extractTelegramDraftText(blocks),
      completed
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
      const activeGeneration = this.deps.deepchatAgentPresenter.getActiveGeneration(sessionId)
      if (activeGeneration?.eventId && activeGeneration.eventId !== options?.ignoreMessageId) {
        const message = await this.deps.newAgentPresenter.getMessage(activeGeneration.eventId)
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

      const message = await this.deps.newAgentPresenter.getMessage(messageId)
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
    const messages = await this.deps.newAgentPresenter.getMessages(sessionId)
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
