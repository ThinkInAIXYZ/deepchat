import { BrowserWindow, screen } from 'electron'
import path from 'path'
import { is } from '@electron-toolkit/utils'
import { FloatingButtonConfig, FloatingButtonState } from './types'
import logger from '../../../shared/logger'
import {
  FLOATING_WIDGET_LAYOUT,
  inferDockSide,
  type FloatingWidgetDockSide,
  type WidgetRect
} from './layout'
import type { FloatingButtonBounds } from '@shared/types/floating-widget'

export class FloatingButtonWindow {
  private window: BrowserWindow | null = null
  private config: FloatingButtonConfig
  private state: FloatingButtonState
  private persistedBounds: FloatingButtonBounds | null
  private dockSide: FloatingWidgetDockSide

  constructor(config: FloatingButtonConfig, persistedBounds: FloatingButtonBounds | null = null) {
    this.config = config
    this.persistedBounds = persistedBounds
    this.state = {
      isVisible: false,
      bounds: {
        x: 0,
        y: 0,
        width: FLOATING_WIDGET_LAYOUT.collapsedIdle.width,
        height: FLOATING_WIDGET_LAYOUT.collapsedIdle.height
      }
    }
    this.dockSide =
      persistedBounds?.dockSide ?? (config.position.endsWith('left') ? 'left' : 'right')
  }

  public async create(): Promise<void> {
    if (this.window) {
      return
    }

    try {
      const rendererUrl = process.env['ELECTRON_RENDERER_URL']
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
          devTools: is.dev,
          sandbox: false
        }
      })

      this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      this.window.setAlwaysOnTop(this.config.alwaysOnTop, 'floating')
      this.window.setOpacity(1)
      this.setBounds(initialBounds)

      if (is.dev && rendererUrl) {
        await this.window.loadURL(`${rendererUrl}/floating/`)
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

    this.window.setOpacity(1)

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

  public setOpacity(opacity: number): void {
    if (!this.window || this.window.isDestroyed()) {
      return
    }

    this.window.setOpacity(opacity)
  }

  public getDockSide(): FloatingWidgetDockSide {
    return this.dockSide
  }

  public setDockSide(dockSide: FloatingWidgetDockSide): void {
    this.dockSide = dockSide
  }

  private resolveInitialBounds(): WidgetRect {
    const width = FLOATING_WIDGET_LAYOUT.collapsedIdle.width
    const height = FLOATING_WIDGET_LAYOUT.collapsedIdle.height

    // Restore the last persisted resting position when available.
    if (this.persistedBounds) {
      const { x: savedX, y: savedY, dockSide } = this.persistedBounds
      const { workArea } = screen.getDisplayNearestPoint({ x: savedX, y: savedY })
      // Re-dock horizontally so the widget stays edge-aligned across resolution changes,
      // and clamp the saved vertical offset into the current work area.
      const x = dockSide === 'left' ? workArea.x : workArea.x + workArea.width - width
      const y = Math.max(workArea.y, Math.min(savedY, workArea.y + workArea.height - height))

      return {
        x: Math.round(x),
        y: Math.round(y),
        width,
        height
      }
    }

    // First run / no saved position: fall back to the configured default placement.
    const defaultPosition = this.getDefaultPosition()
    const { workArea } = screen.getDisplayNearestPoint(defaultPosition)
    const x = Math.max(workArea.x, Math.min(defaultPosition.x, workArea.x + workArea.width - width))
    const y = Math.max(
      workArea.y,
      Math.min(defaultPosition.y, workArea.y + workArea.height - height)
    )

    return {
      x: Math.round(x),
      y: Math.round(y),
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
