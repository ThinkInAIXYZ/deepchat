// src\main\presenter\windowPresenter\index.ts
import { BrowserWindow, shell, nativeImage, ipcMain, screen } from 'electron'
import { join } from 'path'
import icon from '../../../../resources/icon.png?asset' // App icon (macOS/Linux)
import iconWin from '../../../../resources/icon.ico?asset' // App icon (Windows)
import { is } from '@electron-toolkit/utils' // Electron utilities
import { IConfigPresenter, IWindowPresenter } from '@shared/presenter' // Window Presenter interface
import { eventBus } from '@/eventbus' // Event bus
import { CONFIG_EVENTS, SYSTEM_EVENTS, WINDOW_EVENTS } from '@/events' // System/Window/Config event constants
import { presenter } from '../' // Global presenter registry
import windowStateManager from 'electron-window-state' // Window state manager
import { SHORTCUT_EVENTS } from '@/events' // Shortcut event constants
// TrayPresenter is globally managed in main/index.ts, this Presenter is not responsible for its lifecycle
import { TabPresenter } from '../tabPresenter' // TabPresenter type
import { FloatingChatWindow } from './FloatingChatWindow' // Floating chat window

/**
 * Window Presenter, responsible for managing all BrowserWindow instances and their lifecycles.
 * Including creation, destruction, minimization, maximization, hiding, showing, focus management, and interaction with tabs.
 */
export class WindowPresenter implements IWindowPresenter {
  // Map managing all BrowserWindow instances, key is window ID
  windows: Map<number, BrowserWindow>
  private configPresenter: IConfigPresenter
  // Exit flag indicating if app is in the process of quitting (set by 'before-quit' hook)
  private isQuitting: boolean = false
  // Current focused window ID (internal record)
  private focusedWindowId: number | null = null
  // Main window ID
  private mainWindowId: number | null = null
  // Window focus state management
  private windowFocusStates = new Map<
    number,
    {
      lastFocusTime: number
      shouldFocus: boolean
      isNewWindow: boolean
      hasInitialFocus: boolean
    }
  >()
  private floatingChatWindow: FloatingChatWindow | null = null

  constructor(configPresenter: IConfigPresenter) {
    this.windows = new Map()
    this.configPresenter = configPresenter

    // Register IPC handlers for Renderer to call to get window and WebContents IDs
    ipcMain.on('get-window-id', (event) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      event.returnValue = window ? window.id : null
    })

    ipcMain.on('get-web-contents-id', (event) => {
      event.returnValue = event.sender.id
    })

    ipcMain.on('close-floating-window', (event) => {
      // Check if sender is the floating chat window
      const webContentsId = event.sender.id
      if (
        this.floatingChatWindow &&
        this.floatingChatWindow.getWindow()?.webContents.id === webContentsId
      ) {
        this.hideFloatingChatWindow()
      }
    })

    // Listen for shortcut event: create new window
    eventBus.on(SHORTCUT_EVENTS.CREATE_NEW_WINDOW, () => {
      console.log('Creating new shell window via shortcut.')
      this.createShellWindow({ initialTab: { url: 'local://chat' } })
    })

    // Listen for shortcut event: create new tab
    eventBus.on(SHORTCUT_EVENTS.CREATE_NEW_TAB, async (windowId: number) => {
      console.log(`Creating new tab via shortcut for window ${windowId}.`)
      const window = this.windows.get(windowId)
      if (window && !window.isDestroyed()) {
        await (presenter.tabPresenter as TabPresenter).createTab(windowId, 'local://chat', {
          active: true
        })
      } else {
        console.warn(
          `Cannot create new tab for window ${windowId}, window does not exist or is destroyed.`
        )
      }
    })

    // 监听快捷键事件：关闭当前标签页
    eventBus.on(SHORTCUT_EVENTS.CLOSE_CURRENT_TAB, async (windowId: number) => {
      console.log(`Received CLOSE_CURRENT_TAB for window ${windowId}.`)
      const window = this.windows.get(windowId)
      if (!window || window.isDestroyed()) {
        console.warn(
          `Cannot handle close tab request, window ${windowId} does not exist or is destroyed.`
        )
        return
      }

      const tabPresenterInstance = presenter.tabPresenter as TabPresenter
      const tabsData = await tabPresenterInstance.getWindowTabsData(windowId)
      const activeTab = tabsData.find((tab) => tab.isActive)

      if (activeTab) {
        if (tabsData.length === 1) {
          // 窗口内只有最后一个标签页
          const allWindows = this.getAllWindows()
          if (allWindows.length === 1) {
            // 是最后一个窗口的最后一个标签页，隐藏窗口
            console.log(`Window ${windowId} is the last window's last tab, hiding window.`)
            this.hide(windowId) // 调用 hide() 会触发 hide 逻辑
          } else {
            // 不是最后一个窗口的最后一个标签页，关闭窗口
            console.log(`Window ${windowId} has other windows, closing this window.`)
            this.close(windowId) // 调用 close() 会触发 'close' 事件处理器
          }
        } else {
          // 窗口内不止一个标签页，直接关闭当前标签页
          console.log(`Window ${windowId} has multiple tabs, closing active tab ${activeTab.id}.`)
          await tabPresenterInstance.closeTab(activeTab.id)
        }
      } else {
        console.warn(`No active tab found in window ${windowId} to close.`)
      }
    })

    // 监听系统主题更新事件，通知所有窗口 Renderer
    eventBus.on(SYSTEM_EVENTS.SYSTEM_THEME_UPDATED, (isDark: boolean) => {
      console.log('System theme updated, notifying all windows.')
      this.windows.forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('system-theme-updated', isDark)
        } else {
          console.warn(`Skipping theme update for destroyed window ${window.id}.`)
        }
      })
    })

    // 监听内容保护设置变更事件，更新所有窗口并重启应用
    eventBus.on(CONFIG_EVENTS.CONTENT_PROTECTION_CHANGED, (enabled: boolean) => {
      console.log(`Content protection setting changed to ${enabled}, restarting application.`)
      this.windows.forEach((window) => {
        if (!window.isDestroyed()) {
          this.updateContentProtection(window, enabled)
        } else {
          console.warn(`Skipping content protection update for destroyed window ${window.id}.`)
        }
      })
      // 内容保护变更通常需要重启应用才能完全生效
      setTimeout(() => {
        presenter.devicePresenter.restartApp()
      }, 1000)
    })
  }

  /**
   * 获取当前主窗口 (优先返回焦点窗口，否则返回第一个有效窗口)。
   */
  get mainWindow(): BrowserWindow | undefined {
    const focused = this.getFocusedWindow()
    if (focused && !focused.isDestroyed()) {
      return focused
    }
    const allWindows = this.getAllWindows()
    return allWindows.length > 0 && !allWindows[0].isDestroyed() ? allWindows[0] : undefined
  }

  /**
   * 预览文件。macOS 使用 Quick Look，其他平台使用系统默认应用打开。
   * @param filePath 文件路径。
   */
  previewFile(filePath: string): void {
    let targetWindow = this.getFocusedWindow()
    if (!targetWindow && this.floatingChatWindow && this.floatingChatWindow.isShowing()) {
      const floatingWindow = this.floatingChatWindow.getWindow()
      if (floatingWindow) {
        targetWindow = floatingWindow
      }
    }
    if (!targetWindow) {
      targetWindow = this.mainWindow
    }

    if (targetWindow && !targetWindow.isDestroyed()) {
      console.log(`Previewing file: ${filePath}`)
      if (process.platform === 'darwin') {
        targetWindow.previewFile(filePath)
      } else {
        shell.openPath(filePath) // 使用系统默认应用打开
      }
    } else {
      console.warn('Cannot preview file, no valid window found.')
    }
  }

  /**
   * 最小化指定 ID 的窗口。
   * @param windowId 窗口 ID。
   */
  minimize(windowId: number): void {
    const window = this.windows.get(windowId)
    if (window && !window.isDestroyed()) {
      console.log(`Minimizing window ${windowId}.`)
      window.minimize()
    } else {
      console.warn(`Failed to minimize window ${windowId}, window does not exist or is destroyed.`)
    }
  }

  /**
   * 最大化/还原指定 ID 的窗口。
   * @param windowId 窗口 ID。
   */
  maximize(windowId: number): void {
    const window = this.windows.get(windowId)
    if (window && !window.isDestroyed()) {
      console.log(`Maximizing/unmaximizing window ${windowId}.`)
      if (window.isMaximized()) {
        window.unmaximize()
      } else {
        window.maximize()
      }
      // 触发恢复逻辑以确保活动标签页的 bounds 更新
      this.handleWindowRestore(windowId).catch((error) => {
        console.error(
          `Error handling restore logic after maximizing/unmaximizing window ${windowId}:`,
          error
        )
      })
    } else {
      console.warn(
        `Failed to maximize/unmaximize window ${windowId}, window does not exist or is destroyed.`
      )
    }
  }

  /**
   * 请求关闭指定 ID 的窗口。这将触发窗口的 'close' 事件。
   * 实际关闭或隐藏行为由 'close' 事件处理程序决定。
   * @param windowId 窗口 ID。
   */
  close(windowId: number): void {
    const window = this.windows.get(windowId)
    if (window && !window.isDestroyed()) {
      console.log(`Requesting to close window ${windowId}, calling window.close().`)
      window.close() // 触发 'close' 事件
    } else {
      console.warn(
        `Failed to request close for window ${windowId}, window does not exist or is destroyed.`
      )
    }
  }

  /**
   * 根据 IWindowPresenter 接口定义的关闭窗口方法。
   * 实际行为与 close(windowId) 相同，由 'close' 事件处理程序决定。
   * @param windowId 窗口 ID。
   * @param forceClose 是否强制关闭 (当前实现由 isQuitting 标志控制，此参数未直接使用)。
   */
  async closeWindow(windowId: number, forceClose: boolean = false): Promise<void> {
    console.log(`closeWindow(${windowId}, ${forceClose}) called.`)
    const window = this.windows.get(windowId)
    if (window && !window.isDestroyed()) {
      window.close() // 触发 'close' 事件
    } else {
      console.warn(
        `Failed to close window ${windowId} in closeWindow, window does not exist or is destroyed.`
      )
    }
    return Promise.resolve()
  }

  /**
   * 隐藏指定 ID 的窗口。在全屏模式下，会先退出全屏再隐藏。
   * @param windowId 窗口 ID。
   */
  hide(windowId: number): void {
    const window = this.windows.get(windowId)
    if (window && !window.isDestroyed()) {
      console.log(`Hiding window ${windowId}.`)
      // 处理全屏窗口隐藏时的黑屏问题
      if (window.isFullScreen()) {
        console.log(`Window ${windowId} is fullscreen, exiting fullscreen before hiding.`)
        // 退出全屏后监听 leave-full-screen 事件再隐藏
        window.once('leave-full-screen', () => {
          console.log(`Window ${windowId} left fullscreen, proceeding with hide.`)
          if (!window.isDestroyed()) {
            window.hide()
          } else {
            console.warn(`Window ${windowId} was destroyed after leaving fullscreen, cannot hide.`)
          }
        })
        window.setFullScreen(false) // 请求退出全屏
      } else {
        console.log(`Window ${windowId} is not fullscreen, hiding directly.`)
        window.hide() // 直接隐藏
      }
    } else {
      console.warn(`Failed to hide window ${windowId}, window does not exist or is destroyed.`)
    }
  }

  /**
   * 显示指定 ID 的窗口。如果未指定 ID，则显示焦点窗口或第一个窗口。
   * @param windowId 可选。要显示的窗口 ID。
   */
  show(windowId?: number): void {
    let targetWindow: BrowserWindow | undefined
    if (windowId === undefined) {
      // 未指定 ID，查找焦点窗口或第一个窗口
      targetWindow = this.getFocusedWindow() || this.getAllWindows()[0]
      if (targetWindow && !targetWindow.isDestroyed()) {
        console.log(`Showing default window ${targetWindow.id}.`)
      } else {
        console.warn('No window found to show.')
        return
      }
    } else {
      targetWindow = this.windows.get(windowId)
      if (targetWindow && !targetWindow.isDestroyed()) {
        console.log(`Showing window ${windowId}.`)
      } else {
        console.warn(`Failed to show window ${windowId}, window does not exist or is destroyed.`)
        return
      }
    }

    targetWindow.show()
    targetWindow.focus() // Bring to foreground
    // 触发恢复逻辑以确保活动标签页可见且位置正确
    this.handleWindowRestore(targetWindow.id).catch((error) => {
      console.error(`Error handling restore logic after showing window ${targetWindow!.id}:`, error)
    })
  }

  /**
   * 窗口恢复、显示或尺寸变更后的处理逻辑。
   * 主要确保当前活动标签页的 WebContentsView 可见且位置正确。
   * @param windowId 窗口 ID。
   */
  private async handleWindowRestore(windowId: number): Promise<void> {
    console.log(`Handling restore/show logic for window ${windowId}.`)
    const window = this.windows.get(windowId)
    if (!window || window.isDestroyed()) {
      console.warn(
        `Cannot handle restore/show logic for window ${windowId}, window does not exist or is destroyed.`
      )
      return
    }

    try {
      // 通过 TabPresenter 获取活动标签页 ID
      const tabPresenterInstance = presenter.tabPresenter as TabPresenter
      const activeTabId = await tabPresenterInstance.getActiveTabId(windowId)

      if (activeTabId) {
        console.log(`Window ${windowId} restored/shown: activating active tab ${activeTabId}.`)
        // 调用 switchTab 会确保视图被关联、可见并更新 bounds
        await tabPresenterInstance.switchTab(activeTabId)
      } else {
        console.warn(
          `Window ${windowId} restored/shown: no active tab found, ensuring all views are hidden.`
        )
        // 如果没有活动标签页，确保所有视图都隐藏
        const tabsInWindow = await tabPresenterInstance.getWindowTabsData(windowId)
        for (const tabData of tabsInWindow) {
          const tabView = await tabPresenterInstance.getTab(tabData.id)
          if (tabView && !tabView.webContents.isDestroyed()) {
            tabView.setVisible(false) // 显式隐藏所有标签页视图
          }
        }
      }
    } catch (error) {
      console.error(`Error handling restore/show logic for window ${windowId}:`, error)
    }
  }

  /**
   * 检查指定 ID 的窗口是否已最大化。
   * @param windowId 窗口 ID。
   * @returns 如果窗口存在、有效且已最大化，则返回 true，否则返回 false。
   */
  isMaximized(windowId: number): boolean {
    const window = this.windows.get(windowId)
    return window && !window.isDestroyed() ? window.isMaximized() : false
  }

  /**
   * 检查指定 ID 的窗口是否当前获得了焦点。
   * @param windowId 窗口 ID。
   * @returns 如果是焦点窗口，则返回 true，否则返回 false。
   */
  isMainWindowFocused(windowId: number): boolean {
    const focusedWindow = this.getFocusedWindow()
    return focusedWindow ? focusedWindow.id === windowId : false
  }

  /**
   * 检查是否应该聚焦标签页
   * @param windowId 窗口 ID
   * @param reason 聚焦原因
   */
  private shouldFocusTab(
    windowId: number,
    reason: 'focus' | 'restore' | 'show' | 'initial'
  ): boolean {
    const state = this.windowFocusStates.get(windowId)
    if (!state) {
      return true
    }
    const now = Date.now()
    if (now - state.lastFocusTime < 100) {
      console.log(`Skipping focus for window ${windowId}, too frequent (${reason})`)
      return false
    }
    switch (reason) {
      case 'initial':
        return !state.hasInitialFocus
      case 'focus':
        return state.shouldFocus
      case 'restore':
      case 'show':
        return state.isNewWindow || state.shouldFocus
      default:
        return false
    }
  }

  /**
   * 将焦点传递给指定窗口的活动标签页
   * @param windowId 窗口 ID
   * @param reason 聚焦原因
   */
  public focusActiveTab(
    windowId: number,
    reason: 'focus' | 'restore' | 'show' | 'initial' = 'focus'
  ): void {
    if (!this.shouldFocusTab(windowId, reason)) {
      return
    }
    try {
      setTimeout(async () => {
        const tabPresenterInstance = presenter.tabPresenter as TabPresenter
        const tabsData = await tabPresenterInstance.getWindowTabsData(windowId)
        const activeTab = tabsData.find((tab) => tab.isActive)
        if (activeTab) {
          console.log(
            `Focusing active tab ${activeTab.id} in window ${windowId} (reason: ${reason})`
          )
          await tabPresenterInstance.switchTab(activeTab.id)
          const state = this.windowFocusStates.get(windowId)
          if (state) {
            state.lastFocusTime = Date.now()
            if (reason === 'initial') {
              state.hasInitialFocus = true
            }
            if (reason === 'focus' || reason === 'initial') {
              state.isNewWindow = false
            }
          }
        }
      }, 50)
    } catch (error) {
      console.error(`Error focusing active tab in window ${windowId}:`, error)
    }
  }

  /**
   * 向所有有效窗口的主 WebContents 和所有标签页的 WebContents 发送消息。
   * @param channel IPC 通道名。
   * @param args 消息参数。
   */
  async sendToAllWindows(channel: string, ...args: unknown[]): Promise<void> {
    // 遍历 Map 的值副本，避免迭代过程中 Map 被修改
    for (const window of Array.from(this.windows.values())) {
      if (!window.isDestroyed()) {
        // 向窗口主 WebContents 发送
        window.webContents.send(channel, ...args)

        // 向窗口内所有标签页的 WebContents 发送 (异步执行)
        try {
          const tabPresenterInstance = presenter.tabPresenter as TabPresenter
          const tabsData = await tabPresenterInstance.getWindowTabsData(window.id)
          if (tabsData && tabsData.length > 0) {
            for (const tabData of tabsData) {
              const tab = await tabPresenterInstance.getTab(tabData.id)
              if (tab && !tab.webContents.isDestroyed()) {
                tab.webContents.send(channel, ...args)
              }
            }
          }
        } catch (error) {
          console.error(`Error sending message "${channel}" to tabs of window ${window.id}:`, error)
        }
      } else {
        console.warn(`Skipping sending message "${channel}" to destroyed window ${window.id}.`)
      }
    }

    if (this.floatingChatWindow && this.floatingChatWindow.isShowing()) {
      const floatingWindow = this.floatingChatWindow.getWindow()
      if (floatingWindow && !floatingWindow.isDestroyed()) {
        try {
          floatingWindow.webContents.send(channel, ...args)
        } catch (error) {
          console.error(`Error sending message "${channel}" to floating chat window:`, error)
        }
      }
    }
  }

  /**
   * 向指定 ID 的窗口的主 WebContents 和其所有标签页的 WebContents 发送消息。
   * @param windowId 目标窗口 ID。
   * @param channel IPC 通道名。
   * @param args 消息参数。
   * @returns 如果消息已尝试发送，返回 true，否则返回 false。
   */
  sendToWindow(windowId: number, channel: string, ...args: unknown[]): boolean {
    console.log(`Sending message "${channel}" to window ${windowId}.`)
    const window = this.windows.get(windowId)
    if (window && !window.isDestroyed()) {
      // 向窗口主 WebContents 发送
      window.webContents.send(channel, ...args)

      // 向窗口内所有标签页的 WebContents 发送 (异步执行)
      const tabPresenterInstance = presenter.tabPresenter as TabPresenter
      tabPresenterInstance
        .getWindowTabsData(windowId)
        .then((tabsData) => {
          if (tabsData && tabsData.length > 0) {
            tabsData.forEach(async (tabData) => {
              const tab = await tabPresenterInstance.getTab(tabData.id)
              if (tab && !tab.webContents.isDestroyed()) {
                tab.webContents.send(channel, ...args)
              }
            })
          }
        })
        .catch((error) => {
          console.error(`Error sending message "${channel}" to tabs of window ${windowId}:`, error)
        })
      return true
    } else {
      console.warn(
        `Failed to send message "${channel}" to window ${windowId}, window does not exist or is destroyed.`
      )
    }
    return false
  }

  /**
   * 创建一个新的外壳窗口。
   * @param options 窗口配置选项，包括初始标签页或激活现有标签页。
   * @returns 创建的窗口 ID，如果创建失败则返回 null。
   */
  async createShellWindow(options?: {
    activateTabId?: number // 要关联并激活的现有标签页 ID
    initialTab?: {
      // 窗口创建时要创建的新标签页选项
      url: string
      icon?: string
    }
    x?: number // 初始 X 坐标
    y?: number // 初始 Y 坐标
  }): Promise<number | null> {
    console.log('Creating new shell window.')

    // 根据平台选择图标
    const iconFile = nativeImage.createFromPath(process.platform === 'win32' ? iconWin : icon)

    // 使用窗口状态管理器恢复位置和尺寸
    const shellWindowState = windowStateManager({
      defaultWidth: 800,
      defaultHeight: 620
    })

    // 计算初始位置，确保窗口完全在屏幕范围内
    const initialX =
      options?.x !== undefined
        ? options.x
        : this.validateWindowPosition(
            shellWindowState.x,
            shellWindowState.width,
            shellWindowState.y,
            shellWindowState.height
          ).x
    let initialY =
      options?.y !== undefined
        ? options?.y
        : this.validateWindowPosition(
            shellWindowState.x,
            shellWindowState.width,
            shellWindowState.y,
            shellWindowState.height
          ).y

    const shellWindow = new BrowserWindow({
      width: shellWindowState.width,
      height: shellWindowState.height,
      x: initialX,
      y: initialY,
      show: false, // 先隐藏窗口，等待 ready-to-show 以避免白屏
      autoHideMenuBar: true, // 隐藏菜单栏
      icon: iconFile, // 设置图标
      titleBarStyle: 'hiddenInset', // macOS 风格标题栏
      transparent: process.platform === 'darwin', // macOS 标题栏透明
      vibrancy: process.platform === 'darwin' ? 'under-window' : undefined, // macOS 磨砂效果
      backgroundColor: '#00000000', // 透明背景色
      maximizable: true, // 允许最大化
      frame: process.platform === 'darwin', // macOS 无边框
      hasShadow: true, // macOS 阴影
      trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 12 } : undefined, // macOS 红绿灯按钮位置
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'), // Preload 脚本路径
        sandbox: false, // 禁用沙箱，允许 preload 访问 Node.js API
        devTools: is.dev // 开发模式下启用 DevTools
      },
      roundedCorners: true // Windows 11 圆角
    })

    if (!shellWindow) {
      console.error('Failed to create shell window.')
      return null
    }

    const windowId = shellWindow.id
    this.windows.set(windowId, shellWindow) // 将窗口实例存入 Map

    this.windowFocusStates.set(windowId, {
      lastFocusTime: 0,
      shouldFocus: true,
      isNewWindow: true,
      hasInitialFocus: false
    })

    shellWindowState.manage(shellWindow) // 管理窗口状态

    // 应用内容保护设置
    const contentProtectionEnabled = this.configPresenter.getContentProtectionEnabled()
    this.updateContentProtection(shellWindow, contentProtectionEnabled)

    // --- 窗口事件监听 ---

    // 窗口准备就绪时显示
    shellWindow.on('ready-to-show', () => {
      console.log(`Window ${windowId} is ready to show.`)
      if (!shellWindow.isDestroyed()) {
        shellWindow.show() // 显示窗口避免白屏
        eventBus.sendToMain(WINDOW_EVENTS.WINDOW_CREATED, windowId)
      } else {
        console.warn(`Window ${windowId} was destroyed before ready-to-show.`)
      }
    })

    // 窗口获得焦点
    shellWindow.on('focus', () => {
      console.log(`Window ${windowId} gained focus.`)
      this.focusedWindowId = windowId
      eventBus.sendToMain(WINDOW_EVENTS.WINDOW_FOCUSED, windowId)
      if (!shellWindow.isDestroyed()) {
        shellWindow.webContents.send('window-focused', windowId)
      }
      this.focusActiveTab(windowId, 'focus')
    })

    // 窗口失去焦点
    shellWindow.on('blur', () => {
      console.log(`Window ${windowId} lost focus.`)
      if (this.focusedWindowId === windowId) {
        this.focusedWindowId = null // 仅当失去焦点的窗口是当前记录的焦点窗口时才清空
      }
      eventBus.sendToMain(WINDOW_EVENTS.WINDOW_BLURRED, windowId)
      if (!shellWindow.isDestroyed()) {
        shellWindow.webContents.send('window-blurred', windowId)
      }
    })

    // 窗口最大化
    shellWindow.on('maximize', () => {
      console.log(`Window ${windowId} maximized.`)
      if (!shellWindow.isDestroyed()) {
        eventBus.sendToMain(WINDOW_EVENTS.WINDOW_MAXIMIZED, windowId)
        // 触发恢复逻辑更新标签页 bounds
        this.handleWindowRestore(windowId).catch((error) => {
          console.error(`Error handling restore logic after maximizing window ${windowId}:`, error)
        })
      }
    })

    // 窗口取消最大化
    shellWindow.on('unmaximize', () => {
      console.log(`Window ${windowId} unmaximized.`)
      if (!shellWindow.isDestroyed()) {
        eventBus.sendToMain(WINDOW_EVENTS.WINDOW_UNMAXIMIZED, windowId)
        // 触发恢复逻辑更新标签页 bounds
        this.handleWindowRestore(windowId).catch((error) => {
          console.error(
            `Error handling restore logic after unmaximizing window ${windowId}:`,
            error
          )
        })
      }
    })

    // 窗口从最小化恢复 (或通过 show 显式显示)
    const handleRestore = async () => {
      console.log(`Window ${windowId} restored.`)
      this.handleWindowRestore(windowId).catch((error) => {
        console.error(`Error handling restore logic for window ${windowId}:`, error)
      })
      this.focusActiveTab(windowId, 'restore')
      eventBus.sendToMain(WINDOW_EVENTS.WINDOW_RESTORED, windowId)
    }
    shellWindow.on('restore', handleRestore)

    // 窗口进入全屏
    shellWindow.on('enter-full-screen', () => {
      console.log(`Window ${windowId} entered fullscreen.`)
      if (!shellWindow.isDestroyed()) {
        eventBus.sendToMain(WINDOW_EVENTS.WINDOW_ENTER_FULL_SCREEN, windowId)
        // 触发恢复逻辑更新标签页 bounds
        this.handleWindowRestore(windowId).catch((error) => {
          console.error(
            `Error handling restore logic after entering fullscreen for window ${windowId}:`,
            error
          )
        })
      }
    })

    // 窗口退出全屏
    shellWindow.on('leave-full-screen', () => {
      console.log(`Window ${windowId} left fullscreen.`)
      if (!shellWindow.isDestroyed()) {
        eventBus.sendToMain(WINDOW_EVENTS.WINDOW_LEAVE_FULL_SCREEN, windowId)
        // 触发恢复逻辑更新标签页 bounds
        this.handleWindowRestore(windowId).catch((error) => {
          console.error(
            `Error handling restore logic after leaving fullscreen for window ${windowId}:`,
            error
          )
        })
      }
    })

    // 窗口尺寸改变，通知 TabPresenter 更新所有视图 bounds
    shellWindow.on('resize', () => {
      eventBus.sendToMain(WINDOW_EVENTS.WINDOW_RESIZE, windowId)
    })

    // 'close' 事件：用户尝试关闭窗口 (点击关闭按钮等)。
    // 此处理程序决定是隐藏窗口还是允许其关闭/销毁。
    shellWindow.on('close', (event) => {
      console.log(
        `Window ${windowId} close event. isQuitting: ${this.isQuitting}, Platform: ${process.platform}.`
      )

      // 如果应用不是正在退出过程中...
      if (!this.isQuitting) {
        // 实现隐藏到托盘逻辑：
        // 1. 如果是其他窗口，直接关闭
        // 2. 如果是主窗口，判断配置是否允许关闭
        // shouldPreventDefault: true隐藏, false关闭
        const shouldQuitOnClose = this.configPresenter.getCloseToQuit()
        const shouldPreventDefault = windowId === this.mainWindowId && !shouldQuitOnClose

        if (shouldPreventDefault) {
          console.log(`Window ${windowId}: Preventing default close behavior, hiding instead.`)
          event.preventDefault() // 阻止默认窗口关闭行为

          // 处理全屏窗口隐藏时的黑屏问题 (同 hide 方法)
          if (shellWindow.isFullScreen()) {
            console.log(
              `Window ${windowId} is fullscreen, exiting fullscreen before hiding (close event).`
            )
            shellWindow.once('leave-full-screen', () => {
              console.log(`Window ${windowId} left fullscreen, proceeding with hide (close event).`)
              if (!shellWindow.isDestroyed()) {
                shellWindow.hide()
              } else {
                console.warn(
                  `Window ${windowId} was destroyed after leaving fullscreen, cannot hide (close event).`
                )
              }
            })
            shellWindow.setFullScreen(false)
          } else {
            console.log(`Window ${windowId} is not fullscreen, hiding directly (close event).`)
            shellWindow.hide()
          }
        } else {
          // 允许默认关闭行为。这将触发 'closed' 事件。
          console.log(
            `Window ${windowId}: Allowing default close behavior (app is quitting or macOS last window configured to quit).`
          )
          presenter.tabPresenter.closeTabs(windowId)
        }
      } else {
        // 如果 isQuitting 为 true，表示应用正在主动退出，允许窗口正常关闭
        console.log(`Window ${windowId}: isQuitting is true, allowing default close behavior.`)
      }
    })

    // 'closed' 事件：窗口实际关闭并销毁时触发 (在 'close' 事件之后，如果未阻止默认行为)
    shellWindow.on('closed', () => {
      console.log(
        `Window ${windowId} closed event triggered. isQuitting: ${this.isQuitting}, Map size BEFORE delete: ${this.windows.size}`
      )
      const windowIdBeingClosed = windowId // 捕获 ID

      // 移除 restore 事件监听器，防止内存泄漏 (其他事件的清理根据需要添加)
      shellWindow.removeListener('restore', handleRestore)

      this.windows.delete(windowIdBeingClosed) // 从 Map 中移除
      this.windowFocusStates.delete(windowIdBeingClosed)
      shellWindowState.unmanage() // 停止管理窗口状态
      eventBus.sendToMain(WINDOW_EVENTS.WINDOW_CLOSED, windowIdBeingClosed)
      console.log(
        `Window ${windowIdBeingClosed} closed event handled. Map size AFTER delete: ${this.windows.size}`
      )

      // 如果在非 macOS 平台，且关闭的是最后一个窗口，如果应用并非正在退出，则发出警告。
      // 在隐藏到托盘逻辑下，'closed' 事件仅应在 isQuitting 为 true 时触发。
      if (this.windows.size === 0 && process.platform !== 'darwin') {
        console.log(`Last window closed on non-macOS platform.`)
        if (!this.isQuitting) {
          console.warn(
            `Warning: Last window on non-macOS platform triggered closed event, but app is not marked as quitting. This might indicate window destruction instead of hiding.`
          )
        }
      }
    })

    // --- 加载 Renderer HTML 文件 ---
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      console.log(
        `Loading renderer URL in dev mode: ${process.env['ELECTRON_RENDERER_URL']}/shell/index.html`
      )
      shellWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/shell/index.html')
    } else {
      // 生产模式下加载打包后的 HTML 文件
      console.log(
        `Loading packaged renderer file: ${join(__dirname, '../renderer/shell/index.html')}`
      )
      shellWindow.loadFile(join(__dirname, '../renderer/shell/index.html'))
    }

    // --- 处理初始标签页创建或激活 ---

    // 如果提供了 options?.initialTab，等待窗口加载完成，然后创建新标签页
    if (options?.initialTab) {
      shellWindow.webContents.once('did-finish-load', async () => {
        console.log(`Window ${windowId} did-finish-load, checking for initial tab creation.`)
        if (shellWindow.isDestroyed()) {
          console.warn(
            `Window ${windowId} was destroyed before did-finish-load callback, cannot create initial tab.`
          )
          return
        }
        shellWindow.focus() // 窗口加载完成后聚焦
        try {
          console.log(`Creating initial tab, URL: ${options.initialTab!.url}`)
          const tabId = await (presenter.tabPresenter as TabPresenter).createTab(
            windowId,
            options.initialTab!.url,
            { active: true }
          )
          if (tabId === null) {
            console.error(`Failed to create initial tab in new window ${windowId}.`)
          } else {
            console.log(`Created initial tab ${tabId} in window ${windowId}.`)
          }
        } catch (error) {
          console.error(`Error creating initial tab:`, error)
        }
      })
    }

    // 如果提供了 activateTabId，表示一个现有标签页 (WebContentsView) 将被 TabPresenter 关联到此新窗口
    // 激活逻辑 (设置可见性、bounds) 在 tabPresenter.attachTab / switchTab 中处理
    if (options?.activateTabId !== undefined) {
      // 等待窗口加载完成，然后尝试激活指定标签页
      shellWindow.webContents.once('did-finish-load', async () => {
        console.log(
          `Window ${windowId} did-finish-load, attempting to activate tab ${options.activateTabId}.`
        )
        if (shellWindow.isDestroyed()) {
          console.warn(
            `Window ${windowId} was destroyed before did-finish-load callback, cannot activate tab ${options.activateTabId}.`
          )
          return
        }
        try {
          // 切换到指定标签页，这将处理视图的关联和显示
          await (presenter.tabPresenter as TabPresenter).switchTab(options.activateTabId as number)
          console.log(`Requested to switch to tab ${options.activateTabId}.`)
        } catch (error) {
          console.error(
            `Failed to activate tab ${options.activateTabId} after window ${windowId} load:`,
            error
          )
        }
      })
    }

    // 开发模式下可选开启 DevTools
    if (is.dev) {
      // shellWindow.webContents.openDevTools({ mode: 'detach' });
    }

    console.log(`Shell window ${windowId} created successfully.`)

    if (this.mainWindowId == null) {
      this.mainWindowId = windowId // 如果这是第一个窗口，设置为主窗口 ID
    }
    return windowId // 返回新创建窗口的 ID
  }

  /**
   * 更新指定窗口的内容保护设置。
   * @param window BrowserWindow 实例。
   * @param enabled 是否启用内容保护。
   */
  private updateContentProtection(window: BrowserWindow, enabled: boolean): void {
    if (window.isDestroyed()) {
      console.warn(`Attempted to update content protection settings on a destroyed window.`)
      return
    }
    console.log(`Updating content protection for window ${window.id}: ${enabled}`)

    // setContentProtection 阻止截图/屏幕录制
    window.setContentProtection(enabled)

    // setBackgroundThrottling 限制非活动窗口的帧率。
    // 启用内容保护时禁用节流，确保即使窗口非活动也能保持保护。
    window.webContents.setBackgroundThrottling(!enabled) // 启用保护时禁用节流
    window.webContents.setFrameRate(60) // 设置帧率
    window.setBackgroundColor('#00000000') // 设置背景色为透明

    // macOS 特定的隐藏功能 (用于内容保护)
    if (process.platform === 'darwin') {
      window.setHiddenInMissionControl(enabled) // 在 Mission Control 中隐藏
      window.setSkipTaskbar(enabled) // 在 Dock 和 Mission Control 切换器中隐藏
    }
  }

  /**
   * 获取当前获得焦点的 BrowserWindow 实例 (由 Electron 报告并经内部 Map 验证)。
   * @returns 获得焦点的 BrowserWindow 实例，如果无焦点窗口或窗口无效则返回 undefined。
   */
  getFocusedWindow(): BrowserWindow | undefined {
    const electronFocusedWindow = BrowserWindow.getFocusedWindow()

    if (electronFocusedWindow) {
      const windowId = electronFocusedWindow.id
      const ourWindow = this.windows.get(windowId)

      // 验证 Electron 报告的窗口是否在我们管理范围内且有效
      if (ourWindow && !ourWindow.isDestroyed()) {
        this.focusedWindowId = windowId // 更新内部记录
        return ourWindow
      } else {
        // Electron 报告的窗口不在 Map 中或已销毁
        console.warn(
          `Electron reported window ${windowId} focused, but it is not managed or is destroyed.`
        )
        this.focusedWindowId = null
        return undefined
      }
    } else {
      this.focusedWindowId = null // 清空内部记录
      return undefined
    }
  }

  /**
   * 获取所有有效 (未销毁) 的 BrowserWindow 实例数组。
   * @returns BrowserWindow 实例数组。
   */
  getAllWindows(): BrowserWindow[] {
    return Array.from(this.windows.values()).filter((window) => !window.isDestroyed())
  }

  /**
   * 获取指定窗口的活动标签页 ID。
   * @param windowId 窗口 ID。
   * @returns 活动标签页 ID，如果窗口无效或无活动标签页则返回 undefined。
   */
  async getActiveTabId(windowId: number): Promise<number | undefined> {
    const window = this.windows.get(windowId)
    if (!window || window.isDestroyed()) {
      console.warn(
        `Cannot get active tab ID for window ${windowId}, window does not exist or is destroyed.`
      )
      return undefined
    }
    const tabPresenterInstance = presenter.tabPresenter as TabPresenter
    const tabsData = await tabPresenterInstance.getWindowTabsData(windowId)
    const activeTab = tabsData.find((tab) => tab.isActive)
    return activeTab?.id
  }

  /**
   * 向指定窗口的活动标签页发送一个事件。
   * @param windowId 目标窗口 ID。
   * @param channel 事件通道。
   * @param args 事件参数。
   * @returns 如果事件已发送到有效活动标签页，返回 true，否则返回 false。
   */
  async sendToActiveTab(windowId: number, channel: string, ...args: unknown[]): Promise<boolean> {
    console.log(`Sending event "${channel}" to active tab of window ${windowId}.`)
    const tabPresenterInstance = presenter.tabPresenter as TabPresenter
    const activeTabId = await tabPresenterInstance.getActiveTabId(windowId)
    if (activeTabId) {
      const tab = await tabPresenterInstance.getTab(activeTabId)
      if (tab && !tab.webContents.isDestroyed()) {
        tab.webContents.send(channel, ...args)
        console.log(`  - Event sent to tab ${activeTabId}.`)
        return true
      } else {
        console.warn(
          `  - Active tab ${activeTabId} does not exist or is destroyed, cannot send event.`
        )
      }
    } else {
      console.warn(`No active tab found in window ${windowId}, cannot send event "${channel}".`)
    }
    return false
  }

  /**
   * 向“默认”标签页发送消息。
   * 优先级：焦点窗口的活动标签页 > 第一个窗口的活动标签页 > 第一个窗口的第一个标签页。
   * @param channel 消息通道。
   * @param switchToTarget 发送消息后是否切换到目标窗口和标签页。默认为 false。
   * @param args 消息参数。
   * @returns 如果消息已发送，返回 true，否则返回 false。
   */
  async sendToDefaultTab(
    channel: string,
    switchToTarget: boolean = false,
    ...args: unknown[]
  ): Promise<boolean> {
    console.log(`Sending message "${channel}" to default tab. Switch to target: ${switchToTarget}.`)
    try {
      // 优先使用当前获得焦点的窗口
      let targetWindow = this.getFocusedWindow()
      let windowId: number | undefined

      if (targetWindow) {
        windowId = targetWindow.id
        console.log(`  - Using focused window ${windowId}`)
      } else {
        // 如果没有焦点窗口，使用第一个有效窗口
        const windows = this.getAllWindows()
        if (windows.length === 0) {
          console.warn('No window found to send message to.')
          return false
        }
        targetWindow = windows[0]
        windowId = targetWindow.id
        console.log(`  - No focused window, using first window ${windowId}`)
      }

      // 获取目标窗口的所有标签页
      const tabPresenterInstance = presenter.tabPresenter as TabPresenter
      const tabsData = await tabPresenterInstance.getWindowTabsData(windowId)
      if (tabsData.length === 0) {
        console.warn(`Window ${windowId} has no tabs, cannot send message to default tab.`)
        return false
      }

      // 获取活动标签页，如果没有则取第一个标签页
      const targetTabData = tabsData.find((tab) => tab.isActive) || tabsData[0]
      const targetTab = await tabPresenterInstance.getTab(targetTabData.id)

      if (targetTab && !targetTab.webContents.isDestroyed()) {
        // 向目标标签页发送消息
        targetTab.webContents.send(channel, ...args)
        console.log(`  - Message sent to tab ${targetTabData.id} in window ${windowId}.`)

        // 如果需要，切换到目标窗口和标签页
        if (switchToTarget) {
          try {
            // 激活目标窗口
            if (targetWindow && !targetWindow.isDestroyed()) {
              console.log(`  - Switching to window ${windowId}`)
              targetWindow.show() // 确保窗口可见
              targetWindow.focus() // 将窗口带到前台
            }

            // 如果目标标签页不是活动标签页，则切换
            if (!targetTabData.isActive) {
              console.log(`  - Switching to tab ${targetTabData.id}`)
              await tabPresenterInstance.switchTab(targetTabData.id)
            }
            // switchTab 已经会调用 bringViewToFront 来设置焦点，无需额外调用
          } catch (error) {
            console.error('Error switching to target window/tab:', error)
            // 继续，因为消息发送成功
          }
        }

        return true // 消息发送成功
      } else {
        console.warn(
          `Target tab ${targetTabData.id} in window ${windowId} is unavailable or destroyed.`
        )
        return false // 目标标签页无效
      }
    } catch (error) {
      console.error('Error sending message to default tab:', error)
      return false // 过程中发生错误
    }
  }

  public async createFloatingChatWindow(): Promise<void> {
    if (this.floatingChatWindow) {
      console.log('FloatingChatWindow already exists')
      return
    }

    try {
      this.floatingChatWindow = new FloatingChatWindow()
      await this.floatingChatWindow.create()
      console.log('FloatingChatWindow created successfully')
    } catch (error) {
      console.error('Failed to create FloatingChatWindow:', error)
      this.floatingChatWindow = null
      throw error
    }
  }

  public async showFloatingChatWindow(floatingButtonPosition?: {
    x: number
    y: number
    width: number
    height: number
  }): Promise<void> {
    if (!this.floatingChatWindow) {
      await this.createFloatingChatWindow()
    }

    if (this.floatingChatWindow) {
      this.floatingChatWindow.show(floatingButtonPosition)
      console.log('FloatingChatWindow shown')
    }
  }

  public hideFloatingChatWindow(): void {
    if (this.floatingChatWindow) {
      this.floatingChatWindow.hide()
      console.log('FloatingChatWindow hidden')
    }
  }

  public async toggleFloatingChatWindow(floatingButtonPosition?: {
    x: number
    y: number
    width: number
    height: number
  }): Promise<void> {
    if (!this.floatingChatWindow) {
      await this.createFloatingChatWindow()
    }

    if (this.floatingChatWindow) {
      this.floatingChatWindow.toggle(floatingButtonPosition)
      console.log('FloatingChatWindow toggled')
    }
  }

  public destroyFloatingChatWindow(): void {
    if (this.floatingChatWindow) {
      this.floatingChatWindow.destroy()
      this.floatingChatWindow = null
      console.log('FloatingChatWindow destroyed')
    }
  }

  public isFloatingChatWindowVisible(): boolean {
    return this.floatingChatWindow?.isShowing() || false
  }

  public getFloatingChatWindow(): FloatingChatWindow | null {
    return this.floatingChatWindow
  }

  public isApplicationQuitting(): boolean {
    return this.isQuitting
  }

  public setApplicationQuitting(isQuitting: boolean): void {
    this.isQuitting = isQuitting
  }

  private validateWindowPosition(
    x: number,
    width: number,
    y: number,
    height: number
  ): { x: number; y: number } {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { workArea } = primaryDisplay
    const isXValid = x >= workArea.x && x + width <= workArea.x + workArea.width
    const isYValid = y >= workArea.y && y + height <= workArea.y + workArea.height
    if (!isXValid || !isYValid) {
      console.log(
        `Window position out of bounds (x: ${x}, y: ${y}, width: ${width}, height: ${height}), centering window`
      )
      return {
        x: workArea.x + Math.max(0, (workArea.width - width) / 2),
        y: workArea.y + Math.max(0, (workArea.height - height) / 2)
      }
    }
    return { x, y }
  }
}
