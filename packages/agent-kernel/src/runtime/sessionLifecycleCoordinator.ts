import logger from '@deepchat/shared/logger'
import type {
  PermissionMode,
  SessionGenerationSettings
} from '@deepchat/shared/types/agent-interface'
import type { ToolServicePort } from '@deepchat/shared/types/tool'
import { toAppSessionId } from '../collab/agent-shared/agentSessionIds.js'

import type {
  DeepChatAgentRuntime,
  SessionScopeRegistry
} from '../instance/deepChatAgentRuntime.js'
import type { MemoryRuntimeCoordinator } from '../memory/memoryRuntimeCoordinator.js'


import type { CompactionRuntimeCoordinator } from './compactionRuntimeCoordinator.js'
import { sanitizeGenerationSettings } from './generationSettings.js'
import type { RunLifecycleCoordinator } from './runLifecycleCoordinator.js'
import type { SessionIdentityService } from './sessionIdentityService.js'
import type { SessionSettingsCoordinator } from './sessionSettingsCoordinator.js'
import type { InteractionParkingRegistry } from './interactionParkingRegistry.js'
import type { ToolSurfaceShadowDiagnosticsRegistryPort } from './toolSurfaceDiagnostics.js'
import type { ToolSurfaceCanaryDiagnosticsRegistry } from './toolSurfaceCanaryDiagnostics.js'
import { revokeToolSurfaceDeferredDispatchesForSession } from './toolSurface.js'
import {type ProviderModelResolutionPort} from '../contracts/providerModelResolution.js'
import {type PromptSettingsPort} from '../contracts/promptSettings.js'
import {type SessionSettingsStorePort} from '../contracts/sessionSettingsStore.js'
import {type TranscriptStorePort} from '../contracts/transcriptStore.js'
import {type PendingInputStorePort} from '../contracts/pendingInputStore.js'
import {type ProgrammaticToolAuthorityPort} from '../contracts/programmaticToolAuthority.js'

export interface SessionInitConfig {
  agentId?: string
  providerId: string
  modelId: string
  projectDir?: string | null
  permissionMode?: PermissionMode
  generationSettings?: Partial<SessionGenerationSettings>
}

export type SessionLifecycleRegistry = SessionScopeRegistry & Pick<DeepChatAgentRuntime, 'evict'>

export interface SessionLifecycleCoordinatorDependencies {
  registry: SessionLifecycleRegistry
  providerSettings: ProviderModelResolutionPort
  promptSettings: PromptSettingsPort
  sessionStore: Pick<SessionSettingsStorePort, 'create' | 'delete'>
  transcript: Pick<TranscriptStorePort, 'deleteBySession'>
  pendingInputs: Pick<PendingInputStorePort, 'deleteBySession'>
  toolService: Pick<ToolServicePort, 'clearConversationToolMapping'>
  identity: Pick<SessionIdentityService, 'getAgentId'>
  sessionSettings: Pick<SessionSettingsCoordinator, 'normalizeProjectDir'>
  compaction: Pick<CompactionRuntimeCoordinator, 'idleState' | 'releaseSession'>
  memory: Pick<
    MemoryRuntimeCoordinator,
    'initializeSession' | 'beginSessionDestroy' | 'finishSessionDestroy'
  >
  runLifecycle: Pick<
    RunLifecycleCoordinator,
    'cancel' | 'clearFirstTurnReady' | 'cancelScopeOperations' | 'scopeFor'
  >
  interactionParking: Pick<InteractionParkingRegistry, 'clearSession'>
  toolSurfaceDiagnostics: Pick<ToolSurfaceShadowDiagnosticsRegistryPort, 'clear'>
  toolSurfaceCanaryDiagnostics: Pick<ToolSurfaceCanaryDiagnosticsRegistry, 'clearSession'>
  programmaticToolParents: Pick<ProgrammaticToolAuthorityPort, 'releaseSession'>
}

export class SessionLifecycleCoordinator {
  constructor(private readonly deps: SessionLifecycleCoordinatorDependencies) {}

  async init(sessionId: string, config: SessionInitConfig): Promise<void> {
    const projectDir = this.deps.sessionSettings.normalizeProjectDir(config.projectDir)
    const permissionMode = config.permissionMode ?? 'default'
    logger.info(
      `[DeepChatAgent] initSession id=${sessionId} provider=${config.providerId} model=${config.modelId} permission=${permissionMode} hasProjectDir=${projectDir !== null}`
    )
    const generationSettings = await sanitizeGenerationSettings(
      this.deps.providerSettings,
      this.deps.promptSettings,
      config.providerId,
      config.modelId,
      config.generationSettings ?? {}
    )
    this.deps.sessionStore.create(
      sessionId,
      config.providerId,
      config.modelId,
      permissionMode,
      generationSettings
    )
    const instance = this.deps.registry.getOrHydrateScope(toAppSessionId(sessionId)).instance
    instance.setAgentId(
      config.agentId?.trim() || this.deps.identity.getAgentId(sessionId) || 'deepchat'
    )
    instance.setProjectDir(projectDir)
    instance.setGenerationSettings(generationSettings)
    instance.setRuntimeState({
      status: 'idle',
      providerId: config.providerId,
      modelId: config.modelId,
      permissionMode
    })
    instance.setCompactionState(this.deps.compaction.idleState())
    this.deps.memory.initializeSession(sessionId)
    this.deps.runLifecycle.clearFirstTurnReady(sessionId)
    instance.invalidateToolProfileCache()
  }

  /**
   * Releases runtime state without deleting durable session facts. Used when the app suspends or a
   * backend hands the session off, so the next access rehydrates from persisted data.
   */
  async cleanup(sessionId: string): Promise<void> {
    revokeToolSurfaceDeferredDispatchesForSession(sessionId)
    const instance = this.deps.registry.getHydratedScope(toAppSessionId(sessionId))?.instance
    if (!instance) {
      return
    }
    try {
      await this.deps.runLifecycle.cancel(sessionId)
    } finally {
      try {
        this.deps.toolSurfaceDiagnostics.clear(instance)
      } catch {}
      instance.clearOwnedState()
      if (this.deps.registry.getHydratedScope(toAppSessionId(sessionId))?.instance === instance) {
        this.deps.registry.evict(toAppSessionId(sessionId))
      }
    }
  }

  async destroy(sessionId: string): Promise<void> {
    const instance = this.deps.registry.getHydratedScope(toAppSessionId(sessionId))?.instance
    this.deps.memory.beginSessionDestroy(sessionId)
    if (instance) {
      this.deps.runLifecycle.cancelScopeOperations(
        this.deps.runLifecycle.scopeFor(sessionId, instance)
      )
    }
    this.deps.runLifecycle.clearFirstTurnReady(sessionId)

    this.deps.pendingInputs.deleteBySession(sessionId)
    this.deps.transcript.deleteBySession(sessionId)
    this.deps.sessionStore.delete(sessionId)
    this.deps.compaction.releaseSession(sessionId)
    this.deps.programmaticToolParents.releaseSession(sessionId)
    this.deps.toolSurfaceCanaryDiagnostics.clearSession(sessionId)
    this.deps.interactionParking.clearSession(sessionId)
    if (instance) {
      try {
        this.deps.toolSurfaceDiagnostics.clear(instance)
      } catch {}
    }
    instance?.clearOwnedState()
    this.deps.registry.evict(toAppSessionId(sessionId))
    this.deps.memory.finishSessionDestroy(sessionId)
    this.deps.toolService.clearConversationToolMapping(sessionId)
  }
}
