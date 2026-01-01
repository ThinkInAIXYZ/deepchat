import type { Message, AssistantMessage } from '../../chat'
import type {
  IThreadPresenter,
  MESSAGE_STATUS,
  MESSAGE_METADATA,
  ParentSelection,
  AcpWorkdirInfo
} from './thread.presenter'

export type SessionStatus = 'idle' | 'generating' | 'paused' | 'waiting_permission' | 'error'

export type SessionConfig = {
  sessionId: string
  title: string
  providerId: string
  modelId: string
  chatMode: 'chat' | 'agent' | 'acp agent'
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
  acpWorkdirMap?: Record<string, string | null>
  selectedVariantsMap?: Record<string, string>
  isPinned?: boolean
}

export type SessionBindings = {
  tabId: number | null
  windowId: number | null
  windowType: 'main' | 'floating' | 'browser' | null
}

export type PermissionState = {
  toolCallId: string
  permissionType: 'read' | 'write' | 'all' | 'command'
  payload: unknown
  requestId?: string
  sessionId?: string
  agentId?: string
  agentName?: string
  conversationId?: string
}

export type SessionRuntime = {
  loopId?: string
  currentMessageId?: string
  toolCallCount: number
  userStopRequested: boolean
  pendingPermission?: PermissionState
}

export type WorkspaceContext = {
  resolvedChatMode: 'chat' | 'agent' | 'acp agent'
  agentWorkspacePath: string | null
  acpWorkdirMap?: Record<string, string | null>
}

export type Session = {
  sessionId: string
  status: SessionStatus
  config: SessionConfig
  bindings: SessionBindings
  runtime?: SessionRuntime
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

  sendMessage(
    sessionId: string,
    content: string,
    tabId?: number,
    selectedVariantsMap?: Record<string, string>
  ): Promise<AssistantMessage | null>
  editMessage(messageId: string, content: string): Promise<Message>
  deleteMessage(messageId: string): Promise<void>
  retryMessage(messageId: string, modelId?: string): Promise<Message>
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

  startStreamCompletion(
    sessionId: string,
    queryMsgId?: string,
    selectedVariantsMap?: Record<string, string>
  ): Promise<void>
  continueStreamCompletion(
    sessionId: string,
    queryMsgId: string,
    selectedVariantsMap?: Record<string, string>
  ): Promise<void>
  stopStreamCompletion(sessionId: string, messageId?: string): Promise<void>
  regenerateFromUserMessage(
    sessionId: string,
    userMessageId: string,
    selectedVariantsMap?: Record<string, string>
  ): Promise<AssistantMessage>
  stopSessionGeneration(sessionId: string): Promise<void>

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

  handlePermissionResponse(
    messageId: string,
    toolCallId: string,
    granted: boolean,
    permissionType: 'read' | 'write' | 'all' | 'command',
    remember?: boolean
  ): Promise<void>

  generateTitle(sessionId: string): Promise<string>
  getMessageRequestPreview(messageId: string): Promise<unknown>

  getAcpWorkdir(conversationId: string, agentId: string): Promise<AcpWorkdirInfo>
  setAcpWorkdir(conversationId: string, agentId: string, workdir: string | null): Promise<void>
  warmupAcpProcess(agentId: string, workdir: string): Promise<void>
  getAcpProcessModes(
    agentId: string,
    workdir: string
  ): Promise<{ availableModes?: any; currentModeId?: string } | undefined>
  setAcpPreferredProcessMode(agentId: string, workdir: string, modeId: string): Promise<void>
  setAcpSessionMode(conversationId: string, modeId: string): Promise<void>
  getAcpSessionModes(conversationId: string): Promise<{ current: string; available: any[] } | null>
}
