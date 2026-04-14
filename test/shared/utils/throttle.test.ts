import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createThrottle } from '@shared/utils/throttle'

describe('createThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('executes immediately on first call', () => {
    const fn = vi.fn()
    const throttled = createThrottle(fn, 100)

    throttled()

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('throttles subsequent calls within interval', () => {
    const fn = vi.fn()
    const throttled = createThrottle(fn, 100)

    throttled() // immediate
    throttled() // scheduled
    throttled() // ignored (already scheduled)

    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(100)

    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('allows execution after interval has passed', () => {
    const fn = vi.fn()
    const throttled = createThrottle(fn, 100)

    throttled()
    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(100)

    throttled()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('flush() runs immediately regardless of interval', () => {
    const fn = vi.fn()
    const throttled = createThrottle(fn, 100)

    throttled() // immediate
    throttled() // scheduled

    expect(fn).toHaveBeenCalledTimes(1)

    throttled.flush()

    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('flush() clears pending timer', () => {
    const fn = vi.fn()
    const throttled = createThrottle(fn, 100)

    throttled() // immediate
    throttled() // scheduled

    throttled.flush() // runs + clears pending

    vi.advanceTimersByTime(200)

    // Should not fire again (timer was cleared by flush)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('cancel() prevents pending execution', () => {
    const fn = vi.fn()
    const throttled = createThrottle(fn, 100)

    throttled() // immediate
    throttled() // scheduled

    throttled.cancel()

    vi.advanceTimersByTime(200)

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('reschedule() resets the trailing timer from now', () => {
    const fn = vi.fn()
    const throttled = createThrottle(fn, 100)

    throttled() // immediate

    vi.advanceTimersByTime(40)
    throttled.reschedule()

    vi.advanceTimersByTime(99)
    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
