import { SessionService } from '@/routes/sessions/sessionService'

describe('SessionService', () => {
  const createScheduler = () => ({
    sleep: vi.fn(),
    timeout: vi.fn(async <T>({ task }: { task: Promise<T> }) => await task),
    retry: vi.fn(async <T>({ task }: { task: () => Promise<T> }) => await task())
  })

  it('restores session snapshots through the scheduler and repositories', async () => {
    const scheduler = createScheduler()
    const sessionRepository = {
      create: vi.fn(),
      get: vi.fn().mockResolvedValue({
        id: 'session-1'
      }),
      list: vi.fn(),
      activate: vi.fn(),
      deactivate: vi.fn(),
      getActive: vi.fn()
    }
    const messageRepository = {
      listBySession: vi.fn(),
      listPageBySession: vi.fn().mockResolvedValue({
        messages: [{ id: 'message-1', sessionId: 'session-1' }],
        nextCursor: null,
        hasMore: false
      }),
      get: vi.fn()
    }

    const service = new SessionService({
      sessionRepository,
      messageRepository,
      scheduler
    })

    const result = await service.restoreSession('session-1')

    expect(scheduler.retry).toHaveBeenCalledWith(
      expect.objectContaining({
        maxAttempts: 2,
        initialDelayMs: 25,
        backoff: 1,
        reason: 'sessions.restore:session-1'
      })
    )
    expect(scheduler.timeout).toHaveBeenCalledTimes(2)
    expect(scheduler.timeout).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        ms: 5_000,
        reason: 'sessions.restore:session-1:session'
      })
    )
    expect(scheduler.timeout).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ms: 5_000,
        reason: 'sessions.restore:session-1:messages'
      })
    )
    expect(sessionRepository.get).toHaveBeenCalledWith('session-1')
    expect(messageRepository.listPageBySession).toHaveBeenCalledWith('session-1', {
      limit: 100
    })
    expect(result).toEqual({
      session: { id: 'session-1' },
      messages: [{ id: 'message-1', sessionId: 'session-1' }],
      nextCursor: null,
      hasMore: false
    })
  })

  it('uses an explicit restore message limit when provided', async () => {
    const scheduler = createScheduler()
    const sessionRepository = {
      create: vi.fn(),
      get: vi.fn().mockResolvedValue({ id: 'session-1' }),
      list: vi.fn(),
      activate: vi.fn(),
      deactivate: vi.fn(),
      getActive: vi.fn()
    }
    const messageRepository = {
      listBySession: vi.fn(),
      listPageBySession: vi.fn().mockResolvedValue({
        messages: [],
        nextCursor: null,
        hasMore: false
      }),
      get: vi.fn()
    }
    const service = new SessionService({ sessionRepository, messageRepository, scheduler })

    await service.restoreSession('session-1', 25)

    expect(messageRepository.listPageBySession).toHaveBeenCalledWith('session-1', {
      limit: 25
    })
  })

  it('returns an empty restore payload when the session no longer exists', async () => {
    const scheduler = createScheduler()
    const sessionRepository = {
      create: vi.fn(),
      get: vi.fn().mockResolvedValue(null),
      list: vi.fn(),
      activate: vi.fn(),
      deactivate: vi.fn(),
      getActive: vi.fn()
    }
    const messageRepository = {
      listBySession: vi.fn(),
      listPageBySession: vi.fn(),
      get: vi.fn()
    }

    const service = new SessionService({
      sessionRepository,
      messageRepository,
      scheduler
    })

    await expect(service.restoreSession('missing-session')).resolves.toEqual({
      session: null,
      messages: [],
      nextCursor: null,
      hasMore: false
    })
    expect(messageRepository.listPageBySession).not.toHaveBeenCalled()
  })

  it('routes session lifecycle operations through five-second scheduler boundaries', async () => {
    const scheduler = createScheduler()
    const session = { id: 'session-1' }
    const sessionRepository = {
      create: vi.fn().mockResolvedValue(session),
      get: vi.fn(),
      list: vi.fn().mockResolvedValue([session]),
      activate: vi.fn().mockResolvedValue(undefined),
      deactivate: vi.fn().mockResolvedValue(undefined),
      getActive: vi.fn().mockResolvedValue(session)
    }
    const messageRepository = {
      listBySession: vi.fn(),
      listPageBySession: vi.fn().mockResolvedValue({
        messages: [],
        nextCursor: null,
        hasMore: false
      }),
      get: vi.fn()
    }
    const service = new SessionService({ sessionRepository, messageRepository, scheduler })
    const context = { webContentsId: 42, windowId: 7 }
    const input = { agentId: 'deepchat', message: 'hello' }
    const filters = { agentId: 'deepchat' }
    const pageOptions = { limit: 20, cursor: null }

    await expect(service.createSession(input, context)).resolves.toEqual(session)
    await expect(service.listSessions(filters)).resolves.toEqual([session])
    await expect(service.listMessagesPage('session-1', pageOptions)).resolves.toEqual({
      messages: [],
      nextCursor: null,
      hasMore: false
    })
    await expect(service.activateSession(context, 'session-1')).resolves.toBeUndefined()
    await expect(service.deactivateSession(context)).resolves.toBeUndefined()
    await expect(service.getActiveSession(context)).resolves.toEqual(session)

    expect(sessionRepository.create).toHaveBeenCalledWith(input, 42)
    expect(sessionRepository.list).toHaveBeenCalledWith(filters)
    expect(messageRepository.listPageBySession).toHaveBeenCalledWith('session-1', pageOptions)
    expect(sessionRepository.activate).toHaveBeenCalledWith(42, 'session-1')
    expect(sessionRepository.deactivate).toHaveBeenCalledWith(42)
    expect(sessionRepository.getActive).toHaveBeenCalledWith(42)
    expect(scheduler.timeout.mock.calls.map(([options]) => [options.ms, options.reason])).toEqual([
      [5_000, 'sessions.create'],
      [5_000, 'sessions.list'],
      [5_000, 'sessions.listMessagesPage:session-1'],
      [5_000, 'sessions.activate:session-1'],
      [5_000, 'sessions.deactivate'],
      [5_000, 'sessions.getActive']
    ])
  })
})
