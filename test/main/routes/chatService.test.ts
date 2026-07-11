import { ChatService } from '@/routes/chat/chatService'
import { createNodeOperationRunner } from '@/routes/operationRunner'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('ChatService', () => {
  const availableSession = <T extends Record<string, unknown>>(session: T) => ({
    availability: 'available' as const,
    session
  })

  const createScheduler = () => ({
    sleep: vi.fn(),
    observeIdempotent: vi.fn(async <T>({ task }: { task: () => Promise<T> }) => await task()),
    retryIdempotent: vi.fn(),
    timeout: vi.fn(async <T>({ task }: { task: Promise<T> }) => await task)
  })

  it('sends messages through the scheduler after resolving the session owner', async () => {
    const scheduler = createScheduler()
    const sessionRepository = {
      resolve: vi.fn().mockResolvedValue(
        availableSession({
          id: 'session-1',
          agentId: 'deepchat'
        })
      )
    }
    const messageRepository = {
      listBySession: vi.fn(),
      get: vi.fn()
    }
    const providerExecutionPort = {
      sendMessage: vi.fn().mockResolvedValue({
        requestId: null,
        messageId: null
      }),
      steerActiveTurn: vi.fn().mockResolvedValue(undefined),
      cancelGeneration: vi.fn().mockResolvedValue(undefined),
      respondToolInteraction: vi.fn().mockResolvedValue({
        resumed: true
      })
    }
    const providerCatalogPort = {
      getAgentType: vi.fn().mockResolvedValue('deepchat')
    }
    const sessionPermissionPort = {
      clearSessionPermissions: vi.fn()
    }

    const service = new ChatService({
      sessionRepository: sessionRepository as any,
      messageRepository: messageRepository as any,
      providerExecutionPort,
      providerCatalogPort,
      sessionPermissionPort,
      scheduler
    })

    await expect(service.sendMessage('session-1', 'hello')).resolves.toEqual({
      accepted: true,
      requestId: null,
      messageId: null
    })

    expect(sessionRepository.resolve).toHaveBeenCalledWith('session-1')
    expect(providerCatalogPort.getAgentType).toHaveBeenCalledWith('deepchat')
    expect(providerExecutionPort.sendMessage).toHaveBeenCalledWith('session-1', 'hello')
    expect(messageRepository.listBySession).not.toHaveBeenCalled()
    expect(scheduler.observeIdempotent).toHaveBeenCalledTimes(2)
    expect(scheduler.timeout).not.toHaveBeenCalled()
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
    },
    {
      availability: 'transient_error' as const,
      sessionId: 'session-1',
      record: null,
      error: {
        code: 'SESSION_RESOLUTION_FAILED' as const,
        stage: 'record_read' as const,
        retryable: true as const,
        cause: new Error('temporary read failure')
      }
    }
  ])('does not start a send for $availability resolution', async (resolution) => {
    const providerExecutionPort = {
      sendMessage: vi.fn(),
      steerActiveTurn: vi.fn(),
      cancelGeneration: vi.fn(),
      respondToolInteraction: vi.fn()
    }
    const service = new ChatService({
      sessionRepository: {
        resolve: vi.fn().mockResolvedValue(resolution)
      } as any,
      messageRepository: {
        listBySession: vi.fn(),
        get: vi.fn()
      } as any,
      providerExecutionPort,
      providerCatalogPort: {
        getAgentType: vi.fn()
      } as any,
      sessionPermissionPort: {
        clearSessionPermissions: vi.fn()
      },
      scheduler: createScheduler() as any
    })

    await expect(service.sendMessage('session-1', 'hello')).rejects.toMatchObject({
      name: 'SessionResolutionError',
      availability: resolution.availability
    })
    expect(providerExecutionPort.sendMessage).not.toHaveBeenCalled()
  })

  it('steers the active turn without claiming the normal send lock', async () => {
    const scheduler = createScheduler()
    const sessionRepository = {
      resolve: vi.fn().mockResolvedValue(
        availableSession({
          id: 'session-1',
          agentId: 'deepchat'
        })
      )
    }
    const providerExecutionPort = {
      sendMessage: vi.fn(),
      steerActiveTurn: vi.fn().mockResolvedValue(undefined),
      cancelGeneration: vi.fn(),
      respondToolInteraction: vi.fn()
    }

    const service = new ChatService({
      sessionRepository: sessionRepository as any,
      messageRepository: {
        listBySession: vi.fn(),
        get: vi.fn()
      } as any,
      providerExecutionPort,
      providerCatalogPort: {
        getAgentType: vi.fn()
      } as any,
      sessionPermissionPort: {
        clearSessionPermissions: vi.fn()
      },
      scheduler
    })

    await expect(service.steerActiveTurn('session-1', 'refine this')).resolves.toEqual({
      accepted: true
    })

    expect(sessionRepository.resolve).toHaveBeenCalledWith('session-1')
    expect(providerExecutionPort.steerActiveTurn).toHaveBeenCalledWith('session-1', 'refine this')
    expect(scheduler.observeIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'chat.steerActiveTurn:session-1:session'
      })
    )
    expect(scheduler.timeout).not.toHaveBeenCalled()
  })

  it('resolves stopStream by request id and clears permissions before cancelling', async () => {
    const scheduler = createScheduler()
    const sessionRepository = {
      resolve: vi.fn()
    }
    const messageRepository = {
      listBySession: vi.fn(),
      get: vi.fn().mockResolvedValue({
        id: 'message-1',
        sessionId: 'session-1'
      })
    }
    const providerExecutionPort = {
      sendMessage: vi.fn(),
      steerActiveTurn: vi.fn(),
      cancelGeneration: vi.fn().mockResolvedValue(undefined),
      respondToolInteraction: vi.fn()
    }
    const providerCatalogPort = {
      getAgentType: vi.fn()
    }
    const sessionPermissionPort = {
      clearSessionPermissions: vi.fn()
    }

    const service = new ChatService({
      sessionRepository: sessionRepository as any,
      messageRepository: messageRepository as any,
      providerExecutionPort,
      providerCatalogPort,
      sessionPermissionPort,
      scheduler
    })

    await expect(service.stopStream({ requestId: 'message-1' })).resolves.toEqual({
      stopped: true
    })
    expect(messageRepository.get).toHaveBeenCalledWith('message-1')
    expect(sessionPermissionPort.clearSessionPermissions).toHaveBeenCalledWith('session-1')
    expect(providerExecutionPort.cancelGeneration).toHaveBeenCalledWith('session-1')
  })

  it('attempts both stopStream cleanups even if clearing permissions fails', async () => {
    const scheduler = createScheduler()
    const sessionRepository = {
      resolve: vi.fn()
    }
    const messageRepository = {
      listBySession: vi.fn(),
      get: vi.fn().mockResolvedValue({
        id: 'message-1',
        sessionId: 'session-1'
      })
    }
    const providerExecutionPort = {
      sendMessage: vi.fn(),
      steerActiveTurn: vi.fn(),
      cancelGeneration: vi.fn().mockResolvedValue(undefined),
      respondToolInteraction: vi.fn()
    }
    const providerCatalogPort = {
      getAgentType: vi.fn()
    }
    const sessionPermissionPort = {
      clearSessionPermissions: vi.fn().mockRejectedValue(new Error('permission cleanup failed'))
    }

    const service = new ChatService({
      sessionRepository: sessionRepository as any,
      messageRepository: messageRepository as any,
      providerExecutionPort,
      providerCatalogPort,
      sessionPermissionPort,
      scheduler
    })

    await expect(service.stopStream({ requestId: 'message-1' })).resolves.toEqual({
      stopped: true
    })
    expect(sessionPermissionPort.clearSessionPermissions).toHaveBeenCalledWith('session-1')
    expect(providerExecutionPort.cancelGeneration).toHaveBeenCalledWith('session-1')
  })

  it('responds to tool interactions through the provider execution port', async () => {
    const scheduler = createScheduler()
    const providerExecutionPort = {
      sendMessage: vi.fn(),
      steerActiveTurn: vi.fn(),
      cancelGeneration: vi.fn(),
      respondToolInteraction: vi.fn().mockResolvedValue({
        resumed: true,
        waitingForUserMessage: false
      })
    }

    const service = new ChatService({
      sessionRepository: {
        resolve: vi.fn()
      } as any,
      messageRepository: {
        listBySession: vi.fn(),
        get: vi.fn()
      } as any,
      providerExecutionPort,
      providerCatalogPort: {
        getAgentType: vi.fn()
      } as any,
      sessionPermissionPort: {
        clearSessionPermissions: vi.fn()
      },
      scheduler
    })

    await expect(
      service.respondToolInteraction({
        sessionId: 'session-1',
        messageId: 'message-1',
        toolCallId: 'tool-1',
        response: {
          kind: 'permission',
          granted: true
        }
      })
    ).resolves.toEqual({
      accepted: true,
      resumed: true,
      waitingForUserMessage: false
    })

    expect(providerExecutionPort.respondToolInteraction).toHaveBeenCalledWith(
      'session-1',
      'message-1',
      'tool-1',
      {
        kind: 'permission',
        granted: true
      }
    )
    expect(scheduler.timeout).not.toHaveBeenCalled()
  })

  it('does not reinterpret an owner TimeoutError as a route observation timeout', async () => {
    const scheduler = createScheduler()
    const timeoutError = new Error('timed out')
    timeoutError.name = 'TimeoutError'
    const sessionRepository = {
      resolve: vi.fn().mockResolvedValue(
        availableSession({
          id: 'session-1',
          agentId: 'deepchat'
        })
      )
    }
    const messageRepository = {
      listBySession: vi.fn().mockResolvedValue([]),
      get: vi.fn()
    }
    const providerExecutionPort = {
      sendMessage: vi.fn().mockRejectedValue(timeoutError),
      steerActiveTurn: vi.fn(),
      cancelGeneration: vi.fn().mockResolvedValue(undefined),
      respondToolInteraction: vi.fn()
    }
    const providerCatalogPort = {
      getAgentType: vi.fn().mockResolvedValue('deepchat')
    }
    const sessionPermissionPort = {
      clearSessionPermissions: vi.fn().mockRejectedValue(new Error('permission cleanup failed'))
    }

    const service = new ChatService({
      sessionRepository: sessionRepository as any,
      messageRepository: messageRepository as any,
      providerExecutionPort,
      providerCatalogPort,
      sessionPermissionPort,
      scheduler
    })

    await expect(service.sendMessage('session-1', 'hello')).rejects.toBe(timeoutError)

    expect(sessionPermissionPort.clearSessionPermissions).not.toHaveBeenCalled()
    expect(providerExecutionPort.cancelGeneration).not.toHaveBeenCalled()
  })

  it('aborts a pending send when stopStream races during preflight', async () => {
    const scheduler = createNodeOperationRunner()
    let resolveSession!: (value: {
      availability: 'available'
      session: { id: string; agentId: string }
    }) => void
    const sessionRepository = {
      resolve: vi.fn().mockImplementation(
        async () =>
          await new Promise<{
            availability: 'available'
            session: { id: string; agentId: string }
          }>((resolve) => {
            resolveSession = resolve
          })
      )
    }
    const messageRepository = {
      listBySession: vi.fn().mockResolvedValue([]),
      get: vi.fn()
    }
    const providerExecutionPort = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      steerActiveTurn: vi.fn().mockResolvedValue(undefined),
      cancelGeneration: vi.fn().mockResolvedValue(undefined),
      respondToolInteraction: vi.fn()
    }
    const providerCatalogPort = {
      getAgentType: vi.fn().mockResolvedValue('deepchat')
    }
    const sessionPermissionPort = {
      clearSessionPermissions: vi.fn().mockResolvedValue(undefined)
    }

    const service = new ChatService({
      sessionRepository: sessionRepository as any,
      messageRepository: messageRepository as any,
      providerExecutionPort,
      providerCatalogPort,
      sessionPermissionPort,
      scheduler
    })

    const pendingSend = service.sendMessage('session-1', 'hello')
    await Promise.resolve()

    await expect(service.stopStream({ sessionId: 'session-1' })).resolves.toEqual({
      stopped: true
    })

    resolveSession(
      availableSession({
        id: 'session-1',
        agentId: 'deepchat'
      })
    )

    await expect(pendingSend).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(providerCatalogPort.getAgentType).not.toHaveBeenCalled()
    expect(providerExecutionPort.sendMessage).not.toHaveBeenCalled()
    expect(sessionPermissionPort.clearSessionPermissions).toHaveBeenCalledWith('session-1')
    expect(providerExecutionPort.cancelGeneration).toHaveBeenCalledWith('session-1')
  })

  it('rejects a new send while another stream is still active for the session', async () => {
    const scheduler = createScheduler()
    const sessionRepository = {
      resolve: vi.fn().mockResolvedValue(
        availableSession({
          id: 'session-1',
          agentId: 'deepchat'
        })
      )
    }
    const messageRepository = {
      listBySession: vi.fn(),
      get: vi.fn()
    }
    let resolveFirstSend!: (value: { requestId: string; messageId: string }) => void
    const providerExecutionPort = {
      sendMessage: vi
        .fn()
        .mockImplementationOnce(
          async () =>
            await new Promise<{ requestId: string; messageId: string }>((resolve) => {
              resolveFirstSend = resolve
            })
        )
        .mockResolvedValue({
          requestId: 'assistant-1',
          messageId: 'assistant-1'
        }),
      steerActiveTurn: vi.fn().mockResolvedValue(undefined),
      cancelGeneration: vi.fn().mockResolvedValue(undefined),
      respondToolInteraction: vi.fn()
    }
    const providerCatalogPort = {
      getAgentType: vi.fn().mockResolvedValue('deepchat')
    }
    const sessionPermissionPort = {
      clearSessionPermissions: vi.fn()
    }

    const service = new ChatService({
      sessionRepository: sessionRepository as any,
      messageRepository: messageRepository as any,
      providerExecutionPort,
      providerCatalogPort,
      sessionPermissionPort,
      scheduler
    })

    const firstSend = service.sendMessage('session-1', 'hello')

    await expect(service.sendMessage('session-1', 'again')).rejects.toThrow(
      'A stream is already active for session session-1'
    )

    resolveFirstSend({
      requestId: 'assistant-1',
      messageId: 'assistant-1'
    })
    await expect(firstSend).resolves.toEqual({
      accepted: true,
      requestId: 'assistant-1',
      messageId: 'assistant-1'
    })
  })

  it('does not claim physical cancellation after the owner mutation has started', async () => {
    const scheduler = createNodeOperationRunner()
    const sessionRepository = {
      resolve: vi.fn().mockResolvedValue(
        availableSession({
          id: 'session-1',
          agentId: 'deepchat'
        })
      )
    }
    const firstOwnerMutation = deferred<{ requestId: string; messageId: string }>()
    const providerExecutionPort = {
      sendMessage: vi
        .fn()
        .mockReturnValueOnce(firstOwnerMutation.promise)
        .mockResolvedValueOnce({ requestId: 'assistant-2', messageId: 'assistant-2' }),
      steerActiveTurn: vi.fn(),
      cancelGeneration: vi.fn().mockResolvedValue(undefined),
      respondToolInteraction: vi.fn()
    }
    const sessionPermissionPort = {
      clearSessionPermissions: vi.fn().mockResolvedValue(undefined)
    }
    const service = new ChatService({
      sessionRepository: sessionRepository as any,
      messageRepository: {
        listBySession: vi.fn(),
        get: vi.fn()
      } as any,
      providerExecutionPort,
      providerCatalogPort: {
        getAgentType: vi.fn().mockResolvedValue('deepchat')
      } as any,
      sessionPermissionPort,
      scheduler
    })

    const firstSend = service.sendMessage('session-1', 'first')
    await vi.waitFor(() => {
      expect(providerExecutionPort.sendMessage).toHaveBeenCalledTimes(1)
    })
    let firstSettled = false
    void firstSend.finally(() => {
      firstSettled = true
    })

    await expect(service.stopStream({ sessionId: 'session-1' })).resolves.toEqual({
      stopped: true
    })
    await Promise.resolve()

    expect(firstSettled).toBe(false)
    expect(sessionPermissionPort.clearSessionPermissions).toHaveBeenCalledOnce()
    expect(providerExecutionPort.cancelGeneration).toHaveBeenCalledOnce()

    await expect(service.sendMessage('session-1', 'second')).resolves.toEqual({
      accepted: true,
      requestId: 'assistant-2',
      messageId: 'assistant-2'
    })

    firstOwnerMutation.resolve({ requestId: 'assistant-1', messageId: 'assistant-1' })
    await expect(firstSend).resolves.toEqual({
      accepted: true,
      requestId: 'assistant-1',
      messageId: 'assistant-1'
    })
    expect(providerExecutionPort.sendMessage).toHaveBeenCalledTimes(2)
  })

  it('aborts every concurrent steer preflight for the stopped session', async () => {
    const scheduler = createNodeOperationRunner()
    const firstRead = deferred<ReturnType<typeof availableSession>>()
    const secondRead = deferred<ReturnType<typeof availableSession>>()
    const sessionRepository = {
      resolve: vi
        .fn()
        .mockReturnValueOnce(firstRead.promise)
        .mockReturnValueOnce(secondRead.promise)
    }
    const providerExecutionPort = {
      sendMessage: vi.fn(),
      steerActiveTurn: vi.fn(),
      cancelGeneration: vi.fn().mockResolvedValue(undefined),
      respondToolInteraction: vi.fn()
    }
    const sessionPermissionPort = {
      clearSessionPermissions: vi.fn().mockResolvedValue(undefined)
    }
    const service = new ChatService({
      sessionRepository: sessionRepository as any,
      messageRepository: { listBySession: vi.fn(), get: vi.fn() } as any,
      providerExecutionPort,
      providerCatalogPort: { getAgentType: vi.fn() } as any,
      sessionPermissionPort,
      scheduler
    })

    const firstSteer = service.steerActiveTurn('session-1', 'first')
    const secondSteer = service.steerActiveTurn('session-1', 'second')
    const firstAborted = expect(firstSteer).rejects.toMatchObject({ name: 'AbortError' })
    const secondAborted = expect(secondSteer).rejects.toMatchObject({ name: 'AbortError' })
    expect(sessionRepository.resolve).toHaveBeenCalledTimes(2)

    await expect(service.stopStream({ sessionId: 'session-1' })).resolves.toEqual({
      stopped: true
    })
    await Promise.all([firstAborted, secondAborted])

    firstRead.resolve(availableSession({ id: 'session-1', agentId: 'deepchat' }))
    secondRead.resolve(availableSession({ id: 'session-1', agentId: 'deepchat' }))
    await Promise.resolve()
    expect(providerExecutionPort.steerActiveTurn).not.toHaveBeenCalled()
    expect(sessionPermissionPort.clearSessionPermissions).toHaveBeenCalledOnce()
    expect(providerExecutionPort.cancelGeneration).toHaveBeenCalledOnce()
  })

  it('does not let stale steer cleanup delete a newer preflight fence', async () => {
    const scheduler = createNodeOperationRunner()
    const firstRead = deferred<ReturnType<typeof availableSession>>()
    const secondRead = deferred<ReturnType<typeof availableSession>>()
    const sessionRepository = {
      resolve: vi
        .fn()
        .mockReturnValueOnce(firstRead.promise)
        .mockReturnValueOnce(secondRead.promise)
    }
    const providerExecutionPort = {
      sendMessage: vi.fn(),
      steerActiveTurn: vi.fn(),
      cancelGeneration: vi.fn().mockResolvedValue(undefined),
      respondToolInteraction: vi.fn()
    }
    const sessionPermissionPort = {
      clearSessionPermissions: vi.fn().mockResolvedValue(undefined)
    }
    const service = new ChatService({
      sessionRepository: sessionRepository as any,
      messageRepository: { listBySession: vi.fn(), get: vi.fn() } as any,
      providerExecutionPort,
      providerCatalogPort: { getAgentType: vi.fn() } as any,
      sessionPermissionPort,
      scheduler
    })

    const oldSteer = service.steerActiveTurn('session-1', 'old')
    const oldAborted = expect(oldSteer).rejects.toMatchObject({ name: 'AbortError' })
    const firstStop = service.stopStream({ sessionId: 'session-1' })
    const newSteer = service.steerActiveTurn('session-1', 'new')
    const newAborted = expect(newSteer).rejects.toMatchObject({ name: 'AbortError' })

    await firstStop
    await oldAborted
    await service.stopStream({ sessionId: 'session-1' })

    firstRead.resolve(availableSession({ id: 'session-1', agentId: 'deepchat' }))
    secondRead.resolve(availableSession({ id: 'session-1', agentId: 'deepchat' }))
    await newAborted
    expect(providerExecutionPort.steerActiveTurn).not.toHaveBeenCalled()
    expect(sessionPermissionPort.clearSessionPermissions).toHaveBeenCalledTimes(2)
    expect(providerExecutionPort.cancelGeneration).toHaveBeenCalledTimes(2)
  })

  it('keeps an owner-started steer pending while stop only requests cancellation', async () => {
    const scheduler = createNodeOperationRunner()
    const firstOwnerMutation = deferred<void>()
    const providerExecutionPort = {
      sendMessage: vi.fn().mockResolvedValue({ requestId: null, messageId: null }),
      steerActiveTurn: vi
        .fn()
        .mockReturnValueOnce(firstOwnerMutation.promise)
        .mockResolvedValueOnce(undefined),
      cancelGeneration: vi.fn().mockResolvedValue(undefined),
      respondToolInteraction: vi.fn()
    }
    const sessionPermissionPort = {
      clearSessionPermissions: vi.fn().mockResolvedValue(undefined)
    }
    const service = new ChatService({
      sessionRepository: {
        resolve: vi
          .fn()
          .mockResolvedValue(availableSession({ id: 'session-1', agentId: 'deepchat' }))
      } as any,
      messageRepository: { listBySession: vi.fn(), get: vi.fn() } as any,
      providerExecutionPort,
      providerCatalogPort: { getAgentType: vi.fn().mockResolvedValue('deepchat') } as any,
      sessionPermissionPort,
      scheduler
    })

    const firstSteer = service.steerActiveTurn('session-1', 'first')
    await vi.waitFor(() => {
      expect(providerExecutionPort.steerActiveTurn).toHaveBeenCalledOnce()
    })
    let firstSettled = false
    void firstSteer.finally(() => {
      firstSettled = true
    })

    await expect(service.sendMessage('session-1', 'send')).resolves.toMatchObject({
      accepted: true
    })
    await service.stopStream({ sessionId: 'session-1' })
    await Promise.resolve()
    expect(firstSettled).toBe(false)
    expect(sessionPermissionPort.clearSessionPermissions).toHaveBeenCalledOnce()
    expect(providerExecutionPort.cancelGeneration).toHaveBeenCalledOnce()

    await expect(service.steerActiveTurn('session-1', 'second')).resolves.toEqual({
      accepted: true
    })

    firstOwnerMutation.resolve()
    await expect(firstSteer).resolves.toEqual({ accepted: true })
    expect(providerExecutionPort.steerActiveTurn).toHaveBeenCalledTimes(2)
  })
})
