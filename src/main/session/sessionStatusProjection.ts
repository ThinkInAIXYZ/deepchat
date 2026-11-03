import type { SessionStatusPublisherPorts } from '@/agent/deepchat/runtime/sessionStatusPublisher'
import type {
  DeepChatEventPublisher,
  DeepChatSessionUpdatePublisher
} from '@/agent/deepchat/runtime/types'
import type { SessionUiPort } from './contracts'

export function createSessionStatusProjection(ports: {
  publishEvent: DeepChatEventPublisher
  publishSessionUpdate: DeepChatSessionUpdatePublisher
  sessionUiPort: SessionUiPort
}): SessionStatusPublisherPorts['publishStatus'] {
  return ({ sessionId, status, usage, updatedAt, changed }) => {
    if (changed) {
      ports.publishEvent('sessions.status.changed', { sessionId, status, version: updatedAt })
      ports.publishEvent('sessions.updated', { sessionIds: [sessionId], reason: 'updated' })
    }
    ports.publishSessionUpdate({
      sessionId,
      kind: 'status',
      status,
      updatedAt,
      ...(usage === undefined ? {} : { usage })
    })
    if (changed) ports.sessionUiPort.refreshSessionUi()
  }
}
