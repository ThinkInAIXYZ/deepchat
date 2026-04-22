import { createChatClient } from '../../../api/ChatClient'
import { onLegacyIpcChannel } from '@api/legacy/runtime'
import { STREAM_EVENTS } from '@/events'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'

interface BindMessageStoreIpcOptions {
  getActiveSessionId: () => string | null
  setStreamingState: (payload: {
    sessionId: string
    messageId?: string
    blocks: AssistantMessageBlock[]
  }) => void
  clearStreamingState: () => void
  loadMessages: (sessionId: string) => void | Promise<unknown>
  applyStreamingBlocksToMessage: (
    messageId: string,
    sessionId: string,
    blocks: AssistantMessageBlock[]
  ) => void
  isEphemeralStreamMessageId: (messageId: string) => boolean
}

export function bindMessageStoreIpc(options: BindMessageStoreIpcOptions): () => void {
  const chatClient = createChatClient()
  const reloadPersistedMessages = (sessionId: string) => {
    options.clearStreamingState()
    void options.loadMessages(sessionId)
  }

  const reloadPersistedMessagesFromLegacyEvent = (payload?: {
    conversationId?: string
    sessionId?: string
  }) => {
    const sessionId = payload?.conversationId ?? payload?.sessionId
    if (!sessionId || sessionId !== options.getActiveSessionId()) {
      return
    }

    reloadPersistedMessages(sessionId)
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
    }),
    onLegacyIpcChannel(STREAM_EVENTS.END, (_event, payload) => {
      reloadPersistedMessagesFromLegacyEvent(payload)
    }),
    onLegacyIpcChannel(STREAM_EVENTS.ERROR, (_event, payload) => {
      reloadPersistedMessagesFromLegacyEvent(payload)
    })
  ]

  return () => {
    for (const cleanup of cleanups) {
      cleanup()
    }
  }
}
