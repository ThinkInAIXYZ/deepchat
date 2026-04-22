import { BrowserWindow, WebContents, WebContentsView } from 'electron'
import type { Rectangle } from 'electron'
import { is } from '@electron-toolkit/utils'
import { eventBus, SendTarget } from '@/eventbus'
import { YO_BROWSER_EVENTS } from '@/events'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import logger from '@shared/logger'
import {
  BrowserPageStatus,
  type BrowserPageInfo,
  type ScreenshotOptions,
  type YoBrowserStatus
} from '@shared/types/browser'
import type { DownloadInfo, IWindowPresenter, IYoBrowserPresenter } from '@shared/presenter'
import { BrowserTab as BrowserPage } from './BrowserTab'
import { CDPManager } from './CDPManager'
import { DownloadManager } from './DownloadManager'
import { ScreenshotManager } from './ScreenshotManager'
import { clearYoBrowserSessionData, getYoBrowserSession } from './yoBrowserSession'
import { YoBrowserToolHandler } from './YoBrowserToolHandler'

type SessionBrowserState = {
  sessionId: string
  view: WebContentsView
  page: BrowserPage
  createdAt: number
  updatedAt: number
  visible: boolean
  attachedWindowId: number | null
  lastBounds: Rectangle | null
}

type HostWindowListeners = {
  focus: () => void
  show: () => void
  hide: () => void
  closed: () => void
}

export class YoBrowserPresenter implements IYoBrowserPresenter {
  private readonly sessionBrowsers = new Map<string, SessionBrowserState>()
  private readonly hostWindowListeners = new Map<number, HostWindowListeners>()
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

  async getBrowserStatus(sessionId: string): Promise<YoBrowserStatus> {
    return this.toStatus(this.sessionBrowsers.get(sessionId) ?? null)
  }

  async loadUrl(
    sessionId: string,
    url: string,
    timeoutMs?: number,
    hostWindowId?: number
  ): Promise<YoBrowserStatus> {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) {
      throw new Error('sessionId is required')
    }
    if (!url.trim()) {
      throw new Error('url is required')
    }

    const resolvedHostWindowId = hostWindowId ?? this.resolveHostWindowId()
    if (resolvedHostWindowId == null) {
      throw new Error('No host window available for YoBrowser')
    }

    const state = this.ensureSessionBrowserState(normalizedSessionId)
    this.logLifecycle('open requested', {
      sessionId: normalizedSessionId,
      windowId: resolvedHostWindowId,
      url
    })

    this.emitOpenRequested(normalizedSessionId, resolvedHostWindowId, url)
    await state.page.navigateUntilDomReady(url, timeoutMs ?? 30000)
    state.updatedAt = Date.now()
    this.emitWindowUpdated(normalizedSessionId)
    return this.toStatus(state)
  }

  async attachSessionBrowser(sessionId: string, hostWindowId: number): Promise<boolean> {
    const state = this.sessionBrowsers.get(sessionId)
    if (!state) {
      return false
    }

    const hostWindow = BrowserWindow.fromId(hostWindowId)
    if (!hostWindow || hostWindow.isDestroyed()) {
      return false
    }

    this.detachOtherSessionBrowsers(hostWindowId, sessionId)

    if (state.attachedWindowId != null && state.attachedWindowId !== hostWindowId) {
      this.detachFromWindow(state, state.attachedWindowId)
    }

    if (state.attachedWindowId !== hostWindowId) {
      try {
        hostWindow.contentView.addChildView(state.view)
      } catch {
        try {
          hostWindow.contentView.removeChildView(state.view)
        } catch {
          // Ignore already detached view.
        }
        hostWindow.contentView.addChildView(state.view)
      }
    }

    this.attachHostWindowListeners(hostWindowId)
    state.attachedWindowId = hostWindowId
    state.updatedAt = Date.now()
    this.emitWindowUpdated(sessionId)
    return true
  }

  async updateSessionBrowserBounds(
    sessionId: string,
    hostWindowId: number,
    bounds: Rectangle,
    visible: boolean
  ): Promise<void> {
    const state = this.sessionBrowsers.get(sessionId)
    if (!state) {
      return
    }

    const normalizedBounds = this.normalizeBounds(bounds)
    state.lastBounds = normalizedBounds
    state.updatedAt = Date.now()

    if (!visible || normalizedBounds.width <= 0 || normalizedBounds.height <= 0) {
      this.setSessionVisibility(state, false)
      return
    }

    if (state.attachedWindowId !== hostWindowId) {
      const attached = await this.attachSessionBrowser(sessionId, hostWindowId)
      if (!attached) {
        return
      }
    }

    state.view.setBounds(normalizedBounds)
    this.setSessionVisibility(state, true)
  }

  async detachSessionBrowser(sessionId: string): Promise<void> {
    const state = this.sessionBrowsers.get(sessionId)
    if (!state || state.attachedWindowId == null) {
      return
    }

    this.detachFromWindow(state, state.attachedWindowId)
    state.updatedAt = Date.now()
    this.setSessionVisibility(state, false)
  }

  async destroySessionBrowser(sessionId: string): Promise<void> {
    const state = this.sessionBrowsers.get(sessionId)
    if (!state) {
      return
    }

    await this.detachSessionBrowser(sessionId)
    state.page.destroy()
    this.sessionBrowsers.delete(sessionId)

    if (!state.view.webContents.isDestroyed()) {
      try {
        state.view.webContents.close()
      } catch {
        // Ignore view shutdown failures.
      }
    }

    this.emitWindowClosed(sessionId)
    this.emitWindowCount()
  }

  async goBack(sessionId: string): Promise<void> {
    const state = this.sessionBrowsers.get(sessionId)
    if (!state) {
      return
    }
    await state.page.goBack()
    state.updatedAt = Date.now()
    this.emitWindowUpdated(sessionId)
  }

  async goForward(sessionId: string): Promise<void> {
    const state = this.sessionBrowsers.get(sessionId)
    if (!state) {
      return
    }
    await state.page.goForward()
    state.updatedAt = Date.now()
    this.emitWindowUpdated(sessionId)
  }

  async reload(sessionId: string): Promise<void> {
    const state = this.sessionBrowsers.get(sessionId)
    if (!state) {
      return
    }
    await state.page.reload()
    state.updatedAt = Date.now()
    this.emitWindowUpdated(sessionId)
  }

  async getNavigationState(sessionId: string): Promise<{
    canGoBack: boolean
    canGoForward: boolean
  }> {
    const state = this.sessionBrowsers.get(sessionId)
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

  async captureScreenshot(sessionId: string, options?: ScreenshotOptions): Promise<string> {
    const state = this.sessionBrowsers.get(sessionId)
    if (!state) {
      throw new Error(`Session browser ${sessionId} not found`)
    }

    try {
      return await state.page.takeScreenshot(options)
    } catch (error) {
      if (error instanceof Error && error.name === 'YoBrowserNotReadyError') {
        this.logLifecycle('tool blocked:not-ready', {
          sessionId,
          url: state.page.url,
          status: state.page.status,
          action: 'capture screenshot'
        })
      }
      throw error
    }
  }

  async getBrowserPage(sessionId: string): Promise<BrowserPageInfo | null> {
    return this.sessionBrowsers.get(sessionId)?.page.toPageInfo() ?? null
  }

  async sendCdpCommand(
    sessionId: string,
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    const state = this.sessionBrowsers.get(sessionId)
    if (!state) {
      throw new Error(`Session browser ${sessionId} is not initialized`)
    }
    return await state.page.sendCdpCommand(method, params)
  }

  async startDownload(url: string, savePath?: string): Promise<DownloadInfo> {
    const state = this.findPreferredSessionState()
    if (!state || state.page.contents.isDestroyed()) {
      throw new Error('No active session browser available')
    }
    return await this.downloadManager.downloadFile(url, savePath, state.page.contents)
  }

  async clearSandboxData(): Promise<void> {
    await clearYoBrowserSessionData()
    for (const state of this.sessionBrowsers.values()) {
      if (!state.page.contents.isDestroyed()) {
        state.page.contents.reloadIgnoringCache()
      }
    }
  }

  async shutdown(): Promise<void> {
    for (const sessionId of Array.from(this.sessionBrowsers.keys())) {
      await this.destroySessionBrowser(sessionId)
    }
  }

  private ensureSessionBrowserState(sessionId: string): SessionBrowserState {
    const existing = this.sessionBrowsers.get(sessionId)
    if (existing) {
      return existing
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
    const state: SessionBrowserState = {
      sessionId,
      view,
      page,
      createdAt: now,
      updatedAt: now,
      visible: false,
      attachedWindowId: null,
      lastBounds: null
    }

    this.sessionBrowsers.set(sessionId, state)
    this.setupPageListeners(state, view.webContents)
    this.emitWindowCreated(sessionId)
    this.emitWindowCount()
    return state
  }

  private setupPageListeners(state: SessionBrowserState, contents: WebContents): void {
    const sessionId = state.sessionId
    const getState = () => this.sessionBrowsers.get(sessionId)

    contents.on('did-navigate', (_event, url) => {
      const current = getState()
      if (!current) {
        return
      }
      current.page.url = url
      current.updatedAt = Date.now()
      this.emitWindowUpdated(sessionId)
    })

    contents.on('page-title-updated', (_event, title) => {
      const current = getState()
      if (!current) {
        return
      }
      current.page.title = title || current.page.url
      current.updatedAt = Date.now()
      this.emitWindowUpdated(sessionId)
    })

    contents.on('page-favicon-updated', (_event, favicons) => {
      const current = getState()
      if (!current || favicons.length === 0) {
        return
      }
      if (current.page.favicon !== favicons[0]) {
        current.page.favicon = favicons[0]
        current.updatedAt = Date.now()
        this.emitWindowUpdated(sessionId)
      }
    })

    contents.on('did-start-loading', () => {
      const current = getState()
      if (!current) {
        return
      }
      current.updatedAt = Date.now()
      this.emitWindowUpdated(sessionId)
    })

    contents.on('dom-ready', () => {
      const current = getState()
      if (!current) {
        return
      }
      current.updatedAt = Date.now()
      this.emitWindowUpdated(sessionId)
    })

    contents.on('did-finish-load', () => {
      const current = getState()
      if (!current) {
        return
      }
      current.updatedAt = Date.now()
      this.emitWindowUpdated(sessionId)
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

        const current = getState()
        if (!current) {
          return
        }
        current.updatedAt = Date.now()
        this.emitWindowUpdated(sessionId)
      }
    )

    contents.on('destroyed', () => {
      this.handleDestroyedContents(sessionId)
    })
  }

  private handleDestroyedContents(sessionId: string): void {
    const state = this.sessionBrowsers.get(sessionId)
    if (!state) {
      return
    }

    state.page.destroy()
    state.attachedWindowId = null
    state.visible = false
    this.sessionBrowsers.delete(sessionId)
    this.emitWindowClosed(sessionId)
    this.emitWindowCount()
  }

  private attachHostWindowListeners(windowId: number): void {
    if (this.hostWindowListeners.has(windowId)) {
      return
    }

    const window = BrowserWindow.fromId(windowId)
    if (!window || window.isDestroyed()) {
      return
    }

    const focus = () => {
      const state = this.findAttachedStateByWindowId(windowId)
      if (!state) {
        return
      }
      state.updatedAt = Date.now()
      this.emitWindowFocused(state.sessionId, windowId)
      this.emitWindowUpdated(state.sessionId)
    }

    const show = () => {
      const state = this.findAttachedStateByWindowId(windowId)
      if (!state) {
        return
      }
      this.setSessionVisibility(state, true)
    }

    const hide = () => {
      const state = this.findAttachedStateByWindowId(windowId)
      if (!state) {
        return
      }
      this.setSessionVisibility(state, false)
    }

    const closed = () => {
      const state = this.findAttachedStateByWindowId(windowId)
      if (state) {
        state.attachedWindowId = null
        this.setSessionVisibility(state, false)
      }
      this.detachHostWindowListeners(windowId)
    }

    this.hostWindowListeners.set(windowId, { focus, show, hide, closed })
    window.on('focus', focus)
    window.on('show', show)
    window.on('hide', hide)
    window.on('closed', closed)
  }

  private detachHostWindowListeners(windowId: number): void {
    const listeners = this.hostWindowListeners.get(windowId)
    if (!listeners) {
      return
    }

    const window = BrowserWindow.fromId(windowId)
    if (window && !window.isDestroyed()) {
      window.removeListener('focus', listeners.focus)
      window.removeListener('show', listeners.show)
      window.removeListener('hide', listeners.hide)
      window.removeListener('closed', listeners.closed)
    }

    this.hostWindowListeners.delete(windowId)
  }

  private detachOtherSessionBrowsers(hostWindowId: number, exceptSessionId: string): void {
    for (const state of this.sessionBrowsers.values()) {
      if (state.sessionId === exceptSessionId || state.attachedWindowId !== hostWindowId) {
        continue
      }

      this.detachFromWindow(state, hostWindowId)
      this.setSessionVisibility(state, false)
      state.updatedAt = Date.now()
      this.emitWindowUpdated(state.sessionId)
    }
  }

  private detachFromWindow(state: SessionBrowserState, hostWindowId: number): void {
    const window = BrowserWindow.fromId(hostWindowId)
    if (window && !window.isDestroyed()) {
      try {
        window.contentView.removeChildView(state.view)
      } catch {
        // Ignore already detached view.
      }
    }
    state.attachedWindowId = null
  }

  private findAttachedStateByWindowId(windowId: number): SessionBrowserState | null {
    for (const state of this.sessionBrowsers.values()) {
      if (state.attachedWindowId === windowId) {
        return state
      }
    }
    return null
  }

  private findPreferredSessionState(): SessionBrowserState | null {
    const states = [...this.sessionBrowsers.values()]
    if (states.length === 0) {
      return null
    }

    const visibleState = states.find((state) => state.visible)
    if (visibleState) {
      return visibleState
    }

    return states.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
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

  private toStatus(state: SessionBrowserState | null): YoBrowserStatus {
    if (!state || state.page.contents.isDestroyed()) {
      return {
        initialized: false,
        page: null,
        canGoBack: false,
        canGoForward: false,
        visible: false,
        loading: false
      }
    }

    return {
      initialized: true,
      page: state.page.toPageInfo(),
      canGoBack: state.page.contents.navigationHistory.canGoBack(),
      canGoForward: state.page.contents.navigationHistory.canGoForward(),
      visible: state.visible,
      loading: state.page.contents.isLoading() || state.page.status === BrowserPageStatus.Loading
    }
  }

  private setSessionVisibility(state: SessionBrowserState, visible: boolean): void {
    if (state.visible === visible) {
      return
    }
    state.visible = visible
    this.emitWindowVisibility(state.sessionId, visible)
  }

  private normalizeBounds(bounds: Rectangle): Rectangle {
    return {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height))
    }
  }

  private logLifecycle(message: string, context: Record<string, unknown>): void {
    logger.info(`[YoBrowser] ${message}`, context)
  }

  private emitWindowCreated(sessionId: string): void {
    const payload = {
      sessionId,
      status: this.toStatus(this.sessionBrowsers.get(sessionId) ?? null)
    }

    eventBus.sendToRenderer(YO_BROWSER_EVENTS.WINDOW_CREATED, SendTarget.ALL_WINDOWS, payload)
    publishDeepchatEvent('browser.status.changed', {
      sessionId,
      reason: 'created',
      windowId: payload.status.page
        ? (this.sessionBrowsers.get(sessionId)?.attachedWindowId ?? null)
        : null,
      status: payload.status,
      version: Date.now()
    })
  }

  private emitOpenRequested(sessionId: string, windowId: number, url: string): void {
    const payload = {
      sessionId,
      windowId,
      url
    }

    eventBus.sendToRenderer(YO_BROWSER_EVENTS.OPEN_REQUESTED, SendTarget.ALL_WINDOWS, payload)
    publishDeepchatEvent('browser.open.requested', {
      ...payload,
      version: Date.now()
    })
  }

  private emitWindowUpdated(sessionId: string): void {
    const status = this.toStatus(this.sessionBrowsers.get(sessionId) ?? null)
    eventBus.sendToRenderer(YO_BROWSER_EVENTS.WINDOW_UPDATED, SendTarget.ALL_WINDOWS, {
      sessionId,
      status
    })
    publishDeepchatEvent('browser.status.changed', {
      sessionId,
      reason: 'updated',
      windowId: this.sessionBrowsers.get(sessionId)?.attachedWindowId ?? null,
      status,
      version: Date.now()
    })
  }

  private emitWindowClosed(sessionId: string): void {
    eventBus.sendToRenderer(YO_BROWSER_EVENTS.WINDOW_CLOSED, SendTarget.ALL_WINDOWS, {
      sessionId
    })
    publishDeepchatEvent('browser.status.changed', {
      sessionId,
      reason: 'closed',
      windowId: null,
      status: null,
      version: Date.now()
    })
  }

  private emitWindowFocused(sessionId: string, windowId: number): void {
    eventBus.sendToRenderer(YO_BROWSER_EVENTS.WINDOW_FOCUSED, SendTarget.ALL_WINDOWS, {
      sessionId,
      windowId
    })
    publishDeepchatEvent('browser.status.changed', {
      sessionId,
      reason: 'focused',
      windowId,
      status: this.toStatus(this.sessionBrowsers.get(sessionId) ?? null),
      version: Date.now()
    })
  }

  private emitWindowCount(): void {
    eventBus.sendToRenderer(
      YO_BROWSER_EVENTS.WINDOW_COUNT_CHANGED,
      SendTarget.ALL_WINDOWS,
      this.sessionBrowsers.size
    )
  }

  private emitWindowVisibility(sessionId: string, visible: boolean): void {
    eventBus.sendToRenderer(YO_BROWSER_EVENTS.WINDOW_VISIBILITY_CHANGED, SendTarget.ALL_WINDOWS, {
      sessionId,
      visible
    })
    publishDeepchatEvent('browser.status.changed', {
      sessionId,
      reason: 'visibility',
      windowId: this.sessionBrowsers.get(sessionId)?.attachedWindowId ?? null,
      visible,
      status: this.toStatus(this.sessionBrowsers.get(sessionId) ?? null),
      version: Date.now()
    })
  }
}
