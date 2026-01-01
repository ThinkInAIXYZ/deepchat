import type {
  IAgentPresenter,
  IConfigPresenter,
  IThreadPresenter,
  MESSAGE
} from '@shared/presenter'
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

  async sendMessage(agentId: string, content: string, _tabId?: number): Promise<MESSAGE | null> {
    await this.logResolvedIfEnabled(agentId)
    return this.threadPresenter.sendMessage(agentId, content, 'user')
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
