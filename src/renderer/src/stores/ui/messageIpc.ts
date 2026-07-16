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
  generation: number
}

type StreamRequestState = {
  generation: number
  settled: boolean
}

type StreamSessionState = {
  current: StreamCursor | null
  latestAcceptedGeneration: number
  nextGeneration: number
  requests: Map<string, StreamRequestState>
}

type MessageStoreIpcBinding = {
  cleanup: () => void
  purgeSessionTracking: (sessionId: string) => void
}

export function bindMessageStoreIpc(options: BindMessageStoreIpcOptions): MessageStoreIpcBinding {
  const chatClient = createChatClient()
  // Request entries are tombstones. Keep them until permanent session removal so
  // a known older request cannot become current again after a newer request arrives.
  const streamSessions = new Map<string, StreamSessionState>()

  const getStreamSessionState = (sessionId: string): StreamSessionState => {
    const existing = streamSessions.get(sessionId)
    if (existing) return existing

    const created: StreamSessionState = {
      current: null,
      latestAcceptedGeneration: 0,
      nextGeneration: 0,
      requests: new Map()
    }
    streamSessions.set(sessionId, created)
    return created
  }

  const getStreamRequestState = (
    session: StreamSessionState,
    requestId: string
  ): StreamRequestState => {
    const existing = session.requests.get(requestId)
    if (existing) return existing

    session.nextGeneration += 1
    const created: StreamRequestState = {
      generation: session.nextGeneration,
      settled: false
    }
    session.requests.set(requestId, created)
    return created
  }

  const acceptStreamUpdate = (payload: {
    sessionId: string
    requestId: string
    updatedAt: number
  }): boolean => {
    const session = getStreamSessionState(payload.sessionId)
    const request = getStreamRequestState(session, payload.requestId)
    if (request.settled || request.generation < session.latestAcceptedGeneration) return false

    if (request.generation === session.latestAcceptedGeneration) {
      if (!session.current || session.current.requestId !== payload.requestId) return false
      if (payload.updatedAt < session.current.updatedAt) return false
    }

    session.latestAcceptedGeneration = request.generation
    session.current = {
      requestId: payload.requestId,
      updatedAt: payload.updatedAt,
      generation: request.generation
    }
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
    const session = getStreamSessionState(payload.sessionId)
    const request = getStreamRequestState(session, payload.requestId)
    if (request.settled) return
    request.settled = true

    options.invalidateRecentSessionView(payload.sessionId)

    if (session.current?.requestId === payload.requestId) {
      session.current = null
    } else if (session.current || request.generation < session.latestAcceptedGeneration) {
      return
    } else {
      session.latestAcceptedGeneration = request.generation
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

  return {
    cleanup: () => {
      for (const cleanup of cleanups) {
        cleanup()
      }
      streamSessions.clear()
    },
    purgeSessionTracking: (sessionId: string) => {
      streamSessions.delete(sessionId)
    }
  }
}
