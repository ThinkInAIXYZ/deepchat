import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { type Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  ToolListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
  LoggingMessageNotificationSchema,
  CreateMessageRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js'
import type { CreateMessageRequest, CreateMessageResult } from '@modelcontextprotocol/sdk/types.js'
import { eventBus, SendTarget } from '@/eventbus'
import { MCP_EVENTS } from '@/events'
import path from 'path'
import { presenter } from '@/presenter'
import { app } from 'electron'
// import { NO_PROXY, proxyConfig } from '@/presenter/proxyConfig'
import { getInMemoryServer } from './inMemoryServers/builder'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { RuntimeHelper } from '@/lib/runtimeHelper'
import {
  PromptListEntry,
  ToolCallResult,
  Tool,
  Prompt,
  ResourceListEntry,
  Resource,
  ChatMessage,
  McpSamplingRequestPayload,
  McpSamplingDecision
} from '@shared/presenter'

const ALLOWED_SAMPLING_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp'
])

// TODO: resources 和 prompts 的类型,Notifactions 的类型 https://github.com/modelcontextprotocol/typescript-sdk/blob/main/src/examples/client/simpleStreamableHttp.ts
// Simple OAuth provider for handling Bearer Token
class SimpleOAuthProvider {
  private token: string | null = null

  constructor(authHeader: string | undefined) {
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      this.token = authHeader.substring(7) // Remove 'Bearer ' prefix
    }
  }

  async tokens(): Promise<{ access_token: string } | null> {
    if (this.token) {
      return { access_token: this.token }
    }
    return null
  }
}

// Ensure TypeScript can recognize SERVER_STATUS_CHANGED property
type MCPEventsType = typeof MCP_EVENTS & {
  SERVER_STATUS_CHANGED: string
}

// Session management related types
interface SessionError extends Error {
  httpStatus?: number
  isSessionExpired?: boolean
}

interface RequestHandlerContext {
  signal?: AbortSignal
  requestId?: string | number
  [key: string]: unknown
}

// Helper function to check if error is session-related
function isSessionError(error: unknown): error is SessionError {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    // Check for specific MCP Streamable HTTP session error patterns
    const sessionErrorPatterns = [
      'no valid session',
      'session expired',
      'session not found',
      'invalid session',
      'session id',
      'mcp-session-id'
    ]

    const httpErrorPatterns = ['http 400', 'http 404', 'bad request', 'not found']

    // Check for session-specific errors first (high confidence)
    const hasSessionPattern = sessionErrorPatterns.some((pattern) => message.includes(pattern))
    if (hasSessionPattern) {
      return true
    }

    // Check for HTTP errors that might be session-related (lower confidence)
    // Only treat as session error if it's an HTTP transport
    const hasHttpPattern = httpErrorPatterns.some((pattern) => message.includes(pattern))
    if (hasHttpPattern && (message.includes('posting') || message.includes('endpoint'))) {
      return true
    }
  }
  return false
}

// MCP client class
export class McpClient {
  private client: Client | null = null
  private transport: Transport | null = null
  public serverName: string
  public serverConfig: Record<string, unknown>
  private isConnected: boolean = false
  private connectionTimeout: NodeJS.Timeout | null = null
  private npmRegistry: string | null = null
  private uvRegistry: string | null = null
  private readonly runtimeHelper = RuntimeHelper.getInstance()

  // Session management
  private isRecovering: boolean = false
  private hasRestarted: boolean = false

  // Cache
  private cachedTools: Tool[] | null = null
  private cachedPrompts: PromptListEntry[] | null = null
  private cachedResources: ResourceListEntry[] | null = null

  constructor(
    serverName: string,
    serverConfig: Record<string, unknown>,
    npmRegistry: string | null = null,
    uvRegistry: string | null = null
  ) {
    this.serverName = serverName
    this.serverConfig = serverConfig
    this.npmRegistry = npmRegistry
    this.uvRegistry = uvRegistry
  }

  // Connect to MCP server
  async connect(): Promise<void> {
    if (this.isConnected && this.client) {
      console.info(`MCP server ${this.serverName} is already running`)
      return
    }

    try {
      console.info(`Starting MCP server ${this.serverName}...`, this.serverConfig)

      // Handle customHeaders and AuthProvider
      let authProvider: SimpleOAuthProvider | null = null
      const customHeaders = this.serverConfig.customHeaders
        ? { ...(this.serverConfig.customHeaders as Record<string, string>) } // Create copy for modification
        : {}

      if (customHeaders.Authorization) {
        authProvider = new SimpleOAuthProvider(customHeaders.Authorization)
        delete customHeaders.Authorization // Remove from headers as it will be handled by AuthProvider
      }

      if (this.serverConfig.type === 'inmemory') {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
        const _args = Array.isArray(this.serverConfig.args) ? this.serverConfig.args : []
        const _env = this.serverConfig.env ? (this.serverConfig.env as Record<string, string>) : {}
        const _server = getInMemoryServer(this.serverName, _args, _env)
        _server.startServer(serverTransport)
        this.transport = clientTransport
      } else if (this.serverConfig.type === 'stdio') {
        // Initialize runtime paths if not already done
        this.runtimeHelper.initializeRuntimes()

        // Create appropriate transport
        let command = this.serverConfig.command as string
        let args = this.serverConfig.args as string[]

        // Handle path expansion (including ~ and environment variables)
        command = this.runtimeHelper.expandPath(command)
        args = args.map((arg) => this.runtimeHelper.expandPath(arg))

        const HOME_DIR = app.getPath('home')

        // Define allowed environment variables whitelist
        const allowedEnvVars = [
          'PATH',
          'path',
          'Path',
          'npm_config_registry',
          'npm_config_cache',
          'npm_config_prefix',
          'npm_config_tmp',
          'NPM_CONFIG_REGISTRY',
          'NPM_CONFIG_CACHE',
          'NPM_CONFIG_PREFIX',
          'NPM_CONFIG_TMP'
          // 'GRPC_PROXY',
          // 'grpc_proxy'
        ]

        // Fix env type issue
        const env: Record<string, string> = {}

        // Handle command and argument replacement
        const processedCommand = this.runtimeHelper.processCommandWithArgs(command, args)
        command = processedCommand.command
        args = processedCommand.args

        // Determine if it's Node.js/UV related command
        const isNodeCommand = ['node', 'npm', 'npx', 'uv', 'uvx'].some(
          (cmd) => command.includes(cmd) || args.some((arg) => arg.includes(cmd))
        )

        if (isNodeCommand) {
          // Node.js/UV commands use whitelist processing
          if (process.env) {
            const existingPaths: string[] = []

            // Collect all PATH-related values
            Object.entries(process.env).forEach(([key, value]) => {
              if (value !== undefined) {
                if (['PATH', 'Path', 'path'].includes(key)) {
                  existingPaths.push(value)
                } else if (
                  allowedEnvVars.includes(key) &&
                  !['PATH', 'Path', 'path'].includes(key)
                ) {
                  env[key] = value
                }
              }
            })

            // Get default paths
            const defaultPaths = this.runtimeHelper.getDefaultPaths(HOME_DIR)

            // 合并所有路径
            const allPaths = [...existingPaths, ...defaultPaths]
            // 添加运行时路径
            const uvRuntimePath = this.runtimeHelper.getUvRuntimePath()
            const nodeRuntimePath = this.runtimeHelper.getNodeRuntimePath()
            if (process.platform === 'win32') {
              // Windows平台只添加 node 和 uv 路径
              if (uvRuntimePath) {
                allPaths.unshift(uvRuntimePath)
              }
              if (nodeRuntimePath) {
                allPaths.unshift(nodeRuntimePath)
              }
            } else {
              // 其他平台优先级：node > uv
              if (uvRuntimePath) {
                allPaths.unshift(uvRuntimePath)
              }
              if (nodeRuntimePath) {
                allPaths.unshift(path.join(nodeRuntimePath, 'bin'))
              }
            }

            // 规范化并设置PATH
            const { key, value } = this.runtimeHelper.normalizePathEnv(allPaths)
            env[key] = value
          }
        } else {
          // 非 Node.js/UV 命令，保留所有系统环境变量，只补充 PATH
          Object.entries(process.env).forEach(([key, value]) => {
            if (value !== undefined) {
              env[key] = value
            }
          })

          // 补充 PATH
          const existingPaths: string[] = []
          if (env.PATH) {
            existingPaths.push(env.PATH)
          }
          if (env.Path) {
            existingPaths.push(env.Path)
          }

          // 获取默认路径
          const defaultPaths = this.runtimeHelper.getDefaultPaths(HOME_DIR)

          // 合并所有路径
          const allPaths = [...existingPaths, ...defaultPaths]
          // 添加运行时路径
          const uvRuntimePath = this.runtimeHelper.getUvRuntimePath()
          const nodeRuntimePath = this.runtimeHelper.getNodeRuntimePath()
          if (process.platform === 'win32') {
            // Windows平台只添加 node 和 uv 路径
            if (uvRuntimePath) {
              allPaths.unshift(uvRuntimePath)
            }
            if (nodeRuntimePath) {
              allPaths.unshift(nodeRuntimePath)
            }
          } else {
            // 其他平台优先级：node > uv
            if (uvRuntimePath) {
              allPaths.unshift(uvRuntimePath)
            }
            if (nodeRuntimePath) {
              allPaths.unshift(path.join(nodeRuntimePath, 'bin'))
            }
          }

          // 规范化并设置PATH
          const { key, value } = this.runtimeHelper.normalizePathEnv(allPaths)
          env[key] = value
        }

        // 添加自定义环境变量
        if (this.serverConfig.env) {
          Object.entries(this.serverConfig.env as Record<string, string>).forEach(
            ([key, value]) => {
              if (value !== undefined) {
                // 如果是PATH相关变量，合并到主PATH中
                if (['PATH', 'Path', 'path'].includes(key)) {
                  const currentPathKey = process.platform === 'win32' ? 'Path' : 'PATH'
                  const separator = process.platform === 'win32' ? ';' : ':'
                  env[currentPathKey] = env[currentPathKey]
                    ? `${value}${separator}${env[currentPathKey]}`
                    : value
                } else {
                  env[key] = value
                }
              }
            }
          )
        }

        if (this.npmRegistry) {
          env.npm_config_registry = this.npmRegistry
        }

        if (this.uvRegistry) {
          env.UV_DEFAULT_INDEX = this.uvRegistry
          env.PIP_INDEX_URL = this.uvRegistry
        }

        // console.log('mcp env', command, env, args)
        this.transport = new StdioClientTransport({
          command,
          args,
          env,
          stderr: 'pipe'
        })
        ;(this.transport as StdioClientTransport).stderr?.on('data', (data) => {
          console.info('mcp StdioClientTransport error', this.serverName, data.toString())
        })
      } else if (this.serverConfig.baseUrl && this.serverConfig.type === 'sse') {
        this.transport = new SSEClientTransport(new URL(this.serverConfig.baseUrl as string), {
          requestInit: { headers: customHeaders },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          authProvider: (authProvider ?? undefined) as any
        })
      } else if (this.serverConfig.baseUrl && this.serverConfig.type === 'http') {
        this.transport = new StreamableHTTPClientTransport(
          new URL(this.serverConfig.baseUrl as string),
          {
            requestInit: { headers: customHeaders },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            authProvider: (authProvider ?? undefined) as any
          }
        )
      } else {
        throw new Error(`Unsupported transport type: ${this.serverConfig.type}`)
      }

      // 创建 MCP 客户端
      this.client = new Client(
        { name: 'DeepChat', version: app.getVersion() },
        {
          capabilities: {
            sampling: {}
          }
        }
      )

      // 设置通知处理器
      this.registerNotificationHandlers()

      // 注册采样请求处理器
      this.client.setRequestHandler(CreateMessageRequestSchema, async (request, extra) => {
        return this.handleSamplingCreateMessage(request, extra)
      })

      // 设置连接超时
      const timeoutPromise = new Promise<void>((_, reject) => {
        this.connectionTimeout = setTimeout(
          () => {
            console.error(`Connection to MCP server ${this.serverName} timed out`)
            reject(new Error(`Connection to MCP server ${this.serverName} timed out`))
          },
          5 * 60 * 1000
        ) // 5分钟
      })

      // 连接到服务器
      const connectPromise = this.client
        .connect(this.transport)
        .then(() => {
          // 清除超时
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout)
            this.connectionTimeout = null
          }

          this.isConnected = true
          console.info(`MCP server ${this.serverName} connected successfully`)

          // 触发服务器状态变更事件
          eventBus.send(
            (MCP_EVENTS as MCPEventsType).SERVER_STATUS_CHANGED,
            SendTarget.ALL_WINDOWS,
            {
              name: this.serverName,
              status: 'running'
            }
          )
        })
        .catch((error) => {
          console.error(`Failed to connect to MCP server ${this.serverName}:`, error)
          throw error
        })

      // 等待连接完成或超时
      await Promise.race([connectPromise, timeoutPromise])
    } catch (error) {
      // 清除超时
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout)
        this.connectionTimeout = null
      }

      // 清理资源
      this.cleanupResources()

      console.error(`Failed to connect to MCP server ${this.serverName}:`, error)

      // 触发服务器状态变更事件
      eventBus.send((MCP_EVENTS as MCPEventsType).SERVER_STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
        name: this.serverName,
        status: 'stopped'
      })

      throw error
    }
  }

  // 断开与 MCP 服务器的连接
  async disconnect(): Promise<void> {
    if (!this.isConnected || !this.client) {
      return
    }

    try {
      // Use internal disconnect method for normal disconnection
      await this.internalDisconnect()
    } catch (error) {
      console.error(`Failed to disconnect from MCP server ${this.serverName}:`, error)
      throw error
    }
  }

  // 清理资源
  private cleanupResources(): void {
    // 清除超时定时器
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout)
      this.connectionTimeout = null
    }

    // 关闭transport
    if (this.transport) {
      try {
        this.transport.close()
      } catch (error) {
        console.error(`Failed to close MCP transport:`, error)
      }
    }

    // 重置状态
    this.client = null
    this.transport = null
    this.isConnected = false

    // 清空缓存
    this.cachedTools = null
    this.cachedPrompts = null
    this.cachedResources = null
  }

  // Register notification handlers
  private registerNotificationHandlers(): void {
    if (!this.client) {
      return
    }

    // Tool list changed notification - clear tool cache and actively refresh
    this.client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      console.info(`[MCP] Tools list changed for server: ${this.serverName}`)
      this.cachedTools = null
      // Actively refresh tool list
      try {
        await this.listTools()
      } catch (error) {
        console.warn(`[MCP] Failed to refresh tools after notification:`, error)
      }
    })

    // Prompt list changed notification - clear prompt cache and actively refresh
    this.client.setNotificationHandler(PromptListChangedNotificationSchema, async () => {
      console.info(`[MCP] Prompts list changed for server: ${this.serverName}`)
      this.cachedPrompts = null
      // Actively refresh prompt list
      try {
        await this.listPrompts()
      } catch (error) {
        console.warn(`[MCP] Failed to refresh prompts after notification:`, error)
      }
    })

    // Resource list changed notification - clear resource cache and actively refresh
    this.client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
      console.info(`[MCP] Resources list changed for server: ${this.serverName}`)
      this.cachedResources = null
      // Actively refresh resource list
      try {
        await this.listResources()
      } catch (error) {
        console.warn(`[MCP] Failed to refresh resources after notification:`, error)
      }
    })

    // Resource updated notification - clear resource cache and actively refresh
    this.client.setNotificationHandler(ResourceUpdatedNotificationSchema, async (params) => {
      console.info(`[MCP] Resource updated for server: ${this.serverName}`, params)
      this.cachedResources = null
      // Actively refresh resource list
      try {
        await this.listResources()
      } catch (error) {
        console.warn(`[MCP] Failed to refresh resources after update notification:`, error)
      }
    })

    // Logging message notification - just log the message
    this.client.setNotificationHandler(LoggingMessageNotificationSchema, async (params) => {
      console.info(`[MCP] Log message from server ${this.serverName}:`, params)
    })
  }

  private async handleSamplingCreateMessage(
    request: CreateMessageRequest,
    extra: RequestHandlerContext
  ): Promise<CreateMessageResult> {
    const params = request.params ?? {}
    const requestId = this.resolveSamplingRequestId(extra)
    const { payload, chatMessages } = this.prepareSamplingContext(requestId, params)

    const decisionPromise = presenter.mcpPresenter.handleSamplingRequest(payload)
    const signal = extra?.signal as AbortSignal | undefined

    let decision: McpSamplingDecision
    if (signal) {
      decision = await new Promise<McpSamplingDecision>((resolve, reject) => {
        const onAbort = () => {
          signal.removeEventListener('abort', onAbort)
          void presenter.mcpPresenter
            .cancelSamplingRequest(payload.requestId, 'cancelled by server')
            .catch((error) => {
              console.warn(`[MCP] Failed to cancel sampling request ${payload.requestId}:`, error)
            })
          reject(new McpError(ErrorCode.RequestTimeout, 'Sampling request cancelled'))
        }

        if (signal.aborted) {
          onAbort()
          return
        }

        signal.addEventListener('abort', onAbort, { once: true })
        decisionPromise
          .then((value) => {
            signal.removeEventListener('abort', onAbort)
            resolve(value)
          })
          .catch((error) => {
            signal.removeEventListener('abort', onAbort)
            reject(error)
          })
      })
    } else {
      decision = await decisionPromise
    }

    if (!decision.approved) {
      throw new McpError(ErrorCode.InvalidRequest, 'User rejected sampling request')
    }

    if (!decision.providerId || !decision.modelId) {
      throw new McpError(ErrorCode.InvalidParams, 'No model selected for sampling request')
    }

    let assistantText = ''
    try {
      assistantText = await presenter.llmproviderPresenter.generateCompletionStandalone(
        decision.providerId,
        chatMessages,
        decision.modelId,
        undefined,
        params.maxTokens
      )
    } catch (error) {
      console.error(`[MCP] Sampling request failed for server ${this.serverName}:`, error)
      throw new McpError(
        ErrorCode.InternalError,
        error instanceof Error ? error.message : 'Sampling request failed'
      )
    }

    const modelName =
      this.resolveModelDisplayName(decision.providerId, decision.modelId) ?? decision.modelId

    const result: CreateMessageResult = {
      role: 'assistant',
      model: modelName,
      stopReason: 'endTurn',
      content: {
        type: 'text',
        text: assistantText ?? ''
      }
    }

    return result
  }

  private resolveSamplingRequestId(extra: RequestHandlerContext): string {
    const rawId = extra?.requestId
    if (typeof rawId === 'string' || typeof rawId === 'number') {
      return String(rawId)
    }

    return `${this.serverName}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  private prepareSamplingContext(
    requestId: string,
    params: CreateMessageRequest['params']
  ): { payload: McpSamplingRequestPayload; chatMessages: ChatMessage[] } {
    const payload: McpSamplingRequestPayload = {
      requestId,
      serverName: this.serverName,
      serverLabel: this.getServerLabel(),
      systemPrompt: typeof params?.systemPrompt === 'string' ? params.systemPrompt : undefined,
      maxTokens: typeof params?.maxTokens === 'number' ? params.maxTokens : undefined,
      modelPreferences: this.normalizeModelPreferences(params?.modelPreferences),
      requiresVision: false,
      messages: []
    }

    const chatMessages: ChatMessage[] = []

    if (payload.systemPrompt) {
      chatMessages.push({ role: 'system', content: payload.systemPrompt })
    }

    const messageList = Array.isArray(params?.messages) ? params.messages : []

    for (const message of messageList) {
      if (!message || (message.role !== 'user' && message.role !== 'assistant')) {
        continue
      }

      const rawContent = message.content
      if (!rawContent || typeof rawContent !== 'object' || !('type' in rawContent)) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid sampling message content received')
      }

      const content = rawContent as { type: string } & Record<string, unknown>

      if (content.type === 'text') {
        const text = typeof content.text === 'string' ? content.text : ''
        payload.messages.push({ role: message.role, type: 'text', text })
        chatMessages.push({ role: message.role, content: text })
      } else if (content.type === 'image') {
        const rawMimeType = typeof content.mimeType === 'string' ? content.mimeType : undefined
        const normalizedMimeType = rawMimeType?.toLowerCase()

        if (normalizedMimeType && !ALLOWED_SAMPLING_IMAGE_MIME_TYPES.has(normalizedMimeType)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Unsupported sampling image mime type: ${rawMimeType}`
          )
        }

        const mimeType = normalizedMimeType ?? 'image/png'
        const data = this.sanitizeSamplingImageData(content.data)
        const dataUrl = `data:${mimeType};base64,${data}`
        payload.messages.push({
          role: message.role,
          type: 'image',
          dataUrl,
          mimeType
        })
        payload.requiresVision = true
        chatMessages.push({
          role: message.role,
          content: [
            {
              type: 'image_url',
              image_url: { url: dataUrl, detail: 'auto' as const }
            }
          ]
        })
      } else if (content.type === 'audio') {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Audio sampling content is not supported by this client'
        )
      } else {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Unsupported sampling content type: ${String((content as { type?: unknown }).type)}`
        )
      }
    }

    return { payload, chatMessages }
  }

  private sanitizeSamplingImageData(rawData: unknown): string {
    if (typeof rawData !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid sampling image payload received')
    }

    const sanitized = rawData.replace(/\s+/g, '')

    if (!sanitized) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid sampling image payload received')
    }

    if (sanitized.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(sanitized)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid sampling image payload received')
    }

    let decoded: Buffer

    try {
      decoded = Buffer.from(sanitized, 'base64')
    } catch {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid sampling image payload received')
    }

    if (!decoded.length) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid sampling image payload received')
    }

    const reencoded = decoded.toString('base64')

    if (reencoded.replace(/=+$/, '') !== sanitized.replace(/=+$/, '')) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid sampling image payload received')
    }

    return sanitized
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalizeModelPreferences(
    preferences: any
  ): McpSamplingRequestPayload['modelPreferences'] {
    if (!preferences || typeof preferences !== 'object') {
      return undefined
    }

    const normalized: McpSamplingRequestPayload['modelPreferences'] = {}

    if (typeof preferences.costPriority === 'number') {
      normalized.costPriority = preferences.costPriority
    }
    if (typeof preferences.speedPriority === 'number') {
      normalized.speedPriority = preferences.speedPriority
    }
    if (typeof preferences.intelligencePriority === 'number') {
      normalized.intelligencePriority = preferences.intelligencePriority
    }
    if (Array.isArray(preferences.hints)) {
      normalized.hints = preferences.hints.map((hint: { name?: unknown }) => ({
        name: typeof hint?.name === 'string' ? hint.name : undefined
      }))
    }

    if (
      normalized.costPriority === undefined &&
      normalized.speedPriority === undefined &&
      normalized.intelligencePriority === undefined &&
      (!normalized.hints || normalized.hints.length === 0)
    ) {
      return undefined
    }

    return normalized
  }

  private getServerLabel(): string | undefined {
    const config = this.serverConfig
    if (!config) {
      return undefined
    }

    const candidates: Array<string | undefined> = [
      typeof config['descriptions'] === 'string' ? (config['descriptions'] as string) : undefined,
      typeof config['description'] === 'string' ? (config['description'] as string) : undefined,
      typeof config['name'] === 'string' ? (config['name'] as string) : undefined
    ]

    return candidates.find((label) => label && label.trim().length > 0)
  }

  private resolveModelDisplayName(providerId: string, modelId: string): string | undefined {
    try {
      const models = presenter.configPresenter.getProviderModels(providerId) || []
      const match = models.find((model) => model.id === modelId)
      if (match?.name) {
        return match.name
      }

      const customModels = presenter.configPresenter.getCustomModels?.(providerId) || []
      const customMatch = customModels.find((model) => model.id === modelId)
      if (customMatch?.name) {
        return customMatch.name
      }
    } catch (error) {
      console.warn(
        `[MCP] Failed to resolve model display name for ${providerId}/${modelId}:`,
        error
      )
    }

    return undefined
  }

  // 检查服务器是否正在运行
  isServerRunning(): boolean {
    return this.isConnected && !!this.client
  }

  // Check and handle session errors by restarting the service
  private async checkAndHandleSessionError(error: unknown): Promise<void> {
    if (isSessionError(error) && !this.isRecovering) {
      // If already restarted once and still getting session errors, stop the service
      if (this.hasRestarted) {
        console.error(
          `Session error persists after restart for server ${this.serverName}, stopping service...`,
          error
        )
        await this.stopService()
        throw new Error(
          `MCP service ${this.serverName} still has session errors after restart, service has been stopped`
        )
      }

      console.warn(
        `Session error detected for server ${this.serverName}, restarting service...`,
        error
      )

      this.isRecovering = true

      try {
        // Clean up current connection
        this.cleanupResources()

        // Clear all caches to ensure fresh data after reconnection
        this.cachedTools = null
        this.cachedPrompts = null
        this.cachedResources = null

        // Mark as restarted
        this.hasRestarted = true

        console.info(`Service ${this.serverName} restarted due to session error`)
      } catch (restartError) {
        console.error(`Failed to restart service ${this.serverName}:`, restartError)
      } finally {
        this.isRecovering = false
      }
    }
  }

  // Stop the service completely due to persistent session errors
  private async stopService(): Promise<void> {
    try {
      // Use the same disconnect logic but with different reason
      await this.internalDisconnect('persistent session errors')
    } catch (error) {
      console.error(`Failed to stop service ${this.serverName}:`, error)
    }
  }

  // Internal disconnect with custom reason
  private async internalDisconnect(reason?: string): Promise<void> {
    // Clean up all resources
    this.cleanupResources()

    const logMessage = reason
      ? `MCP service ${this.serverName} has been stopped due to ${reason}`
      : `Disconnected from MCP server: ${this.serverName}`

    console.log(logMessage)

    // Trigger server status changed event to notify the system
    eventBus.send((MCP_EVENTS as MCPEventsType).SERVER_STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
      name: this.serverName,
      status: 'stopped'
    })
  }

  // 调用 MCP 工具
  async callTool(toolName: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    try {
      if (!this.isConnected) {
        await this.connect()
      }

      if (!this.client) {
        throw new Error(`MCP client ${this.serverName} not initialized`)
      }

      // 调用工具
      const result = (await this.client.callTool({
        name: toolName,
        arguments: args
      })) as ToolCallResult

      // 成功调用后重置重启标志
      this.hasRestarted = false

      // 检查结果
      if (result.isError) {
        const errorText =
          result.content && result.content[0] ? result.content[0].text : 'Unknown error'
        // 如果调用失败，清空工具缓存，以便下次重新获取
        this.cachedTools = null
        return {
          isError: true,
          content: [{ type: 'error', text: errorText }]
        }
      }
      return result
    } catch (error) {
      // 检查并处理session错误
      await this.checkAndHandleSessionError(error)

      console.error(`Failed to call MCP tool ${toolName}:`, error)
      // 调用失败，清空工具缓存
      this.cachedTools = null
      throw error
    }
  }

  // 列出可用工具
  async listTools(): Promise<Tool[]> {
    // 检查缓存
    if (this.cachedTools !== null) {
      return this.cachedTools
    }

    try {
      if (!this.isConnected) {
        await this.connect()
      }

      if (!this.client) {
        throw new Error(`MCP client ${this.serverName} not initialized`)
      }

      const response = await this.client.listTools()
      // 成功调用后重置重启标志
      this.hasRestarted = false

      // 检查响应格式
      if (response && typeof response === 'object' && 'tools' in response) {
        const toolsArray = response.tools
        if (Array.isArray(toolsArray)) {
          // 缓存结果
          this.cachedTools = toolsArray as Tool[]
          return this.cachedTools
        }
      }
      throw new Error('Invalid tool response format')
    } catch (error) {
      // 检查并处理session错误
      await this.checkAndHandleSessionError(error)

      // 尝试从错误对象中提取更多信息
      const errorMessage = error instanceof Error ? error.message : String(error)
      // 如果错误表明不支持，则缓存空数组
      if (errorMessage.includes('Method not found') || errorMessage.includes('not supported')) {
        console.warn(`Server ${this.serverName} does not support listTools`)
        this.cachedTools = []
        return this.cachedTools
      } else {
        console.error(`Failed to list MCP tools:`, error)
        // 发生其他错误，不清空缓存（保持null），以便下次重试
        throw error
      }
    }
  }

  // 列出可用提示
  async listPrompts(): Promise<PromptListEntry[]> {
    // 检查缓存
    if (this.cachedPrompts !== null) {
      return this.cachedPrompts
    }

    try {
      if (!this.isConnected) {
        await this.connect()
      }

      if (!this.client) {
        throw new Error(`MCP client ${this.serverName} not initialized`)
      }

      // SDK可能没有 listPrompts 方法，需要使用通用的 request
      const response = await this.client.listPrompts()

      // 成功调用后重置重启标志
      this.hasRestarted = false

      // 检查响应格式
      if (response && typeof response === 'object' && 'prompts' in response) {
        const promptsArray = (response as { prompts: unknown }).prompts
        // console.log('promptsArray', JSON.stringify(promptsArray, null, 2))
        if (Array.isArray(promptsArray)) {
          // 需要确保每个元素都符合 Prompt 接口
          const validPrompts = promptsArray.map((p) => ({
            name: typeof p === 'object' && p !== null && 'name' in p ? String(p.name) : 'unknown',
            description:
              typeof p === 'object' && p !== null && 'description' in p
                ? String(p.description)
                : undefined,
            arguments:
              typeof p === 'object' && p !== null && 'arguments' in p ? p.arguments : undefined,
            files: typeof p === 'object' && p !== null && 'files' in p ? p.files : undefined
          })) as PromptListEntry[]
          // 缓存结果
          this.cachedPrompts = validPrompts
          return this.cachedPrompts
        }
      }
      throw new Error('Invalid prompt response format')
    } catch (error) {
      // 检查并处理session错误
      await this.checkAndHandleSessionError(error)

      // 尝试从错误对象中提取更多信息
      const errorMessage = error instanceof Error ? error.message : String(error)
      // 如果错误表明不支持，则缓存空数组
      if (errorMessage.includes('Method not found') || errorMessage.includes('not supported')) {
        console.warn(`Server ${this.serverName} does not support listPrompts`)
        this.cachedPrompts = []
        return this.cachedPrompts
      } else {
        console.error(`Failed to list MCP prompts:`, error)
        // 发生其他错误，不清空缓存（保持null），以便下次重试
        throw error
      }
    }
  }

  // 获取指定提示
  async getPrompt(name: string, args?: Record<string, unknown>): Promise<Prompt> {
    try {
      if (!this.isConnected) {
        await this.connect()
      }

      if (!this.client) {
        throw new Error(`MCP client ${this.serverName} not initialized`)
      }

      const response = await this.client.getPrompt({
        name,
        arguments: (args as Record<string, string>) || {}
      })

      // 成功调用后重置重启标志
      this.hasRestarted = false

      // 检查响应格式并转换为 Prompt 类型
      if (
        response &&
        typeof response === 'object' &&
        'messages' in response &&
        Array.isArray(response.messages)
      ) {
        return {
          id: name,
          name: name, // 从请求参数中获取 name
          description: response.description || '',
          messages: response.messages as Array<{ role: string; content: { text: string } }>
        }
      }
      throw new Error('Invalid get prompt response format')
    } catch (error) {
      // 检查并处理session错误
      await this.checkAndHandleSessionError(error)

      console.error(`Failed to get MCP prompt ${name}:`, error)
      // 获取失败，清空提示缓存
      this.cachedPrompts = null
      throw error
    }
  }

  // 列出可用资源
  async listResources(): Promise<ResourceListEntry[]> {
    // 检查缓存
    if (this.cachedResources !== null) {
      return this.cachedResources
    }

    try {
      if (!this.isConnected) {
        await this.connect()
      }

      if (!this.client) {
        throw new Error(`MCP client ${this.serverName} not initialized`)
      }

      // SDK可能没有 listResources 方法，需要使用通用的 request
      const response = await this.client.listResources()

      // 成功调用后重置重启标志
      this.hasRestarted = false

      // 检查响应格式
      if (response && typeof response === 'object' && 'resources' in response) {
        const resourcesArray = (response as { resources: unknown }).resources
        if (Array.isArray(resourcesArray)) {
          // 需要确保每个元素都符合 ResourceListEntry 接口
          const validResources = resourcesArray.map((r) => ({
            uri: typeof r === 'object' && r !== null && 'uri' in r ? String(r.uri) : 'unknown',
            name: typeof r === 'object' && r !== null && 'name' in r ? String(r.name) : undefined
          })) as ResourceListEntry[]
          // 缓存结果
          this.cachedResources = validResources
          return this.cachedResources
        }
      }
      throw new Error('Invalid resource list response format')
    } catch (error) {
      // 检查并处理session错误
      await this.checkAndHandleSessionError(error)

      // 尝试从错误对象中提取更多信息
      const errorMessage = error instanceof Error ? error.message : String(error)
      // 如果错误表明不支持，则缓存空数组
      if (errorMessage.includes('Method not found') || errorMessage.includes('not supported')) {
        console.warn(`Server ${this.serverName} does not support listResources`)
        this.cachedResources = []
        return this.cachedResources
      } else {
        console.error(`Failed to list MCP resources:`, error)
        // 发生其他错误，不清空缓存（保持null），以便下次重试
        throw error
      }
    }
  }

  // 读取资源
  async readResource(resourceUri: string): Promise<Resource> {
    try {
      if (!this.isConnected) {
        await this.connect()
      }

      if (!this.client) {
        throw new Error(`MCP client ${this.serverName} not initialized`)
      }

      // 使用 unknown 作为中间类型进行转换
      const rawResource = await this.client.readResource({ uri: resourceUri })

      // 成功调用后重置重启标志
      this.hasRestarted = false

      // 手动构造 Resource 对象
      const resource: Resource = {
        uri: resourceUri,
        text:
          typeof rawResource === 'object' && rawResource !== null && 'text' in rawResource
            ? String(rawResource['text'])
            : JSON.stringify(rawResource)
      }

      return resource
    } catch (error) {
      // 检查并处理session错误
      await this.checkAndHandleSessionError(error)

      console.error(`Failed to read MCP resource ${resourceUri}:`, error)
      // 读取失败，清空资源缓存
      this.cachedResources = null
      throw error
    }
  }
}

// 工厂函数，用于创建 MCP 客户端
export async function createMcpClient(serverName: string): Promise<McpClient> {
  // 从configPresenter获取MCP服务器配置
  const servers = await presenter.configPresenter.getMcpServers()

  // 获取服务器配置
  const serverConfig = servers[serverName]
  if (!serverConfig) {
    throw new Error(`MCP server ${serverName} not found in configuration`)
  }

  // 创建并返回 MCP 客户端，传入null作为npmRegistry
  // 注意：这个函数应该只用于直接创建客户端实例的情况
  // 正常情况下应该通过ServerManager创建，以便使用测试后的npm registry
  return new McpClient(serverName, serverConfig as unknown as Record<string, unknown>, null)
}
