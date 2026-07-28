import { app, screen, type BrowserWindow, type Rectangle } from 'electron'
import { performance } from 'node:perf_hooks'
import logger from '@shared/logger'

type NativeKitOverlay = (typeof import('@zerob13/nativekit'))['overlay']

export type AgentPreviewSource = 'browser' | 'computer-use'

export type AgentPreviewTarget = {
  source: AgentPreviewSource
  windowId: number
  sessionId: string
  runId: string
  epoch: number
  claimSequence: number
}

export type AgentPreviewSurface = 'native-overlay' | 'renderer-canvas' | 'none'

export type AgentPreviewAction = 'activate' | 'dismiss' | 'superseded'

type AgentPreviewTargetRef = {
  source?: AgentPreviewSource
  sessionId: string
  runId?: string
}

type AgentPreviewActionHandler = (action: AgentPreviewAction, target: AgentPreviewTarget) => void

type AgentPreviewClaim = {
  source: AgentPreviewSource
  runId: string
  sequence: number
}

type HostListeners = {
  focus: () => void
  blur: () => void
  show: () => void
  hide: () => void
  minimize: () => void
  restore: () => void
  move: () => void
  resize: () => void
  closed: () => void
}

const PREVIEW_MAX_EDGE = 360
const HOST_ANCHOR_OFFSET = 16
const HOST_SYNC_DELAY_MS = 50
const SLOW_PUSH_WARNING_MS = 25
const SLOW_PUSH_WARNING_INTERVAL_MS = 60_000
const OPEN_PANEL_CONTROL_ID = 'open-panel'
const CLOSE_CONTROL_ID = 'close'
const OPEN_PANEL_ICON_DATA_URL =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAsElEQVQ4jb2TTQrCMBCFvy49TO8lpXtBN+3OO7l1oxfwB3Ur9A5RGXgDQRJMrRiYxZvM+8jPDEAFtMAZeADPD2E1J6CRl7bAlIsG0UxcgHUm3LCVvkofDRAkevLLAZ10Lx1Sm75qYA8sEzVdlCMFMPOg/G4soI7Mg3QxYAbc38z8FTD5Cj95xNHfGKY2kreytecKWCTCARvV3OJWtoH4dpjmBrCRNIjRSsbZjn2QuXoB3zqtlvLPIoMAAAAASUVORK5CYII='
const CLOSE_ICON_DATA_URL =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAdklEQVQ4jbWTSwrAIAxE31G71F111d6z9DoWQSSKn1DbB64yM5gY4SM24AaMQmuSNnoyFxDS8fTxQhc9GSsKvRBpDslTsFeCU9RcVTtK6zhEbe5dddaaOkRtpnHteib/teAaAxu9TsFo2tMQu7pIy6u8/Jle8wCGAVmb4KsRPAAAAABJRU5ErkJggg=='

const toolbarOptions = (source: AgentPreviewSource): Parameters<NativeKitOverlay['start']>[0] => ({
  toolbar: {
    style: 'dark',
    buttons:
      source === 'browser'
        ? [
            {
              id: OPEN_PANEL_CONTROL_ID,
              imageData: OPEN_PANEL_ICON_DATA_URL,
              tooltip: 'Open in side panel'
            },
            {
              id: CLOSE_CONTROL_ID,
              imageData: CLOSE_ICON_DATA_URL,
              tooltip: 'Close'
            }
          ]
        : [
            {
              id: CLOSE_CONTROL_ID,
              imageData: CLOSE_ICON_DATA_URL,
              tooltip: 'Close'
            }
          ]
  }
})

export class AgentPreviewCoordinator {
  private overlay: NativeKitOverlay | null = null
  private available = false
  private unavailable = false
  private initialization: Promise<boolean> | null = null
  private host: BrowserWindow | null = null
  private hostListeners: HostListeners | null = null
  private hostSyncTimer: ReturnType<typeof setTimeout> | null = null
  private target: AgentPreviewTarget | null = null
  private desiredVisible = false
  private overlayVisible: boolean | null = null
  private activeSessionId: string | null = null
  private toolbarSource: AgentPreviewSource | null = null
  private nextClaimSequence = 0
  private readonly claims = new Map<string, AgentPreviewClaim>()
  private readonly dismissedRuns = new Map<string, string>()
  private readonly handlers = new Map<AgentPreviewSource, AgentPreviewActionHandler>()
  private lastSlowPushWarningAt = 0
  private lastPushFailureWarningAt = 0
  private listeningForDisplays = false

  private readonly handleActivate = () => {
    if (this.target?.source === 'browser') {
      this.emitAction('activate')
    }
  }

  private readonly handleControl = (controlId: string) => {
    if (controlId === OPEN_PANEL_CONTROL_ID && this.target?.source === 'browser') {
      this.emitAction('activate')
    } else if (controlId === CLOSE_CONTROL_ID) {
      this.dismissCurrent()
    }
  }

  private readonly handleDisplayChange = () => {
    this.scheduleHostSync()
  }

  register(source: AgentPreviewSource, handler: AgentPreviewActionHandler): () => void {
    this.handlers.set(source, handler)
    return () => {
      if (this.handlers.get(source) === handler) {
        this.handlers.delete(source)
      }
    }
  }

  claim(input: { source: AgentPreviewSource; sessionId: string; runId: string }): number {
    const sessionId = input.sessionId.trim()
    const runId = input.runId.trim()
    if (!sessionId || !runId) {
      return 0
    }

    if (this.dismissedRuns.get(sessionId) !== runId) {
      this.dismissedRuns.delete(sessionId)
    }

    const sequence = ++this.nextClaimSequence
    this.claims.set(sessionId, {
      source: input.source,
      runId,
      sequence
    })
    return sequence
  }

  releaseClaim(target: AgentPreviewTargetRef): void {
    const claim = this.claims.get(target.sessionId)
    if (
      claim &&
      (target.source == null || claim.source === target.source) &&
      (target.runId == null || claim.runId === target.runId)
    ) {
      this.claims.delete(target.sessionId)
    }
    this.removeTarget(target)
  }

  dismiss(target: AgentPreviewTargetRef): boolean {
    const current = this.target
    const claim = this.claims.get(target.sessionId)
    const runId = target.runId ?? current?.runId ?? claim?.runId
    if (!runId) {
      return false
    }
    const currentOwnsRun =
      current?.sessionId === target.sessionId && (target.runId == null || current.runId === runId)
    const owner = currentOwnsRun ? current.source : claim?.source
    if (target.source && owner !== target.source) {
      return false
    }

    this.dismissedRuns.set(target.sessionId, runId)
    this.removeTarget({ sessionId: target.sessionId, runId })
    return true
  }

  async initialize(): Promise<boolean> {
    if (this.available) {
      return true
    }
    if (this.unavailable) {
      return false
    }
    if (this.initialization) {
      return await this.initialization
    }

    this.initialization = this.start()
    return await this.initialization
  }

  isAvailable(): boolean {
    return this.available
  }

  isCurrent(target: AgentPreviewTarget): boolean {
    return this.matchesTarget(target) && this.matchesClaim(target) && !this.isDismissed(target)
  }

  prepare(target: AgentPreviewTarget, host: BrowserWindow): AgentPreviewSurface {
    if (
      host.isDestroyed() ||
      !this.matchesClaim(target) ||
      this.isDismissed(target) ||
      target.claimSequence <= 0
    ) {
      return 'none'
    }

    const previous = this.target
    const presentationChanged =
      previous != null && this.presentationId(previous) !== this.presentationId(target)
    if (presentationChanged) {
      this.desiredVisible = false
      this.setOverlayVisible(false)
      this.removeCurrentPresentation()
      this.target = null
      this.handlers.get(previous.source)?.('superseded', { ...previous })
    }

    this.target = { ...target }
    this.desiredVisible = true

    if (!this.available || !this.overlay) {
      return 'renderer-canvas'
    }
    if (!this.configureToolbar(target.source)) {
      this.disableNative('toolbar_update_failed')
      return 'renderer-canvas'
    }
    if (!this.attachHost(host)) {
      this.disableNative('host_attach_failed')
      return 'renderer-canvas'
    }
    return 'native-overlay'
  }

  present(target: AgentPreviewTarget, jpeg: Buffer): boolean {
    const overlay = this.overlay
    if (!this.available || !overlay || !this.isCurrent(target) || !this.host) {
      return false
    }

    const startedAt = performance.now()
    try {
      const pushed = overlay.pushImage({
        hostId: this.hostId(target.windowId),
        presentationId: this.presentationId(target),
        sessionId: this.nativeSessionId(target),
        imageData: `data:image/jpeg;base64,${jpeg.toString('base64')}`
      })
      this.recordPushDuration(performance.now() - startedAt)
      if (!pushed) {
        this.warnFramePush(new Error('pushImage returned false'))
        this.disableNative('frame_push_failed')
        return false
      }

      const nativeSessionId = this.nativeSessionId(target)
      if (this.activeSessionId !== nativeSessionId) {
        if (overlay.setActiveSession(nativeSessionId)) {
          this.activeSessionId = nativeSessionId
        } else {
          this.warn('active_session_update_failed', new Error('setActiveSession returned false'))
        }
      }

      if (this.desiredVisible && this.isHostEligible(this.host)) {
        this.setOverlayVisible(true)
      }
      return true
    } catch (error) {
      this.recordPushDuration(performance.now() - startedAt)
      this.warnFramePush(error)
      this.disableNative('frame_push_failed')
      return false
    }
  }

  hide(target?: AgentPreviewTargetRef): void {
    if (target && !this.matchesRef(target)) {
      return
    }
    this.desiredVisible = false
    this.setOverlayVisible(false)
  }

  removeTarget(target?: AgentPreviewTargetRef): void {
    if (target && !this.matchesRef(target)) {
      return
    }
    this.desiredVisible = false
    this.setOverlayVisible(false)
    this.removeCurrentPresentation()
    this.target = null
  }

  shutdown(): void {
    this.removeTarget()
    this.claims.clear()
    this.dismissedRuns.clear()
    this.handlers.clear()
    this.unavailable = true
    this.stopNative()
  }

  private async start(): Promise<boolean> {
    if (!this.isPublishedTarget()) {
      this.unavailable = true
      this.logUnavailable('unsupported_platform')
      return false
    }

    try {
      const nativekit = await import('@zerob13/nativekit')
      const overlay = nativekit.overlay
      if (
        !overlay.start(toolbarOptions('browser')) ||
        !overlay.setMaxSize(PREVIEW_MAX_EDGE) ||
        !overlay.setVisible(false)
      ) {
        try {
          overlay.stop()
        } catch {
          // Startup already failed; there is no useful cleanup error to surface.
        }
        this.unavailable = true
        this.logUnavailable('startup_failed')
        return false
      }

      overlay.on('activate', this.handleActivate)
      overlay.on('control', this.handleControl)
      this.overlay = overlay
      this.toolbarSource = 'browser'
      this.overlayVisible = false
      this.available = true
      this.startDisplayListeners()
      return true
    } catch (error) {
      this.unavailable = true
      this.stopNative()
      this.logUnavailable('load_failed', error)
      return false
    }
  }

  private configureToolbar(source: AgentPreviewSource): boolean {
    if (!this.overlay || this.toolbarSource === source) {
      return Boolean(this.overlay)
    }
    try {
      if (!this.overlay.start(toolbarOptions(source))) {
        return false
      }
      this.toolbarSource = source
      return true
    } catch (error) {
      this.warn('toolbar_update_failed', error)
      return false
    }
  }

  private attachHost(host: BrowserWindow, force = false): boolean {
    const overlay = this.overlay
    if (!overlay || host.isDestroyed()) {
      return false
    }
    if (!force && this.host?.id === host.id && this.hostListeners) {
      return true
    }

    if (this.host && this.host.id !== host.id) {
      this.unbindHost()
    }

    try {
      const attached = overlay.attachHost({
        id: this.hostId(host.id),
        title: host.getTitle().trim() || app.getName() || 'DeepChat',
        bounds: this.normalizeBounds(host.getContentBounds()),
        windowHandle: host.getNativeWindowHandle(),
        anchor: {
          edge: 'trailing',
          offset: HOST_ANCHOR_OFFSET
        }
      })
      if (!attached) {
        return false
      }

      this.host = host
      this.bindHost(host)
      return true
    } catch (error) {
      this.warn('host_attach_failed', error)
      return false
    }
  }

  private bindHost(host: BrowserWindow): void {
    if (this.hostListeners) {
      return
    }

    const hide = () => this.setOverlayVisible(false)
    const scheduleSync = () => this.scheduleHostSync()
    const closed = () => {
      this.removeTarget()
      this.unbindHost()
    }
    const listeners: HostListeners = {
      focus: scheduleSync,
      blur: hide,
      show: scheduleSync,
      hide,
      minimize: hide,
      restore: scheduleSync,
      move: scheduleSync,
      resize: scheduleSync,
      closed
    }

    this.hostListeners = listeners
    host.on('focus', listeners.focus)
    host.on('blur', listeners.blur)
    host.on('show', listeners.show)
    host.on('hide', listeners.hide)
    host.on('minimize', listeners.minimize)
    host.on('restore', listeners.restore)
    host.on('move', listeners.move)
    host.on('resize', listeners.resize)
    host.on('closed', listeners.closed)
  }

  private unbindHost(): void {
    this.clearHostSyncTimer()
    const host = this.host
    const listeners = this.hostListeners
    this.host = null
    this.hostListeners = null

    if (host && listeners && !host.isDestroyed()) {
      host.removeListener('focus', listeners.focus)
      host.removeListener('blur', listeners.blur)
      host.removeListener('show', listeners.show)
      host.removeListener('hide', listeners.hide)
      host.removeListener('minimize', listeners.minimize)
      host.removeListener('restore', listeners.restore)
      host.removeListener('move', listeners.move)
      host.removeListener('resize', listeners.resize)
      host.removeListener('closed', listeners.closed)
    }

    if (host && this.overlay) {
      try {
        this.overlay.detachHost(this.hostId(host.id))
      } catch (error) {
        this.warn('host_detach_failed', error)
      }
    }
  }

  private scheduleHostSync(): void {
    this.clearHostSyncTimer()
    this.hostSyncTimer = setTimeout(() => {
      this.hostSyncTimer = null
      const host = this.host
      if (host && !host.isDestroyed()) {
        this.attachHost(host, true)
      }
    }, HOST_SYNC_DELAY_MS)
    this.hostSyncTimer.unref?.()
  }

  private clearHostSyncTimer(): void {
    if (this.hostSyncTimer) {
      clearTimeout(this.hostSyncTimer)
      this.hostSyncTimer = null
    }
  }

  private startDisplayListeners(): void {
    if (this.listeningForDisplays) {
      return
    }
    this.listeningForDisplays = true
    screen.on('display-added', this.handleDisplayChange)
    screen.on('display-removed', this.handleDisplayChange)
    screen.on('display-metrics-changed', this.handleDisplayChange)
  }

  private stopDisplayListeners(): void {
    if (!this.listeningForDisplays) {
      return
    }
    this.listeningForDisplays = false
    screen.removeListener('display-added', this.handleDisplayChange)
    screen.removeListener('display-removed', this.handleDisplayChange)
    screen.removeListener('display-metrics-changed', this.handleDisplayChange)
  }

  private emitAction(action: 'activate' | 'dismiss'): void {
    const target = this.target
    if (!target) {
      return
    }
    this.desiredVisible = false
    this.setOverlayVisible(false)
    this.handlers.get(target.source)?.(action, { ...target })
  }

  private dismissCurrent(): void {
    const target = this.target
    if (!target) {
      return
    }
    this.dismissedRuns.set(target.sessionId, target.runId)
    this.desiredVisible = false
    this.setOverlayVisible(false)
    this.removeCurrentPresentation()
    this.target = null
    this.handlers.get(target.source)?.('dismiss', { ...target })
  }

  private setOverlayVisible(visible: boolean): void {
    if (!this.overlay || this.overlayVisible === visible) {
      return
    }
    try {
      if (this.overlay.setVisible(visible)) {
        this.overlayVisible = visible
      } else {
        this.warn('visibility_update_failed', new Error('setVisible returned false'))
      }
    } catch (error) {
      this.warn('visibility_update_failed', error)
    }
  }

  private removeCurrentPresentation(): void {
    if (!this.overlay || !this.target) {
      return
    }
    try {
      this.overlay.removeImage(this.presentationId(this.target))
      this.activeSessionId = null
    } catch (error) {
      this.warn('presentation_remove_failed', error)
    }
  }

  private matchesTarget(target: AgentPreviewTarget): boolean {
    return (
      this.target?.source === target.source &&
      this.target.windowId === target.windowId &&
      this.target.sessionId === target.sessionId &&
      this.target.runId === target.runId &&
      this.target.epoch === target.epoch &&
      this.target.claimSequence === target.claimSequence
    )
  }

  private matchesRef(target: AgentPreviewTargetRef): boolean {
    return (
      this.target?.sessionId === target.sessionId &&
      (target.source == null || this.target.source === target.source) &&
      (target.runId == null || this.target.runId === target.runId)
    )
  }

  private matchesClaim(target: AgentPreviewTarget): boolean {
    const claim = this.claims.get(target.sessionId)
    return (
      claim?.source === target.source &&
      claim.runId === target.runId &&
      claim.sequence === target.claimSequence
    )
  }

  private isDismissed(target: Pick<AgentPreviewTarget, 'sessionId' | 'runId'>): boolean {
    return this.dismissedRuns.get(target.sessionId) === target.runId
  }

  private isHostEligible(host: BrowserWindow): boolean {
    return !host.isDestroyed() && host.isVisible() && host.isFocused() && !host.isMinimized()
  }

  private isPublishedTarget(): boolean {
    const target = `${process.platform}:${process.arch}`
    return (
      target === 'darwin:arm64' ||
      target === 'darwin:x64' ||
      target === 'win32:x64' ||
      target === 'linux:arm64' ||
      target === 'linux:x64'
    )
  }

  private hostId(windowId: number): string {
    return `chat-window:${windowId}`
  }

  private presentationId(target: AgentPreviewTarget): string {
    return `agent-preview:${target.source}:${target.windowId}:${target.sessionId}`
  }

  private nativeSessionId(target: AgentPreviewTarget): string {
    return `agent-preview:${target.source}:${target.sessionId}`
  }

  private normalizeBounds(bounds: Rectangle): Rectangle {
    return {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height))
    }
  }

  private disableNative(reason: string): void {
    this.unavailable = true
    this.logUnavailable(reason)
    this.stopNative()
  }

  private stopNative(): void {
    this.unbindHost()
    this.stopDisplayListeners()

    const overlay = this.overlay
    this.overlay = null
    this.available = false
    this.overlayVisible = null
    this.activeSessionId = null
    this.toolbarSource = null
    this.initialization = null
    if (!overlay) {
      return
    }

    overlay.removeListener('activate', this.handleActivate)
    overlay.removeListener('control', this.handleControl)
    try {
      overlay.stop()
    } catch (error) {
      this.warn('shutdown_failed', error)
    }
  }

  private recordPushDuration(durationMs: number): void {
    if (
      durationMs <= SLOW_PUSH_WARNING_MS ||
      Date.now() - this.lastSlowPushWarningAt < SLOW_PUSH_WARNING_INTERVAL_MS
    ) {
      return
    }
    this.lastSlowPushWarningAt = Date.now()
    logger.warn('[AgentPreviewCoordinator] Slow frame presentation', {
      durationMs: Math.round(durationMs)
    })
  }

  private warnFramePush(error: unknown): void {
    if (Date.now() - this.lastPushFailureWarningAt < SLOW_PUSH_WARNING_INTERVAL_MS) {
      return
    }
    this.lastPushFailureWarningAt = Date.now()
    this.warn('frame_push_failed', error)
  }

  private logUnavailable(reason: string, error?: unknown): void {
    logger.info('[AgentPreviewCoordinator] Native overlay unavailable', {
      platform: process.platform,
      arch: process.arch,
      reason,
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {})
    })
  }

  private warn(reason: string, error: unknown): void {
    logger.warn('[AgentPreviewCoordinator] Native overlay operation failed', {
      reason,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}
