import { describe, expect, it, vi } from 'vitest'
import { QQBotCommandRouter } from '@/presenter/remoteControlPresenter/services/qqbotCommandRouter'

const createMessage = (
  overrides: Partial<Parameters<QQBotCommandRouter['handleMessage']>[0]> = {}
) => ({
  kind: 'message' as const,
  eventId: 'evt-1',
  chatId: 'user_openid_1',
  chatType: 'c2c' as const,
  messageId: 'msg-1',
  messageSeq: 1,
  senderUserId: 'user_openid_1',
  senderUserName: 'user_openid_1',
  text: 'hello',
  command: null,
  mentionedBot: false,
  ...overrides
})

const createBindingStore = () => ({
  getQQBotConfig: vi.fn().mockReturnValue({
    pairedUserIds: ['user_openid_1'],
    pairedGroupIds: ['group_openid_1'],
    bindings: {}
  })
})

const createRunner = (overrides: Record<string, unknown> = {}) => ({
  getPendingInteraction: vi.fn().mockResolvedValue(null),
  getDefaultAgentId: vi.fn().mockResolvedValue('deepchat'),
  getDefaultWorkdir: vi.fn().mockResolvedValue(null),
  isSessionModelLocked: vi.fn().mockResolvedValue(false),
  ...overrides
})

describe('QQBotCommandRouter', () => {
  it('returns the auth error for unauthorized groups', async () => {
    const router = new QQBotCommandRouter({
      authGuard: {
        ensureAuthorized: vi.fn().mockReturnValue({
          ok: false,
          message: 'This QQ group is not authorized.'
        }),
        pair: vi.fn()
      } as any,
      runner: {} as any,
      bindingStore: {} as any,
      getRuntimeStatus: vi.fn()
    })

    const result = await router.handleMessage(
      createMessage({
        chatId: 'group_openid_1',
        chatType: 'group',
        senderUserId: 'member_openid_1',
        mentionedBot: true
      })
    )

    expect(result).toEqual({
      replies: ['This QQ group is not authorized.']
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
    const router = new QQBotCommandRouter({
      authGuard: {
        ensureAuthorized: vi.fn().mockReturnValue({
          ok: true,
          principalId: 'user_openid_1'
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

    expect(runner.setSessionModel).toHaveBeenCalledWith(
      'qqbot:c2c:user_openid_1',
      'openai',
      'gpt-5'
    )
    expect(result.replies[0]).toContain('Model updated.')
    expect(result.replies[0]).toContain('GPT-5')
  })

  it('reports authorized groups in /status', async () => {
    const router = new QQBotCommandRouter({
      authGuard: {
        ensureAuthorized: vi.fn().mockReturnValue({
          ok: true,
          principalId: 'group_openid_1'
        }),
        pair: vi.fn()
      } as any,
      runner: createRunner({
        getStatus: vi.fn().mockResolvedValue({
          session: null,
          isGenerating: false,
          pendingInteraction: null
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
        chatId: 'group_openid_1',
        chatType: 'group',
        senderUserId: 'member_openid_1',
        mentionedBot: true,
        text: '/status',
        command: {
          name: 'status',
          args: ''
        }
      })
    )

    expect(result.replies[0]).toContain('Authorized groups: 1')
  })
})
