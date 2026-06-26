import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow } from 'electron'
import * as http from 'node:http'
import * as net from 'node:net'
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

const getFreeLoopbackPort = async (): Promise<number> => {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (!address || typeof address === 'string') {
    throw new Error('Unable to allocate a loopback port')
  }
  return address.port
}

const requestUrl = async (url: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume()
      response.on('end', () => resolve())
    })
    request.on('error', reject)
  })
}

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
    getAgentType: vi.fn(async (agentId: string) => (agentId === 'acp-agent' ? 'acp' : 'deepchat')),
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

  afterEach(() => {
    vi.restoreAllMocks()
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

  it('installs Feishu PersonalAgent credentials from the official QR registration flow', async () => {
    const configPresenter = createConfigPresenter()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = new URLSearchParams(String(init?.body ?? ''))
      const action = body.get('action')
      if (action === 'begin') {
        return new Response(
          JSON.stringify({
            device_code: 'feishu-device',
            user_code: 'CODE-1',
            verification_uri_complete: 'https://open.feishu.cn/page/launcher?user_code=CODE-1',
            expires_in: 300,
            interval: 1
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (action === 'poll') {
        return new Response(
          JSON.stringify({
            client_id: 'cli_personal',
            client_secret: 'personal_secret',
            user_info: {
              open_id: 'ou_personal',
              tenant_brand: 'feishu'
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      throw new Error(`Unexpected action: ${action}`)
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

    const session = await presenter.startFeishuInstall({ brand: 'feishu' })
    expect(session.installUrl).toBe('https://open.feishu.cn/page/launcher?user_code=CODE-1')

    await expect(
      presenter.waitForFeishuInstall({ sessionKey: session.sessionKey })
    ).resolves.toEqual(
      expect.objectContaining({
        installed: true,
        brand: 'feishu',
        appId: 'cli_personal',
        openId: 'ou_personal'
      })
    )
    await expect(presenter.getFeishuSettings()).resolves.toEqual(
      expect.objectContaining({
        brand: 'feishu',
        appId: 'cli_personal',
        appSecret: 'personal_secret',
        pairedUserOpenIds: ['ou_personal']
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://accounts.feishu.cn/oauth/v1/app/registration',
      expect.objectContaining({
        method: 'POST'
      })
    )
  })

  it('begins Lark install on Feishu and switches polling when tenant brand is Lark', async () => {
    const configPresenter = createConfigPresenter()
    const requestedHosts: string[] = []
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      requestedHosts.push(new URL(String(url)).hostname)
      const body = new URLSearchParams(String(init?.body ?? ''))
      const action = body.get('action')
      if (action === 'begin') {
        return new Response(
          JSON.stringify({
            device_code: 'lark-device',
            user_code: 'CODE-2',
            verification_uri_complete: 'https://open.feishu.cn/page/launcher?user_code=CODE-2',
            expires_in: 300,
            interval: 1
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (action === 'poll' && requestedHosts.at(-1) === 'accounts.feishu.cn') {
        return new Response(JSON.stringify({ user_info: { tenant_brand: 'lark' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      if (action === 'poll' && requestedHosts.at(-1) === 'accounts.larksuite.com') {
        return new Response(
          JSON.stringify({
            client_id: 'cli_lark',
            client_secret: 'lark_secret',
            user_info: {
              open_id: 'ou_lark',
              tenant_brand: 'lark'
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      throw new Error(`Unexpected request: ${String(url)} ${String(init?.body ?? '')}`)
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

    const session = await presenter.startFeishuInstall({ brand: 'lark' })
    expect(session.installUrl).toContain('https://open.feishu.cn/')
    await expect(
      presenter.waitForFeishuInstall({ sessionKey: session.sessionKey })
    ).resolves.toEqual(
      expect.objectContaining({
        installed: true,
        brand: 'lark',
        appId: 'cli_lark',
        openId: 'ou_lark'
      })
    )
    expect(requestedHosts).toEqual([
      'accounts.feishu.cn',
      'accounts.feishu.cn',
      'accounts.larksuite.com'
    ])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not store Feishu credentials after install is cancelled while polling is in flight', async () => {
    const configPresenter = createConfigPresenter()
    let resolvePoll!: (response: Response) => void
    const pollStarted = new Promise<void>((resolve) => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        const body = new URLSearchParams(String(init?.body ?? ''))
        const action = body.get('action')
        if (action === 'begin') {
          return new Response(
            JSON.stringify({
              device_code: 'cancel-device',
              user_code: 'CODE-CANCEL',
              verification_uri_complete: 'https://open.feishu.cn/page/launcher?user_code=CANCEL',
              expires_in: 300,
              interval: 1
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }

        if (action === 'poll') {
          resolve()
          return await new Promise<Response>((pollResolve) => {
            resolvePoll = pollResolve
          })
        }

        throw new Error(`Unexpected action: ${action}`)
      })

      expect(fetchMock).toBeDefined()
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

    const session = await presenter.startFeishuInstall({ brand: 'feishu' })
    const waitPromise = presenter.waitForFeishuInstall({ sessionKey: session.sessionKey })
    await pollStarted

    await presenter.cancelFeishuInstall(session.sessionKey)
    await expect(waitPromise).resolves.toEqual(
      expect.objectContaining({
        installed: false,
        messageKey: 'settings.remote.feishu.installCancelled'
      })
    )

    resolvePoll(
      new Response(
        JSON.stringify({
          client_id: 'cli_late',
          client_secret: 'late_secret',
          user_info: {
            open_id: 'ou_late',
            tenant_brand: 'feishu'
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    await Promise.resolve()
    await Promise.resolve()

    await expect(presenter.getFeishuSettings()).resolves.toEqual(
      expect.objectContaining({
        appId: '',
        appSecret: '',
        pairedUserOpenIds: []
      })
    )
  })

  it('starts Feishu scan auth with a loopback callback and pairs the authorized user', async () => {
    const configPresenter = createConfigPresenter()
    const port = await getFreeLoopbackPort()
    const redirectUri = `http://127.0.0.1:${port}/remote/feishu/auth/callback`
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const normalizedUrl = String(url)
      if (normalizedUrl.includes('/open-apis/authen/v2/oauth/token')) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              access_token: 'user-token'
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (normalizedUrl.includes('/open-apis/authen/v1/user_info')) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              open_id: 'ou_scan',
              union_id: 'on_union',
              name: 'Scan User'
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      throw new Error(`Unexpected fetch: ${normalizedUrl}`)
    })

    configPresenter.setSetting('remoteControl', {
      feishu: {
        brand: 'feishu',
        appId: 'cli_scan',
        appSecret: 'secret',
        enabled: false,
        defaultAgentId: 'deepchat',
        defaultWorkdir: '',
        pairedUserOpenIds: [],
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
      windowPresenter: {
        getFocusedWindow: vi.fn(() => undefined),
        getAllWindows: vi.fn(() => [])
      } as any,
      tabPresenter: {} as any
    })

    const session = await presenter.startFeishuAuth({ redirectUri })
    const state = new URL(session.authUrl ?? '').searchParams.get('state')
    expect(state).toBeTruthy()

    const waitPromise = presenter.waitForFeishuAuth({ sessionKey: session.sessionKey })
    await requestUrl(`${redirectUri}?code=auth-code&state=${state}`)
    await expect(waitPromise).resolves.toEqual(
      expect.objectContaining({
        authorized: true,
        openId: 'ou_scan',
        unionId: 'on_union',
        name: 'Scan User'
      })
    )
    await expect(presenter.getChannelPairingSnapshot('feishu')).resolves.toEqual(
      expect.objectContaining({
        pairedUserOpenIds: ['ou_scan']
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
      expect.objectContaining({
        method: 'POST'
      })
    )
  })

  it('does not pair a Feishu user after scan auth is cancelled while token exchange is in flight', async () => {
    const configPresenter = createConfigPresenter()
    const port = await getFreeLoopbackPort()
    const redirectUri = `http://127.0.0.1:${port}/remote/feishu/auth/callback`
    let resolveToken!: (response: Response) => void
    const tokenRequestStarted = new Promise<void>((resolve) => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const normalizedUrl = String(url)
        if (normalizedUrl.includes('/open-apis/authen/v2/oauth/token')) {
          resolve()
          return await new Promise<Response>((tokenResolve) => {
            resolveToken = tokenResolve
          })
        }

        if (normalizedUrl.includes('/open-apis/authen/v1/user_info')) {
          return new Response(
            JSON.stringify({
              code: 0,
              data: {
                open_id: 'ou_late'
              }
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }

        throw new Error(`Unexpected fetch: ${normalizedUrl}`)
      })
    })

    configPresenter.setSetting('remoteControl', {
      feishu: {
        brand: 'feishu',
        appId: 'cli_scan',
        appSecret: 'secret',
        enabled: false,
        defaultAgentId: 'deepchat',
        defaultWorkdir: '',
        pairedUserOpenIds: [],
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
      windowPresenter: {
        getFocusedWindow: vi.fn(() => undefined),
        getAllWindows: vi.fn(() => [])
      } as any,
      tabPresenter: {} as any
    })

    const session = await presenter.startFeishuAuth({ redirectUri })
    const state = new URL(session.authUrl ?? '').searchParams.get('state')
    const waitPromise = presenter.waitForFeishuAuth({ sessionKey: session.sessionKey })
    const callbackPromise = requestUrl(`${redirectUri}?code=auth-code&state=${state}`)
    await tokenRequestStarted

    await presenter.cancelFeishuAuth(session.sessionKey)
    await expect(waitPromise).resolves.toEqual(
      expect.objectContaining({
        authorized: false,
        openId: null,
        messageKey: 'settings.remote.feishu.authCancelled'
      })
    )

    resolveToken(
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            access_token: 'late-user-token'
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    await callbackPromise

    await expect(presenter.getChannelPairingSnapshot('feishu')).resolves.toEqual(
      expect.objectContaining({
        pairedUserOpenIds: []
      })
    )
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects Feishu scan auth callbacks with mismatched state', async () => {
    const configPresenter = createConfigPresenter()
    const port = await getFreeLoopbackPort()
    const redirectUri = `http://127.0.0.1:${port}/remote/feishu/auth/callback`
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    configPresenter.setSetting('remoteControl', {
      feishu: {
        brand: 'lark',
        appId: 'cli_lark',
        appSecret: 'secret',
        enabled: false,
        defaultAgentId: 'deepchat',
        defaultWorkdir: '',
        pairedUserOpenIds: [],
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
      windowPresenter: {
        getFocusedWindow: vi.fn(() => undefined),
        getAllWindows: vi.fn(() => [])
      } as any,
      tabPresenter: {} as any
    })

    const session = await presenter.startFeishuAuth({ redirectUri })
    expect(session.authUrl).toContain(
      'https://accounts.larksuite.com/open-apis/authen/v1/authorize'
    )

    const waitPromise = presenter.waitForFeishuAuth({ sessionKey: session.sessionKey })
    await requestUrl(`${redirectUri}?code=auth-code&state=wrong-state`)
    await expect(waitPromise).resolves.toEqual(
      expect.objectContaining({
        authorized: false,
        openId: null,
        messageKey: 'settings.remote.feishu.authStateMismatch'
      })
    )
    await expect(presenter.getChannelPairingSnapshot('feishu')).resolves.toEqual(
      expect.objectContaining({
        pairedUserOpenIds: []
      })
    )
    expect(fetchMock).not.toHaveBeenCalled()
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
      pairedUserIds: ['user_openid_1'],
      pairedGroupIds: []
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
      defaultAgentId: 'acp-agent',
      defaultWorkdir: '/workspace'
    })

    expect(saved.defaultAgentId).toBe('acp-agent')
  })

  it('returns the SQLite agent id when candidate uses the legacy alias key', async () => {
    const configPresenter = createConfigPresenter()
    const listAgents = vi.fn().mockResolvedValue([
      { id: 'deepchat', name: 'DeepChat', type: 'deepchat', enabled: true },
      { id: 'claude-acp', name: 'Claude (ACP)', type: 'acp', enabled: true }
    ])
    const getAgentType = vi.fn(async (agentId: string) =>
      agentId === 'claude-acp' ? 'acp' : 'deepchat'
    )

    const presenter = new RemoteControlPresenter({
      configPresenter: {
        ...configPresenter,
        listAgents,
        getAgentType
      } as any,
      agentSessionPresenter: {} as any,
      agentRuntimePresenter: {} as any,
      windowPresenter: {} as any,
      tabPresenter: {} as any
    })

    const saved = await presenter.saveTelegramSettings({
      botToken: 'test-bot-token',
      remoteEnabled: true,
      defaultAgentId: 'claude-code-acp',
      defaultWorkdir: '/workspace'
    })

    expect(saved.defaultAgentId).toBe('claude-acp')
  })

  it('keeps a legacy SQLite agent id intact when the candidate matches it', async () => {
    const configPresenter = createConfigPresenter()
    const listAgents = vi.fn().mockResolvedValue([
      { id: 'deepchat', name: 'DeepChat', type: 'deepchat', enabled: true },
      { id: 'claude-code-acp', name: 'Claude Code (ACP)', type: 'acp', enabled: true }
    ])
    const getAgentType = vi.fn(async (agentId: string) =>
      agentId === 'claude-code-acp' ? 'acp' : 'deepchat'
    )

    const presenter = new RemoteControlPresenter({
      configPresenter: {
        ...configPresenter,
        listAgents,
        getAgentType
      } as any,
      agentSessionPresenter: {} as any,
      agentRuntimePresenter: {} as any,
      windowPresenter: {} as any,
      tabPresenter: {} as any
    })

    const saved = await presenter.saveTelegramSettings({
      botToken: 'test-bot-token',
      remoteEnabled: true,
      defaultAgentId: 'claude-code-acp',
      defaultWorkdir: '/workspace'
    })

    expect(saved.defaultAgentId).toBe('claude-code-acp')
  })

  it('falls back to channel default when no alias-equivalent agent exists', async () => {
    const configPresenter = createConfigPresenter()
    const listAgents = vi
      .fn()
      .mockResolvedValue([{ id: 'deepchat', name: 'DeepChat', type: 'deepchat', enabled: true }])

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
      defaultAgentId: 'claude-code-acp'
    })

    expect(saved.defaultAgentId).toBe('deepchat')
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

  it('preserves paired Feishu users when saving stale settings input', async () => {
    const configPresenter = createConfigPresenter()
    configPresenter.setSetting('remoteControl', {
      feishu: {
        brand: 'feishu',
        appId: 'cli_old',
        appSecret: 'secret',
        verificationToken: 'verify',
        encryptKey: '',
        enabled: true,
        defaultAgentId: 'deepchat',
        defaultWorkdir: '',
        pairedUserOpenIds: ['ou_paired'],
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

    const saved = await presenter.saveFeishuSettings({
      brand: 'lark',
      appId: 'cli_new',
      appSecret: 'secret',
      verificationToken: 'verify',
      encryptKey: '',
      remoteEnabled: false,
      enableStreamingCards: true,
      defaultAgentId: 'deepchat',
      defaultWorkdir: '',
      pairedUserOpenIds: []
    })

    expect(saved.pairedUserOpenIds).toEqual(['ou_paired'])
    expect(configPresenter.setSetting).toHaveBeenCalledWith(
      'remoteControl',
      expect.objectContaining({
        feishu: expect.objectContaining({
          appId: 'cli_new',
          enableStreamingCards: true,
          pairedUserOpenIds: ['ou_paired']
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
      enableStreamingCards: false,
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
