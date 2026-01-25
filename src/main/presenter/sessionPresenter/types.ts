export type SessionStatus = 'idle' | 'generating' | 'paused' | 'waiting_permission' | 'error'

export type SessionConfig = {
  sessionId: string
  title: string
  providerId: string
  modelId: string
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
  activeSkills?: string[]
  isPinned?: boolean
}

export type SessionBindings = {
  tabId: number | null
  windowId: number | null
  windowType: 'main' | 'floating' | 'browser' | null
}

export type WorkspaceContext = {
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
