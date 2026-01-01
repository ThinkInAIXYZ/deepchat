import { AssistantMessage } from '@shared/chat'
import type { Session, SessionRuntime, SessionStatus, CreateSessionParams } from './types'
import type { Message } from '@shared/chat'

export interface ISessionPresenter {
  // === Session Lifecycle ===
  createSession(params: CreateSessionParams): Promise<string>
  getSession(sessionId: string): Promise<Session>
  getSessionList(page: number, pageSize: number): Promise<{ total: number; sessions: Session[] }>
  renameSession(sessionId: string, title: string): Promise<void>
  deleteSession(sessionId: string): Promise<void>
  toggleSessionPinned(sessionId: string, pinned: boolean): Promise<void>
  updateSessionSettings(sessionId: string, settings: Partial<Session['config']>): Promise<void>
  forkSession(
    targetSessionId: string,
    targetMessageId: string,
    newTitle: string,
    settings?: Partial<Session['config']>,
    selectedVariantsMap?: Record<string, string>
  ): Promise<string>

  // === Session-Tab Binding ===
  bindToTab(sessionId: string, tabId: number): Promise<void>
  unbindFromTab(tabId: number): Promise<void>
  activateSession(tabId: number, sessionId: string): Promise<void>
  getActiveSession(tabId: number): Promise<Session | null>
  findTabForSession(
    sessionId: string,
    preferredWindowType?: 'main' | 'floating'
  ): Promise<number | null>

  // === Message ===
  sendMessage(
    sessionId: string,
    content: string,
    tabId?: number,
    selectedVariantsMap?: Record<string, string>
  ): Promise<AssistantMessage | null>
  editMessage(messageId: string, content: string): Promise<Message>
  deleteMessage(messageId: string): Promise<void>
  retryMessage(messageId: string): Promise<Message>
  getMessage(messageId: string): Promise<Message>
  getMessageVariants(messageId: string): Promise<Message[]>
  getMessageThread(
    sessionId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; messages: Message[] }>
  updateMessageStatus(
    messageId: string,
    status: 'pending' | 'generating' | 'sent' | 'error'
  ): Promise<void>
  updateMessageMetadata(messageId: string, metadata: Record<string, unknown>): Promise<void>
  getContextMessages(sessionId: string, messageCount: number): Promise<Message[]>
  getLastUserMessage(sessionId: string): Promise<Message | null>

  // === Loop Control ===
  continueLoop(
    sessionId: string,
    messageId: string,
    selectedVariantsMap?: Record<string, string>
  ): Promise<void>
  cancelLoop(sessionId: string, messageId: string): Promise<void>
  startLoop(sessionId: string, messageId: string): Promise<void>
  updateRuntime(sessionId: string, updates: Partial<SessionRuntime>): Promise<void>
  setStatus(sessionId: string, status: SessionStatus): Promise<void>
  incrementToolCallCount(sessionId: string): Promise<void>

  // === Permission ===
  handlePermissionResponse(
    messageId: string,
    toolCallId: string,
    granted: boolean,
    permissionType: 'read' | 'write' | 'all' | 'command',
    remember?: boolean
  ): Promise<void>

  // === Utility ===
  translateText(sessionId: string, text: string, tabId: number): Promise<string>
  exportSession(sessionId: string, format: 'markdown' | 'html' | 'txt'): Promise<string>
  previewMessages(
    sessionId: string,
    messageCount: number,
    contextLength: number,
    includeImages: boolean
  ): Promise<{ messages: Message[]; totalTokens: number }>
}
