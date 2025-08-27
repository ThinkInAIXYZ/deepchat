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
import { spawn, ChildProcess } from 'child_process'
import AdmZip from 'adm-zip' // 导入 adm-zip 库

// 声明 internalProxyProcess 变量
let internalProxyProcess: ChildProcess | null = null

// 辅助函数，根据开发/生产环境获取资源基础路径
function getResourceBasePath() {
  if (is.dev) {
    return app.getAppPath()
  } else {
    return process.resourcesPath
  }
}

// 辅助函数，获取运行时可执行文件的完整路径
function getRuntimeExecutablePath(runtimeName: string) {
  const basePath = getResourceBasePath()
  let runtimeDir
  if (is.dev) {
    // 在开发模式下，'runtime' 在项目根目录
    runtimeDir = path.join(basePath, 'runtime', runtimeName)
  } else {
    // 在生产模式下，根据 electron-builder.yml 的配置，'runtime' 在 'app.asar.unpacked' 内部
    runtimeDir = path.join(basePath, 'app.asar.unpacked', 'runtime', runtimeName)
  }
  const executableName = `${runtimeName}${process.platform === 'win32' ? '.exe' : ''}`
  return path.join(runtimeDir, executableName)
}

// 辅助函数，获取代理脚本的完整路径
function getProxyScriptPath() {
  const basePath = getResourceBasePath()
  // 在生产模式下，proxy.js 位于 'app.asar.unpacked' 内部
  return path.join(basePath, 'app.asar.unpacked', 'internal-proxy', 'proxy.js')
}

async function unzipProxyIfNeeded() {
  const PROXY_ZIP_NAME = 'proxy.zip'
  const PROXY_JS_NAME = 'proxy.js'

  const proxyJsPath = getProxyScriptPath()
  const proxyDir = path.dirname(proxyJsPath)
  const proxyZipPath = path.join(proxyDir, PROXY_ZIP_NAME)

  if (fs.existsSync(proxyJsPath)) {
    console.log(`[GeminiProxy] ${PROXY_JS_NAME} already exists at ${proxyJsPath}. Skipping unzip.`)
    return
  }

  if (!fs.existsSync(proxyZipPath)) {
    console.error(`[GeminiProxy] Proxy zip file not found at: ${proxyZipPath}`)
    return
  }

  console.log(`[GeminiProxy] Unzipping ${proxyZipPath} to ${proxyDir}`)
  try {
    const zip = new AdmZip(proxyZipPath)
    zip.extractAllTo(proxyDir, true) // true to overwrite existing files
    console.log('[GeminiProxy] Unzip successful.')
  } catch (error) {
    console.error(`[GeminiProxy] Failed to unzip with adm-zip: ${(error as Error).message}`)
    // You might want to throw the error or handle it more gracefully
  }
}

// 启动内部代理服务
function startInternalProxy() {
  console.log('[GeminiProxy] --- startInternalProxy called ---')
  if (internalProxyProcess) {
    console.log('[GeminiProxy] Proxy process already exists. Aborting.')
    return
  }

  // 使用辅助函数获取正确的 bunPath 和 proxyScriptPath
  const bunPath = getRuntimeExecutablePath('bun')
  const proxyScriptPath = getProxyScriptPath()

  console.log(`[GeminiProxy] Calculated bunPath: ${bunPath}`)
  console.log(`[GeminiProxy] bunPath exists: ${fs.existsSync(bunPath)}`)
  console.log(`[GeminiProxy] Calculated proxyScriptPath: ${proxyScriptPath}`)
  console.log(`[GeminiProxy] proxyScriptPath exists: ${fs.existsSync(proxyScriptPath)}`)

  const userDataPath = app.getPath('userData')
  console.log(`[GeminiProxy] User data path: ${userDataPath}`)

  // 优先使用环境变量，如果未设置，则使用用户数据目录下的默认路径
  const configFilePath =
    process.env.GEMINI_PROXY_CFG_FILE || path.join(userDataPath, 'gemini-proxy-cfg.json')
  const logFilePath =
    process.env.GEMINI_PROXY_LOG_FILE || path.join(userDataPath, 'gemini-proxy.log')

  console.log(`[GeminiProxy] Using config file path: ${configFilePath}`)
  console.log(`[GeminiProxy] Using log file path: ${logFilePath}`)

  // 如果配置文件不存在，创建一个默认的
  if (!fs.existsSync(configFilePath)) {
    console.log('[GeminiProxy] Config file not found. Creating default one.')
    const defaultConfig = {
      port: 9999,
      host: '127.0.0.1',
      log_level: 'info',
      initial_model: 'gemini-2.5-flash',
      outbound_proxy_url: '', // 留空让用户填写
      rateLimit: {
        enabled: true,
        qpsLimit: 1,
        maxConcurrent: 1,
        queueTimeout: 30
      },
      initial_timeout_ms: 30000,
      idle_timeout_ms: 45000,
      job_execution_timeout_ms: 60000
    }
    try {
      // 确保目录存在
      fs.mkdirSync(path.dirname(configFilePath), { recursive: true })
      fs.writeFileSync(configFilePath, JSON.stringify(defaultConfig, null, 2))
      console.log('[GeminiProxy] Default config file created successfully.')
    } catch (error) {
      console.error(
        `[GeminiProxy] ERROR: Failed to create default proxy config file: ${(error as Error).message}`
      )
    }
  }

  // 定义要注入到子进程的环境变量
  const proxyEnv = {
    ...process.env,
    GEMINI_PROXY_CFG_FILE: configFilePath,
    GEMINI_PROXY_LOG_FILE: logFilePath
  }
  console.log(`[GeminiProxy] Environment variables for spawn: ${JSON.stringify(proxyEnv, null, 2)}`)

  try {
    console.log('[GeminiProxy] Attempting to spawn process...')
    // 移除 detached: true 来防止孤儿进程
    internalProxyProcess = spawn(bunPath, [proxyScriptPath], {
      stdio: 'ignore',
      env: proxyEnv
    })
    console.log('[GeminiProxy] Spawn command issued successfully. Process object created.')

    internalProxyProcess.on('exit', (code, signal) => {
      console.log(
        `[GeminiProxy] [SPAWN EVENT] Process exited with code: ${code}, signal: ${signal}`
      )
      internalProxyProcess = null
    })

    internalProxyProcess.on('error', (err) => {
      console.error(
        `[GeminiProxy] [SPAWN EVENT] Process failed to start or encountered an error: ${err.toString()}`
      )
      internalProxyProcess = null
    })
  } catch (spawnError) {
    console.error(
      `[GeminiProxy] [SPAWN CATCH] Caught synchronous error on spawn: ${(spawnError as Error).toString()}`
    )
  }
}

// 停止内部代理服务
function stopInternalProxy() {
  console.log('[GeminiProxy] --- stopInternalProxy called ---')
  if (internalProxyProcess) {
    console.log('[GeminiProxy] Stopping internal proxy process...')
    try {
      internalProxyProcess.kill() // 默认发送 SIGTERM
    } catch (e) {
      console.error(`[GeminiProxy] Error while killing process: ${(e as Error).message}`)
    }
    internalProxyProcess = null
  } else {
    console.log('[GeminiProxy] No proxy process to stop.')
  }
}

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
  await unzipProxyIfNeeded()
  // 启动内部代理服务
  console.log('[GeminiProxy] --- app.whenReady() triggered ---')
  startInternalProxy()

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
      // console.log('deepcdn', request.url)
      const filePath = request.url.slice('deepcdn://'.length)
      // 根据开发/生产环境确定资源路径（按候选目录探测，避免错误拼接导致重复 resources）
      const candidates = is.dev
        ? [path.join(app.getAppPath(), 'resources')]
        : [
            path.join(process.resourcesPath, 'app.asar.unpacked', 'resources'),
            path.join(process.resourcesPath, 'resources'),
            process.resourcesPath
          ]
      const baseResourcesDir =
        candidates.find((p) => fs.existsSync(path.join(p, 'cdn'))) || candidates[0]

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

  // 停止内部代理服务
  console.log('[GeminiProxy] --- app.will-quit() triggered ---')
  stopInternalProxy()

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
