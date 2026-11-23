const PRE_STREAM_SLOW_STEP_MS = 500

export function logSlowPreStreamStep(sessionId: string, step: string, startedAt: number): void {
  const elapsed = Date.now() - startedAt
  if (elapsed < PRE_STREAM_SLOW_STEP_MS) {
    return
  }

  console.warn(
    `[DeepChatAgent] pre-stream step slow session=${sessionId} step=${step} elapsed=${elapsed}ms`
  )
}
