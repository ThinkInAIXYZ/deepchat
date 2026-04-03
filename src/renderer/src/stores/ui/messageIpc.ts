import { STREAM_EVENTS } from '@/events'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import { createIpcSubscriptionScope } from '@/lib/ipcSubscription'

interface BindMessageStoreIpcOptions {
  getActiveSessionId: () => string | null
  setStreamingState: (payload: {
    sessionId: string
    messageId?: string
    blocks: AssistantMessageBlock[]
  }) => void
  clearStreamingState: () => void
  loadMessages: (sessionId: string) => void | Promise<void>
  applyStreamingBlocksToMessage: (
    messageId: string,
    sessionId: string,
    blocks: AssistantMessageBlock[]
  ) => void
  isEphemeralStreamMessageId: (messageId: string) => boolean
}

export function bindMessageStoreIpc(options: BindMessageStoreIpcOptions): () => void {
  const scope = createIpcSubscriptionScope()

  scope.on(
    STREAM_EVENTS.RESPONSE,
    (
      _event,
      payload: {
        conversationId: string
        blocks: AssistantMessageBlock[]
        messageId?: string
        eventId?: string
      }
    ) => {
      if (payload?.conversationId !== options.getActiveSessionId()) {
        return
      }

      const streamMessageId = payload.messageId ?? payload.eventId
      options.setStreamingState({
        sessionId: payload.conversationId,
        messageId: streamMessageId,
        blocks: payload.blocks
      })

      if (streamMessageId && !options.isEphemeralStreamMessageId(streamMessageId)) {
        options.applyStreamingBlocksToMessage(
          streamMessageId,
          payload.conversationId,
          payload.blocks
        )
      }
    }
  )

  const clearAndReload = (payload: { conversationId: string }) => {
    if (payload?.conversationId !== options.getActiveSessionId()) {
      return
    }

    options.clearStreamingState()
    void options.loadMessages(payload.conversationId)
  }

  scope.on(
    STREAM_EVENTS.END,
    (_event, payload: { conversationId: string; messageId?: string; eventId?: string }) => {
      clearAndReload(payload)
    }
  )

  scope.on(
    STREAM_EVENTS.ERROR,
    (
      _event,
      payload: { conversationId: string; error: string; messageId?: string; eventId?: string }
    ) => {
      clearAndReload(payload)
    }
  )

  return scope.cleanup
}
