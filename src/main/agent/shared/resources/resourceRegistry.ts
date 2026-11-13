import type { AppSessionId } from '../agentSessionIds'
import type { DeepChatSessionState } from '@shared/types/agent-interface'
import { SessionResources, type SessionResourceHandle } from './sessionResources'

const STALE_RESOURCE_NAME = 'StaleSessionResourceHandleError'
export function isStaleSessionResourceError(error: unknown): boolean {
  return error instanceof Error && error.name === STALE_RESOURCE_NAME
}
export interface SessionResourceScope {
  readonly sessionId: AppSessionId
  readonly instance: SessionResourceHandle
  state(): DeepChatSessionState | undefined
  isCurrent(): boolean
  assertCurrent(): void
}
export class SessionResourcesRegistry {
  private readonly instances = new Map<AppSessionId, SessionResourceHandle>()
  private readonly scopes = new WeakMap<SessionResourceHandle, SessionResourceScope>()
  private toolRegistryRevision = 0
  getOrHydrate(sessionId: AppSessionId): SessionResourceHandle {
    let instance = this.instances.get(sessionId)
    if (!instance) {
      instance = new SessionResources(sessionId)
      this.instances.set(sessionId, instance)
    }
    return instance
  }
  getHydrated(sessionId: AppSessionId): SessionResourceHandle | undefined {
    return this.instances.get(sessionId)
  }
  getOrHydrateScope(sessionId: AppSessionId): SessionResourceScope {
    return this.scopeFor(sessionId, this.getOrHydrate(sessionId))
  }
  getHydratedScope(sessionId: AppSessionId): SessionResourceScope | undefined {
    const instance = this.instances.get(sessionId)
    return instance ? this.scopeFor(sessionId, instance) : undefined
  }
  scopeFor(sessionId: AppSessionId, instance: SessionResourceHandle): SessionResourceScope {
    const cached = instance.sessionId === sessionId ? this.scopes.get(instance) : undefined
    if (cached) return cached
    const scope = {
      sessionId,
      instance,
      state: () => instance.getRuntimeState(),
      isCurrent: () => this.instances.get(sessionId) === instance,
      assertCurrent: () => {
        if (this.instances.get(sessionId) !== instance) {
          const error = new Error(`Session resources were replaced: ${sessionId}`)
          error.name = STALE_RESOURCE_NAME
          throw error
        }
      }
    }
    if (instance.sessionId === sessionId) this.scopes.set(instance, scope)
    return scope
  }
  evict(sessionId: AppSessionId): boolean {
    return this.instances.delete(sessionId)
  }
  getToolRegistryRevision(): number {
    return this.toolRegistryRevision
  }
  markToolRegistryChanged(): void {
    this.toolRegistryRevision++
    for (const instance of this.instances.values()) instance.invalidateToolProfileCache()
  }
}
export type SessionResourceRegistryPort = Pick<
  SessionResourcesRegistry,
  'getOrHydrateScope' | 'getHydratedScope' | 'scopeFor'
>
