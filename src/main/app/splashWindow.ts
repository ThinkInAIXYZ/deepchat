/**
 * SplashWindow - Manages splash screen display during application initialization
 */

import path from 'path'
import { BrowserWindow, ipcMain, nativeImage } from 'electron'
import { is } from '@electron-toolkit/utils'
import icon from '../../../resources/icon.png?asset' // 应用图标 (macOS/Linux)
import iconWin from '../../../resources/icon.ico?asset' // 应用图标 (Windows)
import {
  DATABASE_UNLOCK_CANCEL_CHANNEL,
  DATABASE_UNLOCK_PROGRESS_CHANNEL,
  DATABASE_UNLOCK_REQUEST_CHANNEL,
  DATABASE_UNLOCK_SUBMIT_CHANNEL,
  type DatabaseUnlockProgressPayload,
  type DatabaseUnlockRequestPayload,
  type DatabaseUnlockReason
} from '@shared/contracts/databaseSecurity'
import { activateAppOnMac } from '@/lib/activateApp'
import { SPLASH_DEBUG_MODE_CHANNEL, type SplashDebugMode } from '@shared/contracts/splash'

const SPLASH_SHOW_DELAY_MS = 200

export class SplashWindow {
  private splashWindow: BrowserWindow | null = null
  private unlockRequest: {
    requestId: string
    payload: DatabaseUnlockRequestPayload
    resolve: (password: string | null) => void
  } | null = null
  private pendingUnlockProgress: DatabaseUnlockProgressPayload | null = null
  private splashReadyToShow = false
  private splashDidFinishLoad = false
  private splashShowDelayElapsed = false
  private suppressSplashShow = false
  private forceShowWhenLoaded = false
  private splashLoadCanceled = false
  private splashLoadPromise: Promise<void> | null = null
  private splashShowDelayTimer: ReturnType<typeof setTimeout> | null = null
  private debugMode: SplashDebugMode | null = null
  constructor() {
    this.setupDatabaseUnlockListeners()
  }

  handleWindowCreated(isMainWindow: boolean): void {
    if (!isMainWindow || this.isVisible()) {
      return
    }

    this.suppressSplashShow = true
    this.clearSplashShowDelayTimer()
    this.closeHiddenSplashWindow()
  }

  /**
   * Create and display the splash window
   */
  async create(): Promise<void> {
    if (this.splashWindow) {
      return
    }

    this.splashReadyToShow = false
    this.splashDidFinishLoad = false
    this.splashShowDelayElapsed = false
    this.suppressSplashShow = false
    this.forceShowWhenLoaded = false
    this.splashLoadCanceled = false
    this.splashLoadPromise = null
    this.clearSplashShowDelayTimer()
    this.splashShowDelayTimer = setTimeout(() => {
      this.splashShowDelayElapsed = true
      this.maybeShowSplash()
    }, SPLASH_SHOW_DELAY_MS)

    const iconFile = nativeImage.createFromPath(process.platform === 'win32' ? iconWin : icon)

    try {
      this.splashWindow = new BrowserWindow({
        width: 420,
        height: 340,
        icon: iconFile,
        resizable: false,
        movable: false,
        frame: false,
        alwaysOnTop: true,
        center: true,
        show: false, // 先隐藏窗口，等待 ready-to-show 以避免白屏
        autoHideMenuBar: true,
        skipTaskbar: true,
        transparent: true,
        backgroundColor: '#00000000',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, '../preload/splash.mjs'),
          sandbox: false,
          devTools: is.dev
        }
      })
      this.splashWindow.on('ready-to-show', () => {
        this.splashReadyToShow = true
        this.maybeShowSplash()
      })

      this.splashWindow.webContents.on('did-finish-load', () => {
        this.splashDidFinishLoad = false
        this.markSplashLoaded()
      })

      this.splashLoadPromise = this.loadSplashRenderer().catch((error) => {
        if (!this.shouldContinueSplashLoad()) {
          return
        }
        console.error('Failed to load splash window:', error)
        this.markSplashLoaded()
      })

      // Handle window closed event6
      this.splashWindow.on('closed', () => {
        this.clearSplashShowDelayTimer()
        this.splashWindow = null
        this.splashDidFinishLoad = false
        this.forceShowWhenLoaded = false
        this.splashLoadCanceled = true
        this.splashLoadPromise = null
      })

      if (this.suppressSplashShow) {
        this.closeHiddenSplashWindow()
      }
    } catch (error) {
      this.clearSplashShowDelayTimer()
      console.error('Failed to create splash window:', error)
      throw error
    }
  }

  showDatabaseUnlockProgress(
    payload: DatabaseUnlockProgressPayload,
    options: { skipDelay?: boolean } = {}
  ): void {
    this.pendingUnlockProgress = payload
    if (payload.active) {
      this.forceShowSplash({ skipDelay: options.skipDelay })
    }
    this.emitDatabaseUnlockState()
  }

  async requestDatabaseUnlock(payload: {
    reason: DatabaseUnlockReason
    safeStorageAvailable: boolean
  }): Promise<string | null> {
    this.unlockRequest?.resolve(null)

    const requestId = `database-unlock-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const requestPayload: DatabaseUnlockRequestPayload = {
      requestId,
      reason: payload.reason,
      safeStorageAvailable: payload.safeStorageAvailable
    }

    return await new Promise((resolve) => {
      this.unlockRequest = { requestId, payload: requestPayload, resolve }
      this.forceShowSplash({ skipDelay: true })
      this.emitDatabaseUnlockState()
    })
  }

  async showDebugScenario(mode: SplashDebugMode): Promise<void> {
    this.debugMode = mode
    if (!this.splashWindow || this.splashWindow.isDestroyed()) {
      await this.create()
    }
    this.forceShowSplash({ skipDelay: true })
    this.emitDebugMode()
  }

  async closeDebugScenario(): Promise<boolean> {
    if (!this.debugMode) {
      return false
    }
    this.debugMode = null
    await this.close({ resolveUnlockRequest: false, skipTransition: true })
    return true
  }

  /**
   * Close the splash window
   */
  async close(
    options: { resolveUnlockRequest?: boolean; skipTransition?: boolean } = {}
  ): Promise<void> {
    if (options.resolveUnlockRequest !== false) {
      this.unlockRequest?.resolve(null)
      this.unlockRequest = null
    }
    if (options.resolveUnlockRequest !== false) {
      this.pendingUnlockProgress = null
    }
    this.forceShowWhenLoaded = false
    this.splashLoadCanceled = true
    this.splashLoadPromise = null
    this.clearSplashShowDelayTimer()

    if (!this.splashWindow || this.splashWindow.isDestroyed()) {
      return
    }

    try {
      if (this.splashWindow.isVisible() && !options.skipTransition) {
        // Add a small delay for smooth transition when the splash is actually visible.
        await new Promise((resolve) => setTimeout(resolve, 500))
      }

      this.splashWindow.close()
      this.splashWindow = null
    } catch (error) {
      console.error('Failed to close splash window:', error)
    }
  }

  /**
   * Check if splash window is currently visible
   */
  isVisible(): boolean {
    return (
      this.splashWindow !== null &&
      !this.splashWindow.isDestroyed() &&
      this.splashWindow.isVisible()
    )
  }

  private setupDatabaseUnlockListeners(): void {
    ipcMain.on(DATABASE_UNLOCK_SUBMIT_CHANNEL, (event, payload: unknown) => {
      if (!this.isSplashSender(event.sender.id) || !this.unlockRequest) {
        return
      }
      if (!payload || typeof payload !== 'object') {
        return
      }
      const requestId = (payload as { requestId?: unknown }).requestId
      const password = (payload as { password?: unknown }).password
      if (requestId !== this.unlockRequest.requestId || typeof password !== 'string') {
        return
      }

      const current = this.unlockRequest
      this.unlockRequest = null
      current.resolve(password)
    })

    ipcMain.on(DATABASE_UNLOCK_CANCEL_CHANNEL, (event, payload: unknown) => {
      if (!this.isSplashSender(event.sender.id) || !this.unlockRequest) {
        return
      }
      const requestId =
        payload && typeof payload === 'object'
          ? (payload as { requestId?: unknown }).requestId
          : undefined
      if (requestId !== this.unlockRequest.requestId) {
        return
      }

      const current = this.unlockRequest
      this.unlockRequest = null
      current.resolve(null)
    })
  }

  private isSplashSender(webContentsId: number): boolean {
    return this.splashWindow?.webContents.id === webContentsId
  }

  private emitDatabaseUnlockState(): void {
    if (!this.splashWindow || this.splashWindow.isDestroyed() || !this.splashDidFinishLoad) {
      return
    }

    if (this.pendingUnlockProgress) {
      this.splashWindow.webContents.send(
        DATABASE_UNLOCK_PROGRESS_CHANNEL,
        this.pendingUnlockProgress
      )
    }

    if (this.unlockRequest) {
      this.splashWindow.webContents.send(
        DATABASE_UNLOCK_REQUEST_CHANNEL,
        this.unlockRequest.payload
      )
    }
  }

  private emitDebugMode(): void {
    if (
      !this.debugMode ||
      !this.splashWindow ||
      this.splashWindow.isDestroyed() ||
      !this.splashDidFinishLoad
    ) {
      return
    }
    this.splashWindow.webContents.send(SPLASH_DEBUG_MODE_CHANNEL, this.debugMode)
  }

  private maybeShowSplash(): void {
    if (
      !this.splashWindow ||
      this.splashWindow.isDestroyed() ||
      this.suppressSplashShow ||
      !this.splashReadyToShow ||
      !this.splashShowDelayElapsed
    ) {
      return
    }

    this.showSplashWindow()
  }

  private forceShowSplash(options: { skipDelay?: boolean } = {}): void {
    if (!this.splashWindow || this.splashWindow.isDestroyed()) {
      return
    }
    this.suppressSplashShow = false
    this.splashShowDelayElapsed = true
    if (options.skipDelay) {
      this.clearSplashShowDelayTimer()
      this.forceShowWhenLoaded = true
      if (this.splashDidFinishLoad || this.splashReadyToShow) {
        this.showSplashWindow()
        return
      }
      void this.splashLoadPromise?.finally(() => {
        if (this.forceShowWhenLoaded) {
          this.showSplashWindow()
        }
      })
      return
    }
    if (this.splashReadyToShow) {
      this.showSplashWindow()
      return
    }
    this.splashWindow.once('ready-to-show', () => {
      if (!this.splashWindow?.isDestroyed()) {
        this.showSplashWindow()
      }
    })
  }

  private showSplashWindow(): void {
    if (!this.splashWindow || this.splashWindow.isDestroyed()) {
      return
    }
    this.splashWindow.show()
    this.splashWindow.focus()
    activateAppOnMac()
  }

  private markSplashLoaded(): void {
    if (this.splashDidFinishLoad) {
      return
    }
    this.splashDidFinishLoad = true
    this.emitDatabaseUnlockState()
    this.emitDebugMode()
    if (this.forceShowWhenLoaded) {
      this.showSplashWindow()
    }
  }

  private async loadSplashRenderer(): Promise<void> {
    if (!this.splashWindow || this.splashWindow.isDestroyed()) {
      return
    }

    const rendererUrl = process.env['ELECTRON_RENDERER_URL']

    if (is.dev && rendererUrl) {
      const devUrls = [
        new URL('/splash/index.html', rendererUrl).toString(),
        new URL('/splash/', rendererUrl).toString()
      ]
      for (const devUrl of devUrls) {
        if (await this.tryLoadSplashUrl(devUrl, 'dev splash URL', { quiet: true })) {
          return
        }
        if (!this.shouldContinueSplashLoad()) {
          return
        }
      }
    }

    if (
      await this.tryLoadSplashFile(path.join(__dirname, '../renderer/splash/index.html'), {
        quiet: is.dev
      })
    ) {
      return
    }
    if (!this.shouldContinueSplashLoad()) {
      return
    }

    if (
      await this.tryLoadSplashUrl(this.buildInlineFallbackSplashUrl(), 'inline fallback splash')
    ) {
      return
    }

    throw new Error('Unable to load any splash renderer')
  }

  private shouldContinueSplashLoad(): boolean {
    return Boolean(
      this.splashWindow &&
      !this.splashWindow.isDestroyed() &&
      !this.splashLoadCanceled &&
      (!this.suppressSplashShow || this.forceShowWhenLoaded)
    )
  }

  private async tryLoadSplashUrl(
    url: string,
    source: string,
    options: { quiet?: boolean } = {}
  ): Promise<boolean> {
    const splashWindow = this.splashWindow
    if (!splashWindow || !this.shouldContinueSplashLoad()) {
      return false
    }

    try {
      await splashWindow.loadURL(url)
      if (!this.shouldContinueSplashLoad()) {
        return false
      }
      this.markSplashLoaded()
      return true
    } catch (error) {
      if (!this.shouldContinueSplashLoad()) {
        return false
      }
      if (!options.quiet) {
        console.warn(`[SplashWindow] Failed to load ${source} (${url}); falling back:`, error)
      }
      return false
    }
  }

  private async tryLoadSplashFile(
    filePath: string,
    options: { quiet?: boolean } = {}
  ): Promise<boolean> {
    const splashWindow = this.splashWindow
    if (!splashWindow || !this.shouldContinueSplashLoad()) {
      return false
    }

    try {
      await splashWindow.loadFile(filePath)
      if (!this.shouldContinueSplashLoad()) {
        return false
      }
      this.markSplashLoaded()
      return true
    } catch (error) {
      if (!this.shouldContinueSplashLoad()) {
        return false
      }
      if (!options.quiet) {
        console.warn(
          `[SplashWindow] Failed to load splash file (${filePath}); falling back:`,
          error
        )
      }
      return false
    }
  }

  private buildInlineFallbackSplashUrl(): string {
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>DeepChat</title>
    <style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; background: transparent; color: #fff; overflow: hidden; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .shell { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; padding: 32px; }
      .shell--manual-unlock { background: #020817; }
      .panel { width: min(340px, 100%); display: flex; flex-direction: column; gap: 11px; }
      .title { font-size: 22px; font-weight: 600; }
      .subtitle, .hint, label { color: rgba(255,255,255,.72); font-size: 13px; line-height: 1.45; }
      label { margin-top: 8px; font-size: 12px; }
      input { height: 36px; border: 1px solid rgba(255,255,255,.16); border-radius: 8px; outline: none; background: rgba(255,255,255,.08); color: white; padding: 0 10px; }
      input:focus { border-color: rgba(255,255,255,.42); }
      .actions { display: flex; gap: 8px; margin-top: 4px; }
      button { height: 34px; border: 1px solid rgba(255,255,255,.18); border-radius: 8px; background: rgba(255,255,255,.08); color: white; padding: 0 14px; font-size: 13px; }
      button.primary { border-color: #60a5fa; background: #2563eb; }
      button:disabled { opacity: .58; }
      .error { color: #fca5a5; font-size: 12px; }
      [hidden] { display: none !important; }
    </style>
  </head>
  <body>
    <div class="shell">
      <form id="panel" class="panel">
        <div class="title">DeepChat</div>
        <div id="subtitle" class="subtitle">Unlocking local database</div>
        <label id="label" for="password" hidden>SQLite password</label>
        <input id="password" type="password" autocomplete="current-password" hidden />
        <div id="error" class="error" hidden>Wrong password. Try again.</div>
        <div id="actions" class="actions" hidden>
          <button id="submit" class="primary" type="submit" disabled>Unlock</button>
          <button id="quit" type="button">Quit</button>
        </div>
        <p id="hint" class="hint">DeepChat is reading the saved password from the system credential store.</p>
      </form>
    </div>
    <script>
      const splash = window.deepchatSplash
      let requestId = ''
      const shell = document.querySelector('.shell')
      const panel = document.getElementById('panel')
      const subtitle = document.getElementById('subtitle')
      const label = document.getElementById('label')
      const password = document.getElementById('password')
      const error = document.getElementById('error')
      const actions = document.getElementById('actions')
      const submit = document.getElementById('submit')
      const quit = document.getElementById('quit')
      const hint = document.getElementById('hint')
      const setDebugMode = (mode) => {
        requestId = ''
        shell.classList.toggle('shell--manual-unlock', mode === 'unlock')
        password.value = ''
        error.hidden = true
        if (mode === 'loading') {
          label.hidden = true
          password.hidden = true
          actions.hidden = true
          subtitle.textContent = 'Unlocking local database'
          hint.textContent = 'DeepChat is starting.'
          return
        }
        if (mode === 'system-unlock') {
          label.hidden = true
          password.hidden = true
          actions.hidden = true
          subtitle.textContent = 'Unlocking local database'
          hint.textContent = 'DeepChat is reading the saved password from the system credential store.'
          return
        }
        label.hidden = false
        password.hidden = false
        actions.hidden = false
        password.disabled = true
        submit.disabled = true
        quit.disabled = true
        subtitle.textContent = 'Local database is encrypted'
        hint.textContent = 'Development preview — password submission is disabled.'
      }
      const setUnlock = (payload) => {
        shell.classList.add('shell--manual-unlock')
        password.disabled = false
        quit.disabled = false
        requestId = payload.requestId
        subtitle.textContent = 'Local database is encrypted'
        label.hidden = false
        password.hidden = false
        actions.hidden = false
        error.hidden = payload.reason !== 'invalid'
        password.value = ''
        submit.textContent = 'Unlock'
        submit.disabled = true
        hint.textContent = payload.reason === 'system-key-missing'
          ? 'The saved system credential is missing or cannot be decrypted. Enter the SQLite password once to unlock and save it again.'
          : payload.safeStorageAvailable
            ? 'Enter the SQLite password to unlock this database. Future startups can open automatically after it is saved to the system credential store.'
            : 'System unlock is unavailable on this device, so manual unlock is required.'
        setTimeout(() => password.focus(), 0)
      }
      password.addEventListener('input', () => {
        submit.disabled = !password.value
      })
      panel.addEventListener('submit', (event) => {
        event.preventDefault()
        if (!splash || !requestId || !password.value) return
        splash.submitUnlock({ requestId, password: password.value })
        password.value = ''
        submit.disabled = true
        submit.textContent = 'Opening...'
      })
      quit.addEventListener('click', () => {
        if (!splash || !requestId) return
        splash.cancelUnlock({ requestId })
      })
      splash && splash.onDebugMode((mode) => setDebugMode(mode))
      splash && splash.onUnlockRequest((payload) => setUnlock(payload))
      splash && splash.onUnlockProgress((payload) => {
        if (payload && payload.active && !requestId) {
          subtitle.textContent = 'Unlocking local database'
          hint.textContent = 'DeepChat is reading the saved password from the system credential store.'
        }
      })
    </script>
  </body>
</html>`
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  }

  private clearSplashShowDelayTimer(): void {
    if (this.splashShowDelayTimer) {
      clearTimeout(this.splashShowDelayTimer)
      this.splashShowDelayTimer = null
    }
  }

  private closeHiddenSplashWindow(): void {
    if (!this.splashWindow || this.splashWindow.isDestroyed() || this.splashWindow.isVisible()) {
      return
    }

    try {
      this.splashWindow.close()
    } catch (error) {
      console.error('Failed to close hidden splash window:', error)
    }
  }
}
