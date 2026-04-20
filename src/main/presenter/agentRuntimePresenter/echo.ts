import type { DeepchatEventPayload } from '@shared/contracts/events'
import { AssistantMessageBlockSchema } from '@shared/contracts/common'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { StreamState, IoParams } from './types'
import { createThrottle } from '@shared/utils/throttle'
import { eventBus, SendTarget } from '@/eventbus'
import { STREAM_EVENTS } from '@/events'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'

const RENDERER_FLUSH_INTERVAL = 120
const DB_FLUSH_INTERVAL = 600
const RenderedAssistantBlocksSchema = AssistantMessageBlockSchema.array()

export interface EchoHandle {
  schedule(): void
  rescheduleRenderer(): void
  flush(): void
  stop(): void
}

export function cloneBlocksForRenderer(
  blocks: AssistantMessageBlock[]
): DeepchatEventPayload<'chat.stream.updated'>['blocks'] {
  return RenderedAssistantBlocksSchema.parse(JSON.parse(JSON.stringify(blocks)))
}

export function startEcho(state: StreamState, io: IoParams): EchoHandle {
  function flushToRenderer(): void {
    const renderedBlocks = cloneBlocksForRenderer(state.blocks)
    eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, {
      conversationId: io.sessionId,
      eventId: io.messageId,
      messageId: io.messageId,
      blocks: renderedBlocks
    })
    publishDeepchatEvent('chat.stream.updated', {
      kind: 'snapshot',
      requestId: io.requestId,
      sessionId: io.sessionId,
      messageId: io.messageId,
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
