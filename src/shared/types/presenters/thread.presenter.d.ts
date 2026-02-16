import { AssistantMessageBlock, Message } from '../../chat'

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
  acpWorkdirMap?: Record<string, string | null>
  chatMode?: 'agent' | 'acp agent'
  agentWorkspacePath?: string | null
  selectedVariantsMap?: Record<string, string>
  activeSkills?: string[]
  agentId?: string
}

export type ParentSelection = {
  selectedText: string
  startOffset: number
  endOffset: number
  contextBefore: string
  contextAfter: string
  contentHash: string
  version?: number
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
  parentConversationId?: string | null
  parentMessageId?: string | null
  parentSelection?: ParentSelection | null
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

export interface SearchResult {
  title: string
  url: string
  snippet?: string
  favicon?: string
  content?: string
  description?: string
  icon?: string
  rank?: number
  searchId?: string
}

export interface IThreadPresenter {
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
    settings?: Partial<CONVERSATION_SETTINGS>,
    selectedVariantsMap?: Record<string, string>
  ): Promise<string>

  createChildConversationFromSelection(payload: {
    parentConversationId: string
    parentMessageId: string
    parentSelection: ParentSelection | string
    title: string
    settings?: Partial<CONVERSATION_SETTINGS>
    tabId?: number
    openInNewTab?: boolean
  }): Promise<string>

  // Conversation list and activation status
  getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }>
  listChildConversationsByParent(parentConversationId: string): Promise<CONVERSATION[]>
  listChildConversationsByMessageIds(parentMessageIds: string[]): Promise<CONVERSATION[]>
  loadMoreThreads(): Promise<{ hasMore: boolean; total: number }>
  setActiveConversation(conversationId: string, tabId: number): Promise<void>
  openConversationInNewTab(payload: {
    conversationId: string
    tabId?: number
    messageId?: string
    childConversationId?: string
  }): Promise<number | null>
  getActiveConversation(tabId: number): Promise<CONVERSATION | null>
  getActiveConversationId(tabId: number): Promise<string | null>
  getActiveConversationIdSync(tabId: number): string | null
  clearActiveThread(tabId: number): Promise<void>
  findTabForConversation(conversationId: string): Promise<number | null>

  getSearchResults(messageId: string, searchId?: string): Promise<SearchResult[]>
  clearAllMessages(conversationId: string): Promise<void>

  // Message operations
  getMessages(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: Message[] }>
  getMessageIds(conversationId: string): Promise<string[]>
  getMessagesByIds(messageIds: string[]): Promise<Message[]>
  getMessageThread(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; messages: Message[] }>
  editMessage(messageId: string, content: string): Promise<Message>
  deleteMessage(messageId: string): Promise<void>
  getMessage(messageId: string): Promise<Message>
  getMessageVariants(messageId: string): Promise<Message[]>
  updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void>
  updateMessageMetadata(messageId: string, metadata: Partial<MESSAGE_METADATA>): Promise<void>
  getMessageExtraInfo(messageId: string, type: string): Promise<Record<string, unknown>[]>
  getMainMessageByParentId(conversationId: string, parentId: string): Promise<Message | null>
  getLastUserMessage(conversationId: string): Promise<Message | null>

  // Context control
  getContextMessages(conversationId: string): Promise<Message[]>
  clearContext(conversationId: string): Promise<void>
  markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void>
  destroy(): void
  toggleConversationPinned(conversationId: string, isPinned: boolean): Promise<void>
}

export interface IMessageManager {
  // Basic message operations
  sendMessage(
    conversationId: string,
    content: string,
    role: MESSAGE_ROLE,
    parentId: string,
    isVariant: boolean,
    metadata: MESSAGE_METADATA,
    searchResults?: string
  ): Promise<Message>
  editMessage(messageId: string, content: string): Promise<Message>
  deleteMessage(messageId: string): Promise<void>
  retryMessage(messageId: string, metadata: MESSAGE_METADATA): Promise<Message>

  // Message queries
  getMessage(messageId: string): Promise<Message>
  getMessagesByIds(messageIds: string[]): Promise<Message[]>
  getMessageVariants(messageId: string): Promise<Message[]>
  getMessageThread(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{
    total: number
    list: Message[]
  }>
  getMessageIds(conversationId: string): Promise<string[]>
  getContextMessages(
    conversationId: string,
    contextLength: number,
    options?: { ensureUserStart?: boolean; normalizeUserText?: boolean }
  ): Promise<Message[]>

  // Message status management
  updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void>
  updateMessageMetadata(messageId: string, metadata: Partial<MESSAGE_METADATA>): Promise<void>

  // Context management
  markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void>
}
