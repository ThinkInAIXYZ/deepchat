import { describe, expect, it, vi } from 'vitest'
import { RendererPerformanceReporter } from '@/platform/performance/rendererPerformance'

describe('RendererPerformanceReporter', () => {
  it('buffers non-startup records until local logging becomes available', async () => {
    const submit = vi.fn().mockResolvedValue(true)
    const reporter = new RendererPerformanceReporter(submit, () => 120)

    reporter.recordChatSession('selected', 3)
    expect(submit).not.toHaveBeenCalled()

    reporter.setEnabled(true)
    reporter.recordChatSession('messages-committed', 3)

    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
    expect(submit.mock.calls.map(([record]) => record)).toEqual([
      expect.objectContaining({
        scope: 'chat-session',
        phase: 'selected',
        sessionEpoch: 3,
        elapsedMs: 0
      }),
      expect.objectContaining({
        scope: 'chat-session',
        phase: 'messages-committed',
        sessionEpoch: 3,
        elapsedMs: 0
      })
    ])
  })

  it('correlates buffered startup phases with the bootstrap run without exposing session state', async () => {
    const submit = vi.fn().mockResolvedValue(true)
    const reporter = new RendererPerformanceReporter(submit, () => 150)
    reporter.recordStartup('shell-mounted')
    reporter.setEnabled(true)
    expect(submit).not.toHaveBeenCalled()

    reporter.recordStartup('bootstrap-ready', { startupRunId: 'main:run-1' })
    reporter.recordStartup('interactive')

    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(3))
    expect(submit.mock.calls.map(([record]) => record)).toEqual([
      expect.objectContaining({ phase: 'shell-mounted', startupRunId: 'main:run-1' }),
      expect.objectContaining({ phase: 'bootstrap-ready', startupRunId: 'main:run-1' }),
      expect.objectContaining({ phase: 'interactive', startupRunId: 'main:run-1' })
    ])
    expect(JSON.stringify(submit.mock.calls)).not.toContain('sessionId')
  })

  it('flushes buffered startup records when local logging enables after bootstrap', async () => {
    const submit = vi.fn().mockResolvedValue(true)
    const reporter = new RendererPerformanceReporter(submit, () => 150)

    reporter.recordStartup('bootstrap-ready', { startupRunId: 'main:run-1' })
    reporter.setEnabled(true)

    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'startup',
        phase: 'bootstrap-ready',
        startupRunId: 'main:run-1'
      })
    )
  })

  it('records each terminal main workload task once with its existing elapsed time', async () => {
    const submit = vi.fn().mockResolvedValue(true)
    const reporter = new RendererPerformanceReporter(submit)
    reporter.setEnabled(true)

    const completedTask = {
      id: 'main.session.firstPage' as const,
      state: 'completed' as const,
      startedAt: 100,
      updatedAt: 360
    }
    reporter.observeStartupWorkload('main:run-1', [completedTask])
    reporter.observeStartupWorkload('main:run-1', [
      { ...completedTask, updatedAt: completedTask.updatedAt + 10 }
    ])

    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'workload',
        phase: 'deferred-settled',
        workloadTaskId: 'main.session.firstPage',
        workloadTaskState: 'completed',
        elapsedMs: 260
      })
    )
  })

  it('drops records while disabled and stops accepting records after disposal', async () => {
    const submit = vi.fn().mockResolvedValue(true)
    const reporter = new RendererPerformanceReporter(submit)

    reporter.recordChatSession('selected', 2)
    reporter.setEnabled(false)
    reporter.setEnabled(true)
    reporter.dispose()
    reporter.recordChatSession('messages-committed', 2)

    await Promise.resolve()
    expect(submit).not.toHaveBeenCalled()
  })

  it('isolates diagnostic transport failures from feature code', async () => {
    const onSubmitError = vi.fn()
    const reporter = new RendererPerformanceReporter(
      vi.fn().mockRejectedValue(new Error('unavailable')),
      () => 1,
      onSubmitError
    )
    reporter.setEnabled(true)

    reporter.recordChatSession('first-message-paint', 4)

    await vi.waitFor(() => expect(onSubmitError).toHaveBeenCalledTimes(1))
  })
})
