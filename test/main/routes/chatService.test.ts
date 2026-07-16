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
  const sessionPermissionPort = {
    clearSessionPermissions: vi.fn()
  }
  const service = new ChatService({
    projection,
    turn,
    sessionPermissionPort,
    scheduler
  })

  return {
    service,
    scheduler,
    projection,
    turn,
    sessionPermissionPort
  }
}

describe('ChatService', () => {
  it('sends messages through the scheduler after resolving the session', async () => {
    const harness = createHarness()

    await expect(harness.service.sendMessage('session-1', 'hello')).resolves.toEqual({
      accepted: true,
      requestId: null,
      messageId: null
    })

    expect(harness.projection.getSession).toHaveBeenCalledWith('session-1')
    expect(harness.turn.sendMessage).toHaveBeenCalledWith('session-1', 'hello')
    expect(harness.scheduler.timeout).toHaveBeenCalledTimes(2)
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
        ms: 30 * 60 * 1_000,
        reason: 'chat.sendMessage:session-1',
        signal: expect.any(AbortSignal)
      })
    )
  })

  it('allows concurrent send accepts so runtime queue owns generation concurrency', async () => {
    const harness = createHarness()
    let resolveFirstSend!: (value: { requestId: string; messageId: string }) => void
    harness.turn.sendMessage.mockImplementationOnce(
      async () =>
        await new Promise<{ requestId: string; messageId: string }>((resolve) => {
          resolveFirstSend = resolve
        })
    )
    harness.turn.sendMessage.mockResolvedValueOnce({
      requestId: 'assistant-2',
      messageId: 'assistant-2'
    })

    const firstSend = harness.service.sendMessage('session-1', 'hello')
    await expect(harness.service.sendMessage('session-1', 'again')).resolves.toEqual({
      accepted: true,
      requestId: 'assistant-2',
      messageId: 'assistant-2'
    })

    resolveFirstSend({ requestId: 'assistant-1', messageId: 'assistant-1' })
    await expect(firstSend).resolves.toEqual({
      accepted: true,
      requestId: 'assistant-1',
      messageId: 'assistant-1'
    })
  })

  it('releases accept controller after missing session preflight failures', async () => {
    const harness = createHarness()
    harness.projection.getSession.mockResolvedValueOnce(null).mockResolvedValue(createSession())
    harness.turn.sendMessage.mockResolvedValueOnce({
      requestId: 'request-1',
      messageId: 'message-1'
    })

    await expect(harness.service.sendMessage('session-1', 'missing session')).rejects.toThrow(
      'Session not found: session-1'
    )
    expect(harness.turn.sendMessage).not.toHaveBeenCalled()

    await expect(harness.service.sendMessage('session-1', 'retry')).resolves.toEqual({
      accepted: true,
      requestId: 'request-1',
      messageId: 'message-1'
    })
    expect(harness.turn.sendMessage).toHaveBeenCalledExactlyOnceWith('session-1', 'retry')
  })

  it('steers the active turn without blocking send accepts', async () => {
    const harness = createHarness()

    await expect(harness.service.steerActiveTurn('session-1', 'refine this')).resolves.toEqual({
      accepted: true
    })
    expect(harness.turn.steerActiveTurn).toHaveBeenCalledWith('session-1', 'refine this')
  })

  it('stops by session id and reports cancel failure', async () => {
    const harness = createHarness()
    harness.turn.cancelGeneration.mockRejectedValueOnce(new Error('cancel failed'))

    await expect(harness.service.stopStream({ sessionId: 'session-1' })).resolves.toEqual({
      stopped: false
    })
    expect(harness.sessionPermissionPort.clearSessionPermissions).toHaveBeenCalledWith('session-1')
    expect(harness.turn.cancelGeneration).toHaveBeenCalledWith('session-1')
  })

  it('returns an honest stop result when bounded cleanup times out', async () => {
    const harness = createHarness()
    const cleanupTimeout = new Error('cleanup timed out')
    cleanupTimeout.name = 'TimeoutError'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    harness.scheduler.timeout.mockRejectedValueOnce(cleanupTimeout)

    await expect(harness.service.stopStream({ sessionId: 'session-1' })).resolves.toEqual({
      stopped: false
    })

    expect(harness.sessionPermissionPort.clearSessionPermissions).toHaveBeenCalledWith('session-1')
    expect(harness.turn.cancelGeneration).toHaveBeenCalledWith('session-1')
    warn.mockRestore()
  })

  it('bounds timeout cleanup and preserves the original send timeout', async () => {
    const harness = createHarness()
    const sendTimeout = new Error('send timed out')
    sendTimeout.name = 'TimeoutError'
    const clearError = new Error('clear failed synchronously')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    harness.sessionPermissionPort.clearSessionPermissions.mockImplementation(() => {
      throw clearError
    })
    harness.scheduler.timeout.mockImplementation(
      async <T>({ task, reason }: { task: Promise<T>; reason: string }) => {
        if (reason === 'chat.sendMessage:session-1') throw sendTimeout
        return await task
      }
    )

    await expect(harness.service.sendMessage('session-1', 'hello')).rejects.toBe(sendTimeout)

    expect(harness.turn.cancelGeneration).toHaveBeenCalledWith('session-1')
    expect(harness.scheduler.timeout).toHaveBeenCalledWith(
      expect.objectContaining({
        ms: 5_000,
        reason: 'chat.bestEffortCancel:session-1'
      })
    )
    warn.mockRestore()
  })

  it('resolves stop target from message id when session id is omitted', async () => {
    const harness = createHarness()
    harness.projection.getMessage.mockResolvedValue(createMessage())

    await expect(harness.service.stopStream({ requestId: 'message-1' })).resolves.toEqual({
      stopped: true
    })
    expect(harness.projection.getMessage).toHaveBeenCalledWith('message-1')
    expect(harness.turn.cancelGeneration).toHaveBeenCalledWith('session-1')
  })

  it('aborts every concurrent in-flight send accept path on stop', async () => {
    const scheduler = {
      sleep: vi.fn(),
      timeout: vi.fn(async <T>({ task, signal }: { task: Promise<T>; signal?: AbortSignal }) => {
        if (!signal) {
          return await task
        }
        return await new Promise<T>((resolve, reject) => {
          if (signal.aborted) {
            const error = new Error('Aborted')
            error.name = 'AbortError'
            reject(error)
            return
          }
          const onAbort = () => {
            const error = new Error('Aborted')
            error.name = 'AbortError'
            reject(error)
          }
          signal.addEventListener('abort', onAbort, { once: true })
          void task.then(
            (value) => {
              signal.removeEventListener('abort', onAbort)
              resolve(value)
            },
            (error) => {
              signal.removeEventListener('abort', onAbort)
              reject(error)
            }
          )
        })
      }),
      retry: vi.fn()
    }
    const resolveSessions: Array<(value: SessionWithState) => void> = []
    const projection = {
      getSession: vi.fn().mockImplementation(
        async () =>
          await new Promise<SessionWithState>((resolve) => {
            resolveSessions.push(resolve)
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
    const sessionPermissionPort = {
      clearSessionPermissions: vi.fn()
    }
    const service = new ChatService({
      projection,
      turn,
      sessionPermissionPort,
      scheduler
    })

    const firstPendingSend = service.sendMessage('session-1', 'hello')
    const secondPendingSend = service.sendMessage('session-1', 'again')
    await Promise.resolve()

    await expect(service.stopStream({ sessionId: 'session-1' })).resolves.toEqual({
      stopped: true
    })

    expect(resolveSessions).toHaveLength(2)
    for (const resolveSession of resolveSessions) {
      resolveSession(createSession())
    }

    await expect(firstPendingSend).rejects.toMatchObject({ name: 'AbortError' })
    await expect(secondPendingSend).rejects.toMatchObject({ name: 'AbortError' })
    expect(sessionPermissionPort.clearSessionPermissions).toHaveBeenCalledWith('session-1')
    expect(turn.cancelGeneration).toHaveBeenCalledWith('session-1')
  })
})
