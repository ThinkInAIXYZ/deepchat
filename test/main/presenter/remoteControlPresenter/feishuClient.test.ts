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

  it('serializes post replies using the Feishu post content schema', async () => {
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

    const messageId = await client.sendMarkdown(
      {
        chatId: 'oc_1',
        replyToMessageId: 'om_source'
      },
      'Pairing complete.'
    )

    expect(messageId).toBe('om_reply')
    expect((client as any).sdk.im.message.reply).toHaveBeenCalledWith({
      path: {
        message_id: 'om_source'
      },
      data: {
        content: JSON.stringify({
          zh_cn: {
            content: [[{ tag: 'md', text: 'Pairing complete.' }]]
          }
        }),
        msg_type: 'post',
        reply_in_thread: false
      }
    })
  })

  it('creates and updates a CardKit streaming card', async () => {
    const client = new FeishuClient({
      brand: 'feishu',
      appId: 'cli_feishu',
      appSecret: 'secret',
      verificationToken: 'verify',
      encryptKey: 'encrypt'
    })
    ;(client as any).sdk.request
      .mockResolvedValueOnce({
        code: 0,
        data: {
          card_id: 'card_1'
        }
      })
      .mockResolvedValueOnce({
        code: 0,
        data: {}
      })
      .mockResolvedValueOnce({
        code: 0,
        data: {}
      })

    const card = await client.createStreamingCard('')
    await client.updateStreamingCardContent({
      cardId: card.cardId,
      elementId: card.elementId,
      content: 'Hello',
      sequence: 1
    })
    await client.closeStreamingCard(card.cardId, 2)

    expect(card).toEqual({
      cardId: 'card_1',
      elementId: 'md_stream'
    })
    const createRequest = (client as any).sdk.request.mock.calls[0][0]
    expect(createRequest).toEqual(
      expect.objectContaining({
        method: 'POST',
        url: '/open-apis/cardkit/v1/cards',
        data: expect.objectContaining({
          type: 'card_json'
        })
      })
    )
    expect(JSON.parse(createRequest.data.data)).toEqual(
      expect.objectContaining({
        schema: '2.0',
        config: expect.objectContaining({
          streaming_mode: true,
          update_multi: true
        }),
        body: {
          elements: [
            {
              tag: 'markdown',
              content: '',
              element_id: 'md_stream'
            }
          ]
        }
      })
    )
    expect((client as any).sdk.request).toHaveBeenNthCalledWith(2, {
      method: 'PUT',
      url: '/open-apis/cardkit/v1/cards/card_1/elements/md_stream/content',
      data: {
        content: 'Hello',
        sequence: 1
      }
    })
    expect((client as any).sdk.request).toHaveBeenNthCalledWith(3, {
      method: 'PATCH',
      url: '/open-apis/cardkit/v1/cards/card_1/settings',
      data: {
        settings: JSON.stringify({
          config: {
            streaming_mode: false
          }
        }),
        sequence: 2
      }
    })
  })

  it('sends a CardKit card entity as an interactive message reply', async () => {
    const client = new FeishuClient({
      brand: 'feishu',
      appId: 'cli_feishu',
      appSecret: 'secret',
      verificationToken: 'verify',
      encryptKey: 'encrypt'
    })
    ;(client as any).sdk.im.message.reply.mockResolvedValue({
      data: {
        message_id: 'om_card'
      }
    })

    const messageId = await client.sendCardEntity(
      {
        chatId: 'oc_1',
        threadId: 'omt_1',
        replyToMessageId: 'om_source'
      },
      'card_1'
    )

    expect(messageId).toBe('om_card')
    expect((client as any).sdk.im.message.reply).toHaveBeenCalledWith({
      path: {
        message_id: 'om_source'
      },
      data: {
        content: JSON.stringify({
          type: 'card',
          data: {
            card_id: 'card_1'
          }
        }),
        msg_type: 'interactive',
        reply_in_thread: true
      }
    })
  })

  it('fails fast when CardKit card entity omits message_id', async () => {
    const client = new FeishuClient({
      brand: 'feishu',
      appId: 'cli_feishu',
      appSecret: 'secret',
      verificationToken: 'verify',
      encryptKey: 'encrypt'
    })
    ;(client as any).sdk.im.message.reply.mockResolvedValue({
      data: {
        message_id: '  '
      }
    })
    ;(client as any).sdk.im.message.create.mockResolvedValue({
      data: {}
    })

    await expect(
      client.sendCardEntity(
        {
          chatId: 'oc_1',
          replyToMessageId: 'om_source'
        },
        'card_1'
      )
    ).rejects.toThrow('Feishu CardKit send card entity did not return message_id.')

    await expect(
      client.sendCardEntity(
        {
          chatId: 'oc_1'
        },
        'card_1'
      )
    ).rejects.toThrow('Feishu CardKit send card entity did not return message_id.')
  })

  it('surfaces CardKit API errors clearly', async () => {
    const client = new FeishuClient({
      brand: 'feishu',
      appId: 'cli_feishu',
      appSecret: 'secret',
      verificationToken: 'verify',
      encryptKey: 'encrypt'
    })
    ;(client as any).sdk.request.mockResolvedValue({
      code: 300311,
      msg: 'The current application does not have permission to update/use this card'
    })

    await expect(client.createStreamingCard()).rejects.toThrow(
      'The current application does not have permission to update/use this card'
    )
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
