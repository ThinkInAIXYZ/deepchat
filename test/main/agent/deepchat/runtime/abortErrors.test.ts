import { describe, expect, it } from 'vitest'
import {
  createAbortError,
  isAbortError,
  throwIfAbortRequested
} from '@/agent/deepchat/runtime/abortErrors'

describe('abortErrors', () => {
  it('creates the stable abort error identity used across runtime boundaries', () => {
    const error = createAbortError()

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('AbortError')
    expect(error.message).toBe('Aborted')
    expect(isAbortError(error)).toBe(true)
  })

  it('recognizes provider cancellation errors without classifying unrelated failures', () => {
    const canceled = new Error('cancelled')
    canceled.name = 'CanceledError'

    expect(isAbortError(canceled)).toBe(true)
    expect(isAbortError(new Error('cancelled'))).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
  })

  it('throws only after the supplied signal is aborted', () => {
    const controller = new AbortController()

    expect(() => throwIfAbortRequested()).not.toThrow()
    expect(() => throwIfAbortRequested(controller.signal)).not.toThrow()

    controller.abort()

    expect(() => throwIfAbortRequested(controller.signal)).toThrowError(
      expect.objectContaining({ name: 'AbortError' })
    )
  })
})
