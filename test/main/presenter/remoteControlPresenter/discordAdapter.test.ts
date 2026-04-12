import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscordRuntimeStatusSnapshot } from '@/presenter/remoteControlPresenter/types'

type MockRuntimeDeps = {
  onStatusChange?: (snapshot: DiscordRuntimeStatusSnapshot) => void
  onFatalError?: (message: string) => void
}

const runtimeInstances: Array<{
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  getStatusSnapshot: ReturnType<typeof vi.fn>
  deps: MockRuntimeDeps
}> = []
const clientInstances: Array<{
  sendMessage: ReturnType<typeof vi.fn>
  sendTypingIndicator: ReturnType<typeof vi.fn>
}> = []

vi.mock('@/presenter/remoteControlPresenter/discord/discordRuntime', () => ({
  DiscordRuntime: class MockDiscordRuntime {
    readonly start = vi.fn(async () => {
      this.deps.onStatusChange?.({
        state: 'running',
        lastError: null,
        botUser: {
          id: 'bot-1',
          username: 'deepchat',
          displayName: 'DeepChat'
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

vi.mock('@/presenter/remoteControlPresenter/discord/discordClient', () => ({
  DiscordClient: class MockDiscordClient {
    readonly sendMessage = vi.fn().mockResolvedValue('msg-1')
    readonly sendTypingIndicator = vi.fn().mockResolvedValue(undefined)

    constructor(_credentials: unknown) {
      clientInstances.push(this)
    }
  }
}))

import { DiscordAdapter } from '@/presenter/remoteControlPresenter/adapters/discord/DiscordAdapter'

describe('DiscordAdapter', () => {
  beforeEach(() => {
    runtimeInstances.length = 0
    clientInstances.length = 0
  })

  it('starts the wrapped discord runtime', async () => {
    const adapter = new DiscordAdapter(
      {
        channelId: 'default',
        channelType: 'discord',
        agentId: 'deepchat',
        channelConfig: {
          botToken: 'discord-bot-token'
        },
        configSignature: 'discord:test'
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

  it('sends messages and typing indicators to parsed discord transport targets', async () => {
    const adapter = new DiscordAdapter(
      {
        channelId: 'default',
        channelType: 'discord',
        agentId: 'deepchat',
        channelConfig: {
          botToken: 'discord-bot-token'
        },
        configSignature: 'discord:test'
      },
      {
        bindingStore: {} as any,
        createConversationRunner: () => ({}) as any
      }
    )

    await adapter.connect()
    await adapter.sendMessage('channel:12345', 'hello discord')
    await adapter.sendTypingIndicator('dm:67890')

    expect(clientInstances[0].sendMessage).toHaveBeenCalledWith('12345', 'hello discord')
    expect(clientInstances[0].sendTypingIndicator).toHaveBeenCalledWith('67890')
  })
})
