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
import { SessionTurnCoordinator } from '@/presenter/sessionApplication/turnCoordinator'
import { SessionLifecycleCoordinator } from '@/presenter/sessionApplication/lifecycleCoordinator'

export const createAssignmentCoordinatorFixture = (input: {
  agentManager: AgentManager
  appSessionService: AppSessionService
  configPresenter: IConfigPresenter
  sqlitePresenter: SQLitePresenter
  sharedData: AgentSharedDataPorts
  projection: SessionProjectionCoordinator
  acp: AcpAsLlmProviderSessionControlPort
  skillPresenter?: Pick<ISkillPresenter, 'setActiveSkills' | 'clearNewAgentSessionSkills'>
  sessionPermissionPort?: Pick<SessionPermissionPort, 'clearSessionPermissions'>
}): {
  policy: SessionAgentAssignmentPolicy
  assignment: SessionAgentAssignmentCoordinator
  turn: SessionTurnCoordinator
  lifecycle: SessionLifecycleCoordinator
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
  const turn = new SessionTurnCoordinator({
    sessions: input.appSessionService,
    runtime: {
      resolveSession: (sessionId) => {
        const { handle } = input.agentManager.resolveSessionHandle(sessionId)
        const base = {
          pending: handle.pending,
          toolInteractions: handle.toolInteractions,
          send: (sendInput: Parameters<typeof handle.send>[0]) => handle.send(sendInput),
          cancel: () => handle.cancel(),
          snapshot: () => handle.snapshot()
        }
        return handle.kind === 'deepchat'
          ? {
              ...base,
              kind: handle.kind,
              compaction: {
                getState: () => handle.deepchat.getCompactionState(),
                compact: () => handle.deepchat.compact()
              }
            }
          : { ...base, kind: handle.kind }
      }
    },
    transcript: {
      hasMessages: (sessionId) => input.sharedData.transcript.hasMessages(sessionId),
      clearMessages: (sessionId) => input.sharedData.transcriptMutation.clearMessages(sessionId),
      prepareRetryMessage: (sessionId, messageId) =>
        input.sharedData.transcriptMutation.prepareRetryMessage(sessionId, messageId),
      deleteMessage: (sessionId, messageId) =>
        input.sharedData.transcriptMutation.deleteMessage(sessionId, messageId),
      editUserMessage: (sessionId, messageId, text) =>
        input.sharedData.transcriptMutation.editUserMessage(sessionId, messageId, text)
    },
    workdir: assignment,
    projection: input.projection
  })
  const lifecycle = new SessionLifecycleCoordinator({
    sessions: input.appSessionService,
    runtime: {
      resolveSession: (sessionId) => {
        const { handle } = input.agentManager.resolveSessionHandle(sessionId)
        return {
          kind: handle.kind,
          initialize: (config) => handle.lifecycle.initialize(config),
          isInitialized: () => handle.lifecycle.isInitialized(),
          snapshot: () => handle.snapshot(),
          getGenerationSettings: () => handle.settings.getGenerationSettings(),
          setPermissionMode: (mode) => handle.settings.setPermissionMode(mode),
          close: () => handle.close()
        }
      }
    },
    transcript: {
      hasMessages: (sessionId) => input.sharedData.transcript.hasMessages(sessionId),
      forkSessionFromMessage: (sourceSessionId, targetSessionId, targetMessageId) =>
        input.sharedData.transcriptMutation.forkSessionFromMessage(
          sourceSessionId,
          targetSessionId,
          targetMessageId
        )
    },
    skills: {
      setActiveSkills: async (sessionId, activeSkills) => {
        await input.skillPresenter?.setActiveSkills?.(sessionId, activeSkills)
      }
    },
    assignmentPolicy: policy,
    workdir: assignment,
    initialTurn: turn,
    projection: input.projection,
    deletion
  })

  return { policy, assignment, turn, lifecycle, deletion }
}
