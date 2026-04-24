import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientConfigs: unknown[] = []
const wsClientConfigs: unknown[] = []
const wsStart = vi.fn().mockResolvedValue(undefined)
const wsClose = vi.fn()
const register = vi.fn()
const messageResourceGet = vi.fn()

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
      },
      messageResource: {
        get: messageResourceGet
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
    messageResourceGet.mockReset()
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

  it('uses response content-type for downloaded message resources', async () => {
    messageResourceGet.mockResolvedValue({
      data: Buffer.from('image-bytes'),
      headers: {
        'content-type': 'image/jpeg'
      }
    })
    const client = new FeishuClient({
      brand: 'feishu',
      appId: 'cli_feishu',
      appSecret: 'secret',
      verificationToken: 'verify',
      encryptKey: 'encrypt'
    })

    const downloaded = await client.downloadMessageResource({
      messageId: 'om_1',
      fileKey: 'img_key',
      type: 'image'
    })

    expect(downloaded).toEqual({
      data: Buffer.from('image-bytes').toString('base64'),
      mediaType: 'image/jpeg'
    })
  })
})
