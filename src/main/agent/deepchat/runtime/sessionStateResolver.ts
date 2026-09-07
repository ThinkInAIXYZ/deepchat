import type { DeepChatSessionState } from '@shared/types/agent-interface'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type {
  DeepChatAgentRuntime,
  SessionScopeRegistry
} from '@/agent/deepchat/instance/deepChatAgentRuntime'
import type { SessionSettingsStore } from '@/session/data/settings'
import type { PersistedSessionGenerationRow } from './generationSettings'
import type { RunLifecycleCoordinator } from './runLifecycleCoordinator'
import type { SessionIdentityService } from './sessionIdentityService'
import type { SessionSettingsCoordinator } from './sessionSettingsCoordinator'
import { revokeToolSurfaceDeferredDispatchesForSession } from './toolSurface'

type SessionStateHydrationMode = 'full' | 'summary'

export type SessionStateRegistry = SessionScopeRegistry & Pick<DeepChatAgentRuntime, 'evict'>
export type SessionStateLifecyclePort = Pick<RunLifecycleCoordinator, 'hasPendingInteractions'>

export interface SessionStateResolverDependencies {
  registry: SessionStateRegistry
  sessionStore: Pick<SessionSettingsStore, 'get'>
  runLifecycle: SessionStateLifecyclePort
  identity: Pick<SessionIdentityService, 'getAgentId'>
  sessionSettings: Pick<SessionSettingsCoordinator, 'getEffectiveGenerationSettings'>
}

export class SessionStateResolver {
  constructor(private readonly deps: SessionStateResolverDependencies) {}

  async get(sessionId: string): Promise<DeepChatSessionState | null> {
    return await this.resolve(sessionId, 'full')
  }

  async getSummary(sessionId: string): Promise<DeepChatSessionState | null> {
    return await this.resolve(sessionId, 'summary')
  }

  private async resolve(
    sessionId: string,
    hydrationMode: SessionStateHydrationMode
  ): Promise<DeepChatSessionState | null> {
    const instance = this.deps.registry.getOrHydrateScope(toAppSessionId(sessionId)).instance
    const state = instance.getRuntimeState()
    if (state) {
      this.deps.identity.getAgentId(sessionId)
      if (hydrationMode === 'full') {
        await this.deps.sessionSettings.getEffectiveGenerationSettings(sessionId)
      }
      return {
        ...state,
        ...(this.deps.runLifecycle.hasPendingInteractions(sessionId)
          ? { status: 'generating' as const }
          : {})
      }
    }

    const dbSession = this.deps.sessionStore.get(sessionId) as
      | PersistedSessionGenerationRow
      | undefined
    if (!dbSession) {
      revokeToolSurfaceDeferredDispatchesForSession(sessionId)
      this.deps.registry.evict(toAppSessionId(sessionId))
      return null
    }

    this.deps.identity.getAgentId(sessionId)
    const hasPendingInteractions = this.deps.runLifecycle.hasPendingInteractions(sessionId)
    const rebuilt: DeepChatSessionState = {
      status: 'idle',
      providerId: dbSession.provider_id,
      modelId: dbSession.model_id,
      permissionMode: dbSession.permission_mode
    }
    instance.setRuntimeState(rebuilt)
    if (hydrationMode === 'full') {
      await this.deps.sessionSettings.getEffectiveGenerationSettings(sessionId)
    }
    return {
      ...rebuilt,
      ...(hasPendingInteractions ? { status: 'generating' as const } : {})
    }
  }
}
