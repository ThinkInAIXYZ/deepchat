import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  NativeWindowCommand,
  NativeWindowDescriptor
} from '@/platform/node/nativeWindowProtocol'

const channel = 'test:native-window-command'
const bounds = { width: 1300, height: 800, minWidth: 900, minHeight: 640, x: 0, y: 0 }

function state(
  windowId: number,
  role: 'main' | 'settings',
  overrides: Partial<NativeWindowDescriptor> = {}
): NativeWindowDescriptor {
  return {
    windowId,
    role,
    documentUrl: role === 'main' ? 'mygo://localhost/' : 'mygo://localhost/settings/index.html',
    visible: true,
    focused: false,
    ...overrides
  }
}

describe('native window command identity and lifecycle', () => {
  let shim: typeof import('@/platform/node/electron')
  let host: typeof import('@/platform/node/appHost')
  let commands: typeof import('@/platform/node/nativeWindowCommands')
  let primary: import('electron').BrowserWindow

  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv('DEEPCHAT_NATIVE_WINDOW_ID', '1')
    shim = await import('@/platform/node/electron')
    host = await import('@/platform/node/appHost')
    commands = await import('@/platform/node/nativeWindowCommands')
    primary = new shim.BrowserWindow({})
    host.nodeAppHost.registerNativePrimaryWindow!(primary)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('preserves each asynchronous IPC caller outside its renderer input', async () => {
    const mainSource = { windowId: primary.id, documentUrl: 'mygo://localhost/index.html#/chat' }
    const secondary = new shim.BrowserWindow({})
    host.nodeAppHost.registerNativeWindow!(secondary, state(7, 'settings'))
    const settingsSource = {
      windowId: secondary.id,
      documentUrl: 'mygo://localhost/settings/index.html#/common'
    }
    const sent: NativeWindowCommand[] = []
    commands.configureNativeWindowCommands((command) => sent.push(command))
    shim.ipcMain.handle(channel, async (_event, input: unknown) => {
      await Promise.resolve()
      const created = await host.nodeAppHost.createNativeSettingsWindow!(bounds)
      return { createdId: created.windowId, input }
    })

    const mainCall = shim.invokeIpc(
      channel,
      [{ source: { windowId: 999, documentUrl: 'https://example.com/' } }],
      mainSource
    )
    const settingsCall = shim.invokeIpc(channel, [{ source: {} }], settingsSource)
    await vi.waitFor(() => expect(sent).toHaveLength(2))

    expect(sent.map((command) => command.id)).toEqual([-1, -2])
    expect(sent[0].source).toEqual(mainSource)
    expect(sent[1].source).toEqual(settingsSource)
    expect(sent.every((command) => !('source' in command.input))).toBe(true)
    expect(commands.resolveNativeWindowCommand(sent[0].id, state(11, 'settings'), undefined)).toBe(
      true
    )
    await expect(mainCall).resolves.toEqual({
      handled: true,
      value: {
        createdId: 11,
        input: { source: { windowId: 999, documentUrl: 'https://example.com/' } }
      }
    })
    expect(commands.resolveNativeWindowCommand(sent[1].id, state(11, 'settings'), undefined)).toBe(
      true
    )
    await expect(settingsCall).resolves.toEqual({
      handled: true,
      value: { createdId: 11, input: { source: {} } }
    })
    expect(commands.resolveNativeWindowCommand(sent[0].id, state(11, 'settings'), undefined)).toBe(
      false
    )
  })

  it('routes native focus and closed only to their existing binding', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    shim.handleNativeWindowNotification(
      'native.window.ready',
      state(primary.id, 'main'),
      primary.id
    )
    const secondary = new shim.BrowserWindow({})
    host.nodeAppHost.registerNativeWindow!(secondary, state(7, 'settings'))

    shim.handleNativeWindowNotification(
      'native.window.focused',
      state(7, 'settings', { focused: true }),
      secondary.id
    )
    expect(secondary.isFocused()).toBe(true)
    expect(primary.isFocused()).toBe(false)
    expect(shim.BrowserWindow.getFocusedWindow()?.id).toBe(secondary.id)

    expect(() =>
      shim.handleNativeWindowNotification('native.window.ready', state(7, 'settings'), primary.id)
    ).toThrow('source does not match')
    expect(commands.cachedNativeWindowState(primary.id)?.role).toBe('main')

    shim.handleNativeWindowNotification('native.window.ready', state(900, 'settings'), 900)
    expect(shim.BrowserWindow.fromId(900)).toBeNull()
    expect(commands.cachedNativeWindowState(900)?.windowId).toBe(900)

    const closed = vi.fn()
    secondary.on('closed', closed)
    shim.handleNativeWindowNotification(
      'native.window.closed',
      state(7, 'settings', { documentUrl: '', visible: false }),
      7
    )
    expect(secondary.isDestroyed()).toBe(true)
    expect(primary.isDestroyed()).toBe(false)
    expect(closed).toHaveBeenCalledTimes(1)
    expect(commands.cachedNativeWindowState(7)).toBeUndefined()
    expect(commands.cachedNativeWindowState(primary.id)?.windowId).toBe(primary.id)
    expect(shim.BrowserWindow.getAllWindows().map((window) => window.id)).toEqual([primary.id])

    shim.handleNativeWindowNotification(
      'native.window.ready',
      state(7, 'settings', { sequence: 1 }),
      7
    )
    expect(shim.BrowserWindow.fromId(7)).toBeNull()
    expect(commands.cachedNativeWindowState(7)).toBeUndefined()

    shim.handleNativeWindowNotification(
      'native.window.closed',
      state(7, 'settings', { documentUrl: '', visible: false }),
      7
    )
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('keeps close pending through old acknowledgements and newer focus events', async () => {
    const sent: NativeWindowCommand[] = []
    commands.configureNativeWindowCommands((command) => sent.push(command))
    const window = new shim.BrowserWindow({})
    host.nodeAppHost.registerNativeWindow!(window, state(7, 'settings', { sequence: 3 }))
    window.destroy()
    expect(window.isDestroyed()).toBe(false)
    shim.handleNativeWindowNotification(
      'native.window.focused',
      state(7, 'settings', { sequence: 4, focused: false }),
      7
    )
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(
      commands.resolveNativeWindowCommand(
        sent[0].id,
        state(7, 'settings', {
          sequence: 0,
          documentUrl: '',
          visible: false,
          closeRequested: true
        }),
        undefined
      )
    ).toBe(true)
    expect(commands.cachedNativeWindowState(7)).toMatchObject({
      closeRequested: true,
      sequence: 4
    })
    const waiting = host.nodeAppHost.closeNativeSettingsWindow!(window.id)
    const settled = vi.fn()
    void waiting.then(() => settled(), settled)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    expect((window as any).getNativeWindowState().closeRequested).toBe(true)
    shim.handleNativeWindowNotification(
      'native.window.closed',
      state(7, 'settings', { sequence: 5, documentUrl: '', visible: false }),
      7
    )
    await expect(waiting).resolves.toBeUndefined()
    expect(settled).toHaveBeenCalledOnce()
    expect(settled.mock.calls[0]).toHaveLength(0)
    expect(window.isDestroyed()).toBe(true)
    expect(sent).toHaveLength(1)
  })

  it('rolls back a failed close after a newer focus notification and allows retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const sent: NativeWindowCommand[] = []
    commands.configureNativeWindowCommands((command) => sent.push(command))
    const window = new shim.BrowserWindow({})
    host.nodeAppHost.registerNativeWindow!(window, state(7, 'settings', { sequence: 3 }))
    window.destroy()
    shim.handleNativeWindowNotification(
      'native.window.focused',
      state(7, 'settings', { sequence: 4, focused: false }),
      7
    )
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(commands.resolveNativeWindowCommand(sent[0].id, undefined, 'close rejected')).toBe(true)
    await vi.waitFor(() => expect(commands.isNativeWindowClosing(7)).toBe(false))
    expect(commands.cachedNativeWindowState(7)).toMatchObject({
      sequence: 4,
      focused: false,
      closeRequested: false
    })
    expect(window.isDestroyed()).toBe(false)

    window.destroy()
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    expect(sent[1]).toMatchObject({ host: true, input: { action: 'close', windowId: 7 } })
    expect(
      commands.resolveNativeWindowCommand(
        sent[1].id,
        state(7, 'settings', {
          sequence: 4,
          documentUrl: '',
          visible: false,
          closeRequested: true
        }),
        undefined
      )
    ).toBe(true)
    shim.handleNativeWindowNotification(
      'native.window.closed',
      state(7, 'settings', { sequence: 5, documentUrl: '', visible: false }),
      7
    )
    await vi.waitFor(() => expect(window.isDestroyed()).toBe(true))
  })

  it('destroys a blank settings window without inheriting an IPC caller', async () => {
    const sent: NativeWindowCommand[] = []
    commands.configureNativeWindowCommands((command) => sent.push(command))
    const window = new shim.BrowserWindow({})
    host.nodeAppHost.registerNativeWindow!(
      window,
      state(9, 'settings', { documentUrl: 'about:blank' })
    )
    commands.runWithNativeCaller(
      { windowId: primary.id, documentUrl: 'mygo://localhost/#/obsolete' },
      () => window.destroy()
    )
    expect(window.isDestroyed()).toBe(false)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({
      host: true,
      input: { action: 'close', windowId: 9 }
    })
    expect(sent[0].source).toBeUndefined()
    expect(
      commands.resolveNativeWindowCommand(
        sent[0].id,
        state(9, 'settings', { documentUrl: '', visible: false, closeRequested: true }),
        undefined
      )
    ).toBe(true)
    shim.handleNativeWindowNotification(
      'native.window.closed',
      state(9, 'settings', { documentUrl: '', visible: false }),
      9
    )
    expect(window.isDestroyed()).toBe(true)
    expect(shim.BrowserWindow.fromId(9)).toBeNull()
  })

  it('uses the explicit host domain for direct failure compensation inside IPC', async () => {
    const sent: NativeWindowCommand[] = []
    commands.configureNativeWindowCommands((command) => sent.push(command))
    const window = new shim.BrowserWindow({})
    const descriptor = state(9, 'settings', { documentUrl: 'about:blank' })
    commands.recordNativeWindowState(descriptor)
    host.nodeAppHost.registerNativeWindow!(window, descriptor)
    expect(window.id).toBe(9)
    expect(commands.cachedNativeWindowState(9)).toMatchObject({ role: 'settings' })
    const closing = commands.runWithNativeCaller(
      { windowId: primary.id, documentUrl: 'mygo://localhost/#/obsolete' },
      () => host.nodeAppHost.closeNativeSettingsWindow!(window.id)
    )
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({ host: true, input: { action: 'close', windowId: 9 } })
    expect(sent[0].source).toBeUndefined()
    expect(
      commands.resolveNativeWindowCommand(
        sent[0].id,
        state(9, 'settings', { documentUrl: '', visible: false, closeRequested: true }),
        undefined
      )
    ).toBe(true)
    shim.handleNativeWindowNotification(
      'native.window.closed',
      state(9, 'settings', { documentUrl: '', visible: false }),
      9
    )
    await expect(closing).resolves.toBeUndefined()
    expect(window.isDestroyed()).toBe(true)
  })

  it('rejects unbound navigation and uses an explicit host principal outside IPC', async () => {
    const send = vi.fn()
    commands.configureNativeWindowCommands(send)
    const window = new shim.BrowserWindow({})
    await expect(window.webContents.loadURL('https://example.com/')).rejects.toThrow(
      'bound native window'
    )
    const created = host.nodeAppHost.createNativeSettingsWindow!(bounds)
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        id: -1,
        host: true,
        input: expect.objectContaining({ action: 'ensure_settings' })
      })
    )
    expect(send.mock.calls[0][0].source).toBeUndefined()
    expect(commands.resolveNativeWindowCommand(-1, state(11, 'settings'), undefined)).toBe(true)
    await expect(created).resolves.toMatchObject({ windowId: 11 })
  })

  it('focuses the application using the verified IPC caller or explicit host principal', async () => {
    const sent: NativeWindowCommand[] = []
    commands.configureNativeWindowCommands((command) => sent.push(command))
    shim.handleNativeWindowNotification(
      'native.window.ready',
      state(primary.id, 'main'),
      primary.id
    )
    shim.app.focus()
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({ id: -1, input: { action: 'focus_app' } })
    expect(sent[0].host).toBe(true)
    expect(sent[0].source).toBeUndefined()
    expect(commands.resolveNativeWindowCommand(-1, null, undefined)).toBe(true)

    shim.ipcMain.handle(channel, () => shim.app.focus())
    const call = shim.invokeIpc(channel, [], {
      windowId: primary.id,
      documentUrl: 'mygo://localhost/#/chat'
    })
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    expect(sent[1]).toMatchObject({ id: -2, input: { action: 'focus_app' } })
    expect(sent[1].source).toEqual({
      windowId: primary.id,
      documentUrl: 'mygo://localhost/#/chat'
    })
    expect(commands.resolveNativeWindowCommand(-2, null, undefined)).toBe(true)
    await expect(call).resolves.toEqual({ handled: true, value: undefined })
  })
})
