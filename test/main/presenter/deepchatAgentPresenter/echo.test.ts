import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { StreamState, IoParams } from '@/presenter/deepchatAgentPresenter/types'
import { createState } from '@/presenter/deepchatAgentPresenter/types'

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

import { startEcho } from '@/presenter/deepchatAgentPresenter/echo'
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
    vi.clearAllMocks()
    state = createState()
    io = createIo()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes to renderer on interval when dirty', () => {
    const echo = startEcho(state, io)

    // Mark dirty
    state.dirty = true
    state.blocks.push({ type: 'content', content: 'hi', status: 'pending', timestamp: Date.now() })

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

  it('flushes to DB on interval when dirty', () => {
    const echo = startEcho(state, io)

    state.dirty = true
    state.blocks.push({ type: 'content', content: 'hi', status: 'pending', timestamp: Date.now() })

    vi.advanceTimersByTime(610)

    expect(io.messageStore.updateAssistantContent).toHaveBeenCalled()

    echo.stop()
  })

  it('does not flush when not dirty', () => {
    const echo = startEcho(state, io)

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

  it('stop() clears intervals', () => {
    const echo = startEcho(state, io)

    echo.stop()

    state.dirty = true
    state.blocks.push({ type: 'content', content: 'hi', status: 'pending', timestamp: Date.now() })

    vi.advanceTimersByTime(1000)

    // Nothing should have been flushed after stop
    expect(eventBus.sendToRenderer).not.toHaveBeenCalled()
    expect(io.messageStore.updateAssistantContent).not.toHaveBeenCalled()
  })
})
