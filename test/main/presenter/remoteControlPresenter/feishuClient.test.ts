import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientConfigs: unknown[] = []
const wsClientConfigs: unknown[] = []
const wsStart = vi.fn().mockResolvedValue(undefined)
const wsClose = vi.fn()
const register = vi.fn()

vi.mock('@larksuiteoapi/node-sdk', () => ({
  Domain: {
    Feishu: 'https://open.feishu.cn',
    Lark: 'https://open.larksuite.com'
  },
  AppType: {
    SelfBuild: 'SelfBuild'
  },
  LoggerLevel: {
    info: 'info'
  },
  Client: class MockClient {
    readonly request = vi.fn()
    readonly im = {
      message: {
        reply: vi.fn(),
        create: vi.fn(),
        update: vi.fn()
      }
    }

    constructor(config: unknown) {
      clientConfigs.push(config)
    }
  },
  WSClient: class MockWSClient {
    readonly start = wsStart
    readonly close = wsClose

    constructor(config: unknown) {
      wsClientConfigs.push(config)
    }
  },
  EventDispatcher: class MockEventDispatcher {
    readonly register = register

    constructor(_config: unknown) {}
  }
}))

import { FeishuClient } from '@/presenter/remoteControlPresenter/feishu/feishuClient'

describe('FeishuClient', () => {
  beforeEach(() => {
    clientConfigs.length = 0
    wsClientConfigs.length = 0
    wsStart.mockClear()
    wsClose.mockClear()
    register.mockClear()
  })

  it('uses the lark domain for both rest and websocket clients', async () => {
    const client = new FeishuClient({
      brand: 'lark',
      appId: 'cli_lark',
      appSecret: 'secret',
      verificationToken: 'verify',
      encryptKey: 'encrypt'
    })

    await client.startMessageStream({
      onMessage: vi.fn().mockResolvedValue(undefined)
    })

    expect(clientConfigs).toContainEqual(
      expect.objectContaining({
        domain: 'https://open.larksuite.com',
        appId: 'cli_lark',
        appSecret: 'secret'
      })
    )
    expect(wsClientConfigs).toContainEqual(
      expect.objectContaining({
        domain: 'https://open.larksuite.com',
        appId: 'cli_lark',
        appSecret: 'secret'
      })
    )
    expect(wsStart).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledTimes(1)
  })
})
