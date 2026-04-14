import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { StreamState, IoParams } from '@/presenter/agentRuntimePresenter/types'
import { createState } from '@/presenter/agentRuntimePresenter/types'

vi.mock('@/eventbus', () => ({
  eventBus: { sendToRenderer: vi.fn() },
  SendTarget: { ALL_WINDOWS: 'all' }
}))

vi.mock('@/events', () => ({
  STREAM_EVENTS: {
    RESPONSE: 'stream:response',
    END: 'stream:end',
    ERROR: 'stream:error'
  }
}))

import { cloneBlocksForRenderer, startEcho } from '@/presenter/agentRuntimePresenter/echo'
import { eventBus } from '@/eventbus'

function createIo(): IoParams {
  return {
    sessionId: 's1',
    messageId: 'm1',
    messageStore: {
      updateAssistantContent: vi.fn()
    } as any,
    abortSignal: new AbortController().signal
  }
}

describe('echo', () => {
  let state: StreamState
  let io: IoParams

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(0))
    vi.clearAllMocks()
    state = createState()
    io = createIo()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes to renderer through schedule when dirty', () => {
    const echo = startEcho(state, io)

    state.dirty = true
    state.blocks.push({ type: 'content', content: 'hi', status: 'pending', timestamp: Date.now() })
    echo.schedule()

    vi.advanceTimersByTime(130)

    expect(eventBus.sendToRenderer).toHaveBeenCalledWith(
      'stream:response',
      'all',
      expect.objectContaining({
        conversationId: 's1',
        messageId: 'm1',
        eventId: 'm1',
        blocks: expect.any(Array)
      })
    )

    echo.stop()
  })

  it('flushes to DB through schedule when dirty', () => {
    const echo = startEcho(state, io)

    state.dirty = true
    state.blocks.push({ type: 'content', content: 'hi', status: 'pending', timestamp: Date.now() })
    echo.schedule()

    vi.advanceTimersByTime(610)

    expect(io.messageStore.updateAssistantContent).toHaveBeenCalled()

    echo.stop()
  })

  it('does not flush when not dirty', () => {
    const echo = startEcho(state, io)

    echo.schedule()
    vi.advanceTimersByTime(1000)

    expect(eventBus.sendToRenderer).not.toHaveBeenCalled()
    expect(io.messageStore.updateAssistantContent).not.toHaveBeenCalled()

    echo.stop()
  })

  it('flush() writes immediately', () => {
    const echo = startEcho(state, io)

    state.blocks.push({ type: 'content', content: 'hi', status: 'pending', timestamp: Date.now() })
    state.dirty = true

    echo.flush()

    expect(eventBus.sendToRenderer).toHaveBeenCalledWith(
      'stream:response',
      'all',
      expect.objectContaining({
        conversationId: 's1',
        messageId: 'm1',
        eventId: 'm1',
        blocks: expect.any(Array)
      })
    )
    expect(io.messageStore.updateAssistantContent).toHaveBeenCalled()
    expect(state.dirty).toBe(false)

    echo.stop()
  })

  it('stop() cancels pending throttled work', () => {
    const echo = startEcho(state, io)

    state.dirty = true
    state.blocks.push({ type: 'content', content: 'hi', status: 'pending', timestamp: Date.now() })
    echo.schedule()
    echo.stop()

    vi.advanceTimersByTime(1000)

    // Nothing should have been flushed after stop
    expect(eventBus.sendToRenderer).not.toHaveBeenCalled()
    expect(io.messageStore.updateAssistantContent).not.toHaveBeenCalled()
  })

  it('coalesces repeated schedule calls into one renderer flush per interval window', () => {
    const echo = startEcho(state, io)

    state.dirty = true
    state.blocks.push({ type: 'content', content: 'hi', status: 'pending', timestamp: Date.now() })

    echo.schedule()
    echo.schedule()
    echo.schedule()

    vi.advanceTimersByTime(130)

    expect(eventBus.sendToRenderer).toHaveBeenCalledTimes(1)
    echo.stop()
  })

  it('rescheduleRenderer() resets the renderer flush window from the latest interaction', () => {
    const echo = startEcho(state, io)

    state.dirty = true
    state.blocks.push({ type: 'content', content: 'hi', status: 'pending', timestamp: Date.now() })

    echo.schedule()
    vi.advanceTimersByTime(130)
    expect(eventBus.sendToRenderer).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(40)
    echo.rescheduleRenderer()

    vi.advanceTimersByTime(119)
    expect(eventBus.sendToRenderer).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    expect(eventBus.sendToRenderer).toHaveBeenCalledTimes(2)

    echo.stop()
  })

  it('clones renderer blocks with structuredClone semantics', () => {
    const blocks = [
      {
        type: 'content' as const,
        content: 'hi',
        status: 'pending' as const,
        timestamp: 1,
        extra: {
          nested: [{ value: 1 }]
        }
      }
    ]

    const cloned = cloneBlocksForRenderer(blocks)

    expect(cloned).toEqual(blocks)
    expect(cloned).not.toBe(blocks)
    expect(cloned[0]).not.toBe(blocks[0])
    expect(cloned[0]?.extra).not.toBe(blocks[0]?.extra)
    expect(cloned[0]?.extra?.nested).not.toBe(blocks[0]?.extra?.nested)
    expect(cloned[0]?.extra?.nested[0]).not.toBe(blocks[0]?.extra?.nested[0])
  })
})
