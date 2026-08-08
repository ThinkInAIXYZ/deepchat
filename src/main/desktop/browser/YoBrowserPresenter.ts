import { BaseWindow, BrowserWindow, WebContents, WebContentsView } from 'electron'
import type { Rectangle } from 'electron'
import { is } from '@electron-toolkit/utils'
import { nanoid } from 'nanoid'
import { DEEPCHAT_EVENT_CHANNEL } from '@shared/contracts/channels'
import { createDeepchatEventEnvelope, type DeepchatEventPublisher } from '@shared/contracts/events'
import logger from '@shared/logger'
import {
  BrowserPageStatus,
  type BrowserPageInfo,
  type BrowserPreviewMode,
  type BrowserPreviewModeResult,
  type BrowserPreviewSurface,
  type ScreenshotOptions,
  type YoBrowserActivityAction,
  type YoBrowserActivityDirection,
  type YoBrowserActivityKind,
  type YoBrowserActivityPayload,
  type YoBrowserActivityPoint,
  type YoBrowserActivityRect,
  type YoBrowserStatus
} from '@shared/types/browser'
import type { DownloadInfo } from '@shared/types/browser'
import type { IWindowPresenter, IYoBrowserPresenter } from '@shared/types/desktop'
import {
  AgentPreviewCoordinator,
  type AgentPreviewAction,
  type AgentPreviewTarget
} from '@/desktop/preview/AgentPreviewCoordinator'
import { BrowserTab as BrowserPage } from './BrowserTab'
import { BrowserProfileImportService } from './BrowserProfileImportService'
import { CDPManager } from './CDPManager'
import { DownloadManager } from './DownloadManager'
import { ScreenshotManager } from './ScreenshotManager'
import {
  clearYoBrowserSessionData,
  getYoBrowserSession,
  getYoBrowserUnpartitionedCookies
} from './yoBrowserSession'
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
  owner: 'agent' | 'user'
  agentRunId?: string
  previewHost: BaseWindow | null
  previewMode: BrowserPreviewMode
  previewSurface: BrowserPreviewSurface
  previewTargetWindowId: number | null
  previewTimer: ReturnType<typeof setTimeout> | null
  previewCapture: Promise<void> | null
  previewEpoch: number
  previewClaimSequence: number
  previewSequence: number
  previewBurstUntil: number
  targetDispatchObserved: boolean
  createdEventPublished: boolean
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

const PREVIEW_VIEWPORT = { width: 1280, height: 800 }
const PREVIEW_FRAME = { width: 480, height: 300 }
const PREVIEW_ACTIVE_INTERVAL_MS = 250
const PREVIEW_IDLE_INTERVAL_MS = 1000
const PREVIEW_MAX_BYTES = 512 * 1024

export class YoBrowserPresenter implements IYoBrowserPresenter {
  private readonly sessionBrowsers = new Map<string, SessionBrowserState>()
  private readonly hostWindowListeners = new Map<number, HostWindowListeners>()
  private readonly cdpManager = new CDPManager()
  private readonly screenshotManager = new ScreenshotManager(this.cdpManager)
  private readonly downloadManager = new DownloadManager()
  private readonly profileImportService = new BrowserProfileImportService(
    getYoBrowserSession,
    getYoBrowserUnpartitionedCookies
  )
  private browserDataMutationActive = false
  private readonly windowPresenter: IWindowPresenter
  private readonly previewCoordinator: AgentPreviewCoordinator
  private readonly unregisterPreviewHandler: () => void
  readonly toolHandler: YoBrowserToolHandler

  constructor(
    windowPresenter: IWindowPresenter,
    private readonly publishEvent: DeepchatEventPublisher,
    previewCoordinator: AgentPreviewCoordinator
  ) {
    this.windowPresenter = windowPresenter
    this.previewCoordinator = previewCoordinator
    this.unregisterPreviewHandler = previewCoordinator.register('browser', (action, target) => {
      this.handleNativePreviewAction(action, target)
    })
    this.toolHandler = new YoBrowserToolHandler(this)
  }

  async getBrowserStatus(sessionId: string): Promise<YoBrowserStatus> {
    return this.toStatus(this.sessionBrowsers.get(sessionId) ?? null)
  }

  async loadUrl(
    sessionId: string,
    url: string,
    timeoutMs?: number,
    hostWindowId?: number,
    activitySource?: YoBrowserActivitySource,
    agentRunId?: string,
    beforeDispatch?: () => void
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

    const stateAlreadyExisted = this.sessionBrowsers.has(normalizedSessionId)
    const state = this.ensureSessionBrowserState(normalizedSessionId)
    try {
      if (activitySource !== 'agent' && state.previewHost) {
        await this.releasePreviewHost(state)
      }
      const projectDispatch = () => {
        state.targetDispatchObserved = true
        const publishCreated = () => {
          if (!state.createdEventPublished) {
            this.emitWindowCreated(normalizedSessionId)
            state.createdEventPublished = true
          }
        }
        const projectOwner = () => {
          this.updateOwner(state, activitySource, agentRunId)
          if (activitySource === 'agent' && !state.visible) {
            this.ensurePreviewHost(state)
          }
        }
        const publishOpenRequest = () => {
          this.logLifecycle('open requested', {
            sessionId: normalizedSessionId,
            windowId: resolvedHostWindowId,
            url
          })
          this.emitOpenRequested(
            normalizedSessionId,
            resolvedHostWindowId,
            url,
            activitySource ?? 'user',
            state.agentRunId
          )
        }
        if (activitySource === 'agent') {
          this.runPostDispatchProjection(normalizedSessionId, 'navigation creation', publishCreated)
          this.runPostDispatchProjection(normalizedSessionId, 'navigation ownership', projectOwner)
          this.runPostDispatchProjection(
            normalizedSessionId,
            'navigation open request',
            publishOpenRequest
          )
        } else {
          publishCreated()
          projectOwner()
          publishOpenRequest()
        }
      }

      if (activitySource === 'agent') {
        await this.runAgentActivity(
          normalizedSessionId,
          { kind: 'navigation', action: 'navigate' },
          (startActivity) =>
            state.page.navigateUntilDomReady(url, timeoutMs ?? 30000, beforeDispatch, () => {
              projectDispatch()
              startActivity()
            })
        )
      } else {
        await state.page.navigateUntilDomReady(
          url,
          timeoutMs ?? 30000,
          beforeDispatch,
          projectDispatch
        )
      }

      state.updatedAt = Date.now()
      if (activitySource === 'agent') {
        this.runPostDispatchProjection(normalizedSessionId, 'navigation completion', () => {
          this.emitWindowUpdated(normalizedSessionId)
        })
      } else {
        this.emitWindowUpdated(normalizedSessionId)
      }
      return this.toStatus(state)
    } catch (error) {
      if (!stateAlreadyExisted && !state.createdEventPublished) {
        this.discardUnpublishedSessionBrowser(state)
      }
      throw error
    }
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

    this.previewCoordinator.hide(this.nativeTargetRef(state))
    await this.releasePreviewHost(state)

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

    const hostWindow = BrowserWindow.fromId(hostWindowId)
    const normalizedBounds = this.normalizeBounds(bounds, hostWindow)
    state.lastBounds = normalizedBounds
    state.updatedAt = Date.now()

    if (!visible || normalizedBounds.width <= 0 || normalizedBounds.height <= 0) {
      state.view.setVisible(false)
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
    state.view.setVisible(true)
    if (hostWindow && !hostWindow.isDestroyed() && hostWindow.isFocused()) {
      await state.overlay.updateBounds(hostWindow, normalizedBounds, true)
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

  async setPreviewMode(
    sessionId: string,
    mode: BrowserPreviewMode,
    hostWindowId?: number,
    runId?: string
  ): Promise<BrowserPreviewModeResult> {
    const state = this.sessionBrowsers.get(sessionId)
    if (!state) {
      return { updated: false, surface: 'none' }
    }

    if (mode === 'stopped') {
      if (runId != null && state.agentRunId != null && runId !== state.agentRunId) {
        return { updated: false, surface: 'none' }
      }
      this.previewCoordinator.hide(this.nativeTargetRef(state))
      await this.releasePreviewHost(state)
      this.previewCoordinator.releaseClaim(this.nativeTargetRef(state))
      state.previewSurface = 'none'
      return { updated: true, surface: 'none' }
    }

    if (
      state.owner !== 'agent' ||
      !state.agentRunId ||
      (runId != null && runId !== state.agentRunId)
    ) {
      return { updated: false, surface: 'none' }
    }

    const targetWindow = hostWindowId == null ? null : BrowserWindow.fromId(hostWindowId)
    if (hostWindowId != null && (!targetWindow || targetWindow.isDestroyed())) {
      return { updated: false, surface: 'none' }
    }
    if (mode === 'capturing') {
      await this.previewCoordinator.initialize()
      if (targetWindow?.isDestroyed()) {
        return { updated: false, surface: 'none' }
      }
    }

    if (mode === 'rendering') {
      this.previewCoordinator.hide(this.nativeTargetRef(state))
    }
    await this.stopPreviewCapture(state)
    if (mode === 'capturing' && (!targetWindow || state.visible)) {
      return { updated: false, surface: 'none' }
    }
    if (!state.visible && !this.ensurePreviewHost(state)) {
      return { updated: false, surface: 'none' }
    }

    state.previewMode = mode
    state.previewTargetWindowId = hostWindowId ?? null
    state.previewEpoch += 1

    if (mode === 'rendering') {
      this.previewCoordinator.hide(this.nativeTargetRef(state))
      return { updated: true, surface: state.previewSurface }
    }

    if (!targetWindow) {
      return { updated: false, surface: 'none' }
    }
    this.resumeClaimedPreview(state)
    if (state.previewSurface === 'none') {
      this.openBrowserPanelForUnavailablePreview(state)
    }
    return {
      updated: true,
      surface: state.previewSurface
    }
  }

  dismissPreview(sessionId: string, runId: string): boolean {
    const state = this.sessionBrowsers.get(sessionId)
    if (!state || state.agentRunId !== runId) {
      return false
    }

    const dismissed = this.previewCoordinator.dismiss({
      source: 'browser',
      sessionId,
      runId
    })
    if (dismissed) {
      state.previewSurface = 'none'
      void this.stopPreviewCapture(state)
      this.emitPreviewSurface(state)
    }
    return dismissed
  }

  async destroySessionBrowser(sessionId: string): Promise<void> {
    const state = this.sessionBrowsers.get(sessionId)
    if (!state) {
      return
    }

    this.previewCoordinator.releaseClaim(this.nativeTargetRef(state))
    await this.releasePreviewHost(state)
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
    activitySource?: YoBrowserActivitySource,
    agentRunId?: string,
    beforeDispatch?: () => void
  ): Promise<unknown> {
    const state = this.sessionBrowsers.get(sessionId)
    if (!state) {
      throw new Error(`Session browser ${sessionId} is not initialized`)
    }

    const descriptor = this.describeCdpActivity(method, params)
    const projectDispatch = () => {
      if (activitySource !== 'agent') return
      this.runPostDispatchProjection(sessionId, `CDP ${method}`, () => {
        state.targetDispatchObserved = true
        this.updateOwner(state, activitySource, agentRunId)
        if (!state.visible) {
          this.ensurePreviewHost(state)
        }
        const windowId = state.attachedWindowId ?? this.resolveHostWindowId()
        if (windowId != null) {
          this.emitOpenRequested(sessionId, windowId, state.page.url, 'agent', state.agentRunId)
        }
        this.emitWindowUpdated(sessionId)
      })
    }
    if (activitySource === 'agent' && descriptor) {
      return await this.runAgentActivity(sessionId, descriptor, (startActivity) =>
        state.page.sendCdpCommand(method, params, beforeDispatch, () => {
          projectDispatch()
          startActivity()
        })
      )
    }

    return await state.page.sendCdpCommand(method, params, beforeDispatch, projectDispatch)
  }

  async startDownload(url: string, savePath?: string): Promise<DownloadInfo> {
    const state = this.findPreferredSessionState()
    if (!state || state.page.contents.isDestroyed()) {
      throw new Error('No active session browser available')
    }
    return await this.downloadManager.downloadFile(url, savePath, state.page.contents)
  }

  async clearSandboxData(): Promise<void> {
    await this.runBrowserDataMutation(async () => {
      await clearYoBrowserSessionData()
      for (const state of this.sessionBrowsers.values()) {
        if (!state.page.contents.isDestroyed()) {
          state.page.contents.reloadIgnoringCache()
        }
      }
    })
  }

  async scanImportSources() {
    return await this.profileImportService.scan()
  }

  async previewImport(profileId: string) {
    return await this.profileImportService.preview(profileId)
  }

  async applyImport(token: string) {
    return await this.runBrowserDataMutation(async () => {
      const result = await this.profileImportService.apply(token)
      for (const state of this.sessionBrowsers.values()) {
        if (!state.page.contents.isDestroyed()) {
          state.page.contents.reloadIgnoringCache()
        }
      }
      return result
    })
  }

  async shutdown(): Promise<void> {
    for (const sessionId of Array.from(this.sessionBrowsers.keys())) {
      await this.destroySessionBrowser(sessionId)
    }
    this.unregisterPreviewHandler()
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
      lastBounds: null,
      owner: 'user',
      previewHost: null,
      previewMode: 'stopped',
      previewSurface: 'none',
      previewTargetWindowId: null,
      previewTimer: null,
      previewCapture: null,
      previewEpoch: 0,
      previewClaimSequence: 0,
      previewSequence: 0,
      previewBurstUntil: 0,
      targetDispatchObserved: false,
      createdEventPublished: false
    }

    this.sessionBrowsers.set(sessionId, state)
    this.setupPageListeners(state, view.webContents)
    return state
  }

  private discardUnpublishedSessionBrowser(state: SessionBrowserState): void {
    if (state.createdEventPublished || this.sessionBrowsers.get(state.sessionId) !== state) {
      return
    }

    this.sessionBrowsers.delete(state.sessionId)
    state.page.destroy()
    state.overlay.destroy()
    if (!state.view.webContents.isDestroyed()) {
      try {
        state.view.webContents.close()
      } catch {
        // Ignore view shutdown failures.
      }
    }
  }

  private runPostDispatchProjection(sessionId: string, action: string, project: () => void): void {
    try {
      project()
    } catch (error) {
      logger.warn('[YoBrowser] Post-dispatch projection failed', { sessionId, action, error })
    }
  }

  private async runBrowserDataMutation<T>(mutation: () => Promise<T>): Promise<T> {
    if (this.browserDataMutationActive) {
      throw new Error('browser_data_mutation_in_progress')
    }
    this.browserDataMutationActive = true
    try {
      return await mutation()
    } finally {
      this.browserDataMutationActive = false
    }
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

    this.previewCoordinator.releaseClaim(this.nativeTargetRef(state))
    this.disposePreviewHost(state)
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
    state.view.setVisible(false)
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
      loading: state.page.contents.isLoading() || state.page.status === BrowserPageStatus.Loading,
      owner: state.owner,
      ...(state.agentRunId ? { agentRunId: state.agentRunId } : {})
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

  private normalizeBounds(bounds: Rectangle, hostWindow?: BrowserWindow | null): Rectangle {
    const contentBounds =
      hostWindow && !hostWindow.isDestroyed() && typeof hostWindow.getContentBounds === 'function'
        ? hostWindow.getContentBounds()
        : null
    const x = Math.max(0, Math.round(bounds.x))
    const y = Math.max(0, Math.round(bounds.y))
    const maxWidth = contentBounds ? Math.max(0, contentBounds.width - x) : Number.MAX_SAFE_INTEGER
    const maxHeight = contentBounds
      ? Math.max(0, contentBounds.height - y)
      : Number.MAX_SAFE_INTEGER
    return {
      x,
      y,
      width: Math.min(maxWidth, Math.max(0, Math.round(bounds.width))),
      height: Math.min(maxHeight, Math.max(0, Math.round(bounds.height)))
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

    this.publishEvent('browser.status.changed', {
      sessionId,
      reason: 'created',
      windowId: payload.status.page
        ? (this.sessionBrowsers.get(sessionId)?.attachedWindowId ?? null)
        : null,
      status: payload.status,
      version: Date.now()
    })
  }

  private emitOpenRequested(
    sessionId: string,
    windowId: number,
    url: string,
    source: 'agent' | 'user',
    runId?: string
  ): void {
    const payload = {
      sessionId,
      windowId,
      url,
      source,
      ...(runId ? { runId } : {})
    }

    this.publishEvent('browser.open.requested', {
      ...payload,
      version: Date.now()
    })
  }

  private updateOwner(
    state: SessionBrowserState,
    activitySource?: YoBrowserActivitySource,
    agentRunId?: string
  ): void {
    if (activitySource === 'agent') {
      const previousRunId = state.agentRunId
      const nextRunId = agentRunId?.trim() || previousRunId || nanoid(12)
      if (previousRunId && previousRunId !== nextRunId) {
        this.previewCoordinator.removeTarget({
          source: 'browser',
          sessionId: state.sessionId,
          runId: previousRunId
        })
        state.previewEpoch += 1
      }
      state.owner = 'agent'
      state.agentRunId = nextRunId
      state.previewClaimSequence = this.previewCoordinator.claim({
        source: 'browser',
        sessionId: state.sessionId,
        runId: nextRunId
      })
      this.resumeClaimedPreview(state)
      return
    }

    this.previewCoordinator.releaseClaim(this.nativeTargetRef(state))
    state.owner = 'user'
    state.agentRunId = undefined
    state.previewClaimSequence = 0
  }

  private emitWindowUpdated(sessionId: string): void {
    const state = this.sessionBrowsers.get(sessionId)
    if (!state?.targetDispatchObserved) {
      return
    }
    if (!state.createdEventPublished) {
      this.emitWindowCreated(sessionId)
      state.createdEventPublished = true
    }
    const status = this.toStatus(state)
    this.publishEvent('browser.status.changed', {
      sessionId,
      reason: 'updated',
      windowId: state.attachedWindowId,
      status,
      version: Date.now()
    })
  }

  private emitWindowClosed(sessionId: string): void {
    this.publishEvent('browser.status.changed', {
      sessionId,
      reason: 'closed',
      windowId: null,
      status: null,
      version: Date.now()
    })
  }

  private emitWindowFocused(sessionId: string, windowId: number): void {
    this.publishEvent('browser.status.changed', {
      sessionId,
      reason: 'focused',
      windowId,
      status: this.toStatus(this.sessionBrowsers.get(sessionId) ?? null),
      version: Date.now()
    })
  }

  private emitWindowVisibility(sessionId: string, visible: boolean): void {
    this.publishEvent('browser.status.changed', {
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
    run: (startActivity: () => void) => Promise<T>
  ): Promise<T> {
    const activityId = nanoid(10)
    let started = false
    const startActivity = () => {
      if (started) return
      started = true
      this.runPostDispatchProjection(sessionId, `${descriptor.action} activity`, () => {
        this.emitBrowserActivity(sessionId, activityId, descriptor, 'started')
      })
    }

    try {
      const result = await run(startActivity)
      if (started) {
        this.runPostDispatchProjection(sessionId, `${descriptor.action} completion`, () => {
          this.emitBrowserActivity(sessionId, activityId, descriptor, 'completed')
        })
      }
      return result
    } catch (error) {
      if (started) {
        this.runPostDispatchProjection(sessionId, `${descriptor.action} failure`, () => {
          this.emitBrowserActivity(sessionId, activityId, descriptor, 'failed')
        })
      }
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
    if (state) {
      state.previewBurstUntil = Date.now() + 1500
    }
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

    this.publishEvent('browser.activity.changed', payload)

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

  private ensurePreviewHost(state: SessionBrowserState): boolean {
    if (state.previewHost && !state.previewHost.isDestroyed()) {
      return true
    }

    let host: BaseWindow | null = null
    try {
      host = new BaseWindow({
        x: -10000,
        y: -10000,
        width: PREVIEW_VIEWPORT.width,
        height: PREVIEW_VIEWPORT.height,
        show: true,
        opacity: 0,
        focusable: false,
        skipTaskbar: true,
        hiddenInMissionControl: true,
        frame: false,
        transparent: true
      })
      host.setIgnoreMouseEvents(true)
      if (state.attachedWindowId != null) {
        this.detachFromWindow(state, state.attachedWindowId)
        this.setSessionVisibility(state, false)
      }
      host.contentView.addChildView(state.view)
      state.view.setBounds({ x: 0, y: 0, ...PREVIEW_VIEWPORT })
      state.view.setVisible(true)
      state.page.contents.setBackgroundThrottling(false)
      state.previewHost = host
      host.once('closed', () => {
        if (state.previewHost === host) {
          this.previewCoordinator.releaseClaim(this.nativeTargetRef(state))
          state.previewHost = null
          state.previewMode = 'stopped'
          state.previewSurface = 'none'
          state.previewTargetWindowId = null
          state.previewEpoch += 1
          state.view.setVisible(false)
          if (!state.page.contents.isDestroyed()) {
            state.page.contents.setBackgroundThrottling(true)
          }
        }
      })
      return true
    } catch (error) {
      if (host && !host.isDestroyed()) {
        host.destroy()
      }
      logger.warn('[YoBrowser] Preview render host unavailable', {
        sessionId: state.sessionId,
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  private async stopPreviewCapture(state: SessionBrowserState): Promise<void> {
    state.previewEpoch += 1
    if (state.previewTimer) {
      clearTimeout(state.previewTimer)
      state.previewTimer = null
    }
    const capture = state.previewCapture
    if (capture) {
      let timeout: ReturnType<typeof setTimeout> | null = null
      await Promise.race([
        capture.catch(() => undefined),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 500)
          timeout.unref?.()
        })
      ])
      if (timeout) {
        clearTimeout(timeout)
      }
    }
  }

  private async releasePreviewHost(state: SessionBrowserState): Promise<void> {
    await this.stopPreviewCapture(state)
    this.disposePreviewHost(state)
  }

  private disposePreviewHost(state: SessionBrowserState): void {
    state.previewEpoch += 1
    if (state.previewTimer) {
      clearTimeout(state.previewTimer)
      state.previewTimer = null
    }
    state.previewMode = 'stopped'
    state.previewSurface = 'none'
    state.previewTargetWindowId = null
    const host = state.previewHost
    state.previewHost = null
    if (!host || host.isDestroyed()) {
      return
    }
    try {
      host.contentView.removeChildView(state.view)
    } catch {
      // Ignore already detached views during shutdown.
    }
    state.view.setVisible(false)
    if (!state.page.contents.isDestroyed()) {
      state.page.contents.setBackgroundThrottling(true)
    }
    host.destroy()
  }

  private resumeClaimedPreview(state: SessionBrowserState): void {
    if (state.previewMode !== 'capturing' || state.previewTargetWindowId == null) {
      return
    }
    const target = this.nativeTarget(state)
    const host = BrowserWindow.fromId(state.previewTargetWindowId)
    if (!target || !host || host.isDestroyed() || state.visible) {
      return
    }

    state.previewSurface = this.previewCoordinator.prepare(target, host)
    this.emitPreviewSurface(state)
    if (
      state.previewSurface !== 'none' &&
      state.previewTimer == null &&
      state.previewCapture == null
    ) {
      this.schedulePreviewCapture(state, 0, state.previewEpoch)
    }
  }

  private emitPreviewSurface(state: SessionBrowserState): void {
    if (state.previewTargetWindowId == null || !state.agentRunId) {
      return
    }
    this.windowPresenter.sendToWindow(
      state.previewTargetWindowId,
      DEEPCHAT_EVENT_CHANNEL,
      createDeepchatEventEnvelope('browser.preview.surface.changed', {
        windowId: state.previewTargetWindowId,
        sessionId: state.sessionId,
        runId: state.agentRunId,
        surface: state.previewSurface,
        version: Date.now()
      })
    )
  }

  private schedulePreviewCapture(state: SessionBrowserState, delayMs: number, epoch: number): void {
    if (state.previewMode !== 'capturing' || state.previewEpoch !== epoch) {
      return
    }
    state.previewTimer = setTimeout(() => {
      state.previewTimer = null
      const capture = this.capturePreviewFrame(state, epoch)
      state.previewCapture = capture
      void capture.finally(() => {
        if (state.previewCapture === capture) {
          state.previewCapture = null
          if (state.previewTimer == null && state.previewMode === 'capturing') {
            this.resumeClaimedPreview(state)
          }
        }
      })
    }, delayMs)
    state.previewTimer.unref?.()
  }

  private async capturePreviewFrame(state: SessionBrowserState, epoch: number): Promise<void> {
    const initialTarget = this.nativeTarget(state)
    if (
      state.previewMode !== 'capturing' ||
      state.previewEpoch !== epoch ||
      state.previewTargetWindowId == null ||
      !state.agentRunId ||
      !initialTarget ||
      !this.previewCoordinator.isCurrent(initialTarget) ||
      state.page.contents.isDestroyed()
    ) {
      return
    }

    try {
      const image = await state.page.contents.capturePage(
        { x: 0, y: 0, ...PREVIEW_VIEWPORT },
        { stayHidden: true }
      )
      if (state.previewMode !== 'capturing' || state.previewEpoch !== epoch) {
        return
      }
      const data = image.resize(PREVIEW_FRAME).toJPEG(72)
      if (data.byteLength <= PREVIEW_MAX_BYTES) {
        if (state.previewSurface === 'native-overlay') {
          const target = this.nativeTarget(state)
          if (target && target.epoch === epoch && !this.previewCoordinator.present(target, data)) {
            const host = BrowserWindow.fromId(target.windowId)
            state.previewSurface =
              host && !host.isDestroyed() ? this.previewCoordinator.prepare(target, host) : 'none'
            this.emitPreviewSurface(state)
            if (state.previewSurface === 'none') {
              this.openBrowserPanelForUnavailablePreview(state)
            }
          }
        }
        if (state.previewSurface === 'renderer-canvas') {
          this.sendRendererPreviewFrame(state, data)
        }
      }
    } catch (error) {
      logger.warn('[YoBrowser] Preview capture failed', {
        sessionId: state.sessionId,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    const active = state.page.contents.isLoading() || Date.now() < state.previewBurstUntil
    const nextTarget = this.nativeTarget(state)
    if (!nextTarget || !this.previewCoordinator.isCurrent(nextTarget)) {
      return
    }
    this.schedulePreviewCapture(
      state,
      active ? PREVIEW_ACTIVE_INTERVAL_MS : PREVIEW_IDLE_INTERVAL_MS,
      epoch
    )
  }

  private nativeTarget(state: SessionBrowserState): AgentPreviewTarget | null {
    if (
      state.previewTargetWindowId == null ||
      !state.agentRunId ||
      state.previewClaimSequence <= 0
    ) {
      return null
    }
    return {
      source: 'browser',
      windowId: state.previewTargetWindowId,
      sessionId: state.sessionId,
      runId: state.agentRunId,
      epoch: state.previewEpoch,
      claimSequence: state.previewClaimSequence
    }
  }

  private sendRendererPreviewFrame(state: SessionBrowserState, data: Buffer): void {
    if (state.previewTargetWindowId == null || !state.agentRunId) {
      return
    }
    state.previewSequence += 1
    this.windowPresenter.sendToWindow(
      state.previewTargetWindowId,
      DEEPCHAT_EVENT_CHANNEL,
      createDeepchatEventEnvelope('browser.preview.frame', {
        sessionId: state.sessionId,
        runId: state.agentRunId,
        sequence: state.previewSequence,
        ...PREVIEW_FRAME,
        mimeType: 'image/jpeg',
        data,
        timestamp: Date.now()
      })
    )
  }

  private nativeTargetRef(state: SessionBrowserState): {
    source: 'browser'
    sessionId: string
    runId?: string
  } {
    return {
      source: 'browser',
      sessionId: state.sessionId,
      ...(state.agentRunId ? { runId: state.agentRunId } : {})
    }
  }

  private openBrowserPanelForUnavailablePreview(state: SessionBrowserState): void {
    if (this.previewCoordinator.isAvailable()) {
      return
    }
    const target = this.nativeTarget(state)
    if (target) {
      this.handleNativePreviewAction('activate', target)
    }
  }

  private handleNativePreviewAction(action: AgentPreviewAction, target: AgentPreviewTarget): void {
    const state = this.sessionBrowsers.get(target.sessionId)
    if (
      !state ||
      target.source !== 'browser' ||
      state.previewTargetWindowId !== target.windowId ||
      state.agentRunId !== target.runId ||
      state.previewEpoch !== target.epoch ||
      state.previewClaimSequence !== target.claimSequence
    ) {
      return
    }

    state.previewSurface = 'none'
    void this.stopPreviewCapture(state)
    this.emitPreviewSurface(state)

    if (action === 'superseded') {
      return
    }

    state.previewMode = 'rendering'

    if (action === 'activate') {
      this.windowPresenter.show(target.windowId, true)
    }

    this.windowPresenter.sendToWindow(
      target.windowId,
      DEEPCHAT_EVENT_CHANNEL,
      createDeepchatEventEnvelope('browser.preview.action', {
        action,
        windowId: target.windowId,
        sessionId: target.sessionId,
        runId: target.runId
      })
    )
  }
}
