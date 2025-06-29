import { app, protocol } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { presenter } from './presenter'
import { ProxyMode, proxyConfig } from './presenter/proxyConfig'
import path from 'path'
import fs from 'fs'
import { eventBus } from './eventbus'
import { WINDOW_EVENTS, TRAY_EVENTS, FLOATING_BUTTON_EVENTS } from './events'
import { setLoggingEnabled } from '@shared/logger'
import { is } from '@electron-toolkit/utils' // 确保导入 is
import { handleShowHiddenWindow } from './utils'

// 设置应用命令行参数
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required') // 允许视频自动播放
app.commandLine.appendSwitch('webrtc-max-cpu-consumption-percentage', '100') // 设置 WebRTC 最大 CPU 占用率
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096') // 设置 V8 堆内存大小
app.commandLine.appendSwitch('ignore-certificate-errors') // 忽略证书错误 (开发或特定场景下使用)

// 根据平台设置特定命令行参数
if (process.platform == 'win32') {
  // Windows 平台特定参数 (目前注释掉)
  // app.commandLine.appendSwitch('in-process-gpu')
  // app.commandLine.appendSwitch('wm-window-animations-disabled')
}
if (process.platform === 'darwin') {
  // macOS 平台特定参数
  app.commandLine.appendSwitch('disable-features', 'DesktopCaptureMacV2,IOSurfaceCapturer')
}

// 初始化 DeepLink 处理
presenter.deeplinkPresenter.init()

// 等待 Electron 初始化完成
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.wefonk.deepchat')

  // 从配置中读取日志设置并应用
  const loggingEnabled = presenter.configPresenter.getLoggingEnabled()
  setLoggingEnabled(loggingEnabled)

  // 初始化托盘图标和菜单，并存储 presenter 实例
  presenter.setupTray()

  // 立即进行基本初始化，不等待窗口ready-to-show事件
  presenter.init()

  // 从配置中读取代理设置并初始化
  const proxyMode = presenter.configPresenter.getProxyMode() as ProxyMode
  const customProxyUrl = presenter.configPresenter.getCustomProxyUrl()
  proxyConfig.initFromConfig(proxyMode as ProxyMode, customProxyUrl)

  // 在开发环境中为新创建的窗口添加 F12 DevTools 支持，生产环境忽略 CmdOrControl + R
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 处理应用激活事件 (如 macOS 点击 Dock 图标)
  app.on('activate', function () {
    // 在 macOS 上，点击 Dock 图标时重新创建窗口很常见
    // 同时处理已隐藏窗口的显示
    const allWindows = presenter.windowPresenter.getAllWindows()
    if (allWindows.length === 0) {
      presenter.windowPresenter.createShellWindow({
        initialTab: {
          url: 'local://chat'
        }
      })
    } else {
      // 尝试显示最近焦点的窗口，否则显示第一个窗口
      const targetWindow = presenter.windowPresenter.getFocusedWindow() || allWindows[0]
      if (!targetWindow.isDestroyed()) {
        targetWindow.show()
        targetWindow.focus() // 确保窗口获得焦点
      } else {
        console.warn('App activated but target window is destroyed, creating new window.') // 保持 warn
        presenter.windowPresenter.createShellWindow({
          // 如果目标窗口已销毁，创建新窗口
          initialTab: { url: 'local://chat' }
        })
      }
    }
  })

  // 如果没有窗口，创建主窗口 (应用首次启动时)
  if (presenter.windowPresenter.getAllWindows().length === 0) {
    console.log('Main: Creating initial shell window on app startup')
    try {
      const windowId = await presenter.windowPresenter.createShellWindow({
        initialTab: {
          url: 'local://chat'
        }
      })
      if (windowId) {
        console.log(`Main: Initial shell window created successfully with ID: ${windowId}`)
      } else {
        console.error('Main: Failed to create initial shell window - returned null')
      }
    } catch (error) {
      console.error('Main: Error creating initial shell window:', error)
    }
  } else {
    console.log('Main: Shell windows already exist, skipping initial window creation')
  }

  // 注册全局快捷键
  presenter.shortcutPresenter.registerShortcuts()

  // 监听悬浮按钮配置变化事件
  eventBus.on(FLOATING_BUTTON_EVENTS.ENABLED_CHANGED, async (enabled: boolean) => {
    try {
      await presenter.floatingButtonPresenter.setEnabled(enabled)
    } catch (error) {
      console.error('Failed to set floating button enabled state:', error)
    }
  })

  // 托盘 检测更新
  eventBus.on(TRAY_EVENTS.CHECK_FOR_UPDATES, () => {
    const allWindows = presenter.windowPresenter.getAllWindows()

    // 查找目标窗口 (焦点窗口或第一个窗口)
    const targetWindow = presenter.windowPresenter.getFocusedWindow() || allWindows![0]
    presenter.windowPresenter.show(targetWindow.id)
    targetWindow.focus() // 确保窗口置顶

    // 触发更新
    presenter.upgradePresenter.checkUpdate()
  })

  // 监听显示/隐藏窗口事件 (从托盘或快捷键或悬浮窗口触发)
  eventBus.on(TRAY_EVENTS.SHOW_HIDDEN_WINDOW, handleShowHiddenWindow)

  // 监听浏览器窗口获得焦点事件
  app.on('browser-window-focus', () => {
    // 当任何窗口获得焦点时，注册快捷键
    presenter.shortcutPresenter.registerShortcuts()
    eventBus.sendToMain(WINDOW_EVENTS.APP_FOCUS)
  })

  // 监听浏览器窗口失去焦点事件
  app.on('browser-window-blur', () => {
    // 检查是否所有窗口都已失去焦点，如果是则注销快捷键
    // 使用短延迟以处理窗口间焦点切换
    setTimeout(() => {
      const allWindows = presenter.windowPresenter.getAllWindows()
      const isAnyWindowFocused = allWindows.some((win) => !win.isDestroyed() && win.isFocused())

      if (!isAnyWindowFocused) {
        presenter.shortcutPresenter.unregisterShortcuts()
        eventBus.sendToMain(WINDOW_EVENTS.APP_BLUR)
      }
    }, 50) // 50毫秒延迟
  })

  // 注册 'deepcdn' 协议，用于加载应用内置资源 (模拟 CDN)
  protocol.handle('deepcdn', (request) => {
    try {
      const filePath = request.url.slice('deepcdn://'.length)
      // 根据开发/生产环境确定资源路径
      const resourcesPath = is.dev
        ? path.join(app.getAppPath(), 'resources')
        : process.resourcesPath
      // 检查资源是否被解包 (app.asar.unpacked)，优先使用解包路径
      const unpackedResourcesPath = path.join(resourcesPath, 'app.asar.unpacked', 'resources')

      const baseResourcesDir = fs.existsSync(unpackedResourcesPath)
        ? unpackedResourcesPath
        : path.join(resourcesPath, 'resources') // 否则使用默认资源路径

      const fullPath = path.join(baseResourcesDir, 'cdn', filePath)

      // 根据文件扩展名决定 MIME 类型
      let mimeType = 'application/octet-stream' // 默认类型
      if (filePath.endsWith('.js')) {
        mimeType = 'text/javascript'
      } else if (filePath.endsWith('.css')) {
        mimeType = 'text/css'
      } else if (filePath.endsWith('.json')) {
        mimeType = 'application/json'
      } else if (filePath.endsWith('.wasm')) {
        mimeType = 'application/wasm'
      } else if (filePath.endsWith('.data')) {
        mimeType = 'application/octet-stream'
      } else if (filePath.endsWith('.html')) {
        mimeType = 'text/html'
      }

      // 检查文件是否存在
      if (!fs.existsSync(fullPath)) {
        console.warn(`deepcdn handler: File not found: ${fullPath}`) // 保持 warn
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
      console.error('处理deepcdn请求时出错:', error) // 保持 error
      const errorMessage = error instanceof Error ? error.message : String(error)
      return new Response(`服务器错误: ${errorMessage}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      })
    }
  })

  // 注册 'imgcache' 协议，用于处理图片缓存
  protocol.handle('imgcache', (request) => {
    try {
      const filePath = request.url.slice('imgcache://'.length)
      // 图片存储在用户数据目录的 images 子文件夹中
      const fullPath = path.join(app.getPath('userData'), 'images', filePath)

      // 检查文件是否存在
      if (!fs.existsSync(fullPath)) {
        console.warn(`imgcache handler: Image file not found: ${fullPath}`) // 保持 warn
        return new Response(`找不到图片: ${filePath}`, {
          status: 404,
          headers: { 'Content-Type': 'text/plain' }
        })
      }

      // 根据文件扩展名确定 MIME 类型
      let mimeType = 'application/octet-stream' // 默认类型
      if (filePath.endsWith('.png')) {
        mimeType = 'image/png'
      } else if (filePath.endsWith('.gif')) {
        mimeType = 'image/gif'
      } else if (filePath.endsWith('.webp')) {
        mimeType = 'image/webp'
      } else if (filePath.endsWith('.svg')) {
        mimeType = 'image/svg+xml'
      } else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
        mimeType = 'image/jpeg'
      } else if (filePath.endsWith('.bmp')) {
        mimeType = 'image/bmp'
      } else if (filePath.endsWith('.ico')) {
        mimeType = 'image/x-icon'
      } else if (filePath.endsWith('.avif')) {
        mimeType = 'image/avif'
      }

      // 读取文件并返回响应
      const fileContent = fs.readFileSync(fullPath)
      return new Response(fileContent, {
        headers: { 'Content-Type': mimeType }
      })
    } catch (error: unknown) {
      console.error('处理imgcache请求时出错:', error) // 保持 error
      const errorMessage = error instanceof Error ? error.message : String(error)
      return new Response(`服务器错误: ${errorMessage}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      })
    }
  })
}) // app.whenReady().then 结束

// 当所有主窗口都关闭时的处理逻辑
// macOS 平台会保留在 Dock 中，Windows 会保留在托盘。
// 悬浮按钮窗口不计入主窗口数量
app.on('window-all-closed', () => {
  // 检查是否还有非悬浮按钮的窗口
  const mainWindows = presenter.windowPresenter.getAllWindows()

  if (mainWindows.length === 0) {
    // 只有悬浮按钮窗口时，在非 macOS 平台退出应用
    if (process.platform !== 'darwin') {
      console.log('main: All main windows closed on non-macOS platform, quitting app')
      app.quit()
    } else {
      console.log('main: All main windows closed on macOS, keeping app running in dock')
    }
  }
})

// 在应用即将退出时触发，适合进行最终的资源清理 (如销毁托盘)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.on('will-quit', (_event) => {
  console.log('main: app will-quit event triggered.') // 保留关键日志

  // 销毁托盘图标
  if (presenter.trayPresenter) {
    console.log('main: Destroying tray during will-quit.') // 保留关键日志
    presenter.trayPresenter.destroy()
  } else {
    console.warn('main: TrayPresenter not found in presenter during will-quit.') // 保持 warn
  }

  // 调用 presenter 的销毁方法进行其他清理
  if (presenter.destroy) {
    console.log('main: Calling presenter.destroy() during will-quit.') // 保留关键日志
    presenter.destroy()
  }
})

// 在应用退出之前触发，早于 will-quit。通常不如 will-quit 适合资源清理。
// 在这里销毁悬浮按钮，确保应用能正常退出
app.on('before-quit', () => {
  try {
    presenter.floatingButtonPresenter.destroy()
  } catch (error) {
    console.error('main: Error destroying floating button during before-quit:', error)
  }
})
