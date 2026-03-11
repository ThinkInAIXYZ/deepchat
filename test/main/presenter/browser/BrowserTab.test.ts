import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import { BrowserTab } from '@/presenter/browser/BrowserTab'

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
  it('returns a unified retryable not-ready error for tooling actions before interactive-ready', async () => {
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

    const navigationPromise = tab.navigateUntilDomReady('https://example.com')
    await Promise.resolve()

    const assertions = [
      expect(tab.sendCdpCommand('Runtime.evaluate')).rejects.toThrow(
        'YoBrowser page is not ready to send CDP command Runtime.evaluate. Retry this request. url=https://example.com status=loading'
      ),
      expect(tab.takeScreenshot()).rejects.toThrow(
        'YoBrowser page is not ready to capture screenshot. Retry this request. url=https://example.com status=loading'
      ),
      expect(tab.extractDOM()).rejects.toThrow(
        'YoBrowser page is not ready to extract DOM. Retry this request. url=https://example.com status=loading'
      ),
      expect(tab.evaluateScript('1 + 1')).rejects.toThrow(
        'YoBrowser page is not ready to evaluate script. Retry this request. url=https://example.com status=loading'
      )
    ]

    await Promise.all(assertions)

    webContents.emitDomReady()
    await navigationPromise
    webContents.finishLoad()
  })
})
