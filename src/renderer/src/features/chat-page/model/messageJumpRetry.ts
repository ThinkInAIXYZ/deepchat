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
export function shouldRetryMessageJump(input: {
  attempt: number
  maxAttempts: number
  gestureSeqAtStart: number
  currentGestureSeq: number
}): boolean {
  if (input.attempt >= input.maxAttempts) return false
  return input.currentGestureSeq === input.gestureSeqAtStart
}
