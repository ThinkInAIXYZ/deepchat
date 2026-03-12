import type { CONVERSATION, CONVERSATION_SETTINGS, ISQLitePresenter } from '@shared/presenter'

export class ConversationPersister {
  constructor(private readonly sqlitePresenter: ISQLitePresenter) {}

  async getConversation(conversationId: string): Promise<CONVERSATION> {
    return await this.sqlitePresenter.getConversation(conversationId)
  }

  async getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }> {
    return await this.sqlitePresenter.getConversationList(page, pageSize)
  }

  async getConversationCount(): Promise<number> {
    return await this.sqlitePresenter.getConversationCount()
  }

  async getPinnedConversations(): Promise<CONVERSATION[]> {
    const result = await this.sqlitePresenter.getConversationList(1, 1000)
    return result.list.filter((conv) => conv.is_pinned === 1)
  }

  async createConversation(title: string, settings: CONVERSATION_SETTINGS): Promise<string> {
    return await this.sqlitePresenter.createConversation(title, settings)
  }

  async renameConversation(conversationId: string, title: string): Promise<void> {
    await this.sqlitePresenter.renameConversation(conversationId, title)
  }

  async updateConversation(conversationId: string, data: Partial<CONVERSATION>): Promise<void> {
    await this.sqlitePresenter.updateConversation(conversationId, data)
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.sqlitePresenter.deleteConversation(conversationId)
  }

  async toggleConversationPinned(conversationId: string, pinned: boolean): Promise<void> {
    await this.sqlitePresenter.updateConversation(conversationId, { is_pinned: pinned ? 1 : 0 })
  }
}
