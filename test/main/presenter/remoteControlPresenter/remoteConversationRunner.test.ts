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
})
