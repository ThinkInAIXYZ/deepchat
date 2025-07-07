import { IChatProvider } from '@shared/agent'
import { ILlmProviderPresenter, CONVERSATION_SETTINGS, CONVERSATION } from '@shared/presenter'

/**
 * ChatProvider - 从 ThreadPresenter 抽象出的聊天功能
 * 处理基于 LLM 的默认聊天逻辑
 */
export class ChatProvider implements IChatProvider {
  private llmProviderPresenter?: ILlmProviderPresenter

  constructor(llmProviderPresenter?: ILlmProviderPresenter) {
    this.llmProviderPresenter = llmProviderPresenter
  }

  /**
   * 设置 LLM Provider Presenter（延迟注入）
   */
  setLlmProviderPresenter(presenter: ILlmProviderPresenter): void {
    this.llmProviderPresenter = presenter
  }

  /**
   * 创建会话
   * 这里暂时只返回基本的会话配置，具体实现将在后续重构中完成
   */
  async createConversation(title: string, _settings?: Partial<CONVERSATION_SETTINGS>, tabId?: number): Promise<string> {
    console.log(`ChatProvider: Creating conversation "${title}" for tab ${tabId}`)

    // 这里暂时返回一个模拟的会话ID
    // 在实际重构中，这将调用具体的数据库操作
    const conversationId = `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // TODO: 实际的数据库操作将在重构时添加
    // await this.sqlitePresenter.createConversation(title, settings)

    return conversationId
  }

  /**
   * 获取会话信息
   */
  async getConversation(conversationId: string): Promise<CONVERSATION> {
    console.log(`ChatProvider: Getting conversation ${conversationId}`)

    // TODO: 实际的数据库查询将在重构时添加
    // return await this.sqlitePresenter.getConversation(conversationId)

    // 暂时返回模拟数据
    return {
      id: conversationId,
      title: 'Chat Conversation',
      settings: {
        systemPrompt: '',
        temperature: 0.7,
        contextLength: 32000,
        maxTokens: 8000,
        providerId: '',
        modelId: '',
        artifacts: 0
      },
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  }

  /**
   * 删除会话
   */
  async deleteConversation(conversationId: string): Promise<void> {
    console.log(`ChatProvider: Deleting conversation ${conversationId}`)

    // TODO: 实际的数据库操作将在重构时添加
    // await this.sqlitePresenter.deleteConversation(conversationId)
  }

      /**
   * 发送消息
   */
  async sendMessage(conversationId: string, content: string, role: string): Promise<any> {
    console.log(`ChatProvider: Sending message to conversation ${conversationId}`)

    // TODO: 实际的消息发送逻辑将在重构时添加
    // 这里暂时返回模拟的消息对象
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    return {
      id: messageId,
      conversationId: conversationId,
      role: role,
      content: content,
      timestamp: Date.now(),
      status: 'sent'
    }
  }

  /**
   * 获取消息列表
   */
  async getMessages(conversationId: string, page: number, _pageSize: number): Promise<any> {
    console.log(`ChatProvider: Getting messages for conversation ${conversationId}, page ${page}`)

    // TODO: 实际的数据库查询将在重构时添加
    // return await this.messageManager.getMessageThread(conversationId, page, pageSize)

    // 暂时返回空列表
    return {
      total: 0,
      list: []
    }
  }

  /**
   * 开始流式完成
   */
  async startStreamCompletion(conversationId: string, _queryMsgId?: string): Promise<void> {
    console.log(`ChatProvider: Starting stream completion for conversation ${conversationId}`)

    if (!this.llmProviderPresenter) {
      console.error('ChatProvider: LLM Provider Presenter not set')
      return
    }

    // TODO: 实际的流式处理逻辑将在重构时添加
    // 这里将调用 llmProviderPresenter 的流式接口
  }

  /**
   * 停止消息生成
   */
  async stopMessageGeneration(messageId: string): Promise<void> {
    console.log(`ChatProvider: Stopping message generation for ${messageId}`)

    if (!this.llmProviderPresenter) {
      console.error('ChatProvider: LLM Provider Presenter not set')
      return
    }

    // TODO: 实际的停止逻辑将在重构时添加
    // await this.llmProviderPresenter.stopStream(messageId)
  }

  /**
   * 检查 Provider 状态
   */
  async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    if (!this.llmProviderPresenter) {
      return { isOk: false, errorMsg: 'LLM Provider Presenter not set' }
    }

    // 检查是否有可用的 LLM 提供者
    const providers = this.llmProviderPresenter.getProviders()
    const enabledProviders = providers.filter(p => p.enable)

    if (enabledProviders.length === 0) {
      return { isOk: false, errorMsg: 'No enabled LLM providers found' }
    }

    return { isOk: true, errorMsg: null }
  }
}
