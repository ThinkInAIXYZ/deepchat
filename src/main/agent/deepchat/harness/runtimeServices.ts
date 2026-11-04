import type { SkillContextTapePort } from '@/tape/application/capabilityAdapters'
import type { DeepChatOutputPort } from '../runtime/output'
import type { PluginContextPort } from '@shared/types/userPlugin'
import type { ProviderExecutionPort } from '@shared/types/provider'
import type { SkillMetadataSnapshotPort, SkillServicePort } from '@shared/types/skill'
import type { ToolServicePort } from '@shared/types/tool'
import type { AgentSettingsPort } from '@/agent/settings'
import type { AgentTraceSettingsPort } from '@/agent/traceSettings'
import type { PromptSettingsPort } from '@/agent/promptSettings'
import type { HookObserver } from '@/hook/observer'
import type { MemoryRuntimePort } from '@/memory/injection'
import type { AttachmentPreparationPort } from '@shared/types/attachment'
import type { AcpAsLlmProviderPermissionPort, ProviderCatalogPort } from '@/provider/ports'
import type { ProviderModelResolutionPort } from '@/provider/settings'
import type {
  SessionSettingsPort,
  SessionTranscriptPort,
  SessionPendingInputsPort
} from '@/session/data/contracts'
import type {
  DeepChatLoopTapePort,
  TapeAnchorReader,
  TapeAnchorWriter,
  TapeNonContextEntryReader,
  TapeContextOccupancyReader,
  ExecutionJournalRecoveryReader,
  TapeToolSurfaceViewReader,
  ExecutionJournalWriter,
  NestedExecutionJournalWriter
} from '@/tape/ports/capabilities'
import type { SessionPermissionPort } from '@/session/contracts'
import type { SessionStatusPublisherPorts } from '@/agent/deepchat/runtime/sessionStatusPublisher'
import type { SkillSettingsPort } from '@/skill/settings'
import type { CacheImageOptions } from '@shared/types/attachment'
import type { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import type { CommandShellPort } from '@shared/commandShell'
import type { MemoryIngestionObserver } from '@/agent/deepchat/memory/memoryIngestionObserver'
import type { MemoryIngestionProjection } from '@/agent/deepchat/memory/memoryRuntimeCoordinator'
import type { CompactionRuntimeCoordinator } from '@/agent/deepchat/runtime/compactionRuntimeCoordinator'
import type { ContextOccupancyCoordinator } from '@/agent/deepchat/runtime/contextOccupancyCoordinator'
import type {
  InteractionContinuationAdmissionPort,
  InteractionCoordinator
} from '@/agent/deepchat/runtime/interactionCoordinator'
import type { PendingInputAdmissionCoordinator } from '@/agent/deepchat/runtime/pendingInputAdmissionCoordinator'
import type { RunLifecycleCoordinator } from '@/agent/deepchat/runtime/runLifecycleCoordinator'
import type { SessionLifecycleCoordinator } from '@/agent/deepchat/runtime/sessionLifecycleCoordinator'
import type { SessionSettingsCoordinator } from '@/agent/deepchat/runtime/sessionSettingsCoordinator'
import type { SessionStateResolver } from '@/agent/deepchat/runtime/sessionStateResolver'
import type { TranscriptMutationCoordinator } from '@/agent/deepchat/runtime/transcriptMutationCoordinator'
import type { TurnCoordinator } from '@/agent/deepchat/runtime/turnCoordinator'
import type { RunJournalObserver } from '@/agent/deepchat/runtime/types'
import type { MonotonicClock } from '@/lib/monotonicTime'
import type { ToolSurfaceShadowDiagnosticsRegistry } from '@/agent/deepchat/runtime/toolSurfaceDiagnostics'
import type { ToolSurfaceCanaryDiagnosticsRegistry } from '@/agent/deepchat/runtime/toolSurfaceCanaryDiagnostics'
import type { DeepChatTaskContractContextPort } from '@/agent/deepchat/loop/ports'
import type { ToolSurfaceRunModePort } from '@/agent/deepchat/runtime/deepChatLoopRunner'
import type { ProgrammaticToolPort } from '@/agent/deepchat/runtime/programmaticExecParent'

export type DeepChatHarnessSkillPort = Pick<
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

export interface DeepChatHarnessDependencies {
  pluginContext?: PluginContextPort
  providerRuntime: ProviderExecutionPort
  providerSettings: ProviderModelResolutionPort
  agentSettings: AgentSettingsPort
  sessionSettings: SessionSettingsPort
  transcript: SessionTranscriptPort
  pendingInputs: SessionPendingInputsPort
  tape: Omit<DeepChatLoopTapePort, keyof NestedExecutionJournalWriter> &
    SkillContextTapePort &
    TapeAnchorReader &
    TapeAnchorWriter &
    TapeNonContextEntryReader &
    TapeContextOccupancyReader &
    ExecutionJournalRecoveryReader &
    TapeToolSurfaceViewReader
  programmaticExecutionJournal: Pick<ExecutionJournalWriter, 'commitToolOutcome'> &
    NestedExecutionJournalWriter
  toolService: ToolServicePort
  hookObserver: HookObserver
  onSessionCompleted?: (sessionId: string) => void
  output: DeepChatOutputPort
  providerCatalogPort: Pick<ProviderCatalogPort, 'getProviderModels' | 'getCustomModels'>
  sessionPermissionPort: SessionPermissionPort
  acpAsLlmProviderPermission: AcpAsLlmProviderPermissionPort
  publishStatus: SessionStatusPublisherPorts['publishStatus']
  memoryPort: MemoryRuntimePort
  getMemoryIngestionProjection(): MemoryIngestionProjection
  cacheImage(data: string, options?: CacheImageOptions): Promise<string>
  skillService: DeepChatHarnessSkillPort
  skillSettings: SkillSettingsPort
  traceSettings: AgentTraceSettingsPort
  promptSettings: PromptSettingsPort
  attachmentRouter: Pick<AttachmentPreparationPort, 'prepare'>
  interactionContinuationAdmission: InteractionContinuationAdmissionPort
  taskContractContext: DeepChatTaskContractContextPort
  commandShell: Pick<CommandShellPort, 'resolveForTurn' | 'resolveProfile'>
  /** Internal rollout seam. Production remains on the legacy path unless explicitly assigned. */
  toolSurfaceRunMode?: ToolSurfaceRunModePort
  /** The host owns exact-operation grants and process-live settlement authority. */
  programmaticTools: ProgrammaticToolPort
  runJournalObserver?: RunJournalObserver
  diagnosticNow?: MonotonicClock
}

/**
 * Owners the harness delegates to. Internal collaborators stay inside the composition, and this
 * contract is package-private so no caller can reach an owner around the harness.
 */
export interface DeepChatRuntimeServices {
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
  reconcileAfterDatabaseReopen(): void
}
