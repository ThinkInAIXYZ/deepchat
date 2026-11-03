import type { AssistantMessageBlock, SessionCompactionState } from '@shared/types/agent-interface'
import type { DeepChatInternalSessionUpdate } from './sessionUpdates'

export interface DeepChatOutputPort {
  streamSnapshot(snapshot: {
    kind: 'snapshot'
    requestId: string
    sessionId: string
    messageId: string
    providerId?: string
    modelId?: string
    updatedAt: number
    revision: number
    blocks: AssistantMessageBlock[]
  }): void
  streamCompleted(completion: {
    requestId: string
    sessionId: string
    messageId: string
    completedAt: number
  }): void
  streamFailed(failure: {
    requestId: string
    sessionId: string
    messageId: string
    failedAt: number
    error: string
  }): void
  compactionChanged(
    change: SessionCompactionState & {
      sessionId: string
      emitSeq: number
      latestAnchorEntryId: number | null
    }
  ): void
  sessionUpdate(update: DeepChatInternalSessionUpdate): void
}
