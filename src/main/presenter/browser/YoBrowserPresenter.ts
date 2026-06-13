import { BrowserWindow, WebContents, WebContentsView } from 'electron'
import type { Rectangle } from 'electron'
import { is } from '@electron-toolkit/utils'
import { nanoid } from 'nanoid'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import logger from '@shared/logger'
import {
  BrowserPageStatus,
  type BrowserPageInfo,
  type ScreenshotOptions,
  type YoBrowserActivityAction,
  type YoBrowserActivityDirection,
  type YoBrowserActivityKind,
  type YoBrowserActivityPayload,
  type YoBrowserActivityPoint,
  type YoBrowserActivityRect,
  type YoBrowserStatus
} from '@shared/types/browser'
import type { DownloadInfo, IWindowPresenter, IYoBrowserPresenter } from '@shared/presenter'
import { BrowserTab as BrowserPage } from './BrowserTab'
import { CDPManager } from './CDPManager'
import { DownloadManager } from './DownloadManager'
import { ScreenshotManager } from './ScreenshotManager'
import { clearYoBrowserSessionData, getYoBrowserSession } from './yoBrowserSession'
import { YoBrowserOverlayWindow } from './YoBrowserOverlayWindow'
import { YoBrowserToolHandler } from './YoBrowserToolHandler'

type YoBrowserActivitySource = 'agent'

type BrowserActivityDescriptor = {
  kind: YoBrowserActivityKind
  action: YoBrowserActivityAction
  point?: YoBrowserActivityPoint
  rect?: YoBrowserActivityRect
  direction?: YoBrowserActivityDirection
}

type SessionBrowserState = {
  sessionId: string
  view: WebContentsView
  page: BrowserPage
  overlay: YoBrowserOverlayWindow
  createdAt: number
  updatedAt: number
  visible: boolean
  attachedWindowId: number | null
  lastBounds: Rectangle | null
}

type HostWindowListeners = {
  focus: () => void
  blur: () => void
  show: () => void
  hide: () => void
  move: () => void
  resize: () => void
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
    hostWindowId?: number,
    activitySource?: YoBrowserActivitySource
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

    const navigate = () => state.page.navigateUntilDomReady(url, timeoutMs ?? 30000)
    if (activitySource === 'agent') {
      await this.runAgentActivity(
        normalizedSessionId,
        { kind: 'navigation', action: 'navigate' },
        navigate
      )
    } else {
      await navigate()
    }

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
    this.preserveHostWebContentsFocus(hostWindow)
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
    const hostWindow = BrowserWindow.fromId(hostWindowId)
    if (hostWindow && !hostWindow.isDestroyed() && hostWindow.isFocused()) {
      await state.overlay.updateBounds(hostWindow, normalizedBounds, true)
      this.preserveHostWebContentsFocus(hostWindow)
    }
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
    state.overlay.destroy()
    this.sessionBrowsers.delete(sessionId)

    if (!state.view.webContents.isDestroyed()) {
      try {
        state.view.webContents.close()
      } catch {
        // Ignore view shutdown failures.
      }
    }

    this.emitWindowClosed(sessionId)
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
    params?: Record<string, unknown>,
    activitySource?: YoBrowserActivitySource
  ): Promise<unknown> {
    const state = this.sessionBrowsers.get(sessionId)
    if (!state) {
      throw new Error(`Session browser ${sessionId} is not initialized`)
    }

    const descriptor = this.describeCdpActivity(method, params)
    if (activitySource === 'agent' && descriptor) {
      return await this.runAgentActivity(sessionId, descriptor, () =>
        state.page.sendCdpCommand(method, params)
      )
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
      overlay: new YoBrowserOverlayWindow(),
      createdAt: now,
      updatedAt: now,
      visible: false,
      attachedWindowId: null,
      lastBounds: null
    }

    this.sessionBrowsers.set(sessionId, state)
    this.setupPageListeners(state, view.webContents)
    this.emitWindowCreated(sessionId)
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
    state.overlay.destroy()
    state.attachedWindowId = null
    state.visible = false
    this.sessionBrowsers.delete(sessionId)
    this.emitWindowClosed(sessionId)
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

    const blur = () => {
      const state = this.findAttachedStateByWindowId(windowId)
      if (!state) {
        return
      }
      state.overlay.hide()
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

    const move = () => {
      this.syncOverlayBoundsForWindow(windowId)
    }

    const resize = () => {
      this.syncOverlayBoundsForWindow(windowId)
    }

    const closed = () => {
      const state = this.findAttachedStateByWindowId(windowId)
      if (state) {
        state.attachedWindowId = null
        this.setSessionVisibility(state, false)
      }
      this.detachHostWindowListeners(windowId)
    }

    this.hostWindowListeners.set(windowId, { focus, blur, show, hide, move, resize, closed })
    window.on('focus', focus)
    window.on('blur', blur)
    window.on('show', show)
    window.on('hide', hide)
    window.on('move', move)
    window.on('resize', resize)
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
      window.removeListener('blur', listeners.blur)
      window.removeListener('show', listeners.show)
      window.removeListener('hide', listeners.hide)
      window.removeListener('move', listeners.move)
      window.removeListener('resize', listeners.resize)
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
    state.overlay.hide()
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
    if (!visible) {
      state.overlay.hide()
    } else if (state.attachedWindowId != null && state.lastBounds) {
      this.syncOverlayBoundsForWindow(state.attachedWindowId)
    }
    this.emitWindowVisibility(state.sessionId, visible)
  }

  private syncOverlayBoundsForWindow(windowId: number): void {
    const state = this.findAttachedStateByWindowId(windowId)
    const hostWindow = BrowserWindow.fromId(windowId)
    if (
      !state ||
      !state.visible ||
      !state.lastBounds ||
      !hostWindow ||
      hostWindow.isDestroyed() ||
      !hostWindow.isFocused()
    ) {
      return
    }

    void state.overlay.updateBounds(hostWindow, state.lastBounds, true)
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

    publishDeepchatEvent('browser.open.requested', {
      ...payload,
      version: Date.now()
    })
  }

  private emitWindowUpdated(sessionId: string): void {
    const status = this.toStatus(this.sessionBrowsers.get(sessionId) ?? null)
    publishDeepchatEvent('browser.status.changed', {
      sessionId,
      reason: 'updated',
      windowId: this.sessionBrowsers.get(sessionId)?.attachedWindowId ?? null,
      status,
      version: Date.now()
    })
  }

  private emitWindowClosed(sessionId: string): void {
    publishDeepchatEvent('browser.status.changed', {
      sessionId,
      reason: 'closed',
      windowId: null,
      status: null,
      version: Date.now()
    })
  }

  private emitWindowFocused(sessionId: string, windowId: number): void {
    publishDeepchatEvent('browser.status.changed', {
      sessionId,
      reason: 'focused',
      windowId,
      status: this.toStatus(this.sessionBrowsers.get(sessionId) ?? null),
      version: Date.now()
    })
  }

  private emitWindowVisibility(sessionId: string, visible: boolean): void {
    publishDeepchatEvent('browser.status.changed', {
      sessionId,
      reason: 'visibility',
      windowId: this.sessionBrowsers.get(sessionId)?.attachedWindowId ?? null,
      visible,
      status: this.toStatus(this.sessionBrowsers.get(sessionId) ?? null),
      version: Date.now()
    })
  }

  private async runAgentActivity<T>(
    sessionId: string,
    descriptor: BrowserActivityDescriptor,
    run: () => Promise<T>
  ): Promise<T> {
    const activityId = nanoid(10)
    this.emitBrowserActivity(sessionId, activityId, descriptor, 'started')

    try {
      const result = await run()
      this.emitBrowserActivity(sessionId, activityId, descriptor, 'completed')
      return result
    } catch (error) {
      this.emitBrowserActivity(sessionId, activityId, descriptor, 'failed')
      throw error
    }
  }

  private emitBrowserActivity(
    sessionId: string,
    activityId: string,
    descriptor: BrowserActivityDescriptor,
    phase: YoBrowserActivityPayload['phase']
  ): void {
    const state = this.sessionBrowsers.get(sessionId) ?? null
    const windowId = state?.attachedWindowId ?? this.resolveHostWindowId() ?? null
    const payload: YoBrowserActivityPayload = {
      id: activityId,
      sessionId,
      windowId,
      pageId: state?.page.pageId,
      kind: descriptor.kind,
      action: descriptor.action,
      phase,
      point: descriptor.point,
      rect: descriptor.rect,
      direction: descriptor.direction,
      timestamp: Date.now()
    }

    publishDeepchatEvent('browser.activity.changed', payload)

    if (!state || !state.visible || windowId == null || !state.lastBounds) {
      return
    }

    const hostWindow = BrowserWindow.fromId(windowId)
    if (!hostWindow || hostWindow.isDestroyed()) {
      return
    }

    if (!hostWindow.isFocused()) {
      state.overlay.hide()
      return
    }

    void state.overlay.updateBounds(hostWindow, state.lastBounds, true).then(() => {
      if (hostWindow.isDestroyed() || !hostWindow.isVisible() || !hostWindow.isFocused()) {
        state.overlay.hide()
        return
      }

      state.overlay.sendActivity(payload)
    })
  }

  private describeCdpActivity(
    method: string,
    params?: Record<string, unknown>
  ): BrowserActivityDescriptor | null {
    switch (method) {
      case 'Page.navigate':
        return { kind: 'navigation', action: 'navigate' }
      case 'Page.reload':
        return { kind: 'navigation', action: 'reload' }
      case 'Page.captureScreenshot':
        return { kind: 'vision', action: 'screenshot', rect: this.extractClipRect(params) }
      case 'Runtime.evaluate':
        return this.describeRuntimeEvaluateActivity(params)
      case 'DOM.getDocument':
      case 'DOM.querySelector':
      case 'DOM.querySelectorAll':
      case 'DOM.getOuterHTML':
        return { kind: 'vision', action: 'dom' }
      case 'Input.dispatchMouseEvent':
        return this.describeMouseActivity(params)
      case 'Input.dispatchKeyEvent':
        return { kind: 'keyboard', action: 'key' }
      default:
        return null
    }
  }

  private describeMouseActivity(
    params?: Record<string, unknown>
  ): BrowserActivityDescriptor | null {
    const type = typeof params?.type === 'string' ? params.type : ''
    const point = this.extractPoint(params)

    if (type === 'mouseWheel') {
      return {
        kind: 'scroll',
        action: 'mouse_wheel',
        point,
        direction: this.inferScrollDirection(params)
      }
    }

    if (type === 'mouseMoved') {
      return {
        kind: 'pointer',
        action: 'mouse_move',
        point
      }
    }

    if (type === 'mousePressed') {
      return {
        kind: 'pointer',
        action: 'mouse_click',
        point
      }
    }

    return null
  }

  private describeRuntimeEvaluateActivity(
    params?: Record<string, unknown>
  ): BrowserActivityDescriptor {
    const expression = typeof params?.expression === 'string' ? params.expression : ''

    if (
      /\bclick\s*\(/i.test(expression) ||
      /dispatchEvent\s*\(\s*new\s+(?:MouseEvent|PointerEvent)\b/i.test(expression) ||
      /dispatchEvent\s*\(\s*new\s+Event\s*\(\s*['"]click['"]/i.test(expression)
    ) {
      return {
        kind: 'pointer',
        action: 'mouse_click',
        point: this.extractPointFromRuntimeExpression(expression)
      }
    }

    if (/\b(?:scrollBy|scrollTo|scrollIntoView)\s*\(/i.test(expression)) {
      return {
        kind: 'scroll',
        action: 'mouse_wheel',
        direction: this.inferRuntimeScrollDirection(expression)
      }
    }

    return { kind: 'vision', action: 'runtime' }
  }

  private extractPoint(params?: Record<string, unknown>): YoBrowserActivityPoint | undefined {
    const x = typeof params?.x === 'number' && Number.isFinite(params.x) ? params.x : null
    const y = typeof params?.y === 'number' && Number.isFinite(params.y) ? params.y : null

    if (x == null || y == null) {
      return undefined
    }

    return {
      x: Math.round(x),
      y: Math.round(y)
    }
  }

  private extractClipRect(params?: Record<string, unknown>): YoBrowserActivityRect | undefined {
    const clip = params?.clip
    if (!clip || typeof clip !== 'object' || Array.isArray(clip)) {
      return undefined
    }

    const record = clip as Record<string, unknown>
    const x = typeof record.x === 'number' && Number.isFinite(record.x) ? record.x : null
    const y = typeof record.y === 'number' && Number.isFinite(record.y) ? record.y : null
    const width =
      typeof record.width === 'number' && Number.isFinite(record.width) ? record.width : null
    const height =
      typeof record.height === 'number' && Number.isFinite(record.height) ? record.height : null

    if (x == null || y == null || width == null || height == null) {
      return undefined
    }

    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height))
    }
  }

  private inferScrollDirection(
    params?: Record<string, unknown>
  ): YoBrowserActivityDirection | undefined {
    const deltaX =
      typeof params?.deltaX === 'number' && Number.isFinite(params.deltaX) ? params.deltaX : 0
    const deltaY =
      typeof params?.deltaY === 'number' && Number.isFinite(params.deltaY) ? params.deltaY : 0

    if (Math.abs(deltaY) >= Math.abs(deltaX) && deltaY !== 0) {
      return deltaY > 0 ? 'down' : 'up'
    }

    if (deltaX !== 0) {
      return deltaX > 0 ? 'right' : 'left'
    }

    return undefined
  }

  private extractPointFromRuntimeExpression(
    expression: string
  ): YoBrowserActivityPoint | undefined {
    const clientPointMatch = /client([XY])\s*:\s*(-?\d+(?:\.\d+)?)/gi
    const point: Partial<Record<'x' | 'y', number>> = {}
    let match: RegExpExecArray | null

    while ((match = clientPointMatch.exec(expression)) !== null) {
      const axis = match[1].toLowerCase() as 'x' | 'y'
      if (point[axis] == null) {
        point[axis] = Number(match[2])
      }
      if (point.x != null && point.y != null) {
        break
      }
    }

    if (
      point.x == null ||
      point.y == null ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y)
    ) {
      return undefined
    }

    return {
      x: Math.round(point.x),
      y: Math.round(point.y)
    }
  }

  private inferRuntimeScrollDirection(expression: string): YoBrowserActivityDirection | undefined {
    const scrollByMatch = /scroll(?:By|To)\s*\(([^)]*)\)/i.exec(expression)
    const args = scrollByMatch?.[1]
    if (!args) {
      return undefined
    }

    const numbers = Array.from(args.matchAll(/-?\d+(?:\.\d+)?/g)).map((match) => Number(match[0]))
    if (numbers.length < 2 || numbers.some((value) => !Number.isFinite(value))) {
      return undefined
    }

    const [x, y] = numbers
    if (Math.abs(y) >= Math.abs(x) && y !== 0) {
      return y > 0 ? 'down' : 'up'
    }

    if (x !== 0) {
      return x > 0 ? 'right' : 'left'
    }

    return undefined
  }

  private preserveHostWebContentsFocus(hostWindow: BrowserWindow): void {
    if (hostWindow.isDestroyed() || hostWindow.webContents.isDestroyed()) {
      return
    }

    if (!hostWindow.isFocused()) {
      return
    }

    queueMicrotask(() => {
      if (hostWindow.isDestroyed() || hostWindow.webContents.isDestroyed()) {
        return
      }
      hostWindow.webContents.focus()
    })
  }
}
