import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { DeepChatSessionState } from '@shared/types/agent-interface'
import { DeepChatAgentInstance } from './deepChatAgentInstance'

export const STALE_DEEPCHAT_INSTANCE_ERROR_NAME = 'StaleDeepChatAgentInstanceError'

export function createStaleDeepChatInstanceError(sessionId: string): Error {
  const error = new Error(`DeepChat agent instance was replaced: ${sessionId}`)
  error.name = STALE_DEEPCHAT_INSTANCE_ERROR_NAME
  return error
}

export function isStaleDeepChatInstanceError(error: unknown): boolean {
  return error instanceof Error && error.name === STALE_DEEPCHAT_INSTANCE_ERROR_NAME
}

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
  private readonly scopes = new WeakMap<DeepChatAgentInstance, SessionRuntimeScope>()
  private toolRegistryRevision = 0

  getOrHydrate(sessionId: AppSessionId): DeepChatAgentInstance {
    const current = this.instances.get(sessionId)
    if (current) return current

    const instance = new DeepChatAgentInstance(sessionId)
    this.instances.set(sessionId, instance)
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
      isCurrent: () => this.instances.get(sessionId) === instance,
      assertCurrent: () => {
        if (this.instances.get(sessionId) !== instance) {
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
    return this.instances.delete(sessionId)
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
