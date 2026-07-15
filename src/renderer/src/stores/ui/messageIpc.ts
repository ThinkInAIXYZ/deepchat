import { createChatClient } from '../../../api/ChatClient'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'

interface BindMessageStoreIpcOptions {
  getActiveSessionId: () => string | null
  getCurrentStreamIdentity: () => {
    sessionId: string | null
    requestId: string | null
  }
  setStreamingState: (payload: {
    sessionId: string
    requestId: string
    messageId?: string
    updatedAt: number
    blocks: AssistantMessageBlock[]
    metadata?: { providerId?: string; modelId?: string }
  }) => void
  clearStreamingState: () => void
  loadMessages: (sessionId: string) => void | Promise<unknown>
  invalidateRecentSessionView: (sessionId: string) => void
  applyStreamingBlocksToMessage?: (
    messageId: string,
    sessionId: string,
    blocks: AssistantMessageBlock[],
    metadata?: { providerId?: string; modelId?: string }
  ) => void
  isEphemeralStreamMessageId: (messageId: string) => boolean
}

type StreamCursor = {
  requestId: string
  updatedAt: number
}

const MAX_SETTLED_STREAMS = 128

export function bindMessageStoreIpc(options: BindMessageStoreIpcOptions): () => void {
  const chatClient = createChatClient()
  const latestStreamBySession = new Map<string, StreamCursor>()
  const settledStreams = new Set<string>()

  const streamKey = (sessionId: string, requestId: string) => `${sessionId}\u0000${requestId}`

  const markStreamSettled = (sessionId: string, requestId: string): boolean => {
    const key = streamKey(sessionId, requestId)
    if (settledStreams.has(key)) return false

    settledStreams.add(key)
    while (settledStreams.size > MAX_SETTLED_STREAMS) {
      const oldestKey = settledStreams.keys().next().value
      if (!oldestKey) break
      settledStreams.delete(oldestKey)
    }
    return true
  }

  const acceptStreamUpdate = (payload: {
    sessionId: string
    requestId: string
    updatedAt: number
  }): boolean => {
    if (settledStreams.has(streamKey(payload.sessionId, payload.requestId))) {
      return false
    }

    const latest = latestStreamBySession.get(payload.sessionId)
    if (latest) {
      if (latest.requestId === payload.requestId && payload.updatedAt < latest.updatedAt) {
        return false
      }
      if (latest.requestId !== payload.requestId && payload.updatedAt <= latest.updatedAt) {
        return false
      }
    }

    latestStreamBySession.set(payload.sessionId, {
      requestId: payload.requestId,
      updatedAt: payload.updatedAt
    })
    return true
  }

  const reloadPersistedMessages = (sessionId: string, clearCurrentStream: boolean) => {
    // Streaming blocks were folded into the message record in place during
    // generation (applyStreamingBlocksToMessage), so the record already exists and
    // stays mounted. Clearing the stream flag first just stops the high-frequency
    // mutation; loadMessages then swaps the same id to its persisted copy. Same
    // node throughout — no blank, no remount.
    if (clearCurrentStream) {
      options.clearStreamingState()
    }
    void options.loadMessages(sessionId)
  }

  const settleStream = (payload: { sessionId: string; requestId: string }) => {
    // requestId is the turn identity; messageId may move from an ephemeral
    // rate-limit row to the persisted assistant row within the same turn.
    if (!markStreamSettled(payload.sessionId, payload.requestId)) {
      return
    }

    options.invalidateRecentSessionView(payload.sessionId)

    const latest = latestStreamBySession.get(payload.sessionId)
    if (latest?.requestId === payload.requestId) {
      latestStreamBySession.delete(payload.sessionId)
    } else if (latest) {
      return
    }

    if (payload.sessionId !== options.getActiveSessionId()) {
      return
    }

    const currentStream = options.getCurrentStreamIdentity()
    if (
      currentStream.sessionId === payload.sessionId &&
      currentStream.requestId &&
      currentStream.requestId !== payload.requestId
    ) {
      return
    }

    reloadPersistedMessages(
      payload.sessionId,
      currentStream.sessionId === payload.sessionId &&
        (!currentStream.requestId || currentStream.requestId === payload.requestId)
    )
  }

  const cleanups = [
    chatClient.onStreamUpdated((payload) => {
      if (!acceptStreamUpdate(payload)) {
        return
      }

      options.invalidateRecentSessionView(payload.sessionId)
      const blocks = payload.blocks as AssistantMessageBlock[]
      if (payload.sessionId !== options.getActiveSessionId()) {
        return
      }

      const streamMessageId = payload.messageId ?? payload.requestId
      options.setStreamingState({
        sessionId: payload.sessionId,
        requestId: payload.requestId,
        messageId: streamMessageId,
        updatedAt: payload.updatedAt,
        blocks,
        metadata: {
          providerId: payload.providerId,
          modelId: payload.modelId
        }
      })

      if (
        streamMessageId &&
        options.applyStreamingBlocksToMessage &&
        !options.isEphemeralStreamMessageId(streamMessageId)
      ) {
        options.applyStreamingBlocksToMessage(streamMessageId, payload.sessionId, blocks, {
          providerId: payload.providerId,
          modelId: payload.modelId
        })
      }
    }),
    chatClient.onStreamCompleted((payload) => {
      settleStream({
        sessionId: payload.sessionId,
        requestId: payload.requestId
      })
    }),
    chatClient.onStreamFailed((payload) => {
      settleStream({
        sessionId: payload.sessionId,
        requestId: payload.requestId
      })
    })
  ]

  return () => {
    for (const cleanup of cleanups) {
      cleanup()
    }
  }
}
