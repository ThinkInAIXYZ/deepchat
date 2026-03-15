import type {
  IConfigPresenter,
  ILlmProviderPresenter,
  ISQLitePresenter,
  IToolPresenter
} from '@shared/presenter'
import type { CONVERSATION } from '@shared/presenter'
import type { MessageManager } from '../../sessionPresenter/managers/messageManager'
import type { AgentSessionRuntimePort } from '../session/sessionRuntimePort'
import type {
  AgentMcpRuntimePort,
  AgentPermissionRuntimePort,
  AgentPromptRuntimePort
} from '../runtimePorts'

export type ThreadHandlerContext = {
  sqlitePresenter: ISQLitePresenter
  messageManager: MessageManager
  llmProviderPresenter: ILlmProviderPresenter
  configPresenter: IConfigPresenter
  sessionRuntime: AgentSessionRuntimePort
  toolPresenter: IToolPresenter
  mcpRuntime: AgentMcpRuntimePort
  promptRuntime: AgentPromptRuntimePort
  permissionRuntime: AgentPermissionRuntimePort
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

  protected get sessionRuntime(): AgentSessionRuntimePort {
    return this.ctx.sessionRuntime
  }

  protected get toolPresenter(): IToolPresenter {
    return this.ctx.toolPresenter
  }

  protected get mcpRuntime(): AgentMcpRuntimePort {
    return this.ctx.mcpRuntime
  }

  protected get promptRuntime(): AgentPromptRuntimePort {
    return this.ctx.promptRuntime
  }

  protected get permissionRuntime(): AgentPermissionRuntimePort {
    return this.ctx.permissionRuntime
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
