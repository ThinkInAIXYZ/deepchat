import { BrowserWindow, WebContents, WebContentsView } from 'electron'
import type { Rectangle } from 'electron'
import { is } from '@electron-toolkit/utils'
import { eventBus, SendTarget } from '@/eventbus'
import { YO_BROWSER_EVENTS } from '@/events'
import type {
  BrowserContextSnapshot,
  BrowserTabInfo,
  BrowserWindowInfo,
  ScreenshotOptions
} from '@shared/types/browser'
import type { DownloadInfo, IWindowPresenter, IYoBrowserPresenter } from '@shared/presenter'
import { BrowserTab as BrowserPage } from './BrowserTab'
import { CDPManager } from './CDPManager'
import { ScreenshotManager } from './ScreenshotManager'
import { DownloadManager } from './DownloadManager'
import { clearYoBrowserSessionData, getYoBrowserSession } from './yoBrowserSession'
import { YoBrowserToolHandler } from './YoBrowserToolHandler'

type BrowserWindowState = {
  id: number
  viewId: number
  page: BrowserPage
  createdAt: number
  updatedAt: number
  isEmbedded?: boolean
  view?: WebContentsView
  visible?: boolean
  attachedWindowId?: number | null
}

export class YoBrowserPresenter implements IYoBrowserPresenter {
  private readonly browserWindows = new Map<number, BrowserWindowState>()
  private readonly viewIdToWindowId = new Map<number, number>()
  private readonly pageIdToWindowId = new Map<string, number>()
  private readonly attachedWindowIds = new Set<number>()
  private embeddedState: BrowserWindowState | null = null
  private activeWindowId: number | null = null
  private readonly cdpManager = new CDPManager()
  private readonly screenshotManager = new ScreenshotManager(this.cdpManager)
  private readonly downloadManager = new DownloadManager()
  private readonly windowPresenter: IWindowPresenter
  readonly toolHandler: YoBrowserToolHandler

  constructor(windowPresenter: IWindowPresenter) {
    this.windowPresenter = windowPresenter
    this.toolHandler = new YoBrowserToolHandler(this)
  }

  async initialize(): Promise<void> {
    // Lazy initialization only.
  }

  async ensureWindow(): Promise<number | null> {
    const existing = this.getResolvedWindowState()
    if (existing) {
      return existing.id
    }

    const created = await this.ensureEmbeddedState('about:blank')
    return created?.id ?? null
  }

  async openWindow(url?: string): Promise<BrowserWindowInfo | null> {
    const created = await this.ensureEmbeddedState(url ?? 'about:blank')
    if (!created) {
      return null
    }

    this.windowPresenter.show(created.id, true)
    this.setActiveWindowId(created.id)
    this.setWindowVisibility(created, true)
    this.emitWindowUpdated(created)
    return this.toWindowInfo(created)
  }

  async attachEmbeddedToWindow(windowId: number): Promise<number | null> {
    const state = await this.ensureEmbeddedState(undefined, windowId)
    if (!state?.view) {
      return null
    }

    const window = BrowserWindow.fromId(windowId)
    if (!window || window.isDestroyed()) {
      return null
    }

    if (state.attachedWindowId != null && state.attachedWindowId !== windowId) {
      const previousWindow = BrowserWindow.fromId(state.attachedWindowId)
      if (previousWindow && !previousWindow.isDestroyed()) {
        try {
          previousWindow.contentView.removeChildView(state.view)
        } catch {
          // Ignore already detached view.
        }
      }
    }

    if (state.attachedWindowId !== windowId) {
      try {
        window.contentView.addChildView(state.view)
      } catch {
        try {
          window.contentView.removeChildView(state.view)
        } catch {
          // Ignore already detached view.
        }
        window.contentView.addChildView(state.view)
      }
    }

    if (state.id !== windowId) {
      state.id = windowId
      this.pageIdToWindowId.set(state.page.pageId, windowId)
    }

    state.attachedWindowId = windowId
    state.updatedAt = Date.now()
    this.setActiveWindowId(windowId)
    this.emitWindowUpdated(state)
    return state.id
  }

  async updateEmbeddedBounds(windowId: number, bounds: Rectangle, visible: boolean): Promise<void> {
    const state = await this.ensureEmbeddedState(undefined, windowId)
    if (!state?.view) {
      return
    }

    if (!visible || bounds.width <= 0 || bounds.height <= 0) {
      await this.detachEmbedded()
      this.setWindowVisibility(state, false)
      return
    }

    await this.attachEmbeddedToWindow(windowId)
    state.view.setBounds({
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height))
    })
    state.updatedAt = Date.now()
    this.setWindowVisibility(state, true)
    this.emitWindowUpdated(state)
  }

  async detachEmbedded(): Promise<void> {
    const state = this.embeddedState
    if (!state?.view || state.attachedWindowId == null) {
      return
    }

    const window = BrowserWindow.fromId(state.attachedWindowId)
    if (window && !window.isDestroyed()) {
      try {
        window.contentView.removeChildView(state.view)
      } catch {
        // Ignore already detached view.
      }
    }

    state.attachedWindowId = null
    this.setWindowVisibility(state, false)
  }

  async focusWindow(windowId: number): Promise<void> {
    if (this.embeddedState?.id === windowId) {
      this.windowPresenter.show(windowId, true)
      this.setActiveWindowId(windowId)
      this.emitWindowUpdated(this.embeddedState)
      return
    }

    const state = this.browserWindows.get(windowId)
    if (!state) return
    this.windowPresenter.show(windowId, true)
    this.setActiveWindowId(windowId)
    this.emitWindowVisibility(windowId, true)
    this.emitWindowUpdated(state)
  }

  async closeWindow(windowId: number): Promise<void> {
    if (this.embeddedState?.id === windowId) {
      await this.destroyEmbeddedState(true)
      return
    }

    if (!this.browserWindows.has(windowId)) return
    await this.windowPresenter.closeWindow(windowId, true)
  }

  async listWindows(): Promise<BrowserWindowInfo[]> {
    const windows = [
      ...(this.embeddedState ? [this.embeddedState] : []),
      ...Array.from(this.browserWindows.values())
    ]

    return windows
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((state) => this.toWindowInfo(state))
  }

  async getActiveWindow(): Promise<BrowserWindowInfo | null> {
    const state = this.getResolvedWindowState()
    return state ? this.toWindowInfo(state) : null
  }

  async getWindowById(windowId: number): Promise<BrowserWindowInfo | null> {
    if (this.embeddedState?.id === windowId) {
      return this.toWindowInfo(this.embeddedState)
    }

    const state = this.browserWindows.get(windowId)
    return state ? this.toWindowInfo(state) : null
  }

  async hasWindow(): Promise<boolean> {
    return this.browserWindows.size > 0 || this.embeddedState != null
  }

  async show(shouldFocus: boolean = true): Promise<void> {
    const existing = this.getResolvedWindowState()
    if (existing) {
      if (existing.isEmbedded) {
        if (shouldFocus) {
          this.windowPresenter.show(existing.id, true)
          this.setActiveWindowId(existing.id)
        }
      } else {
        this.windowPresenter.show(existing.id, shouldFocus)
        if (shouldFocus) {
          this.setActiveWindowId(existing.id)
        }
      }
      this.setWindowVisibility(existing, true)
      return
    }

    await this.openWindow('about:blank')
  }

  async hide(): Promise<void> {
    const state = this.getResolvedWindowState()
    if (!state) return
    if (state.isEmbedded) {
      await this.detachEmbedded()
      return
    }
    this.windowPresenter.hide(state.id)
    this.emitWindowVisibility(state.id, false)
  }

  async toggleVisibility(): Promise<boolean> {
    const state = this.getResolvedWindowState()
    if (!state) {
      await this.openWindow('about:blank')
      return true
    }

    if (state.isEmbedded) {
      const nextVisible = !state.visible
      this.setWindowVisibility(state, nextVisible)
      return nextVisible
    }

    const window = BrowserWindow.fromId(state.id)
    if (!window || window.isDestroyed()) {
      await this.openWindow('about:blank')
      return true
    }

    if (window.isVisible()) {
      await this.hide()
      return false
    }

    await this.focusWindow(state.id)
    return true
  }

  async isVisible(): Promise<boolean> {
    const state = this.getResolvedWindowState()
    if (!state) return false
    const window = BrowserWindow.fromId(state.id)
    return Boolean(window && !window.isDestroyed() && window.isVisible())
  }

  async navigateWindow(windowId: number, url: string, timeoutMs?: number): Promise<void> {
    const state = this.browserWindows.get(windowId)
    if (!state) {
      const created = await this.openWindow(url)
      if (!created) {
        throw new Error(`Browser window ${windowId} not found`)
      }
      return
    }

    await state.page.navigate(url, timeoutMs)
    state.updatedAt = Date.now()
    this.emitWindowUpdated(state)
  }

  async goBack(target?: number | string): Promise<void> {
    const state = this.getResolvedWindowState(target)
    if (!state) return
    await state.page.goBack()
    state.updatedAt = Date.now()
    this.emitWindowUpdated(state)
  }

  async goForward(target?: number | string): Promise<void> {
    const state = this.getResolvedWindowState(target)
    if (!state) return
    await state.page.goForward()
    state.updatedAt = Date.now()
    this.emitWindowUpdated(state)
  }

  async reload(target?: number | string): Promise<void> {
    const state = this.getResolvedWindowState(target)
    if (!state) return
    await state.page.reload()
    state.updatedAt = Date.now()
    this.emitWindowUpdated(state)
  }

  async getNavigationState(target?: number | string): Promise<{
    canGoBack: boolean
    canGoForward: boolean
  }> {
    const state = this.getResolvedWindowState(target)
    if (!state || state.page.contents.isDestroyed()) {
      return {
        canGoBack: false,
        canGoForward: false
      }
    }

    return {
      canGoBack: state.page.contents.canGoBack(),
      canGoForward: state.page.contents.canGoForward()
    }
  }

  async getBrowserContext(): Promise<BrowserContextSnapshot> {
    return {
      activeWindowId: this.getResolvedWindowState()?.id ?? null,
      windows: await this.listWindows()
    }
  }

  async captureScreenshot(target: string | number, options?: ScreenshotOptions): Promise<string> {
    const state = this.getResolvedWindowState(target)
    if (!state) {
      throw new Error(`Browser target ${String(target)} not found`)
    }
    return await state.page.takeScreenshot(options)
  }

  async extractDom(target: string | number, selector?: string): Promise<string> {
    const state = this.getResolvedWindowState(target)
    if (!state) {
      throw new Error(`Browser target ${String(target)} not found`)
    }
    return await state.page.extractDOM(selector)
  }

  async evaluateScript(target: string | number, script: string): Promise<unknown> {
    const state = this.getResolvedWindowState(target)
    if (!state) {
      throw new Error(`Browser target ${String(target)} not found`)
    }
    return await state.page.evaluateScript(script)
  }

  async startDownload(url: string, savePath?: string): Promise<DownloadInfo> {
    const state = this.getResolvedWindowState()
    if (!state || state.page.contents.isDestroyed()) {
      throw new Error('No active browser window available')
    }
    return await this.downloadManager.downloadFile(url, savePath, state.page.contents)
  }

  async clearSandboxData(): Promise<void> {
    await clearYoBrowserSessionData()
    if (this.embeddedState && !this.embeddedState.page.contents.isDestroyed()) {
      this.embeddedState.page.contents.reloadIgnoringCache()
    }
    for (const state of this.browserWindows.values()) {
      if (!state.page.contents.isDestroyed()) {
        state.page.contents.reloadIgnoringCache()
      }
    }
  }

  async shutdown(): Promise<void> {
    await this.destroyEmbeddedState(false)
    const windowIds = Array.from(this.browserWindows.keys())
    for (const windowId of windowIds) {
      await this.windowPresenter.closeWindow(windowId, true)
    }
  }

  // Deprecated wrappers kept temporarily while callers migrate to window semantics.
  async listTabs(): Promise<BrowserTabInfo[]> {
    return (await this.listWindows()).map((browserWindow) => ({
      ...browserWindow.page,
      isActive: browserWindow.id === this.activeWindowId
    }))
  }

  async getActiveTab(): Promise<BrowserTabInfo | null> {
    const activeWindow = await this.getActiveWindow()
    if (!activeWindow) {
      return null
    }
    return {
      ...activeWindow.page,
      isActive: true
    }
  }

  async getTabById(pageId: string): Promise<BrowserTabInfo | null> {
    const state = this.getResolvedWindowState(pageId)
    if (!state) {
      return null
    }
    return {
      ...state.page.toPageInfo(),
      isActive: state.id === this.activeWindowId
    }
  }

  async createTab(url?: string): Promise<BrowserTabInfo | null> {
    const browserWindow = await this.openWindow(url ?? 'about:blank')
    if (!browserWindow) {
      return null
    }
    return {
      ...browserWindow.page,
      isActive: true
    }
  }

  async navigateTab(pageId: string, url: string, timeoutMs?: number): Promise<void> {
    const state = this.getResolvedWindowState(pageId)
    if (!state) {
      throw new Error(`Browser page ${pageId} not found`)
    }
    await this.navigateWindow(state.id, url, timeoutMs)
  }

  async activateTab(pageId: string): Promise<void> {
    const state = this.getResolvedWindowState(pageId)
    if (!state) return
    await this.focusWindow(state.id)
  }

  async closeTab(pageId: string): Promise<void> {
    const state = this.getResolvedWindowState(pageId)
    if (!state) return
    await this.closeWindow(state.id)
  }

  async reuseTab(url: string): Promise<BrowserTabInfo | null> {
    const existing = this.findReusableWindow(url)
    if (existing) {
      await this.navigateWindow(existing.id, url)
      await this.focusWindow(existing.id)
      return {
        ...existing.page.toPageInfo(),
        isActive: true
      }
    }
    return await this.createTab(url)
  }

  async getTabIdByViewId(viewId: number): Promise<string | null> {
    const windowId = this.viewIdToWindowId.get(viewId)
    if (windowId == null) {
      return null
    }
    const state = this.browserWindows.get(windowId)
    return state?.page.pageId ?? null
  }

  async getBrowserTab(target?: string | number): Promise<BrowserPage | null> {
    return this.getResolvedWindowState(target)?.page ?? null
  }

  private async ensureEmbeddedState(
    url?: string,
    preferredWindowId?: number
  ): Promise<BrowserWindowState | null> {
    const hostWindowId = this.resolveHostWindowId(preferredWindowId)
    if (hostWindowId == null) {
      return null
    }

    if (this.embeddedState) {
      if (url && url !== this.embeddedState.page.url) {
        await this.embeddedState.page.navigate(url)
      }
      if (this.embeddedState.id !== hostWindowId) {
        this.embeddedState.id = hostWindowId
        this.pageIdToWindowId.set(this.embeddedState.page.pageId, hostWindowId)
      }
      return this.embeddedState
    }

    const view = new WebContentsView({
      webPreferences: {
        sandbox: false,
        devTools: is.dev,
        session: getYoBrowserSession()
      }
    })

    view.setBorderRadius(0)
    view.setBackgroundColor('#00ffffff')

    const page = new BrowserPage(view.webContents, this.cdpManager, this.screenshotManager)
    const now = Date.now()
    const state: BrowserWindowState = {
      id: hostWindowId,
      viewId: view.webContents.id,
      page,
      createdAt: now,
      updatedAt: now,
      isEmbedded: true,
      view,
      visible: false,
      attachedWindowId: null
    }

    this.embeddedState = state
    this.viewIdToWindowId.set(state.viewId, hostWindowId)
    this.pageIdToWindowId.set(page.pageId, hostWindowId)
    this.setupPageListeners(hostWindowId, page, view.webContents, true)
    this.attachWindowListeners(hostWindowId)

    if (url && url !== 'about:blank') {
      await page.navigate(url)
      state.updatedAt = Date.now()
    }

    this.setActiveWindowId(hostWindowId)
    this.emitWindowCreated(state)
    this.emitWindowCount()
    return state
  }

  private attachWindowListeners(windowId: number): void {
    if (this.attachedWindowIds.has(windowId)) {
      return
    }

    const window = BrowserWindow.fromId(windowId)
    if (!window || window.isDestroyed()) {
      return
    }

    this.attachedWindowIds.add(windowId)

    window.on('focus', () => {
      this.setActiveWindowId(windowId)
      const state = this.browserWindows.get(windowId)
      if (state) {
        state.updatedAt = Date.now()
        this.emitWindowUpdated(state)
      }
    })

    window.on('show', () => {
      this.emitWindowVisibility(windowId, true)
    })

    window.on('hide', () => {
      this.emitWindowVisibility(windowId, false)
    })

    window.on('closed', () => {
      if (this.embeddedState?.id === windowId) {
        void this.destroyEmbeddedState(false)
      }
      this.cleanupWindow(windowId, true)
    })
  }

  private setupPageListeners(
    windowId: number,
    page: BrowserPage,
    contents: WebContents,
    isEmbedded: boolean = false
  ): void {
    contents.on('did-navigate', (_event, url) => {
      const state = isEmbedded ? this.embeddedState : this.browserWindows.get(windowId)
      if (!state) return
      page.url = url
      state.updatedAt = Date.now()
      this.emitWindowUpdated(state)
    })

    contents.on('page-title-updated', (_event, title) => {
      const state = isEmbedded ? this.embeddedState : this.browserWindows.get(windowId)
      if (!state) return
      page.title = title || page.url
      state.updatedAt = Date.now()
      this.emitWindowUpdated(state)
    })

    contents.on('page-favicon-updated', (_event, favicons) => {
      const state = isEmbedded ? this.embeddedState : this.browserWindows.get(windowId)
      if (!state || favicons.length === 0) return
      if (page.favicon !== favicons[0]) {
        page.favicon = favicons[0]
        state.updatedAt = Date.now()
        this.emitWindowUpdated(state)
      }
    })

    contents.on('destroyed', () => {
      if (isEmbedded) {
        void this.destroyEmbeddedState(false)
      } else {
        this.cleanupWindow(windowId, false)
      }
    })
  }

  private cleanupWindow(windowId: number, emitClosed: boolean): void {
    const state = this.browserWindows.get(windowId)
    if (!state) {
      return
    }

    state.page.destroy()
    this.browserWindows.delete(windowId)
    this.viewIdToWindowId.delete(state.viewId)
    this.pageIdToWindowId.delete(state.page.pageId)
    this.attachedWindowIds.delete(windowId)

    if (this.activeWindowId === windowId) {
      this.activeWindowId = this.getResolvedWindowState()?.id ?? null
      this.emitWindowFocused(this.activeWindowId)
    }

    if (emitClosed) {
      this.emitWindowClosed(windowId)
    }

    this.emitWindowCount()
  }

  private getResolvedWindowState(target?: number | string): BrowserWindowState | null {
    if (this.embeddedState) {
      if (typeof target === 'number' && target === this.embeddedState.id) {
        return this.embeddedState
      }

      if (
        typeof target === 'string' &&
        target.trim() &&
        target === this.embeddedState.page.pageId
      ) {
        return this.embeddedState
      }
    }

    if (typeof target === 'number') {
      return this.browserWindows.get(target) ?? null
    }

    if (typeof target === 'string' && target.trim()) {
      const windowId = this.pageIdToWindowId.get(target)
      return windowId != null ? (this.browserWindows.get(windowId) ?? null) : null
    }

    const activeFromFocused = this.findFocusedBrowserWindow()
    if (activeFromFocused) {
      this.activeWindowId = activeFromFocused.id
      return activeFromFocused
    }

    if (this.activeWindowId != null) {
      const activeState = this.browserWindows.get(this.activeWindowId)
      if (activeState) {
        return activeState
      }
    }

    const [latest] = [
      ...(this.embeddedState ? [this.embeddedState] : []),
      ...Array.from(this.browserWindows.values())
    ].sort((left, right) => right.updatedAt - left.updatedAt)
    return latest ?? null
  }

  private findFocusedBrowserWindow(): BrowserWindowState | null {
    const focusedWindow = this.windowPresenter.getFocusedWindow()
    if (!focusedWindow || focusedWindow.isDestroyed()) {
      return null
    }
    if (this.embeddedState?.id === focusedWindow.id) {
      return this.embeddedState
    }
    return this.browserWindows.get(focusedWindow.id) ?? null
  }

  private resolveHostWindowId(preferredWindowId?: number): number | null {
    if (preferredWindowId != null) {
      const preferredWindow = BrowserWindow.fromId(preferredWindowId)
      if (preferredWindow && !preferredWindow.isDestroyed()) {
        return preferredWindowId
      }
    }

    const focusedWindow = this.windowPresenter.getFocusedWindow()
    if (focusedWindow && !focusedWindow.isDestroyed()) {
      return focusedWindow.id
    }

    const [firstWindow] = this.windowPresenter.getAllWindows()
    return firstWindow && !firstWindow.isDestroyed() ? firstWindow.id : null
  }

  private findReusableWindow(url: string): BrowserWindowState | null {
    if (!url) {
      return this.getResolvedWindowState()
    }

    try {
      const targetHost = new URL(url).hostname
      for (const state of this.browserWindows.values()) {
        try {
          if (new URL(state.page.url).hostname === targetHost) {
            return state
          }
        } catch {
          // Ignore invalid URL parsing for existing pages.
        }
      }
    } catch {
      // Ignore invalid URL parsing for requested URL.
    }

    return this.getResolvedWindowState()
  }

  private toWindowInfo(state: BrowserWindowState): BrowserWindowInfo {
    const window = BrowserWindow.fromId(state.id)
    return {
      id: state.id,
      page: state.page.toPageInfo(),
      isFocused: Boolean(window && !window.isDestroyed() && window.isFocused()),
      isVisible: state.isEmbedded
        ? Boolean(state.visible)
        : Boolean(window && !window.isDestroyed() && window.isVisible()),
      createdAt: state.createdAt,
      updatedAt: state.updatedAt
    }
  }

  private setWindowVisibility(state: BrowserWindowState, visible: boolean): void {
    state.visible = visible
    this.emitWindowVisibility(state.id, visible)
  }

  private setActiveWindowId(windowId: number | null): void {
    this.activeWindowId = windowId
    this.emitWindowFocused(windowId)
  }

  private emitWindowCreated(state: BrowserWindowState): void {
    eventBus.sendToRenderer(YO_BROWSER_EVENTS.WINDOW_CREATED, SendTarget.ALL_WINDOWS, {
      window: this.toWindowInfo(state)
    })
  }

  private emitWindowUpdated(state: BrowserWindowState): void {
    eventBus.sendToRenderer(YO_BROWSER_EVENTS.WINDOW_UPDATED, SendTarget.ALL_WINDOWS, {
      window: this.toWindowInfo(state)
    })
  }

  private emitWindowClosed(windowId: number): void {
    eventBus.sendToRenderer(YO_BROWSER_EVENTS.WINDOW_CLOSED, SendTarget.ALL_WINDOWS, { windowId })
  }

  private emitWindowFocused(windowId: number | null): void {
    eventBus.sendToRenderer(YO_BROWSER_EVENTS.WINDOW_FOCUSED, SendTarget.ALL_WINDOWS, {
      windowId
    })
  }

  private emitWindowCount(): void {
    eventBus.sendToRenderer(
      YO_BROWSER_EVENTS.WINDOW_COUNT_CHANGED,
      SendTarget.ALL_WINDOWS,
      this.browserWindows.size + (this.embeddedState ? 1 : 0)
    )
  }

  private emitWindowVisibility(windowId: number, visible: boolean): void {
    eventBus.sendToRenderer(YO_BROWSER_EVENTS.WINDOW_VISIBILITY_CHANGED, SendTarget.ALL_WINDOWS, {
      windowId,
      visible
    })
  }

  private async destroyEmbeddedState(emitClosed: boolean): Promise<void> {
    const state = this.embeddedState
    if (!state) {
      return
    }

    await this.detachEmbedded()
    state.page.destroy()
    this.viewIdToWindowId.delete(state.viewId)
    this.pageIdToWindowId.delete(state.page.pageId)

    if (state.view && !state.view.webContents.isDestroyed()) {
      try {
        state.view.webContents.close()
      } catch {
        // Ignore view shutdown failures.
      }
    }

    const closedWindowId = state.id
    this.embeddedState = null

    if (this.activeWindowId === closedWindowId) {
      this.activeWindowId = this.getResolvedWindowState()?.id ?? null
      this.emitWindowFocused(this.activeWindowId)
    }

    if (emitClosed) {
      this.emitWindowClosed(closedWindowId)
    }

    this.emitWindowCount()
  }
}
