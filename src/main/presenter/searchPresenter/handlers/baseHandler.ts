import type { IConfigPresenter, ILlmProviderPresenter, ISQLitePresenter } from '@shared/presenter'
import type { MessageManager } from '../../sessionPresenter/managers/messageManager'
import type { SearchManager } from '../managers/searchManager'

export interface ThreadHandlerContext {
  sqlitePresenter: ISQLitePresenter
  messageManager: MessageManager
  llmProviderPresenter: ILlmProviderPresenter
  configPresenter: IConfigPresenter
  searchManager: SearchManager
}

export abstract class BaseHandler {
  protected readonly ctx: ThreadHandlerContext

  constructor(context: ThreadHandlerContext) {
    this.ctx = context
  }
}
