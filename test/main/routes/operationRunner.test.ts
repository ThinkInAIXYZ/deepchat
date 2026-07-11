import {
  ObservationDeadlineError,
  OperationRunnerValidationError,
  createNodeOperationRunner
} from '@/routes/operationRunner'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('createNodeOperationRunner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('supports abortable sleep and removes its abort listener', async () => {
    const runner = createNodeOperationRunner()
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    const sleeping = runner.sleep({
      ms: 100,
      reason: 'test-sleep',
      signal: controller.signal
    })

    controller.abort()

    await expect(sleeping).rejects.toMatchObject({ name: 'AbortError' })
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start sleep or observation work for a pre-aborted signal', async () => {
    const runner = createNodeOperationRunner()
    const controller = new AbortController()
    const task = vi.fn().mockResolvedValue('unused')
    controller.abort()

    await expect(
      runner.sleep({ ms: 10, reason: 'pre-aborted-sleep', signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    await expect(
      runner.observeIdempotent({
        task,
        deadlineMs: 10,
        reason: 'pre-aborted-observation',
        signal: controller.signal
      })
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(task).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('returns a synchronous task error and cleans observation resources', async () => {
    const runner = createNodeOperationRunner()
    const controller = new AbortController()
    const expected = new Error('synchronous failure')
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')

    await expect(
      runner.observeIdempotent({
        task: () => {
          throw expected
        },
        deadlineMs: 100,
        reason: 'sync-observation',
        signal: controller.signal
      })
    ).rejects.toBe(expected)

    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops observing at the deadline and safely drains a late resolution', async () => {
    const runner = createNodeOperationRunner()
    const task = deferred<string>()
    const observed = runner.observeIdempotent({
      task: () => task.promise,
      deadlineMs: 10,
      reason: 'late-resolution'
    })
    const deadline = expect(observed).rejects.toEqual(
      new ObservationDeadlineError('late-resolution', 10)
    )

    await vi.advanceTimersByTimeAsync(10)

    await deadline
    task.resolve('late')
    await Promise.resolve()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('safely drains a late rejection after the observation deadline', async () => {
    const runner = createNodeOperationRunner()
    const task = deferred<string>()
    const observed = runner.observeIdempotent({
      task: () => task.promise,
      deadlineMs: 10,
      reason: 'late-rejection'
    })
    const deadline = expect(observed).rejects.toMatchObject({ name: 'ObservationDeadlineError' })

    await vi.advanceTimersByTimeAsync(10)
    await deadline

    task.reject(new Error('late'))
    await Promise.resolve()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not invoke an observation task when the deadline is immediate', async () => {
    const runner = createNodeOperationRunner()
    const task = vi.fn().mockResolvedValue('unused')

    await expect(
      runner.observeIdempotent({ task, deadlineMs: 0, reason: 'immediate-observation' })
    ).rejects.toMatchObject({ name: 'ObservationDeadlineError' })

    expect(task).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits for a rejected attempt to settle before starting the next attempt', async () => {
    const runner = createNodeOperationRunner()
    const first = deferred<string>()
    let concurrentAttempts = 0
    let maxConcurrentAttempts = 0
    const task = vi.fn(async (attempt: number) => {
      concurrentAttempts += 1
      maxConcurrentAttempts = Math.max(maxConcurrentAttempts, concurrentAttempts)
      try {
        if (attempt === 1) return await first.promise
        return 'ok'
      } finally {
        concurrentAttempts -= 1
      }
    })
    const running = runner.retryIdempotent({
      task,
      maxAttempts: 2,
      initialDelayMs: 10,
      backoff: 1,
      overallDeadlineMs: 100,
      reason: 'sequential-retry',
      shouldRetry: () => true
    })

    await vi.advanceTimersByTimeAsync(50)
    expect(task).toHaveBeenCalledTimes(1)

    first.reject(new Error('transient'))
    await vi.advanceTimersByTimeAsync(9)
    expect(task).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)

    await expect(running).resolves.toBe('ok')
    expect(task).toHaveBeenNthCalledWith(1, 1)
    expect(task).toHaveBeenNthCalledWith(2, 2)
    expect(maxConcurrentAttempts).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ends observation during a deferred attempt without starting another attempt', async () => {
    const runner = createNodeOperationRunner()
    const first = deferred<string>()
    const task = vi.fn(() => first.promise)
    const running = runner.retryIdempotent({
      task,
      maxAttempts: 2,
      initialDelayMs: 5,
      backoff: 1,
      overallDeadlineMs: 20,
      reason: 'attempt-deadline',
      shouldRetry: () => true
    })
    const deadline = expect(running).rejects.toMatchObject({ name: 'ObservationDeadlineError' })

    await vi.advanceTimersByTimeAsync(20)
    await deadline

    first.reject(new Error('late rejection'))
    await vi.advanceTimersByTimeAsync(100)
    expect(task).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start another attempt when the deadline lands during backoff', async () => {
    const runner = createNodeOperationRunner()
    const task = vi.fn().mockRejectedValue(new Error('transient'))
    const running = runner.retryIdempotent({
      task,
      maxAttempts: 2,
      initialDelayMs: 50,
      backoff: 1,
      overallDeadlineMs: 20,
      reason: 'backoff-deadline',
      shouldRetry: () => true
    })
    const deadline = expect(running).rejects.toMatchObject({ name: 'ObservationDeadlineError' })

    await vi.advanceTimersByTimeAsync(20)

    await deadline
    expect(task).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('returns the original rejection when the classifier rejects retry', async () => {
    const runner = createNodeOperationRunner()
    const expected = new Error('terminal')
    const task = vi.fn().mockRejectedValue(expected)
    const shouldRetry = vi.fn().mockReturnValue(false)

    await expect(
      runner.retryIdempotent({
        task,
        maxAttempts: 2,
        initialDelayMs: 10,
        backoff: 1,
        overallDeadlineMs: 100,
        reason: 'terminal-retry',
        shouldRetry
      })
    ).rejects.toBe(expected)

    expect(task).toHaveBeenCalledTimes(1)
    expect(shouldRetry).toHaveBeenCalledWith(expected)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries a settled synchronous throw and keeps attempt concurrency at one', async () => {
    const runner = createNodeOperationRunner()
    let concurrentAttempts = 0
    let maxConcurrentAttempts = 0
    const task = vi.fn((attempt: number) => {
      concurrentAttempts += 1
      maxConcurrentAttempts = Math.max(maxConcurrentAttempts, concurrentAttempts)
      try {
        if (attempt === 1) throw new Error('transient')
        return Promise.resolve('ok')
      } finally {
        concurrentAttempts -= 1
      }
    })
    const running = runner.retryIdempotent({
      task,
      maxAttempts: 2,
      initialDelayMs: 1,
      backoff: 1,
      overallDeadlineMs: 100,
      reason: 'sync-retry',
      shouldRetry: () => true
    })

    await vi.advanceTimersByTimeAsync(1)

    await expect(running).resolves.toBe('ok')
    expect(task).toHaveBeenCalledTimes(2)
    expect(maxConcurrentAttempts).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not invoke retry work for a pre-aborted signal or immediate deadline', async () => {
    const runner = createNodeOperationRunner()
    const controller = new AbortController()
    const task = vi.fn().mockResolvedValue('unused')
    controller.abort()

    await expect(
      runner.retryIdempotent({
        task,
        maxAttempts: 2,
        initialDelayMs: 1,
        backoff: 1,
        overallDeadlineMs: 100,
        reason: 'pre-aborted-retry',
        signal: controller.signal,
        shouldRetry: () => true
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    await expect(
      runner.retryIdempotent({
        task,
        maxAttempts: 2,
        initialDelayMs: 1,
        backoff: 1,
        overallDeadlineMs: 0,
        reason: 'immediate-retry',
        shouldRetry: () => true
      })
    ).rejects.toMatchObject({ name: 'ObservationDeadlineError' })

    expect(task).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts retry observation during an attempt and removes its listener', async () => {
    const runner = createNodeOperationRunner()
    const controller = new AbortController()
    const first = deferred<string>()
    const task = vi.fn(() => first.promise)
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    const running = runner.retryIdempotent({
      task,
      maxAttempts: 2,
      initialDelayMs: 1,
      backoff: 1,
      overallDeadlineMs: 100,
      reason: 'aborted-retry',
      signal: controller.signal,
      shouldRetry: () => true
    })
    const aborted = expect(running).rejects.toMatchObject({ name: 'AbortError' })

    controller.abort()
    await aborted
    first.reject(new Error('late'))
    await Promise.resolve()

    expect(task).toHaveBeenCalledTimes(1)
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([NaN, Infinity, -1, 1.5, 2_147_483_648])(
    'rejects invalid timer milliseconds %s before starting work',
    async (invalidMs) => {
      const runner = createNodeOperationRunner()
      const task = vi.fn().mockResolvedValue('unused')

      await expect(
        runner.observeIdempotent({ task, deadlineMs: invalidMs, reason: 'invalid-observation' })
      ).rejects.toBeInstanceOf(OperationRunnerValidationError)
      await expect(runner.sleep({ ms: invalidMs, reason: 'invalid-sleep' })).rejects.toBeInstanceOf(
        OperationRunnerValidationError
      )

      expect(task).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it.each([
    ['maxAttempts', { maxAttempts: 0 }],
    ['maxAttempts', { maxAttempts: 1.5 }],
    ['maxAttempts', { maxAttempts: Number.MAX_SAFE_INTEGER + 1 }],
    ['initialDelayMs', { initialDelayMs: -1 }],
    ['initialDelayMs', { initialDelayMs: Infinity }],
    ['backoff', { backoff: -1 }],
    ['backoff', { backoff: NaN }],
    ['overallDeadlineMs', { overallDeadlineMs: -1 }],
    ['overallDeadlineMs', { overallDeadlineMs: 1.5 }]
  ])('rejects invalid retry %s before starting work', async (_parameter, override) => {
    const runner = createNodeOperationRunner()
    const task = vi.fn().mockResolvedValue('unused')

    await expect(
      runner.retryIdempotent({
        task,
        maxAttempts: 2,
        initialDelayMs: 1,
        backoff: 1,
        overallDeadlineMs: 100,
        reason: 'invalid-retry',
        shouldRetry: () => true,
        ...override
      })
    ).rejects.toBeInstanceOf(OperationRunnerValidationError)

    expect(task).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    { maxAttempts: 3, initialDelayMs: 2_147_483_647, backoff: 2 },
    { maxAttempts: 3, initialDelayMs: 1, backoff: 0.5 }
  ])('rejects invalid computed retry delays before starting work', async (input) => {
    const runner = createNodeOperationRunner()
    const task = vi.fn().mockResolvedValue('unused')

    await expect(
      runner.retryIdempotent({
        task,
        ...input,
        overallDeadlineMs: 100,
        reason: 'invalid-computed-delay',
        shouldRetry: () => true
      })
    ).rejects.toBeInstanceOf(OperationRunnerValidationError)

    expect(task).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the allowlisted legacy timeout and retry behavior during migration', async () => {
    const runner = createNodeOperationRunner()
    const legacyTimeout = runner.timeout({
      task: new Promise<void>(() => {}),
      ms: 10,
      reason: 'legacy-timeout'
    })
    const timeout = expect(legacyTimeout).rejects.toMatchObject({ name: 'TimeoutError' })

    await vi.advanceTimersByTimeAsync(10)
    await timeout

    const task = vi.fn().mockRejectedValueOnce(new Error('first')).mockResolvedValueOnce('ok')
    const legacyRetry = runner.retry({
      task,
      maxAttempts: 2,
      initialDelayMs: 1,
      backoff: 1,
      reason: 'legacy-retry'
    })
    await vi.advanceTimersByTimeAsync(1)

    await expect(legacyRetry).resolves.toBe('ok')
    expect(task).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})
