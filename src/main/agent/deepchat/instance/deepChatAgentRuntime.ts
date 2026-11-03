import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { DeepChatSessionState } from '@shared/types/agent-interface'
import { DeepChatAgentInstance } from './deepChatAgentInstance'

export {
  STALE_DEEPCHAT_INSTANCE_ERROR_NAME,
  createStaleDeepChatInstanceError,
  isStaleDeepChatInstanceError
} from './controlSession'
import { createStaleDeepChatInstanceError } from './controlSession'
import type { HarnessControlPort } from '@shared/harness/control'

export interface SessionRuntimeScope {
  readonly sessionId: AppSessionId
  readonly instance: DeepChatAgentInstance

  state(): DeepChatSessionState | undefined
  isCurrent(): boolean
  assertCurrent(): void
}

/**
 * Instance access and staleness fencing are registry reads. Owners that only need them take this
 * narrow view instead of routing four separate callbacks through the composition root.
 */
export type SessionScopeRegistry = Pick<
  DeepChatAgentRuntime,
  'getOrHydrateScope' | 'getHydratedScope' | 'scopeFor'
>

export class DeepChatAgentRuntime {
  private readonly instances = new Map<AppSessionId, DeepChatAgentInstance>()
  private readonly controlScopes = new Map<AppSessionId, string>()
  private readonly scopes = new WeakMap<DeepChatAgentInstance, SessionRuntimeScope>()
  private toolRegistryRevision = 0

  constructor(private readonly control: HarnessControlPort) {}

  getOrHydrate(sessionId: AppSessionId): DeepChatAgentInstance {
    const current = this.instances.get(sessionId)
    if (current) return current

    const instance = new DeepChatAgentInstance(sessionId, this.control)
    this.instances.set(sessionId, instance)
    this.controlScopes.set(sessionId, instance.controlScopeId)
    return instance
  }

  getHydrated(sessionId: AppSessionId): DeepChatAgentInstance | undefined {
    return this.instances.get(sessionId)
  }

  getOrHydrateScope(sessionId: AppSessionId): SessionRuntimeScope {
    return this.scopeFor(sessionId, this.getOrHydrate(sessionId))
  }

  getHydratedScope(sessionId: AppSessionId): SessionRuntimeScope | undefined {
    const instance = this.instances.get(sessionId)
    return instance ? this.scopeFor(sessionId, instance) : undefined
  }

  scopeFor(sessionId: AppSessionId, instance: DeepChatAgentInstance): SessionRuntimeScope {
    if (instance.sessionId === sessionId) {
      const current = this.scopes.get(instance)
      if (current) {
        return current
      }
    }

    const scope: SessionRuntimeScope = {
      sessionId,
      instance,
      state: () => instance.getRuntimeState(),
      isCurrent: () => this.instances.get(sessionId) === instance && instance.isControlCurrent(),
      assertCurrent: () => {
        if (this.instances.get(sessionId) !== instance || !instance.isControlCurrent()) {
          throw createStaleDeepChatInstanceError(sessionId)
        }
      }
    }
    if (instance.sessionId === sessionId) {
      this.scopes.set(instance, scope)
    }
    return scope
  }

  evict(sessionId: AppSessionId): boolean {
    const instance = this.instances.get(sessionId)
    if (!instance) return false
    instance.retireControl()
    return this.instances.delete(sessionId)
  }

  async clearSessionControl(
    sessionId: AppSessionId,
    origin?: DeepChatAgentInstance
  ): Promise<void> {
    const originScopeId = origin?.controlScopeId ?? this.controlScopes.get(sessionId) ?? null
    const receipt = await this.control.send({ method: 'clearSession', sessionId, originScopeId })
    if (receipt.outcome !== 'accepted' || receipt.result !== true)
      throw createStaleDeepChatInstanceError(sessionId)
    if (this.controlScopes.get(sessionId) === originScopeId) this.controlScopes.delete(sessionId)
  }

  abortGenerations(): void {
    for (const instance of this.instances.values()) {
      instance.requestGenerationAbort()
      instance.abortDeferredToolCalls()
    }
  }

  getToolRegistryRevision(): number {
    return this.toolRegistryRevision
  }

  markToolRegistryChanged(): void {
    this.toolRegistryRevision += 1
    for (const instance of this.instances.values()) {
      instance.invalidateToolProfileCache()
    }
  }
}
