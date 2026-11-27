import type { DeepChatSessionState } from '@shared/types/agent-interface'
import type { SessionResourceScope as SessionRuntimeScope } from './resourceRegistry'

import type { SessionStatusPublisherPorts } from '@/agent/shared/output'
export type { SessionStatusPublisherPorts } from '@/agent/shared/output'

export class SessionStatusPublisher {
  constructor(private readonly ports: SessionStatusPublisherPorts) {}

  transition(
    scope: SessionRuntimeScope,
    status: DeepChatSessionState['status'],
    usage?: Record<string, number>,
    meta?: { messageId?: string; requestId?: string; submissionId?: string; error?: string }
  ): boolean {
    if (!scope.isCurrent()) {
      return false
    }

    const current = scope.state()
    if (!current) {
      return false
    }
    const hasMeta = Boolean(meta?.messageId || meta?.requestId || meta?.submissionId || meta?.error)
    if (current.status === status && usage === undefined && !hasMeta) {
      return true
    }

    const sessionId = scope.sessionId
    if (current.status === status) {
      this.ports.publishStatus({
        sessionId,
        changed: false,
        updatedAt: Date.now(),
        status,
        ...(usage === undefined ? {} : { usage }),
        ...(meta?.messageId ? { messageId: meta.messageId } : {}),
        ...(meta?.requestId ? { requestId: meta.requestId } : {}),
        ...(meta?.submissionId ? { submissionId: meta.submissionId } : {}),
        ...(meta?.error ? { error: meta.error } : {})
      })
      return true
    }

    current.status = status
    this.ports.publishStatus({
      sessionId,
      changed: true,
      updatedAt: Date.now(),
      status,
      ...(usage === undefined ? {} : { usage }),
      ...(meta?.messageId ? { messageId: meta.messageId } : {}),
      ...(meta?.requestId ? { requestId: meta.requestId } : {}),
      ...(meta?.submissionId ? { submissionId: meta.submissionId } : {}),
      ...(meta?.error ? { error: meta.error } : {})
    })
    return true
  }
}
