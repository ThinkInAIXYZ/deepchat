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

function toAbortPromise(signal: AbortSignal | undefined, reason: string): Promise<never> {
  if (!signal) {
    return new Promise<never>(() => {})
  }

  if (signal.aborted) {
    return Promise.reject(createAbortError(reason))
  }

  return new Promise<never>((_, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(createAbortError(reason))
      },
      { once: true }
    )
  })
}

export function createNodeScheduler(): Scheduler {
  return {
    async sleep({ ms, signal }) {
      await delay(ms, undefined, signal ? { signal } : undefined)
    },

    async timeout<T>({ task, ms, reason, signal }: TimeoutInput<T>): Promise<T> {
      const timeoutTask = delay(ms).then(() => {
        throw createTimeoutError(reason, ms)
      })

      return await Promise.race([task, timeoutTask, toAbortPromise(signal, reason)])
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
        try {
          return await Promise.race([task(), toAbortPromise(signal, reason)])
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
        }
      }

      throw lastError instanceof Error ? lastError : new Error(String(lastError))
    }
  }
}
