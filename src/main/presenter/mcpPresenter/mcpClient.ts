import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { type Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { eventBus } from '@/eventbus'
import { MCP_EVENTS } from '@/events'
import path from 'path'
import { presenter } from '@/presenter'
import { app } from 'electron'
import fs from 'fs'
import { proxyConfig } from '@/presenter/proxyConfig'
import { getInMemoryServer } from './inMemoryServers/builder'
import { StreamableHTTPClientTransport} from './streamableHttp'
import { dialog } from 'electron'

// 确保 TypeScript 能够识别 SERVER_STATUS_CHANGED 属性
type MCPEventsType = typeof MCP_EVENTS & {
  SERVER_STATUS_CHANGED: string
}

// 定义工具调用结果的接口
interface ToolCallResult {
  isError?: boolean
  content: Array<{
    type: string
    text: string
  }>
}

// 定义工具列表的接口
export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

// 定义资源的接口
interface Resource {
  uri: string
  text: string
}

// MCP 客户端类
export class McpClient {
  private client: Client | null = null
  private transport: Transport | null = null
  public serverName: string
  public serverConfig: Record<string, unknown>
  private isConnected: boolean = false
  private connectionTimeout: NodeJS.Timeout | null = null
  private nodeRuntimePath: string | null = null
  private npmRegistry: string | null = null

  // 处理PATH环境变量的函数
  private normalizePathEnv(paths: string[]): { key: string; value: string } {
    const isWindows = process.platform === 'win32'
    const separator = isWindows ? ';' : ':'
    const pathKey = isWindows ? 'Path' : 'PATH'

    // 合并所有路径
    const pathValue = paths.filter(Boolean).join(separator)

    return { key: pathKey, value: pathValue }
  }

  // 获取系统特定的默认路径
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
    npmRegistry: string | null = null
  ) {
    this.serverName = serverName
    this.serverConfig = serverConfig
    this.npmRegistry = npmRegistry

    const runtimePath = path
      .join(app.getAppPath(), 'runtime', 'node')
      .replace('app.asar', 'app.asar.unpacked')
    console.log('runtimePath', runtimePath)
    // 检查运行时文件是否存在
    if (process.platform === 'win32') {
      const nodeExe = path.join(runtimePath, 'node.exe')
      const npxCmd = path.join(runtimePath, 'npx.cmd')
      if (fs.existsSync(nodeExe) && fs.existsSync(npxCmd)) {
        this.nodeRuntimePath = runtimePath
      } else {
        this.nodeRuntimePath = null
      }
    } else {
      const nodeBin = path.join(runtimePath, 'bin', 'node')
      const npxBin = path.join(runtimePath, 'bin', 'npx')
      if (fs.existsSync(nodeBin) && fs.existsSync(npxBin)) {
        this.nodeRuntimePath = runtimePath
      } else {
        this.nodeRuntimePath = null
      }
    }
  }

  // 连接到 MCP 服务器
  async connect(): Promise<void> {
    if (this.isConnected && this.client) {
      console.info(`MCP服务器 ${this.serverName} 已经在运行中`)
      return
    }

    try {
      console.info(`正在启动MCP服务器 ${this.serverName}...`, this.serverConfig)
      if (this.serverConfig.type === 'inmemory') {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
        const _args = Array.isArray(this.serverConfig.args) ? this.serverConfig.args : []
        const _server = getInMemoryServer(this.serverName, _args)
        _server.startServer(serverTransport)
        this.transport = clientTransport
      } else if (this.serverConfig.type === 'stdio') {
        // 创建合适的transport
        const command = this.serverConfig.command as string
        console.log('final command', command)
        const HOME_DIR = app.getPath('home')

        // 定义允许的环境变量白名单
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
          'NPM_CONFIG_TMP',
          'GRPC_PROXY',
          'grpc_proxy'
        ]

        // 修复env类型问题
        const env: Record<string, string> = {}

        // 只复制非undefined的环境变量
        if (process.env) {
          const existingPaths: string[] = []

          // 收集所有PATH相关的值
          Object.entries(process.env).forEach(([key, value]) => {
            if (value !== undefined) {
              if (['PATH', 'Path', 'path'].includes(key)) {
                existingPaths.push(value)
              } else if (allowedEnvVars.includes(key) && !['PATH', 'Path', 'path'].includes(key)) {
                env[key] = value
              }
            }
          })

          // 获取默认路径
          const defaultPaths = this.getDefaultPaths(HOME_DIR)

          // 合并所有路径
          const allPaths = [...defaultPaths, ...existingPaths]
          if (this.nodeRuntimePath) {
            allPaths.push(
              process.platform === 'win32' ? this.nodeRuntimePath : `${this.nodeRuntimePath}/bin`
            )
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

        // 从proxyConfig获取代理URL并设置环境变量
        const proxyUrl = proxyConfig.getProxyUrl()
        if (proxyUrl) {
          env.http_proxy = proxyUrl
          env.https_proxy = proxyUrl
          env.grpc_proxy = proxyUrl
        }
        if (this.npmRegistry) {
          env.npm_config_registry = this.npmRegistry
        }
        if (process.platform === 'darwin') {
          if (!env.PATH) {
            env.PATH = ''
          }
          ;[
            '/bin',
            '/usr/bin',
            '/usr/local/bin',
            '/usr/local/sbin',
            '/opt/homebrew/bin',
            '/opt/homebrew/sbin',
            '/usr/local/opt/node/bin',
            '/opt/local/bin',
            `${HOME_DIR}/.cargo/bin`
          ].forEach((path) => {
            env.PATH = path + ':' + env.PATH
          })
        }
        if (process.platform === 'linux') {
          if (!env.PATH) {
            env.PATH = ''
          }
          ;['/bin', '/usr/bin', '/usr/local/bin', `${HOME_DIR}/.cargo/bin`].forEach((path) => {
            env.PATH = path + ':' + env.PATH
          })
        }
        if (process.platform === 'win32') {
          if (!env.Path) {
            env.Path = ''
          }
          ;[`${HOME_DIR}\\.cargo\\bin`, `${HOME_DIR}\\.local\\bin`].forEach((path) => {
            env.Path = path + ';' + env.Path
          })
        }
        if (this.nodeRuntimePath) {
          if (process.platform !== 'win32') {
            env.PATH = this.nodeRuntimePath + '/bin' + ':' + env.PATH
          } else {
            env.Path = this.nodeRuntimePath + ';' + env.Path
          }
        }
        console.log('mcp env', env)
        this.transport = new StdioClientTransport({
          command,
          args: this.serverConfig.args as string[],
          env,
          stderr: 'pipe'
        })
      } else if (this.serverConfig.baseUrl && this.serverConfig.type === 'sse') {
        this.transport = new SSEClientTransport(new URL(this.serverConfig.baseUrl as string))
      } else if (this.serverConfig.baseUrl && this.serverConfig.type === 'http') {
        this.transport = new StreamableHTTPClientTransport(
          new URL(this.serverConfig.baseUrl as string)
        )
      } else {
        throw new Error(`不支持的传输类型: ${this.serverConfig.type}`)
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
            console.error(`连接到MCP服务器 ${this.serverName} 超时`)
            reject(new Error(`连接到MCP服务器 ${this.serverName} 超时`))
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
          console.info(`MCP服务器 ${this.serverName} 连接成功`)

          // 触发服务器状态变更事件
          eventBus.emit((MCP_EVENTS as MCPEventsType).SERVER_STATUS_CHANGED, {
            name: this.serverName,
            status: 'running'
          })
        })
        .catch((error) => {
          console.error(`连接到MCP服务器 ${this.serverName} 失败:`, error)
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

      console.error(`连接到MCP服务器 ${this.serverName} 失败:`, error)
      // 使用 Electron 的 dialog 模块显示错误弹窗
      dialog.showErrorBox(
        'MCP 服务器连接失败',
        `无法连接到 MCP 服务器 ${this.serverName}。\n错误信息: ${
          error instanceof Error ? error.message : String(error)
        }`
      )

      // 触发服务器状态变更事件
      eventBus.emit((MCP_EVENTS as MCPEventsType).SERVER_STATUS_CHANGED, {
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
      // 清理资源
      this.cleanupResources()

      console.log(`从MCP服务器断开连接: ${this.serverName}`)

      // 触发服务器状态变更事件
      eventBus.emit((MCP_EVENTS as MCPEventsType).SERVER_STATUS_CHANGED, {
        name: this.serverName,
        status: 'stopped'
      })
    } catch (error) {
      console.error(`从MCP服务器 ${this.serverName} 断开连接失败:`, error)
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
        console.error(`关闭MCP transport失败:`, error)
      }
    }

    // 重置状态
    this.client = null
    this.transport = null
    this.isConnected = false
  }

  // 检查服务器是否正在运行
  isServerRunning(): boolean {
    return this.isConnected && !!this.client
  }

  // 调用 MCP 工具
  async callTool(toolName: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    if (!this.isConnected) {
      await this.connect()
    }

    if (!this.client) {
      throw new Error(`MCP客户端 ${this.serverName} 未初始化`)
    }

    try {
      // 调用工具
      const result = (await this.client.callTool({
        name: toolName,
        arguments: args
      })) as ToolCallResult

      // 检查结果
      if (result.isError) {
        const errorText = result.content && result.content[0] ? result.content[0].text : '未知错误'
        return {
          isError: true,
          content: [{ type: 'error', text: errorText }]
        }
      }
      return result
    } catch (error) {
      console.error(`调用MCP工具 ${toolName} 失败:`, error)
      throw error
    }
  }

  // 列出可用工具
  async listTools(): Promise<Tool[]> {
    if (!this.isConnected) {
      await this.connect()
    }

    if (!this.client) {
      throw new Error(`MCP客户端 ${this.serverName} 未初始化`)
    }

    try {
      const response = await this.client.listTools()
      // 检查响应格式
      if (response && typeof response === 'object' && 'tools' in response) {
        const toolsArray = response.tools
        if (Array.isArray(toolsArray)) {
          return toolsArray as Tool[]
        }
      }
      throw new Error('无效的工具响应格式')
    } catch (error) {
      console.error(`列出MCP工具失败:`, error)
      throw error
    }
  }

  // 读取资源
  async readResource(resourceUri: string): Promise<Resource> {
    if (!this.isConnected) {
      await this.connect()
    }

    if (!this.client) {
      throw new Error(`MCP客户端 ${this.serverName} 未初始化`)
    }

    try {
      // 使用 unknown 作为中间类型进行转换
      const rawResource = (await this.client.readResource({ uri: resourceUri })) as unknown

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
      console.error(`读取MCP资源 ${resourceUri} 失败:`, error)
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
    throw new Error(`在配置中未找到MCP服务器 ${serverName}`)
  }

  // 创建并返回 MCP 客户端，传入null作为npmRegistry
  // 注意：这个函数应该只用于直接创建客户端实例的情况
  // 正常情况下应该通过ServerManager创建，以便使用测试后的npm registry
  return new McpClient(serverName, serverConfig as unknown as Record<string, unknown>, null)
}
