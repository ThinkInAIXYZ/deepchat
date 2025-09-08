import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { type Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { eventBus, SendTarget } from '@/eventbus'
import { MCP_EVENTS } from '@/events'
import path from 'path'
import { presenter } from '@/presenter'
import { app } from 'electron'
import fs from 'fs'
// import { NO_PROXY, proxyConfig } from '@/presenter/proxyConfig'
import { getInMemoryServer } from './inMemoryServers/builder'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  PromptListEntry,
  ToolCallResult,
  Tool,
  Prompt,
  ResourceListEntry,
  Resource
} from '@shared/presenter'
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
  private bunRuntimePath: string | null = null
  private nodeRuntimePath: string | null = null
  private uvRuntimePath: string | null = null
  private npmRegistry: string | null = null
  private uvRegistry: string | null = null

  // Session management
  private isRecovering: boolean = false
  private hasRestarted: boolean = false

  // Cache
  private cachedTools: Tool[] | null = null
  private cachedPrompts: PromptListEntry[] | null = null
  private cachedResources: ResourceListEntry[] | null = null

  // Function to handle PATH environment variables
  private normalizePathEnv(paths: string[]): { key: string; value: string } {
    const isWindows = process.platform === 'win32'
    const separator = isWindows ? ';' : ':'
    const pathKey = isWindows ? 'Path' : 'PATH'

    // Merge all paths
    const pathValue = paths.filter(Boolean).join(separator)

    return { key: pathKey, value: pathValue }
  }

  // Expand various symbols and variables in paths
  private expandPath(inputPath: string): string {
    let expandedPath = inputPath

    // Handle ~ symbol (user home directory)
    if (expandedPath.startsWith('~/') || expandedPath === '~') {
      const homeDir = app.getPath('home')
      expandedPath = expandedPath.replace('~', homeDir)
    }

    // Handle environment variable expansion
    expandedPath = expandedPath.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      return process.env[varName] || match
    })

    // Handle simple $VAR format (without braces)
    expandedPath = expandedPath.replace(/\$([A-Z_][A-Z0-9_]*)/g, (match, varName) => {
      return process.env[varName] || match
    })

    return expandedPath
  }

  // Replace command with runtime version
  private replaceWithRuntimeCommand(command: string): string {
    // Get command basename (remove path)
    const basename = path.basename(command)

    // Choose corresponding runtime path based on command type
    if (process.platform === 'win32') {
      // Windows platform only replaces Node.js related commands, let system handle bun commands automatically
      if (this.nodeRuntimePath) {
        if (basename === 'node') {
          return path.join(this.nodeRuntimePath, 'node.exe')
        } else if (basename === 'npm') {
          // Windows usually has npm as .cmd file
          const npmCmd = path.join(this.nodeRuntimePath, 'npm.cmd')
          if (fs.existsSync(npmCmd)) {
            return npmCmd
          }
          // If doesn't exist, return default path
          return path.join(this.nodeRuntimePath, 'npm')
        } else if (basename === 'npx') {
          // On Windows, npx is typically a .cmd file
          const npxCmd = path.join(this.nodeRuntimePath, 'npx.cmd')
          if (fs.existsSync(npxCmd)) {
            return npxCmd
          }
          // If doesn't exist, return default path
          return path.join(this.nodeRuntimePath, 'npx')
        }
      }
    } else {
      // Non-Windows platforms handle all commands
      if (['node', 'npm', 'npx', 'bun'].includes(basename)) {
        // Prefer Bun if available, otherwise use Node.js
        if (this.bunRuntimePath) {
          // For node/npm/npx, uniformly replace with bun
          const targetCommand = 'bun'
          return path.join(this.bunRuntimePath, targetCommand)
        } else if (this.nodeRuntimePath) {
          // Use Node.js runtime
          let targetCommand: string
          if (basename === 'node') {
            targetCommand = 'node'
          } else if (basename === 'npm') {
            targetCommand = 'npm'
          } else if (basename === 'npx') {
            targetCommand = 'npx'
          } else if (basename === 'bun') {
            targetCommand = 'node' // Map bun command to node
          } else {
            targetCommand = basename
          }
          return path.join(this.nodeRuntimePath, 'bin', targetCommand)
        }
      }
    }

    // UV command handling (all platforms)
    if (['uv', 'uvx'].includes(basename)) {
      if (!this.uvRuntimePath) {
        return command
      }

      // Both uv and uvx use their corresponding commands
      const targetCommand = basename === 'uvx' ? 'uvx' : 'uv'

      if (process.platform === 'win32') {
        return path.join(this.uvRuntimePath, `${targetCommand}.exe`)
      } else {
        return path.join(this.uvRuntimePath, targetCommand)
      }
    }

    return command
  }

  // Handle special parameter replacement (e.g., npx -> bun x)
  private processCommandWithArgs(
    command: string,
    args: string[]
  ): { command: string; args: string[] } {
    const basename = path.basename(command)

    // Handle npx command
    if (basename === 'npx' || command.includes('npx')) {
      if (process.platform === 'win32') {
        // Windows platform uses Node.js npx, keep original arguments
        return {
          command: this.replaceWithRuntimeCommand(command),
          args: args.map((arg) => this.replaceWithRuntimeCommand(arg))
        }
      } else {
        // Non-Windows platforms prefer Bun, need to add 'x' before arguments
        if (this.bunRuntimePath) {
          return {
            command: this.replaceWithRuntimeCommand(command),
            args: ['x', ...args]
          }
        } else if (this.nodeRuntimePath) {
          // If no Bun available, use Node.js with original arguments
          return {
            command: this.replaceWithRuntimeCommand(command),
            args: args.map((arg) => this.replaceWithRuntimeCommand(arg))
          }
        }
      }
    }

    return {
      command: this.replaceWithRuntimeCommand(command),
      args: args.map((arg) => this.replaceWithRuntimeCommand(arg))
    }
  }

  // Get system-specific default paths
  private getDefaultPaths(homeDir: string): string[] {
    if (process.platform === 'darwin') {
      return [
        '/bin',
        '/usr/bin',
        '/usr/local/bin',
        '/usr/local/sbin',
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/usr/local/opt/node/bin',
        '/opt/local/bin',
        `${homeDir}/.cargo/bin`
      ]
    } else if (process.platform === 'linux') {
      return ['/bin', '/usr/bin', '/usr/local/bin', `${homeDir}/.cargo/bin`]
    } else {
      // Windows
      return [`${homeDir}\\.cargo\\bin`, `${homeDir}\\.local\\bin`]
    }
  }

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

    const runtimeBasePath = path
      .join(app.getAppPath(), 'runtime')
      .replace('app.asar', 'app.asar.unpacked')
    console.info('runtimeBasePath', runtimeBasePath)

    // Check if bun runtime file exists
    const bunRuntimePath = path.join(runtimeBasePath, 'bun')
    if (process.platform === 'win32') {
      const bunExe = path.join(bunRuntimePath, 'bun.exe')
      if (fs.existsSync(bunExe)) {
        this.bunRuntimePath = bunRuntimePath
      } else {
        this.bunRuntimePath = null
      }
    } else {
      const bunBin = path.join(bunRuntimePath, 'bun')
      if (fs.existsSync(bunBin)) {
        this.bunRuntimePath = bunRuntimePath
      } else {
        this.bunRuntimePath = null
      }
    }

    // Check if node runtime file exists
    const nodeRuntimePath = path.join(runtimeBasePath, 'node')
    if (process.platform === 'win32') {
      const nodeExe = path.join(nodeRuntimePath, 'node.exe')
      if (fs.existsSync(nodeExe)) {
        this.nodeRuntimePath = nodeRuntimePath
      } else {
        this.nodeRuntimePath = null
      }
    } else {
      const nodeBin = path.join(nodeRuntimePath, 'bin', 'node')
      if (fs.existsSync(nodeBin)) {
        this.nodeRuntimePath = nodeRuntimePath
      } else {
        this.nodeRuntimePath = null
      }
    }

    // Check if uv runtime file exists
    const uvRuntimePath = path.join(runtimeBasePath, 'uv')
    if (process.platform === 'win32') {
      const uvExe = path.join(uvRuntimePath, 'uv.exe')
      const uvxExe = path.join(uvRuntimePath, 'uvx.exe')
      if (fs.existsSync(uvExe) && fs.existsSync(uvxExe)) {
        this.uvRuntimePath = uvRuntimePath
      } else {
        this.uvRuntimePath = null
      }
    } else {
      const uvBin = path.join(uvRuntimePath, 'uv')
      const uvxBin = path.join(uvRuntimePath, 'uvx')
      if (fs.existsSync(uvBin) && fs.existsSync(uvxBin)) {
        this.uvRuntimePath = uvRuntimePath
      } else {
        this.uvRuntimePath = null
      }
    }
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
        // Create appropriate transport
        let command = this.serverConfig.command as string
        let args = this.serverConfig.args as string[]

        // Handle path expansion (including ~ and environment variables)
        command = this.expandPath(command)
        args = args.map((arg) => this.expandPath(arg))

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
        const processedCommand = this.processCommandWithArgs(command, args)
        command = processedCommand.command
        args = processedCommand.args

        // Determine if it's Node.js/Bun/UV related command
        const isNodeCommand = ['node', 'npm', 'npx', 'bun', 'uv', 'uvx'].some(
          (cmd) => command.includes(cmd) || args.some((arg) => arg.includes(cmd))
        )

        if (isNodeCommand) {
          // Node.js/Bun/UV commands use whitelist processing
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
            const defaultPaths = this.getDefaultPaths(HOME_DIR)

            // 合并所有路径
            const allPaths = [...existingPaths, ...defaultPaths]
            // 添加运行时路径
            if (process.platform === 'win32') {
              // Windows平台只添加 node 和 uv 路径
              if (this.uvRuntimePath) {
                allPaths.unshift(this.uvRuntimePath)
              }
              if (this.nodeRuntimePath) {
                allPaths.unshift(this.nodeRuntimePath)
              }
            } else {
              // 其他平台优先级：bun > node > uv
              if (this.uvRuntimePath) {
                allPaths.unshift(this.uvRuntimePath)
              }
              if (this.nodeRuntimePath) {
                allPaths.unshift(path.join(this.nodeRuntimePath, 'bin'))
              }
              if (this.bunRuntimePath) {
                allPaths.unshift(this.bunRuntimePath)
              }
            }

            // 规范化并设置PATH
            const { key, value } = this.normalizePathEnv(allPaths)
            env[key] = value
          }
        } else {
          // 非 Node.js/Bun/UV 命令，保留所有系统环境变量，只补充 PATH
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
          const defaultPaths = this.getDefaultPaths(HOME_DIR)

          // 合并所有路径
          const allPaths = [...existingPaths, ...defaultPaths]
          // 添加运行时路径
          if (process.platform === 'win32') {
            // Windows平台只添加 node 和 uv 路径
            if (this.uvRuntimePath) {
              allPaths.unshift(this.uvRuntimePath)
            }
            if (this.nodeRuntimePath) {
              allPaths.unshift(this.nodeRuntimePath)
            }
          } else {
            // 其他平台优先级：bun > node > uv
            if (this.uvRuntimePath) {
              allPaths.unshift(this.uvRuntimePath)
            }
            if (this.nodeRuntimePath) {
              allPaths.unshift(path.join(this.nodeRuntimePath, 'bin'))
            }
            if (this.bunRuntimePath) {
              allPaths.unshift(this.bunRuntimePath)
            }
          }

          // 规范化并设置PATH
          const { key, value } = this.normalizePathEnv(allPaths)
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
            resources: {},
            tools: {},
            prompts: {}
          }
        }
      )

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
