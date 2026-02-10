export type SessionStatus =
  | 'idle'
  | 'generating'
  | 'paused'
  | 'waiting_permission'
  | 'waiting_question'
  | 'error'

export type SessionContextResolved = {
  chatMode: 'chat' | 'agent' | 'acp agent'
  providerId: string
  modelId: string
  supportsVision: boolean
  supportsFunctionCall: boolean
  agentWorkspacePath: string | null
  enabledMcpTools?: string[]
  acpWorkdirMap?: Record<string, string | null>
}

export type PendingPermission = {
  messageId: string
  toolCallId: string
  permissionType: 'read' | 'write' | 'all' | 'command'
  payload: unknown
}

export type PermissionResumeLock = {
  messageId: string
  startedAt: number
}

export type SessionContext = {
  sessionId: string
  agentId: string
  status: SessionStatus
  createdAt: number
  updatedAt: number
  resolved: SessionContextResolved
  runtime?: {
    loopId?: string
    currentMessageId?: string
    toolCallCount: number
    userStopRequested: boolean
    pendingPermission?: PendingPermission
    pendingPermissions?: PendingPermission[]
    permissionResumeLock?: PermissionResumeLock
    pendingQuestion?: {
      messageId: string
      toolCallId: string
    }
    pendingQuestionInitialized?: boolean
  }
}
