import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  chatStreamCompletedEvent,
  chatStreamFailedEvent,
  chatStreamUpdatedEvent
} from '@shared/contracts/events'
import { chatSendMessageRoute, chatStopStreamRoute } from '@shared/contracts/routes'
import type { SendMessageInput } from '@shared/types/agent-interface'
import { getDeepchatBridge } from './core'

export class ChatClient {
  constructor(private readonly bridge: DeepchatBridge = getDeepchatBridge()) {}

  async sendMessage(sessionId: string, content: string | SendMessageInput) {
    return await this.bridge.invoke(chatSendMessageRoute.name, {
      sessionId,
      content
    })
  }

  async stopStream(input: { sessionId?: string; requestId?: string }) {
    return await this.bridge.invoke(chatStopStreamRoute.name, input)
  }

  onStreamUpdated(
    listener: (payload: {
      kind: 'snapshot'
      requestId: string
      sessionId: string
      messageId: string
      updatedAt: number
      blocks: unknown[]
    }) => void
  ) {
    return this.bridge.on(chatStreamUpdatedEvent.name, listener)
  }

  onStreamCompleted(
    listener: (payload: {
      requestId: string
      sessionId: string
      messageId: string
      completedAt: number
    }) => void
  ) {
    return this.bridge.on(chatStreamCompletedEvent.name, listener)
  }

  onStreamFailed(
    listener: (payload: {
      requestId: string
      sessionId: string
      messageId: string
      failedAt: number
      error: string
    }) => void
  ) {
    return this.bridge.on(chatStreamFailedEvent.name, listener)
  }
}
