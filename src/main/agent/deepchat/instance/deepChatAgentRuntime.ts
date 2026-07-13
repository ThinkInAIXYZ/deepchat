import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import { DeepChatAgentInstance, type DeepChatAgentInstanceDelegate } from './deepChatAgentInstance'

export type DeepChatAgentInstanceHydrator = (
  sessionId: AppSessionId
) => DeepChatAgentInstanceDelegate

export class DeepChatAgentRuntime {
  private readonly instances = new Map<AppSessionId, DeepChatAgentInstance>()
  private toolRegistryRevision = 0

  constructor(private readonly hydrateInstance: DeepChatAgentInstanceHydrator) {}

  getOrHydrate(sessionId: AppSessionId): DeepChatAgentInstance {
    const current = this.instances.get(sessionId)
    if (current) return current

    const instance = new DeepChatAgentInstance(
      sessionId,
      this.hydrateInstance(sessionId),
      (closedInstance) => {
        if (this.instances.get(sessionId) === closedInstance) {
          this.instances.delete(sessionId)
        }
      }
    )
    this.instances.set(sessionId, instance)
    return instance
  }

  getHydrated(sessionId: AppSessionId): DeepChatAgentInstance | undefined {
    return this.instances.get(sessionId)
  }

  evict(sessionId: AppSessionId): boolean {
    return this.instances.delete(sessionId)
  }

  async dispose(sessionId: AppSessionId): Promise<void> {
    await this.instances.get(sessionId)?.close()
  }

  async cleanupSession(sessionId: AppSessionId): Promise<void> {
    const instance = this.instances.get(sessionId)
    if (!instance) return
    try {
      await instance.cancel()
    } finally {
      instance.clearOwnedState()
      if (this.instances.get(sessionId) === instance) this.instances.delete(sessionId)
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
