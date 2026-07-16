import type { ReasoningEffort, Verbosity } from '../model-db'
import type { FileItem } from '../file'
import type { MCPToolResponse } from '../mcp'

export type SQLITE_MESSAGE = {
  id: string
  conversation_id: string
  parent_id?: string
  role: MESSAGE_ROLE
  content: string
  created_at: number
  order_seq: number
  token_count: number
  status: MESSAGE_STATUS
  metadata: string // JSON string of MESSAGE_METADATA
  is_context_edge: number // 0 or 1
  is_variant: number
  variants?: SQLITE_MESSAGE[]
}

export interface Prompt {
  id: string
  name: string
  description: string
  content?: string
  parameters?: Array<{
    name: string
    description: string
    required: boolean
  }>
  files?: FileItem[] // Associated files
  messages?: Array<{ role: string; content: { text: string } }> // Added based on getPrompt example
  enabled?: boolean // Whether enabled
  source?: 'local' | 'imported' | 'builtin' // Source type
  createdAt?: number // Creation time
  updatedAt?: number // Update time
}

export interface SystemPrompt {
  id: string
  name: string
  content: string
  isDefault?: boolean
  createdAt?: number
  updatedAt?: number
}
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
  reasoningEffort?: ReasoningEffort
  verbosity?: Verbosity
  selectedVariantsMap?: Record<string, string>
  acpWorkdirMap?: Record<string, string | null>
  chatMode?: 'agent' | 'acp agent'
  agentWorkspacePath?: string | null
  activeSkills?: string[] // Activated skills for this conversation
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

export interface IThreadPresenter {
  // Basic conversation operations
  createConversation(
    title: string,
    settings: Partial<CONVERSATION_SETTINGS>,
    tabId: number,
    options?: { forceNewAndActivate?: boolean } // Added options parameter, supports forced creation of new sessions, avoiding singleton detection for empty sessions
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
  clearActiveThread(tabId: number): Promise<void>
  findTabForConversation(conversationId: string): Promise<number | null>

  clearAllMessages(conversationId: string): Promise<void>

  // Message operations
  getMessages(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: MESSAGE[] }>
  getMessageThread(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; messages: MESSAGE[] }>
  editMessage(messageId: string, content: string): Promise<MESSAGE>
  deleteMessage(messageId: string): Promise<void>
  getMessage(messageId: string): Promise<MESSAGE>
  getMessageVariants(messageId: string): Promise<MESSAGE[]>
  updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void>
  updateMessageMetadata(messageId: string, metadata: Partial<MESSAGE_METADATA>): Promise<void>
  getMessageExtraInfo(messageId: string, type: string): Promise<Record<string, unknown>[]>
  getMainMessageByParentId(conversationId: string, parentId: string): Promise<MESSAGE | null>
  getLastUserMessage(conversationId: string): Promise<MESSAGE | null>

  // Context control
  getContextMessages(conversationId: string): Promise<MESSAGE[]>
  clearContext(conversationId: string): Promise<void>
  markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void>
  destroy(): void
  toggleConversationPinned(conversationId: string, isPinned: boolean): Promise<void>
}

export type MESSAGE_STATUS = 'sent' | 'pending' | 'error'
export type MESSAGE_ROLE = 'user' | 'assistant' | 'system' | 'function'

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

export type LLMResponse = {
  content: string
  reasoning_content?: string
  tool_call_name?: string
  tool_call_params?: string
  tool_call_response?: string
  tool_call_id?: string
  tool_call_server_name?: string
  tool_call_server_icons?: string
  tool_call_server_description?: string
  tool_call_response_raw?: MCPToolResponse
  maximum_tool_calls_reached?: boolean
  totalUsage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}
export type LLMResponseStream = {
  content?: string
  reasoning_content?: string
  image_data?: {
    data: string
    mimeType: string
  }
  tool_call?: 'start' | 'end' | 'error'
  tool_call_name?: string
  tool_call_params?: string
  tool_call_response?: string
  tool_call_id?: string
  tool_call_server_name?: string
  tool_call_server_icons?: string
  tool_call_server_description?: string
  tool_call_response_raw?: MCPToolResponse
  maximum_tool_calls_reached?: boolean
  totalUsage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}
// Update status types
export type UpdateStatus =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateProgress {
  bytesPerSecond: number
  percent: number
  transferred: number
  total: number
}

// Standardized events returned from LLM Provider's coreStream
export type LLMCoreStreamEvent = import('../../core/llm-events').LLMCoreStreamEvent

// Define ChatMessage interface for unified message format
export type ChatMessage = import('../../core/llm-events').ChatMessage

export type ChatMessageContent = import('../../core/llm-events').ChatMessageContent

export type LLMAgentEventData = import('../../core/agent-events').LLMAgentEventData
export type LLMAgentEvent = import('../../core/agent-events').LLMAgentEvent
