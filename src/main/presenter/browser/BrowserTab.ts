import { WebContents } from 'electron'
import { nanoid } from 'nanoid'
import { BrowserTabStatus, type ScreenshotOptions } from '@shared/types/browser'
import { CDPManager } from './CDPManager'
import { ScreenshotManager } from './ScreenshotManager'

export class BrowserTab {
  readonly tabId: string
  readonly createdAt: number
  url = 'about:blank'
  title = ''
  favicon = ''
  status: BrowserTabStatus = BrowserTabStatus.Idle
  updatedAt: number
  private readonly webContents: WebContents
  private readonly cdpManager: CDPManager
  private readonly screenshotManager: ScreenshotManager
  private isAttached = false

  constructor(
    webContents: WebContents,
    cdpManager: CDPManager,
    screenshotManager: ScreenshotManager
  ) {
    this.tabId = nanoid(12)
    this.createdAt = Date.now()
    this.updatedAt = this.createdAt
    this.webContents = webContents
    this.cdpManager = cdpManager
    this.screenshotManager = screenshotManager
    this.url = webContents.getURL() || 'about:blank'
    this.title = webContents.getTitle() || ''
  }

  get contents(): WebContents {
    return this.webContents
  }

  async navigate(url: string, timeoutMs?: number): Promise<void> {
    this.status = BrowserTabStatus.Loading
    this.url = url
    this.updatedAt = Date.now()
    await this.ensureSession()
    try {
      await this.webContents.loadURL(url)
      await this.waitForLoad(timeoutMs)
      this.title = this.webContents.getTitle() || url
      this.status = BrowserTabStatus.Ready
      this.updatedAt = Date.now()
    } catch (error) {
      this.status = BrowserTabStatus.Error
      console.error(`[YoBrowser][${this.tabId}] navigate failed:`, error)
      throw error
    }
  }

  async extractDOM(selector?: string): Promise<string> {
    const session = await this.ensureSession()
    return await this.cdpManager.getDOM(session, selector)
  }

  async evaluateScript(script: string): Promise<unknown> {
    const session = await this.ensureSession()
    return await this.cdpManager.evaluateScript(session, script)
  }

  async takeScreenshot(options?: ScreenshotOptions): Promise<string> {
    const session = await this.ensureSession()
    return await this.screenshotManager.captureScreenshot(session, options)
  }

  async waitForLoad(timeoutMs: number = 30000): Promise<void> {
    // Check if webContents is destroyed
    if (this.webContents.isDestroyed()) {
      throw new Error('WebContents destroyed')
    }

    // If not loading, return immediately
    if (!this.webContents.isLoading()) {
      return
    }

    // Wait for load with timeout
    let resolved = false
    let timeoutId: NodeJS.Timeout | null = null
    let onStopLoading: (() => void) | null = null
    let onDomReady: (() => void) | null = null
    let onFinishLoad: (() => void) | null = null
    let onFailLoad: ((...args: any[]) => void) | null = null

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      if (onStopLoading) {
        this.webContents.removeListener('did-stop-loading', onStopLoading)
      }
      if (onDomReady) {
        this.webContents.removeListener('dom-ready', onDomReady)
      }
      if (onFinishLoad) {
        this.webContents.removeListener('did-finish-load', onFinishLoad)
      }
      if (onFailLoad) {
        this.webContents.removeListener('did-fail-load', onFailLoad as any)
      }
    }

    try {
      await Promise.race([
        new Promise<void>((resolvePromise, rejectPromise) => {
          // Success handlers - any one triggers resolve
          onStopLoading = () => {
            if (!resolved) {
              resolved = true
              cleanup()
              resolvePromise()
            }
          }

          onDomReady = () => {
            if (!resolved) {
              resolved = true
              cleanup()
              resolvePromise()
            }
          }

          onFinishLoad = () => {
            if (!resolved) {
              resolved = true
              cleanup()
              resolvePromise()
            }
          }

          // Fail handler
          onFailLoad = (_event: unknown, errorCode: number, errorDescription: string) => {
            if (!resolved) {
              resolved = true
              cleanup()
              rejectPromise(new Error(`Navigation failed ${errorCode}: ${errorDescription}`))
            }
          }

          this.webContents.once('did-stop-loading', onStopLoading)
          this.webContents.once('dom-ready', onDomReady)
          this.webContents.once('did-finish-load', onFinishLoad)
          this.webContents.once('did-fail-load', onFailLoad as any)
        }),
        new Promise<void>((resolvePromise) => {
          timeoutId = setTimeout(() => {
            if (!resolved) {
              resolved = true
              cleanup()
              resolvePromise()
            }
          }, timeoutMs)
        })
      ])
    } catch (error) {
      if (!resolved) {
        cleanup()
      }
      throw error
    }
  }

  destroy(): void {
    if (this.webContents.debugger && this.webContents.debugger.isAttached()) {
      try {
        this.webContents.debugger.detach()
      } catch (error) {
        console.warn(`[YoBrowser][${this.tabId}] failed to detach debugger:`, error)
      }
    }
  }

  private async ensureSession() {
    if (this.webContents.isDestroyed()) {
      throw new Error('WebContents destroyed')
    }

    if (!this.isAttached) {
      try {
        await this.cdpManager.createSession(this.webContents)
        this.isAttached = true
      } catch (error) {
        console.error(`[YoBrowser][${this.tabId}] failed to create CDP session`, error)
        throw error
      }
    }
    return this.webContents.debugger
  }
}
