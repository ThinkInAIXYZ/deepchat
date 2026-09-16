import logger from '../shared/logger.js'
import { DeepChatAgentRuntime } from '../instance/deepChatAgentRuntime.js'
import { DeepChatContextCoordinator } from '../loop/contextCoordinator.js'
import { InputPreparationCoordinator } from '../loop/inputPreparationCoordinator.js'
import { MemoryRuntimeCoordinator } from '../memory/memoryRuntimeCoordinator.js'
import { CompactionRuntimeCoordinator } from '../runtime/compactionRuntimeCoordinator.js'
import { CompactionService } from '../runtime/compactionService.js'
import { DeepChatLoopRunner } from '../runtime/deepChatLoopRunner.js'
import { DeferredToolExecutor } from '../runtime/deferredToolExecutor.js'
import { InteractionCoordinator } from '../runtime/interactionCoordinator.js'
import { InteractionParkingRegistry } from '../runtime/interactionParkingRegistry.js'
import { MessageProjectionService } from '../runtime/messageProjectionService.js'
import { PendingInputAdmissionCoordinator } from '../runtime/pendingInputAdmissionCoordinator.js'
import { PendingInputPump } from '../runtime/pendingInputPump.js'
import { PromptAssemblyService } from '../runtime/promptAssemblyService.js'
import { ProviderPermissionCoordinator } from '../runtime/providerPermissionCoordinator.js'
import { RunLifecycleCoordinator } from '../runtime/runLifecycleCoordinator.js'
import { RuntimeHookSink } from '../runtime/runtimeHookSink.js'
import { SessionIdentityService } from '../runtime/sessionIdentityService.js'
import { SessionLifecycleCoordinator } from '../runtime/sessionLifecycleCoordinator.js'
import { SessionSettingsCoordinator } from '../runtime/sessionSettingsCoordinator.js'
import { ContextOccupancyCoordinator } from '../runtime/contextOccupancyCoordinator.js'
import { SessionStateResolver } from '../runtime/sessionStateResolver.js'
import { SessionStatusPublisher } from '../runtime/sessionStatusPublisher.js'
import { SkillContextMaterializer } from '../runtime/skillContextMaterializer.js'
import { createToolExecutionPort, createToolResultPort } from '../runtime/toolAdapters.js'
import { DeepChatToolResolver } from '../runtime/toolResolver.js'
import { ToolOutputGuard } from '../runtime/toolOutputGuard.js'
import { ToolSurfaceShadowDiagnosticsRegistry } from '../runtime/toolSurfaceDiagnostics.js'
import { ToolSurfaceCanaryDiagnosticsRegistry } from '../runtime/toolSurfaceCanaryDiagnostics.js'
import { resolveAgentOutputLimits } from '../shared/lib/agentOutputLimits.js'
import {
  createToolPermissionReviewer,
  createToolResultNormalizer,
  type ToolRuntimeBindingDependencies
} from '../runtime/toolRuntimeBindings.js'
import { TranscriptMutationCoordinator } from '../runtime/transcriptMutationCoordinator.js'
import { TurnCoordinator } from '../runtime/turnCoordinator.js'
import type {
  ExecutionRecoveryClassification,
  ExecutionRecoveryReport
} from '../tape/domain/executionJournal.js'
import type { ExecutionJournalRecoveryReader } from '../tape/ports/capabilities.js'
import {
  createDeepChatLoopTapePort,
  createSkillContextTapePort
} from '../tape/application/capabilityAdapters.js'
import { createPendingInputWakeupBinding } from './pendingInputWakeupBinding.js'
import type { MonotonicClock } from '../collab/lib/monotonicTime.js'
import type { PluginContextPort } from '../shared/types/userPlugin.js'
import type { ProviderExecutionPort } from '../shared/types/provider.js'
import type { SkillMetadataSnapshotPort, SkillServicePort } from '../shared/types/skill.js'
import type { ToolServicePort } from '../shared/types/tool.js'
import type { HookObserver } from '../collab/hook/observer.js'
import type { MemoryRuntimePort } from '../collab/memory/injection.js'
import type {
  AcpAsLlmProviderPermissionPort,
  ProviderCatalogPort
} from '../collab/provider/ports.js'
import type { MemoryIngestionObserver } from '../memory/memoryIngestionObserver.js'
import type { MemoryIngestionProjection } from '../memory/memoryRuntimeCoordinator.js'
import type { InteractionContinuationAdmissionPort } from '../runtime/interactionCoordinator.js'
import type {
  DeepChatEventPublisher,
  DeepChatSessionUpdatePublisher,
  RunJournalObserver,
  SessionInvalidationPort
} from '../runtime/types.js'
import type { DeepChatTaskContractContextPort } from '../loop/ports.js'
import type { ToolSurfaceRunModePort } from '../runtime/deepChatLoopRunner.js'
import type { AgentSettingsPort } from '../contracts/agentSettings.js'
import type { AgentTraceSettingsPort } from '../contracts/agentTraceSettings.js'
import type { PromptSettingsPort } from '../contracts/promptSettings.js'
import type { AttachmentPreparationPort } from '../contracts/attachmentPreparation.js'
import type { ProviderModelResolutionPort } from '../contracts/providerModelResolution.js'
import type { SessionPermissionPort } from '../contracts/sessionPermission.js'
import type { SkillSettingsPort } from '../contracts/skillSettings.js'
import type { CacheImageOptions, ToolImagePreviewPort } from '../contracts/imagePreview.js'
import type { CommandShellResolutionPort } from '../contracts/commandShellResolution.js'
import type { VisionTargetResolverPort } from '../contracts/visionTarget.js'
import type {
  ProgrammaticToolAuthorityPort,
  ProgrammaticGrantAuthorityPort
} from '../contracts/programmaticToolAuthority.js'
import type { SessionAgentRowPort } from '../contracts/sessionAgentRow.js'
import type { MemoryCursorStorePort } from '../contracts/memoryCursorStore.js'
import type { SessionSettingsStorePort } from '../contracts/sessionSettingsStore.js'
import type { TranscriptStorePort } from '../contracts/transcriptStore.js'
import type { PendingInputStorePort } from '../contracts/pendingInputStore.js'
import type {
  ExecutionJournalWriter,
  NestedExecutionJournalWriter
} from '../tape/ports/capabilities.js'
import type { TapeStorePort } from '../contracts/tapeStore.js'

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
  const finalCodeUnit = prefix.charCodeAt(prefixLength - 1)
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

export type DeepChatKernelSkillPort = Pick<
  SkillServicePort,
  | 'getMetadataList'
  | 'getAllSkills'
  | 'getActiveSkills'
  | 'snapshotPersistedActiveSkillNames'
  | 'resolveSessionAgentId'
  | 'setActiveSkills'
  | 'revalidateActiveSkillsForAgent'
  | 'validateSkillNames'
  | 'loadSkillContent'
  | 'resolveFreshEffectiveSkillContents'
  | 'viewDraftSkill'
  | 'installDraftSkill'
  | 'discardDraftSkill'
> &
  SkillMetadataSnapshotPort

/** Persisted session storage the kernel composition wires into its owners. */
export interface DeepChatKernelSessionData {
  settings: SessionSettingsStorePort
  transcript: TranscriptStorePort
  tapeStore: TapeStorePort
  pendingInputs: PendingInputStorePort
  programmaticExecutionJournal: Pick<ExecutionJournalWriter, 'commitToolOutcome'> &
    NestedExecutionJournalWriter
}

export interface DeepChatKernelDependencies {
  pluginContext?: PluginContextPort
  providerRuntime: ProviderExecutionPort
  providerSettings: ProviderModelResolutionPort
  agentSettings: AgentSettingsPort
  database: SessionAgentRowPort & { deepchatSessionsTable: MemoryCursorStorePort }
  sessionData: DeepChatKernelSessionData
  toolService: ToolServicePort
  hookObserver: HookObserver
  onSessionCompleted?: (sessionId: string) => void
  publishEvent: DeepChatEventPublisher
  publishSessionUpdate: DeepChatSessionUpdatePublisher
  providerCatalogPort: Pick<ProviderCatalogPort, 'getProviderModels' | 'getCustomModels'>
  sessionPermissionPort: SessionPermissionPort
  acpAsLlmProviderPermission: AcpAsLlmProviderPermissionPort
  sessionInvalidationPort: SessionInvalidationPort
  memoryPort: MemoryRuntimePort
  getMemoryIngestionProjection(): MemoryIngestionProjection
  cacheImage(data: string, options?: CacheImageOptions): Promise<string>
  skillService: DeepChatKernelSkillPort
  skillSettings: SkillSettingsPort
  traceSettings: AgentTraceSettingsPort
  promptSettings: PromptSettingsPort
  attachmentRouter: AttachmentPreparationPort
  interactionContinuationAdmission: InteractionContinuationAdmissionPort
  taskContractContext: DeepChatTaskContractContextPort
  commandShell: CommandShellResolutionPort
  /** Session vision resolution is host-owned; the kernel reaches it through this port. */
  visionTargetResolver: VisionTargetResolverPort
  /** Tool-call image preview pipeline is host-owned; the kernel reaches it through this port. */
  imagePreviews: ToolImagePreviewPort
  /** Internal rollout seam. Production remains on the legacy path unless explicitly assigned. */
  toolSurfaceRunMode?: ToolSurfaceRunModePort
  /** Process-live causality owner. It never reconstructs dispatch authority from Tape. */
  programmaticToolParents: ProgrammaticToolAuthorityPort
  /** Shared local-control authority for inert exact-operation grants and Run-scoped revocation. */
  agentCliTokenAuthority: ProgrammaticGrantAuthorityPort
  runJournalObserver?: RunJournalObserver
  diagnosticNow?: MonotonicClock
}

/**
 * Owners the kernel composition produces. The host harness wraps this graph with its ACP
 * compatibility assembly; collaborators such as the loop runner and prompt assembly stay exposed
 * so host-side adapters can reuse the same owners instead of building a second runtime.
 */
export interface DeepChatKernelServices {
  runtime: DeepChatAgentRuntime
  sessionLifecycle: SessionLifecycleCoordinator
  sessionState: SessionStateResolver
  sessionSettings: SessionSettingsCoordinator
  runLifecycle: RunLifecycleCoordinator
  turnCoordinator: TurnCoordinator
  interactionCoordinator: InteractionCoordinator
  pendingInputAdmission: PendingInputAdmissionCoordinator
  compaction: CompactionRuntimeCoordinator
  contextOccupancy: ContextOccupancyCoordinator
  transcriptMutation: TranscriptMutationCoordinator
  memoryIngestionObserver: MemoryIngestionObserver
  toolSurfaceDiagnostics: ToolSurfaceShadowDiagnosticsRegistry
  toolSurfaceCanaryDiagnostics: ToolSurfaceCanaryDiagnosticsRegistry
  loopRunner: DeepChatLoopRunner
  promptAssembly: PromptAssemblyService
  hookSink: RuntimeHookSink
  toolResolver: DeepChatToolResolver
  reconcileAfterDatabaseReopen(): void
}

/**
 * Kernel composition root for the DeepChat agent runtime. Owners are constructed in dependency
 * order; the only deferred wiring is the run-settlement to pending-input-pump feedback loop.
 * Restart recovery runs once here; callers must not build a second composition for the same
 * session storage.
 */
export function createDeepChatRuntimeServices(
  deps: DeepChatKernelDependencies
): DeepChatKernelServices {
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
    memoryCursor: {
      getMemoryCursorOrderSeq: (sessionId) =>
        database.deepchatSessionsTable.getMemoryCursorOrderSeq(sessionId),
      updateMemoryCursorOrderSeq: (sessionId, orderSeq) =>
        database.deepchatSessionsTable.updateMemoryCursorOrderSeq(sessionId, orderSeq),
      rewindMemoryCursorOrderSeq: (sessionId, orderSeq) =>
        database.deepchatSessionsTable.rewindMemoryCursorOrderSeq(sessionId, orderSeq)
    },
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
  const hookSink = new RuntimeHookSink({
    observer: hookObserver,
    identity,
    sessionSettings,
    onSessionCompleted: deps.onSessionCompleted
  })
  const pendingInputWakeup = createPendingInputWakeupBinding()
  const runLifecycle = new RunLifecycleCoordinator({
    runtime,
    statusPublisher: new SessionStatusPublisher({
      publishEvent,
      publishSessionUpdate,
      sessionInvalidationPort: deps.sessionInvalidationPort
    }),
    transcript: messageStore,
    messageProjection,
    terminalObserver: hookSink,
    pendingInputWakeup: pendingInputWakeup.wakeup,
    programmaticAuthority: deps.agentCliTokenAuthority
  })
  const sessionState = new SessionStateResolver({
    registry: runtime,
    sessionStore,
    runLifecycle,
    identity,
    sessionSettings
  })
  const contextOccupancy = new ContextOccupancyCoordinator({
    runtime,
    sessionState,
    sessionSettings,
    tape: tapeService
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
    pluginContext: deps.pluginContext,
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
  const toolSurfaceDiagnostics = new ToolSurfaceShadowDiagnosticsRegistry()
  const toolSurfaceCanaryDiagnostics = new ToolSurfaceCanaryDiagnosticsRegistry()
  const programmaticToolParents = deps.programmaticToolParents
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
    interactionParking,
    toolSurfaceDiagnostics,
    toolSurfaceCanaryDiagnostics,
    programmaticToolParents
  })
  const toolRuntimeBindings: ToolRuntimeBindingDependencies = {
    providerSettings,
    visionTargetResolver: deps.visionTargetResolver,
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
  const toolImagePreviews = deps.imagePreviews
  const deferredToolExecutor = new DeferredToolExecutor({
    toolExecutionPort,
    toolResultPort,
    toolResolver,
    cacheImage,
    imagePreviews: toolImagePreviews,
    runLifecycle,
    sessionSettings,
    sessionState,
    identity,
    messageProjection,
    commandShell,
    executionJournal: tapeService,
    programmaticToolParents,
    runJournalObserver,
    diagnosticNow
  })
  const inputPreparationCoordinator = new InputPreparationCoordinator()
  const contextCoordinator = new DeepChatContextCoordinator()
  const skillContextMaterializer = new SkillContextMaterializer({
    skills: deps.skillService,
    tape: createSkillContextTapePort(tapeService)
  })
  const loopRunner = new DeepChatLoopRunner({
    pluginContext: deps.pluginContext,
    publishEvent,
    publishSessionUpdate,
    providerRuntime,
    providerSettings,
    traceSettings,
    sessionStore,
    messageStore,
    tape: createDeepChatLoopTapePort(tapeService, sessionData.programmaticExecutionJournal),
    pendingInputCoordinator,
    toolResolver,
    providerPermissionCoordinator,
    compactionService,
    inputPreparationCoordinator,
    contextCoordinator,
    toolSurfaceDiagnostics,
    toolSurfaceCanaryDiagnostics,
    toolSurfaceRunMode: deps.toolSurfaceRunMode,
    programmaticToolParents,
    memoryIngestionObserver: memory,
    toolExecutionPort,
    toolResultPort,
    cacheImage,
    imagePreviews: toolImagePreviews,
    runLifecycle,
    registry: runtime,
    sessionSettings,
    promptAssembly,
    skillContextMaterializer,
    identity,
    sessionPermissionPort,
    reviewToolPermission: createToolPermissionReviewer(toolRuntimeBindings),
    hookSink,
    compaction,
    runJournalObserver,
    diagnosticNow
  })
  const turnCoordinator = new TurnCoordinator({
    pluginContext: deps.pluginContext,
    publishEvent,
    providerRuntime,
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
    skillContextMaterializer,
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
    executionJournal: tapeService,
    viewManifests: tapeService,
    toolSurfaces: tapeService
  })
  const transcriptMutation = new TranscriptMutationCoordinator({
    registry: runtime,
    sessionState,
    sessionSettings,
    admission: pendingInputAdmission,
    compaction,
    memory,
    runLifecycle,
    toolSurfaceDiagnostics
  })

  const reconcilePersistedRuntimeState = (): void => {
    const forceRecoverMessagesBySession = reportStartupExecutionRecovery(tapeService)
    const pendingInputRecovery = pendingInputCoordinator.recoverInputsAfterRestart()
    pendingInputPump.replaceRestartedQueueInputs(pendingInputRecovery.heldQueueInputIds)
    if (pendingInputRecovery.affectedSessionIds.size > 0) {
      logger.info(
        `DeepChatAgent: reconciled ${pendingInputRecovery.affectedSessionIds.size} sessions with pending inputs`
      )
    }

    const compactionRecovery = messageStore.reconcileCompactionMessages()
    if (
      compactionRecovery.compacted > 0 ||
      compactionRecovery.retracted > 0 ||
      compactionRecovery.failed > 0
    ) {
      logger.info(
        `DeepChatAgent: reconciled ${compactionRecovery.compacted} committed, ${compactionRecovery.retracted} stale, and ${compactionRecovery.failed} failed compaction markers`
      )
    }

    const recovered = messageStore.recoverPendingMessages({ forceRecoverMessagesBySession })
    if (recovered > 0) {
      logger.info(`DeepChatAgent: recovered ${recovered} pending messages to error status`)
    }
  }
  reconcilePersistedRuntimeState()

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
    contextOccupancy,
    transcriptMutation,
    memoryIngestionObserver: memory,
    toolSurfaceDiagnostics,
    toolSurfaceCanaryDiagnostics,
    loopRunner,
    promptAssembly,
    hookSink,
    toolResolver,
    reconcileAfterDatabaseReopen: reconcilePersistedRuntimeState
  }
}
