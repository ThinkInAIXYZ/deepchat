import { FloatingButtonWindow } from './FloatingButtonWindow'
import { FloatingButtonConfig, FloatingButtonState, DEFAULT_FLOATING_BUTTON_CONFIG } from './types'
import {
  buildFloatingWidgetSnapshot,
  getPeekedCollapsedBounds,
  getWidgetSizeForSnapshot,
  repositionWidgetForResize,
  snapWidgetBoundsToEdge,
  type WidgetRect
} from './layout'
import type { FloatingWidgetSnapshot } from '@shared/types/floating-widget'
import type { SessionWithState } from '@shared/types/agent-interface'
import { BrowserWindow, ipcMain, Menu, app, screen } from 'electron'
import { FLOATING_BUTTON_EVENTS } from '@/events'
import { presenter } from '../index'
import { IConfigPresenter } from '@shared/presenter'
import { FLOATING_BUTTON_AVAILABLE } from '@shared/featureFlags'

const EMPTY_SNAPSHOT: FloatingWidgetSnapshot = {
  expanded: false,
  activeCount: 0,
  sessions: []
}

const WIDGET_LAYOUT_ANIMATION_DURATION_MS = 360
const WIDGET_LAYOUT_ANIMATION_INTERVAL_MS = 16
const COLLAPSE_REVEAL_LOCK_MS = WIDGET_LAYOUT_ANIMATION_DURATION_MS + 120
const COLLAPSED_WIDGET_INACTIVE_OPACITY = 0.5
const ACTIVE_WIDGET_OPACITY = 1

type DragRuntimeState = {
  startX: number
  startY: number
  windowX: number
  windowY: number
  windowWidth: number
  windowHeight: number
}

export class FloatingButtonPresenter {
  private floatingWindow: FloatingButtonWindow | null = null
  private config: FloatingButtonConfig
  private configPresenter: IConfigPresenter
  private snapshot: FloatingWidgetSnapshot = { ...EMPTY_SNAPSHOT }
  private layoutAnimationTimer: ReturnType<typeof setInterval> | null = null
  private collapseRevealTimer: ReturnType<typeof setTimeout> | null = null
  private isDragging = false
  private isHovered = false
  private collapseRevealLock = false
  private pendingLayoutSync = false

  constructor(configPresenter: IConfigPresenter) {
    this.configPresenter = configPresenter
    this.config = {
      ...DEFAULT_FLOATING_BUTTON_CONFIG
    }
  }

  public async initialize(config?: Partial<FloatingButtonConfig>): Promise<void> {
    if (!FLOATING_BUTTON_AVAILABLE) {
      this.destroy()
      console.log('FloatingButton is temporarily unavailable, skipping initialization')
      return
    }

    const floatingButtonEnabled = this.configPresenter.getFloatingButtonEnabled()
    try {
      this.config = {
        ...this.config,
        ...config,
        enabled: floatingButtonEnabled
      }

      if (!this.config.enabled) {
        console.log('FloatingButton is disabled, skipping window creation')
        return
      }

      await this.createFloatingWindow()
    } catch (error) {
      console.error('Failed to initialize FloatingButtonPresenter:', error)
      throw error
    }
  }

  public destroy(): void {
    this.config.enabled = false
    this.snapshot = { ...EMPTY_SNAPSHOT }
    this.isDragging = false
    this.isHovered = false
    this.clearCollapseRevealLock()
    this.pendingLayoutSync = false
    this.stopLayoutAnimation()

    ipcMain.removeHandler(FLOATING_BUTTON_EVENTS.SNAPSHOT_REQUEST)
    ipcMain.removeHandler(FLOATING_BUTTON_EVENTS.LANGUAGE_REQUEST)
    ipcMain.removeHandler(FLOATING_BUTTON_EVENTS.THEME_REQUEST)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.CLICKED)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.RIGHT_CLICKED)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.HOVER_STATE_CHANGED)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.TOGGLE_EXPANDED)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.SET_EXPANDED)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.OPEN_SESSION)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.DRAG_START)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.DRAG_MOVE)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.DRAG_END)

    if (this.floatingWindow) {
      this.floatingWindow.destroy()
      this.floatingWindow = null
    }
  }

  public async enable(): Promise<void> {
    if (!FLOATING_BUTTON_AVAILABLE) {
      this.destroy()
      console.log('FloatingButton is temporarily unavailable, skipping enable')
      return
    }

    this.config.enabled = true

    if (this.floatingWindow) {
      await this.refreshWidgetState()
      this.refreshLanguage()
      await this.refreshTheme()
      this.floatingWindow.show()
      return
    }

    await this.createFloatingWindow()
  }

  public async setEnabled(enabled: boolean): Promise<void> {
    if (!FLOATING_BUTTON_AVAILABLE) {
      this.destroy()
      return
    }

    if (enabled) {
      await this.enable()
    } else {
      this.destroy()
    }
  }

  public getConfig(): FloatingButtonConfig {
    return { ...this.config }
  }

  public getState(): FloatingButtonState | null {
    return this.floatingWindow?.getState() || null
  }

  public async refreshWidgetState(): Promise<void> {
    try {
      const sessions = await this.loadSessions()
      this.snapshot = buildFloatingWidgetSnapshot(sessions, this.snapshot.expanded)
      this.applyWindowLayout()
      this.pushSnapshotToRenderer()
    } catch (error) {
      console.error('Failed to refresh floating widget state:', error)
    }
  }

  public refreshLanguage(): void {
    if (!this.floatingWindow?.exists()) {
      return
    }

    const buttonWindow = this.floatingWindow.getWindow()
    if (!buttonWindow || buttonWindow.isDestroyed()) {
      return
    }

    buttonWindow.webContents.send(
      FLOATING_BUTTON_EVENTS.LANGUAGE_CHANGED,
      this.configPresenter.getLanguage()
    )
  }

  public async refreshTheme(): Promise<void> {
    if (!this.floatingWindow?.exists()) {
      return
    }

    const buttonWindow = this.floatingWindow.getWindow()
    if (!buttonWindow || buttonWindow.isDestroyed()) {
      return
    }

    buttonWindow.webContents.send(FLOATING_BUTTON_EVENTS.THEME_CHANGED, await this.resolveTheme())
  }

  private async createFloatingWindow(): Promise<void> {
    this.registerIpcHandlers()

    if (!this.floatingWindow) {
      this.floatingWindow = new FloatingButtonWindow(this.config)
      await this.floatingWindow.create()
    }

    await this.refreshWidgetState()
    this.refreshLanguage()
    await this.refreshTheme()
    this.floatingWindow.show()
  }

  private registerIpcHandlers(): void {
    ipcMain.removeHandler(FLOATING_BUTTON_EVENTS.SNAPSHOT_REQUEST)
    ipcMain.removeHandler(FLOATING_BUTTON_EVENTS.LANGUAGE_REQUEST)
    ipcMain.removeHandler(FLOATING_BUTTON_EVENTS.THEME_REQUEST)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.CLICKED)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.RIGHT_CLICKED)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.HOVER_STATE_CHANGED)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.TOGGLE_EXPANDED)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.SET_EXPANDED)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.OPEN_SESSION)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.DRAG_START)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.DRAG_MOVE)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.DRAG_END)

    let dragState: DragRuntimeState | null = null

    ipcMain.handle(FLOATING_BUTTON_EVENTS.SNAPSHOT_REQUEST, async () => {
      if (this.snapshot.sessions.length === 0 && !this.snapshot.expanded) {
        await this.refreshWidgetState()
      }
      return this.snapshot
    })

    ipcMain.handle(FLOATING_BUTTON_EVENTS.LANGUAGE_REQUEST, async () => {
      return this.configPresenter.getLanguage()
    })

    ipcMain.handle(FLOATING_BUTTON_EVENTS.THEME_REQUEST, async () => {
      return await this.resolveTheme()
    })

    ipcMain.on(FLOATING_BUTTON_EVENTS.CLICKED, () => {
      this.toggleExpanded()
    })

    ipcMain.on(FLOATING_BUTTON_EVENTS.RIGHT_CLICKED, () => {
      this.showContextMenu()
    })

    ipcMain.on(FLOATING_BUTTON_EVENTS.HOVER_STATE_CHANGED, (_event, hovering: boolean) => {
      this.setHovering(Boolean(hovering))
    })

    ipcMain.on(FLOATING_BUTTON_EVENTS.TOGGLE_EXPANDED, () => {
      this.toggleExpanded()
    })

    ipcMain.on(FLOATING_BUTTON_EVENTS.SET_EXPANDED, (_event, expanded: boolean) => {
      this.setExpanded(Boolean(expanded))
    })

    ipcMain.on(FLOATING_BUTTON_EVENTS.OPEN_SESSION, (_event, sessionId: string) => {
      void this.openSession(sessionId)
    })

    ipcMain.on(FLOATING_BUTTON_EVENTS.DRAG_START, (_event, { x, y }: { x: number; y: number }) => {
      if (!this.floatingWindow?.exists()) {
        return
      }

      const bounds = this.floatingWindow.getBounds()
      if (!bounds) {
        return
      }

      this.stopLayoutAnimation()
      this.clearCollapseRevealLock()
      this.isDragging = true
      const stableBounds = this.getSnapshotBounds(bounds)
      this.floatingWindow.setBounds(stableBounds)
      this.floatingWindow.setOpacity(this.resolveWindowOpacity())

      dragState = {
        startX: x,
        startY: y,
        windowX: stableBounds.x,
        windowY: stableBounds.y,
        windowWidth: stableBounds.width,
        windowHeight: stableBounds.height
      }
    })

    ipcMain.on(FLOATING_BUTTON_EVENTS.DRAG_MOVE, (_event, { x, y }: { x: number; y: number }) => {
      if (!dragState || !this.floatingWindow?.exists()) {
        return
      }

      const deltaX = x - dragState.startX
      const deltaY = y - dragState.startY

      this.floatingWindow.setBounds({
        x: dragState.windowX + deltaX,
        y: dragState.windowY + deltaY,
        width: dragState.windowWidth,
        height: dragState.windowHeight
      })
    })

    ipcMain.on(FLOATING_BUTTON_EVENTS.DRAG_END, () => {
      if (!dragState || !this.floatingWindow?.exists()) {
        this.isDragging = false
        dragState = null
        return
      }

      const bounds = this.floatingWindow.getBounds()
      if (!bounds) {
        this.isDragging = false
        dragState = null
        return
      }

      const stableBounds = {
        x: bounds.x,
        y: bounds.y,
        width: dragState.windowWidth,
        height: dragState.windowHeight
      }
      const currentDisplay = screen.getDisplayMatching(stableBounds)
      const snapped = snapWidgetBoundsToEdge(stableBounds, currentDisplay.workArea)
      this.floatingWindow.setDockSide(snapped.dockSide)
      this.floatingWindow.setBounds(snapped)
      this.isDragging = false
      dragState = null
      this.floatingWindow.setOpacity(this.resolveWindowOpacity())
      const hadPendingLayoutSync = this.pendingLayoutSync
      this.flushPendingLayoutSync()
      if (!hadPendingLayoutSync) {
        this.applyWindowLayout()
      }
    })
  }

  private setExpanded(expanded: boolean): void {
    if (this.snapshot.expanded === expanded) {
      return
    }

    const wasExpanded = this.snapshot.expanded
    if (expanded) {
      this.clearCollapseRevealLock()
    }

    this.snapshot = {
      ...this.snapshot,
      expanded
    }

    if (wasExpanded && !expanded) {
      this.engageCollapseRevealLock()
    }

    this.applyWindowLayout(true)
    this.pushSnapshotToRenderer()
  }

  private toggleExpanded(): void {
    this.setExpanded(!this.snapshot.expanded)
  }

  private setHovering(hovering: boolean): void {
    if (this.isHovered === hovering) {
      return
    }

    this.isHovered = hovering

    if (!this.snapshot.expanded && this.collapseRevealLock) {
      return
    }

    this.applyWindowLayout(true)
  }

  private applyWindowLayout(animate = false): void {
    if (!this.floatingWindow?.exists()) {
      return
    }

    if (this.isDragging) {
      this.pendingLayoutSync = true
      return
    }

    const bounds = this.floatingWindow.getBounds()
    if (!bounds) {
      return
    }

    const nextBounds = this.getSnapshotBounds(bounds)
    this.floatingWindow.setOpacity(this.resolveWindowOpacity())

    if (!animate || this.areBoundsEqual(bounds, nextBounds)) {
      this.stopLayoutAnimation()
      this.floatingWindow.setBounds(nextBounds)
      return
    }

    this.animateWindowBounds(bounds, nextBounds)
  }

  private pushSnapshotToRenderer(): void {
    if (!this.floatingWindow?.exists()) {
      return
    }

    const buttonWindow = this.floatingWindow.getWindow()
    if (!buttonWindow || buttonWindow.isDestroyed()) {
      return
    }

    buttonWindow.webContents.send(FLOATING_BUTTON_EVENTS.SNAPSHOT_UPDATED, this.snapshot)
  }

  private animateWindowBounds(fromBounds: WidgetRect, toBounds: WidgetRect): void {
    this.stopLayoutAnimation()

    const startedAt = Date.now()
    this.layoutAnimationTimer = setInterval(() => {
      if (!this.floatingWindow?.exists()) {
        this.stopLayoutAnimation()
        return
      }

      const elapsed = Date.now() - startedAt
      const progress = Math.min(1, elapsed / WIDGET_LAYOUT_ANIMATION_DURATION_MS)
      const easedProgress = this.easeInOutCubic(progress)
      const nextBounds: WidgetRect = {
        x: Math.round(fromBounds.x + (toBounds.x - fromBounds.x) * easedProgress),
        y: Math.round(fromBounds.y + (toBounds.y - fromBounds.y) * easedProgress),
        width: Math.round(fromBounds.width + (toBounds.width - fromBounds.width) * easedProgress),
        height: Math.round(
          fromBounds.height + (toBounds.height - fromBounds.height) * easedProgress
        )
      }

      this.floatingWindow.setBounds(nextBounds)

      if (progress >= 1) {
        this.stopLayoutAnimation()
        this.floatingWindow?.setBounds(toBounds)
      }
    }, WIDGET_LAYOUT_ANIMATION_INTERVAL_MS)
  }

  private stopLayoutAnimation(): void {
    if (this.layoutAnimationTimer) {
      clearInterval(this.layoutAnimationTimer)
      this.layoutAnimationTimer = null
    }
  }

  private clearCollapseRevealLock(): void {
    this.collapseRevealLock = false

    if (this.collapseRevealTimer) {
      clearTimeout(this.collapseRevealTimer)
      this.collapseRevealTimer = null
    }
  }

  private engageCollapseRevealLock(): void {
    this.collapseRevealLock = true

    if (this.collapseRevealTimer) {
      clearTimeout(this.collapseRevealTimer)
    }

    this.collapseRevealTimer = setTimeout(() => {
      this.collapseRevealTimer = null
      this.collapseRevealLock = false
      this.applyWindowLayout(true)
    }, COLLAPSE_REVEAL_LOCK_MS)
  }

  private flushPendingLayoutSync(): void {
    if (!this.pendingLayoutSync) {
      return
    }

    this.pendingLayoutSync = false
    this.applyWindowLayout()
  }

  private getSnapshotBounds(bounds: WidgetRect): WidgetRect {
    if (!this.floatingWindow) {
      return bounds
    }

    const currentDisplay = screen.getDisplayMatching(bounds)
    const resizedBounds = repositionWidgetForResize(
      bounds,
      getWidgetSizeForSnapshot(this.snapshot),
      currentDisplay.workArea,
      this.floatingWindow.getDockSide()
    )

    if (!this.snapshot.expanded && !this.shouldRevealCollapsedWidget()) {
      return getPeekedCollapsedBounds(
        resizedBounds,
        currentDisplay.workArea,
        this.floatingWindow.getDockSide()
      )
    }

    return resizedBounds
  }

  private shouldRevealCollapsedWidget(): boolean {
    return this.snapshot.expanded || this.isHovered || this.isDragging || this.collapseRevealLock
  }

  private resolveWindowOpacity(): number {
    return this.shouldRevealCollapsedWidget()
      ? ACTIVE_WIDGET_OPACITY
      : COLLAPSED_WIDGET_INACTIVE_OPACITY
  }

  private easeInOutCubic(progress: number): number {
    return progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2
  }

  private areBoundsEqual(left: WidgetRect, right: WidgetRect): boolean {
    return (
      left.x === right.x &&
      left.y === right.y &&
      left.width === right.width &&
      left.height === right.height
    )
  }

  private async resolveTheme(): Promise<'dark' | 'light'> {
    const isDark = await this.configPresenter.getCurrentThemeIsDark()
    return isDark ? 'dark' : 'light'
  }

  private async loadSessions(): Promise<SessionWithState[]> {
    const agentSessionPresenter = presenter.agentSessionPresenter as
      | {
          getSessionList?: (filters?: { agentId?: string }) => Promise<SessionWithState[]>
        }
      | undefined

    if (!agentSessionPresenter?.getSessionList) {
      return []
    }

    return await agentSessionPresenter.getSessionList()
  }

  private async openSession(sessionId: string): Promise<void> {
    try {
      const agentSessionPresenter = presenter.agentSessionPresenter as
        | {
            activateSession?: (webContentsId: number, sessionId: string) => Promise<void>
          }
        | undefined

      if (!agentSessionPresenter?.activateSession) {
        return
      }

      const targetWindow = await this.resolveChatWindow()
      if (!targetWindow || targetWindow.isDestroyed()) {
        return
      }

      await agentSessionPresenter.activateSession(targetWindow.webContents.id, sessionId)
      presenter.windowPresenter.show(targetWindow.id, true)
      this.setExpanded(false)
    } catch (error) {
      console.error('Failed to open session from floating widget:', error)
    }
  }

  private async resolveChatWindow(): Promise<BrowserWindow | null> {
    const windowPresenter = presenter.windowPresenter
    const tabPresenter = presenter.tabPresenter as unknown as {
      getWindowType: (windowId: number) => 'chat' | 'browser'
    }
    const allChatWindows = windowPresenter
      .getAllWindows()
      .filter((window) => tabPresenter.getWindowType(window.id) === 'chat')

    const focusedWindow = windowPresenter.getFocusedWindow()
    if (
      focusedWindow &&
      !focusedWindow.isDestroyed() &&
      allChatWindows.some((window) => window.id === focusedWindow.id)
    ) {
      return focusedWindow
    }

    if (allChatWindows.length > 0) {
      return allChatWindows[0]
    }

    const createdWindowId = await windowPresenter.createAppWindow({ initialRoute: 'chat' })
    if (!createdWindowId) {
      return null
    }

    const managedWindowPresenter = windowPresenter as typeof windowPresenter & {
      windows: Map<number, BrowserWindow>
    }

    return managedWindowPresenter.windows.get(createdWindowId) ?? null
  }

  private showContextMenu(): void {
    const template = [
      {
        label: '打开主窗口',
        click: () => {
          void this.openMainWindow()
        }
      },
      {
        type: 'separator' as const
      },
      {
        label: '退出应用',
        click: () => {
          this.exitApplication()
        }
      }
    ]

    const contextMenu = Menu.buildFromTemplate(template)

    if (this.floatingWindow?.exists()) {
      const buttonWindow = this.floatingWindow.getWindow()
      if (buttonWindow && !buttonWindow.isDestroyed()) {
        contextMenu.popup({ window: buttonWindow })
        return
      }
    }

    const mainWindow = presenter.windowPresenter.mainWindow
    if (mainWindow) {
      contextMenu.popup({ window: mainWindow })
    } else {
      contextMenu.popup()
    }
  }

  private async openMainWindow(): Promise<void> {
    const targetWindow = await this.resolveChatWindow()
    if (!targetWindow || targetWindow.isDestroyed()) {
      return
    }

    presenter.windowPresenter.show(targetWindow.id, true)
  }

  private exitApplication(): void {
    try {
      console.log('Exiting application from floating button context menu')
      app.quit()
    } catch (error) {
      console.error('Failed to exit application from floating button:', error)
    }
  }
}
