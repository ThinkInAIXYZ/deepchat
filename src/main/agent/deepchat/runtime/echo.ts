import type { StreamState, IoParams } from './types'
import { createThrottle } from '@shared/utils/throttle'
import { cloneBlocksForRenderer } from '@/session/clientMessageProjection'

const RENDERER_FLUSH_INTERVAL = 120
const DB_FLUSH_INTERVAL = 600

export interface EchoHandle {
  schedule(): void
  rescheduleRenderer(): void
  flush(): void
  stop(): void
}

export function startEcho(state: StreamState, io: IoParams): EchoHandle {
  function flushToRenderer(): void {
    const renderedBlocks = cloneBlocksForRenderer(state.blocks)
    io.publishEvent('chat.stream.updated', {
      kind: 'snapshot',
      requestId: io.requestId,
      sessionId: io.sessionId,
      messageId: io.messageId,
      providerId: io.providerId,
      modelId: io.modelId,
      updatedAt: Date.now(),
      blocks: renderedBlocks
    })
  }

  function flushToDb(): void {
    try {
      io.messageStore.updateAssistantContent(io.messageId, state.blocks)
    } catch (err) {
      console.error('Failed to flush stream content to DB:', err)
    }
  }

  const rendererThrottle = createThrottle(() => {
    if (state.dirty) {
      flushToRenderer()
    }
  }, RENDERER_FLUSH_INTERVAL)

  const dbThrottle = createThrottle(() => {
    if (state.dirty) {
      flushToDb()
    }
  }, DB_FLUSH_INTERVAL)

  return {
    schedule(): void {
      if (!state.dirty) {
        return
      }

      rendererThrottle()
      dbThrottle()
    },
    rescheduleRenderer(): void {
      if (!state.dirty) {
        return
      }

      rendererThrottle.reschedule()
      dbThrottle()
    },
    flush(): void {
      flushToRenderer()
      flushToDb()
      state.dirty = false
    },
    stop(): void {
      rendererThrottle.cancel()
      dbThrottle.cancel()
    }
  }
}
