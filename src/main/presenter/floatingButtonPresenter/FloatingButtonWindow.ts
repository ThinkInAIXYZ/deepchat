import { BrowserWindow, screen } from 'electron'
import path from 'path'
import { FloatingButtonConfig, FloatingButtonState } from './types'
import logger from '../../../shared/logger'
import { platform } from '@electron-toolkit/utils'
import windowStateManager from 'electron-window-state'

export class FloatingButtonWindow {
  private window: BrowserWindow | null = null
  private config: FloatingButtonConfig
  private state: FloatingButtonState
  private windowState: any

  constructor(config: FloatingButtonConfig) {
    this.config = config
    this.state = {
      isVisible: false,
      bounds: {
        x: 0,
        y: 0,
        width: config.size.width,
        height: config.size.height
      }
    }

    // 初始化窗口状态管理器
    this.windowState = windowStateManager({
      file: 'floating-button-window-state.json',
      defaultWidth: config.size.width,
      defaultHeight: config.size.height
    })
  }

  /**
   * 创建悬浮窗口
   */
  public async create(): Promise<void> {
    if (this.window) {
      return
    }

    try {
      // 根据环境选择正确的预加载脚本路径
      const isDev = process.env.NODE_ENV === 'development'

      this.window = new BrowserWindow({
        x: this.windowState.x,
        y: this.windowState.y,
        width: this.windowState.width,
        height: this.windowState.height,
        frame: false,
        transparent: platform.isMacOS,
        alwaysOnTop: this.config.alwaysOnTop,
        skipTaskbar: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        closable: false,
        show: false,
        movable: true, // 允许拖拽,
        autoHideMenuBar: true,
        vibrancy: 'under-window',
        visualEffectState: 'followWindow',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, '../preload/floating.mjs'),
          webSecurity: false, // 开发模式下允许跨域
          devTools: isDev, // 开发模式下启用开发者工具
          sandbox: false // 禁用沙盒模式，确保预加载脚本能正常工作
        }
      })
      this.windowState.manage(this.window)
      this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      this.window.setAlwaysOnTop(true, 'floating')
      // 设置窗口透明度
      this.window.setOpacity(this.config.opacity)

      // 加载悬浮按钮页面
      if (isDev) {
        await this.window.loadURL('http://localhost:5173/floating/')
        // 开发模式下可选择性打开开发者工具（暂时禁用，避免影响拖拽）
        this.window.webContents.openDevTools({ mode: 'detach' })
      } else {
        await this.window.loadFile(path.join(__dirname, '../renderer/floating/index.html'))
      }

      // 监听窗口事件
      this.setupWindowEvents()

      logger.info('FloatingButtonWindow created successfully')
    } catch (error) {
      logger.error('Failed to create FloatingButtonWindow:', error)
      throw error
    }
  }

  /**
   * 显示悬浮窗口
   */
  public show(): void {
    if (!this.window) {
      return
    }

    this.window.show()
    this.state.isVisible = true
    logger.debug('FloatingButtonWindow shown')
  }

  /**
   * 隐藏悬浮窗口
   */
  public hide(): void {
    if (!this.window) {
      return
    }

    this.window.hide()
    this.state.isVisible = false
    logger.debug('FloatingButtonWindow hidden')
  }

  /**
   * 销毁悬浮窗口
   */
  public destroy(): void {
    if (this.window) {
      this.window.destroy()
      this.window = null
      this.state.isVisible = false
      logger.debug('FloatingButtonWindow destroyed')
    }
  }

  /**
   * 更新配置
   */
  public updateConfig(config: Partial<FloatingButtonConfig>): void {
    this.config = { ...this.config, ...config }

    if (this.window) {
      // 更新窗口属性
      if (config.size) {
        this.window.setSize(this.config.size.width, this.config.size.height)
        this.state.bounds.width = this.config.size.width
        this.state.bounds.height = this.config.size.height
      }

      if (config.position || config.offset) {
        const position = this.getDefaultPosition()
        this.window.setPosition(position.x, position.y)
        this.state.bounds.x = position.x
        this.state.bounds.y = position.y
      }

      if (config.opacity !== undefined) {
        this.window.setOpacity(this.config.opacity)
      }

      if (config.alwaysOnTop !== undefined) {
        this.window.setAlwaysOnTop(this.config.alwaysOnTop, 'floating')
      }
    }
  }

  /**
   * 获取当前状态
   */
  public getState(): FloatingButtonState {
    return { ...this.state }
  }

  /**
   * 检查窗口是否存在
   */
  public exists(): boolean {
    return this.window !== null && !this.window.isDestroyed()
  }

  public getWindow(): BrowserWindow | null {
    return this.window
  }

  /**
   * 获取默认位置（右下角）
   */
  private getDefaultPosition(): { x: number; y: number } {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { workArea } = primaryDisplay

    return {
      x: workArea.width - this.config.size.width - 20,
      y: workArea.height - this.config.size.height - 20
    }
  }

  /**
   * 设置窗口事件监听
   */
  private setupWindowEvents(): void {
    if (!this.window) {
      return
    }

    // 窗口关闭事件
    this.window.on('closed', () => {
      this.window = null
      this.state.isVisible = false
    })

    // 窗口移动事件
    this.window.on('moved', () => {
      if (this.window) {
        const bounds = this.window.getBounds()
        this.state.bounds.x = bounds.x
        this.state.bounds.y = bounds.y
      }
    })

    // 注意：悬浮按钮点击事件的 IPC 处理器在主进程的 index.ts 中设置
  }
}
