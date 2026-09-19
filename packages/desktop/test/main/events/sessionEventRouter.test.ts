import { describe, expect, it, vi } from 'vitest'
import { SessionEventRouter } from '@/events/sessionEventRouter'

const streamSnapshot = {
  kind: 'snapshot',
  requestId: 'req-1',
  sessionId: 'session-1',
  messageId: 'msg-1',
  updatedAt: 1,
  blocks: []
}

function createRouter(
  overrides: {
    resolveSessionRunId?: (sessionId: string) => string | null | undefined
    getBoundRendererIds?: (sessionId: string) => readonly number[]
  } = {}
) {
  const hub = { publish: vi.fn() }
  const router = new SessionEventRouter({
    hub: hub as any,
    resolveSessionRunId: overrides.resolveSessionRunId ?? vi.fn(() => null),
    getBoundRendererIds: overrides.getBoundRendererIds ?? vi.fn(() => [1] as readonly number[])
  })
  return { hub, router }
}

describe('SessionEventRouter', () => {
  it('scopes known stream events to bound renderers and notifies other windows with a lightweight activity event', () => {
    const { hub, router } = createRouter()

    router.publish('chat.stream.updated', streamSnapshot)

    expect(hub.publish).toHaveBeenCalledWith('chat.stream.updated', streamSnapshot, {
      kind: 'renderer',
      webContentsId: 1
    })
    // Non-bound windows must still learn about the stream so they can
    // invalidate recent-session views (sidebar status badges).
    expect(hub.publish).toHaveBeenCalledWith(
      'chat.stream.activity',
      { sessionId: 'session-1' },
      {
        kind: 'renderer-all'
      }
    )
    expect(hub.publish).toHaveBeenCalledTimes(2)
  })

  it('keeps the broadcast fallback (without a separate activity event) when no renderer is bound', () => {
    const { hub, router } = createRouter({ getBoundRendererIds: () => [] })

    router.publish('chat.stream.updated', streamSnapshot)

    expect(hub.publish).toHaveBeenCalledTimes(1)
    expect(hub.publish).toHaveBeenCalledWith('chat.stream.updated', streamSnapshot, {
      kind: 'renderer-all'
    })
  })

  it('does not emit stream activity for non-stream events routed to all renderers', () => {
    const { hub, router } = createRouter()

    router.publish('sessions.updated', { sessionIds: ['session-1'], reason: 'updated' })

    expect(hub.publish).toHaveBeenCalledTimes(1)
    expect(hub.publish).not.toHaveBeenCalledWith(
      'chat.stream.activity',
      expect.anything(),
      expect.anything()
    )
  })

  it('throttles the activity signal: repeated stream snapshots do not broadcast once per update', () => {
    vi.useFakeTimers()
    try {
      const { hub, router } = createRouter()

      router.publish('chat.stream.updated', streamSnapshot)
      router.publish('chat.stream.updated', streamSnapshot)
      router.publish('chat.stream.updated', streamSnapshot)

      // 3 bound deliveries + 1 throttled activity broadcast for the whole burst.
      expect(hub.publish).toHaveBeenCalledTimes(4)
      expect(hub.publish).toHaveBeenCalledWith(
        'chat.stream.activity',
        { sessionId: 'session-1' },
        { kind: 'renderer-all' }
      )

      // Terminal transitions always notify other windows immediately.
      router.publish('chat.stream.failed', {
        requestId: 'req-1',
        sessionId: 'session-1',
        messageId: 'msg-1',
        failedAt: 2,
        error: 'boom'
      })
      expect(hub.publish).toHaveBeenCalledTimes(6)

      // Once the throttle window elapses, the next snapshot emits again.
      vi.advanceTimersByTime(1_000)
      router.publish('chat.stream.updated', streamSnapshot)
      expect(hub.publish).toHaveBeenCalledTimes(8)
    } finally {
      vi.useRealTimers()
    }
  })
})
