import { describe, expect, it, vi } from 'vitest'
import { TelegramApiRequestError } from '@/presenter/remoteControlPresenter/telegram/telegramClient'
import { TelegramPoller } from '@/presenter/remoteControlPresenter/telegram/telegramPoller'

const createClient = () => ({
  getMe: vi.fn().mockResolvedValue({
    id: 123,
    username: 'deepchat_bot'
  }),
  getUpdates: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  sendMessageDraft: vi.fn().mockResolvedValue(undefined),
  sendChatAction: vi.fn().mockResolvedValue(undefined),
  setMessageReaction: vi.fn().mockResolvedValue(undefined),
  answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  editMessageText: vi.fn().mockResolvedValue(undefined),
  editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined)
})

const createBlockingUpdates =
  () =>
  ({ signal }: { signal?: AbortSignal }) =>
    new Promise((_, reject) => {
      signal?.addEventListener(
        'abort',
        () => {
          reject(new Error('aborted'))
        },
        { once: true }
      )
    })

describe('TelegramPoller', () => {
  it('reports running while waiting on long polling', async () => {
    const client = createClient()
    client.getUpdates.mockImplementation(createBlockingUpdates())

    const poller = new TelegramPoller({
      client: client as any,
      parser: {
        parseUpdate: vi.fn()
      } as any,
      router: {} as any,
      bindingStore: {
        getPollOffset: vi.fn().mockReturnValue(0),
        setPollOffset: vi.fn(),
        getTelegramConfig: vi.fn().mockReturnValue({
          streamMode: 'draft'
        })
      } as any
    })

    await poller.start()

    await vi.waitFor(() => {
      expect(poller.getStatusSnapshot().state).toBe('running')
    })

    await poller.stop()
  })

  it('stops retrying and reports error on Telegram 409 conflict', async () => {
    const onFatalError = vi.fn()
    const client = createClient()
    client.getUpdates.mockRejectedValue(
      new TelegramApiRequestError(
        'Conflict: terminated by other getUpdates request; make sure that only one bot instance is running',
        409
      )
    )

    const poller = new TelegramPoller({
      client: client as any,
      parser: {
        parseUpdate: vi.fn()
      } as any,
      router: {} as any,
      bindingStore: {
        getPollOffset: vi.fn().mockReturnValue(0),
        setPollOffset: vi.fn(),
        getTelegramConfig: vi.fn().mockReturnValue({
          streamMode: 'draft'
        })
      } as any,
      onFatalError
    })

    await poller.start()

    await vi.waitFor(() => {
      expect(poller.getStatusSnapshot().state).toBe('error')
    })

    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(client.getUpdates).toHaveBeenCalledTimes(1)
    expect(poller.getStatusSnapshot().lastError).toContain('terminated by other getUpdates request')
    expect(onFatalError).toHaveBeenCalledWith(
      expect.stringContaining('terminated by other getUpdates request')
    )
  })

  it('keeps retrying transient failures without auto-disable callback', async () => {
    vi.useFakeTimers()

    const onFatalError = vi.fn()
    const client = createClient()
    client.getUpdates
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockImplementation(createBlockingUpdates())

    const poller = new TelegramPoller({
      client: client as any,
      parser: {
        parseUpdate: vi.fn()
      } as any,
      router: {} as any,
      bindingStore: {
        getPollOffset: vi.fn().mockReturnValue(0),
        setPollOffset: vi.fn(),
        getTelegramConfig: vi.fn().mockReturnValue({
          streamMode: 'draft'
        })
      } as any,
      onFatalError
    })

    await poller.start()

    await vi.waitFor(() => {
      expect(poller.getStatusSnapshot().state).toBe('backoff')
    })

    await vi.advanceTimersByTimeAsync(1_000)

    await vi.waitFor(() => {
      expect(client.getUpdates).toHaveBeenCalledTimes(2)
      expect(poller.getStatusSnapshot().state).toBe('running')
    })

    expect(onFatalError).not.toHaveBeenCalled()

    await poller.stop()
    vi.useRealTimers()
  })

  it('sets and clears reactions only for plain-text conversations', async () => {
    const client = createClient()
    client.getUpdates
      .mockResolvedValueOnce([
        {
          update_id: 1,
          message: {
            message_id: 20,
            chat: {
              id: 100,
              type: 'private'
            },
            from: {
              id: 123
            },
            text: 'hello'
          }
        }
      ])
      .mockImplementation(createBlockingUpdates())

    const poller = new TelegramPoller({
      client: client as any,
      parser: {
        parseUpdate: vi.fn().mockReturnValue({
          kind: 'message',
          updateId: 1,
          chatId: 100,
          messageThreadId: 0,
          messageId: 20,
          chatType: 'private',
          fromId: 123,
          text: 'hello',
          command: null
        })
      } as any,
      router: {
        handleMessage: vi.fn().mockResolvedValue({
          replies: [],
          conversation: {
            sessionId: 'session-1',
            eventId: 'msg-1',
            getSnapshot: vi.fn().mockResolvedValue({
              messageId: 'msg-1',
              text: 'pong',
              completed: true
            })
          }
        })
      } as any,
      bindingStore: {
        getPollOffset: vi.fn().mockReturnValue(0),
        setPollOffset: vi.fn(),
        getTelegramConfig: vi.fn().mockReturnValue({
          streamMode: 'draft'
        })
      } as any
    })

    await poller.start()

    await vi.waitFor(() => {
      expect(client.setMessageReaction).toHaveBeenNthCalledWith(1, {
        chatId: 100,
        messageId: 20,
        emoji: '🤯'
      })
      expect(client.sendMessage).toHaveBeenCalledWith(
        {
          chatId: 100,
          messageThreadId: 0
        },
        'pong'
      )
      expect(client.setMessageReaction).toHaveBeenNthCalledWith(2, {
        chatId: 100,
        messageId: 20,
        emoji: null
      })
    })

    await poller.stop()
  })

  it('does not react to command messages', async () => {
    const client = createClient()
    client.getUpdates
      .mockResolvedValueOnce([
        {
          update_id: 1,
          message: {
            message_id: 20,
            chat: {
              id: 100,
              type: 'private'
            },
            from: {
              id: 123
            },
            text: '/status'
          }
        }
      ])
      .mockImplementation(createBlockingUpdates())

    const poller = new TelegramPoller({
      client: client as any,
      parser: {
        parseUpdate: vi.fn().mockReturnValue({
          kind: 'message',
          updateId: 1,
          chatId: 100,
          messageThreadId: 0,
          messageId: 20,
          chatType: 'private',
          fromId: 123,
          text: '/status',
          command: {
            name: 'status',
            args: ''
          }
        })
      } as any,
      router: {
        handleMessage: vi.fn().mockResolvedValue({
          replies: ['running']
        })
      } as any,
      bindingStore: {
        getPollOffset: vi.fn().mockReturnValue(0),
        setPollOffset: vi.fn(),
        getTelegramConfig: vi.fn().mockReturnValue({
          streamMode: 'draft'
        })
      } as any
    })

    await poller.start()

    await vi.waitFor(() => {
      expect(client.sendMessage).toHaveBeenCalledWith(
        {
          chatId: 100,
          messageThreadId: 0
        },
        'running'
      )
    })

    expect(client.setMessageReaction).not.toHaveBeenCalled()
    await poller.stop()
  })

  it('answers callback queries and edits menu messages without setting reactions', async () => {
    const client = createClient()
    client.getUpdates
      .mockResolvedValueOnce([
        {
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
        }
      ])
      .mockImplementation(createBlockingUpdates())

    const poller = new TelegramPoller({
      client: client as any,
      parser: {
        parseUpdate: vi.fn().mockReturnValue({
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
      } as any,
      router: {
        handleMessage: vi.fn().mockResolvedValue({
          replies: [],
          outboundActions: [
            {
              type: 'editMessageText',
              messageId: 30,
              text: 'Choose a model:',
              replyMarkup: {
                inline_keyboard: [
                  [
                    {
                      text: 'GPT-5',
                      callback_data: 'model:menu-token:m:0:0'
                    }
                  ]
                ]
              }
            }
          ],
          callbackAnswer: {
            text: 'Choose a model'
          }
        })
      } as any,
      bindingStore: {
        getPollOffset: vi.fn().mockReturnValue(0),
        setPollOffset: vi.fn(),
        getTelegramConfig: vi.fn().mockReturnValue({
          streamMode: 'draft'
        })
      } as any
    })

    await poller.start()

    await vi.waitFor(() => {
      expect(client.answerCallbackQuery).toHaveBeenCalledWith({
        callbackQueryId: 'callback-1',
        text: 'Choose a model',
        showAlert: undefined
      })
      expect(client.editMessageText).toHaveBeenCalledWith({
        target: {
          chatId: 100,
          messageThreadId: 0
        },
        messageId: 30,
        text: 'Choose a model:',
        replyMarkup: {
          inline_keyboard: [
            [
              {
                text: 'GPT-5',
                callback_data: 'model:menu-token:m:0:0'
              }
            ]
          ]
        }
      })
    })

    expect(client.setMessageReaction).not.toHaveBeenCalled()
    await poller.stop()
  })

  it('acknowledges slow callback queries before routing finishes', async () => {
    vi.useFakeTimers()

    const client = createClient()
    client.getUpdates
      .mockResolvedValueOnce([
        {
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
        }
      ])
      .mockImplementation(createBlockingUpdates())

    let resolveRoute: ((value: any) => void) | null = null
    const routePromise = new Promise((resolve) => {
      resolveRoute = resolve
    })

    const poller = new TelegramPoller({
      client: client as any,
      parser: {
        parseUpdate: vi.fn().mockReturnValue({
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
      } as any,
      router: {
        handleMessage: vi.fn().mockReturnValue(routePromise)
      } as any,
      bindingStore: {
        getPollOffset: vi.fn().mockReturnValue(0),
        setPollOffset: vi.fn(),
        getTelegramConfig: vi.fn().mockReturnValue({
          streamMode: 'draft'
        })
      } as any
    })

    await poller.start()
    await vi.advanceTimersByTimeAsync(500)

    expect(client.answerCallbackQuery).toHaveBeenCalledWith({
      callbackQueryId: 'callback-1',
      text: undefined,
      showAlert: undefined
    })

    resolveRoute?.({
      replies: [],
      outboundActions: [
        {
          type: 'editMessageText',
          messageId: 30,
          text: 'Choose a model:',
          replyMarkup: {
            inline_keyboard: [
              [
                {
                  text: 'GPT-5',
                  callback_data: 'model:menu-token:m:0:0'
                }
              ]
            ]
          }
        }
      ],
      callbackAnswer: {
        text: 'Choose a model'
      }
    })

    await vi.runAllTicks()
    await vi.waitFor(() => {
      expect(client.editMessageText).toHaveBeenCalled()
    })

    expect(client.answerCallbackQuery).toHaveBeenCalledTimes(1)

    await poller.stop()
    vi.useRealTimers()
  })

  it('ignores expired callback query and not-modified edit errors', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = createClient()
    client.answerCallbackQuery.mockRejectedValue(
      new TelegramApiRequestError(
        'Bad Request: query is too old and response timeout expired or query ID is invalid',
        400
      )
    )
    client.editMessageText.mockRejectedValue(
      new TelegramApiRequestError(
        'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message',
        400
      )
    )
    client.getUpdates
      .mockResolvedValueOnce([
        {
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
        }
      ])
      .mockImplementation(createBlockingUpdates())

    const poller = new TelegramPoller({
      client: client as any,
      parser: {
        parseUpdate: vi.fn().mockReturnValue({
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
      } as any,
      router: {
        handleMessage: vi.fn().mockResolvedValue({
          replies: [],
          outboundActions: [
            {
              type: 'editMessageText',
              messageId: 30,
              text: 'Choose a model:',
              replyMarkup: {
                inline_keyboard: [
                  [
                    {
                      text: 'GPT-5',
                      callback_data: 'model:menu-token:m:0:0'
                    }
                  ]
                ]
              }
            }
          ],
          callbackAnswer: {
            text: 'Choose a model'
          }
        })
      } as any,
      bindingStore: {
        getPollOffset: vi.fn().mockReturnValue(0),
        setPollOffset: vi.fn(),
        getTelegramConfig: vi.fn().mockReturnValue({
          streamMode: 'draft'
        })
      } as any
    })

    await poller.start()

    await vi.waitFor(() => {
      expect(client.answerCallbackQuery).toHaveBeenCalled()
      expect(client.editMessageText).toHaveBeenCalled()
    })

    expect(warnSpy).not.toHaveBeenCalledWith(
      '[TelegramPoller] Failed to answer callback query:',
      expect.anything()
    )

    await poller.stop()
    warnSpy.mockRestore()
  })
})
