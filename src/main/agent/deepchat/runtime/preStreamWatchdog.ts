import logger from '@shared/logger'

const PRE_STREAM_SLOW_STEP_MS = 500
export const PRE_STREAM_STUCK_WARN_MS = 5_000
export const PRE_STREAM_STUCK_ESCALATION_MS = 30_000

export interface PreStreamBoundary {
  complete(): void
  cancel(): void
}

export interface PreStreamStepInput {
  sessionId: string
  messageId?: string | null
  step: string
  signal?: AbortSignal
}

export function logSlowPreStreamStep(sessionId: string, step: string, startedAt: number): void {
  const elapsed = Date.now() - startedAt
  if (elapsed < PRE_STREAM_SLOW_STEP_MS) {
    return
  }

  logger.warn(
    `[DeepChatAgent] pre-stream step slow session=${sessionId} step=${step} elapsed=${elapsed}ms`
  )
}

function startPreStreamStepWatchdog(input: PreStreamStepInput): PreStreamBoundary {
  const { sessionId, messageId, step, signal } = input
  const startedAt = Date.now()
  let closed = signal?.aborted === true
  let warnTimer: ReturnType<typeof setTimeout> | null = null
  let escalationTimer: ReturnType<typeof setTimeout> | null = null

  const clearTimers = () => {
    if (warnTimer) clearTimeout(warnTimer)
    if (escalationTimer) clearTimeout(escalationTimer)
    warnTimer = null
    escalationTimer = null
    signal?.removeEventListener('abort', cancel)
  }
  const close = (completed: boolean) => {
    if (closed) return
    closed = true
    clearTimers()
    if (completed) logSlowPreStreamStep(sessionId, step, startedAt)
  }
  const cancel = () => close(false)
  const logStuck = (escalated: boolean) => {
    if (closed) return
    logger.warn(
      `[DeepChatAgent] pre-stream step STUCK${escalated ? ' escalation' : ''} session=${sessionId} message=${messageId ?? '<pending>'} step=${step} elapsedMs=${Date.now() - startedAt}`
    )
  }

  if (!closed) {
    signal?.addEventListener('abort', cancel, { once: true })
    warnTimer = setTimeout(() => logStuck(false), PRE_STREAM_STUCK_WARN_MS)
    escalationTimer = setTimeout(() => logStuck(true), PRE_STREAM_STUCK_ESCALATION_MS)
    if (typeof warnTimer.unref === 'function') warnTimer.unref()
    if (typeof escalationTimer.unref === 'function') escalationTimer.unref()
  }

  return {
    complete: () => close(true),
    cancel
  }
}

export async function runPreStreamStep<T>(
  input: PreStreamStepInput,
  operation: () => Promise<T>,
  assertNotAborted: (signal?: AbortSignal) => void
): Promise<T> {
  assertNotAborted(input.signal)
  const watchdog = startPreStreamStepWatchdog(input)
  try {
    const result = await operation()
    watchdog.complete()
    return result
  } catch (error) {
    watchdog.cancel()
    throw error
  }
}

export function runSynchronousPreStreamStep<T>(
  sessionId: string,
  step: string,
  operation: () => T
): T {
  const startedAt = Date.now()
  try {
    return operation()
  } finally {
    logSlowPreStreamStep(sessionId, step, startedAt)
  }
}

export function startPreStreamProviderBoundaryWatchdog(
  input: PreStreamStepInput,
  preStreamStartedAt: number
): PreStreamBoundary {
  const watchdog = startPreStreamStepWatchdog(input)
  let crossed = false
  const close = (completed: boolean) => {
    if (crossed) return false
    crossed = true
    if (completed) {
      watchdog.complete()
    } else {
      watchdog.cancel()
    }
    return true
  }
  return {
    complete: () => {
      if (!close(true)) return
      logSlowPreStreamStep(input.sessionId, 'pre-stream-total', preStreamStartedAt)
    },
    cancel: () => {
      close(false)
    }
  }
}
