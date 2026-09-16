import type { PluginContextPort } from '@shared/types/userPlugin'
import type { ProviderExecutionPort } from '@shared/types/provider'
import type { SkillMetadataSnapshotPort, SkillServicePort } from '@shared/types/skill'
import type { ToolServicePort } from '@shared/types/tool'

import type { HookObserver } from '@/hook/observer'
import type { MemoryRuntimePort } from '@/memory/injection'

import type { AcpAsLlmProviderPermissionPort, ProviderCatalogPort } from '@/provider/ports'

import type { SessionData } from '@/session/data'
import type { SessionDatabase } from '@/session/data/database'

import type { AcpAgentInstanceDependencyFactory } from '@/agent/acp/instance'
import type { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'

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
import type {
  DeepChatEventPublisher,
  DeepChatSessionUpdatePublisher,
  RunJournalObserver,
  SessionInvalidationPort
} from '@/agent/deepchat/runtime/types'
import type { MonotonicClock } from '@/lib/monotonicTime'
import type { ToolSurfaceShadowDiagnosticsRegistry } from '@/agent/deepchat/runtime/toolSurfaceDiagnostics'
import type { ToolSurfaceCanaryDiagnosticsRegistry } from '@/agent/deepchat/runtime/toolSurfaceCanaryDiagnostics'
import type { DeepChatTaskContractContextPort } from '@/agent/deepchat/loop/ports'
import type { ToolSurfaceRunModePort } from '@/agent/deepchat/runtime/deepChatLoopRunner'
import { type AgentSettingsPort } from '@/agent/deepchat/contracts/agentSettings'
import { type AgentTraceSettingsPort } from '@/agent/deepchat/contracts/agentTraceSettings'
import { type PromptSettingsPort } from '@/agent/deepchat/contracts/promptSettings'
import { type AttachmentPreparationPort } from '@/agent/deepchat/contracts/attachmentPreparation'
import { type ProviderModelResolutionPort } from '@/agent/deepchat/contracts/providerModelResolution'
import { type SessionPermissionPort } from '@/agent/deepchat/contracts/sessionPermission'
import { type SkillSettingsPort } from '@/agent/deepchat/contracts/skillSettings'
import { type CacheImageOptions } from '@/agent/deepchat/contracts/imagePreview'
import { type CommandShellResolutionPort } from '@/agent/deepchat/contracts/commandShellResolution'
import {
  type ProgrammaticToolAuthorityPort,
  type ProgrammaticGrantAuthorityPort
} from '@/agent/deepchat/contracts/programmaticToolAuthority'

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
  database: SessionDatabase
  sessionData: SessionData
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
  skillService: DeepChatHarnessSkillPort
  skillSettings: SkillSettingsPort
  traceSettings: AgentTraceSettingsPort
  promptSettings: PromptSettingsPort
  attachmentRouter: AttachmentPreparationPort
  interactionContinuationAdmission: InteractionContinuationAdmissionPort
  taskContractContext: DeepChatTaskContractContextPort
  commandShell: CommandShellResolutionPort
  /** Internal rollout seam. Production remains on the legacy path unless explicitly assigned. */
  toolSurfaceRunMode?: ToolSurfaceRunModePort
  /** Process-live causality owner. It never reconstructs dispatch authority from Tape. */
  programmaticToolParents?: ProgrammaticToolAuthorityPort
  /** Shared local-control authority for inert exact-operation grants and Run-scoped revocation. */
  agentCliTokenAuthority: ProgrammaticGrantAuthorityPort
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
  acpCompatibility: AcpAgentInstanceDependencyFactory
  reconcileAfterDatabaseReopen(): void
}
