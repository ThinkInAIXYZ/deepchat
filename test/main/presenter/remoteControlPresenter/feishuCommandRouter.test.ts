import { describe, expect, it, vi } from 'vitest'
import { FeishuCommandRouter } from '@/presenter/remoteControlPresenter/services/feishuCommandRouter'

const createMessage = (
  overrides: Partial<Parameters<FeishuCommandRouter['handleMessage']>[0]> = {}
) => ({
  kind: 'message' as const,
  eventId: 'evt-1',
  chatId: 'oc_100',
  threadId: null,
  messageId: 'om_100',
  chatType: 'p2p' as const,
  senderOpenId: 'ou_123',
  text: 'hello',
  command: null,
  mentionedBot: false,
  mentions: [],
  ...overrides
})

const createBindingStore = () => ({
  getFeishuConfig: vi.fn().mockReturnValue({
    pairedUserOpenIds: ['ou_123'],
    bindings: {},
    defaultWorkdir: ''
  })
})

const createRunner = (overrides: Record<string, unknown> = {}) => ({
  getPendingInteraction: vi.fn().mockResolvedValue(null),
  getDefaultAgentId: vi.fn().mockResolvedValue('deepchat'),
  getDefaultWorkdir: vi.fn().mockResolvedValue(null),
  isSessionModelLocked: vi.fn().mockResolvedValue(false),
  ...overrides
})

describe('FeishuCommandRouter', () => {
  it('ignores group messages that do not mention the bot', async () => {
    const router = new FeishuCommandRouter({
      authGuard: {
        ensureAuthorized: vi.fn().mockReturnValue({
          ok: false,
          message: '',
          silent: true
        }),
        pair: vi.fn()
      } as any,
      runner: {} as any,
      bindingStore: {} as any,
      getRuntimeStatus: vi.fn()
    })

    const result = await router.handleMessage(
      createMessage({
        chatType: 'group',
        mentionedBot: false
      })
    )

    expect(result).toEqual({
      replies: []
    })
  })

  it('switches models directly from text args', async () => {
    const runner = createRunner({
      getCurrentSession: vi.fn().mockResolvedValue({
        id: 'session-1',
        title: 'Remote',
        modelId: 'gpt-4o',
        agentId: 'deepchat'
      }),
      isSessionModelLocked: vi.fn().mockResolvedValue(false),
      listAvailableModelProviders: vi.fn().mockResolvedValue([
        {
          providerId: 'openai',
          providerName: 'OpenAI',
          models: [{ modelId: 'gpt-5', modelName: 'GPT-5' }]
        }
      ]),
      setSessionModel: vi.fn().mockResolvedValue({
        id: 'session-1',
        title: 'Remote',
        modelId: 'gpt-5',
        agentId: 'deepchat'
      })
    })
    const router = new FeishuCommandRouter({
      authGuard: {
        ensureAuthorized: vi.fn().mockReturnValue({
          ok: true,
          userOpenId: 'ou_123'
        }),
        pair: vi.fn()
      } as any,
      runner: runner as any,
      bindingStore: createBindingStore() as any,
      getRuntimeStatus: vi.fn().mockReturnValue({
        state: 'running',
        lastError: null,
        botUser: null
      })
    })

    const result = await router.handleMessage(
      createMessage({
        text: '/model openai gpt-5',
        command: {
          name: 'model',
          args: 'openai gpt-5'
        }
      })
    )

    expect(runner.setSessionModel).toHaveBeenCalledWith('feishu:oc_100:root', 'openai', 'gpt-5')
    expect(result.replies[0]).toContain('Model updated.')
    expect(result.replies[0]).toContain('GPT-5')
  })

  it('blocks /model when the current Feishu session is ACP-backed', async () => {
    const listAvailableModelProviders = vi.fn()
    const router = new FeishuCommandRouter({
      authGuard: {
        ensureAuthorized: vi.fn().mockReturnValue({
          ok: true,
          userOpenId: 'ou_123'
        }),
        pair: vi.fn()
      } as any,
      runner: createRunner({
        getCurrentSession: vi.fn().mockResolvedValue({
          id: 'session-1',
          title: 'ACP Remote',
          modelId: 'acp-agent',
          agentId: 'acp-agent'
        }),
        isSessionModelLocked: vi.fn().mockResolvedValue(true),
        listAvailableModelProviders
      }) as any,
      bindingStore: createBindingStore() as any,
      getRuntimeStatus: vi.fn().mockReturnValue({
        state: 'running',
        lastError: null,
        botUser: null
      })
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
      replies: ['ACP sessions lock the model. Change the channel default agent instead.']
    })
    expect(listAvailableModelProviders).not.toHaveBeenCalled()
  })

  it('returns a desktop window hint when /open cannot find a chat window', async () => {
    const router = new FeishuCommandRouter({
      authGuard: {
        ensureAuthorized: vi.fn().mockReturnValue({
          ok: true,
          userOpenId: 'ou_123'
        }),
        pair: vi.fn()
      } as any,
      runner: createRunner({
        open: vi.fn().mockResolvedValue({
          status: 'windowNotFound'
        })
      }) as any,
      bindingStore: createBindingStore() as any,
      getRuntimeStatus: vi.fn().mockReturnValue({
        state: 'running',
        lastError: null,
        botUser: null
      })
    })

    const result = await router.handleMessage(
      createMessage({
        text: '/open',
        command: {
          name: 'open',
          args: ''
        }
      })
    )

    expect(result).toEqual({
      replies: ['Could not find a DeepChat desktop window. Open DeepChat and try /open again.']
    })
  })

  it('routes pending permission replies before opening a new turn', async () => {
    const runner = {
      getPendingInteraction: vi.fn().mockResolvedValue({
        type: 'permission',
        messageId: 'assistant-1',
        toolCallId: 'tool-1',
        toolName: 'shell_command',
        toolArgs: '{"command":"git push"}',
        permission: {
          permissionType: 'command',
          description: 'Run git push',
          command: 'git push'
        }
      }),
      respondToPendingInteraction: vi.fn().mockResolvedValue({
        waitingForUserMessage: false,
        execution: {
          sessionId: 'session-1',
          eventId: 'assistant-1',
          getSnapshot: vi.fn()
        }
      })
    }
    const router = new FeishuCommandRouter({
      authGuard: {
        ensureAuthorized: vi.fn().mockReturnValue({
          ok: true,
          userOpenId: 'ou_123'
        }),
        pair: vi.fn()
      } as any,
      runner: runner as any,
      bindingStore: createBindingStore() as any,
      getRuntimeStatus: vi.fn()
    })

    const result = await router.handleMessage(
      createMessage({
        text: 'ALLOW'
      })
    )

    expect(runner.respondToPendingInteraction).toHaveBeenCalledWith('feishu:oc_100:root', {
      kind: 'permission',
      granted: true
    })
    expect(result.replies).toEqual(['Approved. Continuing...'])
    expect(result.conversation).toEqual(
      expect.objectContaining({
        sessionId: 'session-1'
      })
    )
  })

  it('re-sends the current pending question as a card action', async () => {
    const router = new FeishuCommandRouter({
      authGuard: {
        ensureAuthorized: vi.fn().mockReturnValue({
          ok: true,
          userOpenId: 'ou_123'
        }),
        pair: vi.fn()
      } as any,
      runner: {
        getPendingInteraction: vi.fn().mockResolvedValue({
          type: 'question',
          messageId: 'assistant-2',
          toolCallId: 'tool-2',
          toolName: 'ask_user',
          toolArgs: '{}',
          question: {
            question: 'Pick one',
            options: [{ label: 'A' }, { label: 'B' }],
            custom: true,
            multiple: false
          }
        })
      } as any,
      bindingStore: createBindingStore() as any,
      getRuntimeStatus: vi.fn()
    })

    const result = await router.handleMessage(
      createMessage({
        text: '/pending',
        command: {
          name: 'pending',
          args: ''
        }
      })
    )

    expect(result.replies).toEqual([])
    expect(result.outboundActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'sendCard',
          fallbackText: expect.stringContaining('Pick one'),
          card: expect.objectContaining({
            header: expect.objectContaining({
              title: expect.objectContaining({
                content: 'Question'
              })
            })
          })
        })
      ])
    )
  })

  it('parses option numbers for pending questions', async () => {
    const runner = {
      getPendingInteraction: vi.fn().mockResolvedValue({
        type: 'question',
        messageId: 'assistant-3',
        toolCallId: 'tool-3',
        toolName: 'ask_user',
        toolArgs: '{}',
        question: {
          question: 'Pick one',
          options: [{ label: 'Alpha' }, { label: 'Beta' }],
          custom: false,
          multiple: false
        }
      }),
      respondToPendingInteraction: vi.fn().mockResolvedValue({
        waitingForUserMessage: false,
        execution: null
      })
    }
    const router = new FeishuCommandRouter({
      authGuard: {
        ensureAuthorized: vi.fn().mockReturnValue({
          ok: true,
          userOpenId: 'ou_123'
        }),
        pair: vi.fn()
      } as any,
      runner: runner as any,
      bindingStore: createBindingStore() as any,
      getRuntimeStatus: vi.fn()
    })

    const result = await router.handleMessage(
      createMessage({
        text: '2'
      })
    )

    expect(runner.respondToPendingInteraction).toHaveBeenCalledWith('feishu:oc_100:root', {
      kind: 'question_option',
      optionLabel: 'Beta'
    })
    expect(result.replies).toEqual(['Selected: Beta'])
  })

  it('treats prefixed numeric text as custom input instead of an option', async () => {
    const runner = {
      getPendingInteraction: vi.fn().mockResolvedValue({
        type: 'question',
        messageId: 'assistant-4',
        toolCallId: 'tool-4',
        toolName: 'ask_user',
        toolArgs: '{}',
        question: {
          question: 'Pick one',
          options: [{ label: 'Alpha' }, { label: 'Beta' }],
          custom: true,
          multiple: false
        }
      }),
      respondToPendingInteraction: vi.fn().mockResolvedValue({
        waitingForUserMessage: false,
        execution: null
      })
    }
    const router = new FeishuCommandRouter({
      authGuard: {
        ensureAuthorized: vi.fn().mockReturnValue({
          ok: true,
          userOpenId: 'ou_123'
        }),
        pair: vi.fn()
      } as any,
      runner: runner as any,
      bindingStore: createBindingStore() as any,
      getRuntimeStatus: vi.fn()
    })

    const result = await router.handleMessage(
      createMessage({
        text: '2 please'
      })
    )

    expect(runner.respondToPendingInteraction).toHaveBeenCalledWith('feishu:oc_100:root', {
      kind: 'question_custom',
      answerText: '2 please'
    })
    expect(result.replies).toEqual(['Answer received: 2 please'])
  })
})
