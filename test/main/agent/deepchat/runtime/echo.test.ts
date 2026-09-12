import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { StreamState, IoParams } from '@/agent/deepchat/runtime/types'
import { createState, markStreamChanged } from '@/agent/deepchat/runtime/types'

vi.mock('@/events', () => ({
  STREAM_EVENTS: {
    RESPONSE: 'stream:response',
    END: 'stream:end',
    ERROR: 'stream:error'
  }
}))

import { startEcho } from '@/agent/deepchat/runtime/echo'
import { accumulate } from '@/agent/deepchat/runtime/accumulator'
import { cloneBlocksForRenderer } from '@/session/clientMessageProjection'

const publishDeepchatEvent = vi.fn()

function getStreamUpdatedCalls() {
  return (publishDeepchatEvent as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([eventName]) => eventName === 'chat.stream.updated'
  )
}

function createIo(): IoParams {
  return {
    sessionId: 's1',
    requestId: 'req-1',
    messageId: 'm1',
    providerId: 'acp',
    modelId: 'dimcode',
    messageStore: {
      updateAssistantContent: vi.fn()
    } as any,
    abortSignal: new AbortController().signal,
    publishEvent: publishDeepchatEvent
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

    expect(publishDeepchatEvent).toHaveBeenCalledWith(
      'chat.stream.updated',
      expect.objectContaining({
        kind: 'snapshot',
        requestId: 'req-1',
        sessionId: 's1',
        messageId: 'm1',
        providerId: 'acp',
        modelId: 'dimcode',
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

    expect(publishDeepchatEvent).not.toHaveBeenCalled()
    expect(io.messageStore.updateAssistantContent).not.toHaveBeenCalled()

    echo.stop()
  })

  it('flush() writes immediately', () => {
    const echo = startEcho(state, io)

    state.blocks.push({ type: 'content', content: 'hi', status: 'pending', timestamp: Date.now() })
    state.dirty = true

    echo.flush()

    expect(publishDeepchatEvent).toHaveBeenCalledWith(
      'chat.stream.updated',
      expect.objectContaining({
        kind: 'snapshot',
        requestId: 'req-1',
        sessionId: 's1',
        messageId: 'm1',
        providerId: 'acp',
        modelId: 'dimcode',
        blocks: expect.any(Array)
      })
    )
    expect(io.messageStore.updateAssistantContent).toHaveBeenCalled()
    expect(state.dirty).toBe(false)

    echo.stop()
  })

  it('reports failed DB flushes and keeps pending state dirty', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(io.messageStore.updateAssistantContent).mockImplementation(() => {
      throw new Error('database unavailable')
    })
    const echo = startEcho(state, io)
    state.blocks.push({ type: 'content', content: 'hi', status: 'pending', timestamp: Date.now() })
    state.dirty = true

    expect(echo.flush()).toBe(false)
    expect(state.dirty).toBe(true)
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to flush stream content to DB:',
      expect.objectContaining({ message: 'database unavailable' })
    )

    echo.stop()
    errorSpy.mockRestore()
  })

  it('stop() cancels pending throttled work', () => {
    const echo = startEcho(state, io)

    state.dirty = true
    state.blocks.push({ type: 'content', content: 'hi', status: 'pending', timestamp: Date.now() })
    echo.schedule()
    echo.stop()

    vi.advanceTimersByTime(1000)

    // Nothing should have been flushed after stop
    expect(publishDeepchatEvent).not.toHaveBeenCalled()
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

    expect(getStreamUpdatedCalls()).toHaveLength(1)
    echo.stop()
  })

  it('emits the current blocksRevision with every renderer snapshot', () => {
    const echo = startEcho(state, io)

    state.blocks.push({ type: 'content', content: 'hi', status: 'pending', timestamp: Date.now() })
    markStreamChanged(state)

    echo.flush()
    expect(publishDeepchatEvent).toHaveBeenCalledWith(
      'chat.stream.updated',
      expect.objectContaining({ revision: 1 })
    )

    echo.flush()
    expect(publishDeepchatEvent).toHaveBeenLastCalledWith(
      'chat.stream.updated',
      expect.objectContaining({ revision: 1 })
    )

    state.blocks.push({ type: 'content', content: 'more', status: 'pending', timestamp: Date.now() })
    markStreamChanged(state)
    echo.flush()
    expect(publishDeepchatEvent).toHaveBeenLastCalledWith(
      'chat.stream.updated',
      expect.objectContaining({ revision: 2 })
    )

    echo.stop()
  })

  it('drives a multi-token stream end-to-end with monotonic revisions per dirty bump', () => {
    const echo = startEcho(state, io)

    accumulate(state, { type: 'text', content: 'Hello ' })
    accumulate(state, { type: 'text', content: 'world' })
    echo.schedule()
    vi.advanceTimersByTime(130)
    let flushes = getStreamUpdatedCalls()
    expect(flushes).toHaveLength(1)
    expect(flushes[0]?.[1]).toMatchObject({ revision: 2 })

    vi.advanceTimersByTime(150)
    accumulate(state, { type: 'text', content: '!' })
    echo.schedule()
    vi.advanceTimersByTime(130)
    flushes = getStreamUpdatedCalls()
    expect(flushes).toHaveLength(2)
    expect(flushes[1]?.[1]).toMatchObject({ revision: 3 })

    echo.flush()
    echo.flush()
    flushes = getStreamUpdatedCalls()
    expect(flushes).toHaveLength(4)
    expect(flushes[2]?.[1]).toMatchObject({ revision: 3 })
    expect(flushes[3]?.[1]).toMatchObject({ revision: 3 })

    expect(state.blocksRevision).toBe(3)

    echo.stop()
  })

  it('rescheduleRenderer() resets the renderer flush window from the latest interaction', () => {
    const echo = startEcho(state, io)

    state.dirty = true
    state.blocks.push({ type: 'content', content: 'hi', status: 'pending', timestamp: Date.now() })

    echo.schedule()
    vi.advanceTimersByTime(130)
    expect(getStreamUpdatedCalls()).toHaveLength(1)

    vi.advanceTimersByTime(40)
    echo.rescheduleRenderer()

    vi.advanceTimersByTime(119)
    expect(getStreamUpdatedCalls()).toHaveLength(1)

    vi.advanceTimersByTime(1)
    expect(getStreamUpdatedCalls()).toHaveLength(2)

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

  it('removes undefined JSON fields before validating renderer blocks', () => {
    const blocks = [
      {
        type: 'search' as const,
        status: 'success' as const,
        timestamp: 1,
        extra: {
          label: 'web_search',
          engine: undefined
        }
      }
    ]

    expect(cloneBlocksForRenderer(blocks)[0]?.extra).toEqual({ label: 'web_search' })
  })

  it('keeps opaque provider replay out of renderer snapshots without mutating persistence state', () => {
    const blocks = [
      {
        id: 'ws_1',
        type: 'search' as const,
        status: 'success' as const,
        timestamp: 1,
        extra: {
          actionType: 'search',
          providerReplayJson: JSON.stringify({ private: 'x'.repeat(1024) })
        }
      }
    ]

    const cloned = cloneBlocksForRenderer(blocks)

    expect(cloned[0]?.extra).toEqual({ actionType: 'search' })
    expect(blocks[0]?.extra?.providerReplayJson).toContain('private')
  })
})
