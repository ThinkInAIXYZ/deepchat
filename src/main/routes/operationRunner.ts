const MAX_TIMER_MS = 2_147_483_647

export interface SleepInput {
  ms: number
  reason: string
  signal?: AbortSignal
}

export interface ObserveIdempotentInput<T> {
  task: () => Promise<T>
  deadlineMs: number
  reason: string
  signal?: AbortSignal
}

export interface RetryIdempotentInput<T> {
  task: (attempt: number) => Promise<T>
  maxAttempts: number
  initialDelayMs: number
  backoff: number
  overallDeadlineMs: number
  reason: string
  signal?: AbortSignal
  shouldRetry: (error: unknown) => boolean
}

export interface LegacyTimeoutInput<T> {
  task: Promise<T>
  ms: number
  reason: string
  signal?: AbortSignal
}

export interface LegacyRetryInput<T> {
  task: () => Promise<T>
  maxAttempts: number
  initialDelayMs: number
  backoff: number
  reason: string
  signal?: AbortSignal
}

export interface OperationRunner {
  sleep(input: SleepInput): Promise<void>
  observeIdempotent<T>(input: ObserveIdempotentInput<T>): Promise<T>
  retryIdempotent<T>(input: RetryIdempotentInput<T>): Promise<T>

  /** @deprecated Migrate the allowlisted consumer to a capability-specific operation. */
  timeout<T>(input: LegacyTimeoutInput<T>): Promise<T>

  /** @deprecated Migrate the allowlisted consumer to retryIdempotent. */
  retry<T>(input: LegacyRetryInput<T>): Promise<T>
}

export class OperationRunnerValidationError extends TypeError {
  constructor(
    readonly parameter: string,
    message: string
  ) {
    super(`${parameter} ${message}`)
    this.name = 'OperationRunnerValidationError'
  }
}

export class ObservationDeadlineError extends Error {
  constructor(
    readonly reason: string,
    readonly deadlineMs: number
  ) {
    super(`${reason} observation deadline reached after ${deadlineMs}ms`)
    this.name = 'ObservationDeadlineError'
  }
}

function createAbortError(reason: string): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException(reason, 'AbortError')
  }

  const error = new Error(reason)
  error.name = 'AbortError'
  return error
}

function createLegacyTimeoutError(reason: string, ms: number): Error {
  const error = new Error(`${reason} timed out after ${ms}ms`)
  error.name = 'TimeoutError'
  return error
}

function validateTimerMs(value: number, parameter: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > MAX_TIMER_MS) {
    throw new OperationRunnerValidationError(
      parameter,
      `must be a finite integer between 0 and ${MAX_TIMER_MS}`
    )
  }
}

function validateMaxAttempts(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new OperationRunnerValidationError('maxAttempts', 'must be a finite positive integer')
  }
}

function validateBackoff(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new OperationRunnerValidationError('backoff', 'must be finite and nonnegative')
  }
}

function validateRetryDelays(maxAttempts: number, initialDelayMs: number, backoff: number): void {
  let delayMs = initialDelayMs

  for (let index = 1; index < maxAttempts; index += 1) {
    validateTimerMs(delayMs, `retryDelayMs[${index}]`)
    const nextDelayMs = delayMs * backoff
    if (nextDelayMs === delayMs) return
    delayMs = nextDelayMs
  }
}

function validateRetryInput(input: {
  maxAttempts: number
  initialDelayMs: number
  backoff: number
  overallDeadlineMs: number
}): void {
  validateMaxAttempts(input.maxAttempts)
  validateTimerMs(input.initialDelayMs, 'initialDelayMs')
  validateBackoff(input.backoff)
  validateTimerMs(input.overallDeadlineMs, 'overallDeadlineMs')
  validateRetryDelays(input.maxAttempts, input.initialDelayMs, input.backoff)
}

function drain<T>(promise: Promise<T>): void {
  void promise.catch(() => undefined)
}

function createWait(ms: number): { promise: Promise<void>; cleanup: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
  })

  return {
    promise,
    cleanup: () => {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
    }
  }
}

function createStopGate(input: {
  deadlineMs: number
  reason: string
  signal?: AbortSignal
  deadlineError: () => Error
}): {
  promise: Promise<never>
  cleanup: () => void
  getError: () => Error | undefined
} {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopError: Error | undefined
  let rejectGate!: (error: Error) => void
  const stop = (error: Error) => {
    stopError = error
    rejectGate(error)
  }
  const onAbort = () => stop(createAbortError(input.reason))
  const promise = new Promise<never>((_, reject) => {
    rejectGate = reject
    timer = setTimeout(() => stop(input.deadlineError()), input.deadlineMs)
    input.signal?.addEventListener('abort', onAbort, { once: true })
  })
  drain(promise)

  return {
    promise,
    cleanup: () => {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      input.signal?.removeEventListener('abort', onAbort)
    },
    getError: () => stopError
  }
}

function throwIfPreAborted(signal: AbortSignal | undefined, reason: string): void {
  if (signal?.aborted) {
    throw createAbortError(reason)
  }
}

async function sleep(input: SleepInput): Promise<void> {
  validateTimerMs(input.ms, 'ms')
  throwIfPreAborted(input.signal, input.reason)

  let timer: ReturnType<typeof setTimeout> | undefined
  let rejectSleep!: (error: Error) => void
  const onAbort = () => rejectSleep(createAbortError(input.reason))

  try {
    await new Promise<void>((resolve, reject) => {
      rejectSleep = reject
      timer = setTimeout(resolve, input.ms)
      input.signal?.addEventListener('abort', onAbort, { once: true })
    })
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    input.signal?.removeEventListener('abort', onAbort)
  }
}

async function observeIdempotent<T>(input: ObserveIdempotentInput<T>): Promise<T> {
  validateTimerMs(input.deadlineMs, 'deadlineMs')
  throwIfPreAborted(input.signal, input.reason)

  if (input.deadlineMs === 0) {
    throw new ObservationDeadlineError(input.reason, input.deadlineMs)
  }

  const gate = createStopGate({
    deadlineMs: input.deadlineMs,
    reason: input.reason,
    signal: input.signal,
    deadlineError: () => new ObservationDeadlineError(input.reason, input.deadlineMs)
  })

  let task: Promise<T>
  try {
    task = Promise.resolve(input.task())
  } catch (error) {
    gate.cleanup()
    throw error
  }
  drain(task)

  try {
    return await Promise.race([task, gate.promise])
  } finally {
    gate.cleanup()
  }
}

async function retryIdempotent<T>(input: RetryIdempotentInput<T>): Promise<T> {
  validateRetryInput(input)
  throwIfPreAborted(input.signal, input.reason)

  if (input.overallDeadlineMs === 0) {
    throw new ObservationDeadlineError(input.reason, input.overallDeadlineMs)
  }

  const gate = createStopGate({
    deadlineMs: input.overallDeadlineMs,
    reason: input.reason,
    signal: input.signal,
    deadlineError: () => new ObservationDeadlineError(input.reason, input.overallDeadlineMs)
  })
  let delayMs = input.initialDelayMs

  try {
    for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
      let task: Promise<T>
      try {
        task = Promise.resolve(input.task(attempt))
      } catch (error) {
        task = Promise.reject(error)
      }
      drain(task)

      try {
        return await Promise.race([task, gate.promise])
      } catch (error) {
        const stopError = gate.getError()
        if (stopError) {
          throw stopError
        }
        if (attempt >= input.maxAttempts || !input.shouldRetry(error)) {
          throw error
        }
      }

      const wait = createWait(delayMs)
      try {
        await Promise.race([wait.promise, gate.promise])
      } finally {
        wait.cleanup()
      }
      delayMs *= input.backoff
    }

    throw new Error('retryIdempotent exhausted without a result')
  } finally {
    gate.cleanup()
  }
}

async function legacyTimeout<T>(input: LegacyTimeoutInput<T>): Promise<T> {
  validateTimerMs(input.ms, 'ms')
  throwIfPreAborted(input.signal, input.reason)

  const gate = createStopGate({
    deadlineMs: input.ms,
    reason: input.reason,
    signal: input.signal,
    deadlineError: () => createLegacyTimeoutError(input.reason, input.ms)
  })
  drain(input.task)

  try {
    return await Promise.race([input.task, gate.promise])
  } finally {
    gate.cleanup()
  }
}

export function createNodeOperationRunner(): OperationRunner {
  return {
    sleep,
    observeIdempotent,
    retryIdempotent,
    timeout: legacyTimeout,
    retry(input) {
      return retryIdempotent({
        ...input,
        task: () => input.task(),
        overallDeadlineMs: MAX_TIMER_MS,
        shouldRetry: () => true
      })
    }
  }
}
