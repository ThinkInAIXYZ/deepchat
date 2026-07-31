import type { DeepChatSessionState } from '@shared/types/agent-interface'
import type { SessionUiPort } from '@/session/contracts'
import type { SessionRuntimeScope } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import type { DeepChatEventPublisher, DeepChatSessionUpdatePublisher } from './types'

export interface SessionStatusPublisherPorts {
  publishEvent: DeepChatEventPublisher
  publishSessionUpdate: DeepChatSessionUpdatePublisher
  sessionUiPort: SessionUiPort
}

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
      this.ports.publishSessionUpdate({
        sessionId,
        kind: 'status',
        updatedAt: Date.now(),
        status,
        usage
      })
      return true
    }

    current.status = status
    this.ports.publishEvent('sessions.status.changed', {
      sessionId,
      status,
      version: Date.now()
    })
    this.ports.publishEvent('sessions.updated', {
      sessionIds: [sessionId],
      reason: 'updated'
    })
    this.ports.publishSessionUpdate({
      sessionId,
      kind: 'status',
      updatedAt: Date.now(),
      status,
      ...(usage === undefined ? {} : { usage })
    })
    this.ports.sessionUiPort.refreshSessionUi()
    return true
  }
}
