import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  chatStreamCompletedEvent,
  chatStreamFailedEvent,
  chatStreamUpdatedEvent,
  type DeepchatEventPayload
} from '@shared/contracts/events'
import type { DeepchatRouteInput } from '@shared/contracts/routes'
import { chatSendMessageRoute, chatStopStreamRoute } from '@shared/contracts/routes'
import type { SendMessageInput } from '@shared/types/agent-interface'
import { getDeepchatBridge } from './core'

export class ChatClient {
  constructor(private readonly bridge: DeepchatBridge = getDeepchatBridge()) {}

  async sendMessage(sessionId: string, content: string | SendMessageInput) {
    const input = {
      sessionId,
      content
    } as DeepchatRouteInput<typeof chatSendMessageRoute.name>

    return await this.bridge.invoke(chatSendMessageRoute.name, input)
  }

  async stopStream(input: { sessionId?: string; requestId?: string }) {
    return await this.bridge.invoke(chatStopStreamRoute.name, input)
  }

  onStreamUpdated(listener: (payload: DeepchatEventPayload<'chat.stream.updated'>) => void) {
    return this.bridge.on(chatStreamUpdatedEvent.name, listener)
  }

  onStreamCompleted(listener: (payload: DeepchatEventPayload<'chat.stream.completed'>) => void) {
    return this.bridge.on(chatStreamCompletedEvent.name, listener)
  }

  onStreamFailed(listener: (payload: DeepchatEventPayload<'chat.stream.failed'>) => void) {
    return this.bridge.on(chatStreamFailedEvent.name, listener)
  }
}
