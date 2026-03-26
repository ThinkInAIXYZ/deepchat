import { eventBus, SendTarget } from '@/eventbus'
import { MCPServerConfig } from '@shared/presenter'
import { MCP_EVENTS } from '@/events'
import ElectronStore from 'electron-store'
// app is used in DEFAULT_INMEMORY_SERVERS but removed buildInFileSystem
// import { app } from 'electron'
import { compare } from 'compare-versions'
import { presenter } from '..'

// NPM Registry cache interface
export interface INpmRegistryCache {
  registry: string
  lastChecked: number
  isAutoDetect: boolean
}

// MCP settings interface
interface IMcpSettings {
  mcpServers: Record<string, MCPServerConfig>
  defaultServer?: string
  defaultServers?: string[]
  mcpEnabled: boolean // Add MCP enabled status field
  npmRegistryCache?: INpmRegistryCache // NPM registry cache
  customNpmRegistry?: string // User custom NPM registry
  autoDetectNpmRegistry?: boolean // Whether to enable auto detection
  removedBuiltInServers?: string[] // Track built-in servers removed by user
  [key: string]: unknown // Allow arbitrary keys
}
export type MCPServerType = 'stdio' | 'sse' | 'inmemory' | 'http'

// Extended MCP server config with additional properties for ModelScope sync
export interface ExtendedMCPServerConfig {
  name: string
  description: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
  type: MCPServerType
  package?: string
  version?: string
  source?: string
  logo_url?: string
  publisher?: string
  tags?: string[]
  view_count?: number
}

// Check current system platform
function isMacOS(): boolean {
  return process.platform === 'darwin'
}

function isWindows(): boolean {
  return process.platform === 'win32'
}

function isLinux(): boolean {
  return process.platform === 'linux'
}

// Platform-specific MCP server configurations
const PLATFORM_SPECIFIC_SERVERS: Record<string, Omit<MCPServerConfig, 'enabled'>> = {
  // macOS specific services
  ...(isMacOS()
    ? {
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
      }
    : {}),

  // Windows specific services (reserved)
  ...(isWindows()
    ? {
        // 'deepchat-inmemory/windows-server': {
        //   args: [],
        //   descriptions: 'DeepChat built-in Windows system integration service (Windows only)',
        //   icons: '🪟',
        //   autoApprove: ['all'],
        //   type: 'inmemory' as MCPServerType,
        //   command: 'deepchat-inmemory/windows-server',
        //   env: {},
        //   disable: false
        // }
      }
    : {}),

  // Linux specific services (reserved)
  ...(isLinux()
    ? {
        // 'deepchat-inmemory/linux-server': {
        //   args: [],
        //   descriptions: 'DeepChat built-in Linux system integration service (Linux only)',
        //   icons: '🐧',
        //   autoApprove: ['all'],
        //   type: 'inmemory' as MCPServerType,
        //   command: 'deepchat-inmemory/linux-server',
        //   env: {},
        //   disable: false
        // }
      }
    : {})
}

// Extract inmemory type services as constants
const DEFAULT_INMEMORY_SERVERS: Record<string, Omit<MCPServerConfig, 'enabled'>> = {
  // buildInFileSystem has been removed - filesystem capabilities are now provided via Agent tools
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
      apiKey: 'YOUR_BOCHA_API_KEY' // User needs to provide actual API Key
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
      apiKey: 'YOUR_BRAVE_API_KEY' // User needs to provide actual API Key
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
  builtinKnowledge: {
    args: [],
    descriptions: 'DeepChat内置知识库检索服务',
    icons: '📚',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'builtinKnowledge',
    env: {
      configs: []
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
  // Merge platform-specific services
  ...PLATFORM_SPECIFIC_SERVERS
}

const DEFAULT_ENABLED_SERVER_NAMES = ['Artifacts', ...(isMacOS() ? ['deepchat/apple-server'] : [])]

const DEFAULT_MCP_SERVERS = {
  mcpServers: {
    // First define built-in MCP servers
    ...DEFAULT_INMEMORY_SERVERS,
    // Then default third-party MCP servers
    'nowledge-mem': {
      command: '',
      args: [],
      env: {},
      descriptions: 'Nowledge Mem MCP',
      icons: '🧠',
      autoApprove: ['all'],
      disable: true,
      type: 'http' as MCPServerType,
      baseUrl: 'http://localhost:14242/mcp',
      customHeaders: {
        APP: 'DeepChat'
      }
    }
  } satisfies Record<string, Omit<MCPServerConfig, 'enabled'>>,
  mcpEnabled: false // MCP functionality is disabled by default
}
const BUILT_IN_SERVER_NAMES = new Set<string>(Object.keys(DEFAULT_MCP_SERVERS.mcpServers))
// This part of MCP has system logic to determine whether to enable, not controlled by user configuration, but by software environment
export const SYSTEM_INMEM_MCP_SERVERS: Record<string, MCPServerConfig> = {
  // custom-prompts-server has been removed, now provides prompt functionality through config data source
}

export class McpConfHelper {
  private mcpStore: ElectronStore<IMcpSettings>

  constructor() {
    // Initialize MCP settings storage
    this.mcpStore = new ElectronStore<IMcpSettings>({
      name: 'mcp-settings',
      defaults: {
        mcpServers: this.buildDefaultServerConfigs(),
        mcpEnabled: DEFAULT_MCP_SERVERS.mcpEnabled,
        autoDetectNpmRegistry: true,
        npmRegistryCache: undefined,
        customNpmRegistry: undefined,
        removedBuiltInServers: []
      }
    })
  }

  private getDefaultEnabledServerNames(): string[] {
    return [...DEFAULT_ENABLED_SERVER_NAMES]
  }

  private buildDefaultServerConfigs(): Record<string, MCPServerConfig> {
    const enabledServers = new Set(this.getDefaultEnabledServerNames())

    return Object.fromEntries(
      Object.entries(DEFAULT_MCP_SERVERS.mcpServers).map(([name, config]) => [
        name,
        {
          ...this.cloneServerConfig(config as unknown as MCPServerConfig),
          enabled: enabledServers.has(name)
        }
      ])
    )
  }

  private emitConfigChanged(servers: Record<string, MCPServerConfig>): void {
    eventBus.send(MCP_EVENTS.CONFIG_CHANGED, SendTarget.ALL_WINDOWS, {
      mcpServers: servers,
      mcpEnabled: this.mcpStore.get('mcpEnabled')
    })
  }

  private resolveLegacyEnabledServers(): Set<string> {
    const enabled = new Set<string>()
    const oldDefaultServer = this.mcpStore.get('defaultServer')
    const oldDefaultServers = this.mcpStore.get('defaultServers') || []

    if (typeof oldDefaultServer === 'string' && oldDefaultServer.trim()) {
      enabled.add(oldDefaultServer.trim())
    }

    for (const serverName of oldDefaultServers) {
      if (typeof serverName === 'string' && serverName.trim()) {
        enabled.add(serverName.trim())
      }
    }

    return enabled
  }

  private normalizeServerConfig(
    serverName: string,
    config: MCPServerConfig,
    legacyEnabledServers: Set<string>,
    legacyKeysPresent: boolean,
    defaultEnabledServers: Set<string>
  ): MCPServerConfig {
    return {
      ...this.cloneServerConfig(config),
      enabled:
        typeof config.enabled === 'boolean'
          ? config.enabled
          : legacyKeysPresent
            ? legacyEnabledServers.has(serverName)
            : defaultEnabledServers.has(serverName)
    }
  }

  private removeDeprecatedBuiltInServers(
    servers: Record<string, MCPServerConfig>
  ): Record<string, MCPServerConfig> {
    const deprecatedBuiltInServers = ['powerpack', 'deepchat-inmemory/meeting-server']
    let hasChanges = false
    const removedBuiltInServers = new Set(this.getRemovedBuiltInServers())
    let removedListChanged = false

    for (const serverName of deprecatedBuiltInServers) {
      if (servers[serverName]) {
        console.log(`Removing deprecated built-in MCP service: ${serverName}`)
        delete servers[serverName]
        hasChanges = true
      }

      if (removedBuiltInServers.delete(serverName)) {
        removedListChanged = true
      }
    }

    if (hasChanges) {
      this.mcpStore.set('mcpServers', servers)
    }

    if (removedListChanged) {
      this.setRemovedBuiltInServers(Array.from(removedBuiltInServers))
    }

    return servers
  }

  private getRemovedBuiltInServers(): string[] {
    return this.mcpStore.get('removedBuiltInServers') || []
  }

  private setRemovedBuiltInServers(servers: string[]): void {
    this.mcpStore.set('removedBuiltInServers', Array.from(new Set(servers)))
  }

  private isBuiltInServer(name: string): boolean {
    return BUILT_IN_SERVER_NAMES.has(name)
  }

  private markBuiltInServerRemoved(name: string): void {
    if (!this.isBuiltInServer(name)) return
    const removed = new Set(this.getRemovedBuiltInServers())
    removed.add(name)
    this.setRemovedBuiltInServers(Array.from(removed))
  }

  private unmarkBuiltInServerRemoved(name: string): void {
    if (!this.isBuiltInServer(name)) return
    const removed = this.getRemovedBuiltInServers().filter((server) => server !== name)
    this.setRemovedBuiltInServers(removed)
  }

  private cloneServerConfig(config: MCPServerConfig): MCPServerConfig {
    const cloneFn = (
      globalThis as typeof globalThis & {
        structuredClone?: (value: MCPServerConfig) => MCPServerConfig
      }
    ).structuredClone

    if (typeof cloneFn === 'function') {
      return cloneFn(config)
    }

    return JSON.parse(JSON.stringify(config)) as MCPServerConfig
  }

  // Get MCP server configuration
  async getMcpServers(): Promise<Record<string, MCPServerConfig>> {
    const storedServers = this.removeDeprecatedBuiltInServers(
      this.mcpStore.get('mcpServers') || this.buildDefaultServerConfigs()
    )
    const legacyEnabledServers = this.resolveLegacyEnabledServers()
    const legacyKeysPresent =
      this.mcpStore.has('defaultServer') || this.mcpStore.has('defaultServers')
    const defaultEnabledServers = new Set(this.getDefaultEnabledServerNames())

    // 检查并补充缺少的inmemory服务
    const updatedServers = Object.fromEntries(
      Object.entries(storedServers).map(([name, config]) => [
        name,
        this.normalizeServerConfig(
          name,
          config,
          legacyEnabledServers,
          legacyKeysPresent,
          defaultEnabledServers
        )
      ])
    )
    const removedBuiltInServers = new Set(this.getRemovedBuiltInServers())
    let hasChanges =
      legacyEnabledServers.size > 0 ||
      legacyKeysPresent ||
      Boolean((this.mcpStore.get('mcpServers') || {}).powerpack)

    const ensureBuiltInServerExists = (
      serverName: string,
      serverConfig: Omit<MCPServerConfig, 'enabled'>
    ): void => {
      if (removedBuiltInServers.has(serverName)) {
        return
      }
      if (!updatedServers[serverName]) {
        console.log(`Adding missing built-in MCP service: ${serverName}`)
        updatedServers[serverName] = {
          ...this.cloneServerConfig(serverConfig as MCPServerConfig),
          enabled: defaultEnabledServers.has(serverName)
        }
        hasChanges = true
      }
    }

    // 遍历所有默认的inmemory服务，确保它们都存在
    // Note: buildInFileSystem is excluded as it's now provided via Agent tools
    for (const [serverName, serverConfig] of Object.entries(DEFAULT_INMEMORY_SERVERS)) {
      ensureBuiltInServerExists(serverName, serverConfig)
    }

    // 确保 DEFAULT_MCP_SERVERS 中定义的服务存在
    for (const [serverName, serverConfig] of Object.entries(DEFAULT_MCP_SERVERS.mcpServers)) {
      ensureBuiltInServerExists(serverName, serverConfig)
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
      console.log(`Removing service not supported on current platform: ${serverName}`)
      delete updatedServers[serverName]
      hasChanges = true
    }

    // 移除不兼容的服务
    const builtinKnowledgeSupported = await presenter.knowledgePresenter.isSupported()
    if (!builtinKnowledgeSupported) {
      console.warn(
        'Built-in knowledge base service is not supported in current environment, removing related services'
      )
      delete updatedServers.builtinKnowledge
      hasChanges = true
    }

    // 如果有变化，更新存储
    if (
      hasChanges ||
      Object.keys(updatedServers).length !== Object.keys(storedServers).length ||
      Object.entries(updatedServers).some(
        ([serverName, config]) => storedServers[serverName]?.enabled !== config.enabled
      )
    ) {
      this.mcpStore.set('mcpServers', updatedServers)
      this.mcpStore.delete('defaultServer')
      this.mcpStore.delete('defaultServers')
    }

    return Promise.resolve(updatedServers)
  }

  // 设置MCP服务器配置
  async setMcpServers(servers: Record<string, MCPServerConfig>): Promise<void> {
    this.mcpStore.set('mcpServers', servers)
    this.emitConfigChanged(servers)
  }

  async getEnabledMcpServers(): Promise<string[]> {
    const servers = await this.getMcpServers()
    return Object.entries(servers)
      .filter(([, config]) => config.enabled)
      .map(([name]) => name)
  }

  async setMcpServerEnabled(serverName: string, enabled: boolean): Promise<void> {
    const mcpServers = await this.getMcpServers()
    const server = mcpServers[serverName]
    if (!server) {
      throw new Error(`MCP server ${serverName} not found`)
    }
    if (server.enabled === enabled) {
      return
    }
    mcpServers[serverName] = { ...server, enabled }
    await this.setMcpServers(mcpServers)
  }

  // 设置MCP启用状态
  async setMcpEnabled(enabled: boolean): Promise<void> {
    this.mcpStore.set('mcpEnabled', enabled)
    this.emitConfigChanged(await this.getMcpServers())
  }

  // 获取MCP启用状态
  getMcpEnabled(): Promise<boolean> {
    return Promise.resolve(this.mcpStore.get('mcpEnabled') ?? DEFAULT_MCP_SERVERS.mcpEnabled)
  }

  // 添加MCP服务器
  async addMcpServer(name: string, config: MCPServerConfig): Promise<boolean> {
    const mcpServers = await this.getMcpServers()
    mcpServers[name] = this.normalizeServerConfig(
      name,
      config,
      new Set<string>(),
      false,
      new Set(this.getDefaultEnabledServerNames())
    )
    if (this.isBuiltInServer(name)) {
      this.unmarkBuiltInServerRemoved(name)
    }
    await this.setMcpServers(mcpServers)
    return true
  }

  // 获取NPM Registry缓存
  getNpmRegistryCache(): INpmRegistryCache | undefined {
    return this.mcpStore.get('npmRegistryCache')
  }

  // 设置NPM Registry缓存
  setNpmRegistryCache(cache: INpmRegistryCache): void {
    this.mcpStore.set('npmRegistryCache', cache)
  }

  // 检查缓存是否有效（24小时内）
  isNpmRegistryCacheValid(): boolean {
    const cache = this.getNpmRegistryCache()
    if (!cache) return false
    const now = Date.now()
    const cacheAge = now - cache.lastChecked
    const CACHE_DURATION = 24 * 60 * 60 * 1000 // 24小时
    return cacheAge < CACHE_DURATION
  }

  // 获取有效的NPM Registry（按优先级：自定义源 > 缓存 > 默认）
  getEffectiveNpmRegistry(): string | null {
    const customRegistry = this.getCustomNpmRegistry()
    if (customRegistry) {
      console.log(`[NPM Registry] Using custom registry: ${customRegistry}`)
      return customRegistry
    }

    if (this.getAutoDetectNpmRegistry() && this.isNpmRegistryCacheValid()) {
      const cache = this.getNpmRegistryCache()
      if (cache?.registry) {
        console.log(`[NPM Registry] Using cached registry: ${cache.registry}`)
        return cache.registry
      }
    }

    console.log('[NPM Registry] No effective registry found, will use default or detect')
    return null
  }

  // 获取自定义NPM Registry
  getCustomNpmRegistry(): string | undefined {
    return this.mcpStore.get('customNpmRegistry')
  }

  // 标准化NPM Registry URL
  private normalizeNpmRegistryUrl(registry: string): string {
    let normalized = registry.trim()
    if (!normalized.endsWith('/')) {
      normalized += '/'
    }
    return normalized
  }

  // 设置自定义NPM Registry
  setCustomNpmRegistry(registry: string | undefined): void {
    if (registry === undefined) {
      this.mcpStore.delete('customNpmRegistry')
    } else {
      const normalizedRegistry = this.normalizeNpmRegistryUrl(registry)
      this.mcpStore.set('customNpmRegistry', normalizedRegistry)
      console.log(`[NPM Registry] Normalized custom registry: ${registry} -> ${normalizedRegistry}`)
    }
  }

  // 获取自动检测NPM Registry设置
  getAutoDetectNpmRegistry(): boolean {
    return this.mcpStore.get('autoDetectNpmRegistry') ?? true
  }

  // 设置自动检测NPM Registry
  setAutoDetectNpmRegistry(enabled: boolean): void {
    this.mcpStore.set('autoDetectNpmRegistry', enabled)
  }

  // 清除NPM Registry缓存
  clearNpmRegistryCache(): void {
    this.mcpStore.delete('npmRegistryCache')
  }

  // 移除MCP服务器
  async removeMcpServer(name: string): Promise<void> {
    const mcpServers = await this.getMcpServers()
    delete mcpServers[name]
    if (this.isBuiltInServer(name)) {
      this.markBuiltInServerRemoved(name)
    }
    await this.setMcpServers(mcpServers)
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

  /**
   * Batch import MCP servers from external source (like ModelScope)
   * @param servers - Array of MCP server configs to import
   * @param options - Import options
   * @returns Promise<{ imported: number; skipped: number; errors: string[] }>
   */
  async batchImportMcpServers(
    servers: Array<{
      name: string
      description: string
      package: string
      version?: string
      type?: MCPServerType
      args?: string[]
      env?: Record<string, string>
      enabled?: boolean
      source?: string
      [key: string]: unknown
    }>,
    options: {
      skipExisting?: boolean
      enableByDefault?: boolean
      overwriteExisting?: boolean
    } = {}
  ): Promise<{ imported: number; skipped: number; errors: string[] }> {
    const { skipExisting = true, enableByDefault = false, overwriteExisting = false } = options
    const result = {
      imported: 0,
      skipped: 0,
      errors: [] as string[]
    }

    const existingServers = await this.getMcpServers()

    for (const serverConfig of servers) {
      try {
        // Generate unique server name based on package name
        const serverName = this.generateUniqueServerName(serverConfig.package, existingServers)
        const existingServer = existingServers[serverName]

        // Check if server already exists
        if (existingServer && !overwriteExisting) {
          if (skipExisting) {
            console.log(`Skipping existing MCP server: ${serverName}`)
            result.skipped++
            continue
          } else {
            result.errors.push(`Server ${serverName} already exists`)
            continue
          }
        }

        // Create MCP server config
        const mcpConfig: ExtendedMCPServerConfig = {
          name: serverConfig.name,
          description: serverConfig.description,
          args: serverConfig.args || [],
          env: serverConfig.env || {},
          enabled: serverConfig.enabled ?? enableByDefault,
          type: (serverConfig.type as MCPServerType) || 'stdio',
          package: serverConfig.package,
          version: serverConfig.version || 'latest',
          source: serverConfig.source as string | undefined,
          logo_url: serverConfig.logo_url as string | undefined,
          publisher: serverConfig.publisher as string | undefined,
          tags: serverConfig.tags as string[] | undefined,
          view_count: serverConfig.view_count as number | undefined
        }

        // Add or update the server
        const success = await this.addMcpServer(serverName, mcpConfig as unknown as MCPServerConfig)
        if (success || overwriteExisting) {
          if (existingServer && overwriteExisting) {
            await this.updateMcpServer(serverName, mcpConfig as unknown as Partial<MCPServerConfig>)
            console.log(`Updated MCP server: ${serverName}`)
          } else {
            console.log(`Imported MCP server: ${serverName}`)
          }
          result.imported++
        } else {
          result.errors.push(`Failed to import server: ${serverName}`)
        }
      } catch (error) {
        const errorMsg = `Error importing server ${serverConfig.name}: ${error instanceof Error ? error.message : String(error)}`
        console.error(errorMsg)
        result.errors.push(errorMsg)
      }
    }

    console.log(
      `MCP batch import completed. Imported: ${result.imported}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`
    )

    // Emit event to notify about the import
    eventBus.sendToRenderer(MCP_EVENTS.CONFIG_CHANGED, SendTarget.ALL_WINDOWS, {
      action: 'batch_import',
      result
    })

    return result
  }

  /**
   * Generate a unique server name based on package name
   * @param packageName - The package name to base the server name on
   * @param existingServers - Existing servers to check against
   * @returns Unique server name
   */
  private generateUniqueServerName(
    packageName: string,
    existingServers: Record<string, MCPServerConfig>
  ): string {
    // Clean up package name to create a suitable server name
    let baseName = packageName
      .replace(/[@/]/g, '-')
      .replace(/[^a-zA-Z0-9-_]/g, '')
      .toLowerCase()

    // If the base name doesn't exist, use it directly
    if (!existingServers[baseName]) {
      return baseName
    }

    // If it exists, append a number suffix
    let counter = 1
    let uniqueName = `${baseName}-${counter}`
    while (existingServers[uniqueName]) {
      counter++
      uniqueName = `${baseName}-${counter}`
    }

    return uniqueName
  }

  /**
   * Check if a server with given package already exists
   * @param packageName - Package name to check
   * @returns Promise<string | null> - Returns server name if exists, null otherwise
   */
  async findServerByPackage(packageName: string): Promise<string | null> {
    const servers = await this.getMcpServers()

    for (const [serverName, config] of Object.entries(servers)) {
      const extendedConfig = config as unknown as ExtendedMCPServerConfig
      if (extendedConfig.package === packageName) {
        return serverName
      }
    }

    return null
  }

  public onUpgrade(oldVersion: string | undefined): void {
    console.log('onUpgrade', oldVersion)

    // Migrate filesystem/buildInFileSystem servers - these are now provided via Agent tools
    // Remove for all versions < 0.6.0
    if (oldVersion && compare(oldVersion, '0.6.0', '<')) {
      try {
        const mcpServers = this.mcpStore.get('mcpServers') || {}
        let hasChanges = false

        // Check if servers exist before deletion (for tracking)
        const hadFilesystem = !!mcpServers.filesystem
        const hadBuildInFileSystem = !!mcpServers.buildInFileSystem

        // Remove old filesystem server
        if (mcpServers.filesystem) {
          console.log('Removing old filesystem MCP server (now provided via Agent tools)')
          delete mcpServers.filesystem
          hasChanges = true
        }

        // Remove buildInFileSystem server
        if (mcpServers.buildInFileSystem) {
          console.log('Removing buildInFileSystem MCP server (now provided via Agent tools)')
          delete mcpServers.buildInFileSystem
          hasChanges = true
        }

        // Mark as removed for tracking
        if (hadFilesystem || hadBuildInFileSystem) {
          this.markBuiltInServerRemoved('buildInFileSystem')
        }

        if (hasChanges) {
          this.mcpStore.set('mcpServers', mcpServers)
          console.log('Migration: filesystem MCP servers removed (now available via Agent tools)')
        }
      } catch (error) {
        console.error('Error occurred while migrating filesystem server:', error)
      }
    }

    // 移除 custom-prompts-server 服务（版本 < 0.3.5）
    if (oldVersion && compare(oldVersion, '0.3.5', '<')) {
      try {
        const mcpServers = this.mcpStore.get('mcpServers') || {}
        const customPromptsServerName = 'deepchat-inmemory/custom-prompts-server'

        if (mcpServers[customPromptsServerName]) {
          console.log('Detected old version custom-prompts-server, starting removal')
          delete mcpServers[customPromptsServerName]
          this.mcpStore.set('mcpServers', mcpServers)

          console.log('Removal of custom-prompts-server completed')
        }
      } catch (error) {
        console.error('Error occurred while removing custom-prompts-server:', error)
      }
    }

    try {
      this.removeDeprecatedBuiltInServers(this.mcpStore.get('mcpServers') || {})
    } catch (error) {
      console.error('Error occurred while removing deprecated built-in MCP servers:', error)
    }

    // 升级后检查并添加平台特有服务
    try {
      const mcpServers = this.mcpStore.get('mcpServers') || {}
      const removedBuiltInServers = new Set(this.getRemovedBuiltInServers())
      let hasChanges = false

      // 检查是否需要添加平台特有服务
      if (
        isMacOS() &&
        !mcpServers['deepchat/apple-server'] &&
        !removedBuiltInServers.has('deepchat/apple-server')
      ) {
        console.log('Detected macOS platform, adding Apple system integration service')
        mcpServers['deepchat/apple-server'] = {
          ...(PLATFORM_SPECIFIC_SERVERS['deepchat/apple-server'] as MCPServerConfig),
          enabled: true
        }
        hasChanges = true
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
        console.log(`Removing service not supported on current platform: ${serverName}`)
        delete mcpServers[serverName]
        hasChanges = true
      }

      if (hasChanges) {
        this.mcpStore.set('mcpServers', mcpServers)
        console.log('Platform-specific service upgrade completed')
      }
    } catch (error) {
      console.error('Error occurred while upgrading platform-specific services:', error)
    }

    this.mcpStore.delete('defaultServer')
    this.mcpStore.delete('defaultServers')
  }
}
