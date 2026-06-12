import { beforeEach, describe, expect, it, vi } from 'vitest'

const { wsInstances, MockWebSocket } = vi.hoisted(() => {
  const wsInstances: Array<{
    url: string
    addEventListener: ReturnType<typeof vi.fn>
    removeEventListener: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    terminate: ReturnType<typeof vi.fn>
    listeners: Map<string, Set<EventListener>>
    closed: boolean
    terminated: boolean
    emit: (type: string, event?: Event) => void
  }> = []

  class MockWebSocket {
    readonly addEventListener = vi.fn((type: string, listener: EventListener) => {
      const listeners = this.listeners.get(type) ?? new Set<EventListener>()
      listeners.add(listener)
      this.listeners.set(type, listeners)
    })
    readonly removeEventListener = vi.fn((type: string, listener: EventListener) => {
      this.listeners.get(type)?.delete(listener)
    })
    readonly send = vi.fn()
    readonly close = vi.fn(() => {
      this.closed = true
    })
    readonly terminate = vi.fn(() => {
      this.terminated = true
    })
    readonly listeners = new Map<string, Set<EventListener>>()
    closed = false
    terminated = false

    constructor(readonly url: string) {
      wsInstances.push(this)
    }

    emit(type: string, event?: Event) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(event ?? new Event(type))
      }
    }
  }

  return {
    wsInstances,
    MockWebSocket
  }
})

vi.mock('undici', () => ({
  WebSocket: MockWebSocket
}))

import { QQBotGatewaySession } from '@/presenter/remoteControlPresenter/qqbot/qqbotGatewaySession'

describe('QQBotGatewaySession', () => {
  beforeEach(() => {
    wsInstances.length = 0
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('fully tears down failed connection attempts', async () => {
    const client = {
      getGatewayUrl: vi.fn().mockResolvedValue('wss://qqbot.example/gateway'),
      getAccessToken: vi.fn()
    }
    const onDispatch = vi.fn()
    const session = new QQBotGatewaySession({
      client: client as any,
      onDispatch
    })
    const abortController = new AbortController()
    const addAbortSpy = vi.spyOn(abortController.signal, 'addEventListener')
    const removeAbortSpy = vi.spyOn(abortController.signal, 'removeEventListener')

    const startPromise = session.start(abortController.signal)
    await Promise.resolve()
    expect(wsInstances).toHaveLength(1)

    const ws = wsInstances[0]
    ws.emit('error')

    await expect(startPromise).rejects.toThrow('QQBot gateway transport error.')

    const abortListener = addAbortSpy.mock.calls.find((call) => call[0] === 'abort')?.[1]
    expect(abortListener).toBeTypeOf('function')
    expect(removeAbortSpy).toHaveBeenCalledWith('abort', abortListener)
    expect(ws.removeEventListener).toHaveBeenCalledWith('open', expect.any(Function))
    expect(ws.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function))
    expect(ws.removeEventListener).toHaveBeenCalledWith('error', expect.any(Function))
    expect(ws.removeEventListener).toHaveBeenCalledWith('close', expect.any(Function))
    expect(ws.terminate).toHaveBeenCalledTimes(1)

    abortController.abort()
    expect(ws.terminate).toHaveBeenCalledTimes(1)
    expect(onDispatch).not.toHaveBeenCalled()
  })

  it('rejects immediately when start receives an already aborted signal', async () => {
    const client = {
      getGatewayUrl: vi.fn(),
      getAccessToken: vi.fn()
    }
    const session = new QQBotGatewaySession({
      client: client as any,
      onDispatch: vi.fn()
    })
    const abortController = new AbortController()
    abortController.abort()

    await expect(session.start(abortController.signal)).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(wsInstances).toHaveLength(0)
  })

  it('cancels reconnect backoff when stop is called before the first connection settles', async () => {
    vi.useFakeTimers()

    const client = {
      getGatewayUrl: vi.fn(),
      getAccessToken: vi.fn()
    }
    const session = new QQBotGatewaySession({
      client: client as any,
      onDispatch: vi.fn()
    })
    ;(session as any).startedOnce = true
    ;(session as any).connectOnce = vi.fn().mockRejectedValue(new Error('transient failure'))

    const startPromise = session.start()
    await Promise.resolve()
    await Promise.resolve()

    const stopPromise = session.stop()

    await expect(stopPromise).resolves.toBeUndefined()
    await expect(startPromise).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect((session as any).connectOnce).toHaveBeenCalledTimes(1)
  })
})
