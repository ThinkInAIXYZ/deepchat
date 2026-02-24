import type { StreamState, IoParams } from './types'
import { createThrottle } from '@shared/utils/throttle'
import { eventBus, SendTarget } from '@/eventbus'
import { STREAM_EVENTS } from '@/events'

const RENDERER_FLUSH_INTERVAL = 120
const DB_FLUSH_INTERVAL = 600

export interface EchoHandle {
  flush(): void
  stop(): void
}

export function startEcho(state: StreamState, io: IoParams): EchoHandle {
  function flushToRenderer(): void {
    eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, {
      conversationId: io.sessionId,
      blocks: JSON.parse(JSON.stringify(state.blocks))
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

  const rendererTimer = setInterval(rendererThrottle, RENDERER_FLUSH_INTERVAL)
  const dbTimer = setInterval(dbThrottle, DB_FLUSH_INTERVAL)

  return {
    flush(): void {
      flushToRenderer()
      flushToDb()
      state.dirty = false
    },
    stop(): void {
      clearInterval(rendererTimer)
      clearInterval(dbTimer)
      rendererThrottle.cancel()
      dbThrottle.cancel()
    }
  }
}
