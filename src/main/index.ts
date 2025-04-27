import { app, BrowserWindow, protocol } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { presenter } from './presenter'
import { ProxyMode, proxyConfig } from './presenter/proxyConfig'
import path from 'path'
import fs from 'fs'
import { eventBus } from './eventbus'
import { WINDOW_EVENTS } from './events'
import { setLoggingEnabled } from '@shared/logger'

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

// 检查authToken并获取用户信息
const checkAuthTokenAndFetchUserInfo = async (): Promise<void> => {
  try {
    const token = presenter.configPresenter.getAuthToken()
    if (token) {
      console.log('检测到已保存的认证令牌，开始获取用户信息')
      const apiBaseUrl = presenter.configPresenter.getApiBaseUrl()
      const response = await fetch(`${apiBaseUrl}/api/user/current`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })
      
      if (!response.ok) {
        throw new Error(`获取用户信息失败: ${response.status} ${response.statusText}`)
      }
      
      const data = await response.json()
      if (data) {
        // 保存用户信息，直接使用返回的数据
        presenter.configPresenter.setUserInfo(data)
        console.log('成功获取并保存用户信息')
      } else {
        console.error('获取用户信息响应格式错误:', data)
      }
    }
  } catch (error) {
    console.error('启动时获取用户信息出错:', error)
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.wefonk.deepchat')
  // 从配置中读取日志设置
  const loggingEnabled = presenter.configPresenter.getLoggingEnabled()
  setLoggingEnabled(loggingEnabled)

  console.log('应用程序准备就绪')

  // 检查认证令牌并获取用户信息
  checkAuthTokenAndFetchUserInfo()

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

  // 创建主窗口
  presenter.windowPresenter.createMainWindow()
  presenter.shortcutPresenter.registerShortcuts()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      presenter.windowPresenter.createMainWindow()
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
    presenter.shortcutPresenter.unregisterShortcuts()
    eventBus.emit(WINDOW_EVENTS.APP_BLUR)
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
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  presenter.destroy()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  presenter.destroy()
})
