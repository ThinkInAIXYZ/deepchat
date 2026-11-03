import type { PendingInteractionProjection } from '../instance/controlSession'
import type { HarnessControlOwner } from '@shared/harness/control'
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

  async transition(
    scope: SessionRuntimeScope,
    status: DeepChatSessionState['status'],
    owner: HarnessControlOwner,
    usage?: Record<string, number>,
    interactions?: PendingInteractionProjection
  ): Promise<boolean> {
    if (!scope.isCurrent()) {
      return false
    }

    const current = scope.state()
    if (!current) {
      return false
    }
    const applied = await scope.instance.transitionControlStatus(owner, status, interactions)
    if (!applied || !scope.isCurrent()) {
      return false
    }
    if (scope.state()?.status !== status) return false
    const { previousStatus } = applied
    const sessionId = scope.sessionId
    if (previousStatus === status && usage === undefined) return true
    if (previousStatus === status) {
      this.ports.publishSessionUpdate({
        sessionId,
        kind: 'status',
        updatedAt: Date.now(),
        status,
        usage
      })
      return true
    }

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
