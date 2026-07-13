import type { AgentManager } from '@/agent/manager/agentManager'
import type { AgentSharedDataPorts } from '@/agent/shared/agentSharedData'
import type { AppSessionService } from '@/agent/shared/appSessionService'
import type { IConfigPresenter, ISkillPresenter } from '@shared/presenter'
import type { SQLitePresenter } from '@/presenter/sqlitePresenter'
import type {
  AcpAsLlmProviderSessionControlPort,
  SessionPermissionPort
} from '@/presenter/runtimePorts'
import { SessionAgentAssignmentPolicy } from '@/presenter/sessionApplication/agentAssignmentPolicy'
import { SessionAgentAssignmentCoordinator } from '@/presenter/sessionApplication/agentAssignmentCoordinator'
import { SessionDeletionTransaction } from '@/presenter/sessionApplication/lifecycleDeletionTransaction'
import type { SessionProjectionCoordinator } from '@/presenter/sessionApplication/projectionCoordinator'

export const createAssignmentCoordinatorFixture = (input: {
  agentManager: AgentManager
  appSessionService: AppSessionService
  configPresenter: IConfigPresenter
  sqlitePresenter: SQLitePresenter
  sharedData: AgentSharedDataPorts
  projection: SessionProjectionCoordinator
  acp: AcpAsLlmProviderSessionControlPort
  skillPresenter?: Pick<ISkillPresenter, 'clearNewAgentSessionSkills'>
  sessionPermissionPort?: Pick<SessionPermissionPort, 'clearSessionPermissions'>
}): {
  policy: SessionAgentAssignmentPolicy
  assignment: SessionAgentAssignmentCoordinator
  deletion: SessionDeletionTransaction
} => {
  const policy = new SessionAgentAssignmentPolicy(
    {
      resolveAgent: (agentId) => {
        const descriptor = input.agentManager.resolveBackend(agentId).descriptor
        return { id: descriptor.id, kind: descriptor.kind }
      }
    },
    {
      getDefaultModel: () => input.configPresenter.getDefaultModel(),
      getDefaultProjectPath: () => input.configPresenter.getDefaultProjectPath?.() ?? null,
      resolveDeepChatAgentConfig: async (agentId) => {
        if (typeof input.configPresenter.resolveDeepChatAgentConfig !== 'function') return null
        return await input.configPresenter.resolveDeepChatAgentConfig(agentId)
      }
    }
  )
  const deletion = new SessionDeletionTransaction({
    sessions: input.appSessionService,
    runtime: {
      cleanupSessionBackends: async (sessionId) =>
        await input.agentManager.cleanupSessionBackends(sessionId)
    },
    state: input.sharedData.sessionState,
    permissions: {
      clearSessionPermissions: (sessionId) =>
        input.sessionPermissionPort?.clearSessionPermissions(sessionId)
    },
    skills: {
      clearNewAgentSessionSkills: async (sessionId) =>
        await input.skillPresenter?.clearNewAgentSessionSkills?.(sessionId)
    },
    projection: input.projection
  })
  const assignment = new SessionAgentAssignmentCoordinator({
    sessions: input.appSessionService,
    runtime: {
      getSessionAgentKind: (sessionId) =>
        input.agentManager.resolveSessionBackend(sessionId).descriptor.kind,
      resolveSession: (sessionId) => input.agentManager.resolveSessionHandle(sessionId),
      resolveTransferSource: (sessionId) => input.agentManager.resolveTransferSource(sessionId),
      resolveDeepChatTransferTarget: (agentId) =>
        input.agentManager.resolveDeepChatTransferTarget(agentId),
      resolveSubagentFacet: (sessionId) => input.agentManager.resolveSubagentFacet(sessionId)
    },
    policy,
    projection: input.projection,
    deletion,
    environment: {
      syncPath: (projectDir) => input.sqlitePresenter.newEnvironmentsTable.syncPath(projectDir)
    },
    acp: input.acp
  })

  return { policy, assignment, deletion }
}
