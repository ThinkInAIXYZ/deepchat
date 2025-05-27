import { app, protocol } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { presenter } from './presenter'
import { ProxyMode, proxyConfig } from './presenter/proxyConfig'
import path from 'path'
import fs from 'fs'
import { eventBus } from './eventbus'
import { WINDOW_EVENTS, TRAY_EVENTS } from './events'
import { setLoggingEnabled } from '@shared/logger'
import { TrayPresenter } from './presenter/trayPresenter'
import { config } from 'dotenv'

// 初始化环境变量
config()

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('webrtc-max-cpu-consumption-percentage', '100')
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096')
app.commandLine.appendSwitch('ignore-certificate-errors')

if (process.platform == 'win32') {
  // app.commandLine.appendSwitch('in-process-gpu')
  // app.commandLine.appendSwitch('wm-window-animations-disabled')
}
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'DesktopCaptureMacV2,IOSurfaceCapturer')
}

// 初始化 DeepLink 处理
presenter.deeplinkPresenter.init()

// 初始化托盘
const trayPresenter = new TrayPresenter()

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.wefonk.deepchat')
  // 从配置中读取日志设置
  const loggingEnabled = presenter.configPresenter.getLoggingEnabled()
  setLoggingEnabled(loggingEnabled)

  console.log('app ready')

  // 初始化托盘
  trayPresenter.init()

  // 从配置中读取代理设置并初始化
  const proxyMode = presenter.configPresenter.getProxyMode() as ProxyMode
  const customProxyUrl = presenter.configPresenter.getCustomProxyUrl()
  proxyConfig.initFromConfig(proxyMode as ProxyMode, customProxyUrl)

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    const allWindows = presenter.windowPresenter.getAllWindows()
    if (allWindows.length === 0) {
      presenter.windowPresenter.createShellWindow({
        initialTab: {
          url: 'local://chat'
        }
      })
    } else {
      allWindows[0].show()
    }
  })

  // 创建主窗口
  presenter.windowPresenter.createShellWindow({
    initialTab: {
      url: 'local://chat'
    }
  })
  presenter.shortcutPresenter.registerShortcuts()

  // 监听显示窗口事件
  eventBus.on(TRAY_EVENTS.SHOW_WINDOW, () => {
    if (presenter.windowPresenter.windows.size === 0) {
      presenter.windowPresenter.createShellWindow({
        initialTab: {
          url: 'local://chat'
        }
      })
    } else {
      presenter.windowPresenter.mainWindow?.show()
    }
  })
  // 监听应用程序获得焦点事件
  app.on('browser-window-focus', () => {
    presenter.shortcutPresenter.registerShortcuts()
    eventBus.emit(WINDOW_EVENTS.APP_FOCUS)
  })

  // 监听应用程序失去焦点事件
  app.on('browser-window-blur', () => {
    // 检查是否所有窗口都失去了焦点
    const allWindows = presenter.windowPresenter.getAllWindows()
    const isAnyWindowFocused = allWindows.some((win) => !win.isDestroyed() && win.isFocused())

    if (!isAnyWindowFocused) {
      presenter.shortcutPresenter.unregisterShortcuts()
      eventBus.emit(WINDOW_EVENTS.APP_BLUR)
    }
  })

  protocol.handle('deepcdn', (request) => {
    try {
      const filePath = request.url.slice('deepcdn://'.length)
      const fullPath = path.join(app.getAppPath(), 'resources', 'cdn', filePath)
      // 根据文件扩展名决定MIME类型
      let mimeType = 'application/octet-stream'
      if (filePath.endsWith('.js')) {
        mimeType = 'text/javascript'
      } else if (filePath.endsWith('.css')) {
        mimeType = 'text/css'
      }

      // 检查文件是否存在
      if (!fs.existsSync(fullPath)) {
        return new Response(`找不到文件: ${filePath}`, {
          status: 404,
          headers: { 'Content-Type': 'text/plain' }
        })
      }

      // 读取文件并返回响应
      const fileContent = fs.readFileSync(fullPath)
      return new Response(fileContent, {
        headers: { 'Content-Type': mimeType }
      })
    } catch (error: unknown) {
      console.error('处理deepcdn请求时出错:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      return new Response(`服务器错误: ${errorMessage}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      })
    }
  })

  // 注册 imgcache 协议处理图片缓存
  protocol.handle('imgcache', (request) => {
    try {
      const filePath = request.url.slice('imgcache://'.length)
      const fullPath = path.join(app.getPath('userData'), 'images', filePath)

      // 检查文件是否存在
      if (!fs.existsSync(fullPath)) {
        return new Response(`找不到图片: ${filePath}`, {
          status: 404,
          headers: { 'Content-Type': 'text/plain' }
        })
      }

      // 根据文件扩展名确定MIME类型
      let mimeType = 'image/jpeg' // 默认MIME类型
      if (filePath.endsWith('.png')) {
        mimeType = 'image/png'
      } else if (filePath.endsWith('.gif')) {
        mimeType = 'image/gif'
      } else if (filePath.endsWith('.webp')) {
        mimeType = 'image/webp'
      } else if (filePath.endsWith('.svg')) {
        mimeType = 'image/svg+xml'
      }

      // 读取文件并返回响应
      const fileContent = fs.readFileSync(fullPath)
      return new Response(fileContent, {
        headers: { 'Content-Type': mimeType }
      })
    } catch (error: unknown) {
      console.error('处理imgcache请求时出错:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      return new Response(`服务器错误: ${errorMessage}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      })
    }
  })
})
// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  presenter.destroy()
  trayPresenter.destroy()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  presenter.destroy()
  trayPresenter.destroy()
})
