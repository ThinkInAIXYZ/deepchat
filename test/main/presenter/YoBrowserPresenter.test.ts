import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendToAllWindowsMock = vi.fn()
const overlayUpdateBoundsMock = vi.fn(async () => undefined)
const overlaySendActivityMock = vi.fn()
const overlayHideMock = vi.fn()
const overlayDestroyMock = vi.fn()

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
  webContents = {
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false)
  }
  destroyed = false
  visible = true
  focused = true

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
    overlayUpdateBoundsMock.mockClear()
    overlaySendActivityMock.mockClear()
    overlayHideMock.mockClear()
    overlayDestroyMock.mockClear()
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

    vi.doMock('@/presenter/browser/DownloadManager', () => ({
      DownloadManager: class {
        downloadFile = vi.fn()
      }
    }))

    vi.doMock('@/presenter/browser/yoBrowserSession', () => ({
      getYoBrowserSession: () => ({}),
      clearYoBrowserSessionData: vi.fn()
    }))

    vi.doMock('@/presenter/browser/YoBrowserOverlayWindow', () => ({
      YoBrowserOverlayWindow: class {
        updateBounds = overlayUpdateBoundsMock
        sendActivity = overlaySendActivityMock
        hide = overlayHideMock
        destroy = overlayDestroyMock
      }
    }))

    const { YoBrowserPresenter } = await import('@/presenter/browser/YoBrowserPresenter')
    const { setDeepchatEventWindowPresenter } = await import('@/routes/publishDeepchatEvent')
    setDeepchatEventWindowPresenter({
      sendToAllWindows: sendToAllWindowsMock,
      sendToWebContents: vi.fn()
    })

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

  it('starts session navigation immediately and resolves after dom-ready', async () => {
    const { presenter, windows, getSessionWebContents } = await setupPresenter()
    windows.set(1, new MockBrowserWindow(1))

    const loadPromise = presenter.loadUrl('session-a', 'https://example.com')
    await Promise.resolve()

    const webContents = getSessionWebContents('session-a')
    expect(webContents?.loadURL).toHaveBeenCalledWith('https://example.com')

    await presenter.attachSessionBrowser('session-a', 1)
    await presenter.updateSessionBrowserBounds(
      'session-a',
      1,
      { x: 12, y: 18, width: 320, height: 480 },
      true
    )
    await vi.advanceTimersByTimeAsync(130)
    await Promise.resolve()

    webContents?.emitDomReady()
    await loadPromise
    webContents?.finishLoad()
  })

  it('resolves loadUrl only after the first dom-ready', async () => {
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
    await Promise.resolve()

    expect(settled).toBe(false)

    const webContents = getSessionWebContents('session-a')
    webContents?.emitDomReady()
    await loadPromise

    expect(settled).toBe(true)
    webContents?.finishLoad()
  })

  it('returns a clear error when dom-ready never arrives', async () => {
    const { presenter, windows } = await setupPresenter()
    windows.set(1, new MockBrowserWindow(1))

    const loadPromise = presenter.loadUrl('session-a', 'https://example.com', 5000)
    const rejection = expect(loadPromise).rejects.toThrow(
      'Timed out waiting for dom-ready: https://example.com'
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
    sendToAllWindowsMock.mockClear()

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

    const updatedEvents = sendToAllWindowsMock.mock.calls
      .filter(([event]) => event === 'deepchat:event')
      .map(([, envelope]) => envelope)
      .filter(
        (envelope: any) =>
          envelope.name === 'browser.status.changed' && envelope.payload.reason === 'updated'
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

  it('publishes agent navigation activity without exposing page content', async () => {
    const { presenter, windows, getSessionWebContents } = await setupPresenter()
    windows.set(1, new MockBrowserWindow(1))

    const loadPromise = presenter.loadUrl(
      'session-a',
      'https://example.com',
      undefined,
      undefined,
      'agent'
    )
    await Promise.resolve()
    getSessionWebContents('session-a')?.emitDomReady()
    await loadPromise

    const activityPayloads = sendToAllWindowsMock.mock.calls
      .filter(([event]) => event === 'deepchat:event')
      .map(([, envelope]) => envelope)
      .filter((envelope: any) => envelope.name === 'browser.activity.changed')
      .map((envelope: any) => envelope.payload)

    expect(activityPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: 'session-a',
          kind: 'navigation',
          action: 'navigate',
          phase: 'started'
        }),
        expect.objectContaining({
          sessionId: 'session-a',
          kind: 'navigation',
          action: 'navigate',
          phase: 'completed'
        })
      ])
    )
    expect(JSON.stringify(activityPayloads)).not.toContain('example.com')
  })

  it('maps agent CDP mouse and screenshot commands to overlay activity', async () => {
    const { presenter, windows, getSessionWebContents } = await setupPresenter()
    windows.set(1, new MockBrowserWindow(1))

    const loadPromise = presenter.loadUrl('session-a', 'https://example.com')
    await Promise.resolve()
    getSessionWebContents('session-a')?.emitDomReady()
    await loadPromise
    await presenter.attachSessionBrowser('session-a', 1)
    await presenter.updateSessionBrowserBounds(
      'session-a',
      1,
      { x: 10, y: 20, width: 300, height: 400 },
      true
    )

    sendToAllWindowsMock.mockClear()
    await presenter.sendCdpCommand(
      'session-a',
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: 42, y: 84 },
      'agent'
    )
    await presenter.sendCdpCommand(
      'session-a',
      'Page.captureScreenshot',
      { clip: { x: 4, y: 8, width: 120, height: 80, scale: 1 } },
      'agent'
    )
    await Promise.resolve()

    const activityPayloads = sendToAllWindowsMock.mock.calls
      .filter(([event]) => event === 'deepchat:event')
      .map(([, envelope]) => envelope)
      .filter((envelope: any) => envelope.name === 'browser.activity.changed')
      .map((envelope: any) => envelope.payload)

    expect(activityPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'pointer',
          action: 'mouse_click',
          phase: 'started',
          point: { x: 42, y: 84 }
        }),
        expect.objectContaining({
          kind: 'vision',
          action: 'screenshot',
          phase: 'started',
          rect: { x: 4, y: 8, width: 120, height: 80 }
        })
      ])
    )
    expect(overlaySendActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'pointer',
        action: 'mouse_click',
        point: { x: 42, y: 84 }
      })
    )
  })

  it('maps Runtime.evaluate click and scroll scripts to visible action cues', async () => {
    const { presenter, windows, getSessionWebContents } = await setupPresenter()
    windows.set(1, new MockBrowserWindow(1))

    const loadPromise = presenter.loadUrl('session-a', 'https://example.com')
    await Promise.resolve()
    getSessionWebContents('session-a')?.emitDomReady()
    await loadPromise
    await presenter.attachSessionBrowser('session-a', 1)
    await presenter.updateSessionBrowserBounds(
      'session-a',
      1,
      { x: 10, y: 20, width: 300, height: 400 },
      true
    )

    sendToAllWindowsMock.mockClear()
    await presenter.sendCdpCommand(
      'session-a',
      'Runtime.evaluate',
      { expression: 'document.querySelector("button")?.click()' },
      'agent'
    )
    await presenter.sendCdpCommand(
      'session-a',
      'Runtime.evaluate',
      { expression: 'window.scrollBy(0, 600)' },
      'agent'
    )

    const activityPayloads = sendToAllWindowsMock.mock.calls
      .filter(([event]) => event === 'deepchat:event')
      .map(([, envelope]) => envelope)
      .filter((envelope: any) => envelope.name === 'browser.activity.changed')
      .map((envelope: any) => envelope.payload)

    expect(activityPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'pointer',
          action: 'mouse_click',
          phase: 'started'
        }),
        expect.objectContaining({
          kind: 'scroll',
          action: 'mouse_wheel',
          direction: 'down',
          phase: 'started'
        })
      ])
    )
  })

  it('maps Runtime.evaluate client coordinates by axis name', async () => {
    const { presenter } = await setupPresenter()
    const extractPoint = (presenter as any).extractPointFromRuntimeExpression.bind(presenter)

    expect(
      extractPoint(
        'document.dispatchEvent(new MouseEvent("click", { clientY: 12.4, clientX: 98.6 }))'
      )
    ).toEqual({ x: 99, y: 12 })
    expect(
      extractPoint('document.dispatchEvent(new MouseEvent("click", { clientX: 10, clientX: 20 }))')
    ).toBeUndefined()
    expect(extractPoint('document.querySelector("button")?.click()')).toBeUndefined()
  })

  it('returns focus to the host renderer after attaching the browser view', async () => {
    const { presenter, windows, getSessionWebContents } = await setupPresenter()
    const hostWindow = new MockBrowserWindow(1)
    windows.set(1, hostWindow)

    const loadPromise = presenter.loadUrl('session-a', 'https://example.com')
    await Promise.resolve()
    getSessionWebContents('session-a')?.emitDomReady()
    await loadPromise

    await presenter.attachSessionBrowser('session-a', 1)
    await Promise.resolve()

    expect(hostWindow.webContents.focus).toHaveBeenCalled()
  })

  it('does not show overlay activity when the host window is backgrounded', async () => {
    const { presenter, windows, getSessionWebContents } = await setupPresenter()
    const hostWindow = new MockBrowserWindow(1)
    hostWindow.focused = false
    windows.set(1, hostWindow)

    const loadPromise = presenter.loadUrl('session-a', 'https://example.com')
    await Promise.resolve()
    getSessionWebContents('session-a')?.emitDomReady()
    await loadPromise
    await presenter.attachSessionBrowser('session-a', 1)
    await presenter.updateSessionBrowserBounds(
      'session-a',
      1,
      { x: 10, y: 20, width: 300, height: 400 },
      true
    )

    sendToAllWindowsMock.mockClear()
    await presenter.sendCdpCommand(
      'session-a',
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: 42, y: 84 },
      'agent'
    )
    await Promise.resolve()

    const activityEvents = sendToAllWindowsMock.mock.calls.filter(
      ([event]) => event === 'deepchat:event'
    )
    expect(activityEvents.length).toBeGreaterThan(0)
    expect(overlayUpdateBoundsMock).not.toHaveBeenCalled()
    expect(overlaySendActivityMock).not.toHaveBeenCalled()
    expect(hostWindow.webContents.focus).not.toHaveBeenCalled()
  })

  it('hides the overlay when the host window loses focus', async () => {
    const { presenter, windows, getSessionWebContents } = await setupPresenter()
    const hostWindow = new MockBrowserWindow(1)
    windows.set(1, hostWindow)

    const loadPromise = presenter.loadUrl('session-a', 'https://example.com')
    await Promise.resolve()
    getSessionWebContents('session-a')?.emitDomReady()
    await loadPromise
    await presenter.attachSessionBrowser('session-a', 1)
    await presenter.updateSessionBrowserBounds(
      'session-a',
      1,
      { x: 10, y: 20, width: 300, height: 400 },
      true
    )

    hostWindow.emit('blur')

    expect(overlayHideMock).toHaveBeenCalled()
  })

  it('hides and destroys the overlay with the session browser lifecycle', async () => {
    const { presenter, windows, getSessionWebContents } = await setupPresenter()
    windows.set(1, new MockBrowserWindow(1))

    const loadPromise = presenter.loadUrl('session-a', 'https://example.com')
    await Promise.resolve()
    getSessionWebContents('session-a')?.emitDomReady()
    await loadPromise
    await presenter.attachSessionBrowser('session-a', 1)
    await presenter.updateSessionBrowserBounds(
      'session-a',
      1,
      { x: 10, y: 20, width: 300, height: 400 },
      true
    )

    await presenter.detachSessionBrowser('session-a')
    expect(overlayHideMock).toHaveBeenCalled()

    await presenter.destroySessionBrowser('session-a')
    expect(overlayDestroyMock).toHaveBeenCalled()
  })
})
