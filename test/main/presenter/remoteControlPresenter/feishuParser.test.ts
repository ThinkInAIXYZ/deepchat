import { describe, expect, it } from 'vitest'
import { FeishuParser } from '@/presenter/remoteControlPresenter/feishu/feishuParser'

describe('FeishuParser', () => {
  it('parses direct-message commands from text payloads', () => {
    const parser = new FeishuParser()

    const parsed = parser.parseEvent(
      {
        event_id: 'evt-1',
        sender: {
          sender_id: {
            open_id: 'ou_user'
          },
          sender_type: 'user'
        },
        message: {
          message_id: 'om_1',
          create_time: '1',
          chat_id: 'oc_1',
          chat_type: 'p2p',
          message_type: 'text',
          content: JSON.stringify({
            text: '/pair 123456'
          })
        }
      },
      'ou_bot'
    )

    expect(parsed).toEqual(
      expect.objectContaining({
        chatType: 'p2p',
        text: '/pair 123456',
        senderOpenId: 'ou_user',
        command: {
          name: 'pair',
          args: '123456'
        }
      })
    )
  })

  it('strips leading bot mentions and falls back to root_id for topics', () => {
    const parser = new FeishuParser()

    const parsed = parser.parseEvent(
      {
        event_id: 'evt-2',
        sender: {
          sender_id: {
            open_id: 'ou_user'
          },
          sender_type: 'user'
        },
        message: {
          message_id: 'om_2',
          create_time: '1',
          root_id: 'omt_topic',
          chat_id: 'oc_group',
          chat_type: 'group',
          message_type: 'text',
          content: JSON.stringify({
            text: '<at user_id="ou_bot">Bot</at> hello there'
          }),
          mentions: [
            {
              key: '@_user_1',
              id: {
                open_id: 'ou_bot'
              },
              name: 'Bot'
            }
          ]
        }
      },
      'ou_bot'
    )

    expect(parsed).toEqual(
      expect.objectContaining({
        chatType: 'group',
        threadId: 'omt_topic',
        text: 'hello there',
        mentionedBot: true
      })
    )
  })
})
