import { describe, expect, it, vi } from 'vitest'
import { RemoteConversationRunner } from '@/presenter/remoteControlPresenter/services/remoteConversationRunner'

const createSession = (overrides: Record<string, unknown> = {}) => ({
  id: 'session-1',
  agentId: 'deepchat',
  title: 'Remote Session',
  projectDir: null,
  isPinned: false,
  isDraft: false,
  createdAt: 1,
  updatedAt: 1,
  status: 'idle',
  providerId: 'openai',
  modelId: 'gpt-5',
  ...overrides
})

describe('RemoteConversationRunner', () => {
  it('creates new sessions with the current default deepchat agent', async () => {
    const bindingStore = {
      setBinding: vi.fn()
    }
    const runner = new RemoteConversationRunner(
      {
        configPresenter: {} as any,
        newAgentPresenter: {
          createDetachedSession: vi
            .fn()
            .mockResolvedValue(createSession({ agentId: 'deepchat-alt' }))
        } as any,
        deepchatAgentPresenter: {} as any,
        windowPresenter: {} as any,
        tabPresenter: {} as any,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat-alt')
      },
      bindingStore as any
    )

    const session = await runner.createNewSession('telegram:100:0', 'Remote Session')

    expect(session.agentId).toBe('deepchat-alt')
    expect(bindingStore.setBinding).toHaveBeenCalledWith('telegram:100:0', session.id)
  })

  it('keeps using the bound session even after the default agent changes', async () => {
    const newAgentPresenter = {
      createDetachedSession: vi.fn(),
      getSession: vi.fn().mockResolvedValue(
        createSession({
          id: 'session-legacy',
          agentId: 'deepchat-legacy'
        })
      ),
      getMessages: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getMessage: vi.fn().mockResolvedValue({
        id: 'msg-1',
        role: 'assistant',
        content: 'hello from legacy',
        status: 'success',
        orderSeq: 2
      })
    }
    const bindingStore = {
      getBinding: vi.fn().mockReturnValue({
        sessionId: 'session-legacy',
        updatedAt: 1
      }),
      clearBinding: vi.fn(),
      clearActiveEvent: vi.fn(),
      rememberActiveEvent: vi.fn(),
      setBinding: vi.fn()
    }
    const deepchatAgentPresenter = {
      getActiveGeneration: vi.fn().mockReturnValue({
        eventId: 'msg-1',
        runId: 'run-1'
      })
    }
    const runner = new RemoteConversationRunner(
      {
        configPresenter: {} as any,
        newAgentPresenter: newAgentPresenter as any,
        deepchatAgentPresenter: deepchatAgentPresenter as any,
        windowPresenter: {} as any,
        tabPresenter: {} as any,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat-new')
      },
      bindingStore as any
    )

    const execution = await runner.sendText('telegram:100:0', 'hello')

    expect(execution.sessionId).toBe('session-legacy')
    expect(newAgentPresenter.sendMessage).toHaveBeenCalledWith('session-legacy', 'hello')
    expect(newAgentPresenter.createDetachedSession).not.toHaveBeenCalled()
  })

  it('lists recent sessions for the currently bound agent before falling back to default agent', async () => {
    const newAgentPresenter = {
      getSession: vi.fn().mockResolvedValue(
        createSession({
          id: 'session-bound',
          agentId: 'deepchat-bound'
        })
      ),
      getSessionList: vi.fn().mockResolvedValue([
        createSession({
          id: 'session-a',
          agentId: 'deepchat-bound',
          updatedAt: 5
        }),
        createSession({
          id: 'session-b',
          agentId: 'deepchat-bound',
          updatedAt: 10
        })
      ])
    }
    const bindingStore = {
      getBinding: vi.fn().mockReturnValue({
        sessionId: 'session-bound',
        updatedAt: 1
      }),
      rememberSessionSnapshot: vi.fn()
    }
    const runner = new RemoteConversationRunner(
      {
        configPresenter: {} as any,
        newAgentPresenter: newAgentPresenter as any,
        deepchatAgentPresenter: {} as any,
        windowPresenter: {} as any,
        tabPresenter: {} as any,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat-default')
      },
      bindingStore as any
    )

    const sessions = await runner.listSessions('telegram:100:0')

    expect(newAgentPresenter.getSessionList).toHaveBeenCalledWith({
      agentId: 'deepchat-bound'
    })
    expect(sessions.map((session) => session.id)).toEqual(['session-b', 'session-a'])
    expect(bindingStore.rememberSessionSnapshot).toHaveBeenCalledWith('telegram:100:0', [
      'session-b',
      'session-a'
    ])
  })

  it('delegates remote model switching to the bound session', async () => {
    const newAgentPresenter = {
      getSession: vi.fn().mockResolvedValue(
        createSession({
          id: 'session-bound',
          agentId: 'deepchat-bound'
        })
      ),
      setSessionModel: vi.fn().mockResolvedValue(
        createSession({
          id: 'session-bound',
          agentId: 'deepchat-bound',
          providerId: 'anthropic',
          modelId: 'claude-3-5-sonnet'
        })
      )
    }
    const runner = new RemoteConversationRunner(
      {
        configPresenter: {} as any,
        newAgentPresenter: newAgentPresenter as any,
        deepchatAgentPresenter: {} as any,
        windowPresenter: {} as any,
        tabPresenter: {} as any,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat-default')
      },
      {
        getBinding: vi.fn().mockReturnValue({
          sessionId: 'session-bound',
          updatedAt: 1
        })
      } as any
    )

    const updated = await runner.setSessionModel('telegram:100:0', 'anthropic', 'claude-3-5-sonnet')

    expect(newAgentPresenter.setSessionModel).toHaveBeenCalledWith(
      'session-bound',
      'anthropic',
      'claude-3-5-sonnet'
    )
    expect(updated.providerId).toBe('anthropic')
    expect(updated.modelId).toBe('claude-3-5-sonnet')
  })

  it('does not fall back to the previous active assistant event while waiting for a new reply', async () => {
    vi.useFakeTimers()

    const session = createSession({
      id: 'session-legacy',
      agentId: 'deepchat-legacy',
      status: 'idle'
    })
    const oldAssistantMessage = {
      id: 'msg-old',
      role: 'assistant',
      content: 'old reply',
      status: 'success',
      orderSeq: 2
    }

    const newAgentPresenter = {
      getSession: vi.fn().mockResolvedValue(session),
      getMessages: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'user-1',
            role: 'user',
            content: 'hello',
            status: 'success',
            orderSeq: 1
          }
        ])
        .mockResolvedValue([oldAssistantMessage]),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getMessage: vi.fn().mockResolvedValue(null)
    }
    const bindingStore = {
      getBinding: vi.fn().mockReturnValue({
        sessionId: 'session-legacy',
        updatedAt: 1
      }),
      clearBinding: vi.fn(),
      clearActiveEvent: vi.fn(),
      rememberActiveEvent: vi.fn(),
      setBinding: vi.fn()
    }
    const deepchatAgentPresenter = {
      getActiveGeneration: vi
        .fn()
        .mockReturnValueOnce({
          eventId: 'msg-old',
          runId: 'run-old'
        })
        .mockReturnValue(null)
    }
    const runner = new RemoteConversationRunner(
      {
        configPresenter: {} as any,
        newAgentPresenter: newAgentPresenter as any,
        deepchatAgentPresenter: deepchatAgentPresenter as any,
        windowPresenter: {} as any,
        tabPresenter: {} as any,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat-new')
      },
      bindingStore as any
    )

    const executionPromise = runner.sendText('telegram:100:0', 'hello again')
    await vi.advanceTimersByTimeAsync(1000)
    const execution = await executionPromise

    expect(execution.eventId).toBeNull()
    expect(bindingStore.rememberActiveEvent).not.toHaveBeenCalledWith('telegram:100:0', 'msg-old')

    const snapshot = await execution.getSnapshot()

    expect(snapshot).toEqual({
      messageId: null,
      text: 'No assistant response was produced.',
      completed: true
    })

    vi.useRealTimers()
  })
})
