import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import logger from '@shared/logger'
import {
  PRE_STREAM_STUCK_ESCALATION_MS,
  PRE_STREAM_STUCK_WARN_MS,
  runPreStreamStep,
  startPreStreamProviderBoundaryWatchdog
} from '@/agent/deepchat/runtime/preStreamWatchdog'

vi.mock('@shared/logger', () => ({
  default: {
    warn: vi.fn()
  }
}))

const assertNotAborted = (signal?: AbortSignal): void => signal?.throwIfAborted()

describe('pre-stream watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    vi.mocked(logger.warn).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects an already aborted step before invoking its operation', async () => {
    const controller = new AbortController()
    const operation = vi.fn().mockResolvedValue('unused')
    controller.abort()

    await expect(
      runPreStreamStep(
        { sessionId: 'session', step: 'prepare', signal: controller.signal },
        operation,
        assertNotAborted
      )
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(operation).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears watchdog timers after both resolved and rejected operations', async () => {
    await expect(
      runPreStreamStep(
        { sessionId: 'session', step: 'resolve' },
        async () => 'result',
        assertNotAborted
      )
    ).resolves.toBe('result')
    expect(vi.getTimerCount()).toBe(0)

    const failure = new Error('failed')
    await expect(
      runPreStreamStep(
        { sessionId: 'session', step: 'reject' },
        async () => {
          throw failure
        },
        assertNotAborted
      )
    ).rejects.toBe(failure)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('warns at both stuck thresholds and stops after cancellation', async () => {
    const boundary = startPreStreamProviderBoundaryWatchdog(
      { sessionId: 'session', messageId: 'message', step: 'provider-start' },
      Date.now()
    )

    await vi.advanceTimersByTimeAsync(PRE_STREAM_STUCK_WARN_MS)
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('step=provider-start')
    )
    expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(
      PRE_STREAM_STUCK_ESCALATION_MS - PRE_STREAM_STUCK_WARN_MS
    )
    expect(vi.mocked(logger.warn)).toHaveBeenLastCalledWith(
      expect.stringContaining('STUCK escalation')
    )
    expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(2)

    boundary.cancel()
    await vi.advanceTimersByTimeAsync(PRE_STREAM_STUCK_ESCALATION_MS)
    expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('completes the provider boundary exactly once and reports both elapsed durations', async () => {
    const startedAt = Date.now()
    const boundary = startPreStreamProviderBoundaryWatchdog(
      { sessionId: 'session', messageId: 'message', step: 'provider-start' },
      startedAt
    )
    await vi.advanceTimersByTimeAsync(600)

    boundary.complete()
    boundary.complete()

    expect(vi.mocked(logger.warn).mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining('step=provider-start elapsed=600ms'),
      expect.stringContaining('step=pre-stream-total elapsed=600ms')
    ])
    expect(vi.getTimerCount()).toBe(0)
  })
})
