import { app, BrowserWindow } from 'electron'
import { presenter } from '@/presenter'
import { IDeeplinkPresenter, MCPServerConfig } from '@shared/presenter'
import path from 'path'
import { DEEPLINK_EVENTS, MCP_EVENTS, WINDOW_EVENTS } from '@/events'
import { eventBus, SendTarget } from '@/eventbus'

interface MCPInstallConfig {
  mcpServers: Record<
    string,
    {
      command?: string
      args?: string[]
      env?: Record<string, string> | string
      descriptions?: string
      icons?: string
      autoApprove?: string[]
      disable?: boolean
      url?: string
      type?: 'sse' | 'stdio' | 'http'
    }
  >
}

/**
 * DeepLink 处理器类
 * 负责处理 deepchat:// 协议的链接
 * deepchat://start 唤起应用，进入到默认的新会话界面
 * deepchat://start?msg=你好 唤起应用，进入新会话界面，并且带上默认消息
 * deepchat://start?msg=你好&model=deepseek-chat 唤起应用，进入新会话界面，并且带上默认消息，model先进行完全匹配，选中第一个命中的。没有命中的就进行模糊匹配，只要包含这个字段的第一个返回，如果都没有就忽略用默认
 * deepchat://mcp/install?json=base64JSONData 通过json数据直接安装mcp
 */
export class DeeplinkPresenter implements IDeeplinkPresenter {
  private startupUrl: string | null = null
  private pendingMcpInstallUrl: string | null = null

  init(): void {
    // 检查启动时的命令行参数是否包含deeplink URL（冷启动情况）
    const startupDeepLinkUrl = this.checkStartupDeepLink()
    if (startupDeepLinkUrl) {
      console.log('Found startup deeplink URL:', startupDeepLinkUrl)
      this.startupUrl = startupDeepLinkUrl
    }

    // 注册协议处理器
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('deepchat', process.execPath, [
          path.resolve(process.argv[1])
        ])
      }
    } else {
      app.setAsDefaultProtocolClient('deepchat')
    }

    // 处理 macOS 上协议被调用的情况
    app.on('open-url', (event, url) => {
      event.preventDefault()
      console.log('open-url event received:', url)
      if (!app.isReady()) {
        console.log('App not ready yet, saving URL:', url)
        this.startupUrl = url
      } else {
        console.log('App is ready, checking URL:', url)
        this.processDeepLink(url)
      }
    })

    // 监听窗口内容加载完成事件
    eventBus.once(WINDOW_EVENTS.FIRST_CONTENT_LOADED, () => {
      console.log('Window content loaded. Processing DeepLink if exists.')
      if (this.startupUrl) {
        console.log('Processing startup URL:', this.startupUrl)
        this.processDeepLink(this.startupUrl)
        this.startupUrl = null
      }
    })

    // 监听MCP初始化完成事件
    eventBus.on(MCP_EVENTS.INITIALIZED, () => {
      console.log('MCP initialized. Processing pending MCP install if exists.')
      if (this.pendingMcpInstallUrl) {
        console.log('Processing pending MCP install URL:', this.pendingMcpInstallUrl)
        this.handleDeepLink(this.pendingMcpInstallUrl)
        this.pendingMcpInstallUrl = null
      }
    })

    // 处理 Windows 上协议被调用的情况
    const gotTheLock = app.requestSingleInstanceLock()
    if (!gotTheLock) {
      app.quit() // Exit trigger: Second instance
    } else {
      app.on('second-instance', (_event, commandLine) => {
        // 用户尝试运行第二个实例，我们应该聚焦到我们的窗口
        if (presenter.windowPresenter.mainWindow) {
          if (presenter.windowPresenter.mainWindow.isMinimized()) {
            presenter.windowPresenter.mainWindow.restore()
          }
          presenter.windowPresenter.mainWindow.show()
          presenter.windowPresenter.mainWindow.focus()
        }
        if (process.platform === 'win32') {
          // 在 Windows 上，命令行参数包含协议 URL
          const deepLinkUrl = commandLine.find((arg) => arg.startsWith('deepchat://'))
          if (deepLinkUrl) {
            if (!app.isReady()) {
              console.log('Windows: App not ready yet, saving URL:', deepLinkUrl)
              this.startupUrl = deepLinkUrl
            } else {
              console.log('Windows: App is ready, checking URL:', deepLinkUrl)
              this.processDeepLink(deepLinkUrl)
            }
          }
        }
      })
    }
  }

  // 新增：处理DeepLink的方法，根据URL类型和系统状态决定如何处理
  private processDeepLink(url: string): void {
    console.log('processDeepLink called with URL:', url)
    try {
      const urlObj = new URL(url)
      const command = urlObj.hostname
      const subCommand = urlObj.pathname.slice(1)

      console.log('Parsed deeplink - command:', command, 'subCommand:', subCommand)

      // 如果是MCP安装命令，需要等待MCP初始化完成
      if (command === 'mcp' && subCommand === 'install') {
        console.log('MCP install deeplink detected')
        if (!presenter.mcpPresenter.isReady()) {
          console.log('MCP not ready yet, saving MCP install URL for later')
          this.pendingMcpInstallUrl = url
          return
        } else {
          console.log('MCP is ready, processing MCP install immediately')
        }
      }

      // 其他类型的DeepLink或MCP已初始化完成，直接处理
      this.handleDeepLink(url)
    } catch (error) {
      console.error('Error processing DeepLink:', error)
    }
  }

  /**
   * 检查启动时的deeplink URL
   * 用于处理冷启动时传递的deeplink
   */
  private checkStartupDeepLink(): string | null {
    console.log('Checking for startup deeplink...')

    // 首先检查环境变量（在main.ts中设置的）
    const envDeepLink = process.env.STARTUP_DEEPLINK
    if (envDeepLink) {
      console.log('Found deeplink in startup environment variable:', envDeepLink)
      // 清理环境变量，避免重复处理
      delete process.env.STARTUP_DEEPLINK
      return envDeepLink
    }

    // 检查命令行参数 - 尝试多种deeplink格式
    const deepLinkArg = process.argv.find((arg) => {
      return arg.startsWith('deepchat://') || arg.includes('deepchat://') || arg.match(/^deepchat:/)
    })

    if (deepLinkArg) {
      console.log('Found deeplink in command line arguments:', deepLinkArg)
      return deepLinkArg
    }

    // 检查所有命令行参数
    console.log('All command line arguments:', process.argv)

    console.log('No startup deeplink found')
    return null
  }

  async handleDeepLink(url: string): Promise<void> {
    console.log('Received DeepLink:', url)

    try {
      const urlObj = new URL(url)

      if (urlObj.protocol !== 'deepchat:') {
        console.error('Unsupported protocol:', urlObj.protocol)
        return
      }

      // 从 hostname 获取命令
      const command = urlObj.hostname

      // 处理不同的命令
      if (command === 'start') {
        await this.handleStart(urlObj.searchParams)
      } else if (command === 'mcp') {
        // 处理 mcp/install 命令
        const subCommand = urlObj.pathname.slice(1) // 移除开头的斜杠
        if (subCommand === 'install') {
          await this.handleMcpInstall(urlObj.searchParams)
        } else {
          console.warn('Unknown MCP subcommand:', subCommand)
        }
      } else {
        console.warn('Unknown DeepLink command:', command)
      }
    } catch (error) {
      console.error('Error processing DeepLink:', error)
    }
  }

  async handleStart(params: URLSearchParams): Promise<void> {
    console.log('Processing start command, parameters:', Object.fromEntries(params.entries()))

    let msg = params.get('msg')
    if (!msg) {
      return
    }

    // Security: Validate and sanitize message content
    msg = this.sanitizeMessageContent(decodeURIComponent(msg))
    if (!msg) {
      console.warn('Message content was rejected by security filters')
      return
    }

    // 如果有模型参数，尝试设置
    let modelId = params.get('model')
    if (modelId && modelId.trim() !== '') {
      modelId = this.sanitizeStringParameter(decodeURIComponent(modelId))
    }

    let systemPrompt = params.get('system')
    if (systemPrompt && systemPrompt.trim() !== '') {
      systemPrompt = this.sanitizeStringParameter(decodeURIComponent(systemPrompt))
    } else {
      systemPrompt = ''
    }

    let mentions: string[] = []
    const mentionsParam = params.get('mentions')
    if (mentionsParam && mentionsParam.trim() !== '') {
      mentions = decodeURIComponent(mentionsParam)
        .split(',')
        .map((mention) => this.sanitizeStringParameter(mention.trim()))
        .filter((mention) => mention.length > 0)
    }

    // SECURITY: Disable auto-send functionality to prevent abuse
    // The yolo parameter has been removed for security reasons
    const autoSend = false
    console.log('msg:', msg)
    console.log('modelId:', modelId)
    console.log('systemPrompt:', systemPrompt)
    console.log('autoSend:', autoSend, '(disabled for security)')

    const focusedWindow = presenter.windowPresenter.getFocusedWindow()
    if (focusedWindow) {
      focusedWindow.show()
      focusedWindow.focus()
    } else {
      presenter.windowPresenter.show()
    }

    const windowId = focusedWindow?.id || 1
    await this.ensureChatTabActive(windowId)
    eventBus.sendToRenderer(DEEPLINK_EVENTS.START, SendTarget.DEFAULT_TAB, {
      msg,
      modelId,
      systemPrompt,
      mentions,
      autoSend
    })
  }

  /**
   * 确保有一个活动的 chat 标签页
   * @param windowId 窗口ID
   */
  private async ensureChatTabActive(windowId: number): Promise<void> {
    try {
      const tabPresenter = presenter.tabPresenter
      const tabsData = await tabPresenter.getWindowTabsData(windowId)
      const chatTab = tabsData.find(
        (tab) =>
          tab.url === 'local://chat' || tab.url.includes('#/chat') || tab.url.endsWith('/chat')
      )
      if (chatTab) {
        if (!chatTab.isActive) {
          await tabPresenter.switchTab(chatTab.id)
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }
      // Shell windows no longer create chat tabs
    } catch (error) {
      console.error('Error ensuring chat tab active:', error)
    }
  }

  async handleMcpInstall(params: URLSearchParams): Promise<void> {
    console.log('Processing mcp/install command, parameters:', Object.fromEntries(params.entries()))

    // 获取 JSON 数据
    const jsonBase64 = params.get('code')
    if (!jsonBase64) {
      console.error("Missing 'code' parameter")
      return
    }

    console.log('Found code parameter, processing MCP config')

    try {
      // 解码 Base64 并解析 JSON
      const jsonString = Buffer.from(jsonBase64, 'base64').toString('utf-8')
      const mcpConfig = JSON.parse(jsonString) as MCPInstallConfig

      console.log('Parsed MCP config:', mcpConfig)

      // 检查 MCP 配置是否有效
      if (!mcpConfig || !mcpConfig.mcpServers) {
        console.error('Invalid MCP configuration: missing mcpServers field')
        return
      }

      // 检查应用程序是否已经完全启动（有窗口存在）
      const allWindows = presenter.windowPresenter.getAllWindows()
      const hasWindows = allWindows.length > 0

      console.log('Window check - hasWindows:', hasWindows, 'windowCount:', allWindows.length)

      // Prepare complete MCP configuration for all servers
      const completeMcpConfig: { mcpServers: Record<string, any> } = { mcpServers: {} }

      // 遍历并安装所有 MCP 服务器
      for (const [serverName, serverConfig] of Object.entries(mcpConfig.mcpServers)) {
        let determinedType: 'sse' | 'stdio' | null = null
        const determinedCommand: string | undefined = serverConfig.command
        const determinedUrl: string | undefined = serverConfig.url

        // 1. Check explicit type
        if (serverConfig.type) {
          if (serverConfig.type === 'stdio' || serverConfig.type === 'sse') {
            determinedType = serverConfig.type
            // Validate required fields based on explicit type
            if (determinedType === 'stdio' && !determinedCommand) {
              console.error(
                `Server ${serverName} is type 'stdio' but missing required 'command' field`
              )
              continue
            }
            if (determinedType === 'sse' && !determinedUrl) {
              console.error(`Server ${serverName} is type 'sse' but missing required 'url' field`)
              continue
            }
          } else {
            console.error(
              `Server ${serverName} provided invalid 'type' value: ${serverConfig.type}, should be 'stdio' or 'sse'`
            )
            continue
          }
        } else {
          // 2. Infer type if not provided
          const hasCommand = !!determinedCommand && determinedCommand.trim() !== ''
          const hasUrl = !!determinedUrl && determinedUrl.trim() !== ''

          if (hasCommand && hasUrl) {
            console.error(
              `Server ${serverName} provides both 'command' and 'url' fields, but 'type' is not specified. Please explicitly set 'type' to 'stdio' or 'sse'.`
            )
            continue
          } else if (hasCommand) {
            determinedType = 'stdio'
          } else if (hasUrl) {
            determinedType = 'sse'
          } else {
            console.error(
              `Server ${serverName} must provide either 'command' (for stdio) or 'url' (for sse) field`
            )
            continue
          }
        }

        // Safeguard check (should not be reached if logic is correct)
        if (!determinedType) {
          console.error(`Cannot determine server ${serverName} type ('stdio' or 'sse')`)
          continue
        }

        // Set default values based on determined type
        const defaultConfig: Partial<MCPServerConfig> = {
          env: {},
          descriptions: `${serverName} MCP Service`,
          icons: determinedType === 'stdio' ? '🔌' : '🌐', // Different default icons
          autoApprove: ['all'],
          enabled: false,
          disable: false,
          args: [],
          baseUrl: '',
          command: '',
          type: determinedType
        }

        // Merge configuration
        const finalConfig: MCPServerConfig = {
          env: {
            ...(typeof defaultConfig.env === 'string'
              ? JSON.parse(defaultConfig.env)
              : defaultConfig.env),
            ...(typeof serverConfig.env === 'string'
              ? JSON.parse(serverConfig.env)
              : serverConfig.env)
          },
          // env: { ...defaultConfig.env, ...serverConfig.env },
          descriptions: serverConfig.descriptions || defaultConfig.descriptions!,
          icons: serverConfig.icons || defaultConfig.icons!,
          autoApprove: serverConfig.autoApprove || defaultConfig.autoApprove!,
          enabled: (serverConfig as { enabled?: boolean }).enabled ?? defaultConfig.enabled!,
          disable: serverConfig.disable ?? defaultConfig.disable!,
          args: serverConfig.args || defaultConfig.args!,
          type: determinedType, // Use the determined type
          // Set command or baseUrl based on type, prioritizing provided values
          command: determinedType === 'stdio' ? determinedCommand! : defaultConfig.command!,
          baseUrl: determinedType === 'sse' ? determinedUrl! : defaultConfig.baseUrl!
        }

        // 添加服务器配置到完整配置中
        console.log(
          `Preparing to install MCP server: ${serverName} (type: ${determinedType})`,
          finalConfig
        )
        completeMcpConfig.mcpServers[serverName] = finalConfig
      }

      if (hasWindows) {
        // 应用程序已启动，使用现有逻辑创建 Settings 窗口
        const settingsWindowId = await presenter.windowPresenter.createSettingsWindow()
        if (!settingsWindowId) {
          console.error('Failed to open Settings window for MCP install deeplink')
          return
        }

        // Store the complete MCP configuration in localStorage of the Settings window
        const settingsWindow = BrowserWindow.fromId(settingsWindowId)
        if (settingsWindow && !settingsWindow.isDestroyed()) {
          try {
            await settingsWindow.webContents.executeJavaScript(`
              localStorage.setItem('pending-mcp-install', '${JSON.stringify(completeMcpConfig).replace(/'/g, "\\'")}');
            `)
            console.log('Complete MCP configuration stored in Settings window localStorage')
          } catch (error) {
            console.error('Failed to store MCP configuration in localStorage:', error)
          }
        }
      } else {
        // 应用程序未启动，将配置保存到第一个 shell 窗口的 localStorage
        console.log('App not fully started yet, saving MCP config for shell window')
        await this.saveMcpConfigToShellWindow(completeMcpConfig)
      }

      console.log('All MCP servers processing completed')
    } catch (error) {
      console.error('Error parsing or processing MCP configuration:', error)
    }
  }

  /**
   * 将 MCP 配置保存到第一个 shell 窗口的 localStorage
   * @param mcpConfig MCP 配置对象
   */
  private async saveMcpConfigToShellWindow(mcpConfig: {
    mcpServers: Record<string, any>
  }): Promise<void> {
    try {
      // 等待第一个 shell 窗口创建并准备就绪
      const shellWindow = await this.waitForFirstShellWindow()
      if (!shellWindow) {
        console.error('No shell window available to store MCP configuration')
        return
      }

      // 确保 webContents 已准备就绪
      if (shellWindow.webContents.isLoading()) {
        await new Promise<void>((resolve) => {
          shellWindow.webContents.once('dom-ready', () => resolve())
        })
      }

      // 存储到 localStorage
      await shellWindow.webContents.executeJavaScript(`
        localStorage.setItem('pending-mcp-install', '${JSON.stringify(mcpConfig).replace(/'/g, "\\'")}');
      `)
      console.log('MCP configuration stored in shell window localStorage for cold start')
    } catch (error) {
      console.error('Failed to store MCP configuration in shell window localStorage:', error)
    }
  }

  /**
   * 等待第一个 shell 窗口创建并返回
   * @returns Promise<BrowserWindow | null>
   */
  private async waitForFirstShellWindow(): Promise<BrowserWindow | null> {
    return new Promise((resolve) => {
      // 先检查是否已经有窗口
      const existingWindows = presenter.windowPresenter.getAllWindows()
      if (existingWindows.length > 0) {
        resolve(existingWindows[0])
        return
      }

      // 监听窗口创建事件
      const checkForWindow = () => {
        const windows = presenter.windowPresenter.getAllWindows()
        if (windows.length > 0) {
          eventBus.off(WINDOW_EVENTS.WINDOW_CREATED, checkForWindow)
          resolve(windows[0])
        }
      }

      eventBus.on(WINDOW_EVENTS.WINDOW_CREATED, checkForWindow)

      // 设置超时，避免无限等待
      setTimeout(() => {
        eventBus.off(WINDOW_EVENTS.WINDOW_CREATED, checkForWindow)
        console.warn('Timeout waiting for shell window creation')
        resolve(null)
      }, 10000) // 10秒超时
    })
  }

  /**
   * 净化消息内容，防止恶意输入
   * @param content 原始消息内容
   * @returns 净化后的内容，如果检测到危险内容则返回空字符串
   */
  private sanitizeMessageContent(content: string): string {
    if (!content || typeof content !== 'string') {
      return ''
    }

    // 长度限制
    if (content.length > 50000) {
      // 50KB limit for messages
      console.warn('Message content exceeds length limit')
      return ''
    }

    // 检测危险的HTML标签和脚本
    const dangerousPatterns = [
      /<script[^>]*>[\s\S]*?<\/script>/gi,
      /<iframe[^>]*>[\s\S]*?<\/iframe>/gi,
      /<object[^>]*>[\s\S]*?<\/object>/gi,
      /<embed[^>]*>/gi,
      /<form[^>]*>[\s\S]*?<\/form>/gi,
      /javascript\s*:/gi,
      /vbscript\s*:/gi,
      /data\s*:\s*text\/html/gi,
      /on\w+\s*=\s*["'][^"']*["']/gi, // Event handlers
      /@import\s+/gi,
      /expression\s*\(/gi,
      /<link[^>]*stylesheet[^>]*>/gi,
      /<style[^>]*>[\s\S]*?<\/style>/gi
    ]

    // 检查是否包含危险模式
    for (const pattern of dangerousPatterns) {
      if (pattern.test(content)) {
        console.warn('Dangerous pattern detected in message content:', pattern.source)
        return ''
      }
    }

    // 特别检查antArtifact标签中的潜在恶意内容
    const antArtifactPattern = /<antArtifact[^>]*>([\s\S]*?)<\/antArtifact>/gi
    let match
    while ((match = antArtifactPattern.exec(content)) !== null) {
      const artifactContent = match[1]

      // 检查artifact内容中的危险模式
      const artifactDangerousPatterns = [
        /<script[^>]*>/gi,
        /<iframe[^>]*>/gi,
        /javascript\s*:/gi,
        /vbscript\s*:/gi,
        /on\w+\s*=/gi,
        /<foreignObject[^>]*>[\s\S]*?<\/foreignObject>/gi,
        /<img[^>]*onerror[^>]*>/gi,
        /<svg[^>]*onload[^>]*>/gi
      ]

      for (const dangerousPattern of artifactDangerousPatterns) {
        if (dangerousPattern.test(artifactContent)) {
          console.warn(
            'Dangerous pattern detected in antArtifact content:',
            dangerousPattern.source
          )
          return ''
        }
      }
    }

    return content
  }

  /**
   * 净化字符串参数
   * @param param 参数值
   * @returns 净化后的参数值
   */
  private sanitizeStringParameter(param: string): string {
    if (!param || typeof param !== 'string') {
      return ''
    }

    // 长度限制
    if (param.length > 1000) {
      return param.substring(0, 1000)
    }

    // 移除危险字符和序列
    return param
      .replace(/[<>]/g, '') // 移除尖括号
      .replace(/javascript\s*:/gi, '') // 移除javascript协议
      .replace(/vbscript\s*:/gi, '') // 移除vbscript协议
      .replace(/data\s*:/gi, '') // 移除data协议
      .replace(/on\w+\s*=/gi, '') // 移除事件处理器
      .trim()
  }
}
