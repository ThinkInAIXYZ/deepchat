import { BrowserWindow, screen, nativeImage } from 'electron'
import path from 'path'
import logger from '../../../shared/logger'
import { platform, is } from '@electron-toolkit/utils'
import icon from '../../../../resources/icon.png?asset'
import iconWin from '../../../../resources/icon.ico?asset'
import { eventBus } from '../../eventbus'
import { TAB_EVENTS } from '../../events'
import { presenter } from '../'

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
    width: 400,
    height: 600
  },
  minSize: {
    width: 350,
    height: 450
  },
  opacity: 0.95,
  alwaysOnTop: true
}

export class FloatingChatWindow {
  private window: BrowserWindow | null = null
  private config: FloatingChatConfig
  private isVisible: boolean = false
  private shouldShowWhenReady: boolean = false

  constructor(config?: Partial<FloatingChatConfig>) {
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
      const isDev = is.dev

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
          devTools: isDev,
          sandbox: false
        }
      })

      this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      this.window.setAlwaysOnTop(true, 'floating')
      this.window.setOpacity(this.config.opacity)
      this.setupWindowEvents()
      this.registerVirtualTab()

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
      if (this.window.webContents.isLoading() === false) {
        this.window.show()
        this.window.focus()
        this.refreshWindowData()
      } else {
        this.window.show()
        this.window.focus()
        this.shouldShowWhenReady = true
        this.window.webContents.once('did-finish-load', () => {
          if (this.shouldShowWhenReady) {
            this.refreshWindowData()
            this.shouldShowWhenReady = false
          }
        })
      }
    } else {
      this.window.show()
      this.window.focus()
      this.refreshWindowData()
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
      this.unregisterVirtualTab()
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

  private refreshWindowData(): void {
    if (this.window && !this.window.isDestroyed()) {
      logger.debug('Refreshing floating window data')
      setTimeout(() => {
        if (this.window && !this.window.isDestroyed()) {
          eventBus.sendToMain(TAB_EVENTS.RENDERER_TAB_READY, this.window.webContents.id)
        }
      }, 100)
    }
  }

  private registerVirtualTab(): void {
    if (!this.window || this.window.isDestroyed()) {
      return
    }

    try {
      const tabPresenter = presenter.tabPresenter
      if (tabPresenter) {
        const webContentsId = this.window.webContents.id
        logger.info(`Registering virtual tab for floating window, WebContents ID: ${webContentsId}`)
        tabPresenter.registerFloatingWindow(webContentsId, this.window.webContents)
      }
    } catch (error) {
      logger.error('Failed to register virtual tab for floating window:', error)
    }
  }

  private unregisterVirtualTab(): void {
    if (!this.window) {
      return
    }

    try {
      const tabPresenter = presenter.tabPresenter
      if (tabPresenter) {
        const webContentsId = this.window.webContents.id
        logger.info(
          `Unregistering virtual tab for floating window, WebContents ID: ${webContentsId}`
        )
        tabPresenter.unregisterFloatingWindow(webContentsId)
      }
    } catch (error) {
      logger.error('Failed to unregister virtual tab for floating window:', error)
    }
  }
  private calculatePosition(floatingButtonPosition?: FloatingButtonPosition): {
    x: number
    y: number
  } {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { workArea } = primaryDisplay
    let x: number, y: number

    if (!floatingButtonPosition) {
      x = workArea.x + workArea.width - this.config.size.width - 20
      y = workArea.y + workArea.height - this.config.size.height - 20
      return { x, y }
    }

    const buttonX = floatingButtonPosition.x
    const buttonY = floatingButtonPosition.y
    const buttonWidth = floatingButtonPosition.width
    const buttonHeight = floatingButtonPosition.height
    const windowWidth = this.config.size.width
    const windowHeight = this.config.size.height
    const gap = 15
    const buttonCenterX = buttonX + buttonWidth / 2
    const buttonCenterY = buttonY + buttonHeight / 2
    const screenCenterX = workArea.x + workArea.width / 2
    const screenCenterY = workArea.y + workArea.height / 2

    let positions: Array<{ x: number; y: number; priority: number }> = []
    if (buttonX + buttonWidth + gap + windowWidth <= workArea.x + workArea.width) {
      positions.push({
        x: buttonX + buttonWidth + gap,
        y: Math.max(
          workArea.y,
          Math.min(
            buttonY + (buttonHeight - windowHeight) / 2,
            workArea.y + workArea.height - windowHeight
          )
        ),
        priority: buttonCenterX < screenCenterX ? 1 : 3
      })
    }

    if (buttonX - gap - windowWidth >= workArea.x) {
      positions.push({
        x: buttonX - gap - windowWidth,
        y: Math.max(
          workArea.y,
          Math.min(
            buttonY + (buttonHeight - windowHeight) / 2,
            workArea.y + workArea.height - windowHeight
          )
        ),
        priority: buttonCenterX >= screenCenterX ? 1 : 3
      })
    }

    if (buttonY + buttonHeight + gap + windowHeight <= workArea.y + workArea.height) {
      positions.push({
        x: Math.max(
          workArea.x,
          Math.min(
            buttonX + (buttonWidth - windowWidth) / 2,
            workArea.x + workArea.width - windowWidth
          )
        ),
        y: buttonY + buttonHeight + gap,
        priority: buttonCenterY < screenCenterY ? 2 : 4
      })
    }

    if (buttonY - gap - windowHeight >= workArea.y) {
      positions.push({
        x: Math.max(
          workArea.x,
          Math.min(
            buttonX + (buttonWidth - windowWidth) / 2,
            workArea.x + workArea.width - windowWidth
          )
        ),
        y: buttonY - gap - windowHeight,
        priority: buttonCenterY >= screenCenterY ? 2 : 4
      })
    }

    if (positions.length === 0) {
      x = workArea.x + workArea.width - windowWidth - 20
      y = workArea.y + workArea.height - windowHeight - 20
    } else {
      positions.sort((a, b) => a.priority - b.priority)
      x = positions[0].x
      y = positions[0].y
    }
    x = Math.max(workArea.x + 10, Math.min(x, workArea.x + workArea.width - windowWidth - 10))
    y = Math.max(workArea.y + 10, Math.min(y, workArea.y + workArea.height - windowHeight - 10))
    return { x, y }
  }

  private async loadPageContent(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) {
      throw new Error('Window is not available for page loading')
    }

    const isDev = is.dev
    if (isDev) {
      await this.window.loadURL('http://localhost:5173/')
    } else {
      await this.window.loadFile(path.join(__dirname, '../renderer/index.html'))
    }

    this.window.webContents.once('did-finish-load', () => {
      logger.info('FloatingChatWindow did-finish-load, requesting fresh data')
      setTimeout(async () => {
        if (this.window && !this.window.isDestroyed()) {
          logger.info(`Broadcasting thread list update for floating window`)
          eventBus.sendToMain(TAB_EVENTS.RENDERER_TAB_READY, this.window.webContents.id)
        }
      }, 300)
    })
  }

  private setupWindowEvents(): void {
    if (!this.window) {
      return
    }

    this.window.on('ready-to-show', () => {
      if (this.window && !this.window.isDestroyed()) {
        if (this.shouldShowWhenReady) {
          this.window.show()
          this.window.focus()
          this.shouldShowWhenReady = false
          this.refreshWindowData()
        }
      }
    })

    this.window.on('close', (event) => {
      const windowPresenter = presenter.windowPresenter
      const isAppQuitting = windowPresenter?.isApplicationQuitting() || false
      if (isAppQuitting) {
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
