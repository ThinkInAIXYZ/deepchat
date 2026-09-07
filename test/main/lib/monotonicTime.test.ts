import { describe, expect, it, vi } from 'vitest'
import { elapsedMonotonicBetween, elapsedMonotonicMs, readMonotonicNow } from '@/lib/monotonicTime'

describe('monotonic time diagnostics', () => {
  it('returns elapsed time for valid monotonic readings', () => {
    expect(readMonotonicNow(() => 10)).toBe(10)
    expect(elapsedMonotonicBetween(10, 25)).toBe(15)
    expect(elapsedMonotonicMs(10, () => 25)).toBe(15)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'rejects an invalid reading without throwing: %s',
    (value) => {
      expect(readMonotonicNow(() => value)).toBeUndefined()
    }
  )

  it('omits elapsed time when the clock throws or moves backwards', () => {
    const throwingClock = vi.fn(() => {
      throw new Error('clock unavailable')
    })

    expect(readMonotonicNow(throwingClock)).toBeUndefined()
    expect(elapsedMonotonicMs(10, throwingClock)).toBeUndefined()
    expect(elapsedMonotonicBetween(10, 9)).toBeUndefined()
    expect(elapsedMonotonicMs(10, () => 9)).toBeUndefined()
  })

  it('does not read the clock when the start is unavailable', () => {
    const now = vi.fn(() => 10)

    expect(elapsedMonotonicMs(undefined, now)).toBeUndefined()
    expect(now).not.toHaveBeenCalled()
  })
})
