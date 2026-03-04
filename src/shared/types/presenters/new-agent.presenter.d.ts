import type {
  Agent,
  CreateSessionInput,
  SessionWithState,
  ChatMessageRecord,
  MessageTraceRecord,
  PermissionMode,
  SessionGenerationSettings,
  ToolInteractionResponse,
  ToolInteractionResult
} from '../agent-interface'

export interface INewAgentPresenter {
  createSession(input: CreateSessionInput, webContentsId: number): Promise<SessionWithState>
  ensureAcpDraftSession(input: {
    agentId: string
    projectDir: string
    permissionMode?: PermissionMode
  }): Promise<SessionWithState>
  sendMessage(sessionId: string, content: string): Promise<void>
  retryMessage(sessionId: string, messageId: string): Promise<void>
  deleteMessage(sessionId: string, messageId: string): Promise<void>
  editUserMessage(sessionId: string, messageId: string, text: string): Promise<ChatMessageRecord>
  forkSession(
    sourceSessionId: string,
    targetMessageId: string,
    newTitle?: string
  ): Promise<SessionWithState>
  getSessionList(filters?: { agentId?: string; projectDir?: string }): Promise<SessionWithState[]>
  getSession(sessionId: string): Promise<SessionWithState | null>
  getMessages(sessionId: string): Promise<ChatMessageRecord[]>
  listMessageTraces(messageId: string): Promise<MessageTraceRecord[]>
  getMessageTraceCount(messageId: string): Promise<number>
  getMessageIds(sessionId: string): Promise<string[]>
  getMessage(messageId: string): Promise<ChatMessageRecord | null>
  activateSession(webContentsId: number, sessionId: string): Promise<void>
  deactivateSession(webContentsId: number): Promise<void>
  getActiveSession(webContentsId: number): Promise<SessionWithState | null>
  getAgents(): Promise<Agent[]>
  deleteSession(sessionId: string): Promise<void>
  cancelGeneration(sessionId: string): Promise<void>
  respondToolInteraction(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult>
  getAcpSessionCommands(sessionId: string): Promise<
    Array<{
      name: string
      description: string
      input?: { hint: string } | null
    }>
  >
  getPermissionMode(sessionId: string): Promise<PermissionMode>
  setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void>
  setSessionModel(sessionId: string, providerId: string, modelId: string): Promise<SessionWithState>
  getSessionGenerationSettings(sessionId: string): Promise<SessionGenerationSettings | null>
  updateSessionGenerationSettings(
    sessionId: string,
    settings: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings>
}
