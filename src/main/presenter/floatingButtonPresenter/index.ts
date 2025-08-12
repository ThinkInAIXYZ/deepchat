import { FloatingButtonWindow } from './FloatingButtonWindow'
import { FloatingButtonConfig, FloatingButtonState, DEFAULT_FLOATING_BUTTON_CONFIG } from './types'
import { ConfigPresenter } from '../configPresenter'
import { ipcMain, Menu, app } from 'electron'
import { FLOATING_BUTTON_EVENTS } from '@/events'
import { presenter } from '../index'

export class FloatingButtonPresenter {
  private floatingWindow: FloatingButtonWindow | null = null
  private config: FloatingButtonConfig
  private configPresenter: ConfigPresenter

  constructor(configPresenter: ConfigPresenter) {
    this.configPresenter = configPresenter
    this.config = {
      ...DEFAULT_FLOATING_BUTTON_CONFIG
    }
  }

  /**
   * 初始化悬浮按钮功能
   */
  public async initialize(config?: Partial<FloatingButtonConfig>): Promise<void> {
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

  /**
   * 销毁悬浮按钮功能
   */
  public destroy(): void {
    this.config.enabled = false

    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.CLICKED)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.RIGHT_CLICKED)
    if (this.floatingWindow) {
      this.floatingWindow.destroy()
      this.floatingWindow = null
    }
  }

  /**
   * 启用悬浮按钮
   */
  public async enable(): Promise<void> {
    console.log(
      'FloatingButtonPresenter.enable called, current enabled:',
      this.config.enabled,
      'has window:',
      !!this.floatingWindow
    )

    this.config.enabled = true

    if (this.floatingWindow) {
      console.log('FloatingButton window already exists, showing it')
      this.floatingWindow.show()
      return // 已经存在窗口，只需显示
    }

    console.log('Creating new floating button window')
    await this.createFloatingWindow()
  }

  /**
   * 设置悬浮按钮启用状态
   */
  public async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await this.enable()
    } else {
      this.destroy()
    }
  }

  /**
   * 获取当前配置
   */
  public getConfig(): FloatingButtonConfig {
    return { ...this.config }
  }

  /**
   * 获取当前状态
   */
  public getState(): FloatingButtonState | null {
    return this.floatingWindow?.getState() || null
  }

  /**
   * 创建悬浮窗口
   */
  private async createFloatingWindow(): Promise<void> {
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.CLICKED)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.RIGHT_CLICKED)

    ipcMain.on(FLOATING_BUTTON_EVENTS.CLICKED, async () => {
      try {
        let floatingButtonPosition: { x: number; y: number; width: number; height: number } | null =
          null
        if (this.floatingWindow && this.floatingWindow.exists()) {
          const buttonWindow = this.floatingWindow.getWindow()
          if (buttonWindow && !buttonWindow.isDestroyed()) {
            const bounds = buttonWindow.getBounds()
            floatingButtonPosition = {
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height
            }
          }
        }
        if (floatingButtonPosition) {
          await presenter.windowPresenter.toggleFloatingChatWindow(floatingButtonPosition)
        } else {
          await presenter.windowPresenter.toggleFloatingChatWindow()
        }
      } catch (error) {
        console.error('Failed to handle floating button click:', error)
      }
    })

    ipcMain.on(FLOATING_BUTTON_EVENTS.RIGHT_CLICKED, () => {
      try {
        this.showContextMenu()
      } catch (error) {
        console.error('Failed to handle floating button right click:', error)
      }
    })

    if (!this.floatingWindow) {
      this.floatingWindow = new FloatingButtonWindow(this.config)
      await this.floatingWindow.create()
    }

    // 悬浮按钮创建后立即显示
    this.floatingWindow.show()

    this.preCreateFloatingChatWindow()
  }

  private preCreateFloatingChatWindow(): void {
    try {
      presenter.windowPresenter.createFloatingChatWindow().catch((error) => {
        console.error('Failed to pre-create floating chat window:', error)
      })
      console.log('Started pre-creating floating chat window in background')
    } catch (error) {
      console.error('Error starting pre-creation of floating chat window:', error)
    }
  }

  private showContextMenu(): void {
    const template = [
      {
        label: '打开主窗口',
        click: () => {
          this.openMainWindow()
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

    if (this.floatingWindow && this.floatingWindow.exists()) {
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

  private openMainWindow(): void {
    try {
      const windowPresenter = presenter.windowPresenter
      if (windowPresenter) {
        const mainWindow = windowPresenter.mainWindow
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) {
            mainWindow.restore()
          }
          mainWindow.show()
          mainWindow.focus()
          console.log('Main window opened from floating button context menu')
        } else {
          windowPresenter.createShellWindow({ initialTab: { url: 'local://chat' } })
          console.log('Created new main window from floating button context menu')
        }
      }
    } catch (error) {
      console.error('Failed to open main window from floating button:', error)
    }
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
