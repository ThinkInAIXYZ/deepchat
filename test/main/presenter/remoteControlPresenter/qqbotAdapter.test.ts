import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QQBotRuntimeStatusSnapshot } from '@/presenter/remoteControlPresenter/types'

type MockRuntimeDeps = {
  onStatusChange?: (snapshot: QQBotRuntimeStatusSnapshot) => void
  onFatalError?: (message: string) => void
}

const runtimeInstances: Array<{
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  getStatusSnapshot: ReturnType<typeof vi.fn>
  deps: MockRuntimeDeps
}> = []
const clientInstances: Array<{
  sendC2CMessage: ReturnType<typeof vi.fn>
  sendGroupMessage: ReturnType<typeof vi.fn>
}> = []

vi.mock('@/presenter/remoteControlPresenter/qqbot/qqbotRuntime', () => ({
  QQBotRuntime: class MockQQBotRuntime {
    readonly start = vi.fn(async () => {
      this.deps.onStatusChange?.({
        state: 'running',
        lastError: null,
        botUser: {
          id: 'bot_user_1',
          username: 'deepchat_bot'
        }
      })
    })
    readonly stop = vi.fn().mockResolvedValue(undefined)
    readonly getStatusSnapshot = vi.fn().mockReturnValue({
      state: 'stopped',
      lastError: null,
      botUser: null
    })

    constructor(readonly deps: MockRuntimeDeps) {
      runtimeInstances.push(this)
    }
  }
}))

vi.mock('@/presenter/remoteControlPresenter/qqbot/qqbotClient', () => ({
  QQBotClient: class MockQQBotClient {
    readonly sendC2CMessage = vi.fn().mockResolvedValue({
      id: 'msg_reply_1'
    })
    readonly sendGroupMessage = vi.fn().mockResolvedValue({
      id: 'msg_reply_2'
    })

    constructor(_credentials: unknown) {
      clientInstances.push(this)
    }
  }
}))

import { QQBotAdapter } from '@/presenter/remoteControlPresenter/adapters/qqbot/QQBotAdapter'

describe('QQBotAdapter', () => {
  beforeEach(() => {
    runtimeInstances.length = 0
    clientInstances.length = 0
  })

  it('starts the wrapped qqbot runtime', async () => {
    const adapter = new QQBotAdapter(
      {
        channelId: 'default',
        channelType: 'qqbot',
        agentId: 'deepchat',
        channelConfig: {
          appId: '1024',
          clientSecret: 'secret'
        },
        configSignature: 'qqbot:test'
      },
      {
        bindingStore: {} as any,
        createConversationRunner: () => ({}) as any
      }
    )

    await adapter.connect()

    expect(runtimeInstances).toHaveLength(1)
    expect(runtimeInstances[0].start).toHaveBeenCalledTimes(1)
    expect(adapter.getStatusSnapshot()).toEqual(
      expect.objectContaining({
        connected: true,
        state: 'running'
      })
    )
  })

  it('forwards fatal errors from the wrapped runtime', async () => {
    const onFatalError = vi.fn().mockResolvedValue(undefined)
    const adapter = new QQBotAdapter(
      {
        channelId: 'default',
        channelType: 'qqbot',
        agentId: 'deepchat',
        channelConfig: {
          appId: '1024',
          clientSecret: 'secret'
        },
        configSignature: 'qqbot:test'
      },
      {
        bindingStore: {} as any,
        createConversationRunner: () => ({}) as any,
        onFatalError
      }
    )

    await adapter.connect()
    runtimeInstances[0].deps.onFatalError?.('fatal qqbot error')

    expect(onFatalError).toHaveBeenCalledWith('fatal qqbot error')
  })
})
