import { BrowserWindow, type Rectangle } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { browserActivityChangedEvent } from '@shared/contracts/events'
import type { YoBrowserActivityPayload } from '@shared/types/browser'

const OVERLAY_AUTO_HIDE_MS = 4200

export class YoBrowserOverlayWindow {
  private window: BrowserWindow | null = null
  private hostWindowId: number | null = null
  private ready = false
  private loadingPromise: Promise<void> | null = null
  private queuedPayloads: YoBrowserActivityPayload[] = []
  private hideTimer: NodeJS.Timeout | null = null
  private lastScreenBounds: Rectangle | null = null

  async updateBounds(
    hostWindow: BrowserWindow,
    browserBounds: Rectangle,
    visible: boolean
  ): Promise<void> {
    if (hostWindow.isDestroyed()) {
      this.hide()
      return
    }

    if (!visible || browserBounds.width <= 0 || browserBounds.height <= 0) {
      this.hide()
      return
    }

    if (!hostWindow.isFocused()) {
      this.hide()
      return
    }

    await this.ensureWindow(hostWindow)
    const contentBounds = hostWindow.getContentBounds()
    const screenBounds = {
      x: Math.round(contentBounds.x + browserBounds.x),
      y: Math.round(contentBounds.y + browserBounds.y),
      width: Math.round(browserBounds.width),
      height: Math.round(browserBounds.height)
    }

    this.lastScreenBounds = screenBounds

    if (this.window && !this.window.isDestroyed()) {
      this.window.setBounds(screenBounds)
    }
  }

  sendActivity(payload: YoBrowserActivityPayload): void {
    if (!this.window || this.window.isDestroyed()) {
      return
    }

    this.showForActivity()

    if (!this.ready) {
      this.queuedPayloads.push(payload)
      return
    }

    this.window.webContents.send(browserActivityChangedEvent.name, payload)
  }

  hide(): void {
    this.clearHideTimer()
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
      this.window.hide()
    }
  }

  destroy(): void {
    this.clearHideTimer()
    this.queuedPayloads = []
    this.loadingPromise = null
    this.ready = false
    this.hostWindowId = null
    this.lastScreenBounds = null

    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
    }
    this.window = null
  }

  private async ensureWindow(hostWindow: BrowserWindow): Promise<void> {
    if (hostWindow.isDestroyed()) {
      return
    }

    if (this.window && !this.window.isDestroyed() && this.hostWindowId === hostWindow.id) {
      if (this.ready) {
        return
      }

      if (this.loadingPromise) {
        await this.loadingPromise
        return
      }

      this.loadingPromise = this.loadOverlay()
      await this.loadingPromise
      return
    }

    if (this.window && !this.window.isDestroyed()) {
      this.destroy()
    }

    this.hostWindowId = hostWindow.id
    this.ready = false
    this.window = new BrowserWindow({
      parent: hostWindow,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      closable: true,
      show: false,
      hasShadow: false,
      autoHideMenuBar: true,
      acceptFirstMouse: false,
      roundedCorners: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, '../preload/browserOverlay.mjs'),
        devTools: is.dev,
        sandbox: false
      }
    })

    this.window.setIgnoreMouseEvents(true, { forward: true })
    this.window.on('closed', () => {
      this.window = null
      this.ready = false
      this.loadingPromise = null
      this.queuedPayloads = []
      this.clearHideTimer()
    })

    this.loadingPromise = this.loadOverlay()
    await this.loadingPromise
  }

  private async loadOverlay(): Promise<void> {
    const overlayWindow = this.window
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      return
    }

    try {
      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        await overlayWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/browser-overlay/`)
      } else {
        await overlayWindow.loadFile(join(__dirname, '../renderer/browser-overlay/index.html'))
      }

      this.ready = true
      this.loadingPromise = null
      this.flushQueuedPayloads()
    } catch (error) {
      console.warn('[YoBrowserOverlay] failed to load overlay renderer', error)
      this.loadingPromise = null
      this.ready = false
    }
  }

  private flushQueuedPayloads(): void {
    const overlayWindow = this.window
    if (!overlayWindow || overlayWindow.isDestroyed() || !this.ready) {
      return
    }

    for (const payload of this.queuedPayloads.splice(0)) {
      overlayWindow.webContents.send(browserActivityChangedEvent.name, payload)
    }
  }

  private showForActivity(): void {
    if (!this.window || this.window.isDestroyed()) {
      return
    }

    if (this.lastScreenBounds) {
      this.window.setBounds(this.lastScreenBounds)
    }

    if (!this.window.isVisible()) {
      this.window.showInactive()
    }

    this.clearHideTimer()
    this.hideTimer = setTimeout(() => {
      this.hide()
    }, OVERLAY_AUTO_HIDE_MS)
  }

  private clearHideTimer(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
  }
}
