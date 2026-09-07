import { describe, expect, it, vi } from 'vitest'

import { awaitWithAbort } from '@/lib/awaitWithAbort'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

async function flushUnhandledRejections(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))
}

describe('awaitWithAbort', () => {
  it('consumes a late source rejection when the signal was aborted before the wait began', async () => {
    const source = deferred<void>()
    const controller = new AbortController()
    const lateError = new Error('late source failure')
    const unhandled = vi.fn()
    controller.abort()

    await expect(awaitWithAbort(source.promise, controller.signal)).rejects.toMatchObject({
      name: 'AbortError'
    })

    process.on('unhandledRejection', unhandled)
    try {
      source.reject(lateError)
      await flushUnhandledRejections()
      expect(unhandled.mock.calls.some(([reason]) => reason === lateError)).toBe(false)
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('consumes a late source rejection after an in-flight abort wins', async () => {
    const source = deferred<void>()
    const controller = new AbortController()
    const lateError = new Error('late source failure')
    const unhandled = vi.fn()
    const waiting = awaitWithAbort(source.promise, controller.signal)

    controller.abort()
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })

    process.on('unhandledRejection', unhandled)
    try {
      source.reject(lateError)
      await flushUnhandledRejections()
      expect(unhandled.mock.calls.some(([reason]) => reason === lateError)).toBe(false)
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('still propagates a source rejection while the signal is active', async () => {
    const source = deferred<void>()
    const controller = new AbortController()
    const sourceError = new Error('source failure')
    const waiting = awaitWithAbort(source.promise, controller.signal)

    source.reject(sourceError)

    await expect(waiting).rejects.toBe(sourceError)
  })
})
