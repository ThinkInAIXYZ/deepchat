import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { type Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { eventBus } from '@/eventbus'
import { MCP_EVENTS } from '@/events'
import path from 'path'
import { presenter } from '@/presenter'

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
  private serverName: string
  private serverConfig: Record<string, unknown>
  private isConnected: boolean = false
  private workingDirectory: string | null = null
  private connectionTimeout: NodeJS.Timeout | null = null

  constructor(serverName: string, serverConfig: Record<string, unknown>) {
    this.serverName = serverName
    this.serverConfig = serverConfig

    // 从配置中获取工作目录
    if (Array.isArray(serverConfig.args) && serverConfig.args.length > 1) {
      this.workingDirectory = serverConfig.args[1] as string
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

      // 创建合适的transport
      if (this.serverConfig.type === 'stdio') {
        let command = this.serverConfig.command as string

        if (command === 'npx') {
          // 根据平台确定可执行文件路径
          if (process.platform === 'win32') {
            command = 'npx.cmd'
          } else {
            command = 'npx'
          }
        }

        // 修复env类型问题
        const env: Record<string, string> = {}
        // 只复制非undefined的环境变量
        if (process.env) {
          Object.entries(process.env).forEach(([key, value]) => {
            if (value !== undefined) {
              env[key] = value
            }
          })
        }
        // 添加自定义环境变量
        if (this.serverConfig.env) {
          Object.entries(this.serverConfig.env as Record<string, string>).forEach(
            ([key, value]) => {
              if (value !== undefined) {
                env[key] = value
              }
            }
          )
        }

        this.transport = new StdioClientTransport({
          command,
          args: this.serverConfig.args as string[],
          env,
          stderr: 'pipe'
        })
      } else if (this.serverConfig.baseUrl) {
        this.transport = new SSEClientTransport(new URL(this.serverConfig.baseUrl as string))
      } else {
        throw new Error(`不支持的传输类型: ${this.serverConfig.type}`)
      }

      // 创建 MCP 客户端
      this.client = new Client(
        { name: `deepchat-client-${this.serverName}`, version: '1.0.0' },
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
        this.connectionTimeout = setTimeout(() => {
          reject(new Error(`连接到MCP服务器 ${this.serverName} 超时`))
        }, 10000)
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
  async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    if (!this.isConnected) {
      await this.connect()
    }

    if (!this.client) {
      throw new Error(`MCP客户端 ${this.serverName} 未初始化`)
    }

    try {
      // // 处理路径参数
      const processedArgs = { ...args }
      if (this.workingDirectory && 'path' in processedArgs) {
        const userPath = processedArgs.path as string
        // 如果用户提供的不是绝对路径，则将其视为相对于工作目录的路径
        if (!path.isAbsolute(userPath)) {
          processedArgs.path = path.join(this.workingDirectory, userPath)
        }
      }

      // 调用工具
      const result = (await this.client.callTool({
        name: toolName,
        arguments: args
      })) as ToolCallResult

      // 检查结果
      if (result.isError) {
        const errorText = result.content && result.content[0] ? result.content[0].text : '未知错误'
        throw new Error(`工具 ${toolName} 返回错误: ${errorText}`)
      }

      // 返回结果文本
      return result.content && result.content[0] ? result.content[0].text : ''
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
  // 从configPresenter获取MCP配置
  const mcpConfig = await presenter.configPresenter.getMcpConfig()

  // 获取服务器配置
  const serverConfig = mcpConfig.mcpServers[serverName]
  if (!serverConfig) {
    throw new Error(`在配置中未找到MCP服务器 ${serverName}`)
  }

  // 创建并返回 MCP 客户端
  return new McpClient(serverName, serverConfig as unknown as Record<string, unknown>)
}
