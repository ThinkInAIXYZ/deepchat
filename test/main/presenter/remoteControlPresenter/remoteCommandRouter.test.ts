import { describe, expect, it, vi } from 'vitest'
import { RemoteCommandRouter } from '@/presenter/remoteControlPresenter/services/remoteCommandRouter'

const createMessage = (
  overrides: Partial<Parameters<RemoteCommandRouter['handleMessage']>[0]> = {}
) => ({
  updateId: 1,
  chatId: 100,
  messageThreadId: 0,
  messageId: 20,
  chatType: 'private',
  fromId: 123,
  text: 'hello',
  command: null,
  ...overrides
})

describe('RemoteCommandRouter', () => {
  it('returns pairing guidance for unauthorized plain text', async () => {
    const router = new RemoteCommandRouter({
      authGuard: {
        ensureAuthorized: vi.fn().mockReturnValue({
          ok: false,
          message: 'pair first'
        }),
        pair: vi.fn()
      } as any,
      runner: {} as any,
      bindingStore: {
        getEndpointKey: vi.fn().mockReturnValue('telegram:100:0'),
        getTelegramConfig: vi.fn().mockReturnValue({
          allowlist: [],
          bindings: {},
          streamMode: 'draft'
        })
      } as any,
      getPollerStatus: vi.fn().mockReturnValue({
        state: 'running',
        lastError: null,
        botUser: null
      })
    })

    const result = await router.handleMessage(createMessage())

    expect(result).toEqual({
      replies: ['pair first']
    })
  })

  it('routes plain text to the conversation runner when authorized', async () => {
    const conversation = {
      sessionId: 'session-1',
      eventId: 'msg-1',
      getSnapshot: vi.fn()
    }
    const runner = {
      sendText: vi.fn().mockResolvedValue(conversation),
      getDefaultAgentId: vi.fn().mockResolvedValue('deepchat')
    }
    const router = new RemoteCommandRouter({
      authGuard: {
        ensureAuthorized: vi.fn().mockReturnValue({
          ok: true,
          userId: 123
        }),
        pair: vi.fn()
      } as any,
      runner: runner as any,
      bindingStore: {
        getEndpointKey: vi.fn().mockReturnValue('telegram:100:0'),
        getTelegramConfig: vi.fn().mockReturnValue({
          allowlist: [123],
          bindings: {},
          streamMode: 'draft'
        })
      } as any,
      getPollerStatus: vi.fn().mockReturnValue({
        state: 'running',
        lastError: null,
        botUser: null
      })
    })

    const result = await router.handleMessage(createMessage())

    expect(runner.sendText).toHaveBeenCalledWith('telegram:100:0', 'hello')
    expect(result).toEqual({
      replies: [],
      conversation
    })
  })

  it('returns usage help for an invalid /use command', async () => {
    const runner = {
      useSessionByIndex: vi.fn()
    }
    const router = new RemoteCommandRouter({
      authGuard: {
        ensureAuthorized: vi.fn().mockReturnValue({
          ok: true,
          userId: 123
        }),
        pair: vi.fn()
      } as any,
      runner: runner as any,
      bindingStore: {
        getEndpointKey: vi.fn().mockReturnValue('telegram:100:0'),
        getTelegramConfig: vi.fn().mockReturnValue({
          allowlist: [123],
          bindings: {},
          streamMode: 'draft'
        })
      } as any,
      getPollerStatus: vi.fn().mockReturnValue({
        state: 'running',
        lastError: null,
        botUser: null
      })
    })

    const result = await router.handleMessage(
      createMessage({
        text: '/use nope',
        command: {
          name: 'use',
          args: 'nope'
        }
      })
    )

    expect(result).toEqual({
      replies: ['Usage: /use <index>']
    })
    expect(runner.useSessionByIndex).not.toHaveBeenCalled()
  })

  it('reports runtime state for /status', async () => {
    const router = new RemoteCommandRouter({
      authGuard: {
        ensureAuthorized: vi.fn().mockReturnValue({
          ok: true,
          userId: 123
        }),
        pair: vi.fn()
      } as any,
      runner: {
        getDefaultAgentId: vi.fn().mockResolvedValue('deepchat-alt'),
        getStatus: vi.fn().mockResolvedValue({
          session: {
            id: 'session-1',
            title: 'Remote chat',
            agentId: 'deepchat-alt',
            modelId: 'gpt-5'
          },
          activeEventId: 'msg-1',
          isGenerating: true
        })
      } as any,
      bindingStore: {
        getEndpointKey: vi.fn().mockReturnValue('telegram:100:0'),
        getTelegramConfig: vi.fn().mockReturnValue({
          allowlist: [123],
          bindings: {
            'telegram:100:0': { sessionId: 'session-1', updatedAt: 1 }
          },
          streamMode: 'draft'
        })
      } as any,
      getPollerStatus: vi.fn().mockReturnValue({
        state: 'running',
        lastError: null,
        botUser: null
      })
    })

    const result = await router.handleMessage(
      createMessage({
        text: '/status',
        command: {
          name: 'status',
          args: ''
        }
      })
    )

    expect(result.replies[0]).toContain('Runtime: running')
    expect(result.replies[0]).toContain('Current session: Remote chat [session-1]')
    expect(result.replies[0]).toContain('Default agent: deepchat-alt')
    expect(result.replies[0]).toContain('Current agent: deepchat-alt')
    expect(result.replies[0]).toContain('Current model: gpt-5')
  })
})
