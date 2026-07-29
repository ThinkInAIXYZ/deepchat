import logger from '@shared/logger'
import { app } from 'electron'
import type { MCPServerConfig } from '@shared/types/mcp'
import path from 'path'
import { consumeStartupDeepLink } from '@/lib/startupDeepLink'
import {
  PROVIDER_INSTALL_VERSION,
  isProviderInstallCustomType,
  maskApiKey,
  type ProviderInstallDeeplinkPayload,
  type ProviderInstallPreview
} from '@shared/providerDeeplink'
import type { ProviderDeeplinkFailureReason } from '@shared/notifications'
import type {
  DeeplinkDesktopPort,
  DeeplinkMcpInstallPort,
  DeeplinkProviderInstallPort
} from './ports'

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

class ProviderDeeplinkError extends Error {
  constructor(
    readonly reason: ProviderDeeplinkFailureReason,
    message: string
  ) {
    super(message)
    this.name = 'ProviderDeeplinkError'
  }
}

/**
 * DeepLink 处理器类
 * 负责处理 deepchat:// 协议的链接
 * deepchat://start 唤起应用，进入到默认的新会话界面
 * deepchat://start?msg=你好 唤起应用，进入新会话界面，并且带上默认消息
 * deepchat://start?msg=你好&model=deepseek-chat 唤起应用，进入新会话界面，并且带上默认消息，model先进行完全匹配，选中第一个命中的。没有命中的就进行模糊匹配，只要包含这个字段的第一个返回，如果都没有就忽略用默认
 * deepchat://mcp/install?json=base64JSONData 通过json数据直接安装mcp
 */
export class DeeplinkService {
  private startupUrl: string | null = null
  private pendingMcpInstallUrl: string | null = null

  constructor(
    private readonly desktop: DeeplinkDesktopPort,
    private readonly mcpInstall: DeeplinkMcpInstallPort,
    private readonly providerInstall: DeeplinkProviderInstallPort
  ) {}

  init(): void {
    const startupDeepLinkUrl = consumeStartupDeepLink()
    if (startupDeepLinkUrl) {
      logger.info('Found startup deeplink URL:', this.redactDeepLinkUrlForLog(startupDeepLinkUrl))
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
  }

  processStartupUrl(): void {
    if (!this.startupUrl) {
      return
    }

    logger.info('Processing startup URL:', this.redactDeepLinkUrlForLog(this.startupUrl))
    void this.handleDeepLink(this.startupUrl)
    this.startupUrl = null
  }

  processPendingMcpInstall(): void {
    if (!this.pendingMcpInstallUrl) {
      return
    }

    logger.info(
      'Processing pending MCP install URL:',
      this.redactDeepLinkUrlForLog(this.pendingMcpInstallUrl)
    )
    void this.handleDeepLink(this.pendingMcpInstallUrl)
    this.pendingMcpInstallUrl = null
  }

  async handleDeepLink(url: string): Promise<void> {
    try {
      const urlObj = new URL(url)
      logger.info('Received DeepLink:', this.redactDeepLinkUrlForLog(url))

      if (urlObj.protocol !== 'deepchat:') {
        console.error('Unsupported protocol:', urlObj.protocol)
        return
      }

      const rawPath = [urlObj.hostname, urlObj.pathname.replace(/^\/+/, '')]
        .filter((segment) => segment.length > 0)
        .join('/')
      const [command = '', subCommand = ''] = rawPath.split('/')

      logger.info('Parsed deeplink - command:', command, 'subCommand:', subCommand)

      if (command === 'mcp' && subCommand === 'install' && !this.mcpInstall.isReady()) {
        logger.info('MCP not ready yet, saving MCP install URL for later')
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
    logger.info('Processing start command, parameters:', this.redactSearchParamsForLog(params))

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
    logger.info('msg:', msg)
    logger.info('modelId:', modelId)
    logger.info('systemPrompt:', systemPrompt)
    logger.info('autoSend:', autoSend, '(disabled for security)')

    const sent = await this.desktop.requestStart({
      msg,
      modelId,
      systemPrompt,
      mentions,
      autoSend
    })
    if (!sent) {
      console.error('Failed to resolve chat window for start deeplink')
    }
  }

  async handleMcpInstall(params: URLSearchParams): Promise<void> {
    logger.info(
      'Processing mcp/install command, parameters:',
      this.redactSearchParamsForLog(params)
    )

    // 获取 JSON 数据
    const jsonBase64 = params.get('code')
    if (!jsonBase64) {
      console.error("Missing 'code' parameter")
      return
    }

    logger.info('Found code parameter, processing MCP config')

    try {
      // 解码 Base64 并解析 JSON
      const jsonString = Buffer.from(jsonBase64, 'base64').toString('utf-8')
      const mcpConfig = JSON.parse(jsonString) as MCPInstallConfig

      logger.info('Parsed MCP config:', this.redactValueForLog(mcpConfig))

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
        logger.info(
          `Preparing to install MCP server: ${serverName} (type: ${determinedType})`,
          this.redactValueForLog(finalConfig)
        )
        completeMcpConfig.mcpServers[serverName] = finalConfig
      }

      if (Object.keys(completeMcpConfig.mcpServers).length === 0) {
        console.error('No valid MCP servers found in deeplink payload')
        return
      }

      const sent = await this.mcpInstall.requestInstall(JSON.stringify(completeMcpConfig))
      if (!sent) {
        console.error('Failed to resolve main window for MCP install deeplink')
        return
      }

      logger.info('All MCP servers processing completed')
    } catch (error) {
      console.error('Error parsing or processing MCP configuration:', error)
    }
  }

  async handleProviderInstall(params: URLSearchParams): Promise<void> {
    logger.info(
      'Processing provider/install command, parameters:',
      this.redactSearchParamsForLog(params)
    )

    let preview: ProviderInstallPreview
    try {
      preview = this.parseProviderInstallParams(params)
    } catch (error) {
      const isExpectedRejection = error instanceof ProviderDeeplinkError
      const reason = isExpectedRejection ? error.reason : ('invalid-payload' as const)
      if (isExpectedRejection) {
        console.error('Rejected provider install deeplink:', { reason })
      } else {
        console.error('Unexpected error parsing provider install deeplink:', error)
      }
      this.reportProviderInstallFailure(reason)
      return
    }

    try {
      const requested = await this.providerInstall.requestInstall(preview)
      if (!requested) {
        this.reportProviderInstallFailure('settings-unavailable')
      }
    } catch (error) {
      console.error('Error opening settings for provider install deeplink:', error)
      this.reportProviderInstallFailure('settings-unavailable')
    }
  }

  private parseProviderInstallParams(params: URLSearchParams): ProviderInstallPreview {
    const version = params.get('v')
    if (version !== PROVIDER_INSTALL_VERSION) {
      throw new ProviderDeeplinkError(
        'unsupported-version',
        `Unsupported provider deeplink version: ${version || 'missing'}`
      )
    }

    const rawData = params.get('data')
    if (!rawData) {
      throw new ProviderDeeplinkError('invalid-payload', "Missing 'data' parameter")
    }

    const payload = this.parseProviderInstallPayload(rawData)

    if ('id' in payload) {
      const id = this.sanitizeStringParameter(payload.id)
      const baseUrl = this.sanitizeProviderInstallField(payload.baseUrl, 'baseUrl')
      const apiKey = this.sanitizeProviderInstallField(payload.apiKey, 'apiKey')
      if (!id) {
        throw new ProviderDeeplinkError('invalid-payload', 'Provider id is required.')
      }
      if (id === 'acp') {
        throw new ProviderDeeplinkError(
          'unsupported-provider',
          'ACP provider deeplinks are not supported.'
        )
      }

      if (!this.providerInstall.hasProvider(id)) {
        throw new ProviderDeeplinkError('provider-not-found', `Unknown provider id: ${id}`)
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
      throw new ProviderDeeplinkError(
        'invalid-payload',
        'Provider name is required for custom provider imports.'
      )
    }
    if (!type) {
      throw new ProviderDeeplinkError(
        'invalid-payload',
        'Provider type is required for custom provider imports.'
      )
    }
    if (type === 'acp') {
      throw new ProviderDeeplinkError(
        'unsupported-provider',
        'ACP provider deeplinks are not supported.'
      )
    }
    if (!isProviderInstallCustomType(type)) {
      throw new ProviderDeeplinkError('unsupported-provider', `Unsupported provider type: ${type}`)
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
      throw new ProviderDeeplinkError('invalid-payload', 'Provider deeplink data is empty.')
    }

    let jsonString = ''
    try {
      const buffer = Buffer.from(sanitizedBase64, 'base64')
      const normalizedOutput = buffer.toString('base64')
      if (sanitizedBase64 !== normalizedOutput) {
        throw new ProviderDeeplinkError('invalid-payload', 'Invalid base64 payload.')
      }
      jsonString = buffer.toString('utf8')
    } catch (error) {
      throw new ProviderDeeplinkError(
        'invalid-payload',
        error instanceof Error ? error.message : 'Failed to decode provider deeplink payload.'
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(jsonString)
    } catch {
      throw new ProviderDeeplinkError(
        'invalid-payload',
        'Provider deeplink payload is not valid JSON.'
      )
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ProviderDeeplinkError(
        'invalid-payload',
        'Provider deeplink payload must be an object.'
      )
    }

    const payload = parsed as Partial<ProviderInstallDeeplinkPayload> & Record<string, unknown>
    const hasId = typeof payload.id === 'string'
    const hasType = typeof payload.type === 'string'

    if (hasId === hasType) {
      throw new ProviderDeeplinkError(
        'invalid-payload',
        "Provider deeplink payload must include either 'id' or 'type'."
      )
    }

    if (typeof payload.baseUrl !== 'string') {
      throw new ProviderDeeplinkError(
        'invalid-payload',
        "Provider deeplink payload must include a string 'baseUrl'."
      )
    }
    if (typeof payload.apiKey !== 'string') {
      throw new ProviderDeeplinkError(
        'invalid-payload',
        "Provider deeplink payload must include a string 'apiKey'."
      )
    }

    if (hasId) {
      return {
        id: payload.id as string,
        baseUrl: payload.baseUrl,
        apiKey: payload.apiKey
      }
    }

    if (typeof payload.name !== 'string') {
      throw new ProviderDeeplinkError(
        'invalid-payload',
        "Custom provider deeplink payload must include a string 'name'."
      )
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
      throw new ProviderDeeplinkError(
        'invalid-payload',
        `Provider deeplink field '${field}' is invalid.`
      )
    }
    return sanitized
  }

  private reportProviderInstallFailure(reason: ProviderDeeplinkFailureReason): void {
    this.providerInstall.reportFailure(reason)
  }

  private redactDeepLinkUrlForLog(url: string): string {
    try {
      const parsedUrl = new URL(url)
      const sensitiveKeys = [...parsedUrl.searchParams.keys()].filter((key) =>
        this.isSensitiveLogKey(key)
      )

      sensitiveKeys.forEach((key) => {
        parsedUrl.searchParams.set(key, '[REDACTED]')
      })

      return parsedUrl.toString()
    } catch {
      return url.replace(
        /([?&](?:apiKey|api_key|token|password|data|code)=)[^&]*/gi,
        '$1[REDACTED]'
      )
    }
  }

  private redactSearchParamsForLog(params: URLSearchParams): Record<string, string> {
    return this.redactValueForLog(Object.fromEntries(params.entries())) as Record<string, string>
  }

  private redactValueForLog(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.redactValueForLog(item))
    }

    if (!value || typeof value !== 'object') {
      return value
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        this.isSensitiveLogKey(key) ? '[REDACTED]' : this.redactValueForLog(nestedValue)
      ])
    )
  }

  private isSensitiveLogKey(key: string): boolean {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
    return (
      normalizedKey.includes('apikey') ||
      normalizedKey.includes('token') ||
      normalizedKey.includes('password') ||
      normalizedKey === 'data' ||
      normalizedKey === 'code'
    )
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
