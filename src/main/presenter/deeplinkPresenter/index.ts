import { app, BrowserWindow } from 'electron'
import { presenter } from '@/presenter'
import { IDeeplinkPresenter, MCPServerConfig } from '@shared/presenter'
import path from 'path'
import {
  NOTIFICATION_EVENTS,
  SETTINGS_EVENTS,
  DEEPLINK_EVENTS,
  MCP_EVENTS,
  WINDOW_EVENTS
} from '@/events'
import { eventBus, SendTarget } from '@/eventbus'
import { consumeStartupDeepLink } from '@/lib/startupDeepLink'
import {
  PROVIDER_INSTALL_VERSION,
  isProviderInstallCustomType,
  maskApiKey,
  type ProviderInstallDeeplinkPayload,
  type ProviderInstallPreview
} from '@shared/providerDeeplink'

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
    const startupDeepLinkUrl = consumeStartupDeepLink()
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

    // 监听窗口内容加载完成事件
    eventBus.once(WINDOW_EVENTS.FIRST_CONTENT_LOADED, () => {
      console.log('Window content loaded. Processing DeepLink if exists.')
      if (this.startupUrl) {
        console.log('Processing startup URL:', this.startupUrl)
        void this.handleDeepLink(this.startupUrl)
        this.startupUrl = null
      }
    })

    // 监听MCP初始化完成事件
    eventBus.on(MCP_EVENTS.INITIALIZED, () => {
      console.log('MCP initialized. Processing pending MCP install if exists.')
      if (this.pendingMcpInstallUrl) {
        console.log('Processing pending MCP install URL:', this.pendingMcpInstallUrl)
        void this.handleDeepLink(this.pendingMcpInstallUrl)
        this.pendingMcpInstallUrl = null
      }
    })
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
      const subCommand = urlObj.pathname.slice(1)

      console.log('Parsed deeplink - command:', command, 'subCommand:', subCommand)

      if (command === 'mcp' && subCommand === 'install' && !presenter.mcpPresenter.isReady()) {
        console.log('MCP not ready yet, saving MCP install URL for later')
        this.pendingMcpInstallUrl = url
        return
      }

      // 处理不同的命令
      if (command === 'start') {
        await this.handleStart(urlObj.searchParams)
      } else if (command === 'mcp') {
        // 处理 mcp/install 命令
        if (subCommand === 'install') {
          await this.handleMcpInstall(urlObj.searchParams)
        } else {
          console.warn('Unknown MCP subcommand:', subCommand)
        }
      } else if (command === 'provider') {
        const subCommand = urlObj.pathname.slice(1)
        if (subCommand === 'install') {
          await this.handleProviderInstall(urlObj.searchParams)
        } else {
          console.warn('Unknown provider subcommand:', subCommand)
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

    const targetWindow = await this.resolveChatWindow()
    if (!targetWindow) {
      console.error('Failed to resolve chat window for start deeplink')
      return
    }

    await this.ensureChatWindowReady(targetWindow.id)
    presenter.windowPresenter.sendToWindow(targetWindow.id, DEEPLINK_EVENTS.START, {
      msg,
      modelId,
      systemPrompt,
      mentions,
      autoSend
    })
  }

  private async resolveChatWindow(): Promise<BrowserWindow | null> {
    const appWindows = presenter.windowPresenter.getAllWindows()
    const focusedWindow = presenter.windowPresenter.getFocusedWindow()
    const focusedChatWindow =
      focusedWindow && appWindows.some((window) => window.id === focusedWindow.id)
        ? focusedWindow
        : null

    let targetWindow: BrowserWindow | null | undefined = focusedChatWindow ?? appWindows[0]

    if (!targetWindow) {
      const windowId = await presenter.windowPresenter.createAppWindow({
        initialRoute: 'chat'
      })
      if (windowId == null) {
        return null
      }
      targetWindow = BrowserWindow.fromId(windowId) ?? null
    }

    if (!targetWindow || targetWindow.isDestroyed()) {
      return null
    }

    if (targetWindow.isMinimized()) {
      targetWindow.restore()
    }
    targetWindow.show()
    targetWindow.focus()
    return targetWindow
  }

  /**
   * Ensure the active chat window is ready to receive the deeplink payload.
   * @param windowId 窗口ID
   */
  private async ensureChatWindowReady(windowId: number): Promise<void> {
    try {
      const targetWindow = BrowserWindow.fromId(windowId)
      if (!targetWindow || targetWindow.isDestroyed()) {
        return
      }

      if (targetWindow.webContents.isLoadingMainFrame()) {
        await new Promise<void>((resolve) => {
          targetWindow.webContents.once('did-finish-load', () => resolve())
        })
      }
    } catch (error) {
      console.error('Error ensuring chat window ready:', error)
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

      if (Object.keys(completeMcpConfig.mcpServers).length === 0) {
        console.error('No valid MCP servers found in deeplink payload')
        return
      }

      const settingsWindowId = await presenter.windowPresenter.createSettingsWindow()
      if (!settingsWindowId) {
        console.error('Failed to open Settings window for MCP install deeplink')
        return
      }

      presenter.windowPresenter.sendToWindow(settingsWindowId, DEEPLINK_EVENTS.MCP_INSTALL, {
        mcpConfig: JSON.stringify(completeMcpConfig)
      })

      console.log('All MCP servers processing completed')
    } catch (error) {
      console.error('Error parsing or processing MCP configuration:', error)
    }
  }

  async handleProviderInstall(params: URLSearchParams): Promise<void> {
    console.log(
      'Processing provider/install command, parameters:',
      Object.fromEntries(params.entries())
    )

    try {
      const preview = this.parseProviderInstallParams(params)
      const settingsWindowId = await presenter.windowPresenter.createSettingsWindow()
      if (!settingsWindowId) {
        this.notifyProviderImportError('Failed to open settings window for provider deeplink.')
        return
      }

      presenter.windowPresenter.setPendingSettingsProviderInstall(preview)
      presenter.windowPresenter.sendToWindow(settingsWindowId, SETTINGS_EVENTS.NAVIGATE, {
        routeName: 'settings-provider'
      })
      presenter.windowPresenter.sendToWindow(settingsWindowId, SETTINGS_EVENTS.PROVIDER_INSTALL)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid provider deeplink.'
      console.error('Error parsing provider install deeplink:', error)
      this.notifyProviderImportError(message)
    }
  }

  private parseProviderInstallParams(params: URLSearchParams): ProviderInstallPreview {
    const version = params.get('v')
    if (version !== PROVIDER_INSTALL_VERSION) {
      throw new Error(`Unsupported provider deeplink version: ${version || 'missing'}`)
    }

    const rawData = params.get('data')
    if (!rawData) {
      throw new Error("Missing 'data' parameter")
    }

    const payload = this.parseProviderInstallPayload(rawData)

    if ('id' in payload) {
      const id = this.sanitizeStringParameter(payload.id)
      const baseUrl = this.sanitizeProviderInstallField(payload.baseUrl, 'baseUrl')
      const apiKey = this.sanitizeProviderInstallField(payload.apiKey, 'apiKey')
      if (!id) {
        throw new Error('Provider id is required.')
      }
      if (id === 'acp') {
        throw new Error('ACP provider deeplinks are not supported.')
      }

      const provider = presenter.configPresenter.getProviderById(id)
      if (!provider) {
        throw new Error(`Unknown provider id: ${id}`)
      }

      return {
        kind: 'builtin',
        id,
        baseUrl,
        apiKey,
        maskedApiKey: maskApiKey(apiKey),
        iconModelId: id,
        willOverwrite: true
      }
    }

    const type = this.sanitizeStringParameter(payload.type)
    const name = this.sanitizeStringParameter(payload.name)
    const baseUrl = this.sanitizeProviderInstallField(payload.baseUrl, 'baseUrl')
    const apiKey = this.sanitizeProviderInstallField(payload.apiKey, 'apiKey')
    if (!name) {
      throw new Error('Provider name is required for custom provider imports.')
    }
    if (!type) {
      throw new Error('Provider type is required for custom provider imports.')
    }
    if (type === 'acp') {
      throw new Error('ACP provider deeplinks are not supported.')
    }
    if (!isProviderInstallCustomType(type)) {
      throw new Error(`Unsupported provider type: ${type}`)
    }

    return {
      kind: 'custom',
      name,
      type,
      baseUrl,
      apiKey,
      maskedApiKey: maskApiKey(apiKey),
      iconModelId: type
    }
  }

  private parseProviderInstallPayload(rawData: string): ProviderInstallDeeplinkPayload {
    const sanitizedBase64 = rawData.replace(/\s+/g, '')
    if (!sanitizedBase64) {
      throw new Error('Provider deeplink data is empty.')
    }

    let jsonString = ''
    try {
      const buffer = Buffer.from(sanitizedBase64, 'base64')
      const normalizedInput = sanitizedBase64.replace(/=+$/, '')
      const normalizedOutput = buffer.toString('base64').replace(/=+$/, '')
      if (normalizedInput !== normalizedOutput) {
        throw new Error('Invalid base64 payload.')
      }
      jsonString = buffer.toString('utf8')
    } catch (error) {
      throw new Error(
        error instanceof Error ? error.message : 'Failed to decode provider deeplink payload.'
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(jsonString)
    } catch {
      throw new Error('Provider deeplink payload is not valid JSON.')
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Provider deeplink payload must be an object.')
    }

    const payload = parsed as Partial<ProviderInstallDeeplinkPayload> & Record<string, unknown>
    const hasId = typeof payload.id === 'string'
    const hasType = typeof payload.type === 'string'

    if (hasId === hasType) {
      throw new Error("Provider deeplink payload must include either 'id' or 'type'.")
    }

    if (typeof payload.baseUrl !== 'string') {
      throw new Error("Provider deeplink payload must include a string 'baseUrl'.")
    }
    if (typeof payload.apiKey !== 'string') {
      throw new Error("Provider deeplink payload must include a string 'apiKey'.")
    }

    if (hasId) {
      return {
        id: payload.id as string,
        baseUrl: payload.baseUrl,
        apiKey: payload.apiKey
      }
    }

    if (typeof payload.name !== 'string') {
      throw new Error("Custom provider deeplink payload must include a string 'name'.")
    }

    return {
      name: payload.name,
      type: payload.type as string,
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey
    }
  }

  private sanitizeProviderInstallField(value: string, field: string): string {
    const sanitized = this.sanitizeStringParameter(value)
    if (value.trim().length > 0 && sanitized.length === 0) {
      throw new Error(`Provider deeplink field '${field}' is invalid.`)
    }
    return sanitized
  }

  private notifyProviderImportError(message: string): void {
    eventBus.sendToRenderer(NOTIFICATION_EVENTS.SHOW_ERROR, SendTarget.ALL_WINDOWS, {
      id: `provider-deeplink-${Date.now()}`,
      title: 'Provider Deeplink',
      message,
      type: 'error'
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
