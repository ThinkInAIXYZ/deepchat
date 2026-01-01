import type { IAgentPresenter, IConfigPresenter, IThreadPresenter } from '@shared/presenter'
import type { AssistantMessage } from '@shared/chat'
import { eventBus, SendTarget } from '@/eventbus'
import { STREAM_EVENTS } from '@/events'
import type { SessionContextResolved } from './session/sessionContext'
import { resolveSessionContext } from './session/sessionResolver'

type AgentPresenterDependencies = {
  threadPresenter: IThreadPresenter
  configPresenter: IConfigPresenter
}

export class AgentPresenter implements IAgentPresenter {
  private threadPresenter: IThreadPresenter
  private configPresenter: IConfigPresenter

  constructor({ threadPresenter, configPresenter }: AgentPresenterDependencies) {
    this.threadPresenter = threadPresenter
    this.configPresenter = configPresenter
  }

  async sendMessage(
    agentId: string,
    content: string,
    _tabId?: number,
    selectedVariantsMap?: Record<string, string>
  ): Promise<AssistantMessage | null> {
    await this.logResolvedIfEnabled(agentId)
    const assistantMessage = await this.threadPresenter.sendMessage(agentId, content, 'user')
    if (!assistantMessage) {
      return null
    }

    void this.threadPresenter
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
    await this.threadPresenter.continueStreamCompletion(agentId, messageId, selectedVariantsMap)
  }

  async cancelLoop(messageId: string): Promise<void> {
    await this.threadPresenter.stopMessageGeneration(messageId)
  }

  async handlePermissionResponse(
    messageId: string,
    toolCallId: string,
    granted: boolean,
    permissionType: 'read' | 'write' | 'all' | 'command',
    remember?: boolean
  ): Promise<void> {
    await this.threadPresenter.handlePermissionResponse(
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
    return this.threadPresenter.getMessageRequestPreview(messageId)
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
    const conversation = await this.threadPresenter.getConversation(agentId)
    const fallbackChatMode = this.configPresenter.getSetting('input_chatMode') as
      | 'chat'
      | 'agent'
      | 'acp agent'
      | undefined
    const modelConfig = this.configPresenter.getModelDefaultConfig(
      conversation.settings.modelId,
      conversation.settings.providerId
    )

    return resolveSessionContext({
      settings: conversation.settings,
      fallbackChatMode,
      modelConfig
    })
  }
}
