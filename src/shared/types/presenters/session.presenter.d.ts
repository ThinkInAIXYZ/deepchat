import type { Message } from '../../chat'
import type { NowledgeMemThread, NowledgeMemExportSummary } from '../nowledgeMem'
import type {
  IThreadPresenter,
  MESSAGE_STATUS,
  MESSAGE_METADATA,
  ParentSelection
} from './thread.presenter'

export type SessionStatus = 'idle' | 'generating' | 'paused' | 'waiting_permission' | 'error'

export type SessionConfig = {
  sessionId: string
  title: string
  providerId: string
  modelId: string
  chatMode: 'agent'
  systemPrompt: string
  maxTokens?: number
  temperature?: number
  contextLength?: number
  supportsVision?: boolean
  supportsFunctionCall?: boolean
  thinkingBudget?: number
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  verbosity?: 'low' | 'medium' | 'high'
  enableSearch?: boolean
  forcedSearch?: boolean
  searchStrategy?: 'turbo' | 'max'
  enabledMcpTools?: string[]
  agentWorkspacePath?: string | null
  selectedVariantsMap?: Record<string, string>
  isPinned?: boolean
}

export type SessionBindings = {
  tabId: number | null
  windowId: number | null
  windowType: 'main' | 'floating' | 'browser' | null
}

export type WorkspaceContext = {
  resolvedChatMode: 'chat' | 'agent'
  agentWorkspacePath: string | null
}

export type Session = {
  sessionId: string
  status: SessionStatus
  config: SessionConfig
  bindings: SessionBindings
  context: WorkspaceContext
  createdAt: number
  updatedAt: number
}

export type CreateSessionOptions = {
  forceNewAndActivate?: boolean
  tabId?: number
}

export type CreateSessionParams = {
  title: string
  settings?: Partial<SessionConfig>
  tabId?: number
  options?: CreateSessionOptions
}

export type CreateChildSessionParams = {
  parentSessionId: string
  parentMessageId: string
  parentSelection: ParentSelection | string
  title: string
  settings?: Partial<SessionConfig>
  tabId?: number
  openInNewTab?: boolean
}

export interface ISessionPresenter extends IThreadPresenter {
  createSession(params: CreateSessionParams): Promise<string>
  getSession(sessionId: string): Promise<Session>
  getSessionList(page: number, pageSize: number): Promise<{ total: number; sessions: Session[] }>
  renameSession(sessionId: string, title: string): Promise<void>
  deleteSession(sessionId: string): Promise<void>
  toggleSessionPinned(sessionId: string, pinned: boolean): Promise<void>
  updateSessionSettings(sessionId: string, settings: Partial<Session['config']>): Promise<void>

  bindToTab(sessionId: string, tabId: number): Promise<void>
  unbindFromTab(tabId: number): Promise<void>
  activateSession(tabId: number, sessionId: string): Promise<void>
  getActiveSession(tabId: number): Promise<Session | null>
  findTabForSession(
    sessionId: string,
    preferredWindowType?: 'main' | 'floating'
  ): Promise<number | null>

  editMessage(messageId: string, content: string): Promise<Message>
  deleteMessage(messageId: string): Promise<void>
  getMessage(messageId: string): Promise<Message>
  getMessageVariants(messageId: string): Promise<Message[]>
  getMessageThread(
    sessionId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; messages: Message[] }>
  updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void>
  updateMessageMetadata(messageId: string, metadata: Partial<MESSAGE_METADATA>): Promise<void>
  markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void>
  getContextMessages(sessionId: string): Promise<Message[]>
  getLastUserMessage(sessionId: string): Promise<Message | null>

  forkSession(
    targetSessionId: string,
    targetMessageId: string,
    newTitle: string,
    settings?: Partial<Session['config']>,
    selectedVariantsMap?: Record<string, string>
  ): Promise<string>
  createChildSessionFromSelection(params: CreateChildSessionParams): Promise<string>
  listChildSessionsByParent(parentSessionId: string): Promise<Session[]>
  listChildSessionsByMessageIds(parentMessageIds: string[]): Promise<Session[]>

  clearContext(sessionId: string): Promise<void>
  clearAllMessages(sessionId: string): Promise<void>

  generateTitle(sessionId: string): Promise<string>
  clearCommandPermissionCache(conversationId?: string): void

  exportConversation(
    conversationId: string,
    format?: 'markdown' | 'html' | 'txt'
  ): Promise<{ filename: string; content: string }>
  exportToNowledgeMem(conversationId: string): Promise<{
    success: boolean
    data?: NowledgeMemThread | undefined
    summary?: NowledgeMemExportSummary
    errors?: string[]
    warnings?: string[]
  }>
  submitToNowledgeMem(conversationId: string): Promise<{
    success: boolean
    threadId?: string
    data?: NowledgeMemThread
    errors?: string[]
  }>
  testNowledgeMemConnection(): Promise<{
    success: boolean
    message?: string
    error?: string
  }>
  updateNowledgeMemConfig(config: {
    baseUrl?: string
    apiKey?: string
    timeout?: number
  }): Promise<void>
  getNowledgeMemConfig(): {
    baseUrl: string
    apiKey?: string
    timeout: number
  }
}
