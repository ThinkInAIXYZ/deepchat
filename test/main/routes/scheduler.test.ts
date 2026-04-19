import { createNodeScheduler } from '@/routes/scheduler'

describe('createNodeScheduler', () => {
  it('times out long-running tasks', async () => {
    const scheduler = createNodeScheduler()

    await expect(
      scheduler.timeout({
        task: new Promise<void>(() => {}),
        ms: 10,
        reason: 'scheduler-timeout'
      })
    ).rejects.toMatchObject({
      name: 'TimeoutError'
    })
  })

  it('retries until the task succeeds', async () => {
    const scheduler = createNodeScheduler()
    const task = vi
      .fn<[], Promise<string>>()
      .mockRejectedValueOnce(new Error('first'))
      .mockResolvedValueOnce('ok')

    await expect(
      scheduler.retry({
        task,
        maxAttempts: 2,
        initialDelayMs: 1,
        backoff: 1,
        reason: 'scheduler-retry'
      })
    ).resolves.toBe('ok')

    expect(task).toHaveBeenCalledTimes(2)
  })
})
