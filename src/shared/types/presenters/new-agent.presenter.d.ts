import type {
  Agent,
  CreateSessionInput,
  SessionWithState,
  ChatMessageRecord
} from '../agent-interface'

export interface INewAgentPresenter {
  createSession(input: CreateSessionInput, webContentsId: number): Promise<SessionWithState>
  sendMessage(sessionId: string, content: string): Promise<void>
  getSessionList(filters?: { agentId?: string; projectDir?: string }): Promise<SessionWithState[]>
  getSession(sessionId: string): Promise<SessionWithState | null>
  getMessages(sessionId: string): Promise<ChatMessageRecord[]>
  getMessageIds(sessionId: string): Promise<string[]>
  getMessage(messageId: string): Promise<ChatMessageRecord | null>
  activateSession(webContentsId: number, sessionId: string): Promise<void>
  deactivateSession(webContentsId: number): Promise<void>
  getActiveSession(webContentsId: number): Promise<SessionWithState | null>
  getAgents(): Promise<Agent[]>
  deleteSession(sessionId: string): Promise<void>
  cancelGeneration(sessionId: string): Promise<void>
}
