import { createBridge } from '../../../src/preload/createBridge'
import { DEEPCHAT_EVENT_CHANNEL, DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '@shared/contracts/channels'

describe('createBridge', () => {
  it('invokes typed routes through the shared IPC channel', async () => {
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue({
        version: 1,
        values: {
          fontSizeLevel: 2
        }
      }),
      on: vi.fn(),
      removeListener: vi.fn()
    }

    const bridge = createBridge(ipcRenderer)
    const result = await bridge.invoke('settings.getSnapshot', {
      keys: ['fontSizeLevel']
    })

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      DEEPCHAT_ROUTE_INVOKE_CHANNEL,
      'settings.getSnapshot',
      {
        keys: ['fontSizeLevel']
      }
    )
    expect(result).toEqual({
      version: 1,
      values: {
        fontSizeLevel: 2
      }
    })
  })

  it('validates typed event payloads before calling listeners', () => {
    let registeredListener: ((event: unknown, payload: unknown) => void) | undefined

    const ipcRenderer = {
      invoke: vi.fn(),
      on: vi.fn((_channel: string, listener: (event: unknown, payload: unknown) => void) => {
        registeredListener = listener
      }),
      removeListener: vi.fn()
    }

    const bridge = createBridge(ipcRenderer)
    const listener = vi.fn()
    const unsubscribe = bridge.on('settings.changed', listener)

    expect(ipcRenderer.on).toHaveBeenCalledWith(DEEPCHAT_EVENT_CHANNEL, expect.any(Function))

    registeredListener?.(
      {},
      {
        name: 'settings.changed',
        payload: {
          changedKeys: ['fontSizeLevel'],
          version: 1,
          values: {
            fontSizeLevel: 3
          }
        }
      }
    )

    expect(listener).toHaveBeenCalledWith({
      changedKeys: ['fontSizeLevel'],
      version: 1,
      values: {
        fontSizeLevel: 3
      }
    })

    unsubscribe()

    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      DEEPCHAT_EVENT_CHANNEL,
      expect.any(Function)
    )
  })

  it('shares a single IPC listener across multiple typed event subscriptions', () => {
    let registeredListener: ((event: unknown, payload: unknown) => void) | undefined

    const ipcRenderer = {
      invoke: vi.fn(),
      on: vi.fn((_channel: string, listener: (event: unknown, payload: unknown) => void) => {
        registeredListener = listener
      }),
      removeListener: vi.fn()
    }

    const bridge = createBridge(ipcRenderer)
    const firstListener = vi.fn()
    const secondListener = vi.fn()

    const unsubscribeFirst = bridge.on('settings.changed', firstListener)
    const unsubscribeSecond = bridge.on('settings.changed', secondListener)

    expect(ipcRenderer.on).toHaveBeenCalledTimes(1)

    registeredListener?.(
      {},
      {
        name: 'settings.changed',
        payload: {
          changedKeys: ['fontSizeLevel'],
          version: 1,
          values: {
            fontSizeLevel: 3
          }
        }
      }
    )

    expect(firstListener).toHaveBeenCalledTimes(1)
    expect(secondListener).toHaveBeenCalledTimes(1)

    unsubscribeFirst()
    expect(ipcRenderer.removeListener).not.toHaveBeenCalled()

    unsubscribeSecond()
    expect(ipcRenderer.removeListener).toHaveBeenCalledTimes(1)
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      DEEPCHAT_EVENT_CHANNEL,
      expect.any(Function)
    )
  })

  it('rejects invalid route responses', async () => {
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue({
        stopped: 'yes'
      }),
      on: vi.fn(),
      removeListener: vi.fn()
    }

    const bridge = createBridge(ipcRenderer)

    await expect(
      bridge.invoke('chat.stopStream', {
        sessionId: 'session-1'
      })
    ).rejects.toThrow()
  })
})
