import type {
  MESSAGE_ROLE,
  MESSAGE_STATUS,
  ISQLitePresenter,
  SQLITE_MESSAGE
} from '@shared/presenter'

export class MessagePersister {
  constructor(private readonly sqlitePresenter: ISQLitePresenter) {}

  async getMessage(messageId: string): Promise<SQLITE_MESSAGE | null> {
    return await this.sqlitePresenter.getMessage(messageId)
  }

  async queryMessages(conversationId: string): Promise<SQLITE_MESSAGE[]> {
    return await this.sqlitePresenter.queryMessages(conversationId)
  }

  async insertMessage(
    conversationId: string,
    content: string,
    role: MESSAGE_ROLE,
    parentId: string,
    metadata: string,
    orderSeq: number,
    tokenCount: number,
    status: MESSAGE_STATUS,
    isVariant: number
  ): Promise<string> {
    return await this.sqlitePresenter.insertMessage(
      conversationId,
      content,
      role,
      parentId,
      metadata,
      orderSeq,
      tokenCount,
      status,
      0,
      isVariant
    )
  }

  async updateMessage(messageId: string, data: Partial<Omit<SQLITE_MESSAGE, 'id'>>): Promise<void> {
    await this.sqlitePresenter.updateMessage(messageId, data)
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.sqlitePresenter.deleteMessage(messageId)
  }

  async deleteAllMessagesInConversation(conversationId: string): Promise<void> {
    await this.sqlitePresenter.deleteAllMessagesInConversation(conversationId)
  }

  async getMessageVariants(messageId: string): Promise<SQLITE_MESSAGE[]> {
    return await this.sqlitePresenter.getMessageVariants(messageId)
  }

  async getMainMessageByParentId(
    conversationId: string,
    parentId: string
  ): Promise<SQLITE_MESSAGE | null> {
    return await this.sqlitePresenter.getMainMessageByParentId(conversationId, parentId)
  }

  async getAttachments(messageId: string, type?: string): Promise<Map<string, string>> {
    const attachmentsData = await this.sqlitePresenter.getMessageAttachments(messageId, type || '')
    const result = new Map<string, string>()
    attachmentsData.forEach((item) => {
      result.set(type || '', item.content)
    })
    return result
  }

  async addAttachment(messageId: string, key: string, value: string): Promise<void> {
    await this.sqlitePresenter.addMessageAttachment(messageId, key, value)
  }

  async getMaxOrderSeq(conversationId: string): Promise<number> {
    return await this.sqlitePresenter.getMaxOrderSeq(conversationId)
  }

  async updateParentId(messageId: string, parentId: string): Promise<void> {
    await this.sqlitePresenter.updateMessageParentId(messageId, parentId)
  }

  async updateIsContextEdge(messageId: string, isContextEdge: number): Promise<void> {
    await this.sqlitePresenter.updateMessage(messageId, { isContextEdge })
  }

  async getLastUserMessage(conversationId: string): Promise<SQLITE_MESSAGE | null> {
    return await this.sqlitePresenter.getLastUserMessage(conversationId)
  }
}
