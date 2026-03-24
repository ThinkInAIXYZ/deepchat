import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelegramClient } from '@/presenter/remoteControlPresenter/telegram/telegramClient'

describe('TelegramClient', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          result: true
        })
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends inline keyboard payloads with sendMessage', async () => {
    const client = new TelegramClient('token')

    await client.sendMessage(
      {
        chatId: 100,
        messageThreadId: 0
      },
      'Choose a provider',
      {
        inline_keyboard: [
          [
            {
              text: 'OpenAI',
              callback_data: 'model:menu-token:p:0'
            }
          ]
        ]
      }
    )

    const fetchCall = vi.mocked(fetch).mock.calls[0]
    expect(fetchCall[0]).toContain('/sendMessage')
    expect(JSON.parse(fetchCall[1]!.body as string)).toEqual({
      chat_id: 100,
      message_thread_id: undefined,
      text: 'Choose a provider',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'OpenAI',
              callback_data: 'model:menu-token:p:0'
            }
          ]
        ]
      }
    })
  })

  it('clears inline keyboards through editMessageReplyMarkup', async () => {
    const client = new TelegramClient('token')

    await client.editMessageReplyMarkup({
      target: {
        chatId: 100,
        messageThreadId: 0
      },
      messageId: 30,
      replyMarkup: null
    })

    const fetchCall = vi.mocked(fetch).mock.calls[0]
    expect(fetchCall[0]).toContain('/editMessageReplyMarkup')
    expect(JSON.parse(fetchCall[1]!.body as string)).toEqual({
      chat_id: 100,
      message_id: 30,
      reply_markup: {
        inline_keyboard: []
      }
    })
  })

  it('answers callback queries with alert text', async () => {
    const client = new TelegramClient('token')

    await client.answerCallbackQuery({
      callbackQueryId: 'callback-1',
      text: 'Model switched.',
      showAlert: true
    })

    const fetchCall = vi.mocked(fetch).mock.calls[0]
    expect(fetchCall[0]).toContain('/answerCallbackQuery')
    expect(JSON.parse(fetchCall[1]!.body as string)).toEqual({
      callback_query_id: 'callback-1',
      text: 'Model switched.',
      show_alert: true
    })
  })

  it('clears reactions by sending an empty reaction list', async () => {
    const client = new TelegramClient('token')

    await client.setMessageReaction({
      chatId: 100,
      messageId: 20,
      emoji: null
    })

    const fetchCall = vi.mocked(fetch).mock.calls[0]
    expect(fetchCall[0]).toContain('/setMessageReaction')
    expect(JSON.parse(fetchCall[1]!.body as string)).toEqual({
      chat_id: 100,
      message_id: 20,
      reaction: []
    })
  })
})
