import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type {
  SessionDeletionPermissionPort,
  SessionDeletionProjectionPort,
  SessionDeletionRuntimePort,
  SessionDeletionSkillPort,
  SessionDeletionStatePort,
  SessionDeletionStorePort,
  SessionLifecycleDeletionPort
} from './ports'

export interface SessionDeletionTransactionDependencies {
  sessions: SessionDeletionStorePort
  runtime: SessionDeletionRuntimePort
  state: SessionDeletionStatePort
  permissions: SessionDeletionPermissionPort
  skills: SessionDeletionSkillPort
  projection: SessionDeletionProjectionPort
}

export class SessionDeletionTransaction implements SessionLifecycleDeletionPort {
  constructor(private readonly dependencies: SessionDeletionTransactionDependencies) {}

  async deleteSessionTree(sessionId: string): Promise<string[]> {
    const session = this.dependencies.sessions.get(sessionId)
    if (!session) return []

    const deletedSessionIds: string[] = []
    if (session.sessionKind === 'regular') {
      const children = this.dependencies.sessions.list({
        includeSubagents: true,
        parentSessionId: sessionId
      })
      for (const child of children) {
        deletedSessionIds.push(...(await this.deleteSessionTree(child.id)))
      }
    }

    let backendCleanupError: unknown
    try {
      await this.dependencies.runtime.cleanupSessionBackends(toAppSessionId(sessionId))
    } catch (error) {
      backendCleanupError = error
    }
    try {
      await this.dependencies.state.destroySession(sessionId)
    } catch (error) {
      if (!backendCleanupError) throw error
    }
    if (backendCleanupError) throw backendCleanupError

    this.dependencies.permissions.clearSessionPermissions(sessionId)
    await this.dependencies.skills.clearNewAgentSessionSkills(sessionId)
    this.dependencies.sessions.delete(sessionId)
    this.dependencies.projection.forgetStatus([sessionId])
    deletedSessionIds.push(sessionId)
    return deletedSessionIds
  }
}
