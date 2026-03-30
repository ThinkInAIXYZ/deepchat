import { describe, expect, it, vi } from 'vitest'
import { FeishuRuntime } from '@/presenter/remoteControlPresenter/feishu/feishuRuntime'
import {
  FEISHU_CONVERSATION_POLL_TIMEOUT_MS,
  TELEGRAM_STREAM_POLL_INTERVAL_MS,
  type FeishuInboundMessage
} from '@/presenter/remoteControlPresenter/types'

const createParsedMessage = (
  overrides: Partial<FeishuInboundMessage> = {}
): FeishuInboundMessage => ({
  kind: 'message' as const,
  eventId: 'evt-1',
  chatId: 'oc_1',
  threadId: null,
  messageId: 'om_1',
  chatType: 'p2p' as const,
  senderOpenId: 'ou_user',
  text: 'hello',
  command: null,
  mentionedBot: false,
  mentions: [],
  ...overrides
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

const createHarness = async (options?: { logger?: { error: (...params: unknown[]) => void } }) => {
  let onMessage: ((event: unknown) => Promise<void>) | null = null
  const streamHandlers: Array<(event: unknown) => Promise<void>> = []
  const client = {
    probeBot: vi.fn().mockResolvedValue({
      openId: 'ou_bot',
      name: 'DeepChat Bot'
    }),
    startMessageStream: vi
      .fn()
      .mockImplementation(async (params: { onMessage: (event: unknown) => Promise<void> }) => {
        onMessage = params.onMessage
        streamHandlers.push(params.onMessage)
      }),
    stop: vi.fn(),
    sendText: vi.fn().mockResolvedValue(undefined),
    sendCard: vi.fn().mockResolvedValue(undefined)
  }
  const parser = {
    parseEvent: vi.fn((event: { parsed?: FeishuInboundMessage | null }) => event.parsed ?? null)
  }
  const router = {
    handleMessage: vi.fn().mockResolvedValue({
      replies: []
    })
  }

  const runtime = new FeishuRuntime({
    client: client as any,
    parser: parser as any,
    router: router as any,
    logger: options?.logger
  })
  await runtime.start()

  return {
    runtime,
    client,
    parser,
    router,
    onMessage: onMessage!,
    emitMessage: async (event: unknown) => {
      await onMessage?.(event)
    },
    getStreamHandlers: () => [...streamHandlers]
  }
}

describe('FeishuRuntime', () => {
  it('delivers completed render blocks incrementally before the conversation finishes', async () => {
    vi.useFakeTimers()

    try {
      const reasoningBlock = {
        key: 'msg-1:0:reasoning',
        kind: 'reasoning' as const,
        text: '[Reasoning]\nThinking',
        truncated: false,
        sourceMessageId: 'msg-1'
      }
      const answerBlock = {
        key: 'msg-1:1:answer',
        kind: 'answer' as const,
        text: '[Answer]\nDone',
        truncated: false,
        sourceMessageId: 'msg-1'
      }
      const harness = await createHarness()
      harness.router.handleMessage.mockResolvedValue({
        replies: [],
        conversation: {
          sessionId: 'session-1',
          eventId: 'msg-1',
          getSnapshot: vi
            .fn()
            .mockResolvedValueOnce({
              messageId: 'msg-1',
              text: '[Reasoning]\nThinking',
              draftText: '',
              renderBlocks: [reasoningBlock],
              fullText: '[Reasoning]\nThinking',
              completed: false,
              pendingInteraction: null
            })
            .mockResolvedValue({
              messageId: 'msg-1',
              text: '[Reasoning]\nThinking\n\n[Answer]\nDone',
              draftText: '',
              renderBlocks: [reasoningBlock, answerBlock],
              fullText: '[Reasoning]\nThinking\n\n[Answer]\nDone',
              completed: true,
              pendingInteraction: null
            })
        }
      })

      await harness.onMessage({
        parsed: createParsedMessage({
          messageId: 'om_incremental'
        })
      })

      await vi.waitFor(() => {
        expect(harness.client.sendText).toHaveBeenCalledWith(
          {
            chatId: 'oc_1',
            threadId: null,
            replyToMessageId: 'om_incremental'
          },
          '[Reasoning]\nThinking'
        )
      })

      await vi.advanceTimersByTimeAsync(TELEGRAM_STREAM_POLL_INTERVAL_MS)

      await vi.waitFor(() => {
        expect(harness.client.sendText).toHaveBeenCalledWith(
          {
            chatId: 'oc_1',
            threadId: null,
            replyToMessageId: 'om_incremental'
          },
          '[Answer]\nDone'
        )
      })

      await harness.runtime.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns from websocket delivery before conversation completes', async () => {
    const deferred = createDeferred<{
      messageId: string | null
      text: string
      completed: boolean
      pendingInteraction: null
    }>()
    const harness = await createHarness()
    harness.router.handleMessage.mockResolvedValue({
      replies: [],
      conversation: {
        sessionId: 'session-1',
        eventId: 'msg-1',
        getSnapshot: vi.fn().mockReturnValue(deferred.promise)
      }
    })

    const result = await Promise.race([
      harness
        .onMessage({
          parsed: createParsedMessage()
        })
        .then(() => 'returned'),
      new Promise((resolve) => setTimeout(() => resolve('timed-out'), 25))
    ])

    expect(result).toBe('returned')
    await vi.waitFor(() => {
      expect(harness.router.handleMessage).toHaveBeenCalledTimes(1)
    })

    deferred.resolve({
      messageId: 'msg-1',
      text: 'done',
      completed: true,
      pendingInteraction: null
    })

    await vi.waitFor(() => {
      expect(harness.client.sendText).toHaveBeenCalledWith(
        {
          chatId: 'oc_1',
          threadId: null,
          replyToMessageId: 'om_1'
        },
        'done'
      )
    })

    await harness.runtime.stop()
  })

  it('drops duplicate deliveries with the same eventId', async () => {
    const harness = await createHarness()
    harness.router.handleMessage.mockResolvedValue({
      replies: ['ok']
    })

    await harness.onMessage({
      parsed: createParsedMessage({
        eventId: 'evt-duplicate',
        messageId: 'om_1'
      })
    })
    await harness.onMessage({
      parsed: createParsedMessage({
        eventId: 'evt-duplicate',
        messageId: 'om_2'
      })
    })

    await vi.waitFor(() => {
      expect(harness.router.handleMessage).toHaveBeenCalledTimes(1)
      expect(harness.client.sendText).toHaveBeenCalledTimes(1)
    })

    await harness.runtime.stop()
  })

  it('drops duplicate deliveries with the same chatId and messageId', async () => {
    const harness = await createHarness()
    harness.router.handleMessage.mockResolvedValue({
      replies: ['ok']
    })

    await harness.onMessage({
      parsed: createParsedMessage({
        eventId: 'evt-1',
        chatId: 'oc_same',
        messageId: 'om_same'
      })
    })
    await harness.onMessage({
      parsed: createParsedMessage({
        eventId: 'evt-2',
        chatId: 'oc_same',
        messageId: 'om_same'
      })
    })

    await vi.waitFor(() => {
      expect(harness.router.handleMessage).toHaveBeenCalledTimes(1)
      expect(harness.client.sendText).toHaveBeenCalledTimes(1)
    })

    await harness.runtime.stop()
  })

  it('sends a safe generic error reply while logging detailed diagnostics', async () => {
    const logger = {
      error: vi.fn()
    }
    const harness = await createHarness({ logger })
    const error = new Error('database credentials: secret-token')
    harness.router.handleMessage.mockRejectedValue(error)

    await harness.emitMessage({
      parsed: createParsedMessage({
        eventId: 'evt-error',
        messageId: 'om-error'
      })
    })

    await vi.waitFor(() => {
      expect(harness.client.sendText).toHaveBeenCalledWith(
        {
          chatId: 'oc_1',
          threadId: null,
          replyToMessageId: 'om-error'
        },
        'An internal error occurred while processing your request.'
      )
    })

    expect(logger.error).toHaveBeenCalledWith(error, {
      runId: 1,
      target: {
        chatId: 'oc_1',
        threadId: null,
        replyToMessageId: 'om-error'
      },
      chatId: 'oc_1',
      threadId: null,
      messageId: 'om-error',
      eventId: 'evt-error'
    })

    await harness.runtime.stop()
  })

  it('ignores stale websocket callbacks after the runtime restarts', async () => {
    const harness = await createHarness()
    harness.router.handleMessage.mockResolvedValue({
      replies: ['fresh']
    })

    const staleHandler = harness.getStreamHandlers()[0]
    await harness.runtime.stop()
    await harness.runtime.start()

    await staleHandler({
      parsed: createParsedMessage({
        eventId: 'evt-stale',
        messageId: 'om-stale'
      })
    })
    await Promise.resolve()

    expect(harness.router.handleMessage).not.toHaveBeenCalled()

    await harness.emitMessage({
      parsed: createParsedMessage({
        eventId: 'evt-fresh',
        messageId: 'om-fresh'
      })
    })

    await vi.waitFor(() => {
      expect(harness.router.handleMessage).toHaveBeenCalledTimes(1)
      expect(harness.client.sendText).toHaveBeenCalledWith(
        {
          chatId: 'oc_1',
          threadId: null,
          replyToMessageId: 'om-fresh'
        },
        'fresh'
      )
    })

    await harness.runtime.stop()
  })

  it('serializes messages per endpoint while allowing different endpoints in parallel', async () => {
    const deferred = createDeferred<void>()
    const harness = await createHarness()
    const started: string[] = []

    harness.router.handleMessage.mockImplementation(async (message: FeishuInboundMessage) => {
      started.push(message.text)
      if (message.text === 'A') {
        await deferred.promise
      }

      return {
        replies: [message.text]
      }
    })

    await harness.onMessage({
      parsed: createParsedMessage({
        eventId: 'evt-a',
        text: 'A',
        messageId: 'om_a'
      })
    })

    await vi.waitFor(() => {
      expect(started).toEqual(['A'])
    })

    await harness.onMessage({
      parsed: createParsedMessage({
        eventId: 'evt-b',
        text: 'B',
        messageId: 'om_b'
      })
    })
    await harness.onMessage({
      parsed: createParsedMessage({
        eventId: 'evt-c',
        text: 'C',
        chatId: 'oc_2',
        messageId: 'om_c'
      })
    })

    await vi.waitFor(() => {
      expect(started).toEqual(['A', 'C'])
    })

    deferred.resolve()

    await vi.waitFor(() => {
      expect(started).toEqual(['A', 'C', 'B'])
    })

    await harness.runtime.stop()
  })

  it('invalidates queued endpoint work from a previous run after restart', async () => {
    const firstRoute = createDeferred<{
      replies: string[]
    }>()
    const harness = await createHarness()
    const handledTexts: string[] = []

    harness.router.handleMessage.mockImplementation(async (message: FeishuInboundMessage) => {
      handledTexts.push(message.text)
      if (message.text === 'A') {
        return await firstRoute.promise
      }

      return {
        replies: [message.text]
      }
    })

    await harness.emitMessage({
      parsed: createParsedMessage({
        eventId: 'evt-a',
        messageId: 'om-a',
        text: 'A'
      })
    })

    await vi.waitFor(() => {
      expect(handledTexts).toEqual(['A'])
    })

    await harness.emitMessage({
      parsed: createParsedMessage({
        eventId: 'evt-b',
        messageId: 'om-b',
        text: 'B'
      })
    })
    await Promise.resolve()

    expect(handledTexts).toEqual(['A'])

    await harness.runtime.stop()
    await harness.runtime.start()

    firstRoute.resolve({
      replies: ['stale-a']
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(handledTexts).toEqual(['A'])
    expect(harness.client.sendText).not.toHaveBeenCalledWith(expect.anything(), 'stale-a')
    expect(harness.client.sendText).not.toHaveBeenCalledWith(expect.anything(), 'B')

    await harness.emitMessage({
      parsed: createParsedMessage({
        eventId: 'evt-fresh-after-restart',
        messageId: 'om-fresh-after-restart',
        text: 'fresh'
      })
    })

    await vi.waitFor(() => {
      expect(handledTexts).toEqual(['A', 'fresh'])
      expect(harness.client.sendText).toHaveBeenCalledWith(
        {
          chatId: 'oc_1',
          threadId: null,
          replyToMessageId: 'om-fresh-after-restart'
        },
        'fresh'
      )
    })

    await harness.runtime.stop()
  })

  it('bypasses the endpoint queue for stop commands', async () => {
    const deferred = createDeferred<{
      messageId: string | null
      text: string
      completed: boolean
      pendingInteraction: null
    }>()
    const harness = await createHarness()

    harness.router.handleMessage.mockImplementation(async (message: FeishuInboundMessage) => {
      if (message.command?.name === 'stop') {
        return {
          replies: ['Stopped the active generation.']
        }
      }

      return {
        replies: [],
        conversation: {
          sessionId: 'session-1',
          eventId: 'msg-1',
          getSnapshot: vi.fn().mockReturnValue(deferred.promise)
        }
      }
    })

    await harness.onMessage({
      parsed: createParsedMessage({
        text: 'hello',
        messageId: 'om_hello'
      })
    })

    await vi.waitFor(() => {
      expect(harness.router.handleMessage).toHaveBeenCalledTimes(1)
    })

    await harness.onMessage({
      parsed: createParsedMessage({
        eventId: 'evt-stop',
        text: '/stop',
        messageId: 'om_stop',
        command: {
          name: 'stop',
          args: ''
        }
      })
    })

    await vi.waitFor(() => {
      expect(harness.client.sendText).toHaveBeenCalledWith(
        {
          chatId: 'oc_1',
          threadId: null,
          replyToMessageId: 'om_stop'
        },
        'Stopped the active generation.'
      )
    })

    deferred.resolve({
      messageId: 'msg-1',
      text: 'partial output',
      completed: true,
      pendingInteraction: null
    })

    await vi.waitFor(() => {
      expect(harness.client.sendText).toHaveBeenCalledWith(
        {
          chatId: 'oc_1',
          threadId: null,
          replyToMessageId: 'om_hello'
        },
        'partial output'
      )
    })

    await harness.runtime.stop()
  })

  it('stops polling and sends a timeout message when a conversation never completes', async () => {
    vi.useFakeTimers()

    try {
      const harness = await createHarness()
      harness.router.handleMessage.mockResolvedValue({
        replies: [],
        conversation: {
          sessionId: 'session-1',
          eventId: 'msg-1',
          getSnapshot: vi.fn().mockResolvedValue({
            messageId: null,
            text: '',
            completed: false,
            pendingInteraction: null
          })
        }
      })

      await harness.onMessage({
        parsed: createParsedMessage({
          messageId: 'om_timeout'
        })
      })

      await vi.advanceTimersByTimeAsync(
        FEISHU_CONVERSATION_POLL_TIMEOUT_MS + TELEGRAM_STREAM_POLL_INTERVAL_MS
      )

      await vi.waitFor(() => {
        expect(harness.client.sendText).toHaveBeenCalledWith(
          {
            chatId: 'oc_1',
            threadId: null,
            replyToMessageId: 'om_timeout'
          },
          'The current conversation timed out before finishing. Please try again.'
        )
      })

      await harness.runtime.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not deliver conversation output from a previous run after restart', async () => {
    const deferred = createDeferred<{
      messageId: string | null
      text: string
      completed: boolean
      pendingInteraction: null
    }>()
    const harness = await createHarness()

    harness.router.handleMessage.mockImplementation(async (message: FeishuInboundMessage) => {
      if (message.text === 'fresh') {
        return {
          replies: ['fresh reply']
        }
      }

      return {
        replies: [],
        conversation: {
          sessionId: 'session-1',
          eventId: 'msg-1',
          getSnapshot: vi.fn().mockReturnValue(deferred.promise)
        }
      }
    })

    await harness.emitMessage({
      parsed: createParsedMessage({
        eventId: 'evt-old-conversation',
        messageId: 'om-old-conversation',
        text: 'hello'
      })
    })

    await vi.waitFor(() => {
      expect(harness.router.handleMessage).toHaveBeenCalledTimes(1)
    })

    await harness.runtime.stop()
    await harness.runtime.start()

    deferred.resolve({
      messageId: 'msg-1',
      text: 'stale conversation output',
      completed: true,
      pendingInteraction: null
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(harness.client.sendText).not.toHaveBeenCalledWith(
      expect.anything(),
      'stale conversation output'
    )

    await harness.emitMessage({
      parsed: createParsedMessage({
        eventId: 'evt-new-conversation',
        messageId: 'om-new-conversation',
        text: 'fresh'
      })
    })

    await vi.waitFor(() => {
      expect(harness.client.sendText).toHaveBeenCalledWith(
        {
          chatId: 'oc_1',
          threadId: null,
          replyToMessageId: 'om-new-conversation'
        },
        'fresh reply'
      )
    })

    await harness.runtime.stop()
  })

  it('sends pending interaction cards after conversation text completes', async () => {
    const harness = await createHarness()
    harness.router.handleMessage.mockResolvedValue({
      replies: [],
      conversation: {
        sessionId: 'session-1',
        eventId: 'msg-1',
        getSnapshot: vi.fn().mockResolvedValue({
          messageId: 'msg-1',
          text: 'Need approval',
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

    await harness.emitMessage({
      parsed: createParsedMessage({
        eventId: 'evt-pending-card',
        messageId: 'om-pending-card'
      })
    })

    await vi.waitFor(() => {
      expect(harness.client.sendText).toHaveBeenCalledWith(
        {
          chatId: 'oc_1',
          threadId: null,
          replyToMessageId: 'om-pending-card'
        },
        'Need approval'
      )
      expect(harness.client.sendCard).toHaveBeenCalledWith(
        {
          chatId: 'oc_1',
          threadId: null,
          replyToMessageId: 'om-pending-card'
        },
        expect.objectContaining({
          header: expect.objectContaining({
            title: expect.objectContaining({
              content: 'Permission Required'
            })
          })
        })
      )
    })

    await harness.runtime.stop()
  })

  it('falls back to text when sending a Feishu card fails', async () => {
    const harness = await createHarness()
    harness.client.sendCard.mockRejectedValueOnce(new Error('card send failed'))
    harness.router.handleMessage.mockResolvedValue({
      replies: [],
      outboundActions: [
        {
          type: 'sendCard',
          card: {
            header: {
              title: {
                tag: 'plain_text',
                content: 'Question'
              }
            }
          },
          fallbackText: 'Reply with ALLOW or DENY.'
        }
      ]
    })

    await harness.emitMessage({
      parsed: createParsedMessage({
        eventId: 'evt-card-fallback',
        messageId: 'om-card-fallback'
      })
    })

    await vi.waitFor(() => {
      expect(harness.client.sendCard).toHaveBeenCalled()
      expect(harness.client.sendText).toHaveBeenCalledWith(
        {
          chatId: 'oc_1',
          threadId: null,
          replyToMessageId: 'om-card-fallback'
        },
        'Reply with ALLOW or DENY.'
      )
    })

    await harness.runtime.stop()
  })
})
