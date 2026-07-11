import { createBridge } from '../../../src/preload/createBridge'
import { DEEPCHAT_EVENT_CHANNEL, DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '@shared/contracts/channels'
import { afterEach } from 'vitest'
import { sessionsCreateRoute } from '@shared/contracts/routes'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createBridge', () => {
  it('preserves all session create domain variants across serialization and contract parsing', async () => {
    const operation = {
      operationId: '00000000-0000-4000-8000-000000000001',
      sessionId: 'session-1',
      state: 'unknown' as const,
      stage: 'input_accepted' as const,
      code: 'CREATE_SESSION_CLEANUP_UNCERTAIN' as const,
      dismissedAt: 12,
      createdAt: 10,
      updatedAt: 12
    }
    const outputs = [
      { kind: 'operation' as const, operation, session: null },
      {
        kind: 'existing' as const,
        code: 'CREATE_OPERATION_EXISTS' as const,
        operation
      },
      {
        kind: 'conflict' as const,
        code: 'CREATE_OPERATION_CONFLICT' as const,
        operation
      }
    ]

    for (const output of outputs) {
      const ipcRenderer = {
        invoke: vi.fn(async (_channel: string, routeName: string) => {
          expect(routeName).toBe(sessionsCreateRoute.name)
          return structuredClone(sessionsCreateRoute.output.parse(output))
        }),
        on: vi.fn(),
        removeListener: vi.fn()
      }
      const bridge = createBridge(ipcRenderer)

      await expect(
        bridge.invoke('sessions.create', {
          operationId: '00000000-0000-4000-8000-000000000002',
          agentId: 'deepchat',
          message: 'private payload is not returned'
        })
      ).resolves.toEqual(output)
    }
  })

  it('does not depend on custom Error fields lost at the Electron boundary', async () => {
    const ipcRenderer = {
      invoke: vi.fn(async () => {
        const mainError = Object.assign(new Error('main failure'), {
          code: 'CREATE_OPERATION_CONFLICT',
          operationId: 'private-main-field'
        })
        throw new Error(mainError.message)
      }),
      on: vi.fn(),
      removeListener: vi.fn()
    }
    const bridge = createBridge(ipcRenderer)

    const rejection = await bridge
      .invoke('sessions.create', {
        operationId: '00000000-0000-4000-8000-000000000002',
        agentId: 'deepchat',
        message: 'hello'
      })
      .catch((error: Error & { code?: string; operationId?: string }) => error)

    expect(rejection).toMatchObject({ message: 'main failure' })
    expect(rejection.code).toBeUndefined()
    expect(rejection.operationId).toBeUndefined()
  })

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

  it('continues dispatching when one event listener throws', () => {
    let registeredListener: ((event: unknown, payload: unknown) => void) | undefined
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const ipcRenderer = {
      invoke: vi.fn(),
      on: vi.fn((_channel: string, listener: (event: unknown, payload: unknown) => void) => {
        registeredListener = listener
      }),
      removeListener: vi.fn()
    }

    const bridge = createBridge(ipcRenderer)
    const failingListener = vi.fn(() => {
      throw new Error('listener failed')
    })
    const succeedingListener = vi.fn()

    bridge.on('settings.changed', failingListener)
    bridge.on('settings.changed', succeedingListener)

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

    expect(failingListener).toHaveBeenCalledTimes(1)
    expect(succeedingListener).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[DeepchatBridge] Event listener failed for settings.changed:',
      expect.any(Error)
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
