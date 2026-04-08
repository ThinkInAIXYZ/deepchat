import { describe, expect, it, vi } from 'vitest'
import { TelegramApiRequestError } from '@/presenter/remoteControlPresenter/telegram/telegramClient'
import { TelegramPoller } from '@/presenter/remoteControlPresenter/telegram/telegramPoller'
import {
  TELEGRAM_OUTBOUND_TEXT_LIMIT,
  TELEGRAM_STREAM_POLL_INTERVAL_MS
} from '@/presenter/remoteControlPresenter/types'

const createClient = () => {
  let nextMessageId = 100

  return {
    getMe: vi.fn().mockResolvedValue({
      id: 123,
      username: 'deepchat_bot'
    }),
    getUpdates: vi.fn(),
    sendMessage: vi.fn().mockImplementation(async () => nextMessageId++),
    sendMessageDraft: vi.fn().mockResolvedValue(undefined),
    sendChatAction: vi.fn().mockResolvedValue(undefined),
    setMessageReaction: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined)
  }
}

const createBindingStore = () => {
  const deliveryStates = new Map<string, any>()

  return {
    getPollOffset: vi.fn().mockReturnValue(0),
    setPollOffset: vi.fn(),
    getTelegramConfig: vi.fn().mockReturnValue({
      streamMode: 'draft'
    }),
    getRemoteDeliveryState: vi.fn((endpointKey: string) => deliveryStates.get(endpointKey) ?? null),
    rememberRemoteDeliveryState: vi.fn((endpointKey: string, state: any) => {
      deliveryStates.set(endpointKey, {
        ...state,
        segments: state.segments.map((segment: any) => ({
          ...segment,
          messageIds: [...segment.messageIds]
        }))
      })
    }),
    clearRemoteDeliveryState: vi.fn((endpointKey: string) => {
      deliveryStates.delete(endpointKey)
    }),
    createPendingInteractionState: vi.fn().mockReturnValue('pending-token'),
    getEndpointKey: vi.fn().mockReturnValue('telegram:100:0'),
    _getDeliveryState: (endpointKey: string) => deliveryStates.get(endpointKey) ?? null
  }
}

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

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return {
    promise,
    resolve,
    reject
  }
}

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

  it('stops immediately while waiting in transient backoff', async () => {
    vi.useFakeTimers()

    const client = createClient()
    client.getUpdates.mockRejectedValueOnce(new Error('network timeout')).mockImplementation(() => {
      throw new Error('should not poll again after stop')
    })

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
      expect(poller.getStatusSnapshot().state).toBe('backoff')
    })

    await poller.stop()

    expect(client.getUpdates).toHaveBeenCalledTimes(1)
    expect(poller.getStatusSnapshot().state).toBe('stopped')

    vi.useRealTimers()
  })

  it('logs per-update delivery failures, advances offset, and keeps polling', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onFatalError = vi.fn()
    const setPollOffset = vi.fn()
    const client = createClient()
    client.sendMessage.mockRejectedValue(
      new TelegramApiRequestError('Bad Request: chat not found', 400)
    )
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
          replies: ['running']
        })
      } as any,
      bindingStore: {
        getPollOffset: vi.fn().mockReturnValue(0),
        setPollOffset,
        getTelegramConfig: vi.fn().mockReturnValue({
          streamMode: 'draft'
        })
      } as any,
      onFatalError
    })

    await poller.start()

    await vi.waitFor(() => {
      expect(setPollOffset).toHaveBeenCalledWith(2)
      expect(client.sendMessage).toHaveBeenCalled()
      expect(client.getUpdates).toHaveBeenCalledTimes(2)
    })

    expect(setPollOffset.mock.invocationCallOrder[0]).toBeLessThan(
      client.sendMessage.mock.invocationCallOrder[0]
    )
    expect(warnSpy).toHaveBeenCalledWith(
      '[TelegramPoller] Failed to handle update:',
      expect.objectContaining({
        updateId: 1
      })
    )
    expect(poller.getStatusSnapshot().state).toBe('running')
    expect(onFatalError).not.toHaveBeenCalled()

    await poller.stop()
    warnSpy.mockRestore()
  })

  it('sets and clears reactions only for plain-text conversations', async () => {
    const client = createClient()
    const bindingStore = createBindingStore()
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
              completed: true,
              pendingInteraction: null
            })
          }
        })
      } as any,
      bindingStore: bindingStore as any
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

  it('streams answer text beside a persistent trace log', async () => {
    vi.useFakeTimers()

    try {
      const client = createClient()
      const bindingStore = createBindingStore()
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
              getSnapshot: vi
                .fn()
                .mockResolvedValueOnce({
                  messageId: 'msg-1',
                  text: '',
                  traceText: '💻 shell_command: "git status"',
                  deliverySegments: [
                    {
                      key: 'msg-1:0:process',
                      kind: 'process',
                      text: '💻 shell_command: "git status"',
                      sourceMessageId: 'msg-1'
                    }
                  ],
                  statusText: 'Running: thinking...',
                  finalText: '',
                  draftText: '',
                  renderBlocks: [],
                  fullText: '',
                  completed: false,
                  pendingInteraction: null
                })
                .mockResolvedValueOnce({
                  messageId: 'msg-1',
                  text: 'Draft answer',
                  traceText: '💻 shell_command: "git status"',
                  deliverySegments: [
                    {
                      key: 'msg-1:0:process',
                      kind: 'process',
                      text: '💻 shell_command: "git status"',
                      sourceMessageId: 'msg-1'
                    },
                    {
                      key: 'msg-1:1:answer',
                      kind: 'answer',
                      text: 'Draft answer',
                      sourceMessageId: 'msg-1'
                    }
                  ],
                  statusText: 'Running: writing...',
                  finalText: '',
                  draftText: '',
                  renderBlocks: [],
                  fullText: '[Answer]\nDraft answer',
                  completed: false,
                  pendingInteraction: null
                })
                .mockResolvedValue({
                  messageId: 'msg-1',
                  text: 'Draft answer',
                  traceText: '💻 shell_command: "git status"',
                  deliverySegments: [
                    {
                      key: 'msg-1:0:process',
                      kind: 'process',
                      text: '💻 shell_command: "git status"',
                      sourceMessageId: 'msg-1'
                    },
                    {
                      key: 'msg-1:1:answer',
                      kind: 'answer',
                      text: 'Final answer',
                      sourceMessageId: 'msg-1'
                    }
                  ],
                  statusText: 'Running: writing...',
                  finalText: 'Final answer',
                  draftText: '',
                  renderBlocks: [],
                  fullText: '[Answer]\nFinal answer',
                  completed: true,
                  pendingInteraction: null
                })
            }
          })
        } as any,
        bindingStore: bindingStore as any
      })

      await poller.start()

      await vi.waitFor(() => {
        expect(client.sendMessage).toHaveBeenCalledWith(
          {
            chatId: 100,
            messageThreadId: 0
          },
          '💻 shell_command: "git status"'
        )
      })

      await vi.advanceTimersByTimeAsync(TELEGRAM_STREAM_POLL_INTERVAL_MS)

      await vi.waitFor(() => {
        expect(client.sendMessage).toHaveBeenCalledWith(
          {
            chatId: 100,
            messageThreadId: 0
          },
          'Draft answer'
        )
        expect(bindingStore.rememberRemoteDeliveryState).toHaveBeenCalledWith(
          'telegram:100:0',
          expect.objectContaining({
            sourceMessageId: 'msg-1',
            segments: [
              {
                key: 'msg-1:0:process',
                kind: 'process',
                messageIds: [100],
                lastText: '💻 shell_command: "git status"'
              },
              {
                key: 'msg-1:1:answer',
                kind: 'answer',
                messageIds: [101],
                lastText: 'Draft answer'
              }
            ]
          })
        )
      })

      await vi.advanceTimersByTimeAsync(TELEGRAM_STREAM_POLL_INTERVAL_MS)

      await vi.waitFor(() => {
        expect(client.editMessageText).not.toHaveBeenCalledWith(
          expect.objectContaining({
            messageId: 100
          })
        )
        expect(client.editMessageText).toHaveBeenCalledWith({
          target: {
            chatId: 100,
            messageThreadId: 0
          },
          messageId: 101,
          text: 'Final answer',
          replyMarkup: undefined
        })
        expect(bindingStore.clearRemoteDeliveryState).toHaveBeenCalledWith('telegram:100:0')
      })

      await poller.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the latest answer chunk editable when streamed text exceeds the platform limit', async () => {
    vi.useFakeTimers()

    try {
      const client = createClient()
      const bindingStore = createBindingStore()
      const firstText = 'A'.repeat(4_000)
      const expandedText = 'A'.repeat(4_205)

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
              getSnapshot: vi
                .fn()
                .mockResolvedValueOnce({
                  messageId: 'msg-1',
                  text: firstText,
                  traceText: '',
                  statusText: 'Running: writing...',
                  finalText: '',
                  completed: false,
                  pendingInteraction: null
                })
                .mockResolvedValueOnce({
                  messageId: 'msg-1',
                  text: expandedText,
                  traceText: '',
                  statusText: 'Running: writing...',
                  finalText: '',
                  completed: false,
                  pendingInteraction: null
                })
                .mockResolvedValue({
                  messageId: 'msg-1',
                  text: expandedText,
                  traceText: '',
                  statusText: 'Running: writing...',
                  finalText: expandedText,
                  completed: true,
                  pendingInteraction: null
                })
            }
          })
        } as any,
        bindingStore: bindingStore as any
      })

      await poller.start()

      await vi.waitFor(() => {
        expect(client.sendMessage).toHaveBeenCalledWith(
          {
            chatId: 100,
            messageThreadId: 0
          },
          firstText
        )
      })

      await vi.advanceTimersByTimeAsync(TELEGRAM_STREAM_POLL_INTERVAL_MS)

      await vi.waitFor(() => {
        expect(client.editMessageText).toHaveBeenCalledWith({
          target: {
            chatId: 100,
            messageThreadId: 0
          },
          messageId: 100,
          text: 'A'.repeat(4_096),
          replyMarkup: undefined
        })
        expect(client.sendMessage).toHaveBeenCalledWith(
          {
            chatId: 100,
            messageThreadId: 0
          },
          'A'.repeat(109)
        )
      })

      await vi.advanceTimersByTimeAsync(TELEGRAM_STREAM_POLL_INTERVAL_MS)

      await vi.waitFor(() => {
        expect(client.deleteMessage).not.toHaveBeenCalled()
      })

      await poller.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves null messageId holes from stored delivery state so edits stay aligned', async () => {
    vi.useFakeTimers()

    try {
      const client = createClient()
      const bindingStore = createBindingStore()
      const firstChunk = 'A'.repeat(TELEGRAM_OUTBOUND_TEXT_LIMIT)
      const changedMiddleChunk = 'D'.repeat(TELEGRAM_OUTBOUND_TEXT_LIMIT)
      const initialText =
        firstChunk +
        ' ' +
        'B'.repeat(TELEGRAM_OUTBOUND_TEXT_LIMIT) +
        ' ' +
        'C'.repeat(TELEGRAM_OUTBOUND_TEXT_LIMIT)
      const updatedText =
        firstChunk + ' ' + changedMiddleChunk + ' ' + 'C'.repeat(TELEGRAM_OUTBOUND_TEXT_LIMIT)

      bindingStore.rememberRemoteDeliveryState('telegram:100:0', {
        sourceMessageId: 'msg-1',
        segments: [
          {
            key: 'msg-1:0:answer',
            kind: 'answer',
            messageIds: [100, null, 102],
            lastText: initialText
          }
        ]
      })

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
                text: updatedText,
                traceText: '',
                deliverySegments: [
                  {
                    key: 'msg-1:0:answer',
                    kind: 'answer',
                    text: updatedText,
                    sourceMessageId: 'msg-1'
                  }
                ],
                statusText: 'Running: writing...',
                finalText: updatedText,
                completed: true,
                pendingInteraction: null
              })
            }
          })
        } as any,
        bindingStore: bindingStore as any
      })

      await poller.start()

      await vi.waitFor(() => {
        expect(client.editMessageText).not.toHaveBeenCalledWith(
          expect.objectContaining({
            messageId: 102,
            text: changedMiddleChunk
          })
        )
      })

      await poller.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('appends terminal text after a partial answer when the final state differs', async () => {
    vi.useFakeTimers()

    try {
      const client = createClient()
      const bindingStore = createBindingStore()

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
              getSnapshot: vi
                .fn()
                .mockResolvedValueOnce({
                  messageId: 'msg-1',
                  text: 'Partial answer',
                  traceText: '',
                  deliverySegments: [
                    {
                      key: 'msg-1:0:answer',
                      kind: 'answer',
                      text: 'Partial answer',
                      sourceMessageId: 'msg-1'
                    }
                  ],
                  statusText: 'Running: writing...',
                  finalText: '',
                  completed: false,
                  pendingInteraction: null
                })
                .mockResolvedValue({
                  messageId: 'msg-1',
                  text: 'Partial answer',
                  traceText: '',
                  deliverySegments: [
                    {
                      key: 'msg-1:0:answer',
                      kind: 'answer',
                      text: 'Partial answer',
                      sourceMessageId: 'msg-1'
                    }
                  ],
                  statusText: 'Running: writing...',
                  finalText: 'The conversation ended with an error.',
                  completed: true,
                  pendingInteraction: null
                })
            }
          })
        } as any,
        bindingStore: bindingStore as any
      })

      await poller.start()

      await vi.waitFor(() => {
        expect(client.sendMessage).toHaveBeenCalledWith(
          {
            chatId: 100,
            messageThreadId: 0
          },
          'Partial answer'
        )
      })

      await vi.advanceTimersByTimeAsync(TELEGRAM_STREAM_POLL_INTERVAL_MS)

      await vi.waitFor(() => {
        expect(client.sendMessage).toHaveBeenCalledWith(
          {
            chatId: 100,
            messageThreadId: 0
          },
          'The conversation ended with an error.'
        )
        expect(client.editMessageText).not.toHaveBeenCalledWith(
          expect.objectContaining({
            messageId: 100,
            text: 'The conversation ended with an error.'
          })
        )
      })

      await poller.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not append a terminal segment when the latest answer already matches after a process segment', async () => {
    vi.useFakeTimers()

    try {
      const client = createClient()
      const bindingStore = createBindingStore()

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
              getSnapshot: vi.fn().mockResolvedValueOnce({
                messageId: 'msg-1',
                text: 'Final answer',
                traceText: '',
                deliverySegments: [
                  {
                    key: 'msg-1:0:answer',
                    kind: 'answer',
                    text: 'Final answer',
                    sourceMessageId: 'msg-1'
                  },
                  {
                    key: 'msg-1:1:process',
                    kind: 'process',
                    text: '💻 shell_command: "git status"',
                    sourceMessageId: 'msg-1'
                  }
                ],
                statusText: 'Running: processing tool results...',
                finalText: 'Final answer',
                completed: true,
                pendingInteraction: null
              })
            }
          })
        } as any,
        bindingStore: bindingStore as any
      })

      await poller.start()

      await vi.waitFor(() => {
        expect(client.sendMessage).toHaveBeenCalledWith(
          {
            chatId: 100,
            messageThreadId: 0
          },
          'Final answer'
        )
        expect(client.sendMessage).toHaveBeenCalledWith(
          {
            chatId: 100,
            messageThreadId: 0
          },
          '💻 shell_command: "git status"'
        )
      })

      expect(client.sendMessage).not.toHaveBeenCalledWith(
        {
          chatId: 100,
          messageThreadId: 0
        },
        'Final answer',
        expect.anything()
      )
      expect(
        client.sendMessage.mock.calls.filter(([, text]) => text === 'Final answer')
      ).toHaveLength(1)

      await poller.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('appends later process and answer segments in DeepChat order instead of rewriting the first answer', async () => {
    vi.useFakeTimers()

    try {
      const client = createClient()
      const bindingStore = createBindingStore()

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
              getSnapshot: vi
                .fn()
                .mockResolvedValueOnce({
                  messageId: 'msg-1',
                  text: 'Let me inspect these files.',
                  traceText: '',
                  deliverySegments: [
                    {
                      key: 'msg-1:0:answer',
                      kind: 'answer',
                      text: 'Let me inspect these files.',
                      sourceMessageId: 'msg-1'
                    }
                  ],
                  statusText: 'Running: writing...',
                  finalText: '',
                  completed: false,
                  pendingInteraction: null
                })
                .mockResolvedValueOnce({
                  messageId: 'msg-1',
                  text: 'Let me inspect these files.',
                  traceText: '',
                  deliverySegments: [
                    {
                      key: 'msg-1:0:answer',
                      kind: 'answer',
                      text: 'Let me inspect these files.',
                      sourceMessageId: 'msg-1'
                    },
                    {
                      key: 'msg-1:1:process',
                      kind: 'process',
                      text: '📖 read_file: "/tmp/report.md"',
                      sourceMessageId: 'msg-1'
                    }
                  ],
                  statusText: 'Running: calling read_file...',
                  finalText: '',
                  completed: false,
                  pendingInteraction: null
                })
                .mockResolvedValue({
                  messageId: 'msg-1',
                  text: 'Summary ready.',
                  traceText: '',
                  deliverySegments: [
                    {
                      key: 'msg-1:0:answer',
                      kind: 'answer',
                      text: 'Let me inspect these files.',
                      sourceMessageId: 'msg-1'
                    },
                    {
                      key: 'msg-1:1:process',
                      kind: 'process',
                      text: '📖 read_file: "/tmp/report.md"',
                      sourceMessageId: 'msg-1'
                    },
                    {
                      key: 'msg-1:2:answer',
                      kind: 'answer',
                      text: 'Summary ready.',
                      sourceMessageId: 'msg-1'
                    }
                  ],
                  statusText: 'Running: writing...',
                  finalText: 'Summary ready.',
                  completed: true,
                  pendingInteraction: null
                })
            }
          })
        } as any,
        bindingStore: bindingStore as any
      })

      await poller.start()

      await vi.waitFor(() => {
        expect(client.sendMessage).toHaveBeenCalledWith(
          {
            chatId: 100,
            messageThreadId: 0
          },
          'Let me inspect these files.'
        )
      })

      await vi.advanceTimersByTimeAsync(TELEGRAM_STREAM_POLL_INTERVAL_MS)

      await vi.waitFor(() => {
        expect(client.sendMessage).toHaveBeenCalledWith(
          {
            chatId: 100,
            messageThreadId: 0
          },
          '📖 read_file: "/tmp/report.md"'
        )
      })

      await vi.advanceTimersByTimeAsync(TELEGRAM_STREAM_POLL_INTERVAL_MS)

      await vi.waitFor(() => {
        expect(client.sendMessage).toHaveBeenCalledWith(
          {
            chatId: 100,
            messageThreadId: 0
          },
          'Summary ready.'
        )
        expect(client.editMessageText).not.toHaveBeenCalledWith(
          expect.objectContaining({
            messageId: 100,
            text: 'Summary ready.'
          })
        )
        expect(bindingStore.clearRemoteDeliveryState).toHaveBeenCalledWith('telegram:100:0')
      })

      await poller.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps tool-only turns as trace-only without appending the no-response fallback', async () => {
    vi.useFakeTimers()

    try {
      const client = createClient()
      const bindingStore = createBindingStore()

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
                text: '',
                traceText: '📖 read_file: "/tmp/report.md"',
                statusText: 'Running: calling read_file...',
                finalText: 'No assistant response was produced.',
                renderBlocks: [],
                completed: true,
                pendingInteraction: null
              })
            }
          })
        } as any,
        bindingStore: bindingStore as any
      })

      await poller.start()

      await vi.waitFor(() => {
        expect(client.sendMessage).toHaveBeenCalledTimes(1)
        expect(client.sendMessage).toHaveBeenCalledWith(
          {
            chatId: 100,
            messageThreadId: 0
          },
          '📖 read_file: "/tmp/report.md"'
        )
        expect(bindingStore.clearRemoteDeliveryState).toHaveBeenCalledWith('telegram:100:0')
      })

      await poller.stop()
    } finally {
      vi.useRealTimers()
    }
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

  it('sends pending interaction prompts after completed conversation output', async () => {
    const client = createClient()
    const bindingStore = createBindingStore()
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
              text: 'Partial answer',
              statusText: 'Waiting for your response...',
              finalText: '',
              completed: true,
              pendingInteraction: {
                type: 'permission',
                messageId: 'msg-1',
                toolCallId: 'tool-1',
                toolName: 'shell_command',
                toolArgs: '{"command":"git push"}',
                permission: {
                  permissionType: 'command',
                  description: 'Run git push',
                  command: 'git push'
                }
              }
            })
          }
        })
      } as any,
      bindingStore: bindingStore as any
    })

    await poller.start()

    await vi.waitFor(() => {
      expect(client.sendMessage).toHaveBeenNthCalledWith(
        1,
        {
          chatId: 100,
          messageThreadId: 0
        },
        'Partial answer'
      )
      expect(client.sendMessage).toHaveBeenNthCalledWith(
        2,
        {
          chatId: 100,
          messageThreadId: 0
        },
        expect.stringContaining('Permission Required'),
        expect.objectContaining({
          inline_keyboard: expect.any(Array)
        })
      )
    })

    await poller.stop()
  })

  it('edits pending interaction cards before deferred continuation finishes', async () => {
    const client = createClient()
    const bindingStore = createBindingStore()
    const deferred = createDeferred<{
      conversation?: {
        sessionId: string
        eventId: string
        getSnapshot: () => Promise<{
          messageId: string | null
          text: string
          statusText?: string
          finalText?: string
          completed: boolean
          pendingInteraction: null
        }>
      }
    }>()
    client.getUpdates
      .mockResolvedValueOnce([
        {
          update_id: 2,
          callback_query: {
            id: 'callback-1',
            from: {
              id: 123
            },
            data: 'pending:token:allow',
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
          data: 'pending:token:allow'
        })
      } as any,
      router: {
        handleMessage: vi.fn().mockResolvedValue({
          replies: [],
          outboundActions: [
            {
              type: 'editMessageText',
              messageId: 30,
              text: 'Permission handled.\nApproved. Continuing...',
              replyMarkup: null
            }
          ],
          callbackAnswer: {
            text: 'Continuing...'
          },
          deferred: deferred.promise
        })
      } as any,
      bindingStore: bindingStore as any
    })

    await poller.start()

    await vi.waitFor(() => {
      expect(client.editMessageText).toHaveBeenCalledWith({
        target: {
          chatId: 100,
          messageThreadId: 0
        },
        messageId: 30,
        text: 'Permission handled.\nApproved. Continuing...',
        replyMarkup: undefined
      })
    })

    expect(client.sendMessage).not.toHaveBeenCalled()

    deferred.resolve({
      conversation: {
        sessionId: 'session-1',
        eventId: 'msg-1',
        getSnapshot: vi.fn().mockResolvedValue({
          messageId: 'msg-1',
          text: 'Done',
          finalText: 'Done',
          completed: true,
          pendingInteraction: null
        })
      }
    })

    await vi.waitFor(() => {
      expect(client.sendMessage).toHaveBeenCalledWith(
        {
          chatId: 100,
          messageThreadId: 0
        },
        'Done'
      )
    })

    await poller.stop()
  })

  it('stops without waiting for unresolved deferred route continuations', async () => {
    const client = createClient()
    const deferred = createDeferred<{
      conversation?: {
        sessionId: string
        eventId: string
        getSnapshot: () => Promise<{
          messageId: string | null
          text: string
          completed: boolean
          pendingInteraction: null
        }>
      }
    }>()
    client.getUpdates
      .mockResolvedValueOnce([
        {
          update_id: 2,
          callback_query: {
            id: 'callback-1',
            from: {
              id: 123
            },
            data: 'pending:token:allow',
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
          data: 'pending:token:allow'
        })
      } as any,
      router: {
        handleMessage: vi.fn().mockResolvedValue({
          replies: [],
          outboundActions: [
            {
              type: 'editMessageText',
              messageId: 30,
              text: 'Permission handled.\nApproved. Continuing...',
              replyMarkup: null
            }
          ],
          callbackAnswer: {
            text: 'Continuing...'
          },
          deferred: deferred.promise
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
      expect(client.editMessageText).toHaveBeenCalled()
    })

    await expect(
      Promise.race([
        poller.stop().then(() => 'stopped'),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 50))
      ])
    ).resolves.toBe('stopped')
  })
})
