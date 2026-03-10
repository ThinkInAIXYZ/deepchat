import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendToRendererMock = vi.fn()

class MockWebContents extends EventEmitter {
  id: number
  url = 'about:blank'
  title = ''
  destroyed = false
  debugger = {
    isAttached: vi.fn(() => false),
    detach: vi.fn(),
    attach: vi.fn(),
    sendCommand: vi.fn(async () => ({}))
  }
  session = {}
  loadURL = vi.fn(async (url: string) => {
    this.url = url
  })
  once = vi.fn((event: string, listener: (...args: any[]) => void) => {
    super.once(event, listener)
    if (event === 'did-finish-load') {
      queueMicrotask(() => this.emit('did-finish-load'))
    }
    return this
  })
  canGoBack = vi.fn(() => false)
  canGoForward = vi.fn(() => false)
  goBack = vi.fn()
  goForward = vi.fn()
  reload = vi.fn()
  reloadIgnoringCache = vi.fn()
  isLoading = vi.fn(() => false)
  close = vi.fn(() => {
    this.destroyed = true
  })
  sendInputEvent = vi.fn()

  constructor(id: number) {
    super()
    this.id = id
  }

  getURL() {
    return this.url
  }

  getTitle() {
    return this.title
  }

  isDestroyed() {
    return this.destroyed
  }
}

class MockContentView {
  addChildView = vi.fn()
  removeChildView = vi.fn()
}

class MockBrowserWindow extends EventEmitter {
  contentView = new MockContentView()
  destroyed = false
  visible = true
  focused = false

  constructor(public readonly id: number) {
    super()
  }

  isDestroyed() {
    return this.destroyed
  }

  isVisible() {
    return this.visible
  }

  isFocused() {
    return this.focused
  }
}

describe('YoBrowserPresenter', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  const setupPresenter = async () => {
    let nextWebContentsId = 100
    const windows = new Map<number, MockBrowserWindow>()
    const viewConfigs: Array<Record<string, any>> = []

    vi.doMock('electron', () => {
      class MockWebContentsView {
        webContents: MockWebContents
        setBorderRadius = vi.fn()
        setBackgroundColor = vi.fn()
        setBounds = vi.fn()

        constructor(options: Record<string, any>) {
          viewConfigs.push(options)
          this.webContents = new MockWebContents(nextWebContentsId++)
        }
      }

      return {
        app: {
          getPath: vi.fn(() => 'C:/mock-user-data')
        },
        BrowserWindow: {
          fromId: (id: number) => windows.get(id) ?? null
        },
        WebContentsView: MockWebContentsView
      }
    })

    vi.doMock('@/eventbus', () => ({
      eventBus: {
        sendToRenderer: sendToRendererMock
      },
      SendTarget: {
        ALL_WINDOWS: 'all-windows'
      }
    }))

    vi.doMock('@/events', () => ({
      YO_BROWSER_EVENTS: {
        WINDOW_CREATED: 'yo-browser:created',
        WINDOW_UPDATED: 'yo-browser:updated',
        WINDOW_CLOSED: 'yo-browser:closed',
        WINDOW_FOCUSED: 'yo-browser:focused',
        WINDOW_COUNT_CHANGED: 'yo-browser:count',
        WINDOW_VISIBILITY_CHANGED: 'yo-browser:visible'
      }
    }))

    vi.doMock('@/presenter/browser/DownloadManager', () => ({
      DownloadManager: class {
        destroy = vi.fn()
      }
    }))

    vi.doMock('@/presenter/browser/yoBrowserSession', () => ({
      getYoBrowserSession: () => ({}),
      clearYoBrowserSessionData: vi.fn()
    }))

    const { YoBrowserPresenter } = await import('@/presenter/browser/YoBrowserPresenter')

    const windowPresenter = {
      show: vi.fn((windowId: number) => {
        const target = windows.get(windowId)
        if (target) {
          target.visible = true
        }
      }),
      hide: vi.fn((windowId: number) => {
        const target = windows.get(windowId)
        if (target) {
          target.visible = false
        }
      }),
      closeWindow: vi.fn(async () => undefined),
      getFocusedWindow: vi.fn(() => windows.get(1) ?? null),
      getAllWindows: vi.fn(() => Array.from(windows.values()))
    }

    const presenter = new YoBrowserPresenter(windowPresenter as any)
    return { presenter, windows, viewConfigs }
  }

  it('reattaches embedded listeners to the new host window and cleans up the previous host', async () => {
    const { presenter, windows } = await setupPresenter()
    const firstWindow = new MockBrowserWindow(1)
    const secondWindow = new MockBrowserWindow(2)
    windows.set(1, firstWindow)
    windows.set(2, secondWindow)

    await presenter.attachEmbeddedToWindow(1)
    const state = (presenter as any).embeddedState

    await presenter.attachEmbeddedToWindow(2)
    expect(firstWindow.contentView.removeChildView).toHaveBeenCalledWith(state.view)

    sendToRendererMock.mockClear()
    firstWindow.emit('focus')
    expect(sendToRendererMock).not.toHaveBeenCalled()

    secondWindow.emit('focus')
    expect(
      sendToRendererMock.mock.calls.some(
        ([event, _target, payload]) =>
          event === 'yo-browser:focused' && payload?.windowId === secondWindow.id
      )
    ).toBe(true)

    sendToRendererMock.mockClear()
    firstWindow.emit('show')
    secondWindow.emit('show')
    expect(
      sendToRendererMock.mock.calls.filter(
        ([event, _target, payload]) =>
          event === 'yo-browser:visible' && payload?.windowId === secondWindow.id
      )
    ).toHaveLength(1)
  })

  it('clears stale embedded visibility and does not report visible when unattached', async () => {
    const { presenter, windows } = await setupPresenter()
    windows.set(1, new MockBrowserWindow(1))

    await presenter.attachEmbeddedToWindow(1)
    const state = (presenter as any).embeddedState

    state.visible = true
    state.attachedWindowId = null
    sendToRendererMock.mockClear()

    await presenter.detachEmbedded()
    expect(state.visible).toBe(false)
    expect(
      sendToRendererMock.mock.calls.some(
        ([event, _target, payload]) =>
          event === 'yo-browser:visible' &&
          payload?.windowId === state.id &&
          payload?.visible === false
      )
    ).toBe(true)

    sendToRendererMock.mockClear()
    const toggled = await presenter.toggleVisibility()
    expect(toggled).toBe(false)
    expect(await presenter.isVisible()).toBe(false)
    expect(
      sendToRendererMock.mock.calls.some(
        ([event, _target, payload]) =>
          event === 'yo-browser:visible' &&
          payload?.windowId === state.id &&
          payload?.visible === true
      )
    ).toBe(false)
  })

  it('creates the embedded WebContentsView with sandbox enabled', async () => {
    const { presenter, windows, viewConfigs } = await setupPresenter()
    windows.set(1, new MockBrowserWindow(1))

    await presenter.attachEmbeddedToWindow(1)

    expect(viewConfigs).toHaveLength(1)
    expect(viewConfigs[0]?.webPreferences).toMatchObject({
      sandbox: true
    })
  })
})
