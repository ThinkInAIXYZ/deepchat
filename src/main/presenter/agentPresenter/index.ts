import type { IAgentPresenter, ISessionPresenter } from '@shared/presenter'
import type { AssistantMessage } from '@shared/chat'
import { eventBus, SendTarget } from '@/eventbus'
import { STREAM_EVENTS } from '@/events'
import type { SessionContextResolved } from './session/sessionContext'
import type { SessionManager } from './session/sessionManager'

type AgentPresenterDependencies = {
  sessionPresenter: ISessionPresenter
  sessionManager: SessionManager
}

export class AgentPresenter implements IAgentPresenter {
  private sessionPresenter: ISessionPresenter
  private sessionManager: SessionManager

  constructor({ sessionPresenter, sessionManager }: AgentPresenterDependencies) {
    this.sessionPresenter = sessionPresenter
    this.sessionManager = sessionManager
    this.bindSessionPresenterMethods()
  }

  async sendMessage(
    agentId: string,
    content: string,
    _tabId?: number,
    selectedVariantsMap?: Record<string, string>
  ): Promise<AssistantMessage | null> {
    await this.logResolvedIfEnabled(agentId)
    const assistantMessage = await this.sessionPresenter.sendMessage(agentId, content)
    if (!assistantMessage) {
      return null
    }

    await this.sessionManager.startLoop(agentId, assistantMessage.id)
    void this.sessionPresenter
      .startStreamCompletion(agentId, assistantMessage.id, selectedVariantsMap)
      .catch((error) => {
        console.error('[AgentPresenter] Failed to start stream completion:', error)
        eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
          eventId: assistantMessage.id
        })
      })

    return assistantMessage
  }

  async continueLoop(
    agentId: string,
    messageId: string,
    selectedVariantsMap?: Record<string, string>
  ): Promise<void> {
    await this.logResolvedIfEnabled(agentId)
    await this.sessionManager.startLoop(agentId, messageId)
    await this.sessionPresenter.continueStreamCompletion(agentId, messageId, selectedVariantsMap)
  }

  async cancelLoop(messageId: string): Promise<void> {
    try {
      const message = await this.sessionPresenter.getMessage(messageId)
      if (message) {
        this.sessionManager.updateRuntime(message.conversationId, { userStopRequested: true })
        this.sessionManager.setStatus(message.conversationId, 'paused')
      }
    } catch (error) {
      console.warn('[AgentPresenter] Failed to update session state for cancel:', error)
    }
    await this.sessionPresenter.stopMessageGeneration(messageId)
  }

  async handlePermissionResponse(
    messageId: string,
    toolCallId: string,
    granted: boolean,
    permissionType: 'read' | 'write' | 'all' | 'command',
    remember?: boolean
  ): Promise<void> {
    await this.sessionPresenter.handlePermissionResponse(
      messageId,
      toolCallId,
      granted,
      permissionType,
      remember
    )
  }

  async getMessageRequestPreview(agentId: string, messageId?: string): Promise<unknown> {
    if (!messageId) {
      return null
    }
    await this.logResolvedIfEnabled(agentId)
    return this.sessionPresenter.getMessageRequestPreview(messageId)
  }

  private shouldLogResolved(): boolean {
    return import.meta.env.VITE_AGENT_PRESENTER_DEBUG === '1'
  }

  private async logResolvedIfEnabled(agentId: string): Promise<void> {
    if (!this.shouldLogResolved()) {
      return
    }
    try {
      const resolved = await this.resolveSession(agentId)
      console.log('[AgentPresenter] SessionContext.resolved', { agentId, resolved })
    } catch (error) {
      console.warn('[AgentPresenter] Failed to resolve session context', { agentId, error })
    }
  }

  private async resolveSession(agentId: string): Promise<SessionContextResolved> {
    const session = await this.sessionManager.getSession(agentId)
    return session.resolved
  }

  private bindSessionPresenterMethods(): void {
    const sessionPresenter = this.sessionPresenter as unknown as Record<string, unknown>
    const sessionProto = Object.getPrototypeOf(sessionPresenter) as Record<string, unknown>
    for (const key of Object.getOwnPropertyNames(sessionProto)) {
      if (key === 'constructor') continue
      if (key in this) continue
      const value = sessionPresenter[key]
      if (typeof value === 'function') {
        ;(this as Record<string, unknown>)[key] = value.bind(this.sessionPresenter)
      }
    }
  }
}
