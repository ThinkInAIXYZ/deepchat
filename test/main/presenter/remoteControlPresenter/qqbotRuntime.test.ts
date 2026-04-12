import { describe, expect, it, vi } from 'vitest'
import { QQBotRuntime } from '@/presenter/remoteControlPresenter/qqbot/qqbotRuntime'
import type {
  QQBotTransportTarget,
  RemoteDeliverySegment
} from '@/presenter/remoteControlPresenter/types'

const createRuntime = () => {
  const onFatalError = vi.fn()
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
    router: {} as any,
    bindingStore: bindingStore as any,
    onFatalError
  })

  return {
    runtime,
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

describe('QQBotRuntime', () => {
  it('re-sends changed existing segments before appending new segments', async () => {
    const { runtime, client, bindingStore } = createRuntime()
    client.sendC2CMessage
      .mockResolvedValueOnce({ id: 'updated-msg-1' })
      .mockResolvedValueOnce({ id: 'terminal-msg-1' })

    const state = {
      sourceMessageId: 'source-msg-1',
      segments: [
        {
          key: 'source-msg-1:legacy:answer',
          kind: 'answer' as const,
          messageIds: ['initial-msg-1'],
          lastText: 'Draft answer'
        }
      ]
    }
    const segments: RemoteDeliverySegment[] = [
      {
        key: 'source-msg-1:legacy:answer',
        kind: 'answer',
        text: 'Updated answer',
        sourceMessageId: 'source-msg-1'
      },
      {
        key: 'source-msg-1:terminal',
        kind: 'terminal',
        text: 'Final answer',
        sourceMessageId: 'source-msg-1'
      }
    ]
    const sendContext = (runtime as any).createSendContext(C2C_TARGET, 1)

    const result = await (runtime as any).syncDeliverySegments(
      state,
      'qqbot:c2c:open-id-1',
      sendContext,
      segments
    )

    expect(client.sendC2CMessage).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      sourceMessageId: 'source-msg-1',
      segments: [
        {
          key: 'source-msg-1:legacy:answer',
          kind: 'answer',
          messageIds: ['initial-msg-1', 'updated-msg-1'],
          lastText: 'Updated answer'
        },
        {
          key: 'source-msg-1:terminal',
          kind: 'terminal',
          messageIds: ['terminal-msg-1'],
          lastText: 'Final answer'
        }
      ]
    })
    expect(bindingStore.rememberRemoteDeliveryState).toHaveBeenCalledWith(
      'qqbot:c2c:open-id-1',
      result
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
