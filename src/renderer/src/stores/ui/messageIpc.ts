import { ChatClient } from '../../../api/ChatClient'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'

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

  return () => {
    for (const cleanup of cleanups) {
      cleanup()
    }
  }
}
