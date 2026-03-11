import { BrowserWindow, WebContents, WebContentsView } from 'electron'
import type { Rectangle } from 'electron'
import { is } from '@electron-toolkit/utils'
import { eventBus, SendTarget } from '@/eventbus'
import { YO_BROWSER_EVENTS } from '@/events'
import logger from '@shared/logger'
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
  lastBounds?: Rectangle | null
  lastVisible?: boolean
  hostReady?: boolean
}

type BrowserWindowListeners = {
  focus: () => void
  show: () => void
  hide: () => void
  closed: () => void
}

type HostReadyWaiter = {
  hostWindowId: number
  timeoutId: NodeJS.Timeout
  stableTimerId: NodeJS.Timeout | null
  resolve: () => void
  reject: (error: Error) => void
}

export class YoBrowserPresenter implements IYoBrowserPresenter {
  private readonly browserWindows = new Map<number, BrowserWindowState>()
  private readonly viewIdToWindowId = new Map<number, number>()
  private readonly pageIdToWindowId = new Map<string, number>()
  private readonly attachedWindowIds = new Set<number>()
  private readonly windowListeners = new Map<number, BrowserWindowListeners>()
  private embeddedState: BrowserWindowState | null = null
  private activeWindowId: number | null = null
  private readonly cdpManager = new CDPManager()
  private readonly screenshotManager = new ScreenshotManager(this.cdpManager)
  private readonly downloadManager = new DownloadManager()
  private readonly windowPresenter: IWindowPresenter
  private readonly embeddedHostReadyTimeoutMs = 2000
  private readonly embeddedHostReadyStableMs = 120
  private hostReadyWaiter: HostReadyWaiter | null = null
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

    const created = await this.ensureEmbeddedState()
    return created?.id ?? null
  }

  async openWindow(url?: string): Promise<BrowserWindowInfo | null> {
    const hostWindowId = this.resolveHostWindowId()
    if (hostWindowId == null) {
      return null
    }

    this.logLifecycle('open requested', {
      windowId: hostWindowId,
      url: url ?? 'about:blank'
    })

    const state = await this.ensureEmbeddedState(undefined, hostWindowId)
    if (!state) {
      return null
    }

    this.markEmbeddedHostNotReady(state)
    this.logLifecycle('embedded state ready', {
      windowId: state.id,
      pageId: state.page.pageId,
      url: state.page.url
    })

    this.emitOpenRequested(hostWindowId, state.page.pageId, url ?? state.page.url)
    this.logLifecycle('panel open requested', {
      windowId: hostWindowId,
      pageId: state.page.pageId,
      url: url ?? state.page.url
    })

    this.windowPresenter.show(hostWindowId, true)
    this.setActiveWindowId(hostWindowId)

    this.logLifecycle('host ready waiting', {
      windowId: hostWindowId,
      pageId: state.page.pageId,
      url: url ?? state.page.url
    })
    await this.waitForEmbeddedHostReady(hostWindowId, state)

    if (url && url !== 'about:blank') {
      this.logLifecycle('navigation started', {
        windowId: state.id,
        pageId: state.page.pageId,
        url
      })

      try {
        await state.page.navigateUntilDomReady(url)
      } catch (error) {
        state.updatedAt = Date.now()
        this.emitWindowUpdated(state)
        throw error
      }
    }

    state.updatedAt = Date.now()
    this.emitWindowUpdated(state)
    return this.toWindowInfo(state)
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
      const previousWindowId = state.attachedWindowId
      const previousWindow = BrowserWindow.fromId(previousWindowId)
      this.detachWindowListeners(previousWindowId)
      if (previousWindow && !previousWindow.isDestroyed()) {
        try {
          previousWindow.contentView.removeChildView(state.view)
        } catch {
          // Ignore already detached view.
        }
      }
    }

    if (state.attachedWindowId !== windowId) {
      this.markEmbeddedHostNotReady(state)
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
      this.viewIdToWindowId.set(state.viewId, windowId)
      this.pageIdToWindowId.set(state.page.pageId, windowId)
    }

    this.attachWindowListeners(windowId)
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

    const normalizedBounds = this.normalizeBounds(bounds)
    state.lastBounds = normalizedBounds
    state.lastVisible = visible
    state.updatedAt = Date.now()

    if (!visible || normalizedBounds.width <= 0 || normalizedBounds.height <= 0) {
      this.markEmbeddedHostNotReady(state)
      this.setWindowVisibility(state, false)
      return
    }

    if (state.attachedWindowId !== windowId) {
      const attachedWindowId = await this.attachEmbeddedToWindow(windowId)
      if (attachedWindowId == null) {
        return
      }
    }

    state.view.setBounds(normalizedBounds)
    this.setWindowVisibility(state, true)
    this.scheduleEmbeddedHostReady(windowId, normalizedBounds)
  }

  async detachEmbedded(): Promise<void> {
    const state = this.embeddedState
    if (!state?.view) {
      return
    }

    const attachedWindowId = state.attachedWindowId
    if (attachedWindowId != null) {
      const window = BrowserWindow.fromId(attachedWindowId)
      this.detachWindowListeners(attachedWindowId)
      if (window && !window.isDestroyed()) {
        try {
          window.contentView.removeChildView(state.view)
        } catch {
          // Ignore already detached view.
        }
      }
    }

    state.attachedWindowId = null
    this.markEmbeddedHostNotReady(state)
    state.updatedAt = Date.now()
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
    const state = this.getWindowStateById(windowId)
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

        const canShowEmbedded =
          existing.attachedWindowId != null &&
          Boolean(existing.view && !existing.view.webContents.isDestroyed())
        this.setWindowVisibility(existing, canShowEmbedded)
      } else {
        this.windowPresenter.show(existing.id, shouldFocus)
        if (shouldFocus) {
          this.setActiveWindowId(existing.id)
        }
        this.setWindowVisibility(existing, true)
      }
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
      const canShowEmbedded =
        state.attachedWindowId != null &&
        Boolean(state.view && !state.view.webContents.isDestroyed())
      if (!canShowEmbedded) {
        this.setWindowVisibility(state, false)
        return false
      }

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
    if (state.isEmbedded) {
      return Boolean(
        state.visible &&
        state.attachedWindowId != null &&
        state.view &&
        !state.view.webContents.isDestroyed()
      )
    }
    const window = BrowserWindow.fromId(state.id)
    return Boolean(window && !window.isDestroyed() && window.isVisible())
  }

  async navigateWindow(windowId: number, url: string, timeoutMs?: number): Promise<void> {
    const state = this.getResolvedWindowState(windowId)
    if (!state) {
      throw new Error(`Browser window ${windowId} not found`)
    }

    this.logLifecycle('navigation started', {
      windowId: state.id,
      pageId: state.page.pageId,
      url
    })
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
      canGoBack: state.page.contents.navigationHistory.canGoBack(),
      canGoForward: state.page.contents.navigationHistory.canGoForward()
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
    return await this.runPageAction(state, 'capture screenshot', () =>
      state.page.takeScreenshot(options)
    )
  }

  async extractDom(target: string | number, selector?: string): Promise<string> {
    const state = this.getResolvedWindowState(target)
    if (!state) {
      throw new Error(`Browser target ${String(target)} not found`)
    }
    return await this.runPageAction(state, 'extract DOM', () => state.page.extractDOM(selector))
  }

  async evaluateScript(target: string | number, script: string): Promise<unknown> {
    const state = this.getResolvedWindowState(target)
    if (!state) {
      throw new Error(`Browser target ${String(target)} not found`)
    }
    return await this.runPageAction(state, 'evaluate script', () =>
      state.page.evaluateScript(script)
    )
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
    const state = this.getResolvedWindowState(windowId)
    return state?.page.pageId ?? null
  }

  async getBrowserTab(target?: string | number): Promise<BrowserPage | null> {
    return this.getResolvedWindowState(target)?.page ?? null
  }

  private async ensureEmbeddedState(
    _url?: string,
    preferredWindowId?: number
  ): Promise<BrowserWindowState | null> {
    const hostWindowId = this.resolveHostWindowId(preferredWindowId)
    if (hostWindowId == null) {
      return null
    }

    if (this.embeddedState) {
      if (this.embeddedState.id !== hostWindowId) {
        this.embeddedState.id = hostWindowId
        this.viewIdToWindowId.set(this.embeddedState.viewId, hostWindowId)
        this.pageIdToWindowId.set(this.embeddedState.page.pageId, hostWindowId)
      }
      return this.embeddedState
    }

    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
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
      attachedWindowId: null,
      lastBounds: null,
      lastVisible: false,
      hostReady: false
    }

    this.embeddedState = state
    this.viewIdToWindowId.set(state.viewId, hostWindowId)
    this.pageIdToWindowId.set(page.pageId, hostWindowId)
    this.setupPageListeners(hostWindowId, page, view.webContents, true)

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

    const focus = () => {
      this.setActiveWindowId(windowId)
      const state = this.getAttachedWindowState(windowId)
      if (state) {
        state.updatedAt = Date.now()
        this.emitWindowUpdated(state)
      }
    }

    const show = () => {
      const state = this.getAttachedWindowState(windowId)
      if (state?.isEmbedded) {
        this.setWindowVisibility(state, true)
        return
      }
      this.emitWindowVisibility(windowId, true)
    }

    const hide = () => {
      const state = this.getAttachedWindowState(windowId)
      if (state?.isEmbedded) {
        this.setWindowVisibility(state, false)
        return
      }
      this.emitWindowVisibility(windowId, false)
    }

    const closed = () => {
      this.detachWindowListeners(windowId)
      if (this.embeddedState?.attachedWindowId === windowId) {
        void this.destroyEmbeddedState(false)
      }
      this.cleanupWindow(windowId, true)
    }

    this.windowListeners.set(windowId, { focus, show, hide, closed })

    window.on('focus', focus)
    window.on('show', show)
    window.on('hide', hide)
    window.on('closed', closed)
  }

  private detachWindowListeners(windowId: number): void {
    const listeners = this.windowListeners.get(windowId)
    if (!listeners) {
      this.attachedWindowIds.delete(windowId)
      return
    }

    const window = BrowserWindow.fromId(windowId)
    if (window && !window.isDestroyed()) {
      window.removeListener('focus', listeners.focus)
      window.removeListener('show', listeners.show)
      window.removeListener('hide', listeners.hide)
      window.removeListener('closed', listeners.closed)
    }

    this.windowListeners.delete(windowId)
    this.attachedWindowIds.delete(windowId)
  }

  private getAttachedWindowState(windowId: number): BrowserWindowState | null {
    if (this.embeddedState?.attachedWindowId === windowId) {
      return this.embeddedState
    }
    return this.browserWindows.get(windowId) ?? null
  }

  private getWindowStateById(windowId: number): BrowserWindowState | null {
    if (this.embeddedState?.id === windowId) {
      return this.embeddedState
    }

    return this.browserWindows.get(windowId) ?? null
  }

  private setupPageListeners(
    windowId: number,
    page: BrowserPage,
    contents: WebContents,
    isEmbedded: boolean = false
  ): void {
    const getState = () => (isEmbedded ? this.embeddedState : this.browserWindows.get(windowId))

    contents.on('did-navigate', (_event, url) => {
      const state = getState()
      if (!state) return
      page.url = url
      state.updatedAt = Date.now()
      this.emitWindowUpdated(state)
    })

    contents.on('page-title-updated', (_event, title) => {
      const state = getState()
      if (!state) return
      page.title = title || page.url
      state.updatedAt = Date.now()
      this.emitWindowUpdated(state)
    })

    contents.on('page-favicon-updated', (_event, favicons) => {
      const state = getState()
      if (!state || favicons.length === 0) return
      if (page.favicon !== favicons[0]) {
        page.favicon = favicons[0]
        state.updatedAt = Date.now()
        this.emitWindowUpdated(state)
      }
    })

    contents.on('did-start-loading', () => {
      const state = getState()
      if (!state) return
      state.updatedAt = Date.now()
      this.emitWindowUpdated(state)
    })

    contents.on('dom-ready', () => {
      const state = getState()
      if (!state) return
      state.updatedAt = Date.now()
      this.emitWindowUpdated(state)
    })

    contents.on('did-finish-load', () => {
      const state = getState()
      if (!state) return
      state.updatedAt = Date.now()
      this.emitWindowUpdated(state)
    })

    contents.on(
      'did-fail-load',
      (
        _event,
        errorCode: number,
        _errorDescription: string,
        _validatedURL: string,
        isMainFrame
      ) => {
        if (!isMainFrame || errorCode === -3) {
          return
        }

        const state = getState()
        if (!state) return
        state.updatedAt = Date.now()
        this.emitWindowUpdated(state)
      }
    )

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
      this.detachWindowListeners(windowId)
      return
    }

    state.page.destroy()
    this.browserWindows.delete(windowId)
    this.viewIdToWindowId.delete(state.viewId)
    this.pageIdToWindowId.delete(state.page.pageId)
    this.detachWindowListeners(windowId)

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
      return this.getWindowStateById(target)
    }

    if (typeof target === 'string' && target.trim()) {
      const windowId = this.pageIdToWindowId.get(target)
      return windowId != null ? this.getWindowStateById(windowId) : null
    }

    const activeFromFocused = this.findFocusedBrowserWindow()
    if (activeFromFocused) {
      this.activeWindowId = activeFromFocused.id
      return activeFromFocused
    }

    if (this.activeWindowId != null) {
      const activeState = this.getWindowStateById(this.activeWindowId)
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

  private async waitForEmbeddedHostReady(
    hostWindowId: number,
    state: BrowserWindowState
  ): Promise<void> {
    if (
      state.hostReady &&
      state.attachedWindowId === hostWindowId &&
      state.visible &&
      state.lastBounds &&
      state.lastBounds.width > 0 &&
      state.lastBounds.height > 0
    ) {
      return
    }

    this.resolveOrRejectHostReadyWait(
      null,
      new Error(
        `Embedded browser host wait was interrupted before host ${hostWindowId} became ready`
      )
    )

    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const error = new Error(
          `Embedded browser host ${hostWindowId} did not become ready within ${this.embeddedHostReadyTimeoutMs}ms`
        )
        this.resolveOrRejectHostReadyWait(null, error)
      }, this.embeddedHostReadyTimeoutMs)

      this.hostReadyWaiter = {
        hostWindowId,
        timeoutId,
        stableTimerId: null,
        resolve,
        reject
      }
    })
  }

  private scheduleEmbeddedHostReady(windowId: number, bounds: Rectangle): void {
    const state = this.embeddedState
    const waiter = this.hostReadyWaiter
    if (!state || !waiter || waiter.hostWindowId !== windowId) {
      return
    }

    if (waiter.stableTimerId) {
      clearTimeout(waiter.stableTimerId)
      waiter.stableTimerId = null
    }

    const expectedBoundsKey = this.boundsKey(bounds)
    waiter.stableTimerId = setTimeout(() => {
      const currentState = this.embeddedState
      const currentWaiter = this.hostReadyWaiter
      if (
        !currentState ||
        !currentWaiter ||
        currentWaiter !== waiter ||
        currentWaiter.hostWindowId !== windowId ||
        currentState.attachedWindowId !== windowId ||
        !currentState.visible ||
        this.boundsKey(currentState.lastBounds) !== expectedBoundsKey
      ) {
        return
      }

      currentState.hostReady = true
      this.logLifecycle('host ready', {
        windowId,
        pageId: currentState.page.pageId,
        url: currentState.page.url
      })
      this.resolveOrRejectHostReadyWait(currentWaiter)
    }, this.embeddedHostReadyStableMs)
  }

  private markEmbeddedHostNotReady(state: BrowserWindowState): void {
    state.hostReady = false
    const waiter = this.hostReadyWaiter
    if (waiter?.stableTimerId) {
      clearTimeout(waiter.stableTimerId)
      waiter.stableTimerId = null
    }
  }

  private resolveOrRejectHostReadyWait(waiter: HostReadyWaiter | null, error?: Error): void {
    const targetWaiter = waiter ?? this.hostReadyWaiter
    if (!targetWaiter) {
      return
    }

    if (targetWaiter.timeoutId) {
      clearTimeout(targetWaiter.timeoutId)
    }
    if (targetWaiter.stableTimerId) {
      clearTimeout(targetWaiter.stableTimerId)
    }

    if (this.hostReadyWaiter === targetWaiter) {
      this.hostReadyWaiter = null
    }

    if (error) {
      targetWaiter.reject(error)
      return
    }

    targetWaiter.resolve()
  }

  private normalizeBounds(bounds: Rectangle): Rectangle {
    return {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height))
    }
  }

  private boundsKey(bounds?: Rectangle | null): string {
    if (!bounds) {
      return 'null'
    }
    return `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`
  }

  private async runPageAction<T>(
    state: BrowserWindowState,
    action: string,
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof Error && error.name === 'YoBrowserNotReadyError') {
        this.logLifecycle('tool blocked:not-ready', {
          windowId: state.id,
          pageId: state.page.pageId,
          url: state.page.url,
          status: state.page.status,
          action
        })
      }
      throw error
    }
  }

  private logLifecycle(message: string, context: Record<string, unknown>): void {
    logger.info(`[YoBrowser] ${message}`, context)
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
    if (state.visible === visible) {
      return
    }
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

  private emitOpenRequested(windowId: number, pageId: string, url: string): void {
    eventBus.sendToRenderer(YO_BROWSER_EVENTS.OPEN_REQUESTED, SendTarget.ALL_WINDOWS, {
      windowId,
      pageId,
      url
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

    this.resolveOrRejectHostReadyWait(
      null,
      new Error(`Embedded browser window ${state.id} was destroyed before it became ready`)
    )

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
