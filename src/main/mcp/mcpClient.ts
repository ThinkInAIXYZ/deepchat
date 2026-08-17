import type { ProviderSettingsPort } from '@/provider/settings'
import logger from '@shared/logger'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import {
  Client,
  InMemoryTransport,
  ProtocolError,
  ProtocolErrorCode,
  SdkError,
  SdkErrorCode,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  fromJsonSchema
} from '@modelcontextprotocol/client'
import type {
  AuthProvider,
  ClientContext,
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequest,
  ElicitResult,
  ListPromptsResult,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ListRootsRequest,
  ListRootsResult,
  ListToolsResult,
  Tool as SdkTool,
  Transport
} from '@modelcontextprotocol/client'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import path from 'path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
// import { NO_PROXY, proxyConfig } from '@/platform/proxy'
import type { InMemoryServerFactory } from './inMemoryServers/builder'
import { RuntimeHelper } from '@/lib/runtimeHelper'
import { terminateProcessTreeByPid } from '@/agent/shared/process/processTree'
import { awaitWithAbort } from '@/lib/awaitWithAbort'
import type { McpOAuthManager } from './mcpOAuthManager'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { Prompt } from '@shared/types/prompt'
import type {
  PromptListEntry,
  ToolCallResult,
  Tool,
  ResourceListEntry,
  Resource,
  McpElicitationRequestPayload,
  McpServerDiagnostics,
  McpSamplingRequestPayload,
  McpSamplingDecision,
  McpServerAuthStatus,
  McpProbeReasonCode,
  MCPServerConfig
} from '@shared/types/mcp'
import type { McpServicePort } from '@shared/types/mcp'
import type { ProviderRuntimePort } from '@shared/types/provider'
import type {
  McpServerLifecycleStatus,
  McpServerStatusPhase,
  McpServerStatusReason
} from '@shared/types/core/mcp'
import { createMinimalProcessEnvironment } from './processEnvironment'
import {
  assertBoundedMcpJson,
  validateAndCloneJsonSchema,
  validateAndCloneMcpTool
} from './schemaValidation'
import {
  AUTH_EXTENSION_CLIENT_CREDENTIALS,
  MCP_CLIENT_CREDENTIALS_DRAFT_REVISION
} from './mcpOAuthManager'

const ALLOWED_SAMPLING_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp'
])

const MCP_STARTUP_SOFT_TIMEOUT_MS = 45 * 1000
const MCP_CONNECT_HARD_TIMEOUT_MS = 5 * 60 * 1000
const MCP_STDIO_NEGOTIATION_PROBE_TIMEOUT_MS = 8 * 1000
const MCP_HTTP_NEGOTIATION_PROBE_TIMEOUT_MS = 20 * 1000
const MCP_STDIO_MAX_BUFFER_BYTES = 10 * 1024 * 1024
const MCP_INPUT_REQUIRED_MAX_ROUNDS = 10
const MCP_DEFAULT_CACHE_TTL_MS = 0
const MCP_SAMPLING_MAX_MESSAGES = 128
const MCP_SAMPLING_MAX_TEXT_BYTES = 1024 * 1024
const MCP_SAMPLING_MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MCP_SAMPLING_MAX_ENCODED_IMAGE_CHARS = 12 * 1024 * 1024
const MCP_SAMPLING_MAX_TOTAL_BYTES = 20 * 1024 * 1024
const MCP_SAMPLING_MAX_HINTS = 64
const MCP_TOOL_RESULT_MAX_BYTES = 32 * 1024 * 1024
const MCP_CONTROL_RESULT_MAX_BYTES = 32 * 1024 * 1024
const MCP_ELICITATION_MAX_MESSAGE_BYTES = 32 * 1024
const MCP_ELICITATION_MAX_URL_BYTES = 8 * 1024
const MCP_ELICITATION_MAX_FIELDS = 256
const MCP_ELICITATION_MAX_CONTENT_BYTES = 1024 * 1024
const MCP_CUSTOM_HEADER_MAX_COUNT = 64
const MCP_CUSTOM_HEADER_MAX_NAME_BYTES = 256
const MCP_CUSTOM_HEADER_MAX_VALUE_BYTES = 16 * 1024
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

const normalizeCustomHeaders = (raw: unknown): Record<string, string> => {
  if (raw === undefined) {
    return {}
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('MCP custom headers must be an object')
  }
  const entries = Object.entries(raw)
  if (entries.length > MCP_CUSTOM_HEADER_MAX_COUNT) {
    throw new Error('MCP custom headers exceeded the host limit')
  }
  return Object.fromEntries(
    entries.map(([name, value]) => {
      if (
        !HTTP_HEADER_NAME_PATTERN.test(name) ||
        Buffer.byteLength(name, 'utf8') > MCP_CUSTOM_HEADER_MAX_NAME_BYTES
      ) {
        throw new Error(`Invalid MCP custom header name: ${name.slice(0, 128)}`)
      }
      if (
        typeof value !== 'string' ||
        /[\r\n]/.test(value) ||
        Buffer.byteLength(value, 'utf8') > MCP_CUSTOM_HEADER_MAX_VALUE_BYTES
      ) {
        throw new Error(`Invalid MCP custom header value for ${name}`)
      }
      return [name, value]
    })
  )
}

const normalizeRemoteMcpUrl = (raw: unknown): URL => {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('MCP remote server URL is missing')
  }
  const url = new URL(raw)
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error('MCP remote server URL must be HTTP(S) without credentials or fragments')
  }
  return url
}

export type McpConnectResult = 'connected' | 'soft-timeout-released' | 'stopped'

class McpStartupSoftTimeoutError extends Error {
  constructor(serverName: string) {
    super(`Connection to MCP server ${serverName} reached startup soft timeout`)
    this.name = 'McpStartupSoftTimeoutError'
  }
}

class McpConnectionHardTimeoutError extends Error {
  constructor(serverName: string) {
    super(`Connection to MCP server ${serverName} timed out`)
    this.name = 'McpConnectionHardTimeoutError'
  }
}

export class McpConnectionCancelledError extends Error {
  constructor(serverName: string) {
    super(`Connection to MCP server ${serverName} was cancelled`)
    this.name = 'McpConnectionCancelledError'
  }
}

type McpConnectOptions = {
  phase?: McpServerStatusPhase
  waitForConnection?: boolean
}

interface ServerStatusChangedOptions {
  phase?: McpServerStatusPhase
  attempt?: number
  reason?: McpServerStatusReason
  message?: string
}

export type McpClientRuntime = {
  sampling: Pick<McpServicePort, 'handleSamplingRequest' | 'cancelSamplingRequest'>
  elicitation: Pick<McpServicePort, 'handleElicitationRequest' | 'cancelElicitationRequest'>
  completion: Pick<ProviderRuntimePort, 'generateCompletionStandalone'>
  config: Pick<ProviderSettingsPort, 'getProviderModels' | 'getCustomModels'>
}

// Static bearer adapter. Configured headers take precedence over managed OAuth modes.
class SimpleOAuthProvider implements AuthProvider {
  private accessToken: string | null = null

  constructor(authHeader: string | undefined) {
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      const token = authHeader.substring(7).trim()
      if (!token) {
        throw new Error('MCP Bearer authorization header is missing a token')
      }
      this.accessToken = token
    }
  }

  async token(): Promise<string | undefined> {
    return this.accessToken ?? undefined
  }
}

function isUnsupportedCapabilityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof ProtocolError && error.code === ProtocolErrorCode.MethodNotFound) {
    return true
  }
  return /method not found|unknown method|not supported|unsupported|mcp error -32601/i.test(message)
}

// MCP client class
const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError')

const withUnsupportedCapabilityFallback = async <T>(
  request: () => Promise<T>,
  fallback: T,
  signal?: AbortSignal
): Promise<T> => {
  try {
    const result = await request()
    signal?.throwIfAborted()
    return result
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      throw error
    }
    if (isUnsupportedCapabilityError(error)) {
      return fallback
    }
    throw error
  }
}

export class McpClient {
  private client: Client | null = null
  private transport: Transport | null = null
  public serverName: string
  public serverConfig: Record<string, unknown>
  private isConnected: boolean = false
  private connectionTimeout: NodeJS.Timeout | null = null
  private stdioPidForShutdown?: number
  private connectPromise: Promise<void> | null = null
  private startupAttempt = 0
  private lifecycleStatus: McpServerLifecycleStatus = 'stopped'
  private connectAborted = false
  private npmRegistry: string | null = null
  private uvRegistry: string | null = null
  private mcpOAuthManager?: McpOAuthManager
  private readonly inMemoryServerFactory?: InMemoryServerFactory
  private readonly runtime: McpClientRuntime
  private readonly onRegistryChanged: () => void
  private readonly runtimeHelper = RuntimeHelper.getInstance()
  private probe: McpServerDiagnostics['probe'] = { outcome: 'not-run' }

  constructor(
    serverName: string,
    serverConfig: Record<string, unknown>,
    npmRegistry: string | null = null,
    uvRegistry: string | null = null,
    mcpOAuthManager: McpOAuthManager | undefined,
    inMemoryServerFactory: InMemoryServerFactory | undefined,
    runtime: McpClientRuntime,
    onRegistryChanged: () => void,
    private readonly publishEvent: DeepchatEventPublisher
  ) {
    this.serverName = serverName
    this.serverConfig = serverConfig
    this.npmRegistry = npmRegistry
    this.uvRegistry = uvRegistry
    this.mcpOAuthManager = mcpOAuthManager
    this.inMemoryServerFactory = inMemoryServerFactory
    this.runtime = runtime
    this.onRegistryChanged = onRegistryChanged
    this.runtimeHelper.initializeRuntimes()
  }

  private emitServerStatusChanged(
    lifecycleStatus: McpServerLifecycleStatus,
    options: ServerStatusChangedOptions = {}
  ): void {
    this.lifecycleStatus = lifecycleStatus
    const isRunning = lifecycleStatus === 'connected'
    const payload = {
      name: this.serverName,
      serverName: this.serverName,
      lifecycleStatus,
      status: lifecycleStatus,
      isRunning,
      phase: options.phase,
      attempt: options.attempt,
      reason: options.reason,
      message: options.message,
      version: Date.now()
    }

    this.onRegistryChanged()
    this.publishEvent('mcp.server.status.changed', payload)
  }

  public processCommandWithArgs(
    command: string,
    args: string[]
  ): { command: string; args: string[] } {
    this.runtimeHelper.initializeRuntimes()
    return this.runtimeHelper.processCommandWithArgs(command, args)
  }

  public expandPath(inputPath: string): string {
    return this.runtimeHelper.expandPath(inputPath)
  }

  public get nodeRuntimePath(): string | null {
    this.runtimeHelper.initializeRuntimes()
    return this.runtimeHelper.getNodeRuntimePath()
  }

  public set nodeRuntimePath(value: string | null) {
    this.runtimeHelper.setNodeRuntimePath(value)
  }

  public get bunRuntimePath(): string | null {
    return this.nodeRuntimePath
  }

  public set bunRuntimePath(value: string | null) {
    this.nodeRuntimePath = value
  }

  public get uvRuntimePath(): string | null {
    this.runtimeHelper.initializeRuntimes()
    return this.runtimeHelper.getUvRuntimePath()
  }

  public set uvRuntimePath(value: string | null) {
    this.runtimeHelper.setUvRuntimePath(value)
  }

  private addRuntimePathsToEnvironment(
    env: Record<string, string>,
    homeDir: string,
    inheritedPaths = [env.PATH, env.Path, env.path].filter((value): value is string =>
      Boolean(value)
    )
  ): void {
    const allPaths = [...inheritedPaths, ...this.runtimeHelper.getDefaultPaths(homeDir)]
    const uvRuntimePath = this.runtimeHelper.getUvRuntimePath()
    const nodeRuntimePath = this.runtimeHelper.getNodeRuntimePath()
    if (process.platform === 'win32') {
      if (uvRuntimePath) {
        allPaths.unshift(uvRuntimePath)
      }
      if (nodeRuntimePath) {
        allPaths.unshift(nodeRuntimePath)
      }
    } else {
      if (uvRuntimePath) {
        allPaths.unshift(uvRuntimePath)
      }
      if (nodeRuntimePath) {
        allPaths.unshift(path.join(nodeRuntimePath, 'bin'))
      }
    }
    const { key, value } = this.runtimeHelper.normalizePathEnv(allPaths)
    env[key] = value
  }

  // Connect to MCP server
  async connect(options: McpConnectOptions = {}): Promise<McpConnectResult> {
    if (this.isConnected && this.client) {
      console.info(`MCP server ${this.serverName} is already running`)
      return 'connected'
    }

    if (this.connectPromise) {
      if (options.waitForConnection) {
        await this.connectPromise
        return 'connected'
      }
      return this.waitForConnectSoftTimeout(this.connectPromise, this.startupAttempt, options.phase)
    }

    const attempt = this.startupAttempt + 1
    this.startupAttempt = attempt
    const phase = options.phase ?? 'manual'
    this.connectAborted = false
    this.emitServerStatusChanged('connecting', { phase, attempt })

    const connectPromise = this.performConnect(attempt, phase)
    this.connectPromise = connectPromise
    connectPromise
      .catch(() => undefined)
      .finally(() => {
        if (this.connectPromise === connectPromise) {
          this.connectPromise = null
        }
      })

    if (options.waitForConnection) {
      await connectPromise
      return 'connected'
    }

    return this.waitForConnectSoftTimeout(connectPromise, attempt, options.phase)
  }

  private async ensureConnectedForRequest(signal?: AbortSignal): Promise<void> {
    if (!this.isConnected) {
      await awaitWithAbort(this.connect({ phase: 'manual', waitForConnection: true }), signal)
    }

    signal?.throwIfAborted()
    if (!this.isConnected || !this.client) {
      throw new Error(`MCP client ${this.serverName} is not connected`)
    }
  }

  private async waitForConnectSoftTimeout(
    connectPromise: Promise<void>,
    attempt: number,
    phase: McpServerStatusPhase = 'manual'
  ): Promise<McpConnectResult> {
    let softTimeout: NodeJS.Timeout | null = null
    try {
      await Promise.race([
        connectPromise,
        new Promise<never>((_, reject) => {
          softTimeout = setTimeout(() => {
            reject(new McpStartupSoftTimeoutError(this.serverName))
          }, MCP_STARTUP_SOFT_TIMEOUT_MS)
        })
      ])
      return 'connected'
    } catch (error) {
      if (error instanceof McpStartupSoftTimeoutError) {
        if (this.connectAborted || this.lifecycleStatus === 'stopped') {
          throw new McpConnectionCancelledError(this.serverName)
        }
        console.warn(
          `MCP server ${this.serverName} startup soft timeout reached; continuing in background`
        )
        this.emitServerStatusChanged('timeout', {
          phase,
          attempt,
          reason: 'soft-timeout',
          message: error.message
        })
        this.emitServerStatusChanged('retrying', {
          phase: 'retry',
          attempt,
          reason: 'soft-timeout',
          message: 'Connection is still running in the background'
        })
        return 'soft-timeout-released'
      }
      throw error
    } finally {
      if (softTimeout) {
        clearTimeout(softTimeout)
      }
    }
  }

  private async performConnect(attempt: number, phase: McpServerStatusPhase): Promise<void> {
    const transportType = this.serverConfig.type
    const useModernNegotiation =
      !this.serverConfig.forceLegacyWire && (transportType === 'stdio' || transportType === 'http')
    try {
      console.info(`Starting MCP server ${this.serverName}...`, {
        type: this.serverConfig.type
      })

      // Handle customHeaders and AuthProvider
      let authProvider: SimpleOAuthProvider | null = null
      const customHeaders = normalizeCustomHeaders(this.serverConfig.customHeaders)

      const authorizationHeaderKeys = Object.keys(customHeaders).filter(
        (key) => key.toLowerCase() === 'authorization'
      )
      if (authorizationHeaderKeys.length > 1) {
        throw new Error('MCP server configuration contains duplicate Authorization headers')
      }
      const authorizationHeaderKey = authorizationHeaderKeys[0]
      const hasConfiguredAuthorization = Boolean(authorizationHeaderKey)
      if (authorizationHeaderKey) {
        const authorizationHeader = customHeaders[authorizationHeaderKey]
        if (authorizationHeader.toLowerCase().startsWith('bearer ')) {
          authProvider = new SimpleOAuthProvider(authorizationHeader)
          delete customHeaders[authorizationHeaderKey]
        }
      }
      const runtimeOAuthProvider = hasConfiguredAuthorization
        ? (authProvider ?? undefined)
        : await this.mcpOAuthManager?.createRuntimeProvider(
            this.serverName,
            this.serverConfig as Partial<MCPServerConfig>
          )

      if (this.serverConfig.type === 'inmemory') {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
        const _args = Array.isArray(this.serverConfig.args) ? this.serverConfig.args : []
        const _env = this.serverConfig.env ? (this.serverConfig.env as Record<string, unknown>) : {}
        if (!this.inMemoryServerFactory) {
          throw new Error(`In-memory MCP server factory is required for ${this.serverName}`)
        }
        const _server = this.inMemoryServerFactory(this.serverName, _args, _env)
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

        if (this.serverConfig.inheritEnv === 'minimal') {
          Object.assign(env, createMinimalProcessEnvironment(process.env, process.platform))
          this.addRuntimePathsToEnvironment(env, HOME_DIR)
        } else if (isNodeCommand) {
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

            this.addRuntimePathsToEnvironment(env, HOME_DIR, existingPaths)
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

          this.addRuntimePathsToEnvironment(env, HOME_DIR, existingPaths)
        }

        // 添加自定义环境变量
        if (this.serverConfig.env) {
          Object.entries(this.serverConfig.env as Record<string, unknown>).forEach(
            ([key, value]) => {
              if (value !== undefined) {
                const stringValue = String(value ?? '')
                // 如果是PATH相关变量，合并到主PATH中
                if (['PATH', 'Path', 'path'].includes(key)) {
                  const currentPathKey = process.platform === 'win32' ? 'Path' : 'PATH'
                  const separator = process.platform === 'win32' ? ';' : ':'
                  env[currentPathKey] = env[currentPathKey]
                    ? `${stringValue}${separator}${env[currentPathKey]}`
                    : stringValue
                } else {
                  env[key] = stringValue
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

        this.transport = new StdioClientTransport({
          command,
          args,
          env,
          stderr: 'pipe',
          maxBufferSize: MCP_STDIO_MAX_BUFFER_BYTES
        })
        ;(this.transport as StdioClientTransport).stderr?.on('data', (data) => {
          console.info('mcp StdioClientTransport error', this.serverName, data.toString())
        })
      } else if (this.serverConfig.baseUrl && this.serverConfig.type === 'sse') {
        this.transport = new SSEClientTransport(normalizeRemoteMcpUrl(this.serverConfig.baseUrl), {
          requestInit: { headers: customHeaders },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          authProvider: (runtimeOAuthProvider ?? undefined) as any
        })
      } else if (this.serverConfig.baseUrl && this.serverConfig.type === 'http') {
        this.transport = new StreamableHTTPClientTransport(
          normalizeRemoteMcpUrl(this.serverConfig.baseUrl),
          {
            requestInit: { headers: customHeaders },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            authProvider: (runtimeOAuthProvider ?? undefined) as any
          }
        )
      } else {
        throw new Error(`Unsupported transport type: ${this.serverConfig.type}`)
      }

      // 创建 MCP 客户端
      this.probe = { outcome: 'not-run' }
      const authorizationExtensions =
        this.mcpOAuthManager?.getUsableAuthorizationExtensions(
          this.serverConfig as Partial<MCPServerConfig>
        ) ?? []
      this.client = new Client(
        { name: 'DeepChat', version: app.getVersion() },
        {
          capabilities: {
            sampling: {},
            elicitation: {
              form: { applyDefaults: true },
              url: {}
            },
            roots: {},
            extensions: {
              'io.modelcontextprotocol/ui': {
                mimeTypes: ['text/html;profile=mcp-app']
              },
              ...Object.fromEntries(authorizationExtensions.map((extension) => [extension, {}]))
            }
          },
          versionNegotiation: useModernNegotiation
            ? {
                mode: 'auto',
                probe: {
                  timeoutMs:
                    transportType === 'http'
                      ? MCP_HTTP_NEGOTIATION_PROBE_TIMEOUT_MS
                      : MCP_STDIO_NEGOTIATION_PROBE_TIMEOUT_MS,
                  maxRetries: transportType === 'http' ? 1 : 0
                }
              }
            : { mode: 'legacy' },
          inputRequired: {
            autoFulfill: true,
            maxRounds: MCP_INPUT_REQUIRED_MAX_ROUNDS
          },
          listChanged: {
            tools: {
              onChanged: (error) => this.handleListChanged('tools', error)
            },
            prompts: {
              onChanged: (error) => this.handleListChanged('prompts', error)
            },
            resources: {
              onChanged: (error) => this.handleListChanged('resources', error)
            }
          },
          defaultCacheTtlMs: MCP_DEFAULT_CACHE_TTL_MS
        }
      )
      const connectedClient = this.client
      connectedClient.onerror = (error) => {
        console.warn(`[MCP] Protocol error from ${this.serverName}:`, error)
      }
      connectedClient.onclose = () => {
        if (this.client !== connectedClient || !this.isConnected) {
          return
        }
        this.client = null
        this.transport = null
        this.isConnected = false
        this.emitServerStatusChanged('stopped', {
          reason: 'connect-error',
          message: 'The MCP server closed the connection'
        })
      }

      // 注册采样请求处理器
      this.client.setRequestHandler('sampling/createMessage', async (request, ctx) => {
        return this.handleSamplingCreateMessage(request, ctx)
      })
      this.client.setRequestHandler('elicitation/create', async (request, ctx) => {
        return this.handleElicitationCreate(request, ctx)
      })
      this.client.setRequestHandler(
        'roots/list',
        async (_request: ListRootsRequest): Promise<ListRootsResult> => ({ roots: [] })
      )

      // 设置连接超时
      const timeoutPromise = new Promise<void>((_, reject) => {
        this.connectionTimeout = setTimeout(() => {
          console.error(`Connection to MCP server ${this.serverName} timed out`)
          reject(new McpConnectionHardTimeoutError(this.serverName))
        }, MCP_CONNECT_HARD_TIMEOUT_MS)
      })

      // 连接到服务器
      const connectPromise = this.client.connect(this.transport)

      // 等待连接完成或硬超时
      await Promise.race([connectPromise, timeoutPromise])

      // 清除超时
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout)
        this.connectionTimeout = null
      }

      if (this.connectAborted) {
        throw new McpConnectionCancelledError(this.serverName)
      }

      this.isConnected = true
      if (useModernNegotiation) {
        const era = this.client.getProtocolEra()
        this.probe =
          era === 'modern'
            ? { outcome: 'modern', reasonCode: 'modern-accepted' }
            : { outcome: 'legacy-fallback', reasonCode: 'valid-legacy-signal' }
      }
      console.info(`MCP server ${this.serverName} connected successfully`)

      this.emitServerStatusChanged('connected', { phase, attempt })
    } catch (error) {
      // 清除超时
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout)
        this.connectionTimeout = null
      }

      // 清理资源
      await this.cleanupResources({ emitStopped: false })

      if (error instanceof McpConnectionCancelledError || this.connectAborted) {
        console.info(`MCP server ${this.serverName} connection cancelled`)
        throw new McpConnectionCancelledError(this.serverName)
      }

      if (useModernNegotiation) {
        this.probe = {
          outcome: 'failed',
          reasonCode: this.classifyProbeFailure(error)
        }
      }
      console.error(`Failed to connect to MCP server ${this.serverName}:`, error)

      this.emitServerStatusChanged('failed', {
        phase,
        attempt,
        reason: error instanceof McpConnectionHardTimeoutError ? 'hard-timeout' : 'connect-error',
        message: error instanceof Error ? error.message : String(error)
      })

      throw error
    }
  }

  // 断开与 MCP 服务器的连接
  async disconnect(): Promise<void> {
    if (!this.client && !this.transport && !this.connectPromise) {
      return
    }

    this.connectAborted = true
    this.emitServerStatusChanged('stopped', { phase: 'shutdown', reason: 'shutdown' })

    try {
      // Use internal disconnect method for normal disconnection
      await this.internalDisconnect(undefined, 'shutdown')
    } catch (error) {
      console.error(`Failed to disconnect from MCP server ${this.serverName}:`, error)
      throw error
    }
  }

  // 清理资源
  private async cleanupResources(options: { emitStopped?: boolean } = {}): Promise<void> {
    // 清除超时定时器
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout)
      this.connectionTimeout = null
    }

    if (this.client) {
      this.client.onclose = undefined
      this.client.onerror = undefined
    }

    // 关闭transport
    const transport = this.transport
    this.stdioPidForShutdown = this.getStdioPid(transport) ?? this.stdioPidForShutdown
    this.transport = null
    if (transport) {
      try {
        await this.closeTransport(transport)
      } catch (error) {
        console.error(`Failed to close MCP transport:`, error)
      }
    }

    // 重置状态
    this.client = null
    this.isConnected = false

    if (options.emitStopped) {
      this.emitServerStatusChanged('stopped', { reason: 'shutdown' })
    }
  }

  private getStdioPid(transport: Transport | null = this.transport): number | undefined {
    if (!(transport instanceof StdioClientTransport)) {
      return undefined
    }
    return transport.pid ?? undefined
  }

  async forceTerminateStdioProcessTree(reason: string): Promise<boolean> {
    const pid = this.getStdioPid() ?? this.stdioPidForShutdown
    if (!pid) {
      return false
    }

    try {
      await terminateProcessTreeByPid(pid, { graceMs: 2000 })
      console.warn(`[MCP] Force terminated stdio process tree for ${this.serverName}: ${reason}`)
      return true
    } catch (error) {
      console.warn(
        `Failed to force terminate MCP stdio process tree for ${this.serverName}:`,
        error
      )
      return false
    }
  }

  private async closeTransport(transport: Transport): Promise<void> {
    const pid = this.getStdioPid(transport)

    try {
      await transport.close()
    } finally {
      if (pid) {
        try {
          await terminateProcessTreeByPid(pid, { graceMs: 2000 })
        } catch (error) {
          console.error(`Failed to terminate MCP stdio process tree for ${this.serverName}:`, error)
        }
      }
      if (this.stdioPidForShutdown === pid) {
        this.stdioPidForShutdown = undefined
      }
    }
  }

  private handleListChanged(kind: 'tools' | 'prompts' | 'resources', error: Error | null): void {
    if (error) {
      console.warn(`[MCP] Failed to refresh ${kind} after list change:`, error)
      return
    }
    if (kind === 'tools') {
      this.onRegistryChanged()
    }
  }

  private async handleSamplingCreateMessage(
    request: CreateMessageRequest,
    ctx: ClientContext
  ): Promise<CreateMessageResult> {
    const params = request.params ?? {}
    const requestId = this.resolveRequestId()
    const { payload, chatMessages } = this.prepareSamplingContext(requestId, params)

    const decisionPromise = this.runtime.sampling.handleSamplingRequest(payload)
    const signal = ctx.mcpReq.signal
    const decisionWait = awaitWithAbort(decisionPromise, signal)
    let abortListener: (() => void) | undefined

    if (signal) {
      abortListener = () => {
        void this.runtime.sampling
          .cancelSamplingRequest(payload.requestId, 'cancelled by server')
          .catch((error) => {
            console.warn(`[MCP] Failed to cancel sampling request ${payload.requestId}:`, error)
          })
      }
      signal.addEventListener('abort', abortListener, { once: true })
      if (signal.aborted) abortListener()
    }

    try {
      let decision: McpSamplingDecision
      try {
        decision = await decisionWait
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) {
          throw new SdkError(SdkErrorCode.RequestTimeout, 'Sampling request cancelled')
        }
        throw error
      }

      if (!decision.approved) {
        throw new ProtocolError(ProtocolErrorCode.InvalidRequest, 'User rejected sampling request')
      }

      if (!decision.providerId || !decision.modelId) {
        throw new ProtocolError(
          ProtocolErrorCode.InvalidParams,
          'No model selected for sampling request'
        )
      }

      let assistantText = ''
      try {
        assistantText = await this.runtime.completion.generateCompletionStandalone(
          decision.providerId,
          chatMessages,
          decision.modelId,
          undefined,
          params.maxTokens,
          { signal, swallowErrors: false }
        )
        signal?.throwIfAborted()
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) throw error
        console.error(`[MCP] Sampling request failed for server ${this.serverName}:`, error)
        throw new ProtocolError(
          ProtocolErrorCode.InternalError,
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
    } finally {
      if (signal && abortListener) signal.removeEventListener('abort', abortListener)
    }
  }

  private async handleElicitationCreate(
    request: ElicitRequest,
    ctx: ClientContext
  ): Promise<ElicitResult> {
    const params = request.params
    const requestId = this.resolveRequestId()
    const mode = params.mode === 'url' ? 'url' : 'form'
    if (Buffer.byteLength(params.message, 'utf8') > MCP_ELICITATION_MAX_MESSAGE_BYTES) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        'Elicitation message exceeded the host limit'
      )
    }
    let url: string | undefined
    if (params.mode === 'url') {
      let candidate: URL
      try {
        candidate = new URL(params.url)
      } catch {
        throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Elicitation URL is invalid')
      }
      if (candidate.protocol !== 'https:' && candidate.protocol !== 'http:') {
        throw new ProtocolError(
          ProtocolErrorCode.InvalidParams,
          'Elicitation URL must use HTTP or HTTPS'
        )
      }
      if (candidate.username || candidate.password) {
        throw new ProtocolError(
          ProtocolErrorCode.InvalidParams,
          'Elicitation URL must not contain embedded credentials'
        )
      }
      url = candidate.toString()
      if (Buffer.byteLength(url, 'utf8') > MCP_ELICITATION_MAX_URL_BYTES) {
        throw new ProtocolError(
          ProtocolErrorCode.InvalidParams,
          'Elicitation URL exceeded the host limit'
        )
      }
    }

    const requestedSchema =
      mode === 'form' && 'requestedSchema' in params
        ? validateAndCloneJsonSchema(
            params.requestedSchema,
            `MCP elicitation ${this.serverName} requestedSchema`
          )
        : undefined
    if (
      requestedSchema &&
      (!requestedSchema.properties ||
        typeof requestedSchema.properties !== 'object' ||
        Array.isArray(requestedSchema.properties) ||
        Object.keys(requestedSchema.properties).length > MCP_ELICITATION_MAX_FIELDS)
    ) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        'Elicitation form exceeded the host field limit'
      )
    }

    const payload: McpElicitationRequestPayload = {
      requestId,
      serverName: this.serverName,
      mode,
      message: params.message,
      requestedSchema,
      url
    }
    const signal = ctx.mcpReq.signal
    const decisionPromise = this.runtime.elicitation.handleElicitationRequest(payload)
    let abortListener: (() => void) | undefined
    if (signal) {
      abortListener = () => {
        void this.runtime.elicitation
          .cancelElicitationRequest(requestId, 'cancelled by server')
          .catch((error) => {
            console.warn(`[MCP] Failed to cancel elicitation request ${requestId}:`, error)
          })
      }
      signal.addEventListener('abort', abortListener, { once: true })
      if (signal.aborted) {
        abortListener()
      }
    }

    try {
      const decision = await awaitWithAbort(decisionPromise, signal)
      let acceptedContent: ElicitResult['content']
      if (decision.action === 'accept' && mode === 'form' && requestedSchema) {
        const validation = await fromJsonSchema<Record<string, unknown>>(requestedSchema)[
          '~standard'
        ].validate(decision.content ?? {})
        if (validation.issues) {
          throw new ProtocolError(
            ProtocolErrorCode.InvalidParams,
            'Elicitation response did not match the requested schema'
          )
        }
        acceptedContent = validation.value as ElicitResult['content']
        assertBoundedMcpJson(
          acceptedContent,
          'MCP elicitation accepted content',
          MCP_ELICITATION_MAX_CONTENT_BYTES
        )
      }
      return {
        action: decision.action,
        ...(decision.action === 'accept' && acceptedContent ? { content: acceptedContent } : {})
      }
    } finally {
      if (abortListener) {
        signal.removeEventListener('abort', abortListener)
      }
    }
  }

  private resolveRequestId(): string {
    return randomUUID()
  }

  private prepareSamplingContext(
    requestId: string,
    params: CreateMessageRequest['params']
  ): { payload: McpSamplingRequestPayload; chatMessages: ChatMessage[] } {
    const systemPrompt = typeof params?.systemPrompt === 'string' ? params.systemPrompt : undefined
    if (systemPrompt && Buffer.byteLength(systemPrompt, 'utf8') > MCP_SAMPLING_MAX_TEXT_BYTES) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        'Sampling system prompt exceeded the host limit'
      )
    }

    const payload: McpSamplingRequestPayload = {
      requestId,
      serverName: this.serverName,
      serverLabel: this.getServerLabel(),
      serverId:
        typeof this.serverConfig.serverId === 'string' ? this.serverConfig.serverId : undefined,
      configGeneration:
        typeof this.serverConfig.configGeneration === 'number'
          ? this.serverConfig.configGeneration
          : undefined,
      bindingHash:
        typeof this.serverConfig.bindingHash === 'string'
          ? this.serverConfig.bindingHash
          : undefined,
      systemPrompt,
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
    if (messageList.length > MCP_SAMPLING_MAX_MESSAGES) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        'Sampling message count exceeded the host limit'
      )
    }

    for (const message of messageList) {
      if (!message || (message.role !== 'user' && message.role !== 'assistant')) {
        continue
      }

      const rawContent = message.content
      if (!rawContent || typeof rawContent !== 'object' || !('type' in rawContent)) {
        throw new ProtocolError(
          ProtocolErrorCode.InvalidParams,
          'Invalid sampling message content received'
        )
      }

      const content = rawContent as { type: string } & Record<string, unknown>

      if (content.type === 'text') {
        const text = typeof content.text === 'string' ? content.text : ''
        if (Buffer.byteLength(text, 'utf8') > MCP_SAMPLING_MAX_TEXT_BYTES) {
          throw new ProtocolError(
            ProtocolErrorCode.InvalidParams,
            'Sampling text content exceeded the host limit'
          )
        }
        payload.messages.push({ role: message.role, type: 'text', text })
        chatMessages.push({ role: message.role, content: text })
      } else if (content.type === 'image') {
        const rawMimeType = typeof content.mimeType === 'string' ? content.mimeType : undefined
        const normalizedMimeType = rawMimeType?.toLowerCase()

        if (normalizedMimeType && !ALLOWED_SAMPLING_IMAGE_MIME_TYPES.has(normalizedMimeType)) {
          throw new ProtocolError(
            ProtocolErrorCode.InvalidParams,
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
        throw new ProtocolError(
          ProtocolErrorCode.InvalidParams,
          'Audio sampling content is not supported by this client'
        )
      } else {
        throw new ProtocolError(
          ProtocolErrorCode.InvalidParams,
          `Unsupported sampling content type: ${String((content as { type?: unknown }).type)}`
        )
      }
    }

    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MCP_SAMPLING_MAX_TOTAL_BYTES) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        'Sampling request exceeded the host limit'
      )
    }

    return { payload, chatMessages }
  }

  private sanitizeSamplingImageData(rawData: unknown): string {
    if (typeof rawData !== 'string') {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        'Invalid sampling image payload received'
      )
    }
    if (rawData.length > MCP_SAMPLING_MAX_ENCODED_IMAGE_CHARS) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        'Sampling image payload exceeded the host limit'
      )
    }

    const sanitized = rawData.replace(/\s+/g, '')

    if (!sanitized) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        'Invalid sampling image payload received'
      )
    }

    if (sanitized.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(sanitized)) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        'Invalid sampling image payload received'
      )
    }

    let decoded: Buffer

    try {
      decoded = Buffer.from(sanitized, 'base64')
    } catch {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        'Invalid sampling image payload received'
      )
    }

    if (!decoded.length) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        'Invalid sampling image payload received'
      )
    }
    if (decoded.length > MCP_SAMPLING_MAX_IMAGE_BYTES) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        'Sampling image payload exceeded the host limit'
      )
    }

    const reencoded = decoded.toString('base64')

    if (reencoded.replace(/=+$/, '') !== sanitized.replace(/=+$/, '')) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        'Invalid sampling image payload received'
      )
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
      if (preferences.hints.length > MCP_SAMPLING_MAX_HINTS) {
        throw new ProtocolError(
          ProtocolErrorCode.InvalidParams,
          'Sampling model hint count exceeded the host limit'
        )
      }
      normalized.hints = preferences.hints.map((hint: { name?: unknown }) => {
        const name = typeof hint?.name === 'string' ? hint.name : undefined
        if (name && name.length > 256) {
          throw new ProtocolError(
            ProtocolErrorCode.InvalidParams,
            'Sampling model hint exceeded the host limit'
          )
        }
        return { name }
      })
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

    return candidates
      .find((label) => label && label.trim().length > 0)
      ?.trim()
      .slice(0, 512)
  }

  private resolveModelDisplayName(providerId: string, modelId: string): string | undefined {
    try {
      const models = this.runtime.config.getProviderModels(providerId) || []
      const match = models.find((model) => model.id === modelId)
      if (match?.name) {
        return match.name
      }

      const customModels = this.runtime.config.getCustomModels(providerId) || []
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

  isActive(): boolean {
    return !!this.client || !!this.transport || !!this.connectPromise
  }

  getLifecycleStatus(): McpServerLifecycleStatus {
    return this.lifecycleStatus
  }

  getConnectionCompletion(): Promise<void> | null {
    return this.connectPromise
  }

  private async internalDisconnect(
    reason?: string,
    statusReason: McpServerStatusReason = 'shutdown'
  ): Promise<void> {
    // Clean up all resources
    await this.cleanupResources()

    const logMessage = reason
      ? `MCP service ${this.serverName} has been stopped due to ${reason}`
      : `Disconnected from MCP server: ${this.serverName}`

    logger.info(logMessage)

    this.emitServerStatusChanged('stopped', { reason: statusReason })
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal; toolDefinition?: Tool }
  ): Promise<ToolCallResult> {
    try {
      options?.signal?.throwIfAborted()
      await this.ensureConnectedForRequest(options?.signal)
      options?.signal?.throwIfAborted()

      if (!this.client) {
        throw new Error(`MCP client ${this.serverName} not initialized`)
      }

      const request = {
        name: toolName,
        arguments: args
      }
      // The v2 client compiles outputSchema in legacy mode, while the v1 client did not.
      const toolDefinition =
        options?.toolDefinition?.outputSchema && this.getToolSchemaPolicy() === 'legacy'
          ? { ...options.toolDefinition, outputSchema: undefined }
          : options?.toolDefinition
      const result = (await this.client.callTool(request, {
        signal: options?.signal,
        toolDefinition: toolDefinition as SdkTool | undefined
      })) as unknown as ToolCallResult
      options?.signal?.throwIfAborted()
      assertBoundedMcpJson(
        result,
        `MCP tool result ${this.serverName}/${toolName}`,
        MCP_TOOL_RESULT_MAX_BYTES
      )
      return result
    } catch (error) {
      if (options?.signal?.aborted || isAbortError(error)) {
        throw error
      }
      console.error(`Failed to call MCP tool ${toolName}:`, error)
      throw error
    }
  }

  private serverDoesNotAdvertise(capability: 'tools' | 'prompts' | 'resources'): boolean {
    const getCapabilities = this.client?.getServerCapabilities
    if (typeof getCapabilities !== 'function') {
      return false
    }
    const capabilities = getCapabilities.call(this.client)
    return capabilities !== undefined && capabilities[capability] === undefined
  }

  private getToolSchemaPolicy(): 'strict' | 'legacy' {
    const isPluginOwned =
      Boolean(this.serverConfig.ownerPluginId) || this.serverConfig.source === 'plugin'
    return this.client?.getProtocolEra() === 'legacy' &&
      this.serverConfig.type !== 'inmemory' &&
      !isPluginOwned
      ? 'legacy'
      : 'strict'
  }

  async listTools(options?: { signal?: AbortSignal }): Promise<Tool[]> {
    options?.signal?.throwIfAborted()

    try {
      await this.ensureConnectedForRequest(options?.signal)
      options?.signal?.throwIfAborted()

      if (!this.client) {
        throw new Error(`MCP client ${this.serverName} not initialized`)
      }
      if (this.serverDoesNotAdvertise('tools')) {
        return []
      }

      const response = options?.signal
        ? await this.client.listTools(undefined, { signal: options.signal })
        : await this.client.listTools()
      options?.signal?.throwIfAborted()
      this.assertControlResult(response, 'tool list', {
        independentArrayItemsAtPath: '#/tools'
      })
      if (Array.isArray(response.tools)) {
        const schemaPolicy = this.getToolSchemaPolicy()
        return (response.tools as unknown as Tool[]).map((tool) =>
          validateAndCloneMcpTool(tool, this.serverName, schemaPolicy)
        )
      }
      throw new Error('Invalid tool response format')
    } catch (error) {
      if (options?.signal?.aborted || isAbortError(error)) {
        throw error
      }
      if (isUnsupportedCapabilityError(error)) {
        console.warn(`Server ${this.serverName} does not support listTools`)
        return []
      }
      console.error(`Failed to list MCP tools:`, error)
      throw error
    }
  }

  async listToolsPage(cursor?: string, signal?: AbortSignal): Promise<ListToolsResult> {
    signal?.throwIfAborted()
    await this.ensureConnectedForRequest(signal)
    signal?.throwIfAborted()
    const client = this.client
    if (!client) {
      throw new Error(`MCP client ${this.serverName} not initialized`)
    }
    if (this.serverDoesNotAdvertise('tools')) {
      return { tools: [] }
    }
    const result = await withUnsupportedCapabilityFallback(
      () =>
        signal
          ? client.listTools(cursor ? { cursor } : undefined, { signal })
          : client.listTools(cursor ? { cursor } : undefined),
      { tools: [] },
      signal
    )
    this.assertControlResult(result, 'tool list page', {
      independentArrayItemsAtPath: '#/tools'
    })
    const schemaPolicy = this.getToolSchemaPolicy()
    return {
      ...result,
      tools: (result.tools as unknown as Tool[]).map((tool) =>
        validateAndCloneMcpTool(tool, this.serverName, schemaPolicy)
      )
    } as unknown as ListToolsResult
  }

  async listPrompts(): Promise<PromptListEntry[]> {
    try {
      await this.ensureConnectedForRequest()

      if (!this.client) {
        throw new Error(`MCP client ${this.serverName} not initialized`)
      }
      if (this.serverDoesNotAdvertise('prompts')) {
        return []
      }

      const response = await this.client.listPrompts()
      this.assertControlResult(response, 'prompt list')
      if (Array.isArray(response.prompts)) {
        return response.prompts.map((prompt) => ({
          name: prompt.name,
          description: prompt.description,
          arguments: prompt.arguments?.map((argument) => ({
            name: argument.name,
            description: argument.description,
            required: Boolean(argument.required)
          })),
          client: {
            name: this.serverName,
            icon: String(this.serverConfig.icons ?? '')
          }
        }))
      }
      throw new Error('Invalid prompt response format')
    } catch (error) {
      if (isUnsupportedCapabilityError(error)) {
        console.info(`Server ${this.serverName} does not support listPrompts`)
        return []
      }
      console.error(`Failed to list MCP prompts:`, error)
      throw error
    }
  }

  async listPromptsPage(cursor?: string, signal?: AbortSignal): Promise<ListPromptsResult> {
    signal?.throwIfAborted()
    await this.ensureConnectedForRequest(signal)
    signal?.throwIfAborted()
    const client = this.client
    if (!client) {
      throw new Error(`MCP client ${this.serverName} not initialized`)
    }
    if (this.serverDoesNotAdvertise('prompts')) {
      return { prompts: [] }
    }
    const result = await withUnsupportedCapabilityFallback(
      () =>
        signal
          ? client.listPrompts(cursor ? { cursor } : undefined, { signal })
          : client.listPrompts(cursor ? { cursor } : undefined),
      { prompts: [] },
      signal
    )
    this.assertControlResult(result, 'prompt list page')
    return result
  }

  async getPrompt(name: string, args?: Record<string, unknown>): Promise<Prompt> {
    try {
      await this.ensureConnectedForRequest()

      if (!this.client) {
        throw new Error(`MCP client ${this.serverName} not initialized`)
      }

      const response = await this.client.getPrompt({
        name,
        arguments: (args as Record<string, string>) || {}
      })
      this.assertControlResult(response, `prompt ${name}`)

      if (
        response &&
        typeof response === 'object' &&
        'messages' in response &&
        Array.isArray(response.messages)
      ) {
        return {
          id: name,
          name,
          description: response.description || '',
          messages: response.messages as Array<{ role: string; content: { text: string } }>
        }
      }
      throw new Error('Invalid get prompt response format')
    } catch (error) {
      console.error(`Failed to get MCP prompt ${name}:`, error)
      throw error
    }
  }

  async listResources(): Promise<ResourceListEntry[]> {
    try {
      await this.ensureConnectedForRequest()

      if (!this.client) {
        throw new Error(`MCP client ${this.serverName} not initialized`)
      }
      if (this.serverDoesNotAdvertise('resources')) {
        return []
      }

      const response = await this.client.listResources()
      this.assertControlResult(response, 'resource list')
      if (Array.isArray(response.resources)) {
        return response.resources.map((resource) => ({
          uri: resource.uri,
          name: resource.name,
          client: {
            name: this.serverName,
            icon: String(this.serverConfig.icons ?? '')
          }
        }))
      }
      throw new Error('Invalid resource list response format')
    } catch (error) {
      if (isUnsupportedCapabilityError(error)) {
        console.info(`Server ${this.serverName} does not support listResources`)
        return []
      }
      console.error(`Failed to list MCP resources:`, error)
      throw error
    }
  }

  async listResourcesPage(cursor?: string, signal?: AbortSignal): Promise<ListResourcesResult> {
    signal?.throwIfAborted()
    await this.ensureConnectedForRequest(signal)
    signal?.throwIfAborted()
    const client = this.client
    if (!client) {
      throw new Error(`MCP client ${this.serverName} not initialized`)
    }
    if (this.serverDoesNotAdvertise('resources')) {
      return { resources: [] }
    }
    const result = await withUnsupportedCapabilityFallback(
      () =>
        signal
          ? client.listResources(cursor ? { cursor } : undefined, { signal })
          : client.listResources(cursor ? { cursor } : undefined),
      { resources: [] },
      signal
    )
    this.assertControlResult(result, 'resource list page')
    return result
  }

  async listResourceTemplatesPage(
    cursor?: string,
    signal?: AbortSignal
  ): Promise<ListResourceTemplatesResult> {
    signal?.throwIfAborted()
    await this.ensureConnectedForRequest(signal)
    signal?.throwIfAborted()
    const client = this.client
    if (!client) {
      throw new Error(`MCP client ${this.serverName} not initialized`)
    }
    if (this.serverDoesNotAdvertise('resources')) {
      return { resourceTemplates: [] }
    }
    const result = await withUnsupportedCapabilityFallback(
      () =>
        signal
          ? client.listResourceTemplates(cursor ? { cursor } : undefined, { signal })
          : client.listResourceTemplates(cursor ? { cursor } : undefined),
      { resourceTemplates: [] },
      signal
    )
    this.assertControlResult(result, 'resource template list page')
    return result
  }

  async readResource(resourceUri: string): Promise<Resource> {
    const resources = await this.readResourceContents(resourceUri)
    const content = resources.find((entry) => entry.uri === resourceUri) ?? resources[0]
    if (!content) {
      throw new Error(`MCP resource ${resourceUri} returned no content`)
    }
    return content
  }

  async readResourceContents(resourceUri: string): Promise<Resource[]> {
    try {
      await this.ensureConnectedForRequest()

      if (!this.client) {
        throw new Error(`MCP client ${this.serverName} not initialized`)
      }

      const rawResource = await this.client.readResource({ uri: resourceUri })
      this.assertControlResult(rawResource, `resource ${resourceUri}`)
      return rawResource.contents.map((content) => ({
        uri: content.uri,
        mimeType: content.mimeType,
        ...('text' in content ? { text: content.text } : {}),
        ...('blob' in content ? { blob: content.blob } : {}),
        ...('_meta' in content && content._meta ? { _meta: content._meta } : {})
      }))
    } catch (error) {
      console.error(`Failed to read MCP resource ${resourceUri}:`, error)
      throw error
    }
  }

  private classifyProbeFailure(error: unknown): McpProbeReasonCode {
    const status = (error as { status?: unknown; httpStatus?: unknown } | undefined)?.status
    const httpStatus =
      typeof status === 'number'
        ? status
        : (error as { httpStatus?: unknown } | undefined)?.httpStatus
    if (error instanceof UnauthorizedError || httpStatus === 401 || httpStatus === 403) {
      return 'authentication-required'
    }
    if (typeof httpStatus === 'number' && httpStatus >= 500) {
      return 'http-server-error'
    }
    if (
      error instanceof McpConnectionHardTimeoutError ||
      (error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout)
    ) {
      return 'timeout'
    }
    return 'transport-error'
  }

  private assertControlResult(
    value: unknown,
    label: string,
    options: { independentArrayItemsAtPath?: string } = {}
  ): void {
    assertBoundedMcpJson(
      value,
      `MCP ${label} from ${this.serverName}`,
      MCP_CONTROL_RESULT_MAX_BYTES,
      options
    )
  }

  getDiagnostics(auth: McpServerAuthStatus): McpServerDiagnostics {
    const client = this.client
    const capabilities = client?.getServerCapabilities()
    const serverVersion = client?.getServerVersion()
    const transport = this.serverConfig.type as MCPServerConfig['type']
    let authorizationExtensions: string[] = []
    try {
      authorizationExtensions =
        this.mcpOAuthManager?.getUsableAuthorizationExtensions(
          this.serverConfig as Partial<MCPServerConfig>
        ) ?? []
    } catch {
      authorizationExtensions = []
    }
    const subscriptions: McpServerDiagnostics['subscriptions'] = []
    if (capabilities?.tools?.listChanged) subscriptions.push('tools-list-changed')
    if (capabilities?.prompts?.listChanged) subscriptions.push('prompts-list-changed')
    if (capabilities?.resources?.listChanged) subscriptions.push('resources-list-changed')
    if (capabilities?.resources?.subscribe) subscriptions.push('resource-updated')
    if (client?.autoOpenedSubscription) subscriptions.push('modern-listen')
    const connectionState: McpServerDiagnostics['connectionState'] =
      this.lifecycleStatus === 'connected'
        ? 'running'
        : this.lifecycleStatus === 'failed'
          ? 'error'
          : this.lifecycleStatus === 'connecting' ||
              this.lifecycleStatus === 'retrying' ||
              this.lifecycleStatus === 'timeout'
            ? 'starting'
            : 'stopped'

    return {
      serverId: String(this.serverConfig.serverId ?? this.serverName),
      serverName: this.serverName,
      owner: this.serverConfig.ownerPluginId ? 'plugin' : 'deepchat',
      transport,
      connectionState,
      lifecycleStatus: this.lifecycleStatus,
      era: client?.getProtocolEra() ?? 'unknown',
      protocolVersion: client?.getNegotiatedProtocolVersion(),
      serverImplementation: serverVersion
        ? {
            name: serverVersion.name.slice(0, 256),
            version: serverVersion.version.slice(0, 128)
          }
        : undefined,
      probe: this.probe,
      extensions: Object.keys(capabilities?.extensions ?? {})
        .filter((id) => id.length > 0 && id.length <= 256)
        .sort()
        .slice(0, 64),
      clientExtensions: [
        { id: 'io.modelcontextprotocol/ui' },
        ...authorizationExtensions.map((id) => ({
          id,
          ...(id === AUTH_EXTENSION_CLIENT_CREDENTIALS
            ? { revision: MCP_CLIENT_CREDENTIALS_DRAFT_REVISION }
            : {})
        }))
      ],
      cacheState: client ? 'active' : 'unknown',
      subscriptions,
      auth: {
        state: auth.state,
        persistent: auth.persistent,
        mode: auth.mode
      },
      updatedAt: Date.now()
    }
  }
}
