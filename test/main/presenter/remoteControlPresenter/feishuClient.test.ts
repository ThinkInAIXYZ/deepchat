import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const clientConfigs: unknown[] = []
const wsClientConfigs: unknown[] = []
const wsStart = vi.fn().mockResolvedValue(undefined)
const wsClose = vi.fn()
const register = vi.fn()
const messageResourceGet = vi.fn()
const imageCreate = vi.fn()

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    __esModule: true,
    ...actual,
    default: actual
  }
})

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
      },
      image: {
        create: imageCreate
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
    imageCreate.mockReset()
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

  it('sends image replies with the uploaded image key', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-feishu-client-'))
    const imagePath = path.join(workspace, 'reply.png')
    await fs.writeFile(imagePath, Buffer.from('image-bytes'))
    imageCreate.mockResolvedValue({
      data: {
        image_key: 'img_key'
      }
    })
    const client = new FeishuClient({
      brand: 'feishu',
      appId: 'cli_feishu',
      appSecret: 'secret',
      verificationToken: 'verify',
      encryptKey: 'encrypt'
    })
    ;(client as any).sdk.im.message.reply.mockResolvedValue({
      data: {
        message_id: 'om_reply'
      }
    })

    const messageId = await client.sendImage(
      {
        chatId: 'oc_1',
        threadId: 'omt_1',
        replyToMessageId: 'om_source'
      },
      imagePath
    )

    expect(messageId).toBe('om_reply')
    expect(imageCreate).toHaveBeenCalledTimes(1)
    expect((client as any).sdk.im.message.reply).toHaveBeenCalledWith({
      path: {
        message_id: 'om_source'
      },
      params: {
        receive_id_type: 'chat_id'
      },
      data: {
        receive_id: 'oc_1',
        msg_type: 'image',
        content: JSON.stringify({
          image_key: 'img_key'
        }),
        reply_in_thread: true
      }
    })
    expect((client as any).sdk.im.message.create).not.toHaveBeenCalled()
  })

  it('fails fast when the image file is missing', async () => {
    const client = new FeishuClient({
      brand: 'feishu',
      appId: 'cli_feishu',
      appSecret: 'secret',
      verificationToken: 'verify',
      encryptKey: 'encrypt'
    })

    await expect(
      client.sendImage(
        {
          chatId: 'oc_1'
        },
        path.join(os.tmpdir(), 'missing-deepchat-feishu-image.png')
      )
    ).rejects.toThrow('Feishu image file is missing')
    expect(imageCreate).not.toHaveBeenCalled()
  })
})
