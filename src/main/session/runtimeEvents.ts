import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { AssistantDeliverySegment } from '@shared/lib/assistantDeliverySegments'

export type SessionRuntimeStatus = 'idle' | 'generating' | 'error'

export interface SessionWaitingInteraction {
  type: 'permission' | 'question'
  messageId: string
  toolCallId: string
  actionBlock: AssistantMessageBlock
}

export interface SessionRuntimeUpdate {
  sessionId: string
  kind: 'blocks' | 'status'
  updatedAt: number
  messageId?: string
  status?: SessionRuntimeStatus
  previewMarkdown?: string
  responseMarkdown?: string
  deliverySegments?: AssistantDeliverySegment[]
  waitingInteraction?: SessionWaitingInteraction | null
}

export interface SessionRuntimeEventPort {
  subscribe(listener: (update: SessionRuntimeUpdate) => void): () => void
}

export class SessionRuntimeEvents implements SessionRuntimeEventPort {
  private readonly listeners = new Set<(update: SessionRuntimeUpdate) => void>()

  publish(update: SessionRuntimeUpdate): void {
    for (const listener of this.listeners) {
      try {
        listener(update)
      } catch (error) {
        console.error('[SessionRuntimeEvents] Failed to publish session update:', error)
      }
    }
  }

  subscribe(listener: (update: SessionRuntimeUpdate) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
