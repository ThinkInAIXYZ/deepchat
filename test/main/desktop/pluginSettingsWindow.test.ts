import { describe, expect, it, vi } from 'vitest'
import { BrowserWindow } from 'electron'
import { PluginSettingsWindow } from '@/desktop/pluginSettingsWindow'

type Handler = (...args: any[]) => void

type FakeWindow = {
  webContents: {
    id: number
    on: ReturnType<typeof vi.fn>
    setWindowOpenHandler: ReturnType<typeof vi.fn>
  }
  isDestroyed: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  loadFile: ReturnType<typeof vi.fn>
  handlers: Map<string, Handler>
  webContentsHandlers: Map<string, Handler>
}

function installBrowserWindowMock(loadFile: () => Promise<void> = async () => {}): FakeWindow[] {
  const created: FakeWindow[] = []
  vi.mocked(BrowserWindow).mockImplementation(function () {
    const handlers = new Map<string, Handler>()
    const webContentsHandlers = new Map<string, Handler>()
    const win: FakeWindow = {
      webContents: {
        id: 100 + created.length,
        on: vi.fn((event: string, cb: Handler) => webContentsHandlers.set(event, cb)),
        setWindowOpenHandler: vi.fn()
      },
      isDestroyed: vi.fn(() => false),
      on: vi.fn((event: string, cb: Handler) => handlers.set(event, cb)),
      show: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
      loadFile: vi.fn(loadFile),
      handlers,
      webContentsHandlers
    }
    created.push(win)
    return win as any
  })
  return created
}

const input = { pluginId: 'p1', title: 'P1', entry: '/plugins/p1/settings.html' }

describe('PluginSettingsWindow', () => {
  it('waits for physical closure before acknowledging close or reopening', async () => {
    const created = installBrowserWindowMock()
    const settingsWindow = new PluginSettingsWindow()

    await settingsWindow.open(input)
    let settled = false
    const closing = settingsWindow.close(input.pluginId).then(() => {
      settled = true
    })
    const reopening = settingsWindow.open(input)
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(created).toHaveLength(1)
    expect(settingsWindow.getPluginIdForWebContents(created[0].webContents.id)).toBe('p1')

    created[0].handlers.get('closed')?.()
    await closing
    await reopening
    expect(settingsWindow.getPluginIdForWebContents(created[0].webContents.id)).toBeNull()
    created[0].handlers.get('closed')?.()

    const closingAgain = settingsWindow.close(input.pluginId)
    expect(created[1].destroy).toHaveBeenCalled()
    expect(settingsWindow.getPluginIdForWebContents(created[1].webContents.id)).toBe('p1')
    created[1].handlers.get('closed')?.()
    await closingAgain
  })

  it('drains a failed load before propagating its error', async () => {
    const created = installBrowserWindowMock(async () => {
      throw new Error('Invalid settings file')
    })
    const settingsWindow = new PluginSettingsWindow()
    const opening = settingsWindow.open(input)
    const rejected = expect(opening).rejects.toThrow('Invalid settings file')
    await Promise.resolve()
    expect(created[0].destroy).toHaveBeenCalled()
    created[0].handlers.get('closed')?.()
    await rejected
  })

  it('settles cancellation when closing a window rejects its pending load', async () => {
    let rejectLoad!: (error: Error) => void
    const created = installBrowserWindowMock(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectLoad = reject
        })
    )
    const settingsWindow = new PluginSettingsWindow()
    const opening = settingsWindow.open(input)
    const closing = settingsWindow.close(input.pluginId)
    rejectLoad(new Error('ERR_FAILED (-2)'))
    created[0].handlers.get('closed')?.()
    await opening
    await closing
  })

  it('restricts navigation to the file entry', async () => {
    const created = installBrowserWindowMock()
    const settingsWindow = new PluginSettingsWindow()

    await settingsWindow.open(input)

    const onWillNavigate = created[0].webContentsHandlers.get('will-navigate')
    expect(onWillNavigate).toBeDefined()

    const isAllowed = (url: string): boolean => {
      const event = { preventDefault: vi.fn() }
      onWillNavigate?.(event, url)
      return event.preventDefault.mock.calls.length === 0
    }

    expect(isAllowed('file:///plugins/p1/settings.html?pluginId=p1')).toBe(true)
    expect(isAllowed('file:///plugins/p1/settings.html#section')).toBe(true)
    expect(isAllowed('file:///plugins/other/settings.html')).toBe(false)
    expect(isAllowed('https://example.com/')).toBe(false)
  })

  it('fences reopen requests while closing all owned windows', async () => {
    const created = installBrowserWindowMock()
    const windows = new PluginSettingsWindow()
    await windows.open(input)
    const closing = windows.close(input.pluginId)
    const reopening = windows.open(input)
    const rejected = expect(reopening).rejects.toThrow('windows are closed')
    const shutdown = windows.closeAll()
    created[0].handlers.get('closed')?.()
    await Promise.all([closing, shutdown, rejected])
    expect(created).toHaveLength(1)
  })
})
