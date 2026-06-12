import type { ReasoningEffort, Verbosity } from '@shared/types/model-db'

export type SessionStatus =
  | 'idle'
  | 'generating'
  | 'paused'
  | 'waiting_permission'
  | 'waiting_question'
  | 'error'

export type SessionConfig = {
  sessionId: string
  title: string
  providerId: string
  modelId: string
  chatMode: 'agent' | 'acp agent'
  systemPrompt: string
  maxTokens?: number
  temperature?: number
  contextLength?: number
  supportsVision?: boolean
  supportsFunctionCall?: boolean
  thinkingBudget?: number
  reasoningEffort?: ReasoningEffort
  verbosity?: Verbosity
  enabledMcpTools?: string[]
  agentWorkspacePath?: string | null
  acpWorkdirMap?: Record<string, string | null>
  selectedVariantsMap?: Record<string, string>
  activeSkills?: string[]
  isPinned?: boolean
}

export type SessionBindings = {
  webContentsId: number | null
  windowId: number | null
  windowType: 'main' | 'floating' | 'browser' | null
}

export type WorkspaceContext = {
  resolvedChatMode: 'agent' | 'acp agent'
  agentWorkspacePath: string | null
  acpWorkdirMap?: Record<string, string | null>
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
  webContentsId?: number
  tabId?: number
}

export type CreateSessionParams = {
  title: string
  settings?: Partial<SessionConfig>
  webContentsId?: number
  tabId?: number
  options?: CreateSessionOptions
}
