/**
 * Retry policy for jumping to a message.
 *
 * A jump requests an explicit navigation scroll, and explicit navigations are accepted
 * unconditionally by the scroll controller — that is what lets them preempt passive work. The same
 * property makes a retry loop dangerous: if the user wheels or touches the list while we are still
 * retrying, a re-issued request would override the cancellation their gesture just performed and
 * pull the viewport back to the target.
 *
 * The controller exposes no "user gestured since X" counter, so the caller counts gestures and
 * passes both values in. A retry is only allowed while the user has not gestured since the jump
 * started.
 */
export function canAttemptMessageJump(input: {
  attempt: number
  gestureSeqAtStart: number
  currentGestureSeq: number
}): boolean {
  // The first attempt is the user's own action and always runs. Every later attempt would re-issue
  // an explicit navigation, so it may only run while the user has not gestured since the jump
  // started — the guard must be consulted BEFORE the request, not after it.
  return input.attempt === 0 || input.currentGestureSeq === input.gestureSeqAtStart
}

export function shouldRetryMessageJump(input: {
  attempt: number
  maxAttempts: number
  gestureSeqAtStart: number
  currentGestureSeq: number
}): boolean {
  if (input.attempt >= input.maxAttempts) return false
  return input.currentGestureSeq === input.gestureSeqAtStart
}

/**
 * True once a newer jump has taken over from this one.
 *
 * A fresh jump clears the pending retry timers when it starts, which covers every timer that already
 * exists. It does not cover a jump that is still awaiting the DOM at that moment: such a jump
 * resumes afterwards and can register a *new* timer for its own message, and that timer would later
 * re-issue an explicit navigation and pull the viewport back to a message the user has moved past.
 * Every await inside a jump must therefore re-check its generation before acting.
 */
export function isSupersededMessageJump(input: {
  jumpSeqAtStart: number
  currentJumpSeq: number
}): boolean {
  return input.currentJumpSeq !== input.jumpSeqAtStart
}
