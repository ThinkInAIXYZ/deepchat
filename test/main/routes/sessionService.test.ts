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

    expect(scheduler.retry).toHaveBeenCalledTimes(1)
    expect(scheduler.timeout).toHaveBeenCalledTimes(2)
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
})
