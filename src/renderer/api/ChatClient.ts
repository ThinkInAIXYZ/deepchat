import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  chatStreamCompletedEvent,
  chatStreamFailedEvent,
  chatStreamUpdatedEvent,
  type DeepchatEventPayload
} from '@shared/contracts/events'
import type { DeepchatRouteInput } from '@shared/contracts/routes'
import {
  chatSendMessageRoute,
  chatStopStreamRoute,
  chatRespondToolInteractionRoute
} from '@shared/contracts/routes'
import type { SendMessageInput, ToolInteractionResponse } from '@shared/types/agent-interface'
import { getDeepchatBridge } from './core'

export function createChatClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function sendMessage(sessionId: string, content: string | SendMessageInput) {
    const input = {
      sessionId,
      content
    } as DeepchatRouteInput<typeof chatSendMessageRoute.name>

    return await bridge.invoke(chatSendMessageRoute.name, input)
  }

  async function stopStream(input: { sessionId?: string; requestId?: string }) {
    return await bridge.invoke(chatStopStreamRoute.name, input)
  }

  async function respondToolInteraction(input: {
    sessionId: string
    messageId: string
    toolCallId: string
    response: ToolInteractionResponse
  }) {
    return await bridge.invoke(
      chatRespondToolInteractionRoute.name,
      input as DeepchatRouteInput<typeof chatRespondToolInteractionRoute.name>
    )
  }

  function onStreamUpdated(
    listener: (payload: DeepchatEventPayload<'chat.stream.updated'>) => void
  ) {
    return bridge.on(chatStreamUpdatedEvent.name, listener)
  }

  function onStreamCompleted(
    listener: (payload: DeepchatEventPayload<'chat.stream.completed'>) => void
  ) {
    return bridge.on(chatStreamCompletedEvent.name, listener)
  }

  function onStreamFailed(listener: (payload: DeepchatEventPayload<'chat.stream.failed'>) => void) {
    return bridge.on(chatStreamFailedEvent.name, listener)
  }

  return {
    sendMessage,
    stopStream,
    respondToolInteraction,
    onStreamUpdated,
    onStreamCompleted,
    onStreamFailed
  }
}

export type ChatClient = ReturnType<typeof createChatClient>
