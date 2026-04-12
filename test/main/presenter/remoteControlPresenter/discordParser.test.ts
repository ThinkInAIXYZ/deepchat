import { describe, expect, it } from 'vitest'
import { DiscordParser } from '@/presenter/remoteControlPresenter/discord/discordParser'

describe('DiscordParser', () => {
  it('parses mentioned guild messages and strips the leading bot mention', () => {
    const parser = new DiscordParser()

    const parsed = parser.parseDispatch(
      {
        t: 'MESSAGE_CREATE',
        d: {
          id: 'msg-1',
          channel_id: 'channel-1',
          guild_id: 'guild-1',
          content: '<@12345> /pair 654321',
          author: {
            id: 'user-1',
            username: 'alice'
          },
          mentions: [
            {
              id: '12345',
              username: 'deepchat'
            }
          ]
        }
      },
      '12345'
    )

    expect(parsed).toEqual(
      expect.objectContaining({
        kind: 'message',
        chatType: 'channel',
        chatId: 'channel-1',
        senderUserId: 'user-1',
        text: '/pair 654321',
        mentionedBot: true,
        command: {
          name: 'pair',
          args: '654321'
        }
      })
    )
  })

  it('parses slash command interactions into remote commands', () => {
    const parser = new DiscordParser()

    const parsed = parser.parseDispatch({
      t: 'INTERACTION_CREATE',
      d: {
        id: 'interaction-1',
        token: 'interaction-token',
        channel_id: 'dm-1',
        application_id: 'app-1',
        data: {
          name: 'model',
          options: [
            {
              name: 'args',
              value: 'openai gpt-5'
            }
          ]
        },
        user: {
          id: 'user-1',
          username: 'alice'
        }
      }
    })

    expect(parsed).toEqual(
      expect.objectContaining({
        kind: 'interaction',
        chatType: 'dm',
        chatId: 'dm-1',
        interactionId: 'interaction-1',
        interactionToken: 'interaction-token',
        applicationId: 'app-1',
        text: '/model openai gpt-5',
        command: {
          name: 'model',
          args: 'openai gpt-5'
        }
      })
    )
  })
})
