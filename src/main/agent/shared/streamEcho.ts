import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { RateLimitQueueSnapshot } from '@shared/types/provider'
import type { StreamState, IoParams } from './messageStream'
import { createThrottle } from '@shared/utils/throttle'

const RENDERER_FLUSH_INTERVAL = 120
const DB_FLUSH_INTERVAL = 600

export interface EchoHandle {
  schedule(): void
  rescheduleRenderer(): void
  flush(): boolean
  stop(): void
}

export function startEcho(state: StreamState, io: IoParams): EchoHandle {
  function flushToRenderer(): void {
    io.output.streamSnapshot({
      kind: 'snapshot',
      requestId: io.requestId,
      sessionId: io.sessionId,
      messageId: io.messageId,
      providerId: io.providerId,
      modelId: io.modelId,
      updatedAt: Date.now(),
      revision: state.blocksRevision,
      blocks: state.blocks
    })
  }

  function flushToDb(): boolean {
    try {
      io.messageStore.updateAssistantContent(io.messageId, state.blocks)
      return true
    } catch (err) {
      console.error('Failed to flush stream content to DB:', err)
      return false
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
    flush(): boolean {
      flushToRenderer()
      const persisted = flushToDb()
      if (persisted) state.dirty = false
      return persisted
    },
    stop(): void {
      rendererThrottle.cancel()
      dbThrottle.cancel()
    }
  }
}

export function createRateLimitBlock(
  snapshot: Pick<RateLimitQueueSnapshot, 'providerId' | 'estimatedWaitTime'> &
    Partial<Pick<RateLimitQueueSnapshot, 'qpsLimit' | 'currentQps' | 'queueLength'>>
): AssistantMessageBlock {
  const block: AssistantMessageBlock = {
    type: 'action',
    action_type: 'rate_limit',
    content: '',
    status: 'pending',
    timestamp: Date.now(),
    extra: {
      providerId: snapshot.providerId,
      ...(snapshot.qpsLimit === undefined ? {} : { qpsLimit: snapshot.qpsLimit }),
      ...(snapshot.currentQps === undefined ? {} : { currentQps: snapshot.currentQps }),
      ...(snapshot.queueLength === undefined ? {} : { queueLength: snapshot.queueLength }),
      estimatedWaitTime: snapshot.estimatedWaitTime
    }
  }

  return block
}
