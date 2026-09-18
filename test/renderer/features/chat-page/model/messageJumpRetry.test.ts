import { describe, expect, it } from 'vitest'
import { shouldRetryMessageJump } from '@/features/chat-page/model/messageJumpRetry'

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
