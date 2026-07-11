import logger from '@shared/logger'
import { SessionService } from '@/routes/sessions/sessionService'
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
  timeout: vi.fn(async <T>({ task }: { task: Promise<T> }) => await task),
  retry: vi.fn(
    async <T>({
      task,
      maxAttempts
    }: {
      task: () => Promise<T>
      maxAttempts: number
    }): Promise<T> => {
      let lastError: unknown
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          return await task()
        } catch (error) {
          lastError = error
        }
      }
      throw lastError
    }
  )
})

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

  it('does not retry an unsettled timeout as a classified transient result', async () => {
    const scheduler = createScheduler()
    const timeoutError = new Error('lookup timed out')
    timeoutError.name = 'TimeoutError'
    scheduler.timeout.mockRejectedValue(timeoutError)
    const sessionRepository = createSessionRepository()
    sessionRepository.resolve.mockReturnValue(new Promise(() => {}))
    const service = new SessionService({
      sessionRepository: sessionRepository as any,
      messageRepository: createMessageRepository() as any,
      scheduler: scheduler as any
    })

    await expect(service.restoreSession('session-1')).rejects.toBe(timeoutError)
    expect(sessionRepository.resolve).toHaveBeenCalledTimes(1)
    expect(logger.warn).not.toHaveBeenCalled()
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
    expect(scheduler.retry).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledTimes(1)
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
