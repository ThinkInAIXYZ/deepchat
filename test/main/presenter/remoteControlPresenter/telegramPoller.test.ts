import { describe, expect, it, vi } from 'vitest'
import { TelegramApiRequestError } from '@/presenter/remoteControlPresenter/telegram/telegramClient'
import { TelegramPoller } from '@/presenter/remoteControlPresenter/telegram/telegramPoller'

describe('TelegramPoller', () => {
  it('reports running while waiting on long polling', async () => {
    const client = {
      getMe: vi.fn().mockResolvedValue({
        id: 123,
        username: 'deepchat_bot'
      }),
      getUpdates: vi.fn().mockImplementation(({ signal }: { signal?: AbortSignal }) => {
        return new Promise((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              reject(new Error('aborted'))
            },
            { once: true }
          )
        })
      }),
      sendMessage: vi.fn(),
      sendMessageDraft: vi.fn(),
      sendChatAction: vi.fn(),
      setMessageReaction: vi.fn()
    }

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
    const client = {
      getMe: vi.fn().mockResolvedValue({
        id: 123,
        username: 'deepchat_bot'
      }),
      getUpdates: vi
        .fn()
        .mockRejectedValue(
          new TelegramApiRequestError(
            'Conflict: terminated by other getUpdates request; make sure that only one bot instance is running',
            409
          )
        ),
      sendMessage: vi.fn(),
      sendMessageDraft: vi.fn(),
      sendChatAction: vi.fn(),
      setMessageReaction: vi.fn()
    }

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
    const client = {
      getMe: vi.fn().mockResolvedValue({
        id: 123,
        username: 'deepchat_bot'
      }),
      getUpdates: vi
        .fn()
        .mockRejectedValueOnce(new Error('network timeout'))
        .mockImplementation(({ signal }: { signal?: AbortSignal }) => {
          return new Promise((_, reject) => {
            signal?.addEventListener(
              'abort',
              () => {
                reject(new Error('aborted'))
              },
              { once: true }
            )
          })
        }),
      sendMessage: vi.fn(),
      sendMessageDraft: vi.fn(),
      sendChatAction: vi.fn(),
      setMessageReaction: vi.fn()
    }

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

  it('reacts to incoming messages without blocking replies when the reaction call fails', async () => {
    const client = {
      getMe: vi.fn().mockResolvedValue({
        id: 123,
        username: 'deepchat_bot'
      }),
      getUpdates: vi
        .fn()
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
        .mockImplementation(({ signal }: { signal?: AbortSignal }) => {
          return new Promise((_, reject) => {
            signal?.addEventListener(
              'abort',
              () => {
                reject(new Error('aborted'))
              },
              { once: true }
            )
          })
        }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      sendMessageDraft: vi.fn().mockResolvedValue(undefined),
      sendChatAction: vi.fn().mockResolvedValue(undefined),
      setMessageReaction: vi.fn().mockRejectedValue(new Error('reaction failed'))
    }

    const poller = new TelegramPoller({
      client: client as any,
      parser: {
        parseUpdate: vi.fn().mockReturnValue({
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
          replies: ['pong']
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
      expect(client.setMessageReaction).toHaveBeenCalledWith({
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
    })

    await poller.stop()
  })
})
