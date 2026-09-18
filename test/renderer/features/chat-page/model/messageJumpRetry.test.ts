import { describe, expect, it } from 'vitest'
import {
  canAttemptMessageJump,
  shouldRetryMessageJump
} from '@/features/chat-page/model/messageJumpRetry'

describe('shouldRetryMessageJump', () => {
  it('allows retries while the user has not interacted', () => {
    expect(
      shouldRetryMessageJump({
        attempt: 0,
        maxAttempts: 8,
        gestureSeqAtStart: 4,
        currentGestureSeq: 4
      })
    ).toBe(true)
  })

  it('refuses to retry once the user has gestured since the jump started', () => {
    // This is the wheel-stealing case: a retry would re-issue an explicit navigation that the
    // controller accepts unconditionally, overriding the gesture's own cancellation.
    expect(
      shouldRetryMessageJump({
        attempt: 0,
        maxAttempts: 8,
        gestureSeqAtStart: 4,
        currentGestureSeq: 5
      })
    ).toBe(false)
  })

  it('stops at the attempt budget', () => {
    expect(
      shouldRetryMessageJump({
        attempt: 8,
        maxAttempts: 8,
        gestureSeqAtStart: 4,
        currentGestureSeq: 4
      })
    ).toBe(false)
  })
})

describe('canAttemptMessageJump', () => {
  it('always allows the first attempt, which is the user action itself', () => {
    expect(canAttemptMessageJump({ attempt: 0, gestureSeqAtStart: 0, currentGestureSeq: 3 })).toBe(
      true
    )
  })

  it('blocks a retry once the user has gestured since the jump started', () => {
    expect(canAttemptMessageJump({ attempt: 1, gestureSeqAtStart: 4, currentGestureSeq: 5 })).toBe(
      false
    )
  })

  it('allows a retry while the user has stayed out of the way', () => {
    expect(canAttemptMessageJump({ attempt: 3, gestureSeqAtStart: 4, currentGestureSeq: 4 })).toBe(
      true
    )
  })
})
