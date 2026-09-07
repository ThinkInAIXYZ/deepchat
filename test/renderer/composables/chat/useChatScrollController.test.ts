import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { useChatScrollController } from '@/composables/chat/useChatScrollController'

describe('useChatScrollController', () => {
  let callbacks: Map<number, FrameRequestCallback>
  let nextFrameId: number

  const flushFrame = () => {
    const pending = Array.from(callbacks.values())
    callbacks.clear()
    pending.forEach((callback) => callback(0))
  }

  beforeEach(() => {
    callbacks = new Map()
    nextFrameId = 1
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = nextFrameId
      nextFrameId += 1
      callbacks.set(id, callback)
      return id
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      callbacks.delete(id)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function setup() {
    let scrollTop = 0
    let autoFollowEnabled = true
    const writes: number[] = []
    const viewport = document.createElement('div')
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, get: () => 500 })
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, get: () => 1500 })
    Object.defineProperty(viewport, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value
        writes.push(value)
      }
    })
    const controller = useChatScrollController({
      viewport: shallowRef(viewport),
      canAutoFollow: () => autoFollowEnabled,
      resolveMessageTop: (messageId) => (messageId === 'm1' ? 360 : null)
    })
    const epoch = controller.beginSession('s1')
    return {
      controller,
      epoch,
      writes,
      getScrollTop: () => scrollTop,
      setScrollTop: (value: number) => {
        scrollTop = value
      },
      setAutoFollowEnabled: (enabled: boolean) => {
        autoFollowEnabled = enabled
      }
    }
  }

  it('commits at most one operation in a frame and drops lower-priority competitors', () => {
    const { controller, epoch, writes } = setup()

    const followId = controller.request({
      sessionEpoch: epoch,
      reason: 'auto-follow',
      target: { kind: 'bottom' }
    })
    const measureId = controller.request({
      sessionEpoch: epoch,
      reason: 'measurement-anchor',
      target: { kind: 'absolute', top: 200 }
    })

    expect(followId).not.toBeNull()
    expect(measureId).toBeNull()
    flushFrame()
    expect(writes).toEqual([1000])
  })

  it('holds exclusive ownership across frames until completion verification', () => {
    const { controller, epoch, writes } = setup()
    controller.request({
      sessionEpoch: epoch,
      reason: 'session-restore',
      target: { kind: 'bottom' }
    })
    flushFrame()
    expect(controller.activeOperation.value?.reason).toBe('session-restore')

    expect(
      controller.request({
        sessionEpoch: epoch,
        reason: 'auto-follow',
        target: { kind: 'absolute', top: 300 }
      })
    ).toBeNull()
    expect(writes).toEqual([1000])

    flushFrame()
    expect(controller.activeOperation.value).toBeNull()
  })

  it('atomically replaces an active passive operation with explicit navigation', () => {
    const { controller, epoch, writes } = setup()
    controller.request({
      sessionEpoch: epoch,
      reason: 'session-restore',
      target: { kind: 'bottom' }
    })
    flushFrame()

    controller.request({
      sessionEpoch: epoch,
      reason: 'search-navigation',
      target: { kind: 'message', messageId: 'm1', align: 'center' }
    })
    flushFrame()

    expect(writes).toEqual([1000, 110])
    expect(controller.activeOperation.value?.reason).toBe('search-navigation')
  })

  it('cancels active and queued operations before a user gesture can be overwritten', () => {
    const { controller, epoch, writes } = setup()
    controller.request({
      sessionEpoch: epoch,
      reason: 'session-restore',
      target: { kind: 'bottom' }
    })

    controller.notifyUserGestureStart('wheel')
    flushFrame()

    expect(writes).toEqual([])
    expect(controller.activeOperation.value).toBeNull()
    expect(controller.state.value.userOwned).toBe(true)
  })

  it('rejects passive work while the user owns the viewport but accepts explicit navigation', () => {
    const { controller, epoch } = setup()
    controller.notifyUserGestureStart('wheel')

    expect(
      controller.request({
        sessionEpoch: epoch,
        reason: 'auto-follow',
        target: { kind: 'bottom' }
      })
    ).toBeNull()
    expect(
      controller.request({
        sessionEpoch: epoch,
        reason: 'history-prepend',
        target: { kind: 'absolute', top: 200 }
      })
    ).toBeNull()
    expect(
      controller.request({
        sessionEpoch: epoch,
        reason: 'spotlight-navigation',
        target: { kind: 'message', messageId: 'm1', align: 'one-third' }
      })
    ).not.toBeNull()
  })

  it('discards stale asynchronous requests from a previous session epoch', () => {
    const { controller, epoch, writes } = setup()
    controller.beginSession('s2')

    expect(
      controller.request({
        sessionEpoch: epoch,
        reason: 'search-navigation',
        target: { kind: 'absolute', top: 400 }
      })
    ).toBeNull()
    flushFrame()
    expect(writes).toEqual([])
  })

  it('allows at most one immediate physical write before the next frame boundary', () => {
    const { controller, epoch, writes } = setup()

    controller.requestImmediate({
      sessionEpoch: epoch,
      reason: 'session-restore',
      target: { kind: 'absolute', top: 200 }
    })
    controller.requestImmediate({
      sessionEpoch: epoch,
      reason: 'session-restore',
      target: { kind: 'absolute', top: 300 }
    })

    expect(writes).toEqual([200])
    flushFrame()
    expect(writes).toEqual([200, 300])
  })

  it('allows a later immediate write after the next frame boundary', () => {
    const { controller, epoch, writes } = setup()

    controller.requestImmediate({
      sessionEpoch: epoch,
      reason: 'session-restore',
      target: { kind: 'absolute', top: 200 }
    })
    flushFrame()

    controller.requestImmediate({
      sessionEpoch: epoch,
      reason: 'session-restore',
      target: { kind: 'absolute', top: 300 }
    })

    expect(writes).toEqual([200, 300])
  })

  it('attributes the matching scroll event to the committed request', () => {
    const { controller, epoch } = setup()
    controller.requestImmediate({
      sessionEpoch: epoch,
      reason: 'session-restore',
      target: { kind: 'absolute', top: 200 }
    })

    expect(controller.notifyViewportScroll()).toBe('programmatic')
    expect(controller.activeOperation.value).toBeNull()
    expect(controller.state.value.userOwned).toBe(false)
  })

  it('does not let viewport resize steal a user-owned reading position', () => {
    const { controller, epoch, writes } = setup()
    controller.notifyUserGestureStart('wheel')
    controller.notifyUserGestureEnd()

    expect(controller.notifyViewportResize()).toBeNull()
    expect(
      controller.request({
        sessionEpoch: epoch,
        reason: 'auto-follow',
        target: { kind: 'bottom' }
      })
    ).toBeNull()
    flushFrame()
    expect(writes).toEqual([])
  })

  it('does not surrender reading ownership for a layout scroll near the bottom', () => {
    const { controller, setScrollTop } = setup()
    controller.notifyUserGestureStart('wheel')
    controller.notifyUserGestureEnd()
    setScrollTop(995)

    expect(controller.notifyViewportScroll()).toBe('user')
    expect(controller.state.value.mode).toBe('reading')
    expect(controller.state.value.userOwned).toBe(true)
  })

  it('rejects resize-driven following when auto-scroll is disabled', () => {
    const { controller, epoch, writes, setAutoFollowEnabled } = setup()
    controller.requestImmediate({
      sessionEpoch: epoch,
      reason: 'session-restore',
      target: { kind: 'bottom' }
    })
    controller.notifyViewportScroll()
    setAutoFollowEnabled(false)

    expect(controller.notifyViewportResize()).toBeNull()
    flushFrame()
    expect(writes).toEqual([1000])
  })

  it('keeps the first upward frame near bottom user-owned after idle and resize', () => {
    const { controller, epoch, writes, setScrollTop } = setup()
    controller.requestImmediate({
      sessionEpoch: epoch,
      reason: 'session-restore',
      target: { kind: 'bottom' }
    })
    controller.notifyViewportScroll()
    controller.notifyUserGestureStart('wheel')
    setScrollTop(980)
    expect(controller.notifyViewportScroll()).toBe('user')
    expect(controller.state.value.mode).toBe('reading')
    setScrollTop(700)
    controller.notifyViewportScroll()
    controller.notifyUserGestureEnd()
    expect(controller.notifyViewportResize()).toBeNull()
    flushFrame()
    expect(writes).toEqual([1000])
    expect(controller.state.value.userOwned).toBe(true)
  })

  it('detects downward return when wheel handlers see the already applied scroll', () => {
    const { controller, epoch, setScrollTop } = setup()
    controller.requestImmediate({
      sessionEpoch: epoch,
      reason: 'session-restore',
      target: { kind: 'bottom' }
    })
    controller.notifyViewportScroll()

    // Passive wheel delivery can follow compositor scrolling, unlike the
    // gesture-before-movement ordering exercised by the other input tests.
    for (const top of [960, 850, 900, 950]) {
      setScrollTop(top)
      controller.notifyUserGestureStart('wheel')
      expect(controller.notifyViewportScroll()).toBe('user')
      expect(controller.state.value.mode).toBe(top === 950 ? 'following' : 'reading')
    }
    controller.notifyUserGestureEnd()
    expect(controller.notifyViewportResize()).not.toBeNull()
  })

  it('resumes on downward return and cancels queued following on same-gesture reversal', () => {
    const { controller, epoch, writes, setScrollTop } = setup()
    setScrollTop(700)
    controller.notifyUserGestureStart('pointer')
    setScrollTop(920)
    controller.notifyViewportScroll()
    expect(controller.state.value.mode).toBe('following')
    expect(
      controller.request({ sessionEpoch: epoch, reason: 'auto-follow', target: { kind: 'bottom' } })
    ).not.toBeNull()
    setScrollTop(910)
    controller.notifyViewportScroll()
    expect(controller.state.value.mode).toBe('reading')
    expect(controller.activeOperation.value).toBeNull()
    controller.notifyUserGestureEnd()
    flushFrame()
    expect(writes).toEqual([])
  })

  it.each([1000, 1040])('does not resume following for bottom bounce starting at %s', (top) => {
    const { controller, setScrollTop } = setup()
    setScrollTop(top)
    controller.notifyUserGestureStart('touch')
    for (const position of [1060, 1020, 1000]) {
      setScrollTop(position)
      controller.notifyViewportScroll()
      expect(controller.state.value.mode).toBe('reading')
    }
  })

  it.each([true, false])(
    'syncs a submit baseline with physical write=%s during a gesture',
    (write) => {
      const { controller, epoch, setScrollTop } = setup()
      setScrollTop(700)
      controller.notifyUserGestureStart('pointer')
      if (!write) setScrollTop(1000)
      controller.requestImmediate({
        sessionEpoch: epoch,
        reason: 'submit',
        target: { kind: 'bottom' }
      })
      if (write) expect(controller.notifyViewportScroll()).toBe('programmatic')
      expect(controller.state.value.mode).toBe('following')
      setScrollTop(980)
      controller.notifyViewportScroll()
      expect(controller.state.value.mode).toBe('reading')
    }
  )

  it('uses the new session gesture position rather than the previous session sample', () => {
    const { controller, setScrollTop } = setup()
    setScrollTop(1000)
    controller.notifyViewportScroll()
    controller.beginSession('s2')
    setScrollTop(900)
    controller.notifyUserGestureStart('keyboard')
    setScrollTop(940)
    controller.notifyViewportScroll()
    expect(controller.state.value.mode).toBe('following')
  })

  it('uses the actual fractional position when a submit needs no write', () => {
    const { controller, epoch, writes, setScrollTop } = setup()
    setScrollTop(999.5)
    controller.notifyUserGestureStart('pointer')
    controller.requestImmediate({
      sessionEpoch: epoch,
      reason: 'submit',
      target: { kind: 'bottom' }
    })
    setScrollTop(999.75)
    controller.notifyViewportScroll()
    expect(controller.state.value.mode).toBe('following')
    expect(writes).toEqual([])
  })

  it('coalesces a following viewport resize into the exclusive bottom owner', () => {
    const { controller, epoch, writes } = setup()
    controller.requestImmediate({
      sessionEpoch: epoch,
      reason: 'session-restore',
      target: { kind: 'bottom' }
    })
    controller.notifyViewportScroll()

    expect(controller.state.value.mode).toBe('following')
    expect(controller.notifyViewportResize()).not.toBeNull()
    flushFrame()
    expect(writes).toEqual([1000])
  })
})
