import { IConfigPresenter } from '@shared/presenter'
import { McpClient } from './mcpClient'

export class ServerManager {
  private clients: Map<string, McpClient> = new Map()
  private configPresenter: IConfigPresenter

  constructor(configPresenter: IConfigPresenter) {
    this.configPresenter = configPresenter
  }

  // 获取默认服务器名称
  async getDefaultServerName(): Promise<string | null> {
    const mcpConfig = await this.configPresenter.getMcpConfig()
    const defaultServerName = mcpConfig.defaultServer

    if (!defaultServerName || !mcpConfig.mcpServers[defaultServerName]) {
      return null
    }

    return defaultServerName
  }

  // 获取默认客户端（不自动启动服务）
  async getDefaultClient(): Promise<McpClient | null> {
    const defaultServerName = await this.getDefaultServerName()

    if (!defaultServerName) {
      return null
    }

    // 返回已存在的客户端实例，无论是否运行
    return this.getClient(defaultServerName) || null
  }

  // 获取正在运行的客户端
  async getRunningClients(): Promise<McpClient[]> {
    const clients: McpClient[] = []
    for (const [name, client] of this.clients.entries()) {
      if (this.isServerRunning(name)) {
        clients.push(client)
      }
    }
    return clients
  }

  async startServer(name: string): Promise<void> {
    // 如果服务器已经在运行，则不需要再次启动
    if (this.clients.has(name) && this.isServerRunning(name)) {
      console.info(`MCP服务器 ${name} 已经在运行中`)
      return
    }

    const mcpConfig = await this.configPresenter.getMcpConfig()
    const serverConfig = mcpConfig.mcpServers[name]

    if (!serverConfig) {
      throw new Error(`MCP server ${name} not found`)
    }

    try {
      console.info(`正在启动MCP服务器 ${name}...`)

      // 创建并保存客户端实例
      const client = new McpClient(name, serverConfig as unknown as Record<string, unknown>)
      this.clients.set(name, client)

      // 连接到服务器，这将启动服务
      await client.connect()

      console.info(`MCP服务器 ${name} 启动成功`)
    } catch (error) {
      console.error(`启动MCP服务器 ${name} 失败:`, error)

      // 移除客户端引用
      this.clients.delete(name)

      throw error
    }
  }

  async stopServer(name: string): Promise<void> {
    const client = this.clients.get(name)

    if (!client) {
      return
    }

    try {
      // 断开连接，这将停止服务
      await client.disconnect()

      // 从客户端列表中移除
      this.clients.delete(name)

      console.info(`MCP服务器 ${name} 已停止`)
    } catch (error) {
      console.error(`停止MCP服务器 ${name} 失败:`, error)
      throw error
    }
  }

  isServerRunning(name: string): boolean {
    const client = this.clients.get(name)
    if (!client) {
      return false
    }
    return client.isServerRunning()
  }

  /**
   * 获取客户端实例
   */
  getClient(name: string): McpClient | undefined {
    return this.clients.get(name)
  }
}
