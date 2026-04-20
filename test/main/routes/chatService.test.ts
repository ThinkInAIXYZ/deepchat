import { ChatService } from '@/routes/chat/chatService'

describe('ChatService', () => {
  const createScheduler = () => ({
    sleep: vi.fn(),
    timeout: vi.fn(async <T>({ task }: { task: Promise<T> }) => await task),
    retry: vi.fn()
  })

  it('sends messages through the scheduler after resolving the session owner', async () => {
    const scheduler = createScheduler()
    const sessionRepository = {
      get: vi.fn().mockResolvedValue({
        id: 'session-1',
        agentId: 'deepchat'
      })
    }
    const messageRepository = {
      listBySession: vi.fn().mockResolvedValue([]),
      get: vi.fn()
    }
    const providerExecutionPort = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
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

    await service.sendMessage('session-1', 'hello')

    expect(sessionRepository.get).toHaveBeenCalledWith('session-1')
    expect(providerCatalogPort.getAgentType).toHaveBeenCalledWith('deepchat')
    expect(providerExecutionPort.sendMessage).toHaveBeenCalledWith('session-1', 'hello')
    expect(scheduler.timeout).toHaveBeenCalledTimes(4)
  })

  it('resolves stopStream by request id and clears permissions before cancelling', async () => {
    const scheduler = createScheduler()
    const sessionRepository = {
      get: vi.fn()
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

  it('responds to tool interactions through the provider execution port', async () => {
    const scheduler = createScheduler()
    const providerExecutionPort = {
      sendMessage: vi.fn(),
      cancelGeneration: vi.fn(),
      respondToolInteraction: vi.fn().mockResolvedValue({
        resumed: true,
        waitingForUserMessage: false
      })
    }

    const service = new ChatService({
      sessionRepository: {
        get: vi.fn()
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
    expect(scheduler.timeout).toHaveBeenCalledWith(
      expect.objectContaining({
        ms: 30 * 60 * 1_000,
        reason: 'chat.respondToolInteraction:session-1:tool-1'
      })
    )
  })

  it('attempts both timeout cleanups even if clearing permissions fails', async () => {
    const scheduler = createScheduler()
    const timeoutError = new Error('timed out')
    timeoutError.name = 'TimeoutError'
    const sessionRepository = {
      get: vi.fn().mockResolvedValue({
        id: 'session-1',
        agentId: 'deepchat'
      })
    }
    const messageRepository = {
      listBySession: vi.fn(),
      get: vi.fn()
    }
    const providerExecutionPort = {
      sendMessage: vi.fn().mockRejectedValue(timeoutError),
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

    expect(sessionPermissionPort.clearSessionPermissions).toHaveBeenCalledWith('session-1')
    expect(providerExecutionPort.cancelGeneration).toHaveBeenCalledWith('session-1')
  })

  it('rejects a new send while another stream is still active for the session', async () => {
    const scheduler = createScheduler()
    const sessionRepository = {
      get: vi.fn().mockResolvedValue({
        id: 'session-1',
        agentId: 'deepchat'
      })
    }
    const messageRepository = {
      listBySession: vi.fn().mockResolvedValue([
        {
          id: 'assistant-1',
          role: 'assistant',
          orderSeq: 2
        }
      ]),
      get: vi.fn()
    }
    let resolveFirstSend!: () => void
    const providerExecutionPort = {
      sendMessage: vi
        .fn()
        .mockImplementationOnce(
          async () =>
            await new Promise<void>((resolve) => {
              resolveFirstSend = resolve
            })
        )
        .mockResolvedValue(undefined),
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

    resolveFirstSend()
    await expect(firstSend).resolves.toEqual({
      accepted: true,
      requestId: 'assistant-1',
      messageId: 'assistant-1'
    })
  })
})
