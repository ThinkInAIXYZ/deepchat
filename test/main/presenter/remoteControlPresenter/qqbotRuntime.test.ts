import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildFeishuPendingInteractionText } from '@/presenter/remoteControlPresenter/feishu/feishuInteractionPrompt'
import { QQBotRuntime } from '@/presenter/remoteControlPresenter/qqbot/qqbotRuntime'
import {
  FEISHU_CONVERSATION_POLL_TIMEOUT_MS,
  TELEGRAM_STREAM_POLL_INTERVAL_MS,
  type QQBotInboundMessage,
  type QQBotTransportTarget,
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
    completed: boolean
    text: string
    fullText?: string
    finalText?: string
    pendingInteraction: RemotePendingInteraction | null
  }>
) => {
  let index = 0
  const getSnapshot = vi.fn(async () => snapshots[Math.min(index++, snapshots.length - 1)])

  return {
    getSnapshot,
    execution: {
      sessionId: 'session-1',
      eventId: 'assistant-msg-1',
      getSnapshot
    }
  }
}

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
          text: 'Draft answer',
          finalText: '',
          pendingInteraction: null
        },
        {
          completed: false,
          text: 'Draft answer expanded',
          finalText: '',
          pendingInteraction: null
        },
        {
          completed: true,
          text: 'Draft answer expanded',
          fullText: 'Final answer',
          finalText: 'Final answer',
          pendingInteraction: null
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

  it('sends the pending interaction prompt once after completion', async () => {
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
        text: 'Draft answer',
        finalText: '',
        pendingInteraction: null
      },
      {
        completed: true,
        text: 'Draft answer',
        finalText: 'Final answer',
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

    expect(client.sendGroupMessage).toHaveBeenCalledTimes(1)
    expect(client.sendGroupMessage).toHaveBeenCalledWith(
      createExpectedPayload(
        GROUP_TARGET,
        message.messageSeq,
        buildFeishuPendingInteractionText(interaction)
      )
    )
  })

  it('sends the timeout text once for stalled conversations', async () => {
    vi.useFakeTimers()

    const { runtime, client } = createRuntime()
    activateRuntime(runtime)
    client.sendC2CMessage.mockResolvedValue({ id: 'timeout-msg-1' })

    const { execution } = createExecution([
      {
        completed: false,
        text: 'Still running',
        finalText: '',
        pendingInteraction: null
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

    expect(client.sendC2CMessage).toHaveBeenCalledTimes(1)
    expect(client.sendC2CMessage).toHaveBeenCalledWith(
      createExpectedPayload(
        C2C_TARGET,
        message.messageSeq,
        'The current conversation timed out before finishing. Please try again.'
      )
    )
  })

  it('sends the no-response text once when the conversation completes empty', async () => {
    const { runtime, client, bindingStore } = createRuntime()
    activateRuntime(runtime)
    client.sendC2CMessage.mockResolvedValue({ id: 'no-response-msg-1' })

    const { execution } = createExecution([
      {
        completed: true,
        text: '',
        fullText: 'No assistant response was produced.',
        finalText: 'No assistant response was produced.',
        pendingInteraction: null
      }
    ])

    const message = createInboundMessage(C2C_TARGET, 5)
    const sendContext = (runtime as any).createSendContext(C2C_TARGET, message.messageSeq)

    await (runtime as any).deliverConversation(message, sendContext, execution, 1)

    expect(client.sendC2CMessage).toHaveBeenCalledTimes(1)
    expect(client.sendC2CMessage).toHaveBeenCalledWith(
      createExpectedPayload(C2C_TARGET, message.messageSeq, 'No assistant response was produced.')
    )
    expect(bindingStore.getRemoteDeliveryState).not.toHaveBeenCalled()
    expect(bindingStore.rememberRemoteDeliveryState).not.toHaveBeenCalled()
  })

  it('sends the internal error reply once when routing fails', async () => {
    const { runtime, router, client } = createRuntime()
    activateRuntime(runtime)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    router.handleMessage.mockRejectedValue(new Error('routing failed'))
    client.sendC2CMessage.mockResolvedValue({ id: 'internal-error-msg-1' })

    const message = createInboundMessage(C2C_TARGET, 6)

    await (runtime as any).processInboundMessage(message, 1)

    expect(router.handleMessage).toHaveBeenCalledWith(message)
    expect(client.sendC2CMessage).toHaveBeenCalledTimes(1)
    expect(client.sendC2CMessage).toHaveBeenCalledWith(
      createExpectedPayload(
        C2C_TARGET,
        message.messageSeq,
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
