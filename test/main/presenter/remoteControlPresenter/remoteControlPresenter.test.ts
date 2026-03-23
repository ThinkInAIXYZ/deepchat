import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HookEventName, HooksNotificationsSettings } from '@shared/hooksNotifications'

const pollerInstances: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> =
  []
let pollerStartImplementation: () => Promise<void> = async () => {}

vi.mock('@/presenter/remoteControlPresenter/telegram/telegramPoller', () => ({
  TelegramPoller: class MockTelegramPoller {
    readonly start = vi.fn(() => pollerStartImplementation())
    readonly stop = vi.fn().mockResolvedValue(undefined)

    constructor() {
      pollerInstances.push(this)
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
})
