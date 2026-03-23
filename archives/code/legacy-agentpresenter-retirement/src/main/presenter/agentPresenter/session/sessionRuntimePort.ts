import type {
  PendingPermission,
  PermissionResumeLock,
  SessionContext,
  SessionStatus
} from './sessionContext'

export type SessionRuntimeLoopOptions = {
  preservePendingPermissions?: boolean
  skipLockAcquisition?: boolean
}

export type SessionRuntimeWorkspaceContext = {
  chatMode: 'agent' | 'acp agent'
  agentWorkspacePath: string | null
}

export interface AgentSessionRuntimePort {
  getSession(agentId: string): Promise<SessionContext>
  getSessionSync(agentId: string): SessionContext | null
  resolveWorkspaceContext(
    conversationId?: string,
    modelId?: string
  ): Promise<SessionRuntimeWorkspaceContext>
  startLoop(agentId: string, messageId: string, options?: SessionRuntimeLoopOptions): Promise<void>
  setStatus(agentId: string, status: SessionStatus): void
  getStatus(agentId: string): SessionStatus | null
  updateRuntime(agentId: string, updates: Partial<SessionContext['runtime']>): void
  incrementToolCallCount(agentId: string): void
  clearPendingPermission(agentId: string): void
  clearPendingQuestion(agentId: string): void
  addPendingPermission(agentId: string, permission: PendingPermission): void
  removePendingPermission(agentId: string, messageId: string, toolCallId: string): void
  getPendingPermissions(agentId: string): PendingPermission[] | undefined
  hasPendingPermissions(agentId: string, messageId?: string): boolean
  acquirePermissionResumeLock(agentId: string, messageId: string): boolean
  releasePermissionResumeLock(agentId: string): void
  getPermissionResumeLock(agentId: string): PermissionResumeLock | undefined
}
