import { setTimeout as delay } from 'node:timers/promises'

export interface SleepInput {
  ms: number
  reason: string
  signal?: AbortSignal
}

export interface TimeoutInput<T> {
  task: Promise<T>
  ms: number
  reason: string
  signal?: AbortSignal
}

export interface RetryInput<T> {
  task: () => Promise<T>
  maxAttempts: number
  initialDelayMs: number
  backoff: number
  reason: string
  signal?: AbortSignal
}

export interface Scheduler {
  sleep(input: SleepInput): Promise<void>
  timeout<T>(input: TimeoutInput<T>): Promise<T>
  retry<T>(input: RetryInput<T>): Promise<T>
}

function createAbortError(reason: string): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException(reason, 'AbortError')
  }

  const error = new Error(reason)
  error.name = 'AbortError'
  return error
}

function createTimeoutError(reason: string, ms: number): Error {
  const error = new Error(`${reason} timed out after ${ms}ms`)
  error.name = 'TimeoutError'
  return error
}

function toAbortPromise(
  signal: AbortSignal | undefined,
  reason: string
): {
  promise: Promise<never>
  cleanup: () => void
} {
  if (!signal) {
    return {
      promise: new Promise<never>(() => {}),
      cleanup: () => {}
    }
  }

  if (signal.aborted) {
    return {
      promise: Promise.reject(createAbortError(reason)),
      cleanup: () => {}
    }
  }

  let rejectAbort!: (reason?: unknown) => void
  const onAbort = () => {
    rejectAbort(createAbortError(reason))
  }
  const promise = new Promise<never>((_, reject) => {
    rejectAbort = reject
    signal.addEventListener('abort', onAbort, { once: true })
  })

  return {
    promise,
    cleanup: () => {
      signal.removeEventListener('abort', onAbort)
    }
  }
}

export function createNodeScheduler(): Scheduler {
  return {
    async sleep({ ms, signal }) {
      await delay(ms, undefined, signal ? { signal } : undefined)
    },

    async timeout<T>({ task, ms, reason, signal }: TimeoutInput<T>): Promise<T> {
      const timeoutController = new AbortController()
      const { promise: abortPromise, cleanup } = toAbortPromise(signal, reason)
      const timeoutTask = delay(ms, undefined, { signal: timeoutController.signal }).then(() => {
        throw createTimeoutError(reason, ms)
      })

      try {
        return await Promise.race([task, timeoutTask, abortPromise])
      } finally {
        timeoutController.abort()
        cleanup()
      }
    },

    async retry<T>({
      task,
      maxAttempts,
      initialDelayMs,
      backoff,
      reason,
      signal
    }: RetryInput<T>): Promise<T> {
      let attempt = 0
      let lastError: unknown = null
      let delayMs = initialDelayMs

      while (attempt < maxAttempts) {
        if (signal?.aborted) {
          return await toAbortPromise(signal, reason).promise
        }

        const { promise: abortPromise, cleanup } = toAbortPromise(signal, reason)
        try {
          return await Promise.race([task(), abortPromise])
        } catch (error) {
          lastError = error
          attempt += 1

          if (attempt >= maxAttempts) {
            break
          }

          await this.sleep({
            ms: delayMs,
            reason: `${reason}:retry-wait`,
            signal
          })

          delayMs = Math.max(0, Math.round(delayMs * backoff))
        } finally {
          cleanup()
        }
      }

      throw lastError instanceof Error ? lastError : new Error(String(lastError))
    }
  }
}
