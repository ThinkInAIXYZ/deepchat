import type { DeepChatSessionState } from '@shared/types/agent-interface'
import type { SessionRuntimeScope } from '@/agent/deepchat/instance/deepChatAgentRuntime'

import type { SessionStatusPublisherPorts } from '@/agent/shared/output'
export type { SessionStatusPublisherPorts } from '@/agent/shared/output'

export class SessionStatusPublisher {
  constructor(private readonly ports: SessionStatusPublisherPorts) {}

  transition(
    scope: SessionRuntimeScope,
    status: DeepChatSessionState['status'],
    usage?: Record<string, number>
  ): boolean {
    if (!scope.isCurrent()) {
      return false
    }

    const current = scope.state()
    if (!current) {
      return false
    }
    if (current.status === status && usage === undefined) {
      return true
    }

    const sessionId = scope.sessionId
    if (current.status === status) {
      this.ports.publishStatus({
        sessionId,
        changed: false,
        updatedAt: Date.now(),
        status,
        usage
      })
      return true
    }

    current.status = status
    this.ports.publishStatus({
      sessionId,
      changed: true,
      updatedAt: Date.now(),
      status,
      ...(usage === undefined ? {} : { usage })
    })
    return true
  }
}
