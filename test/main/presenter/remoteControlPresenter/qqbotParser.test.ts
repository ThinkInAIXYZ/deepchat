import { describe, expect, it } from 'vitest'
import { QQBotParser } from '@/presenter/remoteControlPresenter/qqbot/qqbotParser'

describe('QQBotParser', () => {
  it('parses c2c commands from official dispatch payloads', () => {
    const parser = new QQBotParser()

    const parsed = parser.parseDispatch({
      t: 'C2C_MESSAGE_CREATE',
      d: {
        id: 'msg_c2c_1',
        content: '/pair 123456',
        author: {
          user_openid: 'user_openid_1'
        }
      }
    })

    expect(parsed).toEqual(
      expect.objectContaining({
        chatType: 'c2c',
        chatId: 'user_openid_1',
        senderUserId: 'user_openid_1',
        text: '/pair 123456',
        command: {
          name: 'pair',
          args: '123456'
        }
      })
    )
  })

  it('parses group @bot messages from official dispatch payloads', () => {
    const parser = new QQBotParser()

    const parsed = parser.parseDispatch({
      t: 'GROUP_AT_MESSAGE_CREATE',
      d: {
        id: 'msg_group_1',
        content: 'hello from group',
        group_openid: 'group_openid_1',
        author: {
          member_openid: 'member_openid_1'
        }
      }
    })

    expect(parsed).toEqual(
      expect.objectContaining({
        chatType: 'group',
        chatId: 'group_openid_1',
        senderUserId: 'member_openid_1',
        mentionedBot: true,
        text: 'hello from group'
      })
    )
  })
})
