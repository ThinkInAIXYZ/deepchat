import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TelegramPollerStatusSnapshot } from '@/presenter/remoteControlPresenter/types'

type MockPollerDeps = {
  onStatusChange?: (snapshot: TelegramPollerStatusSnapshot) => void
  onFatalError?: (message: string) => void
}

const pollerInstances: Array<{
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  getStatusSnapshot: ReturnType<typeof vi.fn>
  deps: MockPollerDeps
}> = []
const clientInstances: Array<{
  setMyCommands: ReturnType<typeof vi.fn>
  sendMessage: ReturnType<typeof vi.fn>
  sendChatAction: ReturnType<typeof vi.fn>
}> = []

vi.mock('@/presenter/remoteControlPresenter/telegram/telegramPoller', () => ({
  TelegramPoller: class MockTelegramPoller {
    readonly start = vi.fn(async () => {
      this.deps.onStatusChange?.({
        state: 'running',
        lastError: null,
        botUser: {
          id: 1,
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

    constructor(readonly deps: MockPollerDeps) {
      pollerInstances.push(this)
    }
  }
}))

vi.mock('@/presenter/remoteControlPresenter/telegram/telegramClient', () => ({
  TelegramClient: class MockTelegramClient {
    readonly setMyCommands = vi.fn().mockResolvedValue(undefined)
    readonly sendMessage = vi.fn().mockResolvedValue(101)
    readonly sendChatAction = vi.fn().mockResolvedValue(undefined)

    constructor(_botToken: string) {
      clientInstances.push(this)
    }
  }
}))

import { TelegramAdapter } from '@/presenter/remoteControlPresenter/adapters/telegram/TelegramAdapter'

describe('TelegramAdapter', () => {
  beforeEach(() => {
    pollerInstances.length = 0
    clientInstances.length = 0
  })

  it('starts the wrapped telegram poller and registers commands', async () => {
    const adapter = new TelegramAdapter(
      {
        channelId: 'default',
        channelType: 'telegram',
        agentId: 'deepchat',
        channelConfig: {
          botToken: 'test-bot-token'
        },
        configSignature: 'telegram:test'
      },
      {
        bindingStore: {} as any,
        createConversationRunner: () => ({}) as any,
        registerTelegramCommands: async (client) => {
          await client.setMyCommands([{ command: 'help', description: 'help' }])
        }
      }
    )

    await adapter.connect()

    expect(pollerInstances).toHaveLength(1)
    expect(pollerInstances[0].start).toHaveBeenCalledTimes(1)
    expect(clientInstances[0].setMyCommands).toHaveBeenCalledWith([
      { command: 'help', description: 'help' }
    ])
    expect(adapter.getStatusSnapshot()).toEqual(
      expect.objectContaining({
        connected: true,
        state: 'running'
      })
    )
  })

  it('forwards fatal errors from the wrapped poller', async () => {
    const onFatalError = vi.fn().mockResolvedValue(undefined)
    const adapter = new TelegramAdapter(
      {
        channelId: 'default',
        channelType: 'telegram',
        agentId: 'deepchat',
        channelConfig: {
          botToken: 'test-bot-token'
        },
        configSignature: 'telegram:test'
      },
      {
        bindingStore: {} as any,
        createConversationRunner: () => ({}) as any,
        registerTelegramCommands: async () => undefined,
        onFatalError
      }
    )

    await adapter.connect()
    pollerInstances[0].deps.onFatalError?.('fatal telegram error')

    expect(onFatalError).toHaveBeenCalledWith('fatal telegram error')
  })

  it('strictly validates telegram transport target parts', async () => {
    const adapter = new TelegramAdapter(
      {
        channelId: 'default',
        channelType: 'telegram',
        agentId: 'deepchat',
        channelConfig: {
          botToken: 'test-bot-token'
        },
        configSignature: 'telegram:test'
      },
      {
        bindingStore: {} as any,
        createConversationRunner: () => ({}) as any,
        registerTelegramCommands: async () => undefined
      }
    )

    await adapter.connect()

    await adapter.sendMessage('-100123:', 'hello')
    expect(clientInstances[0].sendMessage).toHaveBeenCalledWith(
      {
        chatId: -100123,
        messageThreadId: 0
      },
      'hello'
    )

    await expect(adapter.sendMessage('123abc:1', 'hello')).rejects.toThrow(
      'Invalid Telegram chat id "123abc:1".'
    )
    await expect(adapter.sendMessage('123:1abc', 'hello')).rejects.toThrow(
      'Invalid Telegram chat id "123:1abc".'
    )
  })
})
