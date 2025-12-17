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

  async navigate(url: string): Promise<void> {
    this.status = BrowserTabStatus.Loading
    this.url = url
    this.updatedAt = Date.now()
    await this.ensureSession()
    try {
      await this.webContents.loadURL(url)
      await this.waitForLoad()
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

  async waitForLoad(): Promise<void> {
    if (this.webContents.isLoading()) {
      await new Promise<void>((resolve, reject) => {
        const onFinish = () => {
          cleanup()
          resolve()
        }
        const onFail = (_event: unknown, errorCode: number, errorDescription: string) => {
          cleanup()
          reject(new Error(`Navigation failed ${errorCode}: ${errorDescription}`))
        }
        const cleanup = () => {
          this.webContents.removeListener('did-finish-load', onFinish)
          this.webContents.removeListener('did-fail-load', onFail as any)
        }
        this.webContents.once('did-finish-load', onFinish)
        this.webContents.once('did-fail-load', onFail as any)
      })
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
