import { eventBus } from '@/eventbus'
import { MCPServerConfig } from '@shared/presenter'
import { MCP_EVENTS } from '@/events'
import ElectronStore from 'electron-store'

// MCP设置的接口
interface IMcpSettings {
  mcpServers: Record<string, MCPServerConfig>
  defaultServer: string
  mcpEnabled: boolean // 添加MCP启用状态字段
  [key: string]: unknown // 允许任意键
}

// const filesystemPath = path.join(app.getAppPath(), 'resources', 'mcp', 'filesystem.mjs')
const DEFAULT_MCP_SERVERS = {
  mcpServers: {
    memory: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      env: {},
      descriptions: '内存存储服务',
      icons: '🧠',
      autoApprove: ['all'],
      disable: false,
      type: 'stdio' as 'stdio' | 'sse'
    }
  },
  defaultServer: 'memory',
  mcpEnabled: false // 默认关闭MCP功能
}

export class McpConfHelper {
  private mcpStore: ElectronStore<IMcpSettings>

  constructor() {
    // 初始化MCP设置存储
    this.mcpStore = new ElectronStore<IMcpSettings>({
      name: 'mcp-settings',
      defaults: {
        mcpServers: DEFAULT_MCP_SERVERS.mcpServers,
        defaultServer: DEFAULT_MCP_SERVERS.defaultServer,
        mcpEnabled: DEFAULT_MCP_SERVERS.mcpEnabled // 设置默认值
      }
    })
  }

  // 获取MCP配置
  getMcpConfig(): Promise<{
    mcpServers: Record<string, MCPServerConfig>
    defaultServer: string
    mcpEnabled: boolean
  }> {
    return Promise.resolve({
      mcpServers: this.mcpStore.get('mcpServers') || DEFAULT_MCP_SERVERS.mcpServers,
      defaultServer: this.mcpStore.get('defaultServer') || DEFAULT_MCP_SERVERS.defaultServer,
      mcpEnabled: this.mcpStore.get('mcpEnabled') ?? DEFAULT_MCP_SERVERS.mcpEnabled
    })
  }

  // 设置MCP配置
  async setMcpConfig(config: {
    mcpServers: Record<string, MCPServerConfig>
    defaultServer: string
    mcpEnabled: boolean
  }): Promise<void> {
    this.mcpStore.set('mcpServers', config.mcpServers)
    this.mcpStore.set('defaultServer', config.defaultServer)
    this.mcpStore.set('mcpEnabled', config.mcpEnabled)
    eventBus.emit(MCP_EVENTS.CONFIG_CHANGED, config)
  }

  // 获取MCP启用状态
  getMcpEnabled(): Promise<boolean> {
    return Promise.resolve(this.mcpStore.get('mcpEnabled') ?? DEFAULT_MCP_SERVERS.mcpEnabled)
  }

  // 设置MCP启用状态
  async setMcpEnabled(enabled: boolean): Promise<void> {
    this.mcpStore.set('mcpEnabled', enabled)
    const mcpConfig = {
      mcpServers: this.mcpStore.get('mcpServers'),
      defaultServer: this.mcpStore.get('defaultServer'),
      mcpEnabled: enabled
    }
    eventBus.emit(MCP_EVENTS.CONFIG_CHANGED, mcpConfig)
  }

  // 添加MCP服务器
  async addMcpServer(name: string, config: MCPServerConfig): Promise<void> {
    const mcpServers = this.mcpStore.get('mcpServers')
    mcpServers[name] = config
    this.mcpStore.set('mcpServers', mcpServers)

    const mcpConfig = {
      mcpServers: mcpServers,
      defaultServer: this.mcpStore.get('defaultServer')
    }
    eventBus.emit(MCP_EVENTS.CONFIG_CHANGED, mcpConfig)
  }

  // 移除MCP服务器
  async removeMcpServer(name: string): Promise<void> {
    const mcpServers = this.mcpStore.get('mcpServers')
    delete mcpServers[name]
    this.mcpStore.set('mcpServers', mcpServers)

    // 如果删除的是默认服务器，则清空默认服务器设置
    if (this.mcpStore.get('defaultServer') === name) {
      this.mcpStore.set('defaultServer', '')
    }

    const mcpConfig = {
      mcpServers: mcpServers,
      defaultServer: this.mcpStore.get('defaultServer')
    }
    eventBus.emit(MCP_EVENTS.CONFIG_CHANGED, mcpConfig)
  }

  // 更新MCP服务器配置
  async updateMcpServer(name: string, config: Partial<MCPServerConfig>): Promise<void> {
    const mcpServers = this.mcpStore.get('mcpServers')

    // 确保服务器存在
    if (!mcpServers[name]) {
      throw new Error(`MCP server ${name} not found`)
    }

    // 更新配置
    mcpServers[name] = {
      ...mcpServers[name],
      ...config
    }

    this.mcpStore.set('mcpServers', mcpServers)

    const mcpConfig = {
      mcpServers: mcpServers,
      defaultServer: this.mcpStore.get('defaultServer')
    }
    eventBus.emit(MCP_EVENTS.CONFIG_CHANGED, mcpConfig)
  }

  // 设置默认MCP服务器
  async setDefaultServer(name: string): Promise<void> {
    const mcpServers = this.mcpStore.get('mcpServers')

    // 确保服务器存在
    if (!mcpServers[name]) {
      throw new Error(`MCP server ${name} not found`)
    }

    this.mcpStore.set('defaultServer', name)

    const mcpConfig = {
      mcpServers: mcpServers,
      defaultServer: name
    }
    eventBus.emit(MCP_EVENTS.CONFIG_CHANGED, mcpConfig)
  }
}
