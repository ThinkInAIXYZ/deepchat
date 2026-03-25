import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserTab } from '@/presenter/browser/BrowserTab'
import { BrowserPageStatus } from '@shared/types/browser'

class MockWebContents extends EventEmitter {
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
  isLoading = vi.fn(() => this.loading)
  reload = vi.fn()
  goBack = vi.fn()
  goForward = vi.fn()
  sendInputEvent = vi.fn()

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

  emitStartNavigation(
    url: string,
    options?: {
      isSameDocument?: boolean
      isMainFrame?: boolean
    }
  ) {
    this.url = url
    this.emit('did-start-navigation', {
      url,
      isSameDocument: options?.isSameDocument ?? false,
      isMainFrame: options?.isMainFrame ?? true
    })
  }

  finishLoad() {
    this.emitDomReady()
    this.loading = false
    this.emit('did-finish-load')
    this.emit('did-stop-loading')
    this.pendingLoad?.resolve()
    this.pendingLoad = null
  }
}

describe('BrowserTab', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const createTab = () => {
    const webContents = new MockWebContents()
    const cdpManager = {
      createSession: vi.fn(async () => undefined),
      getDOM: vi.fn(async () => '<html></html>'),
      evaluateScript: vi.fn(async () => 1)
    }
    const screenshotManager = {
      captureScreenshot: vi.fn(async () => 'image-data')
    }
    const tab = new BrowserTab(webContents as any, cdpManager as any, screenshotManager as any)

    return {
      tab,
      webContents,
      cdpManager,
      screenshotManager
    }
  }

  const makePageInteractive = async (
    tab: BrowserTab,
    webContents: MockWebContents,
    url: string = 'https://example.com'
  ) => {
    const navigationPromise = tab.navigateUntilDomReady(url)
    await Promise.resolve()
    webContents.emitDomReady()
    await navigationPromise
    webContents.finishLoad()
  }

  it('waits up to 2 seconds for tooling actions while the page is loading', async () => {
    const { tab, webContents, screenshotManager } = createTab()

    const navigationPromise = tab.navigateUntilDomReady('https://example.com')
    await Promise.resolve()

    const commandPromise = tab.sendCdpCommand('Runtime.evaluate')
    const screenshotPromise = tab.takeScreenshot()
    const domPromise = tab.extractDOM()
    const evaluatePromise = tab.evaluateScript('1 + 1')

    await Promise.resolve()
    expect(webContents.debugger.sendCommand).not.toHaveBeenCalled()
    expect(screenshotManager.captureScreenshot).not.toHaveBeenCalled()

    webContents.emitDomReady()
    await expect(commandPromise).resolves.toEqual({})
    await expect(screenshotPromise).resolves.toBe('image-data')
    await expect(domPromise).resolves.toBe('<html></html>')
    await expect(evaluatePromise).resolves.toBe(1)
    await navigationPromise
    webContents.finishLoad()
  })

  it('times out waiting for interactive-ready while the page keeps loading', async () => {
    const { tab, webContents } = createTab()

    const navigationPromise = tab.navigateUntilDomReady('https://example.com')
    await Promise.resolve()

    const commandPromise = tab.sendCdpCommand('Runtime.evaluate')
    const rejection = expect(commandPromise).rejects.toThrow(
      'YoBrowser page is not ready to send CDP command Runtime.evaluate. Retry this request. url=https://example.com status=loading'
    )
    await vi.advanceTimersByTimeAsync(2000)

    await rejection
    expect(webContents.debugger.sendCommand).not.toHaveBeenCalled()

    webContents.emitDomReady()
    await navigationPromise
    webContents.finishLoad()
  })

  it('still fails immediately when the page is not loading', async () => {
    const { tab, webContents } = createTab()

    const screenshotPromise = tab.takeScreenshot()
    await Promise.resolve()

    await expect(screenshotPromise).rejects.toThrow(
      'YoBrowser page is not ready to capture screenshot. Retry this request. url=about:blank status=idle'
    )
    expect(webContents.debugger.sendCommand).not.toHaveBeenCalled()
  })

  it('allows cdp exploration after dom-ready even if loading restarts', async () => {
    const { tab, webContents } = createTab()

    await makePageInteractive(tab, webContents)

    webContents.loading = true
    webContents.emit('did-start-loading')

    await expect(tab.sendCdpCommand('Runtime.evaluate')).resolves.toEqual({})
    expect(tab.status).toBe(BrowserPageStatus.Loading)

    webContents.loading = false
    webContents.emit('did-stop-loading')
    expect(tab.status).toBe(BrowserPageStatus.Ready)
  })

  it('re-blocks cdp exploration for a new main-frame navigation until the next interactive event', async () => {
    const { tab, webContents } = createTab()

    await makePageInteractive(tab, webContents)

    webContents.emitStartNavigation('https://example.com/next')
    webContents.loading = true
    webContents.emit('did-start-loading')

    const commandPromise = tab.sendCdpCommand('Runtime.evaluate')
    await Promise.resolve()
    expect(webContents.debugger.sendCommand).not.toHaveBeenCalled()

    webContents.emitDomReady()
    await expect(commandPromise).resolves.toEqual({})
  })

  it('ignores same-document and subframe navigations for interactive readiness', async () => {
    const { tab, webContents } = createTab()

    await makePageInteractive(tab, webContents)

    webContents.emitStartNavigation('https://example.com#section', { isSameDocument: true })
    await expect(tab.sendCdpCommand('Runtime.evaluate')).resolves.toEqual({})

    webContents.emitStartNavigation('https://ads.example.com', { isMainFrame: false })
    await expect(tab.sendCdpCommand('Runtime.evaluate')).resolves.toEqual({})
  })

  it('allows exploration after timeout when the renderer probe finds a live document', async () => {
    const { tab, webContents, cdpManager } = createTab()

    await expect(
      tab.sendCdpCommand('Page.navigate', { url: 'https://example.com/probe' })
    ).resolves.toEqual({})

    cdpManager.evaluateScript.mockResolvedValueOnce({
      readyState: 'complete',
      hasBody: true,
      href: 'https://example.com/probe'
    })

    const commandPromise = tab.sendCdpCommand('Runtime.evaluate')
    await vi.advanceTimersByTimeAsync(2000)

    await expect(commandPromise).resolves.toEqual({})
    expect(tab.status).toBe(BrowserPageStatus.Loading)
    expect(cdpManager.evaluateScript).toHaveBeenCalledWith(
      webContents.debugger,
      expect.stringContaining('document.readyState')
    )
    expect(webContents.debugger.sendCommand).toHaveBeenLastCalledWith('Runtime.evaluate', {})
  })

  it('marks Page.navigate as loading so the next tool waits for the new document', async () => {
    const { tab, webContents, screenshotManager } = createTab()

    webContents.debugger.sendCommand.mockImplementation(async (method: string, params?: any) => {
      if (method === 'Page.navigate') {
        if (typeof params?.url === 'string') {
          webContents.url = params.url
        }
        webContents.loading = true
        webContents.emit('did-start-loading')
        return { frameId: 'frame-1' }
      }
      return {}
    })

    const firstNavigation = tab.navigateUntilDomReady('https://example.com')
    await Promise.resolve()
    webContents.emitDomReady()
    await firstNavigation
    webContents.finishLoad()

    await expect(
      tab.sendCdpCommand('Page.navigate', { url: 'https://example.com/next' })
    ).resolves.toEqual({ frameId: 'frame-1' })

    const screenshotPromise = tab.takeScreenshot()
    await Promise.resolve()
    expect(screenshotManager.captureScreenshot).not.toHaveBeenCalled()

    webContents.emitDomReady()
    await expect(screenshotPromise).resolves.toBe('image-data')
  })
})
