import type { ChatMessageRecord, SessionWithState } from '@shared/types/agent-interface'
import { ChatService } from '@/routes/chat/chatService'

const createSession = (): SessionWithState => ({
  id: 'session-1',
  agentId: 'deepchat',
  title: 'Session',
  projectDir: null,
  isPinned: false,
  isDraft: false,
  sessionKind: 'regular',
  parentSessionId: null,
  subagentEnabled: false,
  subagentMeta: null,
  createdAt: 1,
  updatedAt: 1,
  status: 'idle',
  providerId: 'openai',
  modelId: 'model-1'
})

const createMessage = (): ChatMessageRecord => ({
  id: 'message-1',
  sessionId: 'session-1',
  orderSeq: 1,
  role: 'user',
  content: '{"text":"Hello"}',
  status: 'sent',
  isContextEdge: 0,
  metadata: '{}',
  createdAt: 1,
  updatedAt: 1
})

const createScheduler = () => ({
  sleep: vi.fn(),
  timeout: vi.fn(async <T>({ task }: { task: Promise<T> }) => await task),
  retry: vi.fn()
})

function createHarness() {
  const scheduler = createScheduler()
  const projection = {
    getSession: vi.fn().mockResolvedValue(createSession()),
    getMessage: vi.fn().mockResolvedValue(null)
  }
  const turn = {
    sendMessage: vi.fn().mockResolvedValue({ requestId: null, messageId: null }),
    steerActiveTurn: vi.fn().mockResolvedValue(undefined),
    cancelGeneration: vi.fn().mockResolvedValue(undefined),
    respondToolInteraction: vi.fn().mockResolvedValue({ resumed: true })
  }
  const providerCatalogPort = {
    getAgentType: vi.fn().mockResolvedValue('deepchat' as const)
  }
  const sessionPermissionPort = {
    clearSessionPermissions: vi.fn()
  }
  const service = new ChatService({
    projection,
    turn,
    providerCatalogPort,
    sessionPermissionPort,
    scheduler
  })

  return {
    service,
    scheduler,
    projection,
    turn,
    providerCatalogPort,
    sessionPermissionPort
  }
}

describe('ChatService', () => {
  it('sends messages through the scheduler after resolving the session owner', async () => {
    const harness = createHarness()

    await expect(harness.service.sendMessage('session-1', 'hello')).resolves.toEqual({
      accepted: true,
      requestId: null,
      messageId: null
    })

    expect(harness.projection.getSession).toHaveBeenCalledWith('session-1')
    expect(harness.providerCatalogPort.getAgentType).toHaveBeenCalledWith('deepchat')
    expect(harness.turn.sendMessage).toHaveBeenCalledWith('session-1', 'hello')
    expect(harness.scheduler.timeout).toHaveBeenCalledTimes(3)
    expect(harness.scheduler.timeout).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        ms: 5_000,
        reason: 'chat.sendMessage:session-1:session'
      })
    )
    expect(harness.scheduler.timeout).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ms: 5_000,
        reason: 'chat.sendMessage:session-1:agentType'
      })
    )
    expect(harness.scheduler.timeout).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        ms: 30 * 60 * 1_000,
        reason: 'chat.sendMessage:session-1',
        signal: expect.any(AbortSignal)
      })
    )
  })

  it('releases the send lock after missing session and agent type preflight failures', async () => {
    const harness = createHarness()
    harness.projection.getSession.mockResolvedValueOnce(null).mockResolvedValue(createSession())
    harness.providerCatalogPort.getAgentType
      .mockResolvedValueOnce(null)
      .mockResolvedValue('deepchat')
    harness.turn.sendMessage.mockResolvedValueOnce({
      requestId: 'request-1',
      messageId: 'message-1'
    })

    await expect(harness.service.sendMessage('session-1', 'missing session')).rejects.toThrow(
      'Session not found: session-1'
    )
    expect(harness.providerCatalogPort.getAgentType).not.toHaveBeenCalled()
    expect(harness.turn.sendMessage).not.toHaveBeenCalled()

    await expect(harness.service.sendMessage('session-1', 'missing agent type')).rejects.toThrow(
      'Agent type not found: deepchat'
    )
    expect(harness.turn.sendMessage).not.toHaveBeenCalled()

    await expect(harness.service.sendMessage('session-1', 'retry')).resolves.toEqual({
      accepted: true,
      requestId: 'request-1',
      messageId: 'message-1'
    })
    expect(harness.turn.sendMessage).toHaveBeenCalledExactlyOnceWith('session-1', 'retry')
  })

  it('steers the active turn without claiming the normal send lock', async () => {
    const harness = createHarness()

    await expect(harness.service.steerActiveTurn('session-1', 'refine this')).resolves.toEqual({
      accepted: true
    })

    expect(harness.projection.getSession).toHaveBeenCalledWith('session-1')
    expect(harness.turn.steerActiveTurn).toHaveBeenCalledWith('session-1', 'refine this')
    expect(harness.scheduler.timeout).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'chat.steerActiveTurn:session-1' })
    )
  })

  it('resolves stopStream by request id and cleans up the session', async () => {
    const harness = createHarness()
    harness.projection.getMessage.mockResolvedValueOnce(createMessage())

    await expect(harness.service.stopStream({ requestId: 'message-1' })).resolves.toEqual({
      stopped: true
    })

    expect(harness.projection.getMessage).toHaveBeenCalledWith('message-1')
    expect(harness.sessionPermissionPort.clearSessionPermissions).toHaveBeenCalledWith('session-1')
    expect(harness.turn.cancelGeneration).toHaveBeenCalledWith('session-1')
    expect(harness.scheduler.timeout).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        ms: 5_000,
        reason: 'chat.stopStream:message-1:message'
      })
    )
    expect(harness.scheduler.timeout).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ms: 5_000,
        reason: 'chat.stopStream:session-1'
      })
    )
  })

  it('returns stopped false when a request id cannot be mapped to a session', async () => {
    const harness = createHarness()

    await expect(harness.service.stopStream({ requestId: 'missing-message' })).resolves.toEqual({
      stopped: false
    })

    expect(harness.scheduler.timeout).toHaveBeenCalledOnce()
    expect(harness.sessionPermissionPort.clearSessionPermissions).not.toHaveBeenCalled()
    expect(harness.turn.cancelGeneration).not.toHaveBeenCalled()
  })

  it('attempts both stopStream cleanups when permission cleanup fails', async () => {
    const harness = createHarness()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    harness.projection.getMessage.mockResolvedValueOnce(createMessage())
    harness.sessionPermissionPort.clearSessionPermissions.mockRejectedValueOnce(
      new Error('permission cleanup failed')
    )

    await expect(harness.service.stopStream({ requestId: 'message-1' })).resolves.toEqual({
      stopped: true
    })

    expect(harness.sessionPermissionPort.clearSessionPermissions).toHaveBeenCalledWith('session-1')
    expect(harness.turn.cancelGeneration).toHaveBeenCalledWith('session-1')
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('responds to tool interactions through the turn port', async () => {
    const harness = createHarness()
    harness.turn.respondToolInteraction.mockResolvedValueOnce({
      resumed: true,
      waitingForUserMessage: false
    })

    await expect(
      harness.service.respondToolInteraction({
        sessionId: 'session-1',
        messageId: 'message-1',
        toolCallId: 'tool-1',
        response: { kind: 'permission', granted: true }
      })
    ).resolves.toEqual({
      accepted: true,
      resumed: true,
      waitingForUserMessage: false
    })

    expect(harness.turn.respondToolInteraction).toHaveBeenCalledWith(
      'session-1',
      'message-1',
      'tool-1',
      { kind: 'permission', granted: true }
    )
    expect(harness.scheduler.timeout).toHaveBeenCalledWith(
      expect.objectContaining({
        ms: 30 * 60 * 1_000,
        reason: 'chat.respondToolInteraction:session-1:tool-1'
      })
    )
  })

  it('attempts both timeout cleanups when permission cleanup fails', async () => {
    const harness = createHarness()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const timeoutError = new Error('timed out')
    timeoutError.name = 'TimeoutError'
    harness.turn.sendMessage.mockRejectedValueOnce(timeoutError)
    harness.sessionPermissionPort.clearSessionPermissions.mockRejectedValueOnce(
      new Error('permission cleanup failed')
    )

    await expect(harness.service.sendMessage('session-1', 'hello')).rejects.toBe(timeoutError)

    expect(harness.sessionPermissionPort.clearSessionPermissions).toHaveBeenCalledWith('session-1')
    expect(harness.turn.cancelGeneration).toHaveBeenCalledWith('session-1')
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('releases the send lock after non-timeout failures without cleanup', async () => {
    const harness = createHarness()
    const sendError = new Error('provider failed')
    harness.turn.sendMessage
      .mockRejectedValueOnce(sendError)
      .mockResolvedValueOnce({ requestId: 'request-2', messageId: 'message-2' })

    await expect(harness.service.sendMessage('session-1', 'first')).rejects.toBe(sendError)
    await expect(harness.service.sendMessage('session-1', 'second')).resolves.toEqual({
      accepted: true,
      requestId: 'request-2',
      messageId: 'message-2'
    })
    expect(harness.sessionPermissionPort.clearSessionPermissions).not.toHaveBeenCalled()
    expect(harness.turn.cancelGeneration).not.toHaveBeenCalled()
  })

  it('aborts a pending send when stopStream races during preflight', async () => {
    const createAbortError = (reason: string) => {
      const error = new Error(reason)
      error.name = 'AbortError'
      return error
    }
    const scheduler = {
      sleep: vi.fn(),
      timeout: vi.fn(
        async <T>({
          task,
          signal,
          reason
        }: {
          task: Promise<T>
          signal?: AbortSignal
          reason: string
        }) => {
          if (signal?.aborted) throw createAbortError(reason)

          return await new Promise<T>((resolve, reject) => {
            const onAbort = () => {
              signal?.removeEventListener('abort', onAbort)
              reject(createAbortError(reason))
            }

            signal?.addEventListener('abort', onAbort, { once: true })
            task.then(
              (value) => {
                signal?.removeEventListener('abort', onAbort)
                resolve(value)
              },
              (error) => {
                signal?.removeEventListener('abort', onAbort)
                reject(error)
              }
            )
          })
        }
      ),
      retry: vi.fn()
    }
    let resolveSession!: (value: SessionWithState) => void
    const projection = {
      getSession: vi.fn().mockImplementation(
        async () =>
          await new Promise<SessionWithState>((resolve) => {
            resolveSession = resolve
          })
      ),
      getMessage: vi.fn().mockResolvedValue(null)
    }
    const turn = {
      sendMessage: vi.fn().mockResolvedValue({ requestId: null, messageId: null }),
      steerActiveTurn: vi.fn().mockResolvedValue(undefined),
      cancelGeneration: vi.fn().mockResolvedValue(undefined),
      respondToolInteraction: vi.fn().mockResolvedValue({})
    }
    const providerCatalogPort = {
      getAgentType: vi.fn().mockResolvedValue('deepchat' as const)
    }
    const sessionPermissionPort = {
      clearSessionPermissions: vi.fn().mockResolvedValue(undefined)
    }
    const service = new ChatService({
      projection,
      turn,
      providerCatalogPort,
      sessionPermissionPort,
      scheduler
    })

    const pendingSend = service.sendMessage('session-1', 'hello')
    await Promise.resolve()

    await expect(service.stopStream({ sessionId: 'session-1' })).resolves.toEqual({
      stopped: true
    })

    resolveSession(createSession())

    await expect(pendingSend).rejects.toMatchObject({ name: 'AbortError' })
    expect(sessionPermissionPort.clearSessionPermissions).toHaveBeenCalledWith('session-1')
    expect(turn.cancelGeneration).toHaveBeenCalledWith('session-1')
  })

  it('rejects a new send while another stream is active for the session', async () => {
    const harness = createHarness()
    let resolveFirstSend!: (value: { requestId: string; messageId: string }) => void
    harness.turn.sendMessage.mockImplementationOnce(
      async () =>
        await new Promise<{ requestId: string; messageId: string }>((resolve) => {
          resolveFirstSend = resolve
        })
    )

    const firstSend = harness.service.sendMessage('session-1', 'hello')

    await expect(harness.service.sendMessage('session-1', 'again')).rejects.toThrow(
      'A stream is already active for session session-1'
    )

    resolveFirstSend({ requestId: 'assistant-1', messageId: 'assistant-1' })
    await expect(firstSend).resolves.toEqual({
      accepted: true,
      requestId: 'assistant-1',
      messageId: 'assistant-1'
    })
  })
})
