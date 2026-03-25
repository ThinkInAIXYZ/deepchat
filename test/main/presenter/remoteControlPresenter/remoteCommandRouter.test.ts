import { describe, expect, it, vi } from 'vitest'
import { RemoteCommandRouter } from '@/presenter/remoteControlPresenter/services/remoteCommandRouter'

const createMessage = (
  overrides: Partial<Parameters<RemoteCommandRouter['handleMessage']>[0]> = {}
) => ({
  kind: 'message' as const,
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

const createCallbackQuery = (
  overrides: Partial<Parameters<RemoteCommandRouter['handleMessage']>[0]> = {}
) => ({
  kind: 'callback_query' as const,
  updateId: 2,
  chatId: 100,
  messageThreadId: 0,
  messageId: 30,
  chatType: 'private',
  fromId: 123,
  callbackQueryId: 'callback-1',
  data: 'model:token:p:0',
  ...overrides
})

const createBindingStore = () => ({
  getEndpointKey: vi.fn().mockReturnValue('telegram:100:0'),
  getTelegramConfig: vi.fn().mockReturnValue({
    allowlist: [123],
    bindings: {
      'telegram:100:0': { sessionId: 'session-1', updatedAt: 1 }
    },
    streamMode: 'draft'
  }),
  createModelMenuState: vi.fn().mockReturnValue('menu-token'),
  getModelMenuState: vi.fn(),
  clearModelMenuState: vi.fn()
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
    const bindingStore = createBindingStore()
    const router = new RemoteCommandRouter({
      authGuard: {
        ensureAuthorized: vi.fn().mockReturnValue({
          ok: true,
          userId: 123
        }),
        pair: vi.fn()
      } as any,
      runner: runner as any,
      bindingStore: bindingStore as any,
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
      bindingStore: createBindingStore() as any,
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
      bindingStore: createBindingStore() as any,
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

  it('shows /model and /open in help output', async () => {
    const router = new RemoteCommandRouter({
      authGuard: {
        ensureAuthorized: vi.fn(),
        pair: vi.fn()
      } as any,
      runner: {} as any,
      bindingStore: createBindingStore() as any,
      getPollerStatus: vi.fn()
    })

    const result = await router.handleMessage(
      createMessage({
        text: '/help',
        command: {
          name: 'help',
          args: ''
        }
      })
    )

    expect(result.replies[0]).toContain('/model')
    expect(result.replies[0]).toContain('/open')
  })

  it('returns a prompt when /model is used without a bound session', async () => {
    const runner = {
      getCurrentSession: vi.fn().mockResolvedValue(null)
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
      bindingStore: createBindingStore() as any,
      getPollerStatus: vi.fn()
    })

    const result = await router.handleMessage(
      createMessage({
        text: '/model',
        command: {
          name: 'model',
          args: ''
        }
      })
    )

    expect(result).toEqual({
      replies: ['No bound session. Send a message, /new, or /use first.']
    })
  })

  it('creates a provider menu for /model', async () => {
    const runner = {
      getCurrentSession: vi.fn().mockResolvedValue({
        id: 'session-1',
        title: 'Remote chat',
        providerId: 'openai',
        modelId: 'gpt-5'
      }),
      listAvailableModelProviders: vi.fn().mockResolvedValue([
        {
          providerId: 'openai',
          providerName: 'OpenAI',
          models: [{ modelId: 'gpt-5', modelName: 'GPT-5' }]
        },
        {
          providerId: 'anthropic',
          providerName: 'Anthropic',
          models: [{ modelId: 'claude-3-5-sonnet', modelName: 'Claude 3.5 Sonnet' }]
        }
      ])
    }
    const bindingStore = createBindingStore()
    const router = new RemoteCommandRouter({
      authGuard: {
        ensureAuthorized: vi.fn().mockReturnValue({
          ok: true,
          userId: 123
        }),
        pair: vi.fn()
      } as any,
      runner: runner as any,
      bindingStore: bindingStore as any,
      getPollerStatus: vi.fn()
    })

    const result = await router.handleMessage(
      createMessage({
        text: '/model',
        command: {
          name: 'model',
          args: ''
        }
      })
    )

    expect(bindingStore.createModelMenuState).toHaveBeenCalledWith(
      'telegram:100:0',
      'session-1',
      expect.any(Array)
    )
    expect(result.outboundActions).toEqual([
      expect.objectContaining({
        type: 'sendMessage',
        text: expect.stringContaining('Choose a provider:'),
        replyMarkup: {
          inline_keyboard: expect.arrayContaining([
            [
              expect.objectContaining({
                text: 'OpenAI'
              })
            ]
          ])
        }
      })
    ])
  })

  it('switches to the selected model from callback query', async () => {
    const bindingStore = createBindingStore()
    bindingStore.getModelMenuState.mockReturnValue({
      endpointKey: 'telegram:100:0',
      sessionId: 'session-1',
      createdAt: Date.now(),
      providers: [
        {
          providerId: 'anthropic',
          providerName: 'Anthropic',
          models: [{ modelId: 'claude-3-5-sonnet', modelName: 'Claude 3.5 Sonnet' }]
        }
      ]
    })

    const runner = {
      getCurrentSession: vi.fn().mockResolvedValue({
        id: 'session-1',
        title: 'Remote chat',
        providerId: 'openai',
        modelId: 'gpt-5'
      }),
      setSessionModel: vi.fn().mockResolvedValue({
        id: 'session-1',
        title: 'Remote chat',
        providerId: 'anthropic',
        modelId: 'claude-3-5-sonnet'
      })
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
      bindingStore: bindingStore as any,
      getPollerStatus: vi.fn()
    })

    const result = await router.handleMessage(
      createCallbackQuery({
        data: 'model:menu-token:m:0:0'
      })
    )

    expect(runner.setSessionModel).toHaveBeenCalledWith(
      'telegram:100:0',
      'anthropic',
      'claude-3-5-sonnet'
    )
    expect(bindingStore.clearModelMenuState).toHaveBeenCalledWith('menu-token')
    expect(result.callbackAnswer).toEqual({
      text: 'Model switched.'
    })
    expect(result.outboundActions).toEqual([
      expect.objectContaining({
        type: 'editMessageText',
        messageId: 30,
        text: expect.stringContaining('Model updated.')
      })
    ])
  })

  it('expires stale /model callback queries', async () => {
    const bindingStore = createBindingStore()
    bindingStore.getModelMenuState.mockReturnValue(null)

    const router = new RemoteCommandRouter({
      authGuard: {
        ensureAuthorized: vi.fn().mockReturnValue({
          ok: true,
          userId: 123
        }),
        pair: vi.fn()
      } as any,
      runner: {} as any,
      bindingStore: bindingStore as any,
      getPollerStatus: vi.fn()
    })

    const result = await router.handleMessage(
      createCallbackQuery({
        data: 'model:menu-token:m:0:0'
      })
    )

    expect(result.callbackAnswer).toEqual({
      text: 'Model menu expired. Run /model again.',
      showAlert: true
    })
    expect(result.outboundActions).toEqual([
      {
        type: 'editMessageText',
        messageId: 30,
        text: 'Model menu expired. Run /model again.',
        replyMarkup: null
      }
    ])
  })
})
