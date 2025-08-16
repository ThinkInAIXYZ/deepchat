import { IConfigPresenter } from '@shared/presenter'
import { McpClient } from './mcpClient'
import axios from 'axios'
import { proxyConfig } from '@/presenter/proxyConfig'
import { eventBus, SendTarget } from '@/eventbus'
import { NOTIFICATION_EVENTS } from '@/events'
import { MCP_EVENTS } from '@/events'
import { getErrorMessageLabels } from '@shared/i18n'

const NPM_REGISTRY_LIST = [
  'https://registry.npmjs.org/',
  'https://r.cnpmjs.org/',
  'https://registry.npmmirror.com/'
]

export class ServerManager {
  private clients: Map<string, McpClient> = new Map()
  private configPresenter: IConfigPresenter
  private npmRegistry: string | null = null
  private uvRegistry: string | null = null

  constructor(configPresenter: IConfigPresenter) {
    this.configPresenter = configPresenter
    this.loadRegistryFromCache()
  }
  loadRegistryFromCache(): void {
    const effectiveRegistry = this.configPresenter.getEffectiveNpmRegistry?.()
    if (effectiveRegistry) {
      this.npmRegistry = effectiveRegistry
      if (effectiveRegistry === 'https://registry.npmmirror.com/') {
        this.uvRegistry = 'http://mirrors.aliyun.com/pypi/simple'
      } else {
        this.uvRegistry = null
      }
      console.log(`[NPM Registry] Loaded effective registry: ${effectiveRegistry}`)
    } else {
      this.npmRegistry = null
      this.uvRegistry = null
      console.log('[NPM Registry] No effective registry, will use default or detect')
    }
  }

  // 测试npm registry速度并返回最佳选择
  async testNpmRegistrySpeed(useCache: boolean = true): Promise<string> {
    const customRegistry = this.configPresenter.getCustomNpmRegistry?.()
    if (customRegistry) {
      this.npmRegistry = customRegistry
      if (customRegistry === 'https://registry.npmmirror.com/') {
        this.uvRegistry = 'http://mirrors.aliyun.com/pypi/simple'
      } else {
        this.uvRegistry = null
      }
      console.log(`[NPM Registry] Using custom registry: ${customRegistry}`)
      return customRegistry
    }
    if (useCache && this.configPresenter.isNpmRegistryCacheValid?.()) {
      const cache = this.configPresenter.getNpmRegistryCache?.()
      if (cache) {
        this.npmRegistry = cache.registry
        if (cache.registry === 'https://registry.npmmirror.com/') {
          this.uvRegistry = 'http://mirrors.aliyun.com/pypi/simple'
        } else {
          this.uvRegistry = null
        }
        console.log(`[NPM Registry] Using cached registry: ${cache.registry}`)
        return cache.registry
      }
    }

    console.log('[NPM Registry] Testing registry speed...')
    const timeout = 3000
    const testPackage = 'tiny-runtime-injector'

    // 获取代理配置
    const proxyUrl = proxyConfig.getProxyUrl()
    const proxyOptions = proxyUrl
      ? { proxy: { host: new URL(proxyUrl).hostname, port: parseInt(new URL(proxyUrl).port) } }
      : {}

    const results = await Promise.all(
      NPM_REGISTRY_LIST.map(async (registry) => {
        const start = Date.now()
        let success = false
        let isTimeout = false
        let time = 0

        try {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), timeout)

          const response = await axios.get(`${registry}${testPackage}`, {
            ...proxyOptions,
            signal: controller.signal
          })

          clearTimeout(timeoutId)
          success = response.status >= 200 && response.status < 300
          time = Date.now() - start
        } catch (error) {
          time = Date.now() - start
          isTimeout = (error instanceof Error && error.name === 'AbortError') || time >= timeout
        }

        return {
          registry,
          success,
          time,
          isTimeout
        }
      })
    )

    // 过滤出成功的请求，并按响应时间排序
    const successfulResults = results
      .filter((result) => result.success)
      .sort((a, b) => a.time - b.time)
    console.log('[NPM Registry] Test results:', successfulResults)
    let bestRegistry: string
    if (successfulResults.length === 0) {
      console.log('[NPM Registry] All tests failed, using default registry')
      bestRegistry = NPM_REGISTRY_LIST[0]
    } else {
      bestRegistry = successfulResults[0].registry
      console.log(`[NPM Registry] Best registry: ${bestRegistry} (${successfulResults[0].time}ms)`)
    }
    this.npmRegistry = bestRegistry
    if (bestRegistry === 'https://registry.npmmirror.com/') {
      this.uvRegistry = 'http://mirrors.aliyun.com/pypi/simple'
    } else {
      this.uvRegistry = null
    }

    if (this.configPresenter.setNpmRegistryCache) {
      this.configPresenter.setNpmRegistryCache({
        registry: bestRegistry,
        lastChecked: Date.now(),
        isAutoDetect: true
      })
    }
    return bestRegistry
  }

  // 获取npm registry
  getNpmRegistry(): string | null {
    return this.npmRegistry
  }

  async refreshNpmRegistry(): Promise<string> {
    console.log('[NPM Registry] Manual refresh triggered')
    return await this.testNpmRegistrySpeed(false) // 不使用缓存
  }

  async updateNpmRegistryInBackground(): Promise<void> {
    try {
      // 检查是否需要更新
      if (this.configPresenter.isNpmRegistryCacheValid?.()) {
        console.log('[NPM Registry] Cache is still valid, skipping background update')
        return
      }
      console.log('[NPM Registry] Starting background registry update')
      await this.testNpmRegistrySpeed(false)
      console.log('[NPM Registry] Background registry update completed')
    } catch (error) {
      console.error('[NPM Registry] Background update failed:', error)
    }
  }

  // 获取uv registry
  getUvRegistry(): string | null {
    return this.uvRegistry
  }

  // 获取默认服务器名称列表
  async getDefaultServerNames(): Promise<string[]> {
    return this.configPresenter.getMcpDefaultServers()
  }

  // 获取默认服务器名称（兼容旧版本，返回第一个默认服务器）
  async getDefaultServerName(): Promise<string | null> {
    const defaultServers = await this.configPresenter.getMcpDefaultServers()
    const servers = await this.configPresenter.getMcpServers()

    // 如果没有默认服务器或者默认服务器不存在，返回 null
    if (defaultServers.length === 0 || !servers[defaultServers[0]]) {
      return null
    }

    return defaultServers[0]
  }

  // 获取默认客户端（不自动启动服务，仅返回第一个默认服务器客户端）
  async getDefaultClient(): Promise<McpClient | null> {
    const defaultServerName = await this.getDefaultServerName()

    if (!defaultServerName) {
      return null
    }

    // 返回已存在的客户端实例，无论是否运行
    return this.getClient(defaultServerName) || null
  }

  // 获取所有默认客户端
  async getDefaultClients(): Promise<McpClient[]> {
    const defaultServerNames = await this.getDefaultServerNames()
    const clients: McpClient[] = []

    for (const serverName of defaultServerNames) {
      const client = this.getClient(serverName)
      if (client) {
        clients.push(client)
      }
    }

    return clients
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
    if (this.clients.has(name)) {
      if (this.isServerRunning(name)) {
        console.info(`MCP server ${name} is already running`)
      } else {
        console.info(`MCP server ${name} is starting...`)
      }
      return
    }

    const servers = await this.configPresenter.getMcpServers()
    const serverConfig = servers[name]

    if (!serverConfig) {
      throw new Error(`MCP server ${name} not found`)
    }

    try {
      console.info(`Starting MCP server ${name}...`)
      const npmRegistry = serverConfig.customNpmRegistry || this.npmRegistry
      // 创建并保存客户端实例，传入npm registry
      const client = new McpClient(
        name,
        serverConfig as unknown as Record<string, unknown>,
        npmRegistry,
        this.uvRegistry
      )
      this.clients.set(name, client)

      // 连接到服务器，这将启动服务
      await client.connect()
    } catch (error) {
      console.error(`Failed to start MCP server ${name}:`, error)

      // 移除客户端引用
      this.clients.delete(name)

      // 发送全局错误通知
      this.sendMcpConnectionError(name, error)

      throw error
    } finally {
      eventBus.send(MCP_EVENTS.CLIENT_LIST_UPDATED, SendTarget.ALL_WINDOWS)
    }
  }

  // 处理并发送MCP连接错误通知
  private sendMcpConnectionError(serverName: string, error: unknown): void {
    // 引入所需模块

    try {
      // 获取当前语言
      const locale = this.configPresenter.getLanguage?.() || 'zh-CN'
      const errorMessages = getErrorMessageLabels(locale)

      // 格式化错误信息
      const errorMsg = error instanceof Error ? error.message : '未知错误'
      const formattedMessage = `${serverName}: ${errorMsg}`

      // 发送全局错误通知
      eventBus.sendToRenderer(NOTIFICATION_EVENTS.SHOW_ERROR, SendTarget.ALL_WINDOWS, {
        title: errorMessages.mcpConnectionErrorTitle,
        message: formattedMessage,
        id: `mcp-error-${serverName}-${Date.now()}`, // 添加时间戳和服务器名称确保每个错误有唯一ID
        type: 'error'
      })
    } catch (notifyError) {
      console.error('Failed to send MCP error notification:', notifyError)
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

      console.info(`MCP server ${name} has been stopped`)
      eventBus.send(MCP_EVENTS.CLIENT_LIST_UPDATED, SendTarget.ALL_WINDOWS)
    } catch (error) {
      console.error(`Failed to stop MCP server ${name}:`, error)
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
