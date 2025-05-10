import { BrowserWindow, shell, app, nativeImage } from 'electron'
import { join } from 'path'
import icon from '../../../resources/icon.png?asset'
import iconWin from '../../../resources/icon.ico?asset'
import { is } from '@electron-toolkit/utils'
import { IWindowPresenter } from '@shared/presenter'
import { eventBus } from '@/eventbus'
import { ConfigPresenter } from './configPresenter'
import { TrayPresenter } from './trayPresenter'
import { CONFIG_EVENTS, WINDOW_EVENTS } from '@/events'
import contextMenu from '../contextMenuHelper'
import { getContextMenuLabels } from '@shared/i18n'
import { presenter } from '.'

export const MAIN_WIN = 'main'
export class WindowPresenter implements IWindowPresenter {
  windows: Map<string, BrowserWindow>
  private configPresenter: ConfigPresenter
  private isQuitting: boolean = false
  private trayPresenter: TrayPresenter | null = null
  private contextMenuDisposer?: () => void
  private mainWindowFocused: boolean = false

  constructor(configPresenter: ConfigPresenter) {
    this.windows = new Map()
    this.configPresenter = configPresenter

    // 监听应用退出事件
    app.on('before-quit', () => {
      console.log('before-quit')
      this.isQuitting = true
      if (this.trayPresenter) {
        this.trayPresenter.destroy()
      }
    })

    // 监听强制退出事件
    eventBus.on(WINDOW_EVENTS.FORCE_QUIT_APP, () => {
      this.isQuitting = true
      if (this.trayPresenter) {
        this.trayPresenter.destroy()
      }
    })

    eventBus.on(CONFIG_EVENTS.SETTING_CHANGED, (key, value) => {
      if (key === 'language') {
        this.resetContextMenu(value as string)
      }
    })

    // 监听内容保护设置变化
    eventBus.on(CONFIG_EVENTS.CONTENT_PROTECTION_CHANGED, (enabled: boolean) => {
      if (this.mainWindow) {
        // 发送通知告知应用程序将重启
        console.log('Content protection setting changed to:', enabled, 'Restarting app...')

        // 延迟一点时间以确保设置已保存并且用户能看到对话框的反馈
        setTimeout(() => {
          presenter.devicePresenter.restartApp()
        }, 1000)
      }
    })
  }

  createMainWindow(): BrowserWindow {
    const iconFile = nativeImage.createFromPath(process.platform === 'win32' ? iconWin : icon)

    // Get saved window size and position from config
    const savedWindowSize = this.configPresenter.getSetting<{ width: number; height: number }>('windowSize')
    const savedWindowPosition = this.configPresenter.getSetting<{ x: number; y: number }>('windowPosition')

    const mainWindow = new BrowserWindow({
      width: savedWindowSize?.width || 1024,
      height: savedWindowSize?.height || 620,
      x: savedWindowPosition?.x,
      y: savedWindowPosition?.y,
      show: false,
      autoHideMenuBar: true,
      icon: iconFile,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: {
        x: 8,
        y: 10
      },
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        sandbox: false,
        devTools: is.dev
      },
      frame: false
    })

    // 获取内容保护设置的值
    const contentProtectionEnabled = this.configPresenter.getContentProtectionEnabled()
    // 更新内容保护设置
    this.updateContentProtection(mainWindow, contentProtectionEnabled)

    mainWindow.on('ready-to-show', () => {
      mainWindow.show()
      eventBus.emit(WINDOW_EVENTS.READY_TO_SHOW, mainWindow)
    })

    // 处理关闭按钮点击
    mainWindow.on('close', (e) => {
      eventBus.emit('main-window-close', mainWindow)
      console.log('main-window-close', this.isQuitting, e)

      // Save window size and position before closing
      if (!mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
        const [width, height] = mainWindow.getSize()
        const [x, y] = mainWindow.getPosition()
        this.configPresenter.setSetting('windowSize', { width, height })
        this.configPresenter.setSetting('windowPosition', { x, y })
      }

      if (!this.isQuitting) {
        e.preventDefault()
        if (mainWindow.isFullScreen()) {
          mainWindow.setFullScreen(false)
        }
        mainWindow.hide()
      }
    })

    // Save window size and position when resized or moved
    mainWindow.on('resize', () => {
      if (!mainWindow.isMaximized()) {
        const [width, height] = mainWindow.getSize()
        this.configPresenter.setSetting('windowSize', { width, height })
      }
    })

    mainWindow.on('move', () => {
      if (!mainWindow.isMaximized()) {
        const [x, y] = mainWindow.getPosition()
        this.configPresenter.setSetting('windowPosition', { x, y })
      }
    })

    mainWindow.on('closed', () => {
      this.windows.delete(MAIN_WIN)
      eventBus.emit('main-window-closed', mainWindow)
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // Add handler for regular link clicks
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        if (url.startsWith(process.env['ELECTRON_RENDERER_URL'] || '')) {
          return
        }
      }
      // 检查是否为外部链接
      const isExternal = url.startsWith('http:') || url.startsWith('https:')
      if (isExternal) {
        event.preventDefault()
        shell.openExternal(url)
      }
      // 内部路由变化则不阻止
    })

    mainWindow.on('show', () => {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
    })
    mainWindow.on('blur', () => {
      this.mainWindowFocused = false
    })
    mainWindow.on('focus', () => {
      this.mainWindowFocused = true
    })

    mainWindow.on('maximize', () => {
      mainWindow.webContents.send(WINDOW_EVENTS.WINDOW_MAXIMIZED)
    })

    mainWindow.on('unmaximize', () => {
      mainWindow.webContents.send(WINDOW_EVENTS.WINDOW_UNMAXIMIZED)
    })

    if (is.dev) {
      mainWindow.webContents.openDevTools()
    }

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
    this.windows.set(MAIN_WIN, mainWindow)

    // 初始化托盘
    if (!this.trayPresenter) {
      this.trayPresenter = new TrayPresenter(this)
    }

    const lang = this.configPresenter.getSetting<string>('language')
    this.resetContextMenu(lang || app.getLocale())

    return mainWindow
  }

  // 添加更新内容保护的方法
  private updateContentProtection(window: BrowserWindow, enabled: boolean): void {
    console.log('更新窗口内容保护状态:', enabled)
    if (enabled) {
      window.setContentProtection(enabled)
      window.webContents.setBackgroundThrottling(!enabled)
      window.webContents.setFrameRate(60)
      window.setBackgroundColor('#00000000')
      if (process.platform === 'darwin') {
        window.setHiddenInMissionControl(enabled)
        window.setSkipTaskbar(enabled)
      }
    }
    // 如果关闭内容保护，则使用默认设置
  }

  getWindow(windowName: string): BrowserWindow | undefined {
    return this.windows.get(windowName)
  }

  get mainWindow(): BrowserWindow | undefined {
    return this.getWindow(MAIN_WIN)
  }

  previewFile(filePath: string): void {
    const window = this.mainWindow
    if (window) {
      if (process.platform === 'darwin') {
        window.previewFile(filePath)
      } else {
        shell.openPath(filePath)
      }
    }
  }

  minimize(): void {
    const window = this.mainWindow
    if (window) {
      window.minimize()
    }
  }

  maximize(): void {
    const window = this.mainWindow
    if (window) {
      if (window.isMaximized()) {
        window.unmaximize()
      } else {
        window.maximize()
      }
    }
  }

  close(): void {
    const window = this.mainWindow
    if (window) {
      window.close()
    }
  }

  hide(): void {
    const window = this.mainWindow
    if (window) {
      window.hide()
    }
  }

  show(): void {
    const window = this.mainWindow
    if (window) {
      window.show()
    }
  }

  isMaximized(): boolean {
    const window = this.mainWindow
    return window ? window.isMaximized() : false
  }

  async resetContextMenu(lang: string): Promise<void> {
    const locale = lang === 'system' ? app.getLocale() : lang
    console.log('resetContextMenu', locale)
    if (this.contextMenuDisposer) {
      this.contextMenuDisposer()
      this.contextMenuDisposer = undefined
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
    const window = this.mainWindow
    if (window) {
      const labels = getContextMenuLabels(locale)
      this.contextMenuDisposer = contextMenu({
        window: window,
        shouldShowMenu(event, params) {
          console.log('shouldShowMenu 被调用:', params.x, params.y, params.mediaType, event)
          return true
        },
        labels
      })
    } else {
      console.error('无法重置上下文菜单: 找不到主窗口')
    }
  }
  isMainWindowFocused(): boolean {
    return this.mainWindowFocused
  }
}
