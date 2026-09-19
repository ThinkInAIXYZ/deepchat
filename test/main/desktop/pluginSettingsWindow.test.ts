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
  close: ReturnType<typeof vi.fn>
  loadFile: ReturnType<typeof vi.fn>
  handlers: Map<string, Handler>
  webContentsHandlers: Map<string, Handler>
}

function installBrowserWindowMock(): FakeWindow[] {
  const created: FakeWindow[] = []
  ;(BrowserWindow as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
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
      close: vi.fn(),
      loadFile: vi.fn().mockResolvedValue(undefined),
      handlers,
      webContentsHandlers
    }
    created.push(win)
    return win
  })
  return created
}

const input = { pluginId: 'p1', title: 'P1', entry: '/plugins/p1/settings.html' }

describe('PluginSettingsWindow', () => {
  it('keeps the reopened window record when a stale closed event fires late', async () => {
    const created = installBrowserWindowMock()
    const settingsWindow = new PluginSettingsWindow()

    await settingsWindow.open(input)
    settingsWindow.close(input.pluginId)
    await settingsWindow.open(input)

    created[0].handlers.get('closed')?.()

    settingsWindow.close(input.pluginId)
    expect(created[1].close).toHaveBeenCalled()
    expect(settingsWindow.getPluginIdForWebContents(created[1].webContents.id)).toBe('p1')
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
})
