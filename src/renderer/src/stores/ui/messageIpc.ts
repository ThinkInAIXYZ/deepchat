import { ChatClient } from '../../../api/ChatClient'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import { STREAM_EVENTS } from '@/events'
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
  const chatClient = new ChatClient()
  const scope = createIpcSubscriptionScope()
  const reloadPersistedMessages = (sessionId: string) => {
    options.clearStreamingState()
    void options.loadMessages(sessionId)
  }
  const cleanups = [
    chatClient.onStreamUpdated((payload) => {
      const blocks = payload.blocks as AssistantMessageBlock[]
      if (payload.sessionId !== options.getActiveSessionId()) {
        return
      }

      const streamMessageId = payload.messageId ?? payload.requestId
      options.setStreamingState({
        sessionId: payload.sessionId,
        messageId: streamMessageId,
        blocks
      })

      if (streamMessageId && !options.isEphemeralStreamMessageId(streamMessageId)) {
        options.applyStreamingBlocksToMessage(streamMessageId, payload.sessionId, blocks)
      }
    }),
    chatClient.onStreamCompleted((payload) => {
      if (payload.sessionId !== options.getActiveSessionId()) {
        return
      }

      reloadPersistedMessages(payload.sessionId)
    }),
    chatClient.onStreamFailed((payload) => {
      if (payload.sessionId !== options.getActiveSessionId()) {
        return
      }

      reloadPersistedMessages(payload.sessionId)
    })
  ]

  scope.on(STREAM_EVENTS.END, (_event, payload: { conversationId?: string | null }) => {
    if (!payload?.conversationId || payload.conversationId !== options.getActiveSessionId()) {
      return
    }

    reloadPersistedMessages(payload.conversationId)
  })

  scope.on(STREAM_EVENTS.ERROR, (_event, payload: { conversationId?: string | null }) => {
    if (!payload?.conversationId || payload.conversationId !== options.getActiveSessionId()) {
      return
    }

    reloadPersistedMessages(payload.conversationId)
  })

  return () => {
    for (const cleanup of cleanups) {
      cleanup()
    }
    scope.cleanup()
  }
}
