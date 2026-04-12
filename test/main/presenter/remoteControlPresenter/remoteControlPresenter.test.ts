import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow } from 'electron'
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
const telegramClientInstances: Array<{
  setMyCommands: ReturnType<typeof vi.fn>
}> = []
let pollerStartImplementation: () => Promise<void> = async () => {}

vi.mock('@/presenter/remoteControlPresenter/telegram/telegramPoller', () => ({
  TelegramPoller: class MockTelegramPoller {
    readonly start = vi.fn(async () => {
      await pollerStartImplementation()
      this.deps.onStatusChange?.({
        state: 'running',
        lastError: null,
        botUser: {
          id: 123,
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
import { WeixinIlinkClient } from '@/presenter/remoteControlPresenter/weixinIlink/weixinIlinkClient'

const createConfigPresenter = () => {
  const store = new Map<string, unknown>([
    [
      'remoteControl',
      {
        telegram: {
          botToken: 'test-bot-token',
          enabled: true,
          allowlist: [],
          streamMode: 'draft',
          defaultAgentId: 'deepchat',
          defaultWorkdir: '',
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
    }),
    listAgents: vi.fn().mockResolvedValue([
      { id: 'deepchat', name: 'DeepChat', type: 'deepchat', enabled: true },
      { id: 'acp-agent', name: 'ACP Agent', type: 'acp', enabled: true }
    ])
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

    const presenter = new RemoteControlPresenter({
      configPresenter: configPresenter as any,
      agentSessionPresenter: {} as any,
      agentRuntimePresenter: {} as any,
      windowPresenter: {
        getFocusedWindow: vi.fn(() => undefined),
        getAllWindows: vi.fn(() => [])
      } as any,
      tabPresenter: {} as any
    })

    await Promise.all([presenter.initialize(), presenter.initialize()])

    expect(pollerInstances).toHaveLength(1)
    expect(pollerInstances[0].start).toHaveBeenCalledTimes(1)
    expect(telegramClientInstances).toHaveLength(1)
    expect(telegramClientInstances[0].setMyCommands).toHaveBeenCalledTimes(1)
    expect(telegramClientInstances[0].setMyCommands).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'model'
        })
      ])
    )
    expect(telegramClientInstances[0].setMyCommands).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'open'
        })
      ])
    )
  })

  it('reports starting while the poller startup is still in flight', async () => {
    const configPresenter = createConfigPresenter()
    let resolveStart: (() => void) | null = null
    pollerStartImplementation = () =>
      new Promise<void>((resolve) => {
        resolveStart = resolve
      })

    const presenter = new RemoteControlPresenter({
      configPresenter: configPresenter as any,
      agentSessionPresenter: {} as any,
      agentRuntimePresenter: {} as any,
      windowPresenter: {
        getFocusedWindow: vi.fn(() => undefined),
        getAllWindows: vi.fn(() => [])
      } as any,
      tabPresenter: {} as any
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

    const presenter = new RemoteControlPresenter({
      configPresenter: configPresenter as any,
      agentSessionPresenter: {} as any,
      agentRuntimePresenter: {} as any,
      windowPresenter: {
        getFocusedWindow: vi.fn(() => undefined),
        getAllWindows: vi.fn(() => [])
      } as any,
      tabPresenter: {} as any
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

    configPresenter.setSetting('remoteControl', {
      telegram: {
        enabled: true,
        allowlist: [123],
        streamMode: 'final',
        defaultAgentId: '',
        defaultWorkdir: '',
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
      agentSessionPresenter: {} as any,
      agentRuntimePresenter: {} as any,
      windowPresenter: {
        getFocusedWindow: vi.fn(() => undefined),
        getAllWindows: vi.fn(() => [])
      } as any,
      tabPresenter: {} as any
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

  it('removes authorized principals through the generic presenter contract', async () => {
    const configPresenter = createConfigPresenter()

    configPresenter.setSetting('remoteControl', {
      telegram: {
        enabled: true,
        allowlist: [123, 456],
        streamMode: 'final',
        defaultAgentId: '',
        defaultWorkdir: '',
        pollOffset: 0,
        pairing: {
          code: null,
          expiresAt: null
        },
        bindings: {}
      },
      feishu: {
        appId: 'cli_test',
        appSecret: 'secret',
        verificationToken: 'verify',
        encryptKey: '',
        enabled: true,
        defaultAgentId: 'deepchat',
        defaultWorkdir: '',
        pairedUserOpenIds: ['ou_1', 'ou_2'],
        lastFatalError: null,
        pairing: {
          code: null,
          expiresAt: null,
          failedAttempts: 0
        },
        bindings: {}
      },
      qqbot: {
        appId: 'app-1',
        clientSecret: 'secret',
        enabled: true,
        defaultAgentId: 'deepchat',
        defaultWorkdir: '',
        pairedUserIds: ['user_openid_1', 'user_openid_2'],
        pairedGroupIds: [],
        lastFatalError: null,
        pairing: {
          code: null,
          expiresAt: null,
          failedAttempts: 0
        },
        bindings: {}
      }
    })

    const presenter = new RemoteControlPresenter({
      configPresenter: configPresenter as any,
      agentSessionPresenter: {} as any,
      agentRuntimePresenter: {} as any,
      windowPresenter: {} as any,
      tabPresenter: {} as any
    })

    await presenter.removeChannelPrincipal('telegram', '456')
    await presenter.removeChannelPrincipal('feishu', 'ou_2')
    await presenter.removeChannelPrincipal('qqbot', 'user_openid_2')

    await expect(presenter.getTelegramPairingSnapshot()).resolves.toEqual({
      pairCode: null,
      pairCodeExpiresAt: null,
      allowedUserIds: [123]
    })
    await expect(presenter.getChannelPairingSnapshot('feishu')).resolves.toEqual({
      pairCode: null,
      pairCodeExpiresAt: null,
      pairedUserOpenIds: ['ou_1']
    })
    await expect(presenter.getChannelPairingSnapshot('qqbot')).resolves.toEqual({
      pairCode: null,
      pairCodeExpiresAt: null,
      pairedUserIds: ['user_openid_1']
    })
  })

  it('falls back to the built-in deepchat agent when saving an invalid default agent', async () => {
    const configPresenter = createConfigPresenter()
    const listAgents = vi.fn().mockResolvedValue([
      { id: 'deepchat', name: 'DeepChat', type: 'deepchat', enabled: true },
      { id: 'deepchat-alt', name: 'Alt', type: 'deepchat', enabled: false }
    ])

    configPresenter.setSetting('remoteControl', {
      telegram: {
        enabled: true,
        allowlist: [],
        streamMode: 'final',
        defaultAgentId: 'deepchat',
        defaultWorkdir: '',
        pollOffset: 0,
        pairing: {
          code: null,
          expiresAt: null,
          failedAttempts: 0
        },
        bindings: {}
      }
    })

    const presenter = new RemoteControlPresenter({
      configPresenter: {
        ...configPresenter,
        listAgents
      } as any,
      agentSessionPresenter: {} as any,
      agentRuntimePresenter: {} as any,
      windowPresenter: {} as any,
      tabPresenter: {} as any
    })

    const saved = await presenter.saveTelegramSettings({
      botToken: 'test-bot-token',
      remoteEnabled: true,
      defaultAgentId: 'deepchat-alt'
    })

    expect(saved.defaultAgentId).toBe('deepchat')
    expect(configPresenter.setSetting).toHaveBeenCalledWith(
      'remoteControl',
      expect.objectContaining({
        telegram: expect.objectContaining({
          defaultAgentId: 'deepchat',
          streamMode: 'final'
        })
      })
    )
  })

  it('keeps an enabled ACP agent as the remote default agent', async () => {
    const configPresenter = createConfigPresenter()

    const presenter = new RemoteControlPresenter({
      configPresenter: configPresenter as any,
      agentSessionPresenter: {} as any,
      agentRuntimePresenter: {} as any,
      windowPresenter: {} as any,
      tabPresenter: {} as any
    })

    const saved = await presenter.saveTelegramSettings({
      botToken: 'test-bot-token',
      remoteEnabled: true,
      defaultAgentId: 'acp-agent'
    })

    expect(saved.defaultAgentId).toBe('acp-agent')
  })

  it('lists builtin remote channels including discord, qqbot, and weixin-ilink', async () => {
    const configPresenter = createConfigPresenter()

    const presenter = new RemoteControlPresenter({
      configPresenter: configPresenter as any,
      agentSessionPresenter: {} as any,
      agentRuntimePresenter: {} as any,
      windowPresenter: {} as any,
      tabPresenter: {} as any
    })

    await expect(presenter.listRemoteChannels()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'discord',
          implemented: true
        }),
        expect.objectContaining({
          id: 'qqbot',
          implemented: true
        }),
        expect.objectContaining({
          id: 'weixin-ilink',
          implemented: true
        })
      ])
    )
  })

  it('saves discord remote settings without touching unrelated config', async () => {
    const configPresenter = createConfigPresenter()

    const presenter = new RemoteControlPresenter({
      configPresenter: configPresenter as any,
      agentSessionPresenter: {} as any,
      agentRuntimePresenter: {} as any,
      windowPresenter: {} as any,
      tabPresenter: {} as any
    })

    const saved = await presenter.saveDiscordSettings({
      botToken: 'discord-bot-token',
      remoteEnabled: false,
      defaultAgentId: 'deepchat',
      defaultWorkdir: 'C:/workspaces/discord',
      pairedChannelIds: ['1234567890']
    })

    expect(saved).toEqual({
      botToken: 'discord-bot-token',
      remoteEnabled: false,
      defaultAgentId: 'deepchat',
      defaultWorkdir: 'C:/workspaces/discord',
      pairedChannelIds: ['1234567890']
    })
    expect(configPresenter.setSetting).toHaveBeenCalledWith(
      'remoteControl',
      expect.objectContaining({
        discord: expect.objectContaining({
          botToken: 'discord-bot-token',
          enabled: false,
          defaultWorkdir: 'C:/workspaces/discord',
          pairedChannelIds: ['1234567890']
        })
      })
    )
  })

  it('persists the lark brand inside feishu remote settings', async () => {
    const configPresenter = createConfigPresenter()

    const presenter = new RemoteControlPresenter({
      configPresenter: configPresenter as any,
      agentSessionPresenter: {} as any,
      agentRuntimePresenter: {} as any,
      windowPresenter: {} as any,
      tabPresenter: {} as any
    })

    const saved = await presenter.saveFeishuSettings({
      brand: 'lark',
      appId: 'cli_lark',
      appSecret: 'secret',
      verificationToken: 'verify',
      encryptKey: '',
      remoteEnabled: false,
      defaultAgentId: 'deepchat',
      defaultWorkdir: '',
      pairedUserOpenIds: []
    })

    expect(saved.brand).toBe('lark')
    expect(configPresenter.setSetting).toHaveBeenCalledWith(
      'remoteControl',
      expect.objectContaining({
        feishu: expect.objectContaining({
          brand: 'lark',
          appId: 'cli_lark'
        })
      })
    )
  })

  it('stores a wechat ilink account after qr login completes', async () => {
    const configPresenter = createConfigPresenter()

    const presenter = new RemoteControlPresenter({
      configPresenter: configPresenter as any,
      agentSessionPresenter: {} as any,
      agentRuntimePresenter: {} as any,
      windowPresenter: {
        getFocusedWindow: vi.fn(() => undefined),
        getAllWindows: vi.fn(() => [])
      } as any,
      tabPresenter: {} as any
    })

    const startLoginSpy = vi.spyOn(WeixinIlinkClient, 'startLogin').mockResolvedValueOnce({
      sessionKey: 'wx-session',
      loginUrl: 'https://liteapp.weixin.qq.com/mock-login',
      messageKey: 'settings.remote.weixinIlink.loginWindowOpened'
    })
    const waitLoginSpy = vi.spyOn(WeixinIlinkClient, 'waitForLogin').mockResolvedValueOnce({
      connected: true,
      accountId: 'wx-account-1',
      ownerUserId: 'owner-1',
      botToken: 'bot-token-1',
      baseUrl: 'https://ilinkai.weixin.qq.com',
      messageKey: 'settings.remote.weixinIlink.loginConnected'
    })

    await expect(presenter.startWeixinIlinkLogin()).resolves.toEqual({
      sessionKey: 'wx-session',
      loginUrl: 'https://liteapp.weixin.qq.com/mock-login',
      messageKey: 'settings.remote.weixinIlink.loginWindowOpened',
      message: undefined
    })
    expect(BrowserWindow).toHaveBeenCalledTimes(1)
    expect(vi.mocked(BrowserWindow).mock.results[0]?.value.loadURL).toHaveBeenCalledWith(
      'https://liteapp.weixin.qq.com/mock-login'
    )

    await expect(
      presenter.waitForWeixinIlinkLogin({
        sessionKey: 'wx-session',
        timeoutMs: 1_000
      })
    ).resolves.toEqual({
      connected: true,
      account: {
        accountId: 'wx-account-1',
        ownerUserId: 'owner-1',
        baseUrl: 'https://ilinkai.weixin.qq.com',
        enabled: true
      },
      messageKey: 'settings.remote.weixinIlink.loginConnected',
      message: undefined
    })

    await expect(presenter.getWeixinIlinkSettings()).resolves.toEqual(
      expect.objectContaining({
        accounts: [
          {
            accountId: 'wx-account-1',
            ownerUserId: 'owner-1',
            baseUrl: 'https://ilinkai.weixin.qq.com',
            enabled: true
          }
        ]
      })
    )

    startLoginSpy.mockRestore()
    waitLoginSpy.mockRestore()
  })

  it('deduplicates concurrent wechat ilink login waits for the same session', async () => {
    const configPresenter = createConfigPresenter()

    const presenter = new RemoteControlPresenter({
      configPresenter: configPresenter as any,
      agentSessionPresenter: {} as any,
      agentRuntimePresenter: {} as any,
      windowPresenter: {
        getFocusedWindow: vi.fn(() => undefined),
        getAllWindows: vi.fn(() => [])
      } as any,
      tabPresenter: {} as any
    })

    const waitLoginSpy = vi.spyOn(WeixinIlinkClient, 'waitForLogin').mockResolvedValue({
      connected: true,
      accountId: 'wx-account-1',
      ownerUserId: 'owner-1',
      botToken: 'bot-token-1',
      baseUrl: 'https://ilinkai.weixin.qq.com',
      messageKey: 'settings.remote.weixinIlink.loginConnected'
    })

    const [firstResult, secondResult] = await Promise.all([
      presenter.waitForWeixinIlinkLogin({
        sessionKey: 'wx-session',
        timeoutMs: 1_000
      }),
      presenter.waitForWeixinIlinkLogin({
        sessionKey: 'wx-session',
        timeoutMs: 1_000
      })
    ])

    expect(firstResult).toEqual(secondResult)
    expect(waitLoginSpy).toHaveBeenCalledTimes(1)

    waitLoginSpy.mockRestore()
  })
})
