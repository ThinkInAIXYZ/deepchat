import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import { DeepChatAgentInstance, type DeepChatAgentInstanceDelegate } from './deepChatAgentInstance'

export type DeepChatAgentInstanceHydrator = (
  sessionId: AppSessionId
) => DeepChatAgentInstanceDelegate

export class DeepChatAgentRuntime {
  private readonly instances = new Map<AppSessionId, DeepChatAgentInstance>()

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
}
