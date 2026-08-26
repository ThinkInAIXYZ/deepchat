import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  chatPlanUpdatedEvent,
  chatStreamCompletedEvent,
  chatStreamFailedEvent,
  chatStreamUpdatedEvent,
  type DeepchatEventPayload
} from '@shared/contracts/events'
import type { DeepchatRouteInput } from '@shared/contracts/routes'
import {
  chatCancelSubmissionRoute,
  chatDismissToolInteractionRoute,
  chatSendMessageRoute,
  chatSteerActiveTurnRoute,
  chatStopStreamRoute,
  chatRespondToolInteractionRoute
} from '@shared/contracts/routes'
import type { SendMessageInput, ToolInteractionResponse } from '@shared/types/agent-interface'
import { getDeepchatBridge } from './core'

export function createChatClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function sendMessage(
    sessionId: string,
    content: string | SendMessageInput,
    options?: { submissionId?: string }
  ) {
    const input = chatSendMessageRoute.input.parse({
      sessionId,
      content,
      ...(options?.submissionId ? { submissionId: options.submissionId } : {})
    })

    return await bridge.invoke(chatSendMessageRoute.name, input)
  }

  async function steerActiveTurn(
    sessionId: string,
    content: string | SendMessageInput,
    options?: { submissionId?: string }
  ) {
    const input = chatSteerActiveTurnRoute.input.parse({
      sessionId,
      content,
      ...(options?.submissionId ? { submissionId: options.submissionId } : {})
    })

    return await bridge.invoke(chatSteerActiveTurnRoute.name, input)
  }

  async function cancelSubmission(submissionId: string) {
    const input = chatCancelSubmissionRoute.input.parse({ submissionId })
    return await bridge.invoke(chatCancelSubmissionRoute.name, input)
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

  async function dismissToolInteraction(input: {
    sessionId: string
    messageId: string
    toolCallId: string
  }) {
    return await bridge.invoke(
      chatDismissToolInteractionRoute.name,
      input as DeepchatRouteInput<typeof chatDismissToolInteractionRoute.name>
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

  function onPlanUpdated(listener: (payload: DeepchatEventPayload<'chat.plan.updated'>) => void) {
    return bridge.on(chatPlanUpdatedEvent.name, listener)
  }

  return {
    sendMessage,
    steerActiveTurn,
    cancelSubmission,
    stopStream,
    respondToolInteraction,
    dismissToolInteraction,
    onStreamUpdated,
    onStreamCompleted,
    onStreamFailed,
    onPlanUpdated
  }
}

export type ChatClient = ReturnType<typeof createChatClient>
