import { FloatingButtonWindow } from './FloatingButtonWindow'
import { FloatingButtonConfig, FloatingButtonState, DEFAULT_FLOATING_BUTTON_CONFIG } from './types'
import { ipcMain, Menu, app, screen } from 'electron'
import { FLOATING_BUTTON_EVENTS } from '@/events'
import { presenter } from '../index'
import { IConfigPresenter } from '@shared/presenter'

export class FloatingButtonPresenter {
  private floatingWindow: FloatingButtonWindow | null = null
  private config: FloatingButtonConfig
  private configPresenter: IConfigPresenter

  constructor(configPresenter: IConfigPresenter) {
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

    const floatingChatWindow = presenter.windowPresenter.getFloatingChatWindow()
    if (floatingChatWindow?.isShowing()) {
      floatingChatWindow.hide()
      console.log('FloatingChatWindow closed when disabling floating button')
    }

    // 清理所有事件监听器
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.CLICKED)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.RIGHT_CLICKED)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.DRAG_START)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.DRAG_MOVE)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.DRAG_END)

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
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.DRAG_START)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.DRAG_MOVE)
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.DRAG_END)

    let isDuringDragSession = false

    // 处理点击事件
    ipcMain.on(FLOATING_BUTTON_EVENTS.CLICKED, async () => {
      if (isDuringDragSession) {
        return
      }
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

    // 处理拖拽事件
    let wasFloatingChatVisibleBeforeDrag = false // 记录拖拽前浮窗是否可见
    let dragState: {
      isDragging: boolean
      startX: number
      startY: number
      windowX: number
      windowY: number
    } | null = null

    ipcMain.on(FLOATING_BUTTON_EVENTS.DRAG_START, (_event, { x, y }: { x: number; y: number }) => {
      isDuringDragSession = true
      try {
        if (this.floatingWindow && this.floatingWindow.exists()) {
          const buttonWindow = this.floatingWindow.getWindow()
          if (buttonWindow && !buttonWindow.isDestroyed()) {
            const bounds = buttonWindow.getBounds()

            // 检查浮窗是否可见，如果可见则隐藏
            const floatingChatWindow = presenter.windowPresenter.getFloatingChatWindow()
            wasFloatingChatVisibleBeforeDrag = floatingChatWindow?.isShowing() || false

            if (wasFloatingChatVisibleBeforeDrag) {
              floatingChatWindow?.hide()
              console.log('FloatingChatWindow hidden during drag start')
            }

            dragState = {
              isDragging: true,
              startX: x,
              startY: y,
              windowX: bounds.x,
              windowY: bounds.y
            }
          }
        }
      } catch (error) {
        console.error('Failed to handle drag start:', error)
      }
    })

    ipcMain.on(FLOATING_BUTTON_EVENTS.DRAG_MOVE, (_event, { x, y }: { x: number; y: number }) => {
      try {
        if (
          dragState &&
          dragState.isDragging &&
          this.floatingWindow &&
          this.floatingWindow.exists()
        ) {
          const buttonWindow = this.floatingWindow.getWindow()
          if (buttonWindow && !buttonWindow.isDestroyed()) {
            const deltaX = x - dragState.startX
            const deltaY = y - dragState.startY
            const newX = dragState.windowX + deltaX
            const newY = dragState.windowY + deltaY

            buttonWindow.setBounds({
              x: newX,
              y: newY,
              width: this.config.size.width,
              height: this.config.size.height
            })
          }
        }
      } catch (error) {
        console.error('Failed to handle drag move:', error)
      }
    })

    ipcMain.on(FLOATING_BUTTON_EVENTS.DRAG_END, (_event, _data: { x: number; y: number }) => {
      try {
        if (
          dragState &&
          dragState.isDragging &&
          this.floatingWindow &&
          this.floatingWindow.exists()
        ) {
          const buttonWindow = this.floatingWindow.getWindow()
          if (buttonWindow && !buttonWindow.isDestroyed()) {
            // 多显示器边界检查
            const bounds = buttonWindow.getBounds()
            const currentDisplay = screen.getDisplayMatching(bounds)
            const { workArea } = currentDisplay

            // 确保悬浮球完全在当前显示器的工作区内
            const targetX = Math.max(
              workArea.x,
              Math.min(bounds.x, workArea.x + workArea.width - bounds.width)
            )
            const targetY = Math.max(
              workArea.y,
              Math.min(bounds.y, workArea.y + workArea.height - bounds.height)
            )

            // 只有在越界时才调整位置
            if (targetX !== bounds.x || targetY !== bounds.y) {
              buttonWindow.setPosition(targetX, targetY)
            }
          }
        }

        // 如果拖拽前浮窗是可见的，拖拽结束后重新显示
        if (wasFloatingChatVisibleBeforeDrag) {
          const floatingChatWindow = presenter.windowPresenter.getFloatingChatWindow()
          if (floatingChatWindow) {
            // 获取悬浮球当前位置，用于计算浮窗显示位置
            let floatingButtonPosition:
              | { x: number; y: number; width: number; height: number }
              | undefined = undefined
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

            floatingChatWindow.show(floatingButtonPosition)
            console.log('FloatingChatWindow shown after drag end')
          }
        }

        // 重置拖拽状态
        dragState = null
        wasFloatingChatVisibleBeforeDrag = false
      } catch (error) {
        console.error('Failed to handle drag end:', error)
      } finally {
        isDuringDragSession = false
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
      app.quit() // Exit trigger: floating menu
    } catch (error) {
      console.error('Failed to exit application from floating button:', error)
    }
  }
}
