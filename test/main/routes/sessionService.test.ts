import logger from '@shared/logger'
import type { ChatMessagePageResult } from '@shared/types/agent-interface'
import { SessionService } from '@/routes/sessions/sessionService'
import { createNodeOperationRunner } from '@/routes/operationRunner'
import { reportTerminalSessionResolution } from '@/presenter/agentSessionPresenter/sessionResolution'

vi.mock('@shared/logger', () => ({
  default: {
    warn: vi.fn()
  }
}))

const available = (session: Record<string, unknown>) => ({
  availability: 'available' as const,
  session
})

const transient = (sessionId: string) => ({
  availability: 'transient_error' as const,
  sessionId,
  record: null,
  error: {
    code: 'SESSION_RESOLUTION_FAILED' as const,
    stage: 'record_read' as const,
    retryable: true as const,
    cause: new Error('temporary read failure')
  }
})

const createScheduler = () => ({
  sleep: vi.fn(),
  observeIdempotent: vi.fn(async <T>({ task }: { task: () => Promise<T> }) => await task()),
  retryIdempotent: vi.fn(
    async <T>({
      task,
      maxAttempts,
      shouldRetry
    }: {
      task: (attempt: number) => Promise<T>
      maxAttempts: number
      shouldRetry: (error: unknown) => boolean
    }): Promise<T> => {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          return await task(attempt)
        } catch (error) {
          if (attempt >= maxAttempts || !shouldRetry(error)) throw error
        }
      }
      throw new Error('unreachable')
    }
  ),
  timeout: vi.fn(async <T>({ task }: { task: Promise<T> }) => await task)
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const createMessageRepository = () => ({
  listBySession: vi.fn(),
  listPageBySession: vi.fn().mockResolvedValue({
    messages: [{ id: 'message-1', sessionId: 'session-1' }],
    nextCursor: null,
    hasMore: false
  }),
  get: vi.fn()
})

const createSessionRepository = () => ({
  create: vi.fn(),
  resolve: vi.fn(),
  resolveList: vi.fn(),
  activate: vi.fn(),
  deactivate: vi.fn(),
  resolveActive: vi.fn()
})

describe('SessionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('restores an available session through the scheduler and repositories', async () => {
    const scheduler = createScheduler()
    const sessionRepository = createSessionRepository()
    sessionRepository.resolve.mockResolvedValue(available({ id: 'session-1' }))
    const messageRepository = createMessageRepository()
    const service = new SessionService({
      sessionRepository: sessionRepository as any,
      messageRepository: messageRepository as any,
      scheduler: scheduler as any
    })

    await expect(service.restoreSession('session-1')).resolves.toEqual({
      session: { id: 'session-1' },
      resolution: {
        availability: 'available',
        session: { id: 'session-1' }
      },
      messages: [{ id: 'message-1', sessionId: 'session-1' }],
      nextCursor: null,
      hasMore: false
    })
    expect(sessionRepository.resolve).toHaveBeenCalledTimes(1)
    expect(messageRepository.listPageBySession).toHaveBeenCalledWith('session-1', { limit: 100 })
  })

  it('does not retry an authoritative missing result', async () => {
    const scheduler = createScheduler()
    const sessionRepository = createSessionRepository()
    sessionRepository.resolve.mockResolvedValue({
      availability: 'missing',
      sessionId: 'missing-session'
    })
    const messageRepository = createMessageRepository()
    const service = new SessionService({
      sessionRepository: sessionRepository as any,
      messageRepository: messageRepository as any,
      scheduler: scheduler as any
    })

    await expect(service.restoreSession('missing-session')).resolves.toEqual({
      session: null,
      resolution: {
        availability: 'missing',
        sessionId: 'missing-session'
      },
      messages: [],
      nextCursor: null,
      hasMore: false
    })
    expect(sessionRepository.resolve).toHaveBeenCalledTimes(1)
    expect(messageRepository.listPageBySession).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('retries a transient restore once and does not log if it recovers', async () => {
    const scheduler = createScheduler()
    const sessionRepository = createSessionRepository()
    sessionRepository.resolve
      .mockResolvedValueOnce(transient('session-1'))
      .mockResolvedValueOnce(available({ id: 'session-1' }))
    const service = new SessionService({
      sessionRepository: sessionRepository as any,
      messageRepository: createMessageRepository() as any,
      scheduler: scheduler as any
    })

    await expect(service.restoreSession('session-1')).resolves.toMatchObject({
      session: { id: 'session-1' }
    })
    expect(sessionRepository.resolve).toHaveBeenCalledTimes(2)
    expect(scheduler.retryIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        maxAttempts: 2,
        initialDelayMs: 25,
        backoff: 1,
        overallDeadlineMs: 5_000,
        shouldRetry: expect.any(Function)
      })
    )
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('logs an exhausted transient restore exactly once', async () => {
    const scheduler = createScheduler()
    const sessionRepository = createSessionRepository()
    sessionRepository.resolve.mockResolvedValue(transient('session-1'))
    const messageRepository = createMessageRepository()
    const service = new SessionService({
      sessionRepository: sessionRepository as any,
      messageRepository: messageRepository as any,
      scheduler: scheduler as any
    })

    await expect(service.restoreSession('session-1')).resolves.toMatchObject({ session: null })
    expect(sessionRepository.resolve).toHaveBeenCalledTimes(2)
    expect(messageRepository.listPageBySession).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      '[SessionResolution] Terminal lookup',
      expect.objectContaining({ operation: 'sessions.restore', attemptCount: 2 })
    )
  })

  it('logs only stable metadata and discards transient secrets and paths', () => {
    const cause = new Error('provider-secret at /Users/alice/private/provider.json')
    cause.stack = 'provider-secret stack at /Users/alice/private/provider.json'

    reportTerminalSessionResolution(
      'sessions.restore',
      {
        availability: 'transient_error',
        sessionId: 'session-1',
        record: {
          id: 'session-1',
          agentId: 'configured-agent-secret',
          title: 'private session',
          projectDir: '/Users/alice/private',
          isPinned: false,
          sessionKind: 'regular',
          subagentEnabled: false,
          createdAt: 1,
          updatedAt: 1
        },
        error: {
          code: 'SESSION_RESOLUTION_FAILED',
          stage: 'state_read',
          retryable: true,
          cause
        }
      },
      2
    )
    expect(logger.warn).toHaveBeenCalledWith('[SessionResolution] Terminal lookup', {
      operation: 'sessions.restore',
      sessionId: 'session-1',
      availability: 'transient_error',
      stage: 'state_read',
      code: 'SESSION_RESOLUTION_FAILED',
      retryable: true,
      attemptCount: 2
    })

    const serializedArguments = JSON.stringify(vi.mocked(logger.warn).mock.calls)
    expect(serializedArguments).not.toContain('provider-secret')
    expect(serializedArguments).not.toContain('/Users/alice/private/provider.json')
    expect(serializedArguments).not.toContain('configured-agent-secret')
    expect(serializedArguments).not.toContain('cause')
    expect(serializedArguments).not.toContain('stack')
  })

  it('does not retry a read that settles after the overall observation deadline', async () => {
    vi.useFakeTimers()
    const scheduler = createNodeOperationRunner()
    const read = deferred<ReturnType<typeof transient>>()
    const sessionRepository = createSessionRepository()
    sessionRepository.resolve.mockReturnValue(read.promise)
    const service = new SessionService({
      sessionRepository: sessionRepository as any,
      messageRepository: createMessageRepository() as any,
      scheduler
    })

    try {
      const restoring = service.restoreSession('session-1')
      const deadline = expect(restoring).rejects.toMatchObject({
        name: 'ObservationDeadlineError'
      })
      await vi.advanceTimersByTimeAsync(5_000)
      await deadline

      read.resolve(transient('session-1'))
      await vi.advanceTimersByTimeAsync(100)
      expect(sessionRepository.resolve).toHaveBeenCalledTimes(1)
      expect(logger.warn).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the same bounded retry for active-session reads', async () => {
    const scheduler = createScheduler()
    const sessionRepository = createSessionRepository()
    sessionRepository.resolveActive
      .mockResolvedValueOnce({
        binding: 'bound',
        sessionId: 'session-1',
        resolution: transient('session-1')
      })
      .mockResolvedValueOnce({
        binding: 'bound',
        sessionId: 'session-1',
        resolution: available({ id: 'session-1' })
      })
    const service = new SessionService({
      sessionRepository: sessionRepository as any,
      messageRepository: createMessageRepository() as any,
      scheduler: scheduler as any
    })

    await expect(service.getActiveSession({ webContentsId: 7, windowId: null })).resolves.toEqual({
      session: { id: 'session-1' },
      resolution: {
        availability: 'available',
        session: { id: 'session-1' }
      }
    })
    expect(sessionRepository.resolveActive).toHaveBeenCalledTimes(2)
    expect(scheduler.retryIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        maxAttempts: 2,
        initialDelayMs: 25,
        backoff: 1,
        overallDeadlineMs: 5_000,
        shouldRetry: expect.any(Function)
      })
    )
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('logs an exhausted active-session transient exactly once', async () => {
    const scheduler = createScheduler()
    const sessionRepository = createSessionRepository()
    sessionRepository.resolveActive.mockResolvedValue({
      binding: 'bound',
      sessionId: 'session-1',
      resolution: transient('session-1')
    })
    const service = new SessionService({
      sessionRepository: sessionRepository as any,
      messageRepository: createMessageRepository() as any,
      scheduler: scheduler as any
    })

    await expect(
      service.getActiveSession({ webContentsId: 7, windowId: null })
    ).resolves.toMatchObject({
      session: null,
      resolution: {
        availability: 'transient_error',
        sessionId: 'session-1',
        error: {
          code: 'SESSION_RESOLUTION_FAILED',
          stage: 'record_read',
          retryable: true
        }
      }
    })
    expect(sessionRepository.resolveActive).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      '[SessionResolution] Terminal lookup',
      expect.objectContaining({ operation: 'sessions.getActive', attemptCount: 2 })
    )
  })

  it('does not retry individual non-available list rows', async () => {
    const scheduler = createScheduler()
    const sessionRepository = createSessionRepository()
    sessionRepository.resolveList.mockResolvedValue([
      {
        availability: 'unavailable',
        sessionId: 'unknown',
        record: { id: 'unknown', agentId: 'removed' },
        reason: 'agent_unknown'
      },
      available({ id: 'healthy' })
    ])
    const service = new SessionService({
      sessionRepository: sessionRepository as any,
      messageRepository: createMessageRepository() as any,
      scheduler: scheduler as any
    })

    await expect(service.listSessions()).resolves.toEqual({
      sessions: [{ id: 'healthy' }],
      results: [
        {
          availability: 'unavailable',
          sessionId: 'unknown',
          record: { id: 'unknown', agentId: 'removed' },
          reason: 'agent_unknown'
        },
        {
          availability: 'available',
          session: { id: 'healthy' }
        }
      ]
    })
    expect(sessionRepository.resolveList).toHaveBeenCalledTimes(1)
    expect(scheduler.retryIdempotent).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('waits 25ms after a settled transient restore and never overlaps attempts', async () => {
    vi.useFakeTimers()
    const scheduler = createNodeOperationRunner()
    const first = deferred<ReturnType<typeof transient>>()
    const sessionRepository = createSessionRepository()
    let concurrent = 0
    let maxConcurrent = 0
    sessionRepository.resolve
      .mockImplementationOnce(async () => {
        concurrent += 1
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        try {
          return await first.promise
        } finally {
          concurrent -= 1
        }
      })
      .mockImplementationOnce(async () => {
        concurrent += 1
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        try {
          return available({ id: 'session-1' })
        } finally {
          concurrent -= 1
        }
      })
    const service = new SessionService({
      sessionRepository: sessionRepository as any,
      messageRepository: createMessageRepository() as any,
      scheduler
    })

    try {
      const restoring = service.restoreSession('session-1')
      await vi.advanceTimersByTimeAsync(100)
      expect(sessionRepository.resolve).toHaveBeenCalledTimes(1)

      first.resolve(transient('session-1'))
      await vi.advanceTimersByTimeAsync(24)
      expect(sessionRepository.resolve).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)

      await expect(restoring).resolves.toMatchObject({ session: { id: 'session-1' } })
      expect(sessionRepository.resolve).toHaveBeenCalledTimes(2)
      expect(maxConcurrent).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps active binding reads sequential through transient settlement and backoff', async () => {
    vi.useFakeTimers()
    const scheduler = createNodeOperationRunner()
    const first = deferred<{
      binding: 'bound'
      sessionId: string
      resolution: ReturnType<typeof transient>
    }>()
    const sessionRepository = createSessionRepository()
    let concurrent = 0
    let maxConcurrent = 0
    sessionRepository.resolveActive
      .mockImplementationOnce(async () => {
        concurrent += 1
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        try {
          return await first.promise
        } finally {
          concurrent -= 1
        }
      })
      .mockImplementationOnce(async () => {
        concurrent += 1
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        try {
          return {
            binding: 'bound',
            sessionId: 'session-1',
            resolution: available({ id: 'session-1' })
          }
        } finally {
          concurrent -= 1
        }
      })
    const service = new SessionService({
      sessionRepository: sessionRepository as any,
      messageRepository: createMessageRepository() as any,
      scheduler
    })

    try {
      const reading = service.getActiveSession({ webContentsId: 7, windowId: null })
      await vi.advanceTimersByTimeAsync(100)
      expect(sessionRepository.resolveActive).toHaveBeenCalledTimes(1)
      expect(sessionRepository.deactivate).not.toHaveBeenCalled()

      first.resolve({
        binding: 'bound',
        sessionId: 'session-1',
        resolution: transient('session-1')
      })
      await vi.advanceTimersByTimeAsync(24)
      expect(sessionRepository.resolveActive).toHaveBeenCalledTimes(1)
      expect(sessionRepository.deactivate).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)

      await expect(reading).resolves.toMatchObject({ session: { id: 'session-1' } })
      expect(sessionRepository.resolveActive).toHaveBeenCalledTimes(2)
      expect(sessionRepository.deactivate).not.toHaveBeenCalled()
      expect(maxConcurrent).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('retains the active binding when a deferred read settles after its deadline', async () => {
    vi.useFakeTimers()
    const scheduler = createNodeOperationRunner()
    const first = deferred<{
      binding: 'bound'
      sessionId: string
      resolution: ReturnType<typeof transient>
    }>()
    const sessionRepository = createSessionRepository()
    sessionRepository.resolveActive.mockReturnValue(first.promise)
    const service = new SessionService({
      sessionRepository: sessionRepository as any,
      messageRepository: createMessageRepository() as any,
      scheduler
    })

    try {
      const reading = service.getActiveSession({ webContentsId: 7, windowId: null })
      const deadline = expect(reading).rejects.toMatchObject({
        name: 'ObservationDeadlineError'
      })
      await vi.advanceTimersByTimeAsync(5_000)
      await deadline
      expect(sessionRepository.deactivate).not.toHaveBeenCalled()

      first.resolve({
        binding: 'bound',
        sessionId: 'session-1',
        resolution: transient('session-1')
      })
      await vi.advanceTimersByTimeAsync(100)
      expect(sessionRepository.resolveActive).toHaveBeenCalledTimes(1)
      expect(sessionRepository.deactivate).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    {
      availability: 'missing' as const,
      sessionId: 'session-1'
    },
    {
      availability: 'unavailable' as const,
      sessionId: 'session-1',
      record: { id: 'session-1', agentId: 'removed-agent' },
      reason: 'agent_unknown' as const
    }
  ])('does not retry an authoritative active $availability result', async (resolution) => {
    const scheduler = createScheduler()
    const sessionRepository = createSessionRepository()
    sessionRepository.resolveActive.mockResolvedValue({
      binding: 'bound',
      sessionId: 'session-1',
      resolution
    })
    const service = new SessionService({
      sessionRepository: sessionRepository as any,
      messageRepository: createMessageRepository() as any,
      scheduler: scheduler as any
    })

    await expect(
      service.getActiveSession({ webContentsId: 7, windowId: null })
    ).resolves.toMatchObject({
      session: null,
      resolution: { availability: resolution.availability }
    })
    expect(sessionRepository.resolveActive).toHaveBeenCalledTimes(1)
  })

  it('drains late list and page reads without retrying them', async () => {
    vi.useFakeTimers()
    const scheduler = createNodeOperationRunner()
    const list = deferred<ReturnType<typeof available>[]>()
    const page = deferred<ChatMessagePageResult>()
    const sessionRepository = createSessionRepository()
    sessionRepository.resolveList.mockReturnValue(list.promise)
    const messageRepository = createMessageRepository()
    messageRepository.listPageBySession.mockReturnValue(page.promise)
    const service = new SessionService({
      sessionRepository: sessionRepository as any,
      messageRepository: messageRepository as any,
      scheduler
    })

    try {
      const listing = service.listSessions()
      const listDeadline = expect(listing).rejects.toMatchObject({
        name: 'ObservationDeadlineError'
      })
      await vi.advanceTimersByTimeAsync(5_000)
      await listDeadline
      list.resolve([available({ id: 'late' })])
      await Promise.resolve()
      expect(sessionRepository.resolveList).toHaveBeenCalledTimes(1)

      const paging = service.listMessagesPage('session-1')
      const pageDeadline = expect(paging).rejects.toMatchObject({
        name: 'ObservationDeadlineError'
      })
      await vi.advanceTimersByTimeAsync(5_000)
      await pageDeadline
      page.resolve({ messages: [], nextCursor: null, hasMore: false })
      await Promise.resolve()
      expect(messageRepository.listPageBySession).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('activates and deactivates exactly once without an operation runner wrapper', async () => {
    const scheduler = createScheduler()
    const sessionRepository = createSessionRepository()
    sessionRepository.activate.mockResolvedValue(undefined)
    sessionRepository.deactivate.mockResolvedValue(undefined)
    const service = new SessionService({
      sessionRepository: sessionRepository as any,
      messageRepository: createMessageRepository() as any,
      scheduler: scheduler as any
    })

    await service.activateSession({ webContentsId: 7, windowId: null }, 'session-1')
    await service.deactivateSession({ webContentsId: 7, windowId: null })

    expect(sessionRepository.activate).toHaveBeenCalledOnce()
    expect(sessionRepository.deactivate).toHaveBeenCalledOnce()
    expect(scheduler.observeIdempotent).not.toHaveBeenCalled()
    expect(scheduler.retryIdempotent).not.toHaveBeenCalled()
    expect(scheduler.timeout).not.toHaveBeenCalled()
  })

  it('removes the internal transient cause from public route results', async () => {
    const scheduler = createScheduler()
    const sessionRepository = createSessionRepository()
    sessionRepository.resolve.mockResolvedValue(transient('session-1'))
    const service = new SessionService({
      sessionRepository: sessionRepository as any,
      messageRepository: createMessageRepository() as any,
      scheduler: scheduler as any
    })

    const result = await service.restoreSession('session-1')

    expect(result.resolution).toEqual({
      availability: 'transient_error',
      sessionId: 'session-1',
      record: null,
      error: {
        code: 'SESSION_RESOLUTION_FAILED',
        stage: 'record_read',
        retryable: true
      }
    })
    expect(JSON.stringify(result)).not.toContain('temporary read failure')
    expect(JSON.stringify(result)).not.toContain('cause')
  })
})
