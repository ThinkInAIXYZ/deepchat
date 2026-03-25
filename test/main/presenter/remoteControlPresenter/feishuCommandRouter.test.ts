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
    const runner = {
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
      bindingStore: {
        getFeishuConfig: vi.fn().mockReturnValue({
          pairedUserOpenIds: ['ou_123'],
          bindings: {}
        })
      } as any,
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
})
