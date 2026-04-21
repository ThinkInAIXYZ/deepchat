import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildFeishuPendingInteractionText } from '@/presenter/remoteControlPresenter/feishu/feishuInteractionPrompt'
import { QQBotRuntime } from '@/presenter/remoteControlPresenter/qqbot/qqbotRuntime'
import {
  FEISHU_CONVERSATION_POLL_TIMEOUT_MS,
  TELEGRAM_STREAM_POLL_INTERVAL_MS,
  type QQBotInboundMessage,
  type QQBotTransportTarget,
  type RemoteDeliverySegment,
  type RemotePendingInteraction
} from '@/presenter/remoteControlPresenter/types'

const createRuntime = () => {
  const onFatalError = vi.fn()
  const router = {
    handleMessage: vi.fn()
  }
  const client = {
    sendC2CMessage: vi.fn(),
    sendGroupMessage: vi.fn()
  }
  const bindingStore = {
    rememberRemoteDeliveryState: vi.fn(),
    getRemoteDeliveryState: vi.fn(),
    clearRemoteDeliveryState: vi.fn()
  }

  const runtime = new QQBotRuntime({
    client: client as any,
    parser: {} as any,
    router: router as any,
    bindingStore: bindingStore as any,
    onFatalError
  })

  return {
    runtime,
    router,
    client,
    bindingStore,
    onFatalError
  }
}

const C2C_TARGET: QQBotTransportTarget = {
  chatType: 'c2c',
  openId: 'open-id-1',
  msgId: 'source-msg-1'
}

const GROUP_TARGET: QQBotTransportTarget = {
  chatType: 'group',
  openId: 'group-open-id-1',
  msgId: 'group-source-msg-1'
}

const createInboundMessage = (
  target: QQBotTransportTarget,
  messageSeq: number = 1
): QQBotInboundMessage => ({
  kind: 'message',
  eventId: `${target.chatType}-event-${messageSeq}`,
  chatId: target.openId,
  chatType: target.chatType,
  messageId: target.msgId,
  messageSeq,
  senderUserId: `${target.chatType}-user-1`,
  senderUserName: `${target.chatType}-user`,
  text: 'hello',
  command: null,
  mentionedBot: target.chatType === 'group'
})

const createExecution = (
  snapshots: Array<{
    messageId?: string | null
    completed: boolean
    text?: string
    traceText?: string
    deliverySegments?: RemoteDeliverySegment[]
    fullText?: string
    finalText?: string
    pendingInteraction?: RemotePendingInteraction | null
  }>
) => {
  let index = 0
  const normalizedSnapshots = snapshots.map((snapshot) => ({
    messageId: 'assistant-msg-1',
    text: '',
    traceText: '',
    deliverySegments: undefined as RemoteDeliverySegment[] | undefined,
    fullText: snapshot.fullText ?? snapshot.finalText ?? snapshot.text ?? '',
    finalText: snapshot.finalText ?? '',
    completed: snapshot.completed,
    pendingInteraction: snapshot.pendingInteraction ?? null,
    ...snapshot
  }))

  const getSnapshot = vi.fn(
    async () => normalizedSnapshots[Math.min(index++, snapshots.length - 1)]
  )

  return {
    getSnapshot,
    execution: {
      sessionId: 'session-1',
      eventId: 'assistant-msg-1',
      getSnapshot
    }
  }
}

const createProcessSegment = (
  sourceMessageId: string,
  index: number,
  text: string
): RemoteDeliverySegment => ({
  key: `${sourceMessageId}:${index}:process`,
  kind: 'process',
  text,
  sourceMessageId
})

const createAnswerSegment = (
  sourceMessageId: string,
  index: number,
  text: string
): RemoteDeliverySegment => ({
  key: `${sourceMessageId}:${index}:answer`,
  kind: 'answer',
  text,
  sourceMessageId
})

const activateRuntime = (runtime: QQBotRuntime, runId: number = 1): void => {
  ;(runtime as any).runId = runId
  ;(runtime as any).started = true
  ;(runtime as any).stopRequested = false
}

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

const createExpectedPayload = (
  target: QQBotTransportTarget,
  msgSeq: number,
  content: string
): Record<string, unknown> =>
  target.chatType === 'c2c'
    ? {
        openId: target.openId,
        msgId: target.msgId,
        msgSeq,
        content
      }
    : {
        groupOpenId: target.openId,
        msgId: target.msgId,
        msgSeq,
        content
      }

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('QQBotRuntime', () => {
  it.each([
    {
      label: 'c2c',
      target: C2C_TARGET,
      message: createInboundMessage(C2C_TARGET, 1),
      getSendMock: (client: ReturnType<typeof createRuntime>['client']) => client.sendC2CMessage
    },
    {
      label: 'group',
      target: GROUP_TARGET,
      message: createInboundMessage(GROUP_TARGET, 3),
      getSendMock: (client: ReturnType<typeof createRuntime>['client']) => client.sendGroupMessage
    }
  ])(
    'waits for completion before sending $label final text',
    async ({ target, message, getSendMock }) => {
      vi.useFakeTimers()

      const { runtime, client, bindingStore } = createRuntime()
      activateRuntime(runtime)
      const sendMock = getSendMock(client)
      sendMock.mockResolvedValue({ id: `${target.chatType}-final-msg` })

      const { execution, getSnapshot } = createExecution([
        {
          completed: false,
          text: 'Draft answer'
        },
        {
          completed: false,
          text: 'Draft answer expanded'
        },
        {
          completed: true,
          text: 'Draft answer expanded',
          fullText: 'Final answer',
          finalText: 'Final answer'
        }
      ])

      const sendContext = (runtime as any).createSendContext(target, message.messageSeq)
      const deliveryPromise = (runtime as any).deliverConversation(
        message,
        sendContext,
        execution,
        1
      )

      await flushMicrotasks()
      expect(getSnapshot).toHaveBeenCalledTimes(1)
      expect(sendMock).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(TELEGRAM_STREAM_POLL_INTERVAL_MS)
      expect(getSnapshot).toHaveBeenCalledTimes(2)
      expect(sendMock).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(TELEGRAM_STREAM_POLL_INTERVAL_MS)
      await deliveryPromise

      expect(getSnapshot).toHaveBeenCalledTimes(3)
      expect(sendMock).toHaveBeenCalledTimes(1)
      expect(sendMock).toHaveBeenCalledWith(
        createExpectedPayload(target, message.messageSeq, 'Final answer')
      )
      expect(bindingStore.getRemoteDeliveryState).not.toHaveBeenCalled()
      expect(bindingStore.rememberRemoteDeliveryState).not.toHaveBeenCalled()
    }
  )

  it('flushes the latest tool batch when answer text appears and sends the final answer on completion', async () => {
    vi.useFakeTimers()

    const { runtime, client } = createRuntime()
    activateRuntime(runtime)
    client.sendC2CMessage.mockResolvedValue({ id: 'c2c-msg-1' })

    const sourceMessageId = 'assistant-msg-1'
    const { execution, getSnapshot } = createExecution([
      {
        completed: false,
        deliverySegments: [createProcessSegment(sourceMessageId, 0, '💻 shell_command: "pwd"')]
      },
      {
        completed: false,
        text: 'Draft answer',
        deliverySegments: [
          createProcessSegment(
            sourceMessageId,
            0,
            '💻 shell_command: "pwd"\n📖 read_file: "/tmp/report.md"'
          ),
          createAnswerSegment(sourceMessageId, 1, 'Draft answer')
        ]
      },
      {
        completed: true,
        text: 'Draft answer',
        finalText: 'Final answer',
        fullText: 'Final answer',
        deliverySegments: [
          createProcessSegment(
            sourceMessageId,
            0,
            '💻 shell_command: "pwd"\n📖 read_file: "/tmp/report.md"'
          ),
          createAnswerSegment(sourceMessageId, 1, 'Final answer')
        ]
      }
    ])

    const message = createInboundMessage(C2C_TARGET, 1)
    const sendContext = (runtime as any).createSendContext(C2C_TARGET, message.messageSeq)
    const deliveryPromise = (runtime as any).deliverConversation(message, sendContext, execution, 1)

    await flushMicrotasks()
    expect(getSnapshot).toHaveBeenCalledTimes(1)
    expect(client.sendC2CMessage).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(TELEGRAM_STREAM_POLL_INTERVAL_MS)
    expect(getSnapshot).toHaveBeenCalledTimes(2)
    expect(client.sendC2CMessage).toHaveBeenCalledTimes(1)
    expect(client.sendC2CMessage).toHaveBeenNthCalledWith(
      1,
      createExpectedPayload(
        C2C_TARGET,
        1,
        '💻 shell_command: "pwd"\n📖 read_file: "/tmp/report.md"'
      )
    )

    await vi.advanceTimersByTimeAsync(TELEGRAM_STREAM_POLL_INTERVAL_MS)
    await deliveryPromise

    expect(getSnapshot).toHaveBeenCalledTimes(3)
    expect(client.sendC2CMessage).toHaveBeenCalledTimes(2)
    expect(client.sendC2CMessage).toHaveBeenNthCalledWith(
      2,
      createExpectedPayload(C2C_TARGET, 2, 'Final answer')
    )
  })

  it('flushes each process batch in segment order while keeping answer delivery final-only', async () => {
    vi.useFakeTimers()

    const { runtime, client } = createRuntime()
    activateRuntime(runtime)
    client.sendGroupMessage.mockResolvedValue({ id: 'group-msg-1' })

    const sourceMessageId = 'assistant-msg-1'
    const { execution, getSnapshot } = createExecution([
      {
        completed: false,
        text: 'Opening answer',
        deliverySegments: [createAnswerSegment(sourceMessageId, 0, 'Opening answer')]
      },
      {
        completed: false,
        text: 'Opening answer',
        deliverySegments: [
          createAnswerSegment(sourceMessageId, 0, 'Opening answer'),
          createProcessSegment(sourceMessageId, 1, '📖 read_file: "/tmp/a.md"')
        ]
      },
      {
        completed: false,
        text: 'Middle answer',
        deliverySegments: [
          createAnswerSegment(sourceMessageId, 0, 'Opening answer'),
          createProcessSegment(
            sourceMessageId,
            1,
            '📖 read_file: "/tmp/a.md"\n💻 shell_command: "git status"'
          ),
          createAnswerSegment(sourceMessageId, 2, 'Middle answer'),
          createProcessSegment(sourceMessageId, 3, '📝 write_file: "/tmp/b.md"')
        ]
      },
      {
        completed: true,
        text: 'Final answer',
        finalText: 'Final answer',
        fullText: 'Final answer',
        deliverySegments: [
          createAnswerSegment(sourceMessageId, 0, 'Opening answer'),
          createProcessSegment(
            sourceMessageId,
            1,
            '📖 read_file: "/tmp/a.md"\n💻 shell_command: "git status"'
          ),
          createAnswerSegment(sourceMessageId, 2, 'Middle answer'),
          createProcessSegment(sourceMessageId, 3, '📝 write_file: "/tmp/b.md"'),
          createAnswerSegment(sourceMessageId, 4, 'Final answer')
        ]
      }
    ])

    const message = createInboundMessage(GROUP_TARGET, 2)
    const sendContext = (runtime as any).createSendContext(GROUP_TARGET, message.messageSeq)
    const deliveryPromise = (runtime as any).deliverConversation(message, sendContext, execution, 1)

    await flushMicrotasks()
    expect(getSnapshot).toHaveBeenCalledTimes(1)
    expect(client.sendGroupMessage).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(TELEGRAM_STREAM_POLL_INTERVAL_MS)
    expect(getSnapshot).toHaveBeenCalledTimes(2)
    expect(client.sendGroupMessage).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(TELEGRAM_STREAM_POLL_INTERVAL_MS)
    expect(getSnapshot).toHaveBeenCalledTimes(3)
    expect(client.sendGroupMessage).toHaveBeenCalledTimes(1)
    expect(client.sendGroupMessage).toHaveBeenNthCalledWith(
      1,
      createExpectedPayload(
        GROUP_TARGET,
        2,
        '📖 read_file: "/tmp/a.md"\n💻 shell_command: "git status"'
      )
    )

    await vi.advanceTimersByTimeAsync(TELEGRAM_STREAM_POLL_INTERVAL_MS)
    await deliveryPromise

    expect(getSnapshot).toHaveBeenCalledTimes(4)
    expect(client.sendGroupMessage).toHaveBeenCalledTimes(3)
    expect(client.sendGroupMessage).toHaveBeenNthCalledWith(
      2,
      createExpectedPayload(GROUP_TARGET, 3, '📝 write_file: "/tmp/b.md"')
    )
    expect(client.sendGroupMessage).toHaveBeenNthCalledWith(
      3,
      createExpectedPayload(GROUP_TARGET, 4, 'Final answer')
    )
  })

  it('flushes the buffered tool batch before the pending interaction prompt', async () => {
    vi.useFakeTimers()

    const { runtime, client } = createRuntime()
    activateRuntime(runtime)
    client.sendGroupMessage.mockResolvedValue({ id: 'pending-msg-1' })

    const interaction: RemotePendingInteraction = {
      type: 'question',
      messageId: 'assistant-msg-1',
      toolCallId: 'tool-call-1',
      toolName: 'question_tool',
      toolArgs: '',
      question: {
        header: 'Need confirmation',
        question: 'Choose one option',
        options: [
          {
            label: 'Option A',
            description: 'Use option A'
          }
        ],
        custom: false,
        multiple: false
      }
    }

    const { execution } = createExecution([
      {
        completed: false,
        deliverySegments: [createProcessSegment('assistant-msg-1', 0, '🔎 search: "release notes"')]
      },
      {
        completed: true,
        deliverySegments: [
          createProcessSegment('assistant-msg-1', 0, '🔎 search: "release notes"')
        ],
        pendingInteraction: interaction
      }
    ])

    const message = createInboundMessage(GROUP_TARGET, 4)
    const sendContext = (runtime as any).createSendContext(GROUP_TARGET, message.messageSeq)
    const deliveryPromise = (runtime as any).deliverConversation(message, sendContext, execution, 1)

    await flushMicrotasks()
    expect(client.sendGroupMessage).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(TELEGRAM_STREAM_POLL_INTERVAL_MS)
    await deliveryPromise

    expect(client.sendGroupMessage).toHaveBeenCalledTimes(2)
    expect(client.sendGroupMessage).toHaveBeenNthCalledWith(
      1,
      createExpectedPayload(GROUP_TARGET, 4, '🔎 search: "release notes"')
    )
    expect(client.sendGroupMessage).toHaveBeenNthCalledWith(
      2,
      createExpectedPayload(GROUP_TARGET, 5, buildFeishuPendingInteractionText(interaction))
    )
  })

  it('flushes the buffered tool batch before timeout text', async () => {
    vi.useFakeTimers()

    const { runtime, client } = createRuntime()
    activateRuntime(runtime)
    client.sendC2CMessage.mockResolvedValue({ id: 'timeout-msg-1' })

    const { execution } = createExecution([
      {
        completed: false,
        deliverySegments: [
          createProcessSegment('assistant-msg-1', 0, '💻 shell_command: "sleep 1"')
        ]
      }
    ])

    const message = createInboundMessage(C2C_TARGET, 2)
    const sendContext = (runtime as any).createSendContext(C2C_TARGET, message.messageSeq)
    const deliveryPromise = (runtime as any).deliverConversation(message, sendContext, execution, 1)

    await flushMicrotasks()
    expect(client.sendC2CMessage).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(
      FEISHU_CONVERSATION_POLL_TIMEOUT_MS + TELEGRAM_STREAM_POLL_INTERVAL_MS * 2
    )
    await deliveryPromise

    expect(client.sendC2CMessage).toHaveBeenCalledTimes(2)
    expect(client.sendC2CMessage).toHaveBeenNthCalledWith(
      1,
      createExpectedPayload(C2C_TARGET, 2, '💻 shell_command: "sleep 1"')
    )
    expect(client.sendC2CMessage).toHaveBeenNthCalledWith(
      2,
      createExpectedPayload(
        C2C_TARGET,
        3,
        'The current conversation timed out before finishing. Please try again.'
      )
    )
  })

  it('flushes the buffered tool batch before the no-response terminal text', async () => {
    const { runtime, client, bindingStore } = createRuntime()
    activateRuntime(runtime)
    client.sendC2CMessage.mockResolvedValue({ id: 'no-response-msg-1' })

    const { execution } = createExecution([
      {
        completed: true,
        deliverySegments: [
          createProcessSegment('assistant-msg-1', 0, '📖 read_file: "/tmp/empty.md"')
        ],
        fullText: 'No assistant response was produced.',
        finalText: 'No assistant response was produced.'
      }
    ])

    const message = createInboundMessage(C2C_TARGET, 5)
    const sendContext = (runtime as any).createSendContext(C2C_TARGET, message.messageSeq)

    await (runtime as any).deliverConversation(message, sendContext, execution, 1)

    expect(client.sendC2CMessage).toHaveBeenCalledTimes(2)
    expect(client.sendC2CMessage).toHaveBeenNthCalledWith(
      1,
      createExpectedPayload(C2C_TARGET, 5, '📖 read_file: "/tmp/empty.md"')
    )
    expect(client.sendC2CMessage).toHaveBeenNthCalledWith(
      2,
      createExpectedPayload(C2C_TARGET, 6, 'No assistant response was produced.')
    )
    expect(bindingStore.getRemoteDeliveryState).not.toHaveBeenCalled()
    expect(bindingStore.rememberRemoteDeliveryState).not.toHaveBeenCalled()
  })

  it('keeps the final reply slot reserved when the passive reply limit is almost exhausted', async () => {
    const { runtime, client } = createRuntime()
    activateRuntime(runtime)
    client.sendC2CMessage.mockResolvedValue({ id: 'final-msg-1' })

    const { execution } = createExecution([
      {
        completed: true,
        text: 'Final answer',
        finalText: 'Final answer',
        fullText: 'Final answer',
        deliverySegments: [
          createProcessSegment('assistant-msg-1', 0, '📖 read_file: "/tmp/a.md"'),
          createAnswerSegment('assistant-msg-1', 1, 'Final answer')
        ]
      }
    ])

    const message = createInboundMessage(C2C_TARGET, 1)
    const sendContext = (runtime as any).createSendContext(C2C_TARGET, 5)
    sendContext.sentCount = 4

    await (runtime as any).deliverConversation(message, sendContext, execution, 1)

    expect(client.sendC2CMessage).toHaveBeenCalledTimes(1)
    expect(client.sendC2CMessage).toHaveBeenCalledWith(
      createExpectedPayload(C2C_TARGET, 5, 'Final answer')
    )
  })

  it('falls back to legacy trace text snapshots when delivery segments are unavailable', async () => {
    vi.useFakeTimers()

    const { runtime, client } = createRuntime()
    activateRuntime(runtime)
    client.sendC2CMessage.mockResolvedValue({ id: 'legacy-msg-1' })

    const { execution } = createExecution([
      {
        completed: false,
        traceText: '💻 shell_command: "git status"',
        text: ''
      },
      {
        completed: false,
        traceText: '💻 shell_command: "git status"\n📖 read_file: "/tmp/a.md"',
        text: 'Draft answer'
      },
      {
        completed: true,
        traceText: '💻 shell_command: "git status"\n📖 read_file: "/tmp/a.md"',
        text: 'Final answer',
        fullText: 'Final answer',
        finalText: 'Final answer'
      }
    ])

    const message = createInboundMessage(C2C_TARGET, 7)
    const sendContext = (runtime as any).createSendContext(C2C_TARGET, message.messageSeq)
    const deliveryPromise = (runtime as any).deliverConversation(message, sendContext, execution, 1)

    await flushMicrotasks()
    expect(client.sendC2CMessage).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(TELEGRAM_STREAM_POLL_INTERVAL_MS)
    expect(client.sendC2CMessage).toHaveBeenCalledTimes(1)
    expect(client.sendC2CMessage).toHaveBeenNthCalledWith(
      1,
      createExpectedPayload(
        C2C_TARGET,
        7,
        '💻 shell_command: "git status"\n📖 read_file: "/tmp/a.md"'
      )
    )

    await vi.advanceTimersByTimeAsync(TELEGRAM_STREAM_POLL_INTERVAL_MS)
    await deliveryPromise

    expect(client.sendC2CMessage).toHaveBeenCalledTimes(2)
    expect(client.sendC2CMessage).toHaveBeenNthCalledWith(
      2,
      createExpectedPayload(C2C_TARGET, 8, 'Final answer')
    )
  })

  it('flushes buffered tool text before sending the internal error reply', async () => {
    vi.useFakeTimers()

    const { runtime, router, client } = createRuntime()
    activateRuntime(runtime)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    client.sendC2CMessage.mockResolvedValue({ id: 'internal-error-msg-1' })

    let snapshotCallCount = 0
    const execution = {
      sessionId: 'session-1',
      eventId: 'assistant-msg-1',
      getSnapshot: vi.fn(async () => {
        if (snapshotCallCount === 0) {
          snapshotCallCount += 1
          return {
            messageId: 'assistant-msg-1',
            text: '',
            traceText: '',
            deliverySegments: [
              createProcessSegment('assistant-msg-1', 0, '💻 shell_command: "pwd"')
            ],
            fullText: '',
            finalText: '',
            completed: false,
            pendingInteraction: null
          }
        }

        throw new Error('snapshot failed')
      })
    }

    router.handleMessage.mockResolvedValue({
      replies: [],
      conversation: execution
    })

    const message = createInboundMessage(C2C_TARGET, 6)
    const deliveryPromise = (runtime as any).processInboundMessage(message, 1)

    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(TELEGRAM_STREAM_POLL_INTERVAL_MS)
    await deliveryPromise

    expect(router.handleMessage).toHaveBeenCalledWith(message)
    expect(client.sendC2CMessage).toHaveBeenCalledTimes(2)
    expect(client.sendC2CMessage).toHaveBeenNthCalledWith(
      1,
      createExpectedPayload(C2C_TARGET, 6, '💻 shell_command: "pwd"')
    )
    expect(client.sendC2CMessage).toHaveBeenNthCalledWith(
      2,
      createExpectedPayload(
        C2C_TARGET,
        7,
        'An internal error occurred while processing your request.'
      )
    )
  })

  it('emits fatal errors only once across gateway status, callback, and start catch paths', async () => {
    const { runtime, onFatalError } = createRuntime()
    const gateway = (runtime as any).gateway

    gateway.start = vi.fn().mockImplementation(async () => {
      gateway.deps.onStatusChange?.({
        state: 'error',
        lastError: 'fatal qqbot error',
        botUser: null
      })
      gateway.deps.onFatalError?.('fatal qqbot error')
      throw new Error('fatal qqbot error')
    })

    await expect(runtime.start()).rejects.toThrow('fatal qqbot error')
    expect(onFatalError).toHaveBeenCalledTimes(1)
    expect(onFatalError).toHaveBeenCalledWith('fatal qqbot error')

    ;(runtime as any).setStatus({
      state: 'stopped'
    })
    ;(runtime as any).setStatus({
      state: 'error',
      lastError: 'fatal qqbot error again'
    })

    expect(onFatalError).toHaveBeenCalledTimes(2)
    expect(onFatalError).toHaveBeenLastCalledWith('fatal qqbot error again')
  })
})
