import { BrowserWindow, screen, nativeImage } from 'electron'
import path from 'path'
import logger from '../../../shared/logger'
import { platform, is } from '@electron-toolkit/utils'
import icon from '../../../../resources/icon.png?asset'
import iconWin from '../../../../resources/icon.ico?asset'
import type { TabPresenter } from '../tab'

interface FloatingChatConfig {
  size: {
    width: number
    height: number
  }
  minSize: {
    width: number
    height: number
  }
  opacity: number
  alwaysOnTop: boolean
}

interface FloatingButtonPosition {
  x: number
  y: number
  width: number
  height: number
}

const DEFAULT_FLOATING_CHAT_CONFIG: FloatingChatConfig = {
  size: {
    width: 500,
    height: 600
  },
  minSize: {
    width: 460,
    height: 450
  },
  opacity: 0.95,
  alwaysOnTop: true
}

export class FloatingChatWindow {
  private window: BrowserWindow | null = null
  private config: FloatingChatConfig
  private isVisible: boolean = false

  constructor(
    private readonly tabPresenter: TabPresenter,
    private readonly isApplicationQuitting: () => boolean,
    config?: Partial<FloatingChatConfig>
  ) {
    this.config = {
      ...DEFAULT_FLOATING_CHAT_CONFIG,
      ...config
    }
  }

  public async create(floatingButtonPosition?: FloatingButtonPosition): Promise<void> {
    if (this.window) {
      return
    }

    try {
      const position = this.calculatePosition(floatingButtonPosition)
      const iconFile = nativeImage.createFromPath(process.platform === 'win32' ? iconWin : icon)

      this.window = new BrowserWindow({
        width: this.config.size.width,
        height: this.config.size.height,
        minWidth: this.config.minSize.width,
        minHeight: this.config.minSize.height,
        x: position.x,
        y: position.y,
        frame: false,
        transparent: true,
        alwaysOnTop: this.config.alwaysOnTop,
        skipTaskbar: true,
        resizable: true,
        minimizable: false,
        maximizable: false,
        closable: true,
        show: false,
        movable: true,
        autoHideMenuBar: true,
        icon: iconFile,
        vibrancy: platform.isMacOS ? 'under-window' : undefined,
        visualEffectState: platform.isMacOS ? 'followWindow' : undefined,
        backgroundMaterial: platform.isWindows ? 'mica' : undefined,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, '../preload/index.mjs'),
          webSecurity: false,
          devTools: is.dev,
          sandbox: false
        }
      })

      this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      this.window.setAlwaysOnTop(true, 'floating')
      this.window.setOpacity(this.config.opacity)
      this.setupWindowEvents()
      this.registerWindowContent()

      logger.info('FloatingChatWindow created successfully')

      this.loadPageContent()
        .then(() => logger.info('FloatingChatWindow page content loaded'))
        .catch((error) => logger.error('Failed to load FloatingChatWindow page content:', error))
    } catch (error) {
      logger.error('Failed to create FloatingChatWindow:', error)
      throw error
    }
  }

  public show(floatingButtonPosition?: FloatingButtonPosition): void {
    if (!this.window) {
      return
    }

    if (floatingButtonPosition) {
      const position = this.calculatePosition(floatingButtonPosition)
      this.window.setPosition(position.x, position.y)
    }
    if (!this.window.isVisible()) {
      this.window.show()
      this.window.focus()
    } else {
      this.window.show()
      this.window.focus()
    }
    this.isVisible = true
    logger.debug('FloatingChatWindow shown')
  }

  public hide(): void {
    if (!this.window) {
      return
    }

    this.window.hide()
    this.isVisible = false
    logger.debug('FloatingChatWindow hidden')
  }

  public toggle(floatingButtonPosition?: FloatingButtonPosition): void {
    if (this.isVisible) {
      this.hide()
    } else {
      this.show(floatingButtonPosition)
    }
  }

  public destroy(): void {
    if (this.window) {
      this.unregisterWindowContent()
      try {
        if (!this.window.isDestroyed()) {
          this.window.destroy()
        }
      } catch (error) {
        logger.error('Error destroying FloatingChatWindow:', error)
      }
      this.window = null
      this.isVisible = false
      logger.debug('FloatingChatWindow destroyed')
    }
  }

  public isShowing(): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.isVisible
  }

  public getWindow(): BrowserWindow | null {
    return this.window
  }

  private registerWindowContent(): void {
    if (!this.window || this.window.isDestroyed()) {
      return
    }

    try {
      const webContentsId = this.window.webContents.id
      logger.info(
        `Registering floating window webContents bridge, WebContents ID: ${webContentsId}`
      )
      this.tabPresenter.registerFloatingWindow(webContentsId, this.window.webContents)
    } catch (error) {
      logger.error('Failed to register floating window webContents bridge:', error)
    }
  }

  private unregisterWindowContent(): void {
    if (!this.window) {
      return
    }

    try {
      const webContentsId = this.window.webContents.id
      logger.info(
        `Unregistering floating window webContents bridge, WebContents ID: ${webContentsId}`
      )
      this.tabPresenter.unregisterFloatingWindow(webContentsId)
    } catch (error) {
      logger.error('Failed to unregister floating window webContents bridge:', error)
    }
  }

  private calculatePosition(floatingButtonPosition?: FloatingButtonPosition): {
    x: number
    y: number
  } {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { workArea } = primaryDisplay
    const windowWidth = this.window?.getBounds().width ?? this.config.size.width
    const windowHeight = this.window?.getBounds().height ?? this.config.size.height

    if (!floatingButtonPosition) {
      const x = workArea.x + workArea.width - windowWidth - 20
      const y = workArea.y + workArea.height - windowHeight - 20
      return { x, y }
    }

    const gap = 15
    const buttonBounds = floatingButtonPosition

    let finalX: number

    // 1. Prioritize placing the window on the right side of the button
    const rightPositionX = buttonBounds.x + buttonBounds.width + gap
    if (rightPositionX + windowWidth <= workArea.x + workArea.width) {
      finalX = rightPositionX
    } else {
      // 2. If right side has no space, try the left side
      const leftPositionX = buttonBounds.x - windowWidth - gap
      if (leftPositionX >= workArea.x) {
        finalX = leftPositionX
      } else {
        // 3. Fallback: If both sides lack space, align window's right edge with screen's right edge.
        finalX = workArea.x + workArea.width - windowWidth
      }
    }

    // Calculate vertical position: try to center with the button, but stay within screen bounds.
    const idealY = buttonBounds.y + (buttonBounds.height - windowHeight) / 2
    const finalY = Math.max(
      workArea.y,
      Math.min(idealY, workArea.y + workArea.height - windowHeight)
    )

    return { x: Math.round(finalX), y: Math.round(finalY) }
  }

  private async loadPageContent(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) {
      throw new Error('Window is not available for page loading')
    }

    const rendererUrl = process.env['ELECTRON_RENDERER_URL']

    if (is.dev && rendererUrl) {
      await this.window.loadURL(`${rendererUrl}#/chat`)
    } else {
      await this.window.loadFile(path.join(__dirname, '../renderer/index.html'))
    }
  }

  private setupWindowEvents(): void {
    if (!this.window) {
      return
    }

    this.window.on('close', (event) => {
      if (this.isApplicationQuitting()) {
        logger.info('App is quitting, allowing FloatingChatWindow to close normally')
        return
      }
      event.preventDefault()
      this.hide()
      logger.debug('FloatingChatWindow close prevented, window hidden instead')
    })

    this.window.on('closed', () => {
      this.window = null
      this.isVisible = false
    })

    this.window.on('show', () => {
      this.isVisible = true
    })

    this.window.on('hide', () => {
      this.isVisible = false
    })
  }
}
