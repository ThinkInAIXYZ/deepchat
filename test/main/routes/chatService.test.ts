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
      cancelGeneration: vi.fn().mockResolvedValue(undefined)
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
      cancelGeneration: vi.fn().mockResolvedValue(undefined)
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
})
