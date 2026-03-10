import type { IConfigPresenter, ILlmProviderPresenter, ISQLitePresenter } from '@shared/presenter'
import type { CONVERSATION } from '@shared/presenter'
import type { MessageManager } from '../../sessionPresenter/managers/messageManager'

export type ThreadHandlerContext = {
  sqlitePresenter: ISQLitePresenter
  messageManager: MessageManager
  llmProviderPresenter: ILlmProviderPresenter
  configPresenter: IConfigPresenter
}

export class BaseHandler {
  protected ctx: ThreadHandlerContext

  constructor(context: ThreadHandlerContext) {
    this.ctx = context
  }

  protected get sqlitePresenter(): ISQLitePresenter {
    return this.ctx.sqlitePresenter
  }

  protected get messageManager(): MessageManager {
    return this.ctx.messageManager
  }

  protected get llmProviderPresenter(): ILlmProviderPresenter {
    return this.ctx.llmProviderPresenter
  }

  protected get configPresenter(): IConfigPresenter {
    return this.ctx.configPresenter
  }

  protected async getMessage(messageId: string) {
    return this.messageManager.getMessage(messageId)
  }

  protected async getConversation(conversationId: string): Promise<CONVERSATION> {
    const conversation = await this.ctx.sqlitePresenter.getConversation(conversationId)
    if (!conversation) {
      throw new Error('Conversation not found')
    }
    return conversation
  }
}
