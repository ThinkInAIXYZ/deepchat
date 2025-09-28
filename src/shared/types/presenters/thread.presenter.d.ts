import {
  ChatMessage,
  AssistantMessageBlock,
  Message,
  AssistantMessage,
  UserMessage
} from '../core/chat'
import { MODEL_META } from './llmprovider.presenter'

/**
 * Thread/Conversation Presenter Interface
 * Handles conversation management, message operations, and search functionality
 */

export type CONVERSATION_SETTINGS = {
  systemPrompt: string
  temperature: number
  contextLength: number
  maxTokens: number
  providerId: string
  modelId: string
  artifacts: 0 | 1
  enabledMcpTools?: string[]
  thinkingBudget?: number
  enableSearch?: boolean
  forcedSearch?: boolean
  searchStrategy?: 'turbo' | 'max'
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  verbosity?: 'low' | 'medium' | 'high'
}

export type CONVERSATION = {
  id: string
  title: string
  settings: CONVERSATION_SETTINGS
  createdAt: number
  updatedAt: number
  is_new?: number
  artifacts?: number
  is_pinned?: number
}

export type MESSAGE_STATUS = 'sent' | 'pending' | 'error'
export type MESSAGE_ROLE = 'user' | 'assistant' | 'system' | 'function' | 'agent'

export type MESSAGE_METADATA = {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  generationTime: number
  firstTokenTime: number
  tokensPerSecond: number
  contextUsage: number
  model?: string
  provider?: string
  reasoningStartTime?: number
  reasoningEndTime?: number
}

export interface MESSAGE {
  id: string
  conversation_id: string
  content: string | AssistantMessageBlock[]
  role: MESSAGE_ROLE
  parent_id?: string
  status: MESSAGE_STATUS
  created_at: number
  updated_at: number
  metadata?: MESSAGE_METADATA
  is_variant?: boolean
  is_context_edge?: boolean
}

export interface SearchEngineTemplate {
  id: string
  name: string
  url: string
  icon: string
  enabled: boolean
  isDefault?: boolean
}

export interface SearchResult {
  title: string
  url: string
  snippet?: string
  favicon?: string
  content?: string
  description?: string
  icon?: string
  rank?: number
}

export interface IThreadPresenter {
  searchAssistantModel: MODEL_META | null
  searchAssistantProviderId: string | null

  // Basic conversation operations
  createConversation(
    title: string,
    settings: Partial<CONVERSATION_SETTINGS>,
    tabId: number,
    options?: { forceNewAndActivate?: boolean }
  ): Promise<string>
  deleteConversation(conversationId: string): Promise<void>
  getConversation(conversationId: string): Promise<CONVERSATION>
  renameConversation(conversationId: string, title: string): Promise<CONVERSATION>
  updateConversationTitle(conversationId: string, title: string): Promise<void>
  updateConversationSettings(
    conversationId: string,
    settings: Partial<CONVERSATION_SETTINGS>
  ): Promise<void>

  // Conversation branching operations
  forkConversation(
    targetConversationId: string,
    targetMessageId: string,
    newTitle: string,
    settings?: Partial<CONVERSATION_SETTINGS>
  ): Promise<string>

  // Conversation list and activation status
  getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }>
  loadMoreThreads(): Promise<{ hasMore: boolean; total: number }>
  setActiveConversation(conversationId: string, tabId: number): Promise<void>
  getActiveConversation(tabId: number): Promise<CONVERSATION | null>
  getActiveConversationId(tabId: number): Promise<string | null>
  clearActiveThread(tabId: number): Promise<void>

  getSearchResults(messageId: string): Promise<SearchResult[]>
  clearAllMessages(conversationId: string): Promise<void>

  // Message operations
  getMessages(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: MESSAGE[] }>
  sendMessage(conversationId: string, content: string, role: MESSAGE_ROLE): Promise<MESSAGE | null>
  startStreamCompletion(conversationId: string, queryMsgId?: string): Promise<void>
  editMessage(messageId: string, content: string): Promise<MESSAGE>
  deleteMessage(messageId: string): Promise<void>
  retryMessage(messageId: string, modelId?: string): Promise<MESSAGE>
  getMessage(messageId: string): Promise<MESSAGE>
  getMessageVariants(messageId: string): Promise<MESSAGE[]>
  updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void>
  updateMessageMetadata(messageId: string, metadata: Partial<MESSAGE_METADATA>): Promise<void>
  getMessageExtraInfo(messageId: string, type: string): Promise<Record<string, unknown>[]>

  // Popup operations
  translateText(text: string, tabId: number): Promise<string>
  askAI(text: string, tabId: number): Promise<string>

  // Context control
  getContextMessages(conversationId: string): Promise<MESSAGE[]>
  clearContext(conversationId: string): Promise<void>
  markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void>
  summaryTitles(tabId?: number): Promise<string>
  stopMessageGeneration(messageId: string): Promise<void>
  getSearchEngines(): Promise<SearchEngineTemplate[]>
  getActiveSearchEngine(): Promise<SearchEngineTemplate>
  setActiveSearchEngine(engineId: string): Promise<void>
  setSearchEngine(engineId: string): Promise<boolean>
  testSearchEngine(query?: string): Promise<boolean>
  setSearchAssistantModel(model: MODEL_META, providerId: string): void
  getMainMessageByParentId(conversationId: string, parentId: string): Promise<Message | null>
  destroy(): void
  continueStreamCompletion(conversationId: string, queryMsgId: string): Promise<AssistantMessage>
  toggleConversationPinned(conversationId: string, isPinned: boolean): Promise<void>
  findTabForConversation(conversationId: string): Promise<number | null>

  // Permission handling
  handlePermissionResponse(
    messageId: string,
    toolCallId: string,
    granted: boolean,
    permissionType: 'read' | 'write' | 'all',
    remember?: boolean
  ): Promise<void>
  exportConversation(
    conversationId: string,
    format: 'markdown' | 'html' | 'txt'
  ): Promise<{ filename: string; content: string }>
}

export interface IMessageManager {
  // Basic message operations
  sendMessage(
    conversationId: string,
    content: string,
    role: MESSAGE_ROLE,
    parentId: string,
    isVariant: boolean,
    metadata: MESSAGE_METADATA
  ): Promise<MESSAGE>
  editMessage(messageId: string, content: string): Promise<MESSAGE>
  deleteMessage(messageId: string): Promise<void>
  retryMessage(messageId: string, metadata: MESSAGE_METADATA): Promise<MESSAGE>

  // Message queries
  getMessage(messageId: string): Promise<MESSAGE>
  getMessageVariants(messageId: string): Promise<MESSAGE[]>
  getMessageThread(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{
    total: number
    list: MESSAGE[]
  }>
  getContextMessages(conversationId: string, contextLength: number): Promise<MESSAGE[]>

  // Message status management
  updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void>
  updateMessageMetadata(messageId: string, metadata: Partial<MESSAGE_METADATA>): Promise<void>

  // Context management
  markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void>
}
