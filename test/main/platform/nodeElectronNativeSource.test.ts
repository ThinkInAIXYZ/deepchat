import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

const channel = 'test:native-source'

function registerPrimary(
  shim: typeof import('@/platform/node/electron'),
  host: typeof import('@/platform/node/appHost')
) {
  const window = new shim.BrowserWindow({})
  host.nodeAppHost.registerNativePrimaryWindow!(window)
  return window
}

describe('native IPC caller identity', () => {
  let shim: typeof import('@/platform/node/electron')
  let host: typeof import('@/platform/node/appHost')

  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv('DEEPCHAT_NATIVE_WINDOW_ID', '1')
    shim = await import('@/platform/node/electron')
    host = await import('@/platform/node/appHost')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('uses the registered main receiver after splash has closed', async () => {
    const splash = new shim.BrowserWindow({})
    const primary = registerPrimary(shim, host)
    expect(primary.id).not.toBe(splash.id)
    expect(primary.webContents.id).not.toBe(splash.webContents.id)
    splash.close()

    const source = { windowId: primary.id, documentUrl: 'mygo://localhost/index.html#/chat' }
    shim.ipcMain.handle(channel, (rawEvent) => {
      const event = rawEvent as IpcMainInvokeEvent
      return {
        windowId: shim.BrowserWindow.fromWebContents(event.sender)?.id,
        webContentsId: event.sender.id,
        documentUrl: event.senderFrame.url,
        topLevel: event.senderFrame === event.sender.mainFrame
      }
    })

    await expect(shim.invokeIpc(channel, [], source)).resolves.toEqual({
      handled: true,
      value: {
        windowId: primary.id,
        webContentsId: primary.webContents.id,
        documentUrl: source.documentUrl,
        topLevel: true
      }
    })
  })

  it('rejects missing, unknown and destroyed sources without fabricating webContents', async () => {
    const primary = registerPrimary(shim, host)
    shim.ipcMain.handle(channel, () => 'unreachable')
    await expect(shim.invokeIpc(channel, [])).rejects.toThrow('native window source')
    await expect(
      shim.invokeIpc(channel, [], { windowId: 999, documentUrl: 'mygo://localhost/' })
    ).rejects.toThrow()
    expect(shim.webContents.getAllWebContents()).toHaveLength(1)

    await expect(
      shim.invokeIpc(channel, [], {
        windowId: primary.id,
        documentUrl: 'mygo://localhost/'
      })
    ).resolves.toEqual({ handled: true, value: 'unreachable' })
    primary.destroy()
    await expect(
      shim.invokeIpc(channel, [], {
        windowId: primary.id,
        documentUrl: 'mygo://localhost/'
      })
    ).rejects.toThrow()
  })

  it('routes events only from the bound window and reports unbound sends once each', async () => {
    const primary = registerPrimary(shim, host)
    const secondary = new shim.BrowserWindow({})
    shim.ipcMain.handle(channel, () => 'routed')
    await expect(
      shim.invokeIpc(channel, [], {
        windowId: primary.id + 1,
        documentUrl: 'mygo://localhost/settings/index.html'
      })
    ).rejects.toThrow()

    const events: Array<{ name: string; windowId: number | undefined }> = []
    const warning = vi.spyOn(console, 'error').mockImplementation(() => {})
    shim.installElectronShimHooks({
      sendEvent: (name, _payload, windowId) => events.push({ name, windowId })
    })
    primary.webContents.send('deepchat:event', {
      name: 'settings.changed',
      payload: { theme: 'dark' }
    })
    for (let index = 0; index < 3; index++) {
      secondary.webContents.send('deepchat:event', {
        name: 'settings.changed',
        payload: { theme: 'dark' }
      })
    }
    new shim.WebContentsView({}).webContents.send('deepchat:event', {
      name: 'settings.changed',
      payload: { theme: 'dark' }
    })
    expect(events).toEqual([{ name: 'settings.changed', windowId: primary.id }])
    expect(warning).toHaveBeenCalledTimes(2)
  })

  it('delivers early events from the explicitly registered primary window', () => {
    const targets: number[] = []
    shim.installElectronShimHooks({
      sendEvent: (_name, _payload, windowId) => targets.push(windowId!)
    })
    const primary = registerPrimary(shim, host)
    primary.webContents.send('deepchat:event', {
      name: 'config.theme.changed',
      payload: { theme: 'light', isDark: false, version: 1 }
    })
    expect(targets).toEqual([primary.id])
  })

  it('rejects missing native identity and a second live owner for the same ID', () => {
    const primary = registerPrimary(shim, host)
    const other = new shim.BrowserWindow({})
    expect(() => host.nodeAppHost.registerNativePrimaryWindow!(other)).toThrow()
    vi.stubEnv('DEEPCHAT_NATIVE_WINDOW_ID', '')
    const unbound = new shim.BrowserWindow({})
    expect(() => host.nodeAppHost.registerNativePrimaryWindow!(unbound)).toThrow('required')
    expect(unbound.id).toBeLessThan(0)
  })
})
