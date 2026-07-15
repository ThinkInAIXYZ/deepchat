import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type {
  SessionDeletionPermissionPort,
  SessionDeletionRuntimePort,
  SessionDeletionSkillPort,
  SessionDeletionStatePort,
  SessionDeletionStorePort,
  SessionLifecycleDeletionPort
} from './contracts'

export interface SessionDeletionDependencies {
  sessions: SessionDeletionStorePort
  runtime: SessionDeletionRuntimePort
  state: SessionDeletionStatePort
  permissions: SessionDeletionPermissionPort
  skills: SessionDeletionSkillPort
}

export class SessionDeletion implements SessionLifecycleDeletionPort {
  constructor(private readonly dependencies: SessionDeletionDependencies) {}

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

    // Best-effort staged cleanup: never leave a zombie session row when later stages still work.
    const stageErrors: Array<{ stage: string; error: unknown }> = []
    try {
      await this.dependencies.runtime.cleanupSessionBackends(toAppSessionId(sessionId))
    } catch (error) {
      stageErrors.push({ stage: 'backend', error })
      console.warn(`[SessionDeletion] backend cleanup failed for ${sessionId}:`, error)
    }
    try {
      await this.dependencies.state.destroySession(sessionId)
    } catch (error) {
      stageErrors.push({ stage: 'state', error })
      console.warn(`[SessionDeletion] state destroy failed for ${sessionId}:`, error)
    }

    try {
      this.dependencies.permissions.clearSessionPermissions(sessionId)
    } catch (error) {
      stageErrors.push({ stage: 'permissions', error })
    }
    try {
      await this.dependencies.skills.clearNewAgentSessionSkills(sessionId)
    } catch (error) {
      stageErrors.push({ stage: 'skills', error })
    }

    this.dependencies.sessions.delete(sessionId)
    deletedSessionIds.push(sessionId)

    if (stageErrors.length > 0) {
      console.warn(
        `[SessionDeletion] completed delete for ${sessionId} with partial failures:`,
        stageErrors.map((entry) => entry.stage).join(', ')
      )
    }
    return deletedSessionIds
  }
}
