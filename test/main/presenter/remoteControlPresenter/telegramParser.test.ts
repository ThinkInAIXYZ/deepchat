import { describe, expect, it } from 'vitest'
import { TelegramParser } from '@/presenter/remoteControlPresenter/telegram/telegramParser'

describe('TelegramParser', () => {
  it('parses text messages and commands', () => {
    const parser = new TelegramParser()

    const parsed = parser.parseUpdate({
      update_id: 1,
      message: {
        message_id: 20,
        message_thread_id: 7,
        chat: {
          id: 100,
          type: 'private'
        },
        from: {
          id: 123
        },
        text: '/use 2'
      }
    })

    expect(parsed).toEqual({
      kind: 'message',
      updateId: 1,
      chatId: 100,
      messageThreadId: 7,
      messageId: 20,
      chatType: 'private',
      fromId: 123,
      text: '/use 2',
      command: {
        name: 'use',
        args: '2'
      }
    })
  })

  it('parses callback queries from inline keyboards', () => {
    const parser = new TelegramParser()

    const parsed = parser.parseUpdate({
      update_id: 2,
      callback_query: {
        id: 'callback-1',
        from: {
          id: 123
        },
        data: 'model:menu-token:p:0',
        message: {
          message_id: 30,
          chat: {
            id: 100,
            type: 'private'
          }
        }
      }
    })

    expect(parsed).toEqual({
      kind: 'callback_query',
      updateId: 2,
      chatId: 100,
      messageThreadId: 0,
      messageId: 30,
      chatType: 'private',
      fromId: 123,
      callbackQueryId: 'callback-1',
      data: 'model:menu-token:p:0'
    })
  })
})
