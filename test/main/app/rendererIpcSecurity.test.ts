import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  BrowserWindow,
  clipboard,
  nativeImage,
  type IpcMain,
  type IpcMainInvokeEvent
} from 'electron'
import { createRendererIpcAuthorizer } from '@/app/rendererIpcSecurity'
import { registerClipboardIpc } from '@/app/clipboardIpc'
import { registerDeepchatRoutes } from '@/app/routeIpc'
import { CLIPBOARD_IPC_CHANNELS } from '@shared/clipboardChannels'
import { DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '@shared/contracts/channels'

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
  clipboard: { writeText: vi.fn(), writeImage: vi.fn(), readText: vi.fn() },
  nativeImage: { createFromDataURL: vi.fn() }
}))

const rendererDirectoryUrl = pathToFileURL(path.resolve('out/renderer') + path.sep).href
const appUrl = new URL('index.html', rendererDirectoryUrl).href

function eventFor(url = appUrl) {
  const mainFrame = { url }
  return {
    senderFrame: mainFrame,
    sender: {
      id: 42,
      mainFrame,
      isDestroyed: () => false,
      getURL: () => url
    }
  } as unknown as IpcMainInvokeEvent
}

const authorize = createRendererIpcAuthorizer({
  rendererDirectoryUrl,
  developmentServerUrl: 'http://localhost:5173',
  pluginSettingsWindow: { getPluginIdForWebContents: (id) => (id === 42 ? 'plugin-a' : null) }
})

describe('native renderer document boundary', () => {
  it.each([
    appUrl,
    `${appUrl}?window=2#/chat`,
    new URL('settings/index.html#/providers', rendererDirectoryUrl).href,
    'http://localhost:5173/#/chat',
    'http://localhost:5173/index.html#/chat',
    'http://localhost:5173/settings/index.html#/providers'
  ])('accepts an app entry document: %s', (url) => {
    expect(() => authorize(eventFor(url), 'mcp.startServer')).not.toThrow()
    expect(() => authorize(eventFor(url))).not.toThrow()
  })

  it.each([
    'about:blank',
    'about:srcdoc',
    'data:text/html,<script></script>',
    'blob:http://localhost:5173/preview',
    'workspace-preview://root/index.html',
    'http://localhost:5173/preview.html',
    'http://localhost:5173.evil.test/index.html',
    'http://localhost:5174/index.html',
    'http://user@localhost:5173/index.html',
    `${appUrl}/preview.html`,
    new URL('preview.html', rendererDirectoryUrl).href,
    'file:///tmp/index.html',
    'not a URL'
  ])('rejects unrelated documents despite the app preload: %s', (url) => {
    expect(() => authorize(eventFor(url), 'mcp.startServer')).toThrow('Native IPC')
  })

  it('does not enable the development origin without explicit configuration', () => {
    const packagedAuthorize = createRendererIpcAuthorizer({
      rendererDirectoryUrl,
      pluginSettingsWindow: { getPluginIdForWebContents: () => null }
    })
    expect(() => packagedAuthorize(eventFor('http://localhost:5173/'))).toThrow('Native IPC')
  })

  it('rejects a same-origin child, missing frame, destroyed sender, and stale document', () => {
    const child = eventFor()
    Object.defineProperty(child, 'senderFrame', { value: { url: appUrl } })
    expect(() => authorize(child)).toThrow('top-level')
    const missing = eventFor()
    Object.defineProperty(missing, 'senderFrame', { value: null })
    expect(() => authorize(missing)).toThrow('top-level')
    const destroyed = eventFor()
    destroyed.sender.isDestroyed = () => true
    expect(() => authorize(destroyed)).toThrow('top-level')
    const navigated = eventFor()
    navigated.sender.getURL = () => 'https://example.com/'
    expect(() => authorize(navigated)).toThrow('current app document')
  })

  it.each([
    new URL('splash/index.html', rendererDirectoryUrl).href,
    'http://localhost:5173/splash/index.html',
    'http://localhost:5173/splash/'
  ])('limits splash to its language lookup: %s', (url) => {
    const event = eventFor(url)
    expect(() => authorize(event, 'config.getLanguage')).not.toThrow()
    expect(() => authorize(event, 'mcp.startServer')).toThrow('Native IPC')
    expect(() => authorize(event)).toThrow('Native IPC')
  })

  it('limits registered plugin settings to their existing routes', () => {
    const event = eventFor('file:///plugins/plugin-a/settings.html?pluginId=plugin-a')
    for (const route of [
      'plugins.get',
      'plugins.enable',
      'plugins.disable',
      'plugins.invokeAction'
    ]) {
      expect(() => authorize(event, route)).not.toThrow()
    }
    expect(() => authorize(event, 'mcp.startServer')).toThrow('Native IPC')
    expect(() => authorize(event)).toThrow('Native IPC')
    Object.defineProperty(event.sender, 'id', { value: 43 })
    expect(() => authorize(event, 'plugins.get')).toThrow('Native IPC')
    expect(() => authorize(eventFor('https://example.com/'), 'plugins.get')).toThrow('Native IPC')
    const lookup = vi.fn()
    const invalidRegistry = createRendererIpcAuthorizer({
      rendererDirectoryUrl,
      pluginSettingsWindow: { getPluginIdForWebContents: lookup }
    })
    for (const invalid of [Promise.resolve(null), {}, undefined, 42]) {
      lookup.mockReturnValue(invalid)
      expect(() => invalidRegistry(eventFor('file:///tmp/foreign.html'), 'plugins.get')).toThrow(
        'Native IPC'
      )
    }
  })

  it('authorizes before route dispatch or any clipboard side effect', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      removeHandler: vi.fn(),
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler)
    } as unknown as IpcMain
    const dispatch = vi.fn()
    const clipboardSpies = [
      vi.spyOn(clipboard, 'writeText'),
      vi.spyOn(clipboard, 'writeImage'),
      vi.spyOn(clipboard, 'readText'),
      vi.spyOn(nativeImage, 'createFromDataURL')
    ]
    registerDeepchatRoutes(ipcMain, dispatch, authorize)
    registerClipboardIpc(ipcMain, authorize)
    const untrusted = eventFor('file:///tmp/preview.html')
    await expect(
      handlers.get(DEEPCHAT_ROUTE_INVOKE_CHANNEL)!(untrusted, 'config.getLanguage', {})
    ).rejects.toThrow('Native IPC')
    for (const channel of Object.values(CLIPBOARD_IPC_CHANNELS)) {
      expect(() => handlers.get(channel)!(untrusted, 'payload')).toThrow('Native IPC')
    }
    expect(dispatch).not.toHaveBeenCalled()
    for (const spy of clipboardSpies) expect(spy).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('derives the forwarded caller from the authorized native sender', async () => {
    let invoke: (...args: unknown[]) => unknown = () => undefined
    const ipcMain = {
      removeHandler: vi.fn(),
      handle: (_channel: string, handler: typeof invoke) => {
        invoke = handler
      }
    } as unknown as IpcMain
    const dispatch = vi.fn().mockResolvedValue({ language: 'en-US' })
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue({ id: 7 } as Electron.BrowserWindow)
    registerDeepchatRoutes(ipcMain, dispatch, authorize)
    const input = { caller: { kind: 'internal', component: 'migration' } }
    const event = eventFor()
    await expect(invoke(event, 'config.getLanguage', input)).resolves.toEqual({
      language: 'en-US'
    })
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(
      'config.getLanguage',
      input,
      { caller: { kind: 'renderer', webContentsId: 42, windowId: 7 } },
      expect.any(Function)
    )
    const assertCallerActive = dispatch.mock.calls[0][3] as () => void
    expect(assertCallerActive).not.toThrow()
    vi.spyOn(event.sender, 'getURL').mockReturnValue('file:///tmp/preview.html')
    expect(assertCallerActive).toThrow('Native IPC requires the current app document')
    vi.restoreAllMocks()
  })
})
