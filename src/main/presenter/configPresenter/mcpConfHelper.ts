import { eventBus, SendTarget } from '@/eventbus'
import { MCPServerConfig } from '@shared/presenter'
import { MCP_EVENTS } from '@/events'
import ElectronStore from 'electron-store'
import { app } from 'electron'
import { compare } from 'compare-versions'

// MCP设置的接口
interface IMcpSettings {
  mcpServers: Record<string, MCPServerConfig>
  defaultServer?: string // 保留旧字段以支持版本兼容
  defaultServers: string[] // 新增：多个默认服务器数组
  mcpEnabled: boolean // 添加MCP启用状态字段
  [key: string]: unknown // 允许任意键
}
export type MCPServerType = 'stdio' | 'sse' | 'inmemory' | 'http'

// 检查当前系统平台
function isMacOS(): boolean {
  return process.platform === 'darwin'
}

function isWindows(): boolean {
  return process.platform === 'win32'
}

function isLinux(): boolean {
  return process.platform === 'linux'
}

// 平台特有的 MCP 服务器配置
const PLATFORM_SPECIFIC_SERVERS: Record<string, MCPServerConfig> = {
  // macOS 特有服务
  ...(isMacOS() ? {
    'deepchat/apple-server': {
      args: [],
      descriptions: 'DeepChat内置Apple系统集成服务 (仅macOS)',
      icons: '🍎',
      autoApprove: ['all'],
      type: 'inmemory' as MCPServerType,
      command: 'deepchat/apple-server',
      env: {},
      disable: false
    }
  } : {}),
  
  // Windows 特有服务 (预留)
  ...(isWindows() ? {
    // 'deepchat-inmemory/windows-server': {
    //   args: [],
    //   descriptions: 'DeepChat内置Windows系统集成服务 (仅Windows)',
    //   icons: '🪟',
    //   autoApprove: ['all'],
    //   type: 'inmemory' as MCPServerType,
    //   command: 'deepchat-inmemory/windows-server',
    //   env: {},
    //   disable: false
    // }
  } : {}),
  
  // Linux 特有服务 (预留)
  ...(isLinux() ? {
    // 'deepchat-inmemory/linux-server': {
    //   args: [],
    //   descriptions: 'DeepChat内置Linux系统集成服务 (仅Linux)',
    //   icons: '🐧',
    //   autoApprove: ['all'],
    //   type: 'inmemory' as MCPServerType,
    //   command: 'deepchat-inmemory/linux-server',
    //   env: {},
    //   disable: false
    // }
  } : {})
}

// 抽取inmemory类型的服务为常量
const DEFAULT_INMEMORY_SERVERS: Record<string, MCPServerConfig> = {
  buildInFileSystem: {
    args: [app.getPath('home')],
    descriptions: 'DeepChat内置文件系统mcp服务',
    icons: '📁',
    autoApprove: ['read'],
    type: 'inmemory' as MCPServerType,
    command: 'filesystem',
    env: {},
    disable: true
  },
  Artifacts: {
    args: [],
    descriptions: 'DeepChat内置 artifacts mcp服务',
    icons: '🎨',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'artifacts',
    env: {},
    disable: false
  },
  bochaSearch: {
    args: [],
    descriptions: 'DeepChat内置博查搜索服务',
    icons: '🔍',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'bochaSearch',
    env: {
      apiKey: 'YOUR_BOCHA_API_KEY' // 需要用户提供实际的API Key
    },
    disable: false
  },
  braveSearch: {
    args: [],
    descriptions: 'DeepChat内置Brave搜索服务',
    icons: '🦁',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'braveSearch',
    env: {
      apiKey: 'YOUR_BRAVE_API_KEY' // 需要用户提供实际的API Key
    },
    disable: false
  },
  difyKnowledge: {
    args: [],
    descriptions: 'DeepChat内置Dify知识库检索服务',
    icons: '📚',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'difyKnowledge',
    env: {
      configs: [
        {
          description: 'this is a description for the current knowledge base',
          apiKey: 'YOUR_DIFY_API_KEY',
          datasetId: 'YOUR_DATASET_ID',
          endpoint: 'http://localhost:3000/v1'
        }
      ]
    },
    disable: false
  },
  imageServer: {
    args: [],
    descriptions: 'Image processing MCP service',
    icons: '🖼️',
    autoApprove: ['read_image_base64', 'read_multiple_images_base64'], // Auto-approve reading, require confirmation for uploads
    type: 'inmemory' as MCPServerType,
    command: 'image', // We need to map this command to the ImageServer class later
    env: {},
    disable: false
  },
  powerpack: {
    args: [],
    descriptions: 'DeepChat内置增强工具包',
    icons: '🛠️',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'powerpack',
    env: {},
    disable: false
  },
  ragflowKnowledge: {
    args: [],
    descriptions: 'DeepChat内置RAGFlow知识库检索服务',
    icons: '📚',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'ragflowKnowledge',
    env: {
      configs: [
        {
          description: '默认RAGFlow知识库',
          apiKey: 'YOUR_RAGFLOW_API_KEY',
          datasetIds: ['YOUR_DATASET_ID'],
          endpoint: 'http://localhost:8000'
        }
      ]
    },
    disable: false
  },
  fastGptKnowledge: {
    args: [],
    descriptions: 'DeepChat内置FastGPT知识库检索服务',
    icons: '📚',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'fastGptKnowledge',
    env: {
      configs: [
        {
          description: 'this is a description for the current knowledge base',
          apiKey: 'YOUR_FastGPT_API_KEY',
          datasetId: 'YOUR_DATASET_ID',
          endpoint: 'http://localhost:3000/api'
        }
      ]
    },
    disable: false
  },
  'deepchat-inmemory/deep-research-server': {
    args: [],
    descriptions:
      'DeepChat内置深度研究服务，使用博查搜索(注意该服务需要较长的上下文模型，请勿在短上下文的模型中使用)',
    icons: '🔬',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'deepchat-inmemory/deep-research-server',
    env: {
      BOCHA_API_KEY: 'YOUR_BOCHA_API_KEY'
    },
    disable: false
  },
  'deepchat-inmemory/auto-prompting-server': {
    args: [],
    descriptions: 'DeepChat内置自动模板提示词服务',
    icons: '📜',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'deepchat-inmemory/auto-prompting-server',
    env: {},
    disable: false
  },
  'deepchat-inmemory/conversation-search-server': {
    args: [],
    descriptions: 'DeepChat built-in conversation history search service',
    icons: '🔍',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'deepchat-inmemory/conversation-search-server',
    env: {},
    disable: false
  },
  'deepchat-inmemory/meeting-server': {
    args: [],
    descriptions: 'DeepChat内置会议服务，用于组织多Agent讨论',
    icons: '👥',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'deepchat-inmemory/meeting-server',
    env: {},
    disable: false
  },
  // 合并平台特有服务
  ...PLATFORM_SPECIFIC_SERVERS
}

const DEFAULT_MCP_SERVERS = {
  mcpServers: {
    // 先定义内置MCP服务器
    ...DEFAULT_INMEMORY_SERVERS,
    // 之后是默认的三方MCP服务器
    memory: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      env: {},
      descriptions: '内存存储服务',
      icons: '🧠',
      autoApprove: ['all'],
      disable: true,
      type: 'stdio' as MCPServerType
    }
  },
  defaultServers: [
    'Artifacts',
    // 根据平台添加默认启用的平台特有服务
    ...(isMacOS() ? ['deepchat/apple-server'] : [])
  ],
  mcpEnabled: false // 默认关闭MCP功能
}
// 这部分mcp有系统逻辑判断是否启用，不受用户配置控制，受软件环境控制
export const SYSTEM_INMEM_MCP_SERVERS: Record<string, MCPServerConfig> = {
  'deepchat-inmemory/custom-prompts-server': {
    command: 'deepchat-inmemory/custom-prompts-server',
    args: [],
    env: {},
    descriptions: 'DeepChat内置自定义提示词服务',
    icons: '📝',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    disable: false
  }
}

export class McpConfHelper {
  private mcpStore: ElectronStore<IMcpSettings>

  constructor() {
    // 初始化MCP设置存储
    this.mcpStore = new ElectronStore<IMcpSettings>({
      name: 'mcp-settings',
      defaults: {
        mcpServers: DEFAULT_MCP_SERVERS.mcpServers,
        defaultServers: DEFAULT_MCP_SERVERS.defaultServers,
        mcpEnabled: DEFAULT_MCP_SERVERS.mcpEnabled
      }
    })
  }

  // 获取MCP服务器配置
  getMcpServers(): Promise<Record<string, MCPServerConfig>> {
    const storedServers = this.mcpStore.get('mcpServers') || DEFAULT_MCP_SERVERS.mcpServers

    // 检查并补充缺少的inmemory服务
    const updatedServers = { ...storedServers }

    // 遍历所有默认的inmemory服务，确保它们都存在
    for (const [serverName, serverConfig] of Object.entries(DEFAULT_INMEMORY_SERVERS)) {
      if (!updatedServers[serverName]) {
        console.log(`添加缺少的inmemory服务: ${serverName}`)
        updatedServers[serverName] = serverConfig
      }
    }

    // 移除不支持当前平台的服务
    const serversToRemove: string[] = []
    for (const [serverName, serverConfig] of Object.entries(updatedServers)) {
      if (serverConfig.type === 'inmemory') {
        // 检查是否为平台特有服务
        if (serverName === 'deepchat/apple-server' && !isMacOS()) {
          serversToRemove.push(serverName)
        }
        // 可以在这里添加其他平台特有服务的检查
        // if (serverName === 'deepchat-inmemory/windows-server' && !isWindows()) {
        //   serversToRemove.push(serverName)
        // }
        // if (serverName === 'deepchat-inmemory/linux-server' && !isLinux()) {
        //   serversToRemove.push(serverName)
        // }
      }
    }

    // 移除不支持的平台特有服务
    for (const serverName of serversToRemove) {
      console.log(`移除不支持当前平台的服务: ${serverName}`)
      delete updatedServers[serverName]
    }

    // 如果有变化，更新存储
    if (Object.keys(updatedServers).length !== Object.keys(storedServers).length || 
        serversToRemove.length > 0) {
      this.mcpStore.set('mcpServers', updatedServers)
    }

    return Promise.resolve(updatedServers)
  }

  // 设置MCP服务器配置
  async setMcpServers(servers: Record<string, MCPServerConfig>): Promise<void> {
    this.mcpStore.set('mcpServers', servers)
    eventBus.send(MCP_EVENTS.CONFIG_CHANGED, SendTarget.ALL_WINDOWS, {
      mcpServers: servers,
      defaultServers: this.mcpStore.get('defaultServers') || [],
      mcpEnabled: this.mcpStore.get('mcpEnabled')
    })
  }

  // 获取默认服务器列表
  getMcpDefaultServers(): Promise<string[]> {
    return Promise.resolve(this.mcpStore.get('defaultServers') || [])
  }

  // 添加默认服务器
  async addMcpDefaultServer(serverName: string): Promise<void> {
    const defaultServers = this.mcpStore.get('defaultServers') || []
    const mcpServers = await this.getMcpServers() // 使用getMcpServers确保平台检查

    // 检测并清理失效的服务器
    const validDefaultServers = defaultServers.filter((server) => {
      const exists = mcpServers[server] !== undefined
      if (!exists) {
        console.log(`检测到失效的MCP服务器: ${server}，已从默认列表中移除`)
      }
      return exists
    })

    // 检查要添加的服务器是否存在且支持当前平台
    if (mcpServers[serverName]) {
      // 添加新服务器（如果不在列表中）
      if (!validDefaultServers.includes(serverName)) {
        validDefaultServers.push(serverName)
      }
    } else {
      console.log(`尝试添加不存在或不支持当前平台的MCP服务器: ${serverName}`)
      return
    }

    // 如果有变化则更新存储并发送事件
    if (
      validDefaultServers.length !== defaultServers.length ||
      !defaultServers.includes(serverName)
    ) {
      this.mcpStore.set('defaultServers', validDefaultServers)
      eventBus.send(MCP_EVENTS.CONFIG_CHANGED, SendTarget.ALL_WINDOWS, {
        mcpServers: mcpServers,
        defaultServers: validDefaultServers,
        mcpEnabled: this.mcpStore.get('mcpEnabled')
      })
    }
  }

  // 移除默认服务器
  async removeMcpDefaultServer(serverName: string): Promise<void> {
    const defaultServers = this.mcpStore.get('defaultServers') || []
    const updatedServers = defaultServers.filter((name) => name !== serverName)
    this.mcpStore.set('defaultServers', updatedServers)
    eventBus.send(MCP_EVENTS.CONFIG_CHANGED, SendTarget.ALL_WINDOWS, {
      mcpServers: this.mcpStore.get('mcpServers'),
      defaultServers: updatedServers,
      mcpEnabled: this.mcpStore.get('mcpEnabled')
    })
  }

  // 切换服务器的默认状态
  async toggleMcpDefaultServer(serverName: string): Promise<void> {
    const defaultServers = this.mcpStore.get('defaultServers') || []
    if (defaultServers.includes(serverName)) {
      await this.removeMcpDefaultServer(serverName)
    } else {
      await this.addMcpDefaultServer(serverName)
    }
  }

  // 设置MCP启用状态
  async setMcpEnabled(enabled: boolean): Promise<void> {
    this.mcpStore.set('mcpEnabled', enabled)
    eventBus.send(MCP_EVENTS.CONFIG_CHANGED, SendTarget.ALL_WINDOWS, {
      mcpServers: this.mcpStore.get('mcpServers'),
      defaultServers: this.mcpStore.get('defaultServers'),
      mcpEnabled: enabled
    })
  }

  // 获取MCP启用状态
  getMcpEnabled(): Promise<boolean> {
    return Promise.resolve(this.mcpStore.get('mcpEnabled') ?? DEFAULT_MCP_SERVERS.mcpEnabled)
  }

  // 添加MCP服务器
  async addMcpServer(name: string, config: MCPServerConfig): Promise<boolean> {
    const mcpServers = await this.getMcpServers()
    mcpServers[name] = config
    await this.setMcpServers(mcpServers)
    return true
  }

  // 移除MCP服务器
  async removeMcpServer(name: string): Promise<void> {
    const mcpServers = await this.getMcpServers()
    delete mcpServers[name]
    await this.setMcpServers(mcpServers)

    // 如果删除的服务器在默认服务器列表中，则从列表中移除
    const defaultServers = await this.getMcpDefaultServers()
    if (defaultServers.includes(name)) {
      await this.removeMcpDefaultServer(name)
    }
  }

  // 更新MCP服务器配置
  async updateMcpServer(name: string, config: Partial<MCPServerConfig>): Promise<void> {
    const mcpServers = await this.getMcpServers()
    if (!mcpServers[name]) {
      throw new Error(`MCP server ${name} not found`)
    }
    mcpServers[name] = {
      ...mcpServers[name],
      ...config
    }
    await this.setMcpServers(mcpServers)
  }

  // 恢复默认服务器配置
  async resetToDefaultServers(): Promise<void> {
    const currentServers = await this.getMcpServers()
    const updatedServers = { ...currentServers }

    // 删除所有类型为inmemory的服务
    for (const [serverName, serverConfig] of Object.entries(updatedServers)) {
      if (serverConfig.type === 'inmemory') {
        delete updatedServers[serverName]
      }
    }

    // 遍历所有默认服务，有则覆盖，无则新增
    for (const [serverName, serverConfig] of Object.entries(DEFAULT_MCP_SERVERS.mcpServers)) {
      updatedServers[serverName] = serverConfig
    }

    // 更新服务器配置
    await this.setMcpServers(updatedServers)

    // 恢复默认服务器设置，确保平台特有服务的正确处理
    const platformAwareDefaultServers = [
      'Artifacts',
      // 根据平台添加默认启用的平台特有服务
      ...(isMacOS() ? ['deepchat/apple-server'] : [])
    ]

    this.mcpStore.set('defaultServers', platformAwareDefaultServers)
    eventBus.send(MCP_EVENTS.CONFIG_CHANGED, SendTarget.ALL_WINDOWS, {
      mcpServers: updatedServers,
      defaultServers: platformAwareDefaultServers,
      mcpEnabled: this.mcpStore.get('mcpEnabled')
    })
  }

  public onUpgrade(oldVersion: string | undefined): void {
    console.log('onUpgrade', oldVersion)
    if (oldVersion && compare(oldVersion, '0.0.12', '<=')) {
      // 将旧版本的defaultServer迁移到新版本的defaultServers
      const oldDefaultServer = this.mcpStore.get('defaultServer') as string | undefined
      if (oldDefaultServer) {
        console.log(`迁移旧版本defaultServer: ${oldDefaultServer}到defaultServers`)
        const defaultServers = this.mcpStore.get('defaultServers') || []
        if (!defaultServers.includes(oldDefaultServer)) {
          defaultServers.push(oldDefaultServer)
          this.mcpStore.set('defaultServers', defaultServers)
        }
        // 删除旧的defaultServer字段，防止重复迁移
        this.mcpStore.delete('defaultServer')
      }

      // 迁移 filesystem 服务器到 buildInFileSystem
      try {
        const mcpServers = this.mcpStore.get('mcpServers') || {}
        // console.log('mcpServers', mcpServers)
        if (mcpServers.filesystem) {
          console.log('检测到旧版本的 filesystem MCP 服务器，开始迁移到 buildInFileSystem')

          // 检查 buildInFileSystem 是否已存在
          if (!mcpServers.buildInFileSystem) {
            // 创建 buildInFileSystem 配置
            mcpServers.buildInFileSystem = {
              args: [app.getPath('home')], // 默认值
              descriptions: '内置文件系统mcp服务',
              icons: '💾',
              autoApprove: ['read'],
              type: 'inmemory' as MCPServerType,
              command: 'filesystem',
              env: {},
              disable: false
            }
          }

          // 如果 filesystem 的 args 长度大于 2，将第三个参数及以后的参数迁移
          if (mcpServers.filesystem.args && mcpServers.filesystem.args.length > 2) {
            mcpServers.buildInFileSystem.args = mcpServers.filesystem.args.slice(2)
          }

          // 迁移 autoApprove 设置
          if (mcpServers.filesystem.autoApprove) {
            mcpServers.buildInFileSystem.autoApprove = [...mcpServers.filesystem.autoApprove]
          }

          delete mcpServers.filesystem
          // 更新 mcpServers
          this.mcpStore.set('mcpServers', mcpServers)

          // 如果 filesystem 是默认服务器，将 buildInFileSystem 添加到默认服务器列表
          const defaultServers = this.mcpStore.get('defaultServers') || []
          if (
            defaultServers.includes('filesystem') &&
            !defaultServers.includes('buildInFileSystem')
          ) {
            defaultServers.push('buildInFileSystem')
            this.mcpStore.set('defaultServers', defaultServers)
          }

          console.log('迁移 filesystem 到 buildInFileSystem 完成')
        }
      } catch (error) {
        console.error('迁移 filesystem 服务器时出错:', error)
      }
    }

    // 升级后检查并添加平台特有服务
    try {
      const mcpServers = this.mcpStore.get('mcpServers') || {}
      const defaultServers = this.mcpStore.get('defaultServers') || []
      let hasChanges = false

      // 检查是否需要添加平台特有服务
      if (isMacOS() && !mcpServers['deepchat/apple-server']) {
        console.log('检测到 macOS 平台，添加 Apple 系统集成服务')
        mcpServers['deepchat/apple-server'] = PLATFORM_SPECIFIC_SERVERS['deepchat/apple-server']
        hasChanges = true

        // 如果不在默认服务器列表中，添加到默认服务器列表
        if (!defaultServers.includes('deepchat/apple-server')) {
          defaultServers.push('deepchat/apple-server')
          this.mcpStore.set('defaultServers', defaultServers)
        }
      }

      // 移除不支持当前平台的服务
      const serversToRemove: string[] = []
      for (const [serverName] of Object.entries(mcpServers)) {
        if (serverName === 'deepchat/apple-server' && !isMacOS()) {
          serversToRemove.push(serverName)
        }
        // 可以在这里添加其他平台特有服务的检查
      }

      for (const serverName of serversToRemove) {
        console.log(`移除不支持当前平台的服务: ${serverName}`)
        delete mcpServers[serverName]
        hasChanges = true

        // 从默认服务器列表中移除
        const index = defaultServers.indexOf(serverName)
        if (index > -1) {
          defaultServers.splice(index, 1)
          this.mcpStore.set('defaultServers', defaultServers)
        }
      }

      if (hasChanges) {
        this.mcpStore.set('mcpServers', mcpServers)
        console.log('平台特有服务升级完成')
      }
    } catch (error) {
      console.error('升级平台特有服务时出错:', error)
    }
  }
}
