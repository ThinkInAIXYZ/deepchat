import type { PluginContextPort } from '@shared/types/userPlugin'
import type { ProviderExecutionPort } from '@shared/types/provider'
import type { ToolServicePort } from '@shared/types/tool'

import type { HookObserver } from '@/hook/observer'
import type { MemoryRuntimePort } from '@/memory/injection'

import type { AcpAsLlmProviderPermissionPort, ProviderCatalogPort } from '@/provider/ports'

import type { SessionData } from '@/session/data'
import type { SessionDatabase } from '@/session/data/database'

import type { AcpAgentInstanceDependencyFactory } from '@/agent/acp/instance'

import type { MemoryIngestionProjection } from '@/agent/deepchat/memory/memoryRuntimeCoordinator'
import type { InteractionContinuationAdmissionPort } from '@/agent/deepchat/runtime/interactionCoordinator'
import type { DeepChatTaskContractContextPort } from '@/agent/deepchat/loop/ports'
import type { ToolSurfaceRunModePort } from '@/agent/deepchat/runtime/deepChatLoopRunner'
import type {
  DeepChatEventPublisher,
  DeepChatSessionUpdatePublisher,
  RunJournalObserver,
  SessionInvalidationPort
} from '@/agent/deepchat/runtime/types'
import type { MonotonicClock } from '@/lib/monotonicTime'
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
import type {
  DeepChatKernelServices,
  DeepChatKernelSkillPort
} from '@deepchat/agent-kernel/composition/createDeepChatRuntimeServices'

export type DeepChatHarnessSkillPort = DeepChatKernelSkillPort
export type { PendingLaneRetryOptions } from '@/session/transcriptMutations'

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
 * Owners the harness delegates to. The composed owner graph and its collaborators come from the
 * kernel package; the host adds the ACP compatibility assembly. This contract is package-private
 * so no caller can reach an owner around the harness.
 */
export type DeepChatRuntimeServices = DeepChatKernelServices & {
  acpCompatibility: AcpAgentInstanceDependencyFactory
}
