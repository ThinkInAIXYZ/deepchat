import { describe, expect, it, vi } from 'vitest'
import { FeishuRuntime } from '@/presenter/remoteControlPresenter/feishu/feishuRuntime'
import type { FeishuInboundMessage } from '@/presenter/remoteControlPresenter/types'

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

const createHarness = async () => {
  let onMessage: ((event: unknown) => Promise<void>) | null = null
  const client = {
    probeBot: vi.fn().mockResolvedValue({
      openId: 'ou_bot',
      name: 'DeepChat Bot'
    }),
    startMessageStream: vi
      .fn()
      .mockImplementation(async (params: { onMessage: (event: unknown) => Promise<void> }) => {
        onMessage = params.onMessage
      }),
    stop: vi.fn(),
    sendText: vi.fn().mockResolvedValue(undefined)
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
    router: router as any
  })
  await runtime.start()

  return {
    runtime,
    client,
    parser,
    router,
    onMessage: onMessage!
  }
}

describe('FeishuRuntime', () => {
  it('returns from websocket delivery before conversation completes', async () => {
    const deferred = createDeferred<{
      messageId: string | null
      text: string
      completed: boolean
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
      completed: true
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

  it('bypasses the endpoint queue for stop commands', async () => {
    const deferred = createDeferred<{
      messageId: string | null
      text: string
      completed: boolean
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
      completed: true
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
})
