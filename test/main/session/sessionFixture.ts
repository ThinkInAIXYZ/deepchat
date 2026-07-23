import type { ProviderSettingsPort } from '@/provider/settings'
import type { AgentManager } from '@/agent/manager/agentManager'
import type {
  SessionStatePort,
  SessionTranscriptMutationPort,
  SessionTranscriptReadPort
} from '@/session/data/contracts'
import type { AppSessionService } from '@/agent/shared/appSessionService'
import type { SkillServicePort } from '@shared/types/skill'
import type { MainDatabase } from '@/data/mainDatabase'
import type { AcpAsLlmProviderSessionControlPort } from '@/provider/ports'
import type { SessionPermissionPort } from '@/session/contracts'
import { SessionAssignmentPolicy } from '@/session/assignmentPolicy'
import { SessionAssignment } from '@/session/assignment'
import { SessionDeletion } from '@/session/deletion'
import type { SessionQuery } from '@/session/query'
import { SessionTurn } from '@/session/turn'
import { SessionLifecycle } from '@/session/lifecycle'
import { DesktopSessionBinding } from '@/desktop/sessionBinding'
import { AgentLifecycleGate } from '@/agent/lifecycleGate'

export const createSessionFixture = (input: {
  agentManager: AgentManager
  appSessionService: AppSessionService
  providerSettings: ProviderSettingsPort
  sqlitePresenter: MainDatabase
  sharedData: {
    sessionState: SessionStatePort
    transcript: SessionTranscriptReadPort
    transcriptMutation: SessionTranscriptMutationPort
  }
  projection: SessionQuery
  acp: AcpAsLlmProviderSessionControlPort
  skillService?: Pick<SkillServicePort, 'setActiveSkills' | 'clearNewAgentSessionSkills'>
  sessionPermissionPort?: Pick<SessionPermissionPort, 'clearSessionPermissions'>
}): {
  policy: SessionAssignmentPolicy
  assignment: SessionAssignment
  turn: SessionTurn
  lifecycle: SessionLifecycle
  deletion: SessionDeletion
  desktop: DesktopSessionBinding
} => {
  const desktop = new DesktopSessionBinding(input.projection)
  const agentLifecycle = new AgentLifecycleGate()
  const policy = new SessionAssignmentPolicy(
    {
      resolveAgent: (agentId) => {
        const descriptor = input.agentManager.resolveBackend(agentId).descriptor
        return { id: descriptor.id, kind: descriptor.kind }
      }
    },
    {
      getDefaultModel: () => input.providerSettings.getDefaultModel(),
      getDefaultProjectPath: () => input.providerSettings.getDefaultProjectPath?.() ?? null,
      resolveDeepChatAgentConfig: async (agentId) => {
        if (typeof input.providerSettings.resolveDeepChatAgentConfig !== 'function') return null
        return await input.providerSettings.resolveDeepChatAgentConfig(agentId)
      }
    }
  )
  const deletion = new SessionDeletion({
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
        await input.skillService?.clearNewAgentSessionSkills?.(sessionId)
    }
  })
  const assignment = new SessionAssignment({
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
    acp: input.acp,
    agentLifecycle
  })
  const turn = new SessionTurn({
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
      commitRetryMessage: (sessionId, sourceOrderSeq) =>
        input.sharedData.transcriptMutation.commitRetryMessage(sessionId, sourceOrderSeq),
      deleteMessage: (sessionId, messageId) =>
        input.sharedData.transcriptMutation.deleteMessage(sessionId, messageId),
      editUserMessage: (sessionId, messageId, text) =>
        input.sharedData.transcriptMutation.editUserMessage(sessionId, messageId, text)
    },
    workdir: assignment,
    projection: input.projection
  })
  const lifecycle = new SessionLifecycle({
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
        await input.skillService?.setActiveSkills?.(sessionId, activeSkills)
      }
    },
    assignmentPolicy: policy,
    workdir: assignment,
    initialTurn: turn,
    projection: input.projection,
    desktop,
    deletion,
    agentLifecycle
  })

  return { policy, assignment, turn, lifecycle, deletion, desktop }
}
