import {
  IMessageManager,
  MESSAGE_METADATA,
  MESSAGE_ROLE,
  MESSAGE_STATUS,
  ISQLitePresenter,
  SQLITE_MESSAGE
} from '@shared/presenter'
import {
  Message,
  AssistantMessageBlock,
  UserMessageContent,
  UserMessageTextBlock,
  UserMessageMentionBlock,
  UserMessageCodeBlock
} from '@shared/chat'
import { eventBus, SendTarget } from '@/eventbus'
import { CONVERSATION_EVENTS } from '@/events'

export class MessageManager implements IMessageManager {
  private sqlitePresenter: ISQLitePresenter

  constructor(sqlitePresenter: ISQLitePresenter) {
    this.sqlitePresenter = sqlitePresenter
  }

  private formatUserMessageContentForDisplay(
    msgContentBlock: (UserMessageTextBlock | UserMessageMentionBlock | UserMessageCodeBlock)[]
  ): string {
    if (!Array.isArray(msgContentBlock)) return ''
    return msgContentBlock.map((block) => block.content || '').join('')
  }

  private convertToMessage(sqliteMessage: SQLITE_MESSAGE): Message {
    let metadata: MESSAGE_METADATA | null = null
    try {
      metadata = JSON.parse(sqliteMessage.metadata)
    } catch (e) {
      console.error('Failed to parse metadata', e)
    }
    const messageContent = JSON.parse(sqliteMessage.content)

    if (sqliteMessage.role === 'user') {
      const userContent = messageContent as UserMessageContent
      if (userContent.content && Array.isArray(userContent.content)) {
        userContent.text = this.formatUserMessageContentForDisplay(userContent.content)
      }
    }
    return {
      id: sqliteMessage.id,
      conversationId: sqliteMessage.conversation_id,
      parentId: sqliteMessage.parent_id,
      role: sqliteMessage.role as MESSAGE_ROLE,
      content: messageContent,
      timestamp: sqliteMessage.created_at,
      status: sqliteMessage.status as MESSAGE_STATUS,
      usage: {
        context_usage: metadata?.contextUsage ?? 0,
        tokens_per_second: metadata?.tokensPerSecond ?? 0,
        total_tokens: metadata?.totalTokens ?? 0,
        generation_time: metadata?.generationTime ?? 0,
        first_token_time: metadata?.firstTokenTime ?? 0,
        input_tokens: metadata?.inputTokens ?? 0,
        output_tokens: metadata?.outputTokens ?? 0,
        reasoning_start_time: metadata?.reasoningStartTime ?? 0,
        reasoning_end_time: metadata?.reasoningEndTime ?? 0
      },
      avatar: '',
      name: '',
      model_name: metadata?.model ?? '',
      model_id: metadata?.model ?? '',
      model_provider: metadata?.provider ?? '',
      error: '',
      is_variant: sqliteMessage.is_variant,
      variants: sqliteMessage.variants?.map((variant) => this.convertToMessage(variant)) || []
    }
  }

  async sendMessage(
    conversationId: string,
    content: string,
    role: MESSAGE_ROLE,
    parentId: string,
    isVariant: boolean,
    metadata: MESSAGE_METADATA,
    searchResults?: string
  ): Promise<Message> {
    const maxOrderSeq = await this.sqlitePresenter.getMaxOrderSeq(conversationId)
    const msgId = await this.sqlitePresenter.insertMessage(
      conversationId,
      content,
      role,
      parentId,
      JSON.stringify(metadata),
      maxOrderSeq + 1,
      0,
      'pending',
      0,
      isVariant ? 1 : 0
    )

    if (searchResults) {
      await this.sqlitePresenter.addMessageAttachment(msgId, 'search_results', searchResults)
    }
    const message = await this.getMessage(msgId)
    if (!message) {
      throw new Error('Failed to create message')
    }
    return message
  }

  async editMessage(messageId: string, content: string): Promise<Message> {
    await this.sqlitePresenter.updateMessage(messageId, { content })
    const message = await this.sqlitePresenter.getMessage(messageId)
    if (!message) {
      throw new Error(`Message ${messageId} not found`)
    }
    const msg = this.convertToMessage(message)
    eventBus.sendToRenderer(CONVERSATION_EVENTS.MESSAGE_EDITED, SendTarget.ALL_WINDOWS, messageId)
    if (msg.parentId) {
      eventBus.sendToRenderer(
        CONVERSATION_EVENTS.MESSAGE_EDITED,
        SendTarget.ALL_WINDOWS,
        msg.parentId
      )
    }
    return msg
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.sqlitePresenter.deleteMessage(messageId)
  }

  async retryMessage(messageId: string, metadata: MESSAGE_METADATA): Promise<Message> {
    const originalMessage = await this.getMessage(messageId)
    if (!originalMessage) {
      throw new Error(`Message ${messageId} not found`)
    }

    // 创建一个新的变体消息
    const variantMessage = await this.sendMessage(
      originalMessage.conversationId,
      JSON.stringify([]),
      originalMessage.role as MESSAGE_ROLE,
      originalMessage.parentId || '',
      true,
      metadata
    )

    return variantMessage
  }

  async getMessage(messageId: string): Promise<Message> {
    const message = await this.sqlitePresenter.getMessage(messageId)
    if (!message) {
      throw new Error(`Message ${messageId} not found`)
    }
    return this.convertToMessage(message)
  }

  async getMessageVariants(messageId: string): Promise<Message[]> {
    const variants = await this.sqlitePresenter.getMessageVariants(messageId)
    return variants.map((variant) => this.convertToMessage(variant))
  }

  async getMainMessageByParentId(
    conversationId: string,
    parentId: string
  ): Promise<Message | null> {
    const message = await this.sqlitePresenter.getMainMessageByParentId(conversationId, parentId)
    if (!message) {
      return null
    }
    return this.convertToMessage(message)
  }

  async getMessageThread(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: Message[] }> {
    const sqliteMessages = await this.sqlitePresenter.queryMessages(conversationId)
    const start = (page - 1) * pageSize
    const end = start + pageSize

    // 处理消息的排序和变体关系
    const messages = sqliteMessages
      .sort((a, b) => {
        // 首先按创建时间排序
        const timeCompare = a.created_at - b.created_at
        if (timeCompare !== 0) return timeCompare
        // 如果创建时间相同，按序号排序
        return a.order_seq - b.order_seq
      })
      .map((msg) => this.convertToMessage(msg))

    return {
      total: messages.length,
      list: messages.slice(start, end)
    }
  }

  async updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void> {
    await this.sqlitePresenter.updateMessage(messageId, { status })
  }

  async updateMessageMetadata(
    messageId: string,
    metadata: Partial<MESSAGE_METADATA>
  ): Promise<void> {
    const message = await this.sqlitePresenter.getMessage(messageId)
    if (!message) {
      return
    }
    const updatedMetadata = {
      ...JSON.parse(message.metadata),
      ...metadata
    }
    await this.sqlitePresenter.updateMessage(messageId, {
      metadata: JSON.stringify(updatedMetadata)
    })
  }

  async markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void> {
    await this.sqlitePresenter.updateMessage(messageId, {
      isContextEdge: isEdge ? 1 : 0
    })
  }

  async getContextMessages(conversationId: string, messageCount: number): Promise<Message[]> {
    const sqliteMessages = await this.sqlitePresenter.queryMessages(conversationId)

    // 按创建时间和序号倒序排序
    const messages = sqliteMessages
      .sort((a, b) => {
        // 首先按创建时间倒序排序
        const timeCompare = b.created_at - a.created_at
        if (timeCompare !== 0) return timeCompare
        // 如果创建时间相同，按序号倒序排序
        return b.order_seq - a.order_seq
      })
      .slice(0, messageCount) // 只取需要的消息数量
      .sort((a, b) => {
        // 再次按正序排序以保持对话顺序
        const timeCompare = a.created_at - b.created_at
        if (timeCompare !== 0) return timeCompare
        return a.order_seq - b.order_seq
      })
      .map((msg) => this.convertToMessage(msg))

    return messages
  }

  async getLastUserMessage(conversationId: string): Promise<Message | null> {
    const sqliteMessage = await this.sqlitePresenter.getLastUserMessage(conversationId)
    if (!sqliteMessage) {
      return null
    }
    return this.convertToMessage(sqliteMessage)
  }

  async clearAllMessages(conversationId: string): Promise<void> {
    await this.sqlitePresenter.deleteAllMessagesInConversation(conversationId)
  }
  /**
   * 初始化未完成的消息
   */
  public async initializeUnfinishedMessages(): Promise<void> {
    try {
      // 获取所有对话
      const { list: conversations } = await this.sqlitePresenter.getConversationList(1, 1000)

      for (const conversation of conversations) {
        // 获取每个对话的消息
        const { list: messages } = await this.getMessageThread(conversation.id, 1, 1000)

        // 找出所有pending状态的assistant消息
        const pendingMessages = messages.filter(
          (msg) => msg.role === 'assistant' && msg.status === 'pending'
        )

        // 处理每个未完成的消息
        for (const message of pendingMessages) {
          await this.handleMessageError(message.id, 'common.error.sessionInterrupted')
        }
      }
    } catch (error) {
      console.error('初始化未完成消息失败:', error)
    }
  }
  /**
   * 处理消息错误状态的公共函数
   * @param messageId 消息ID
   * @param errorMessage 错误信息
   */
  public async handleMessageError(
    messageId: string,
    errorMessage: string = 'common.error.requestFailed'
  ): Promise<void> {
    const message = await this.getMessage(messageId)
    if (!message) {
      return
    }

    let content: AssistantMessageBlock[] = []
    try {
      content = message.content as AssistantMessageBlock[]
    } catch {
      content = []
    }

    // 将所有loading状态的block改为error
    content.forEach((block: AssistantMessageBlock) => {
      if (block.status === 'loading') {
        block.status = 'error'
      }
    })

    // 添加错误信息block
    content.push({
      type: 'error',
      content: errorMessage,
      status: 'error',
      timestamp: Date.now()
    })

    // 更新消息状态和内容
    await this.updateMessageStatus(messageId, 'error')
    await this.editMessage(messageId, JSON.stringify(content))
  }
}
