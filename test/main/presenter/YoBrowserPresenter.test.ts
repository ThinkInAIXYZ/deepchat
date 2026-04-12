import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendToRendererMock = vi.fn()

class MockWebContents extends EventEmitter {
  id: number
  url = 'about:blank'
  title = ''
  destroyed = false
  loading = false
  pendingLoad: {
    resolve: () => void
    reject: (error: Error) => void
  } | null = null
  debugger = {
    isAttached: vi.fn(() => false),
    detach: vi.fn(),
    attach: vi.fn(),
    sendCommand: vi.fn(async () => ({}))
  }
  session = {}
  navigationHistory = {
    canGoBack: vi.fn(() => false),
    canGoForward: vi.fn(() => false)
  }
  loadURL = vi.fn((url: string) => {
    this.url = url
    this.loading = true
    this.emit('did-start-loading')

    return new Promise<void>((resolve, reject) => {
      this.pendingLoad = { resolve, reject }
    })
  })
  goBack = vi.fn()
  goForward = vi.fn()
  reload = vi.fn(() => {
    this.loading = true
    this.emit('did-start-loading')
  })
  reloadIgnoringCache = vi.fn()
  isLoading = vi.fn(() => this.loading)
  close = vi.fn(() => {
    this.destroyed = true
    this.emit('destroyed')
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

  emitDomReady() {
    this.emit('dom-ready')
  }

  finishLoad() {
    if (!this.loading) {
      return
    }

    this.emitDomReady()
    this.loading = false
    this.emit('did-finish-load')
    this.emit('did-stop-loading')
    this.pendingLoad?.resolve()
    this.pendingLoad = null
  }

  failLoad(errorCode: number = -105, errorDescription: string = 'NAME_NOT_RESOLVED') {
    this.loading = false
    this.emit('did-fail-load', {}, errorCode, errorDescription, this.url, true)
    this.pendingLoad?.reject(new Error(`Navigation failed ${errorCode}: ${errorDescription}`))
    this.pendingLoad = null
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
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
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

    vi.doMock('@shared/logger', () => ({
      default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    }))

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
        OPEN_REQUESTED: 'yo-browser:open-requested',
        WINDOW_CREATED: 'yo-browser:window-created',
        WINDOW_UPDATED: 'yo-browser:window-updated',
        WINDOW_CLOSED: 'yo-browser:window-closed',
        WINDOW_FOCUSED: 'yo-browser:window-focused',
        WINDOW_COUNT_CHANGED: 'yo-browser:window-count-changed',
        WINDOW_VISIBILITY_CHANGED: 'yo-browser:window-visibility-changed'
      }
    }))

    vi.doMock('@/presenter/browser/DownloadManager', () => ({
      DownloadManager: class {
        downloadFile = vi.fn()
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
          target.focused = true
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

    const getSessionWebContents = (sessionId: string) => {
      return ((presenter as any).sessionBrowsers.get(sessionId)?.view?.webContents ??
        null) as MockWebContents | null
    }

    return {
      presenter,
      windows,
      viewConfigs,
      getSessionWebContents
    }
  }

  it('does not start session navigation before the renderer reports a stable host', async () => {
    const { presenter, windows, getSessionWebContents } = await setupPresenter()
    windows.set(1, new MockBrowserWindow(1))

    const loadPromise = presenter.loadUrl('session-a', 'https://example.com')
    await Promise.resolve()

    const webContents = getSessionWebContents('session-a')
    expect(webContents?.loadURL).not.toHaveBeenCalled()

    await presenter.attachSessionBrowser('session-a', 1)
    await presenter.updateSessionBrowserBounds(
      'session-a',
      1,
      { x: 12, y: 18, width: 320, height: 480 },
      true
    )
    await vi.advanceTimersByTimeAsync(130)
    await Promise.resolve()

    expect(webContents?.loadURL).toHaveBeenCalledWith('https://example.com')

    webContents?.emitDomReady()
    await loadPromise
    webContents?.finishLoad()
  })

  it('resolves loadUrl only after host-ready and the first dom-ready', async () => {
    const { presenter, windows, getSessionWebContents } = await setupPresenter()
    windows.set(1, new MockBrowserWindow(1))

    let settled = false
    const loadPromise = presenter.loadUrl('session-a', 'https://example.com').then(() => {
      settled = true
    })

    await Promise.resolve()
    await presenter.attachSessionBrowser('session-a', 1)
    await presenter.updateSessionBrowserBounds(
      'session-a',
      1,
      { x: 10, y: 20, width: 300, height: 400 },
      true
    )
    await vi.advanceTimersByTimeAsync(130)
    await Promise.resolve()

    expect(settled).toBe(false)

    const webContents = getSessionWebContents('session-a')
    webContents?.emitDomReady()
    await loadPromise

    expect(settled).toBe(true)
    webContents?.finishLoad()
  })

  it('returns a clear error when session host-ready never arrives', async () => {
    const { presenter, windows } = await setupPresenter()
    windows.set(1, new MockBrowserWindow(1))

    const loadPromise = presenter.loadUrl('session-a', 'https://example.com')
    const rejection = expect(loadPromise).rejects.toThrow(
      'Session browser host 1 did not become ready within 5000ms'
    )
    await vi.advanceTimersByTimeAsync(5050)
    await rejection
  }, 7000)

  it('does not emit WINDOW_UPDATED for pure bounds changes', async () => {
    const { presenter, windows } = await setupPresenter()
    windows.set(1, new MockBrowserWindow(1))

    void presenter.loadUrl('session-a', 'https://example.com')
    await Promise.resolve()
    await presenter.attachSessionBrowser('session-a', 1)
    sendToRendererMock.mockClear()

    await presenter.updateSessionBrowserBounds(
      'session-a',
      1,
      { x: 0, y: 0, width: 240, height: 360 },
      true
    )
    await presenter.updateSessionBrowserBounds(
      'session-a',
      1,
      { x: 8, y: 16, width: 256, height: 384 },
      true
    )

    const updatedEvents = sendToRendererMock.mock.calls.filter(
      ([event]) => event === 'yo-browser:window-updated'
    )
    expect(updatedEvents).toHaveLength(0)
  })

  it('keeps session browsers isolated when switching the attached session', async () => {
    const { presenter, windows, getSessionWebContents } = await setupPresenter()
    windows.set(1, new MockBrowserWindow(1))

    const firstLoad = presenter.loadUrl('session-a', 'https://example.com/a')
    await Promise.resolve()
    await presenter.attachSessionBrowser('session-a', 1)
    await presenter.updateSessionBrowserBounds(
      'session-a',
      1,
      { x: 10, y: 10, width: 300, height: 400 },
      true
    )
    await vi.advanceTimersByTimeAsync(130)
    getSessionWebContents('session-a')?.emitDomReady()
    await firstLoad

    const secondLoad = presenter.loadUrl('session-b', 'https://example.com/b')
    await Promise.resolve()
    await presenter.attachSessionBrowser('session-b', 1)
    await presenter.updateSessionBrowserBounds(
      'session-b',
      1,
      { x: 10, y: 10, width: 300, height: 400 },
      true
    )
    await vi.advanceTimersByTimeAsync(130)
    getSessionWebContents('session-b')?.emitDomReady()
    await secondLoad

    const firstStatus = await presenter.getBrowserStatus('session-a')
    const secondStatus = await presenter.getBrowserStatus('session-b')

    expect(firstStatus.initialized).toBe(true)
    expect(firstStatus.visible).toBe(false)
    expect(secondStatus.initialized).toBe(true)
    expect(secondStatus.visible).toBe(true)
  })

  it('creates the embedded WebContentsView with sandbox enabled', async () => {
    const { presenter, windows, viewConfigs } = await setupPresenter()
    windows.set(1, new MockBrowserWindow(1))

    void presenter.loadUrl('session-a', 'https://example.com')
    await Promise.resolve()

    expect(viewConfigs).toHaveLength(1)
    expect(viewConfigs[0]?.webPreferences).toMatchObject({
      sandbox: true
    })
  })
})
