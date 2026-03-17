import { BrowserWindow, screen } from 'electron'
import path from 'path'
import { FloatingButtonConfig, FloatingButtonState } from './types'
import logger from '../../../shared/logger'
import {
  FLOATING_WIDGET_LAYOUT,
  inferDockSide,
  type FloatingWidgetDockSide,
  type WidgetRect
} from './layout'
import windowStateManager from 'electron-window-state'

const FLOATING_WIDGET_WINDOW_OPACITY = 1

export class FloatingButtonWindow {
  private window: BrowserWindow | null = null
  private config: FloatingButtonConfig
  private state: FloatingButtonState
  private windowState: ReturnType<typeof windowStateManager>
  private dockSide: FloatingWidgetDockSide

  constructor(config: FloatingButtonConfig) {
    this.config = config
    this.state = {
      isVisible: false,
      bounds: {
        x: 0,
        y: 0,
        width: FLOATING_WIDGET_LAYOUT.collapsedIdle.width,
        height: FLOATING_WIDGET_LAYOUT.collapsedIdle.height
      }
    }
    this.dockSide = config.position.endsWith('left') ? 'left' : 'right'
    this.windowState = windowStateManager({
      file: 'floating-button-window-state.json',
      defaultWidth: FLOATING_WIDGET_LAYOUT.collapsedIdle.width,
      defaultHeight: FLOATING_WIDGET_LAYOUT.collapsedIdle.height
    })
  }

  public async create(): Promise<void> {
    if (this.window) {
      return
    }

    try {
      const isDev = process.env.NODE_ENV === 'development'
      const initialBounds = this.resolveInitialBounds()
      this.dockSide = inferDockSide(
        initialBounds,
        screen.getDisplayMatching(initialBounds).workArea
      )

      this.window = new BrowserWindow({
        x: initialBounds.x,
        y: initialBounds.y,
        width: initialBounds.width,
        height: initialBounds.height,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: this.config.alwaysOnTop,
        skipTaskbar: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        closable: false,
        show: false,
        movable: true,
        hasShadow: false,
        autoHideMenuBar: true,
        roundedCorners: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, '../preload/floating.mjs'),
          webSecurity: false,
          devTools: isDev,
          sandbox: false
        }
      })

      this.windowState.manage(this.window)
      this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      this.window.setAlwaysOnTop(this.config.alwaysOnTop, 'floating')
      this.window.setOpacity(FLOATING_WIDGET_WINDOW_OPACITY)
      this.setBounds(initialBounds)

      if (isDev) {
        await this.window.loadURL('http://localhost:5173/floating/')
      } else {
        await this.window.loadFile(path.join(__dirname, '../renderer/floating/index.html'))
      }

      this.setupWindowEvents()
      logger.info('FloatingButtonWindow created successfully')
    } catch (error) {
      logger.error('Failed to create FloatingButtonWindow:', error)
      throw error
    }
  }

  public show(): void {
    if (!this.window) {
      return
    }

    this.window.show()
    this.state.isVisible = true
    logger.debug('FloatingButtonWindow shown')
  }

  public hide(): void {
    if (!this.window) {
      return
    }

    this.window.hide()
    this.state.isVisible = false
    logger.debug('FloatingButtonWindow hidden')
  }

  public destroy(): void {
    if (this.window) {
      this.window.destroy()
      this.window = null
      this.state.isVisible = false
      logger.debug('FloatingButtonWindow destroyed')
    }
  }

  public updateConfig(config: Partial<FloatingButtonConfig>): void {
    this.config = { ...this.config, ...config }
    if (!this.window) {
      return
    }

    this.window.setOpacity(FLOATING_WIDGET_WINDOW_OPACITY)

    if (config.alwaysOnTop !== undefined) {
      this.window.setAlwaysOnTop(this.config.alwaysOnTop, 'floating')
    }
  }

  public getState(): FloatingButtonState {
    return { ...this.state }
  }

  public exists(): boolean {
    return this.window !== null && !this.window.isDestroyed()
  }

  public getWindow(): BrowserWindow | null {
    return this.window
  }

  public getBounds(): WidgetRect | null {
    if (!this.window || this.window.isDestroyed()) {
      return null
    }
    const bounds = this.window.getBounds()
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    }
  }

  public setBounds(bounds: WidgetRect): void {
    if (!this.window || this.window.isDestroyed()) {
      return
    }

    this.window.setBounds(bounds)
    this.state.bounds = { ...bounds }
  }

  public getDockSide(): FloatingWidgetDockSide {
    return this.dockSide
  }

  public setDockSide(dockSide: FloatingWidgetDockSide): void {
    this.dockSide = dockSide
  }

  private resolveInitialBounds(): WidgetRect {
    const defaultPosition = this.getDefaultPosition()
    const width = FLOATING_WIDGET_LAYOUT.collapsedIdle.width
    const height = FLOATING_WIDGET_LAYOUT.collapsedIdle.height
    const initialX = typeof this.windowState.x === 'number' ? this.windowState.x : defaultPosition.x
    const initialY = typeof this.windowState.y === 'number' ? this.windowState.y : defaultPosition.y
    const targetDisplay = screen.getDisplayNearestPoint({ x: initialX, y: initialY })
    const { workArea } = targetDisplay
    const x = Math.max(workArea.x, Math.min(initialX, workArea.x + workArea.width - width))
    const y = Math.max(workArea.y, Math.min(initialY, workArea.y + workArea.height - height))

    return {
      x,
      y,
      width,
      height
    }
  }

  private getDefaultPosition(): { x: number; y: number } {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { workArea } = primaryDisplay
    const width = FLOATING_WIDGET_LAYOUT.collapsedIdle.width
    const height = FLOATING_WIDGET_LAYOUT.collapsedIdle.height
    const isRight = this.config.position.endsWith('right')
    const isBottom = this.config.position.startsWith('bottom')

    return {
      x: isRight
        ? workArea.x + workArea.width - width - this.config.offset.x
        : workArea.x + this.config.offset.x,
      y: isBottom
        ? workArea.y + workArea.height - height - this.config.offset.y
        : workArea.y + this.config.offset.y
    }
  }

  private setupWindowEvents(): void {
    if (!this.window) {
      return
    }

    this.window.on('closed', () => {
      this.window = null
      this.state.isVisible = false
    })

    this.window.on('moved', () => {
      if (!this.window) {
        return
      }

      const bounds = this.window.getBounds()
      this.state.bounds = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      }
    })
  }
}
