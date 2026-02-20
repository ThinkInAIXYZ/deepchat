import { BrowserWindow, shell, nativeImage, ipcMain, screen, WebContents } from 'electron'
import { join } from 'path'
import icon from '../../../../resources/icon.png?asset'
import iconWin from '../../../../resources/icon.ico?asset'
import { is } from '@electron-toolkit/utils'
import { IConfigPresenter, IWindowPresenter } from '@shared/presenter'
import { eventBus } from '@/eventbus'
import { CONFIG_EVENTS, SHORTCUT_EVENTS, SYSTEM_EVENTS, WINDOW_EVENTS } from '@/events'
import { presenter } from '../'
import windowStateManager from 'electron-window-state'
import { FloatingChatWindow } from './FloatingChatWindow'
import { getYoBrowserSession } from '../browser/yoBrowserSession'

type AppWindowKind = 'chat' | 'browser'

const DEFAULT_CHAT_BOUNDS = {
  width: 900,
  height: 700
}

const DEFAULT_BROWSER_BOUNDS = {
  width: 600,
  height: 620
}

export class WindowPresenter implements IWindowPresenter {
  windows: Map<number, BrowserWindow>

  private readonly configPresenter: IConfigPresenter
  private isQuitting = false
  private focusedWindowId: number | null = null
  private mainWindowId: number | null = null
  private floatingChatWindow: FloatingChatWindow | null = null
  private settingsWindow: BrowserWindow | null = null
  private readonly windowTypes = new Map<number, AppWindowKind>()

  constructor(configPresenter: IConfigPresenter) {
    this.windows = new Map()
    this.configPresenter = configPresenter

    ipcMain.on('get-window-id', (event) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      event.returnValue = window ? window.id : null
    })

    ipcMain.on('get-web-contents-id', (event) => {
      event.returnValue = event.sender.id
    })

    ipcMain.on('close-floating-window', (event) => {
      const webContentsId = event.sender.id
      const floating = this.floatingChatWindow?.getWindow()
      if (floating && floating.webContents.id === webContentsId) {
        this.hideFloatingChatWindow()
      }
    })

    eventBus.on(SHORTCUT_EVENTS.CREATE_NEW_WINDOW, () => {
      void this.createChatWindow()
    })

    eventBus.on(SHORTCUT_EVENTS.GO_SETTINGS, async () => {
      try {
        await this.openOrFocusSettingsWindow()
      } catch (error) {
        console.error('Failed to open/focus settings window via eventBus:', error)
      }
    })

    ipcMain.on(SHORTCUT_EVENTS.GO_SETTINGS, async () => {
      try {
        await this.openOrFocusSettingsWindow()
      } catch (error) {
        console.error('Failed to open/focus settings window via IPC:', error)
      }
    })

    eventBus.on(SYSTEM_EVENTS.SYSTEM_THEME_UPDATED, (isDark: boolean) => {
      this.sendToAllWindows('system-theme-updated', isDark)
    })

    eventBus.on(CONFIG_EVENTS.CONTENT_PROTECTION_CHANGED, (enabled: boolean) => {
      for (const window of this.windows.values()) {
        if (!window.isDestroyed()) {
          this.updateContentProtection(window, enabled)
        }
      }

      if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
        this.updateContentProtection(this.settingsWindow, enabled)
      }

      const floating = this.floatingChatWindow?.getWindow()
      if (floating && !floating.isDestroyed()) {
        this.updateContentProtection(floating, enabled)
      }

      setTimeout(() => {
        presenter.devicePresenter.restartApp()
      }, 1000)
    })

    eventBus.on(WINDOW_EVENTS.SET_APPLICATION_QUITTING, (data: { isQuitting: boolean }) => {
      this.setApplicationQuitting(data.isQuitting)
    })
  }

  get mainWindow(): BrowserWindow | undefined {
    const focused = this.getFocusedWindow()
    if (focused && !focused.isDestroyed()) {
      return focused
    }

    if (this.mainWindowId !== null) {
      const main = this.windows.get(this.mainWindowId)
      if (main && !main.isDestroyed()) {
        return main
      }
    }

    const all = this.getAllWindows()
    return all[0]
  }

  public async createChatWindow(options?: { x?: number; y?: number }): Promise<number | null> {
    return this.createManagedWindow({
      kind: 'chat',
      x: options?.x,
      y: options?.y,
      autoShow: true
    })
  }

  public async createBrowserWindow(options?: {
    x?: number
    y?: number
    initialUrl?: string
    autoShow?: boolean
  }): Promise<number | null> {
    return this.createManagedWindow({
      kind: 'browser',
      x: options?.x,
      y: options?.y,
      initialUrl: options?.initialUrl,
      autoShow: options?.autoShow ?? false
    })
  }

  async createShellWindow(options?: {
    activateTabId?: number
    initialTab?: {
      url: string
      type?: string
      icon?: string
    }
    forMovedTab?: boolean
    windowType?: 'chat' | 'browser'
    x?: number
    y?: number
  }): Promise<number | null> {
    if (typeof options?.activateTabId === 'number') {
      const directWindow = this.windows.get(options.activateTabId)
      if (directWindow && !directWindow.isDestroyed()) {
        this.show(directWindow.id, true)
        return directWindow.id
      }

      const mappedWindow = this.getWindowByWebContentsId(options.activateTabId)
      if (mappedWindow && !mappedWindow.isDestroyed()) {
        this.show(mappedWindow.id, true)
        return mappedWindow.id
      }
    }

    if (options?.windowType === 'browser') {
      const browserUrl =
        options.initialTab?.url && !options.initialTab.url.startsWith('local://')
          ? options.initialTab.url
          : 'about:blank'

      return this.createBrowserWindow({
        x: options.x,
        y: options.y,
        initialUrl: browserUrl,
        autoShow: options.forMovedTab === true
      })
    }

    return this.createChatWindow({ x: options?.x, y: options?.y })
  }

  private async createManagedWindow(params: {
    kind: AppWindowKind
    x?: number
    y?: number
    initialUrl?: string
    autoShow: boolean
  }): Promise<number | null> {
    const defaults = params.kind === 'browser' ? DEFAULT_BROWSER_BOUNDS : DEFAULT_CHAT_BOUNDS
    const stateFile = params.kind === 'browser' ? 'browser-window-state.json' : 'window-state.json'

    const managedState = windowStateManager({
      file: stateFile,
      defaultWidth: defaults.width,
      defaultHeight: defaults.height
    })

    const position = this.validateWindowPosition(
      params.x ?? managedState.x,
      managedState.width,
      params.y ?? managedState.y,
      managedState.height
    )

    const iconFile = nativeImage.createFromPath(process.platform === 'win32' ? iconWin : icon)

    const browserWindow = new BrowserWindow({
      width: managedState.width,
      height: managedState.height,
      x: position.x,
      y: position.y,
      show: false,
      autoHideMenuBar: true,
      icon: iconFile,
      titleBarStyle: 'hiddenInset',
      transparent: process.platform === 'darwin',
      vibrancy: process.platform === 'darwin' ? 'hud' : undefined,
      backgroundMaterial: process.platform === 'win32' ? 'mica' : undefined,
      backgroundColor: '#00ffffff',
      maximizable: true,
      frame: process.platform === 'darwin',
      hasShadow: true,
      trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 10 } : undefined,
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        sandbox: false,
        devTools: is.dev,
        session: params.kind === 'browser' ? getYoBrowserSession() : undefined,
        webviewTag: params.kind === 'browser'
      },
      roundedCorners: true
    })

    const windowId = browserWindow.id
    this.windows.set(windowId, browserWindow)
    this.windowTypes.set(windowId, params.kind)

    if (this.mainWindowId === null && params.kind === 'chat') {
      this.mainWindowId = windowId
    }

    managedState.manage(browserWindow)

    this.updateContentProtection(browserWindow, this.configPresenter.getContentProtectionEnabled())

    browserWindow.on('ready-to-show', () => {
      if (browserWindow.isDestroyed()) {
        return
      }

      eventBus.sendToMain(WINDOW_EVENTS.WINDOW_CREATED, windowId)

      if (params.autoShow) {
        browserWindow.show()
        browserWindow.focus()
      }
    })

    browserWindow.on('focus', () => {
      this.focusedWindowId = windowId
      eventBus.sendToMain(WINDOW_EVENTS.WINDOW_FOCUSED, windowId)
      if (!browserWindow.isDestroyed()) {
        browserWindow.webContents.send('window-focused', windowId)
      }
    })

    browserWindow.on('blur', () => {
      if (this.focusedWindowId === windowId) {
        this.focusedWindowId = null
      }
      eventBus.sendToMain(WINDOW_EVENTS.WINDOW_BLURRED, windowId)
      if (!browserWindow.isDestroyed()) {
        browserWindow.webContents.send('window-blurred', windowId)
      }
    })

    browserWindow.on('maximize', () => {
      if (!browserWindow.isDestroyed()) {
        browserWindow.webContents.send(WINDOW_EVENTS.WINDOW_MAXIMIZED)
        eventBus.sendToMain(WINDOW_EVENTS.WINDOW_MAXIMIZED, windowId)
      }
    })

    browserWindow.on('unmaximize', () => {
      if (!browserWindow.isDestroyed()) {
        browserWindow.webContents.send(WINDOW_EVENTS.WINDOW_UNMAXIMIZED)
        eventBus.sendToMain(WINDOW_EVENTS.WINDOW_UNMAXIMIZED, windowId)
      }
    })

    browserWindow.on('restore', () => {
      if (!browserWindow.isDestroyed()) {
        browserWindow.webContents.send(WINDOW_EVENTS.WINDOW_UNMAXIMIZED)
      }
      eventBus.sendToMain(WINDOW_EVENTS.WINDOW_RESTORED, windowId)
    })

    browserWindow.on('enter-full-screen', () => {
      if (!browserWindow.isDestroyed()) {
        browserWindow.webContents.send(WINDOW_EVENTS.WINDOW_ENTER_FULL_SCREEN)
      }
      eventBus.sendToMain(WINDOW_EVENTS.WINDOW_ENTER_FULL_SCREEN, windowId)
    })

    browserWindow.on('leave-full-screen', () => {
      if (!browserWindow.isDestroyed()) {
        browserWindow.webContents.send(WINDOW_EVENTS.WINDOW_LEAVE_FULL_SCREEN)
      }
      eventBus.sendToMain(WINDOW_EVENTS.WINDOW_LEAVE_FULL_SCREEN, windowId)
    })

    browserWindow.on('resize', () => {
      eventBus.sendToMain(WINDOW_EVENTS.WINDOW_RESIZE, windowId)
    })

    browserWindow.on('close', (event) => {
      if (!this.isQuitting) {
        const shouldQuitOnClose = this.configPresenter.getCloseToQuit()
        const shouldHideInstead = windowId === this.mainWindowId && !shouldQuitOnClose
        if (shouldHideInstead) {
          event.preventDefault()
          browserWindow.hide()
          return
        }
      }
    })

    browserWindow.on('closed', () => {
      this.windows.delete(windowId)
      this.windowTypes.delete(windowId)
      managedState.unmanage()

      if (this.focusedWindowId === windowId) {
        this.focusedWindowId = null
      }
      if (this.mainWindowId === windowId) {
        const fallbackMain = this.getAllWindows().find((w) => this.windowTypes.get(w.id) === 'chat')
        this.mainWindowId = fallbackMain?.id ?? null
      }

      eventBus.sendToMain(WINDOW_EVENTS.WINDOW_CLOSED, windowId)
    })

    if (params.kind === 'chat' || params.kind === 'browser') {
      const browserInitialUrl =
        params.kind === 'browser' &&
        params.initialUrl &&
        params.initialUrl.trim() &&
        params.initialUrl !== 'about:blank'
          ? `?url=${encodeURIComponent(params.initialUrl)}`
          : ''
      const targetHash = params.kind === 'browser' ? `/browser${browserInitialUrl}` : '/chat'

      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        await browserWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${targetHash}`)
      } else {
        await browserWindow.loadFile(join(__dirname, '../renderer/index.html'), {
          hash: targetHash
        })
      }

      if (params.kind === 'chat') {
        browserWindow.webContents.once('did-finish-load', () => {
          eventBus.sendToMain(WINDOW_EVENTS.FIRST_CONTENT_LOADED, windowId)
        })
      }
    }

    if (is.dev) {
      browserWindow.webContents.openDevTools({ mode: 'detach' })
    }

    return windowId
  }

  previewFile(filePath: string): void {
    let targetWindow = this.getFocusedWindow()
    if (!targetWindow && this.floatingChatWindow && this.floatingChatWindow.isShowing()) {
      const floating = this.floatingChatWindow.getWindow()
      if (floating) {
        targetWindow = floating
      }
    }

    if (!targetWindow) {
      targetWindow = this.mainWindow
    }

    if (!targetWindow || targetWindow.isDestroyed()) {
      return
    }

    if (process.platform === 'darwin') {
      targetWindow.previewFile(filePath)
      return
    }

    void shell.openPath(filePath)
  }

  minimize(windowId: number): void {
    const window = this.windows.get(windowId)
    if (window && !window.isDestroyed()) {
      window.minimize()
    }
  }

  maximize(windowId: number): void {
    const window = this.windows.get(windowId)
    if (!window || window.isDestroyed()) {
      return
    }

    if (window.isMaximized()) {
      window.unmaximize()
    } else {
      window.maximize()
    }
  }

  close(windowId: number): void {
    const window = this.windows.get(windowId)
    if (window && !window.isDestroyed()) {
      window.close()
    }
  }

  async closeWindow(windowId: number, _forceClose: boolean = false): Promise<void> {
    this.close(windowId)
  }

  hide(windowId: number): void {
    const window = this.windows.get(windowId)
    if (!window || window.isDestroyed()) {
      return
    }

    if (window.isFullScreen()) {
      window.once('leave-full-screen', () => {
        if (!window.isDestroyed()) {
          window.hide()
        }
      })
      window.setFullScreen(false)
      return
    }

    window.hide()
  }

  show(windowId?: number, shouldFocus: boolean = true): void {
    const target =
      typeof windowId === 'number'
        ? this.windows.get(windowId)
        : this.getFocusedWindow() || this.getAllWindows()[0]

    if (!target || target.isDestroyed()) {
      return
    }

    target.show()
    if (shouldFocus) {
      target.focus()
    }
  }

  isMaximized(windowId: number): boolean {
    const window = this.windows.get(windowId)
    return Boolean(window && !window.isDestroyed() && window.isMaximized())
  }

  isMainWindowFocused(windowId: number): boolean {
    const focused = this.getFocusedWindow()
    return focused ? focused.id === windowId : false
  }

  async sendToAllWindows(channel: string, ...args: unknown[]): Promise<void> {
    for (const window of this.windows.values()) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, ...args)
      }
    }

    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.webContents.send(channel, ...args)
    }

    const floating = this.floatingChatWindow?.getWindow()
    if (floating && !floating.isDestroyed() && this.floatingChatWindow?.isShowing()) {
      floating.webContents.send(channel, ...args)
    }
  }

  sendToWindow(windowId: number, channel: string, ...args: unknown[]): boolean {
    if (
      this.settingsWindow &&
      !this.settingsWindow.isDestroyed() &&
      this.settingsWindow.id === windowId
    ) {
      this.settingsWindow.webContents.send(channel, ...args)
      return true
    }

    const window = this.windows.get(windowId)
    if (!window || window.isDestroyed()) {
      return false
    }

    window.webContents.send(channel, ...args)
    return true
  }

  async sendToDefaultTab(
    channel: string,
    switchToTarget: boolean = false,
    ...args: unknown[]
  ): Promise<boolean> {
    const target = this.getFocusedWindow() || this.mainWindow || this.getAllWindows()[0]
    if (!target || target.isDestroyed()) {
      return false
    }

    target.webContents.send(channel, ...args)
    if (switchToTarget) {
      target.show()
      target.focus()
    }

    return true
  }

  public async openOrFocusSettingsTab(_windowId: number): Promise<void> {
    await this.openOrFocusSettingsWindow()
  }

  async sendToActiveTab(windowId: number, channel: string, ...args: unknown[]): Promise<boolean> {
    return this.sendToWindow(windowId, channel, ...args)
  }

  getFocusedWindow(): BrowserWindow | undefined {
    const focused = BrowserWindow.getFocusedWindow()
    if (focused && !focused.isDestroyed()) {
      if (this.windows.has(focused.id)) {
        this.focusedWindowId = focused.id
        return focused
      }
      if (this.settingsWindow && this.settingsWindow.id === focused.id) {
        return focused
      }
    }

    if (this.focusedWindowId !== null) {
      const remembered = this.windows.get(this.focusedWindowId)
      if (remembered && !remembered.isDestroyed()) {
        return remembered
      }
    }

    return undefined
  }

  getAllWindows(): BrowserWindow[] {
    return Array.from(this.windows.values()).filter((window) => !window.isDestroyed())
  }

  public async createFloatingChatWindow(): Promise<void> {
    if (this.floatingChatWindow) {
      return
    }

    this.floatingChatWindow = new FloatingChatWindow()
    await this.floatingChatWindow.create()
  }

  public async showFloatingChatWindow(floatingButtonPosition?: {
    x: number
    y: number
    width: number
    height: number
  }): Promise<void> {
    if (!this.floatingChatWindow) {
      await this.createFloatingChatWindow()
    }

    this.floatingChatWindow?.show(floatingButtonPosition)
  }

  public hideFloatingChatWindow(): void {
    this.floatingChatWindow?.hide()
  }

  public async toggleFloatingChatWindow(floatingButtonPosition?: {
    x: number
    y: number
    width: number
    height: number
  }): Promise<void> {
    if (!this.floatingChatWindow) {
      await this.createFloatingChatWindow()
    }

    this.floatingChatWindow?.toggle(floatingButtonPosition)
  }

  public destroyFloatingChatWindow(): void {
    this.floatingChatWindow?.destroy()
    this.floatingChatWindow = null
  }

  public isFloatingChatWindowVisible(): boolean {
    return this.floatingChatWindow?.isShowing() || false
  }

  public getFloatingChatWindow(): FloatingChatWindow | null {
    return this.floatingChatWindow
  }

  public async createSettingsWindow(): Promise<number | null> {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.show()
      this.settingsWindow.focus()
      return this.settingsWindow.id
    }

    const iconFile = nativeImage.createFromPath(process.platform === 'win32' ? iconWin : icon)
    const state = windowStateManager({
      file: 'settings-window-state.json',
      defaultWidth: 900,
      defaultHeight: 600
    })

    const settingsWindow = new BrowserWindow({
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.height,
      show: false,
      autoHideMenuBar: true,
      fullscreenable: false,
      icon: iconFile,
      title: 'DeepChat - Settings',
      titleBarStyle: 'hiddenInset',
      transparent: process.platform === 'darwin',
      vibrancy: process.platform === 'darwin' ? 'hud' : undefined,
      backgroundMaterial: process.platform === 'win32' ? 'mica' : undefined,
      backgroundColor: '#00ffffff',
      maximizable: true,
      minimizable: true,
      frame: process.platform === 'darwin',
      hasShadow: true,
      trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 10 } : undefined,
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        sandbox: false,
        devTools: is.dev
      },
      roundedCorners: true
    })

    this.settingsWindow = settingsWindow
    const windowId = settingsWindow.id
    state.manage(settingsWindow)

    settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const parsed = new URL(url)
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          void shell.openExternal(url)
        }
      } catch {
        // no-op
      }
      return { action: 'deny' }
    })

    this.updateContentProtection(settingsWindow, this.configPresenter.getContentProtectionEnabled())

    settingsWindow.on('ready-to-show', () => {
      if (!settingsWindow.isDestroyed()) {
        settingsWindow.show()
      }
    })

    settingsWindow.on('closed', () => {
      state.unmanage()
      this.settingsWindow = null
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      await settingsWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/settings/index.html`)
    } else {
      await settingsWindow.loadFile(join(__dirname, '../renderer/settings/index.html'))
    }

    if (is.dev) {
      settingsWindow.webContents.openDevTools({ mode: 'detach' })
    }

    return windowId
  }

  public async openOrFocusSettingsWindow(): Promise<void> {
    await this.createSettingsWindow()
  }

  public getSettingsWindowId(): number | null {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      return this.settingsWindow.id
    }
    return null
  }

  public closeSettingsWindow(): void {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.close()
    }
  }

  public isApplicationQuitting(): boolean {
    return this.isQuitting
  }

  public setApplicationQuitting(isQuitting: boolean): void {
    this.isQuitting = isQuitting
  }

  public getWindowType(windowId: number): AppWindowKind {
    return this.windowTypes.get(windowId) ?? 'chat'
  }

  public getWindowByWebContentsId(webContentsId: number): BrowserWindow | undefined {
    return this.getAllWindows().find((window) => window.webContents.id === webContentsId)
  }

  public getWindowWebContents(windowId: number): WebContents | null {
    const window = this.windows.get(windowId)
    if (!window || window.isDestroyed()) {
      return null
    }
    return window.webContents
  }

  private updateContentProtection(window: BrowserWindow, enabled: boolean): void {
    if (window.isDestroyed()) {
      return
    }

    window.setContentProtection(enabled)
    window.webContents.setBackgroundThrottling(!enabled)
    window.webContents.setFrameRate(60)
    window.setBackgroundColor('#00000000')

    if (process.platform === 'darwin') {
      window.setHiddenInMissionControl(enabled)
      window.setSkipTaskbar(enabled)
    }
  }

  private validateWindowPosition(
    x: number,
    width: number,
    y: number,
    height: number
  ): { x: number; y: number } {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { workArea } = primaryDisplay
    const isXValid = x >= workArea.x && x + width <= workArea.x + workArea.width
    const isYValid = y >= workArea.y && y + height <= workArea.y + workArea.height

    if (!isXValid || !isYValid) {
      return {
        x: workArea.x + Math.max(0, (workArea.width - width) / 2),
        y: workArea.y + Math.max(0, (workArea.height - height) / 2)
      }
    }

    return { x, y }
  }
}
