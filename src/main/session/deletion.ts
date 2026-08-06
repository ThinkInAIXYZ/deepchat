import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type {
  SessionDeletionPermissionPort,
  SessionDeletionOrchestrationPort,
  SessionDeletionRuntimePort,
  SessionDeletionSkillPort,
  SessionDeletionStatePort,
  SessionDeletionStorePort,
  SessionLifecycleDeletionPort
} from './contracts'
import type { SessionDeletionGatePort } from './deletionGate'

export interface SessionDeletionDependencies {
  sessions: SessionDeletionStorePort
  gate: SessionDeletionGatePort
  orchestration: SessionDeletionOrchestrationPort
  runtime: SessionDeletionRuntimePort
  state: SessionDeletionStatePort
  permissions: SessionDeletionPermissionPort
  skills: SessionDeletionSkillPort
}

export class SessionDeletion implements SessionLifecycleDeletionPort {
  constructor(private readonly dependencies: SessionDeletionDependencies) {}

  async deleteSessionTree(sessionId: string): Promise<string[]> {
    return await this.dependencies.gate.runWithSessionDeletion(
      sessionId,
      async () => await this.deleteSessionTreeUnderGate(sessionId)
    )
  }

  private async deleteSessionTreeUnderGate(sessionId: string): Promise<string[]> {
    const session = this.dependencies.sessions.get(sessionId)
    if (!session) return []

    const stageErrors: Array<{ stage: string; error: unknown }> = []
    // Stop the parent producer before taking the orchestration and child snapshots. Runtime cleanup
    // requests cancellation; the deletion gate supplies the stronger guarantee that no new child
    // creation operation can enter while the asynchronous stack unwinds.
    try {
      await this.dependencies.runtime.cleanupSessionBackends(toAppSessionId(sessionId))
    } catch (error) {
      stageErrors.push({ stage: 'backend', error })
      console.warn(`[SessionDeletion] backend cleanup failed for ${sessionId}:`, error)
    }
    try {
      await this.dependencies.orchestration.prepareSessionDeletion(sessionId)
    } catch (error) {
      stageErrors.push({ stage: 'orchestration', error })
      console.warn(`[SessionDeletion] orchestration cleanup failed for ${sessionId}:`, error)
    }

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
