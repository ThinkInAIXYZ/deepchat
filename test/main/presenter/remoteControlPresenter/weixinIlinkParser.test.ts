import { describe, expect, it } from 'vitest'
import { WeixinIlinkParser } from '@/presenter/remoteControlPresenter/weixinIlink/weixinIlinkParser'

describe('WeixinIlinkParser', () => {
  it('parses encrypted image media attachments from iLink messages', () => {
    const parser = new WeixinIlinkParser()

    const parsed = parser.parseMessage('account-1', {
      message_id: 42,
      from_user_id: 'user-1',
      message_type: 1,
      context_token: 'context-token',
      item_list: [
        {
          type: 2,
          image_item: {
            aeskey: '00112233445566778899aabbccddeeff',
            media: {
              encrypt_query_param: 'encrypted-query',
              aes_key: 'unused-media-key',
              full_url: 'https://cdn.example/download'
            },
            mid_size: 1234
          }
        }
      ]
    })

    expect(parsed?.attachments).toEqual([
      {
        id: '0',
        filename: 'image-1.png',
        mediaType: 'image/png',
        url: undefined,
        data: undefined,
        size: 1234,
        encryptedMedia: {
          encryptedQueryParam: 'encrypted-query',
          aesKey: '00112233445566778899aabbccddeeff',
          aesKeyEncoding: 'hex',
          fullUrl: 'https://cdn.example/download',
          cdnBaseUrl: 'https://novac2c.cdn.weixin.qq.com/c2c'
        },
        resourceType: 'image'
      }
    ])
  })
})
