import logger from '@shared/logger'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { SkillMetadataSnapshotPort, SkillServicePort } from '@shared/types/skill'
import { liveDelegationChangedEvent } from '@shared/contracts/events'
import { projectFinalAssistantAnswer } from '@shared/lib/assistantDeliverySegments'
import { resolveAcpAgentAlias } from '@shared/utils/acpAgentAlias'
import {
  createDeepChatAgentHarness,
  type DeepChatHarnessDependencies
} from '@/agent/deepchat/harness'
import { AcpAgentRuntime } from '@/agent/acp/instance'
import type { AcpRuntimeOwner } from '@/agent/acp/client/acpRuntimeOwner'
import type { AcpSessionPersistence } from '@/agent/acp/runtime'
import { AgentManager } from '@/agent/manager/agentManager'
import { createDeepChatAgentBackend } from '@/agent/manager/deepChatAgentBackend'
import { createDirectAcpAgentBackend } from '@/agent/manager/directAcpAgentBackend'
import type { AgentRepository } from '@/agent/repository'
import type { AppSessionService } from '@/agent/shared/appSessionService'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { resolveAssistantModelSelection } from '@/agent/shared/assistantModelSelection'
import { AgentUnavailableError } from '@/agent/shared/agentCatalogCodec'
import type { AgentLifecycleGate } from '@/agent/lifecycleGate'
import { DesktopSessionBinding } from '@/desktop/sessionBinding'
import { SessionQuery } from '@/session/query'
import { SessionAssignmentPolicy } from '@/session/assignmentPolicy'
import { SessionAssignment } from '@/session/assignment'
import { SessionDeletion } from '@/session/deletion'
import type { SessionDeletionGate } from '@/session/deletionGate'
import { SessionTurn } from '@/session/turn'
import { SessionLifecycle, type SessionLifecycleDependencies } from '@/session/lifecycle'
import { SessionTranscriptMutations } from '@/session/transcriptMutations'
import { SessionHistorySearch } from '@/session/sessionHistorySearch'
import { SessionTranslation } from '@/session/sessionTranslation'
import { AgentSessionExportService } from '@/exporter/agentSessionExporter'
import { CliRunService } from '@/cli/runService'
import type { DatabaseRequestGate } from '@/app/databaseRequestGate'
import type { TypedEventHub } from '@/events/typedEventHub'
import { OrchestrationCapabilityResolver } from '@/orchestration/capability'
import { LiveDelegationSafetyCoordinator } from '@/orchestration/liveDelegationSafety'
import {
  LiveDelegationService,
  type LiveDelegationLifecycleObservation
} from '@/orchestration/liveDelegationService'
import type { LiveDelegationRepository } from '@/orchestration/liveDelegationRepository'
import type { LiveDelegationConsentAuthority } from '@/orchestration/liveDelegationConsent'
import type { AgentInvocationAdmissionPort } from '@shared/harness/admission'
import type { ProjectDatabase } from '@/project/data/database'
import type { ProjectService } from '@/project'
import type { ProviderRuntime } from '@/provider'
import type { ProviderSettings } from '@/provider/settings'
import type { AcpAsLlmProviderSessionControlPort } from '@/provider/ports'
import type { AgentToolDependencies } from '@/tool/runtimePorts'
import type { NowledgeMemConnections } from '@/nowledgeMem'

export function createLivePort<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const target = resolve()
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}

export function createCoreExecution(options: {
  harness: Omit<
    DeepChatHarnessDependencies,
    'interactionContinuationAdmission' | 'taskContractContext'
  > & {
    providerRuntime: ProviderRuntime
    providerSettings: ProviderSettings
    skillService: SkillServicePort & SkillMetadataSnapshotPort
  }
  agentRepository: AgentRepository
  appSessionService: AppSessionService
  acpRuntimeOwner: AcpRuntimeOwner
  acpSessionPersistence: AcpSessionPersistence
  acpAsLlmProviderSessionControl: AcpAsLlmProviderSessionControlPort
  agentLifecycle: AgentLifecycleGate
  sessionDeletionGate: SessionDeletionGate
  projectDatabase: ProjectDatabase
  projectService: Pick<
    ProjectService,
    'getDefaultProjectPath' | 'notifyEnvironmentProjectionChanged'
  >
  agentToolDependencies: AgentToolDependencies
  agentInvocationAdmission: AgentInvocationAdmissionPort
  liveDelegationRepository: LiveDelegationRepository
  liveDelegationConsent: LiveDelegationConsentAuthority
  nowledgeMemConnections: NowledgeMemConnections
  databaseRequests: Pick<DatabaseRequestGate, 'runRequest'>
  typedEventHub: TypedEventHub
  resolveSessionRunId(sessionId: string): string | null | undefined
  onRendererDestroyed: NonNullable<SessionLifecycleDependencies['onRendererDestroyed']>
  destroySessionBrowser(sessionId: string): Promise<void>
  observeDelegation(observation: LiveDelegationLifecycleObservation): void
  observationsEnabled(): boolean
}) {
  const {
    providerRuntime,
    providerSettings,
    agentSettings,
    sessionData,
    sessionPermissionPort,
    sessionUiPort,
    skillService,
    publishEvent: publishDeepchatEvent
  } = options.harness
  const {
    agentRepository,
    appSessionService,
    acpRuntimeOwner,
    acpSessionPersistence,
    acpAsLlmProviderSessionControl,
    agentLifecycle,
    sessionDeletionGate,
    projectDatabase,
    projectService,
    agentToolDependencies,
    agentInvocationAdmission,
    liveDelegationRepository,
    liveDelegationConsent,
    nowledgeMemConnections,
    databaseRequests,
    typedEventHub,
    resolveSessionRunId
  } = options
  let liveDelegationService: LiveDelegationService
  const deepChatAgentHarness = createDeepChatAgentHarness({
    ...options.harness,
    interactionContinuationAdmission: {
      resume: async (sessionId, signal) =>
        await liveDelegationService.beforeInteractionContinuation(sessionId, signal),
      suspend: (sessionId) => liveDelegationService.suspendInteractionContinuation(sessionId)
    },
    taskContractContext: {
      prepare: (sessionId) => liveDelegationService.prepareTaskContractContext(sessionId)
    }
  })
  const sessionTranscriptMutations = new SessionTranscriptMutations({
    transcript: sessionData.transcript,
    runtime: deepChatAgentHarness,
    clearTranscript: sessionData.clearTranscript
  })
  const memoryIngestionObserver = deepChatAgentHarness.memoryIngestionObserver
  const acpAgentRuntime = new AcpAgentRuntime(
    acpRuntimeOwner,
    (input) => deepChatAgentHarness.createAcpAgentInstanceDependencies(input),
    sessionData.pendingInputs
  )
  const agentManager = new AgentManager(agentRepository, appSessionService, {
    deepchat: createDeepChatAgentBackend({
      port: deepChatAgentHarness,
      runtime: deepChatAgentHarness.deepChatRuntime,
      transcript: sessionData.transcript,
      tape: sessionData.tape
    }),
    acp: createDirectAcpAgentBackend({
      runtime: acpAgentRuntime,
      sessionState: deepChatAgentHarness,
      transcript: sessionData.transcript,
      tape: sessionData.tape,
      deleteDurableSession: async (sessionId) => {
        await acpSessionPersistence.deleteSessions(sessionId)
      },
      resolveInput: async (sessionId, descriptor) => {
        const session = appSessionService.get(sessionId)
        if (!session || resolveAcpAgentAlias(session.agentId) !== descriptor.id) {
          throw new AgentUnavailableError(descriptor.id, 'invalid-config', 'acp')
        }
        const agent = (await agentSettings.getAcpAgents()).find(
          (candidate) => candidate.id === descriptor.id && candidate.source === descriptor.source
        )
        if (!agent || !agent.command.trim()) {
          throw new AgentUnavailableError(descriptor.id, 'invalid-config', 'acp')
        }
        return {
          sessionId: toAppSessionId(session.id),
          descriptor,
          agent,
          scope: session.sessionKind === 'subagent' ? 'subagent' : 'regular',
          workdir: session.projectDir?.trim() ?? ''
        }
      }
    })
  })
  const sessionQuery = new SessionQuery({
    sessions: appSessionService,
    runtime: {
      getAgentKind: (agentId) => agentManager.resolveBackend(agentId).kind,
      snapshot: async (sessionId, options) =>
        await agentManager.resolveSessionHandle(toAppSessionId(sessionId)).handle.snapshot(options),
      snapshotIfHydrated: async (sessionId) =>
        await agentManager.snapshotIfHydrated(toAppSessionId(sessionId)),
      waitForFirstTurnReady: async (sessionId, options) =>
        await agentManager
          .resolveSessionHandle(toAppSessionId(sessionId))
          .handle.waitForFirstTurnReady(options)
    },
    transcript: sessionData.transcript,
    tape: sessionData.tape,
    messages: createLivePort(() => sessionData.database.deepchatMessagesTable),
    searchResults: createLivePort(() => sessionData.database.deepchatMessageSearchResultsTable),
    traces: createLivePort(() => sessionData.database.deepchatMessageTracesTable),
    usesAgentTitle: (sessionId) =>
      !!acpRuntimeOwner.peek()?.sessionController.getSession(toAppSessionId(sessionId))?.extensions
        ?.sessionTitle,
    onTitleRenamed: async (sessionId, agentId) => {
      if (agentManager.resolveBackend(agentId).kind === 'acp')
        await acpRuntimeOwner
          .getOrCreate()
          .sessionController.markTitleManual(toAppSessionId(sessionId), agentId)
    },
    titles: providerRuntime,
    agentConfig: {
      getAssistantModel: async (agentId) => {
        const selection = await resolveAssistantModelSelection(
          {
            agentManager: agentManager,
            agentSettings
          },
          agentId,
          '',
          ''
        )
        return selection.providerId && selection.modelId ? selection : null
      }
    },
    events: {
      publish: (payload) => publishDeepchatEvent('sessions.updated', payload)
    },
    ui: sessionUiPort
  })
  const desktopSessionBinding = new DesktopSessionBinding(sessionQuery, options.onRendererDestroyed)
  const sessionAssignmentPolicy = new SessionAssignmentPolicy(
    {
      resolveAgent: (agentId) => {
        const descriptor = agentManager.resolveBackend(agentId).descriptor
        return { id: descriptor.id, kind: descriptor.kind }
      }
    },
    {
      getDefaultModel: () => agentSettings.getDefaultModel(),
      getDefaultProjectPath: () => projectService.getDefaultProjectPath(),
      resolveDeepChatAgentConfig: async (agentId) =>
        await agentSettings.resolveDeepChatAgentConfig(agentId)
    }
  )
  const clearNewAgentSessionSkills = skillService.clearNewAgentSessionSkills
  if (!clearNewAgentSessionSkills) {
    throw new Error('Skill presenter must provide session skill cleanup.')
  }
  const sessionDeletion = new SessionDeletion({
    sessions: appSessionService,
    gate: sessionDeletionGate,
    orchestration: {
      prepareSessionDeletion: async (sessionId) =>
        await liveDelegationService.prepareSessionDeletion(sessionId)
    },
    runtime: {
      cleanupSessionBackends: async (sessionId) =>
        await agentManager.cleanupSessionBackends(sessionId),
      destroySessionBrowser: async (sessionId) => await options.destroySessionBrowser(sessionId)
    },
    state: deepChatAgentHarness,
    permissions: sessionPermissionPort,
    skills: {
      clearNewAgentSessionSkills: async (sessionId) =>
        await clearNewAgentSessionSkills.call(skillService, sessionId),
      completeNewAgentSessionSkillsDeletion: (sessionId) =>
        skillService.completeNewAgentSessionSkillsDeletion(sessionId)
    }
  })
  const sessionAssignment = new SessionAssignment({
    sessions: appSessionService,
    runtime: {
      getSessionAgentKind: (sessionId) =>
        agentManager.resolveSessionBackend(sessionId).descriptor.kind,
      resolveSession: (sessionId) => agentManager.resolveSessionHandle(sessionId),
      resolveTransferSource: (sessionId) => agentManager.resolveTransferSource(sessionId),
      resolveDeepChatTransferTarget: (agentId) =>
        agentManager.resolveDeepChatTransferTarget(agentId),
      resolveSubagentFacet: (sessionId) => agentManager.resolveSubagentFacet(sessionId)
    },
    policy: sessionAssignmentPolicy,
    projection: sessionQuery,
    deletion: sessionDeletion,
    environment: {
      syncPath: (projectDir) => {
        projectDatabase.newEnvironmentsTable.syncPath(projectDir)
        projectService.notifyEnvironmentProjectionChanged()
      }
    },
    acp: acpAsLlmProviderSessionControl,
    agentLifecycle
  })
  const sessionTurn = new SessionTurn({
    sessions: appSessionService,
    runtime: {
      resolveSession: (sessionId) => {
        const { handle } = agentManager.resolveSessionHandle(sessionId)
        const turn = {
          pending: handle.pending,
          toolInteractions: handle.toolInteractions,
          send: (input: Parameters<typeof handle.send>[0]) => handle.send(input),
          cancel: () => handle.cancel(),
          snapshot: () => handle.snapshot()
        }
        return handle.kind === 'deepchat'
          ? {
              ...turn,
              kind: handle.kind,
              compaction: {
                getSnapshot: () => handle.deepchat.getCompactionSnapshot(),
                compact: () => handle.deepchat.compact()
              },
              getContextOccupancy: () => handle.deepchat.getContextOccupancy(),
              isPendingQueueResumeAvailable: () => handle.deepchat.isPendingQueueResumeAvailable(),
              resumePendingQueue: () => handle.deepchat.resumePendingQueue(),
              retryPendingQueueInput: (itemId) => handle.deepchat.retryPendingQueueInput(itemId)
            }
          : { ...turn, kind: handle.kind }
      }
    },
    transcript: {
      hasMessages: (sessionId) => sessionData.transcript.hasMessages(sessionId),
      clearMessages: (sessionId) => sessionTranscriptMutations.clearMessages(sessionId),
      prepareRetryMessage: (sessionId, messageId) =>
        sessionTranscriptMutations.prepareRetryMessage(sessionId, messageId),
      commitRetryMessage: (sessionId, sourceOrderSeq) =>
        sessionTranscriptMutations.commitRetryMessage(sessionId, sourceOrderSeq),
      deleteMessage: (sessionId, messageId) =>
        sessionTranscriptMutations.deleteMessage(sessionId, messageId),
      editUserMessage: (sessionId, messageId, text, inlineItems) =>
        sessionTranscriptMutations.editUserMessage(sessionId, messageId, text, inlineItems)
    },
    workdir: sessionAssignment,
    projection: sessionQuery
  })
  const sessionLifecycle = new SessionLifecycle({
    onRendererDestroyed: options.onRendererDestroyed,
    forkAcpSession: async (sourceId, targetId, messageId) => {
      const message = sessionData.transcript.getMessage(messageId)
      if (
        !message ||
        message.sessionId !== sourceId ||
        message.role !== 'assistant' ||
        message.status !== 'sent'
      )
        throw new Error('Fork requires a completed ACP assistant message')
      const metadata = JSON.parse(message.metadata) as { acp?: { turnId?: string } }
      const blocks = JSON.parse(message.content) as AssistantMessageBlock[]
      const anchors = blocks.flatMap((block) => {
        try {
          const meta = JSON.parse(String(block.extra?.providerOptionsJson ?? '{}'))
          return typeof meta.acp?.turnId === 'string' ? [meta.acp.turnId] : []
        } catch {
          return []
        }
      })
      const turnId = anchors.at(-1) ?? metadata.acp?.turnId
      if (!turnId) throw new Error('This message has no verified remote turn anchor')
      const result = await acpAgentRuntime.forkSession(
        toAppSessionId(sourceId),
        toAppSessionId(targetId),
        turnId,
        messageId
      )
      sessionData.transcript.importAcpHistory(
        targetId,
        result.agentId,
        result.remoteSessionId,
        result.history
      )
      await acpRuntimeOwner
        .getOrCreate()
        .sessionController.completeFork(toAppSessionId(sourceId), messageId)
    },
    sessions: appSessionService,
    runtime: {
      resolveSession: (sessionId) => {
        const { handle } = agentManager.resolveSessionHandle(sessionId)
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
      hasMessages: (sessionId) => sessionData.transcript.hasMessages(sessionId),
      forkSessionFromMessage: (sourceSessionId, targetSessionId, targetMessageId) =>
        sessionTranscriptMutations.forkSessionFromMessage(
          sourceSessionId,
          targetSessionId,
          targetMessageId
        )
    },
    skills: {
      setActiveSkills: async (sessionId, activeSkills) => {
        await skillService.setActiveSkills(sessionId, activeSkills)
      }
    },
    assignmentPolicy: sessionAssignmentPolicy,
    workdir: sessionAssignment,
    initialTurn: sessionTurn,
    projection: sessionQuery,
    desktop: desktopSessionBinding,
    deletion: sessionDeletion,
    deletionGate: sessionDeletionGate,
    permissions: sessionPermissionPort,
    agentLifecycle
  })
  const cliRunService = new CliRunService({
    lifecycle: sessionLifecycle,
    turn: sessionTurn,
    projection: sessionQuery,
    sessions: appSessionService,
    getPendingAssistantMessages: (runId) =>
      sessionData.transcript.getPendingAssistantMessages(runId),
    hasWaitingDescendantInteraction: (runId) =>
      liveDelegationRepository
        .listActiveTurns()
        .some(
          ({ delegation, turn }) =>
            (turn.status === 'waiting_permission' || turn.status === 'waiting_question') &&
            resolveSessionRunId(delegation.parentSessionId) === runId
        ),
    readSubscriptionSnapshot: (read) => databaseRequests.runRequest('events.subscribe', read),
    eventHub: typedEventHub,
    log: logger
  })
  const sessionHistorySearch = new SessionHistorySearch(sessionData.database, appSessionService)
  const agentSessionExportService = new AgentSessionExportService({
    nowledgeMemConnections,
    agentManager: agentManager,
    appSessionService,
    transcript: sessionData.transcript,
    providerSettings: providerSettings
  })
  const sessionTranslation = new SessionTranslation({
    agentManager: agentManager,
    agentSettings,
    providerRuntime: providerRuntime
  })
  const orchestrationCapabilityResolver = new OrchestrationCapabilityResolver({
    sessions: agentToolDependencies.sessions,
    agents: agentSettings
  })
  const liveDelegationSafety = new LiveDelegationSafetyCoordinator({
    sessions: agentToolDependencies.sessions,
    assignmentPolicy: sessionAssignmentPolicy,
    assignment: sessionAssignment,
    permissions: sessionPermissionPort,
    executionSnapshots: deepChatAgentHarness
  })
  const createLiveDelegationService = (): LiveDelegationService =>
    (liveDelegationService = new LiveDelegationService({
      repository: liveDelegationRepository,
      admission: agentInvocationAdmission,
      deletionGate: sessionDeletionGate,
      safety: liveDelegationSafety,
      consent: liveDelegationConsent,
      sessions: {
        ...agentToolDependencies.sessions,
        ...agentToolDependencies.subagents,
        findDelegationChild: async (parentSessionId, delegationId) => {
          const matches = appSessionService
            .list({ includeSubagents: true, parentSessionId })
            .filter(
              (session) => session.subagentMeta?.liveDelegation?.delegationId === delegationId
            )
          if (matches.length > 1) {
            throw new Error(`Multiple child Sessions share live delegation ${delegationId}.`)
          }
          return matches[0]
            ? await agentToolDependencies.sessions.resolveConversationSessionInfo(matches[0].id)
            : null
        },
        getAssistantResult: async (sessionId, messageId) => {
          const messages = sessionData.database.deepchatMessagesTable
          const identity = messageId
            ? messages.getAssistantIdentity(messageId)
            : messages.getLatestAssistantIdentity(sessionId)
          if (!identity || identity.session_id !== sessionId) return null

          const resultRows =
            sessionData.database.deepchatAssistantBlocksTable.listResultProjectionByMessageId(
              identity.id
            )
          if (resultRows.length > 0) {
            const answer = projectFinalAssistantAnswer(
              resultRows.map(
                (row): AssistantMessageBlock => ({
                  type: row.block_type,
                  status: row.status,
                  timestamp: row.updated_at,
                  content: row.text_content ?? undefined
                })
              )
            )
            return answer
              ? {
                  messageId: identity.id,
                  answerMarkdown: answer,
                  updatedAt: identity.updated_at
                }
              : null
          }

          const legacyMessage = await sessionQuery.getMessage(identity.id)
          if (!legacyMessage || legacyMessage.sessionId !== sessionId) return null
          try {
            const parsed = JSON.parse(legacyMessage.content) as AssistantMessageBlock[] | string
            const answer = Array.isArray(parsed)
              ? projectFinalAssistantAnswer(parsed)
              : typeof parsed === 'string'
                ? parsed.trim()
                : ''
            return answer
              ? { messageId: identity.id, answerMarkdown: answer, updatedAt: identity.updated_at }
              : null
          } catch {
            const answer = legacyMessage.content.trim()
            return answer
              ? { messageId: identity.id, answerMarkdown: answer, updatedAt: identity.updated_at }
              : null
          }
        }
      },
      observe: options.observeDelegation,
      observationsEnabled: options.observationsEnabled,
      onChanged: (parentSessionId, delegationId) => {
        sessionQuery.notify({ sessionIds: [parentSessionId], reason: 'updated' })
        try {
          publishDeepchatEvent(liveDelegationChangedEvent.name, {
            schemaVersion: 1,
            parentSessionId,
            delegation: liveDelegationService.getSummary(parentSessionId, delegationId)
          })
        } catch (error) {
          logger.warn('[LiveDelegationService] Failed to publish delegation projection', { error })
        }
      }
    }))
  liveDelegationService = createLiveDelegationService()
  return {
    deepChatAgentHarness,
    memoryIngestionObserver,
    acpAgentRuntime,
    sessionQuery,
    desktopSessionBinding,
    sessionAssignment,
    sessionTurn,
    sessionLifecycle,
    cliRunService,
    sessionHistorySearch,
    agentSessionExportService,
    sessionTranslation,
    get liveDelegationService() {
      return liveDelegationService
    },
    createLiveDelegationService,
    orchestrationCapabilityResolver
  }
}
