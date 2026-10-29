import { EventEmitter } from 'node:events'
import { BrowserWindow } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopRemoteAuthWindows } from '@/desktop/remoteAuthWindows'

const input = {
  id: 'feishu:one',
  kind: 'feishu' as const,
  url: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
  brand: 'feishu' as const,
  redirectUri: 'http://127.0.0.1:9911/callback'
}

const fixture = () => {
  const events = new EventEmitter()
  const webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() })
  const window = Object.assign(events, {
    webContents,
    loadURL: vi.fn(async (_url: string) => {}),
    show: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    destroy: vi.fn(() => {
      events.emit('closed')
    })
  })
  Object.assign(BrowserWindow, {
    getFocusedWindow: vi.fn(() => null),
    getAllWindows: vi.fn(() => [])
  })
  vi.mocked(BrowserWindow).mockImplementation(function () {
    return window as unknown as BrowserWindow
  })
  const publish = vi.fn()
  return { window, publish, host: new DesktopRemoteAuthWindows(publish) }
}

afterEach(() => vi.restoreAllMocks())

describe('DesktopRemoteAuthWindows', () => {
  it('preserves native isolation, brand/redirect navigation and popup denial', async () => {
    const { host, window } = fixture()
    await expect(host.open({ ...input, url: 'https://untrusted.invalid/' })).rejects.toThrow(
      'Invalid'
    )
    await host.open(input)
    expect(BrowserWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({
        webPreferences: { nodeIntegration: false, contextIsolation: true, webSecurity: true }
      })
    )
    const preventDefault = vi.fn()
    window.webContents.emit('will-navigate', { preventDefault }, 'https://untrusted.invalid/')
    expect(preventDefault).toHaveBeenCalledOnce()
    preventDefault.mockClear()
    window.webContents.emit('will-navigate', { preventDefault }, `${input.redirectUri}?code=one`)
    expect(preventDefault).not.toHaveBeenCalled()
    const popup = window.webContents.setWindowOpenHandler.mock.calls[0][0]
    expect(popup({ url: 'https://accounts.larksuite.com/' })).toEqual({ action: 'deny' })
    expect(window.loadURL).toHaveBeenCalledTimes(1)
    expect(popup({ url: 'https://open.feishu.cn/auth' })).toEqual({ action: 'deny' })
    expect(window.loadURL).toHaveBeenLastCalledWith('https://open.feishu.cn/auth')
    await host.closeAll()
  })

  it('acknowledges physical close and ignores a late navigation failure from the closed window', async () => {
    const { host, window, publish } = fixture()
    const loading = Promise.withResolvers<void>()
    window.loadURL.mockReturnValueOnce(loading.promise)
    window.destroy.mockImplementation(() => {})
    await host.open(input)
    let closed = false
    const closing = host.close(input.id).then(() => {
      closed = true
    })
    loading.reject(Object.assign(new Error('navigation cancelled'), { code: 'ERR_FAILED' }))
    await Promise.resolve()
    expect(closed).toBe(false)
    expect(publish).not.toHaveBeenCalled()
    window.emit('closed')
    await closing
    expect(publish.mock.calls).toEqual([[{ id: input.id, type: 'closed' }]])
  })

  it('reports a navigation failure while the auth window is still active', async () => {
    const { host, window, publish } = fixture()
    window.loadURL.mockRejectedValueOnce(new Error('connection refused'))
    await host.open(input)
    await vi.waitFor(() => expect(publish).toHaveBeenCalledWith({ id: input.id, type: 'error' }))
    await host.closeAll()
  })
})
