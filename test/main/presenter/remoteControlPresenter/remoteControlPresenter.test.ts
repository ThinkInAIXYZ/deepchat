import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HookEventName, HooksNotificationsSettings } from '@shared/hooksNotifications'
import type { TelegramPollerStatusSnapshot } from '@/presenter/remoteControlPresenter/types'

type MockPollerDeps = {
  onStatusChange?: (snapshot: TelegramPollerStatusSnapshot) => void
  onFatalError?: (message: string) => void
}

const pollerInstances: Array<{
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  deps: MockPollerDeps
}> = []
const telegramClientInstances: Array<{
  setMyCommands: ReturnType<typeof vi.fn>
}> = []
let pollerStartImplementation: () => Promise<void> = async () => {}

vi.mock('@/presenter/remoteControlPresenter/telegram/telegramPoller', () => ({
  TelegramPoller: class MockTelegramPoller {
    readonly start = vi.fn(() => pollerStartImplementation())
    readonly stop = vi.fn().mockResolvedValue(undefined)
    readonly deps: MockPollerDeps

    constructor(deps: MockPollerDeps) {
      this.deps = deps
      pollerInstances.push(this)
    }
  }
}))

vi.mock('@/presenter/remoteControlPresenter/telegram/telegramClient', () => ({
  TelegramClient: class MockTelegramClient {
    readonly setMyCommands = vi.fn().mockResolvedValue(undefined)

    constructor(_botToken: string) {
      telegramClientInstances.push(this)
    }
  }
}))

import { RemoteControlPresenter } from '@/presenter/remoteControlPresenter'

const createHooksConfig = (): HooksNotificationsSettings => {
  const commandEvents = Object.fromEntries(
    [
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'PermissionRequest',
      'Stop',
      'SessionEnd'
    ].map((eventName) => [eventName, { enabled: false, command: '' }])
  ) as Record<HookEventName, { enabled: boolean; command: string }>

  return {
    telegram: {
      enabled: false,
      botToken: 'test-bot-token',
      chatId: '',
      threadId: undefined,
      events: []
    },
    discord: {
      enabled: false,
      webhookUrl: '',
      events: []
    },
    confirmo: {
      enabled: false,
      events: []
    },
    commands: {
      enabled: false,
      events: commandEvents
    }
  }
}

const createConfigPresenter = () => {
  const store = new Map<string, unknown>([
    [
      'remoteControl',
      {
        telegram: {
          enabled: true,
          allowlist: [],
          streamMode: 'draft',
          defaultAgentId: 'deepchat',
          pollOffset: 0,
          pairing: {
            code: null,
            expiresAt: null
          },
          bindings: {}
        }
      }
    ]
  ])

  return {
    getSetting: vi.fn((key: string) => store.get(key)),
    setSetting: vi.fn((key: string, value: unknown) => {
      store.set(key, value)
    })
  }
}

describe('RemoteControlPresenter', () => {
  beforeEach(() => {
    pollerInstances.length = 0
    telegramClientInstances.length = 0
    pollerStartImplementation = async () => {}
  })

  it('serializes runtime rebuilds so only one poller starts per token', async () => {
    const configPresenter = createConfigPresenter()
    let hooksConfig = createHooksConfig()

    const presenter = new RemoteControlPresenter({
      configPresenter: configPresenter as any,
      newAgentPresenter: {} as any,
      deepchatAgentPresenter: {} as any,
      windowPresenter: {} as any,
      tabPresenter: {} as any,
      getHooksNotificationsConfig: () => hooksConfig,
      setHooksNotificationsConfig: (nextConfig) => {
        hooksConfig = nextConfig
        return nextConfig
      },
      testTelegramHookNotification: vi.fn().mockResolvedValue({
        success: true,
        durationMs: 0
      })
    })

    await Promise.all([presenter.initialize(), presenter.initialize()])

    expect(pollerInstances).toHaveLength(1)
    expect(pollerInstances[0].start).toHaveBeenCalledTimes(1)
    expect(telegramClientInstances).toHaveLength(1)
    expect(telegramClientInstances[0].setMyCommands).toHaveBeenCalledTimes(1)
  })

  it('reports starting while the poller startup is still in flight', async () => {
    const configPresenter = createConfigPresenter()
    let hooksConfig = createHooksConfig()
    let resolveStart: (() => void) | null = null
    pollerStartImplementation = () =>
      new Promise<void>((resolve) => {
        resolveStart = resolve
      })

    const presenter = new RemoteControlPresenter({
      configPresenter: configPresenter as any,
      newAgentPresenter: {} as any,
      deepchatAgentPresenter: {} as any,
      windowPresenter: {} as any,
      tabPresenter: {} as any,
      getHooksNotificationsConfig: () => hooksConfig,
      setHooksNotificationsConfig: (nextConfig) => {
        hooksConfig = nextConfig
        return nextConfig
      },
      testTelegramHookNotification: vi.fn().mockResolvedValue({
        success: true,
        durationMs: 0
      })
    })

    const initializePromise = presenter.initialize()

    await vi.waitFor(async () => {
      await expect(presenter.getTelegramStatus()).resolves.toEqual(
        expect.objectContaining({
          state: 'starting'
        })
      )
    })

    resolveStart?.()
    await initializePromise
  })

  it('auto-disables remote control after a fatal poller failure', async () => {
    const configPresenter = createConfigPresenter()
    let hooksConfig = createHooksConfig()

    const presenter = new RemoteControlPresenter({
      configPresenter: configPresenter as any,
      newAgentPresenter: {} as any,
      deepchatAgentPresenter: {} as any,
      windowPresenter: {} as any,
      tabPresenter: {} as any,
      getHooksNotificationsConfig: () => hooksConfig,
      setHooksNotificationsConfig: (nextConfig) => {
        hooksConfig = nextConfig
        return nextConfig
      },
      testTelegramHookNotification: vi.fn().mockResolvedValue({
        success: true,
        durationMs: 0
      })
    })

    await presenter.initialize()

    pollerInstances[0].deps.onFatalError?.('Conflict: terminated by other getUpdates request')

    await vi.waitFor(async () => {
      await expect(presenter.getTelegramStatus()).resolves.toEqual(
        expect.objectContaining({
          enabled: false,
          state: 'error',
          lastError: 'Conflict: terminated by other getUpdates request'
        })
      )
    })

    expect(configPresenter.setSetting).toHaveBeenCalledWith(
      'remoteControl',
      expect.objectContaining({
        telegram: expect.objectContaining({
          enabled: false,
          lastFatalError: 'Conflict: terminated by other getUpdates request'
        })
      })
    )
    expect(pollerInstances[0].stop).toHaveBeenCalledTimes(1)
  })

  it('returns bindings and pairing snapshot through the presenter contract', async () => {
    const configPresenter = createConfigPresenter()
    let hooksConfig = createHooksConfig()

    configPresenter.setSetting('remoteControl', {
      telegram: {
        enabled: true,
        allowlist: [123],
        streamMode: 'final',
        defaultAgentId: '',
        pollOffset: 0,
        pairing: {
          code: '123456',
          expiresAt: 123456789
        },
        bindings: {
          'telegram:100:0': {
            sessionId: 'session-1',
            updatedAt: 10
          }
        }
      }
    })

    const presenter = new RemoteControlPresenter({
      configPresenter: configPresenter as any,
      newAgentPresenter: {} as any,
      deepchatAgentPresenter: {} as any,
      windowPresenter: {} as any,
      tabPresenter: {} as any,
      getHooksNotificationsConfig: () => hooksConfig,
      setHooksNotificationsConfig: (nextConfig) => {
        hooksConfig = nextConfig
        return nextConfig
      },
      testTelegramHookNotification: vi.fn().mockResolvedValue({
        success: true,
        durationMs: 0
      })
    })

    await expect(presenter.getTelegramPairingSnapshot()).resolves.toEqual({
      pairCode: '123456',
      pairCodeExpiresAt: 123456789,
      allowedUserIds: [123]
    })

    await expect(presenter.getTelegramBindings()).resolves.toEqual([
      {
        endpointKey: 'telegram:100:0',
        sessionId: 'session-1',
        chatId: 100,
        messageThreadId: 0,
        updatedAt: 10
      }
    ])

    await presenter.removeTelegramBinding('telegram:100:0')

    await expect(presenter.getTelegramBindings()).resolves.toEqual([])
  })

  it('falls back to the built-in deepchat agent when saving an invalid default agent', async () => {
    const configPresenter = createConfigPresenter()
    let hooksConfig = createHooksConfig()
    const listAgents = vi.fn().mockResolvedValue([
      { id: 'deepchat', name: 'DeepChat', type: 'deepchat', enabled: true },
      { id: 'deepchat-alt', name: 'Alt', type: 'deepchat', enabled: false }
    ])

    const presenter = new RemoteControlPresenter({
      configPresenter: {
        ...configPresenter,
        listAgents
      } as any,
      newAgentPresenter: {} as any,
      deepchatAgentPresenter: {} as any,
      windowPresenter: {} as any,
      tabPresenter: {} as any,
      getHooksNotificationsConfig: () => hooksConfig,
      setHooksNotificationsConfig: (nextConfig) => {
        hooksConfig = nextConfig
        return nextConfig
      },
      testTelegramHookNotification: vi.fn().mockResolvedValue({
        success: true,
        durationMs: 0
      })
    })

    const saved = await presenter.saveTelegramSettings({
      botToken: 'test-bot-token',
      remoteEnabled: true,
      allowedUserIds: [],
      defaultAgentId: 'deepchat-alt',
      hookNotifications: {
        enabled: false,
        chatId: '',
        threadId: undefined,
        events: []
      }
    })

    expect(saved.defaultAgentId).toBe('deepchat')
    expect(configPresenter.setSetting).toHaveBeenCalledWith(
      'remoteControl',
      expect.objectContaining({
        telegram: expect.objectContaining({
          defaultAgentId: 'deepchat',
          streamMode: 'draft'
        })
      })
    )
  })
})
