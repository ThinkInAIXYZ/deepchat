import { describe, expect, it } from 'vitest'
import { SubmissionCancellationRegistry } from '@/session/submissionCancellationRegistry'

describe('SubmissionCancellationRegistry', () => {
  it('cancels only submissions owned by the requesting webContents', () => {
    const registry = new SubmissionCancellationRegistry()
    const registration = registry.register(10, 'submission-1')

    expect(registry.cancel(11, 'submission-1')).toBe(false)
    expect(registration.signal.aborted).toBe(false)

    expect(registry.cancel(10, 'submission-1')).toBe(true)
    expect(registration.signal.aborted).toBe(true)
  })

  it('unregisters idempotently and permits later reuse', () => {
    const registry = new SubmissionCancellationRegistry()
    const first = registry.register(10, 'submission-1')

    expect(() => registry.register(10, 'submission-1')).toThrow(
      'Submission is already active: submission-1'
    )

    first.unregister()
    first.unregister()
    expect(registry.cancel(10, 'submission-1')).toBe(false)

    const second = registry.register(10, 'submission-1')
    expect(second.signal.aborted).toBe(false)
  })

  it('bounds active submissions independently for each renderer', () => {
    const registry = new SubmissionCancellationRegistry()
    for (let index = 0; index < 32; index += 1) {
      registry.register(10, `submission-${index}`)
    }

    expect(() => registry.register(10, 'submission-overflow')).toThrow(
      'Too many active submissions for renderer 10'
    )
    expect(() => registry.register(11, 'submission-overflow')).not.toThrow()
  })
})
