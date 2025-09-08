import { IConfigPresenter } from '@shared/presenter'
import { McpClient } from './mcpClient'
import axios from 'axios'
import { proxyConfig } from '@/presenter/proxyConfig'
import { eventBus, SendTarget } from '@/eventbus'
import { NOTIFICATION_EVENTS } from '@/events'
import { MCP_EVENTS } from '@/events'
import { getErrorMessageLabels } from '@shared/i18n'

const NPM_REGISTRY_LIST = [
  'https://registry.npmmirror.com/',
  'https://registry.npmjs.org/',
  'https://r.cnpmjs.org/'
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

  // Test npm registry speed and return best choice
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
    const timeout = 10000
    const testPackage = 'tiny-runtime-injector'

    // Get proxy configuration
    const proxyUrl = proxyConfig.getProxyUrl()
    const proxyOptions = (() => {
      if (!proxyUrl) return {}
      const u = new URL(proxyUrl)
      const host = u.hostname
      const port = u.port ? parseInt(u.port, 10) : u.protocol === 'https:' ? 443 : 80
      const auth = u.username ? { username: u.username, password: u.password ?? '' } : undefined
      return { proxy: { host, port, ...(auth ? { auth } : {}) } }
    })()

    const results = await Promise.all(
      NPM_REGISTRY_LIST.map(async (registry) => {
        const start = Date.now()
        let success = false
        let isTimeout = false
        let time = 0

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeout)
        try {
          const response = await axios.get(`${registry}${testPackage}`, {
            ...proxyOptions,
            signal: controller.signal
          })
          success = response.status >= 200 && response.status < 300
        } catch (error) {
          isTimeout =
            (error instanceof Error &&
              (error.name === 'AbortError' || error.name === 'CanceledError')) ||
            Date.now() - start >= timeout
        } finally {
          clearTimeout(timeoutId)
          time = Date.now() - start
        }

        return {
          registry,
          success,
          time,
          isTimeout
        }
      })
    )

    // Filter successful requests and sort by response time
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

  // Get npm registry
  getNpmRegistry(): string | null {
    return this.npmRegistry
  }

  async refreshNpmRegistry(): Promise<string> {
    console.log('[NPM Registry] Manual refresh triggered')
    return await this.testNpmRegistrySpeed(false) // Don't use cache
  }

  async updateNpmRegistryInBackground(): Promise<void> {
    try {
      // Check if update is needed
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

  // Get uv registry
  getUvRegistry(): string | null {
    return this.uvRegistry
  }

  // Get default server name list
  async getDefaultServerNames(): Promise<string[]> {
    return this.configPresenter.getMcpDefaultServers()
  }

  // Get default server name (compatible with old version, return first default server)
  async getDefaultServerName(): Promise<string | null> {
    const defaultServers = await this.configPresenter.getMcpDefaultServers()
    const servers = await this.configPresenter.getMcpServers()

    // If no default servers or default server doesn't exist, return null
    if (defaultServers.length === 0 || !servers[defaultServers[0]]) {
      return null
    }

    return defaultServers[0]
  }

  // Get default client (don't auto-start service, only return first default server client)
  async getDefaultClient(): Promise<McpClient | null> {
    const defaultServerName = await this.getDefaultServerName()

    if (!defaultServerName) {
      return null
    }

    // Return existing client instance, regardless of whether it's running
    return this.getClient(defaultServerName) || null
  }

  // Get all default clients
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

  // Get running clients
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
    // If server is already running, no need to start again
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
      // Create and save client instance, passing npm registry
      const client = new McpClient(
        name,
        serverConfig as unknown as Record<string, unknown>,
        npmRegistry,
        this.uvRegistry
      )
      this.clients.set(name, client)

      // Connect to server, this will start the service
      await client.connect()
    } catch (error) {
      console.error(`Failed to start MCP server ${name}:`, error)

      // Remove client reference
      this.clients.delete(name)

      // Send global error notification
      this.sendMcpConnectionError(name, error)

      throw error
    } finally {
      eventBus.send(MCP_EVENTS.CLIENT_LIST_UPDATED, SendTarget.ALL_WINDOWS)
    }
  }

  // Handle and send MCP connection error notification
  private sendMcpConnectionError(serverName: string, error: unknown): void {
    // Import required modules

    try {
      // Get current language
      const locale = this.configPresenter.getLanguage?.() || 'zh-CN'
      const errorMessages = getErrorMessageLabels(locale)

      // Format error information
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      const formattedMessage = `${serverName}: ${errorMsg}`

      // Send global error notification
      eventBus.sendToRenderer(NOTIFICATION_EVENTS.SHOW_ERROR, SendTarget.ALL_WINDOWS, {
        title: errorMessages.mcpConnectionErrorTitle,
        message: formattedMessage,
        id: `mcp-error-${serverName}-${Date.now()}`, // Add timestamp and server name to ensure unique ID for each error
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
      // Disconnect, this will stop the service
      await client.disconnect()

      // Remove from client list
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
   * Get client instance
   */
  getClient(name: string): McpClient | undefined {
    return this.clients.get(name)
  }
}
