import { createBridge } from '../../../src/preload/createBridge'
import { stringifyDeepchatJson } from '@shared/deepchatJson'
import { DEEPCHAT_EVENT_CHANNEL, DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '@shared/contracts/channels'
import { afterEach } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
})

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

  it('drops invalid event payloads without throwing from the shared dispatcher', () => {
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
    const listener = vi.fn()
    bridge.on('sessions.compaction.changed', listener)

    expect(() =>
      registeredListener?.(
        {},
        {
          name: 'sessions.compaction.changed',
          payload: {
            sessionId: 'session-1',
            status: 'compacted',
            cursorOrderSeq: 2,
            summaryUpdatedAt: null,
            boundaryReason: null,
            emitSeq: 0,
            latestAnchorEntryId: null
          }
        }
      )
    ).not.toThrow()
    expect(listener).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[DeepchatBridge] Invalid event payload for sessions.compaction.changed:',
      expect.any(Error)
    )
  })

  it('preserves marker-shaped JSON in native validated event payloads', () => {
    let registeredListener: ((event: unknown, payload: unknown) => void) | undefined
    const ipcRenderer = {
      invoke: vi.fn(),
      on: vi.fn((_channel: string, listener: (event: unknown, payload: unknown) => void) => {
        registeredListener = listener
      }),
      removeListener: vi.fn()
    }
    const bridge = createBridge(ipcRenderer, { jsonTransport: true })
    const listener = vi.fn()
    bridge.on('mcp.elicitation.request', listener)
    const payload = {
      request: {
        requestId: 'request-1',
        serverName: 'server-1',
        mode: 'form' as const,
        message: 'Choose a value',
        requestedSchema: {
          __deepchatDate: 'date',
          value: '2026-01-02T03:04:05.006Z'
        }
      },
      version: 1
    }

    registeredListener?.(
      {},
      {
        name: 'mcp.elicitation.request',
        payload: JSON.parse(stringifyDeepchatJson(payload))
      }
    )

    expect(listener).toHaveBeenCalledWith(payload)
  })

  it('revives marker-shaped MCP data before stream snapshot validation', () => {
    let registeredListener: ((event: unknown, payload: unknown) => void) | undefined
    const ipcRenderer = {
      invoke: vi.fn(),
      on: vi.fn((_channel: string, listener: (event: unknown, payload: unknown) => void) => {
        registeredListener = listener
      }),
      removeListener: vi.fn()
    }
    const bridge = createBridge(ipcRenderer, { jsonTransport: true })
    const listener = vi.fn()
    bridge.on('chat.stream.updated', listener)
    const payload = {
      sessionId: 'session-1',
      requestId: 'request-1',
      blocks: [
        {
          type: 'tool_call',
          status: 'success',
          timestamp: 1,
          tool_call: {
            id: 'call-1',
            name: 'demo',
            mcpResult: {
              schemaVersion: 1,
              serverId: 'server-1',
              configGeneration: 1,
              bindingHash: 'binding',
              toolName: 'demo',
              structuredContent: {
                __deepchatDate: 'date',
                value: '2026-01-02T03:04:05.006Z'
              }
            }
          }
        }
      ]
    }

    registeredListener?.(
      {},
      {
        name: 'chat.stream.updated',
        payload: JSON.parse(stringifyDeepchatJson(payload))
      }
    )

    expect(listener).toHaveBeenCalledWith(payload)
  })

  it('does not revive marker-shaped objects from Electron structured clone', () => {
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
    bridge.on('mcp.elicitation.request', listener)
    const payload = {
      request: {
        requestId: 'request-1',
        serverName: 'server-1',
        mode: 'form' as const,
        message: 'Choose a value',
        requestedSchema: {
          __deepchatDate: 'date',
          value: '2026-01-02T03:04:05.006Z'
        }
      },
      version: 1
    }

    registeredListener?.({}, { name: 'mcp.elicitation.request', payload })

    expect(listener).toHaveBeenCalledWith(payload)
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
