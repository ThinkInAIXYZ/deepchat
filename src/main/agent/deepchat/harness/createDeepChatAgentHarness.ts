import logger from '@shared/logger'
import type { AcpAgentInstanceDependencyFactory } from '@/agent/acp/instance'
import { createAcpCompatibilityDependencies } from '@/agent/acp/compatibility/dependencies'
import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { DeepChatContextCoordinator } from '@/agent/deepchat/loop/contextCoordinator'
import { InputPreparationCoordinator } from '@/agent/deepchat/loop/inputPreparationCoordinator'
import { MemoryRuntimeCoordinator } from '@/agent/deepchat/memory/memoryRuntimeCoordinator'
import { CompactionRuntimeCoordinator } from '@/agent/deepchat/runtime/compactionRuntimeCoordinator'
import { CompactionService } from '@/agent/deepchat/runtime/compactionService'
import { DeepChatLoopRunner } from '@/agent/deepchat/runtime/deepChatLoopRunner'
import { DeferredToolExecutor } from '@/agent/deepchat/runtime/deferredToolExecutor'
import { InteractionCoordinator } from '@/agent/deepchat/runtime/interactionCoordinator'
import { InteractionParkingRegistry } from '@/agent/deepchat/runtime/interactionParkingRegistry'
import { MessageProjectionService } from '@/agent/deepchat/runtime/messageProjectionService'
import { PendingInputAdmissionCoordinator } from '@/agent/deepchat/runtime/pendingInputAdmissionCoordinator'
import { PendingInputPump } from '@/agent/deepchat/runtime/pendingInputPump'
import { PromptAssemblyService } from '@/agent/deepchat/runtime/promptAssemblyService'
import { ProviderPermissionCoordinator } from '@/agent/deepchat/runtime/providerPermissionCoordinator'
import { RunLifecycleCoordinator } from '@/agent/deepchat/runtime/runLifecycleCoordinator'
import { RuntimeHookSink } from '@/agent/deepchat/runtime/runtimeHookSink'
import { SessionIdentityService } from '@/agent/deepchat/runtime/sessionIdentityService'
import { SessionLifecycleCoordinator } from '@/agent/deepchat/runtime/sessionLifecycleCoordinator'
import { SessionSettingsCoordinator } from '@/agent/deepchat/runtime/sessionSettingsCoordinator'
import { SessionStateResolver } from '@/agent/deepchat/runtime/sessionStateResolver'
import { SessionStatusPublisher } from '@/agent/deepchat/runtime/sessionStatusPublisher'
import {
  createToolExecutionPort,
  createToolResultPort
} from '@/agent/deepchat/runtime/toolAdapters'
import { DeepChatToolResolver } from '@/agent/deepchat/runtime/toolResolver'
import { ToolOutputGuard } from '@/agent/deepchat/runtime/toolOutputGuard'
import { resolveAgentOutputLimits } from '@shared/lib/agentOutputLimits'
import {
  createToolPermissionReviewer,
  createToolResultNormalizer,
  type ToolRuntimeBindingDependencies
} from '@/agent/deepchat/runtime/toolRuntimeBindings'
import { TranscriptMutationCoordinator } from '@/agent/deepchat/runtime/transcriptMutationCoordinator'
import { TurnCoordinator } from '@/agent/deepchat/runtime/turnCoordinator'
import { DeepChatAgentHarness } from './deepChatAgentHarness'
import type { DeepChatHarnessDependencies, DeepChatRuntimeServices } from './runtimeServices'
import { createPendingInputWakeupBinding } from './pendingInputWakeupBinding'
import type {
  ExecutionRecoveryClassification,
  ExecutionRecoveryReport
} from '@/tape/domain/executionJournal'
import type { ExecutionJournalRecoveryReader } from '@/tape/ports/capabilities'

const MAX_STARTUP_RECOVERY_DETAILS = 100
const MAX_STARTUP_RECOVERY_DIAGNOSTIC_CHARS = 2_048
const STARTUP_RECOVERY_TRUNCATION_MARKER = '...[truncated]'

function requiresStartupRecoveryAttention(report: ExecutionRecoveryReport): boolean {
  return (
    report.classification === 'indeterminate' ||
    report.classification === 'corruption' ||
    report.terminalOutcome === null
  )
}

function boundStartupRecoveryDiagnostic(value: string): string {
  let sanitized = ''
  for (
    let index = 0;
    index < value.length && index < MAX_STARTUP_RECOVERY_DIAGNOSTIC_CHARS;
    index += 1
  ) {
    const codeUnit = value.charCodeAt(index)
    sanitized += codeUnit <= 0x1f || codeUnit === 0x7f ? ' ' : value[index]
  }
  if (value.length <= MAX_STARTUP_RECOVERY_DIAGNOSTIC_CHARS) return sanitized

  const prefixLength =
    MAX_STARTUP_RECOVERY_DIAGNOSTIC_CHARS - STARTUP_RECOVERY_TRUNCATION_MARKER.length
  let prefix = sanitized.slice(0, prefixLength)
  const finalCodeUnit = prefix.charCodeAt(prefix.length - 1)
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) prefix = prefix.slice(0, -1)
  return `${prefix}${STARTUP_RECOVERY_TRUNCATION_MARKER}`
}

function buildStartupRecoveryDiagnostic(report: ExecutionRecoveryReport) {
  return {
    ...report,
    sessionId: boundStartupRecoveryDiagnostic(report.sessionId),
    runId: boundStartupRecoveryDiagnostic(report.runId),
    messageId: report.messageId === null ? null : boundStartupRecoveryDiagnostic(report.messageId),
    reasons: report.reasons.map(boundStartupRecoveryDiagnostic),
    disposition: 'parked' as const,
    automaticRetry: false as const
  }
}

function reportStartupExecutionRecovery(
  reader: ExecutionJournalRecoveryReader
): Map<string, Set<string>> {
  const buckets: Record<ExecutionRecoveryClassification, ExecutionRecoveryReport[]> = {
    corruption: [],
    indeterminate: [],
    completed: [],
    not_dispatched: []
  }
  const forceRecoverMessagesBySession = new Map<string, Set<string>>()
  for (const report of reader.classifyRecoveryCandidates()) {
    if (!requiresStartupRecoveryAttention(report)) continue
    buckets[report.classification].push(report)
    if (report.classification !== 'not_dispatched' && report.messageId !== null) {
      const messageIds = forceRecoverMessagesBySession.get(report.sessionId) ?? new Set<string>()
      messageIds.add(report.messageId)
      forceRecoverMessagesBySession.set(report.sessionId, messageIds)
    }
  }
  const candidates = [
    ...buckets.corruption,
    ...buckets.indeterminate,
    ...buckets.completed,
    ...buckets.not_dispatched
  ]
  for (const report of candidates.slice(0, MAX_STARTUP_RECOVERY_DETAILS)) {
    const diagnostic = buildStartupRecoveryDiagnostic(report)
    if (report.classification === 'corruption') {
      logger.error('[DeepChatAgent] Execution Journal recovery candidate parked', diagnostic)
    } else {
      logger.warn('[DeepChatAgent] Execution Journal recovery candidate parked', diagnostic)
    }
  }
  if (candidates.length <= MAX_STARTUP_RECOVERY_DETAILS) return forceRecoverMessagesBySession

  const classificationCounts: Record<ExecutionRecoveryClassification, number> = {
    not_dispatched: 0,
    completed: 0,
    indeterminate: 0,
    corruption: 0
  }
  for (const report of candidates) classificationCounts[report.classification] += 1
  const summary = {
    candidateCount: candidates.length,
    reportedCount: MAX_STARTUP_RECOVERY_DETAILS,
    omittedCount: candidates.length - MAX_STARTUP_RECOVERY_DETAILS,
    classificationCounts,
    disposition: 'parked' as const,
    automaticRetry: false as const
  }
  if (classificationCounts.corruption > 0) {
    logger.error('[DeepChatAgent] Execution Journal recovery diagnostics truncated', summary)
  } else {
    logger.warn('[DeepChatAgent] Execution Journal recovery diagnostics truncated', summary)
  }
  return forceRecoverMessagesBySession
}

/**
 * Single composition root for the DeepChat agent runtime. Owners are constructed in dependency
 * order; the only deferred wiring is the run-settlement to pending-input-pump feedback loop.
 */
function createDeepChatRuntimeServices(deps: DeepChatHarnessDependencies): DeepChatRuntimeServices {
  const {
    agentSettings,
    attachmentRouter,
    cacheImage,
    commandShell,
    database,
    diagnosticNow,
    hookObserver,
    providerRuntime,
    providerSettings,
    publishEvent,
    publishSessionUpdate,
    runJournalObserver,
    sessionData,
    sessionPermissionPort,
    skillService,
    skillSettings,
    toolService,
    traceSettings
  } = deps
  const sessionStore = sessionData.settings
  const messageStore = sessionData.transcript
  const tapeService = sessionData.tapeStore
  const pendingInputCoordinator = sessionData.pendingInputs

  const forceRecoverMessagesBySession = reportStartupExecutionRecovery(tapeService)

  const runtime = new DeepChatAgentRuntime()
  const identity = new SessionIdentityService({ registry: runtime, database })
  const messageProjection = new MessageProjectionService({
    registry: runtime,
    transcript: messageStore,
    publishEvent,
    publishSessionUpdate
  })
  const toolResolver = new DeepChatToolResolver({
    agentSettings,
    skillSettings,
    sqlitePresenter: database,
    toolService,
    skillService,
    registry: runtime,
    identity
  })
  const memory = new MemoryRuntimeCoordinator({
    memoryPort: deps.memoryPort,
    registry: runtime,
    identity,
    getNextMessageOrderSeq: (sessionId) => messageStore.getNextOrderSeq(sessionId),
    getMessagesUpToOrderSeq: (sessionId, orderSeq) =>
      messageStore.getMessagesUpToOrderSeq(sessionId, orderSeq),
    getMemoryCursorOrderSeq: (sessionId) =>
      database.deepchatSessionsTable.getMemoryCursorOrderSeq(sessionId),
    updateMemoryCursorOrderSeq: (sessionId, orderSeq) =>
      database.deepchatSessionsTable.updateMemoryCursorOrderSeq(sessionId, orderSeq),
    rewindMemoryCursorOrderSeq: (sessionId, orderSeq) =>
      database.deepchatSessionsTable.rewindMemoryCursorOrderSeq(sessionId, orderSeq),
    tapeReader: tapeService,
    tapeAnchorWriter: tapeService,
    getIngestionProjection: deps.getMemoryIngestionProjection
  })
  const sessionSettings = new SessionSettingsCoordinator({
    providerSettings,
    promptSettings: deps.promptSettings,
    sessionStore,
    toolResolver,
    toolService,
    sessionPermissionPort,
    registry: runtime,
    identity,
    beginSessionAgentReassignment: async (sessionId) =>
      await memory.beginSessionAgentReassignment(sessionId),
    finishSessionAgentReassignment: (sessionId) => memory.finishSessionAgentReassignment(sessionId),
    readPersistedProjectDir: (sessionId) => database.newSessionsTable?.get(sessionId)?.project_dir
  })
  const promptAssembly = new PromptAssemblyService({
    registry: runtime,
    providerSettings,
    skillSettings,
    skillService,
    providerCatalogPort: deps.providerCatalogPort,
    toolService,
    identity,
    orchestrationPolicy: toolResolver,
    projectDir: sessionSettings,
    memoryPromptContributor: memory
  })
  const hookSink = new RuntimeHookSink({ observer: hookObserver, identity, sessionSettings })
  const pendingInputWakeup = createPendingInputWakeupBinding()
  const runLifecycle = new RunLifecycleCoordinator({
    runtime,
    statusPublisher: new SessionStatusPublisher({
      publishEvent,
      publishSessionUpdate,
      sessionUiPort: deps.sessionUiPort
    }),
    transcript: messageStore,
    messageProjection,
    terminalObserver: hookSink,
    pendingInputWakeup: pendingInputWakeup.wakeup
  })
  const sessionState = new SessionStateResolver({
    registry: runtime,
    sessionStore,
    runLifecycle,
    identity,
    sessionSettings
  })
  const providerPermissionCoordinator = new ProviderPermissionCoordinator({
    publishEvent,
    messageStore,
    runLifecycle,
    permissionPort: deps.acpAsLlmProviderPermission,
    messageProjection
  })
  const compactionService = new CompactionService(
    sessionStore,
    messageStore,
    providerRuntime,
    providerSettings,
    async (sessionId) =>
      await agentSettings.resolveDeepChatAgentConfig(identity.getAgentId(sessionId) ?? 'deepchat')
  )
  const compaction = new CompactionRuntimeCoordinator({
    publishEvent,
    compactionService,
    sessionStore,
    messageStore,
    providerSettings,
    toolResolver,
    runLifecycle,
    sessionSettings,
    tapeReconciliation: tapeService,
    registry: runtime,
    sessionState,
    promptAssembly,
    commandShell,
    messageProjection
  })
  const interactionParking = new InteractionParkingRegistry()
  const sessionLifecycle = new SessionLifecycleCoordinator({
    registry: runtime,
    providerSettings,
    promptSettings: deps.promptSettings,
    sessionStore,
    transcript: messageStore,
    pendingInputs: pendingInputCoordinator,
    toolService,
    identity,
    sessionSettings,
    compaction,
    memory,
    runLifecycle,
    interactionParking
  })
  const toolRuntimeBindings: ToolRuntimeBindingDependencies = {
    providerSettings,
    agentSettings,
    providerRuntime,
    registry: runtime,
    sessionStore,
    identity,
    runLifecycle
  }
  const toolOutputGuard = new ToolOutputGuard(async (sessionId) =>
    resolveAgentOutputLimits(
      await agentSettings.resolveDeepChatAgentConfig(identity.getAgentId(sessionId) ?? 'deepchat')
    )
  )
  const toolExecutionPort = createToolExecutionPort(toolService)
  const toolResultPort = createToolResultPort({
    outputGuard: toolOutputGuard,
    normalize: createToolResultNormalizer(toolRuntimeBindings)
  })
  const deferredToolExecutor = new DeferredToolExecutor({
    toolExecutionPort,
    toolResultPort,
    toolResolver,
    cacheImage,
    runLifecycle,
    sessionSettings,
    sessionState,
    identity,
    messageProjection,
    commandShell,
    executionJournal: tapeService,
    runJournalObserver,
    diagnosticNow
  })
  const inputPreparationCoordinator = new InputPreparationCoordinator()
  const contextCoordinator = new DeepChatContextCoordinator()
  const loopRunner = new DeepChatLoopRunner({
    publishEvent,
    publishSessionUpdate,
    providerRuntime,
    providerSettings,
    traceSettings,
    sessionStore,
    messageStore,
    tape: tapeService,
    pendingInputCoordinator,
    toolResolver,
    providerPermissionCoordinator,
    compactionService,
    inputPreparationCoordinator,
    contextCoordinator,
    memoryIngestionObserver: memory,
    toolExecutionPort,
    toolResultPort,
    cacheImage,
    runLifecycle,
    registry: runtime,
    sessionSettings,
    promptAssembly,
    identity,
    sessionPermissionPort,
    reviewToolPermission: createToolPermissionReviewer(toolRuntimeBindings),
    hookSink,
    compaction,
    runJournalObserver,
    diagnosticNow
  })
  const turnCoordinator = new TurnCoordinator({
    publishEvent,
    providerSettings,
    traceSettings,
    toolService,
    sessionStore,
    messageStore,
    pendingInputs: pendingInputCoordinator,
    tapeReconciliation: tapeService,
    toolResolver,
    compactionService,
    compactionRuntimeCoordinator: compaction,
    inputPreparationCoordinator,
    contextCoordinator,
    memoryCoordinator: memory,
    memoryIngestionObserver: memory,
    postCompactionPromptAssembler: promptAssembly.createPostCompactionPromptAssembler(),
    toolOutputGuard,
    runLifecycle,
    registry: runtime,
    attachmentRouter,
    sessionSettings,
    promptAssembly,
    identity,
    taskContractContext: deps.taskContractContext,
    commandShell,
    loopRunner,
    messageProjection,
    hookSink
  })
  const pendingInputPump = new PendingInputPump({
    pendingInputs: pendingInputCoordinator,
    transcript: messageStore,
    runLifecycle,
    turnStarter: turnCoordinator,
    // Steer merging depends on an in-flight steerActiveTurn reaching the steer marker before a
    // settlement-triggered drain adopts the claim, and that window is currently defined only by
    // this read's async depth. The extra boundary is kept until the race is closed properly.
    sessionState: { get: async (sessionId) => await sessionState.get(sessionId) },
    sessionSettings
  })
  pendingInputWakeup.bind(pendingInputPump)
  const pendingInputAdmission = new PendingInputAdmissionCoordinator({
    providerSettings,
    pendingInputs: pendingInputCoordinator,
    pump: pendingInputPump,
    transcript: messageStore,
    attachmentRouter,
    sessionState,
    registry: runtime,
    sessionSettings
  })
  const interactionCoordinator = new InteractionCoordinator({
    publishEvent,
    messageStore,
    providerPermissionCoordinator,
    skillService,
    runLifecycle,
    registry: runtime,
    sessionPermissionPort,
    deferredToolExecutor,
    messageProjection,
    hookSink,
    turnCoordinator,
    continuationAdmission: deps.interactionContinuationAdmission,
    interactionParking,
    viewManifests: tapeService
  })
  const transcriptMutation = new TranscriptMutationCoordinator({
    registry: runtime,
    sessionState,
    sessionSettings,
    admission: pendingInputAdmission,
    compaction,
    memory,
    runLifecycle
  })

  const acpCompatibility: AcpAgentInstanceDependencyFactory = (input) =>
    createAcpCompatibilityDependencies(
      {
        publishEvent,
        publishSessionUpdate,
        providerSettings,
        traceSettings,
        providerRuntime,
        sessionStore,
        messageStore,
        tapeReconciliation: tapeService,
        toolResolver,
        appendViewManifest: (manifest) =>
          loopRunner.appendTapeViewManifest({
            sessionId: manifest.sessionId,
            messageId: manifest.messageId,
            requestSeq: manifest.requestSeq,
            taskType: manifest.taskType,
            policy: manifest.policy,
            policyVersion: manifest.policyVersion,
            contextBuilderVersion: 'legacy-v1',
            messages: manifest.messages,
            tools: manifest.localToolDefinitions,
            tokenBudget: manifest.tokenBudget,
            providerId: manifest.providerId,
            modelId: manifest.modelId,
            summaryCursorOrderSeq: manifest.summaryCursorOrderSeq,
            supportsVision: manifest.supportsVision,
            supportsAudioInput: manifest.supportsAudioInput,
            traceDebugEnabled: manifest.traceDebugEnabled
          }),
        setStatus: (sessionId, status) => runLifecycle.transitionCurrentStatus(sessionId, status),
        getSessionState: async (sessionId) => await sessionState.get(sessionId),
        getDeepChatInstance: (sessionId) =>
          runtime.getOrHydrateScope(toAppSessionId(sessionId)).instance,
        getGenerationSettings: async (sessionId, instance) =>
          await sessionSettings.getEffectiveGenerationSettings(sessionId, instance),
        buildSystemPrompt: async (sessionId, basePrompt, tools, activeSkills, instance) =>
          await promptAssembly.build(
            sessionId,
            basePrompt,
            tools,
            await commandShell.resolveForTurn(),
            activeSkills,
            instance
          ),
        emitRateLimitWaitingMessage: (sessionId, messageId, requestId, snapshot) =>
          loopRunner.emitRateLimitWaitingMessage(sessionId, messageId, requestId, snapshot),
        clearRateLimitWaitingMessage: (sessionId, messageId, requestId) =>
          loopRunner.clearRateLimitWaitingMessage(sessionId, messageId, requestId),
        hookSink
      },
      input
    )

  const pendingInputRecovery = pendingInputCoordinator.recoverInputsAfterRestart()
  pendingInputPump.holdRestartedQueueInputs(pendingInputRecovery.heldQueueInputIds)
  if (pendingInputRecovery.affectedSessionIds.size > 0) {
    logger.info(
      `DeepChatAgent: reconciled ${pendingInputRecovery.affectedSessionIds.size} sessions with pending inputs`
    )
  }

  const recovered = messageStore.recoverPendingMessages({ forceRecoverMessagesBySession })
  if (recovered > 0) {
    logger.info(`DeepChatAgent: recovered ${recovered} pending messages to error status`)
  }

  return {
    runtime,
    sessionLifecycle,
    sessionState,
    sessionSettings,
    runLifecycle,
    turnCoordinator,
    interactionCoordinator,
    pendingInputAdmission,
    compaction,
    transcriptMutation,
    memoryIngestionObserver: memory,
    acpCompatibility
  }
}

export function createDeepChatAgentHarness(
  deps: DeepChatHarnessDependencies
): DeepChatAgentHarness {
  return new DeepChatAgentHarness(createDeepChatRuntimeServices(deps))
}
