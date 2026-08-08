import type { CONVERSATION, CONVERSATION_SETTINGS, SQLITE_MESSAGE } from '@shared/types/session'
import type { DatabaseConnectionProvider } from '@/data/databaseConnection'
import { ConversationsTable } from './tables/conversations'
import { MessagesTable } from './tables/messages'
import { MessageAttachmentsTable } from './tables/messageAttachments'
import { NewSessionsTable } from './tables/newSessions'
import { DeepChatSessionsTable } from './tables/deepchatSessions'
import { DeepChatMessagesTable } from './tables/deepchatMessages'
import { DeepChatUserMessagesTable } from './tables/deepchatUserMessages'
import { DeepChatUserMessageFilesTable } from './tables/deepchatUserMessageFiles'
import { DeepChatUserMessageLinksTable } from './tables/deepchatUserMessageLinks'
import { DeepChatAssistantBlocksTable } from './tables/deepchatAssistantBlocks'
import { DeepChatMessageTracesTable } from './tables/deepchatMessageTraces'
import { DeepChatMessageSearchResultsTable } from './tables/deepchatMessageSearchResults'
import { DeepChatSearchDocumentsTable } from './tables/deepchatSearchDocuments'
import { DeepChatPendingInputsTable } from './tables/deepchatPendingInputs'
import { DeepChatUsageStatsTable } from './tables/deepchatUsageStats'
import {
  DeepChatExecutionJournalStore,
  DeepChatTapeEntriesTable
} from '@/tape/infrastructure/sqlite/tapeEntryStore'
import type { ExecutionJournalPersistenceStore, TapeMutationProjection } from '@/tape/ports/storage'
import { SqliteTapeLifecycleAdapter } from '@/tape/infrastructure/sqlite/tapeLifecycleAdapter'
import { DeepChatTapeSearchProjectionTable } from '@/tape/infrastructure/sqlite/tapeSearchProjectionStore'
import { DeepChatSessionMetadataTable } from './tables/deepchatSessionMetadata'
import { NewSessionActiveSkillsTable } from './tables/newSessionActiveSkills'
import { NewSessionDisabledAgentToolsTable } from './tables/newSessionDisabledAgentTools'

export class SessionDatabase {
  constructor(
    private readonly connection: DatabaseConnectionProvider,
    private readonly getTapeMutationProjection?: () => TapeMutationProjection
  ) {}

  getDatabase() {
    return this.connection.getDatabase()
  }

  get conversationsTable() {
    return new ConversationsTable(this.getDatabase())
  }

  get messagesTable() {
    return new MessagesTable(this.getDatabase())
  }

  get messageAttachmentsTable() {
    return new MessageAttachmentsTable(this.getDatabase())
  }

  get newSessionsTable() {
    return new NewSessionsTable(this.getDatabase())
  }

  get deepchatSessionsTable() {
    return new DeepChatSessionsTable(this.getDatabase())
  }

  get deepchatMessagesTable() {
    return new DeepChatMessagesTable(this.getDatabase())
  }

  get deepchatUserMessagesTable() {
    return new DeepChatUserMessagesTable(this.getDatabase())
  }

  get deepchatUserMessageFilesTable() {
    return new DeepChatUserMessageFilesTable(this.getDatabase())
  }

  get deepchatUserMessageLinksTable() {
    return new DeepChatUserMessageLinksTable(this.getDatabase())
  }

  get deepchatAssistantBlocksTable() {
    return new DeepChatAssistantBlocksTable(this.getDatabase())
  }

  get deepchatMessageTracesTable() {
    return new DeepChatMessageTracesTable(this.getDatabase())
  }

  get deepchatMessageSearchResultsTable() {
    return new DeepChatMessageSearchResultsTable(this.getDatabase())
  }

  get deepchatSearchDocumentsTable() {
    return new DeepChatSearchDocumentsTable(this.getDatabase())
  }

  get deepchatPendingInputsTable() {
    return new DeepChatPendingInputsTable(this.getDatabase())
  }

  get deepchatUsageStatsTable() {
    return new DeepChatUsageStatsTable(this.getDatabase())
  }

  get deepchatTapeEntriesTable() {
    return new DeepChatTapeEntriesTable(this.getDatabase(), this.getTapeMutationProjection?.())
  }

  get deepchatExecutionJournalStore(): ExecutionJournalPersistenceStore {
    return new DeepChatExecutionJournalStore(this.getDatabase(), this.getTapeMutationProjection?.())
  }

  get tapeLifecycle() {
    return new SqliteTapeLifecycleAdapter(this.getDatabase(), this.getTapeMutationProjection?.())
  }

  get deepchatTapeSearchProjectionTable() {
    return new DeepChatTapeSearchProjectionTable(this.getDatabase())
  }

  get deepchatSessionMetadataTable() {
    return new DeepChatSessionMetadataTable(this.getDatabase())
  }

  get newSessionActiveSkillsTable() {
    return new NewSessionActiveSkillsTable(this.getDatabase())
  }

  get newSessionDisabledAgentToolsTable() {
    return new NewSessionDisabledAgentToolsTable(this.getDatabase())
  }

  async createConversation(
    title: string,
    settings: Partial<CONVERSATION_SETTINGS> = {}
  ): Promise<string> {
    return this.conversationsTable.create(title, settings)
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.conversationsTable.delete(conversationId)
  }

  async renameConversation(conversationId: string, title: string): Promise<CONVERSATION> {
    this.conversationsTable.rename(conversationId, title)
    return this.getConversation(conversationId)
  }

  async getConversation(conversationId: string): Promise<CONVERSATION> {
    return this.conversationsTable.get(conversationId)
  }

  async updateConversation(conversationId: string, data: Partial<CONVERSATION>): Promise<void> {
    return this.conversationsTable.update(conversationId, data)
  }

  async getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }> {
    return this.conversationsTable.list(page, pageSize)
  }

  async listChildConversationsByParent(parentConversationId: string): Promise<CONVERSATION[]> {
    return this.conversationsTable.listByParentConversationId(parentConversationId)
  }

  async listChildConversationsByMessageIds(parentMessageIds: string[]): Promise<CONVERSATION[]> {
    return this.conversationsTable.listByParentMessageIds(parentMessageIds)
  }

  async getConversationCount(): Promise<number> {
    return this.conversationsTable.count()
  }

  async queryMessages(conversationId: string): Promise<SQLITE_MESSAGE[]> {
    return this.messagesTable.query(conversationId)
  }
}
