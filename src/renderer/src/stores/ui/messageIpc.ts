import { createChatClient } from '../../../api/ChatClient'
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
  applyStreamingBlocksToMessage?: (
    messageId: string,
    sessionId: string,
    blocks: AssistantMessageBlock[]
  ) => void
  isEphemeralStreamMessageId: (messageId: string) => boolean
}

export function bindMessageStoreIpc(options: BindMessageStoreIpcOptions): () => void {
  const chatClient = createChatClient()
  const reloadPersistedMessages = (sessionId: string) => {
    // Streaming blocks were folded into the message record in place during
    // generation (applyStreamingBlocksToMessage), so the record already exists and
    // stays mounted. Clearing the stream flag first just stops the high-frequency
    // mutation; loadMessages then swaps the same id to its persisted copy. Same
    // node throughout — no blank, no remount.
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

      if (
        streamMessageId &&
        options.applyStreamingBlocksToMessage &&
        !options.isEphemeralStreamMessageId(streamMessageId)
      ) {
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
