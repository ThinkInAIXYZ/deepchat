import logger from '@shared/logger'
import type { MCPServerConfig } from '@shared/types/mcp'
import {
  McpClient,
  McpConnectionCancelledError,
  type McpClientRuntime,
  type McpConnectResult
} from './mcpClient'
import axios from 'axios'
import { proxyConfig } from '@/platform/proxy'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import type { SemanticNotificationPublisher } from '@/notifications'
import type { McpOAuthManager } from './mcpOAuthManager'
import type { InMemoryServerFactory } from './inMemoryServers/builder'
import type { PrivacySettingsPort } from '@/app/privacy'
import type { McpSettings } from './settings'

const NPM_REGISTRY_LIST = [
  'https://registry.npmmirror.com/',
  'https://registry.npmjs.org/',
  'https://r.cnpmjs.org/'
]

export class ServerManager {
  private clients: Map<string, McpClient> = new Map()
  private serverLastErrors: Map<string, string> = new Map()
  private readonly mcpSettings: McpSettings
  private npmRegistry: string | null = null
  private uvRegistry: string | null = null
  private mcpOAuthManager?: McpOAuthManager
  private readonly inMemoryServerFactory: InMemoryServerFactory
  private readonly clientRuntime: McpClientRuntime
  private readonly onRegistryChanged: () => void
  private readonly privacy: PrivacySettingsPort

  constructor(
    mcpSettings: McpSettings,
    privacy: PrivacySettingsPort,
    inMemoryServerFactory: InMemoryServerFactory,
    clientRuntime: McpClientRuntime,
    onRegistryChanged: () => void,
    private readonly semanticNotifications: SemanticNotificationPublisher,
    private readonly publishEvent: DeepchatEventPublisher,
    mcpOAuthManager?: McpOAuthManager
  ) {
    this.mcpSettings = mcpSettings
    this.privacy = privacy
    this.inMemoryServerFactory = inMemoryServerFactory
    this.clientRuntime = clientRuntime
    this.onRegistryChanged = onRegistryChanged
    this.mcpOAuthManager = mcpOAuthManager
    this.loadRegistryFromCache()
  }

  private isPrivacyModeEnabled(): boolean {
    return this.privacy.isEnabled()
  }

  private isPluginOwnedServerConfig(config?: Partial<MCPServerConfig> | null): boolean {
    return Boolean(config?.ownerPluginId || config?.source === 'plugin')
  }

  getServerLastError(serverName: string): string | undefined {
    return this.serverLastErrors.get(serverName)
  }

  setServerLastError(serverName: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error || 'Unknown error')
    this.serverLastErrors.set(serverName, message)
  }

  clearServerLastError(serverName: string): void {
    this.serverLastErrors.delete(serverName)
  }

  loadRegistryFromCache(): void {
    const effectiveRegistry = this.mcpSettings.getEffectiveNpmRegistry()
    if (effectiveRegistry) {
      this.npmRegistry = effectiveRegistry
      if (effectiveRegistry === 'https://registry.npmmirror.com/') {
        this.uvRegistry = 'http://mirrors.aliyun.com/pypi/simple'
      } else {
        this.uvRegistry = null
      }
      logger.info(`[NPM Registry] Loaded effective registry: ${effectiveRegistry}`)
    } else {
      this.npmRegistry = null
      this.uvRegistry = null
      logger.info('[NPM Registry] No effective registry, will use default or detect')
    }
  }

  // Test npm registry speed and return best choice
  async testNpmRegistrySpeed(useCache: boolean = true): Promise<string> {
    const customRegistry = this.mcpSettings.getCustomNpmRegistry()
    if (customRegistry) {
      this.npmRegistry = customRegistry
      if (customRegistry === 'https://registry.npmmirror.com/') {
        this.uvRegistry = 'http://mirrors.aliyun.com/pypi/simple'
      } else {
        this.uvRegistry = null
      }
      logger.info(`[NPM Registry] Using custom registry: ${customRegistry}`)
      return customRegistry
    }
    if (useCache && this.mcpSettings.isNpmRegistryCacheValid()) {
      const cache = this.mcpSettings.getNpmRegistryCache()
      if (cache) {
        this.npmRegistry = cache.registry
        if (cache.registry === 'https://registry.npmmirror.com/') {
          this.uvRegistry = 'http://mirrors.aliyun.com/pypi/simple'
        } else {
          this.uvRegistry = null
        }
        logger.info(`[NPM Registry] Using cached registry: ${cache.registry}`)
        return cache.registry
      }
    }

    logger.info('[NPM Registry] Testing registry speed...')
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
    logger.info('[NPM Registry] Test results:', successfulResults)
    let bestRegistry: string
    if (successfulResults.length === 0) {
      logger.info('[NPM Registry] All tests failed, using default registry')
      bestRegistry = NPM_REGISTRY_LIST[0]
    } else {
      bestRegistry = successfulResults[0].registry
      logger.info(`[NPM Registry] Best registry: ${bestRegistry} (${successfulResults[0].time}ms)`)
    }
    this.npmRegistry = bestRegistry
    if (bestRegistry === 'https://registry.npmmirror.com/') {
      this.uvRegistry = 'http://mirrors.aliyun.com/pypi/simple'
    } else {
      this.uvRegistry = null
    }

    this.mcpSettings.setNpmRegistryCache({
      registry: bestRegistry,
      lastChecked: Date.now(),
      isAutoDetect: true
    })
    return bestRegistry
  }

  // Get npm registry
  getNpmRegistry(): string | null {
    return this.npmRegistry
  }

  async refreshNpmRegistry(): Promise<string> {
    logger.info('[NPM Registry] Manual refresh triggered')
    return await this.testNpmRegistrySpeed(false) // Don't use cache
  }

  async updateNpmRegistryInBackground(): Promise<void> {
    try {
      if (this.isPrivacyModeEnabled()) {
        logger.info('[NPM Registry] Privacy mode enabled, skipping background update')
        return
      }

      // Check if update is needed
      if (this.mcpSettings.isNpmRegistryCacheValid()) {
        logger.info('[NPM Registry] Cache is still valid, skipping background update')
        return
      }
      logger.info('[NPM Registry] Starting background registry update')
      await this.testNpmRegistrySpeed(false)
      logger.info('[NPM Registry] Background registry update completed')
    } catch (error) {
      console.error('[NPM Registry] Background update failed:', error)
    }
  }

  // Get uv registry
  getUvRegistry(): string | null {
    return this.uvRegistry
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

  async getActiveClients(): Promise<McpClient[]> {
    return Array.from(this.clients.values()).filter((client) => client.isActive())
  }

  async startServer(
    name: string,
    options: {
      onBackgroundConnected?: () => void
      configOverride?: Partial<MCPServerConfig>
      waitForConnection?: boolean
    } = {}
  ): Promise<McpConnectResult> {
    const existingClient = this.clients.get(name)
    if (existingClient?.isServerRunning()) {
      console.info(`MCP server ${name} is already running`)
      this.recoverConnectionNotification(name)
      return 'connected'
    }

    let client = existingClient
    let serverConfig: MCPServerConfig
    if (existingClient?.isActive() && !options.configOverride) {
      console.info(`MCP server ${name} is starting...`)
      serverConfig = (existingClient.serverConfig ?? {}) as unknown as MCPServerConfig
    } else {
      const servers = await this.mcpSettings.getMcpServers()
      const persistedServerConfig = servers[name]
      if (!persistedServerConfig) {
        throw new Error(`MCP server ${name} not found`)
      }
      // Runtime adapters own every field they override. In particular, replacing env preserves the
      // minimal child-process boundary instead of merging stale persisted variables back into it.
      serverConfig = options.configOverride
        ? {
            ...persistedServerConfig,
            ...options.configOverride
          }
        : persistedServerConfig

      if (existingClient) {
        await existingClient.disconnect()
        if (this.clients.get(name) === existingClient) {
          this.clients.delete(name)
        }
      }
      client = undefined
    }

    try {
      if (!client) {
        console.info(`Starting MCP server ${name}...`)
        const npmRegistry = serverConfig.customNpmRegistry || this.npmRegistry
        client = new McpClient(
          name,
          serverConfig as unknown as Record<string, unknown>,
          npmRegistry,
          this.uvRegistry,
          this.mcpOAuthManager,
          this.inMemoryServerFactory,
          this.clientRuntime,
          this.onRegistryChanged,
          this.publishEvent
        )
        this.clients.set(name, client)
      }

      const connectTask = client.connect({
        phase: 'startup',
        waitForConnection: options.waitForConnection
      })
      const connectionCompletion = client.getConnectionCompletion()
      const connectResult = await connectTask
      this.handleStartupConnectResult(
        name,
        client,
        serverConfig,
        connectResult,
        connectionCompletion,
        options
      )
      if (connectResult === 'connected') {
        this.clearServerLastError(name)
        this.recoverConnectionNotification(name)
      }
      return connectResult
    } catch (error) {
      if (client?.getLifecycleStatus?.() === 'stopped' && !client.isActive()) {
        console.info(`MCP server ${name} startup was cancelled; ignoring stopped client`)
        if (this.clients.get(name) === client) {
          this.clients.delete(name)
        }
        return 'stopped'
      }

      console.error(`Failed to start MCP server ${name}:`, error)

      // Remove client reference
      if (client && this.clients.get(name) === client) {
        this.clients.delete(name)
      }
      this.setServerLastError(name, error)
      const authHandled =
        this.mcpOAuthManager?.handleConnectionError(name, serverConfig, error) ?? false

      if (!authHandled && !this.isPluginOwnedServerConfig(serverConfig)) {
        this.notifyConnectionFailure(name)
      }

      throw error
    } finally {
      this.onRegistryChanged()
    }
  }

  private handleStartupConnectResult(
    name: string,
    client: McpClient,
    serverConfig: MCPServerConfig,
    connectResult: McpConnectResult,
    connectionCompletion: Promise<void> | null,
    options: { onBackgroundConnected?: () => void } = {}
  ): void {
    if (connectResult !== 'soft-timeout-released') {
      return
    }

    if (!connectionCompletion) {
      return
    }

    connectionCompletion
      .then(() => {
        this.clearServerLastError(name)
        this.recoverConnectionNotification(name)
        options.onBackgroundConnected?.()
        this.onRegistryChanged()
      })
      .catch((error) => {
        if (error instanceof McpConnectionCancelledError) {
          return
        }

        if (this.clients.get(name) !== client) {
          return
        }

        this.clients.delete(name)
        this.setServerLastError(name, error)
        const authHandled =
          this.mcpOAuthManager?.handleConnectionError(name, serverConfig, error) ?? false

        if (!authHandled && !this.isPluginOwnedServerConfig(serverConfig)) {
          this.notifyConnectionFailure(name)
        }

        this.onRegistryChanged()
      })
  }

  private notifyConnectionFailure(serverName: string): void {
    this.semanticNotifications.occur({
      code: 'mcp.connectionFailed',
      serverName
    })
  }

  private recoverConnectionNotification(serverName: string): void {
    this.semanticNotifications.recover({
      code: 'mcp.connectionFailed',
      serverName
    })
  }

  async stopServer(name: string): Promise<void> {
    const client = this.clients.get(name)

    if (!client) {
      this.recoverConnectionNotification(name)
      return
    }

    try {
      // Disconnect, this will stop the service
      await client.disconnect()

      // Remove from client list
      this.clients.delete(name)
      this.clearServerLastError(name)
      this.recoverConnectionNotification(name)

      console.info(`MCP server ${name} has been stopped`)
      this.onRegistryChanged()
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

  isServerActive(name: string): boolean {
    return this.clients.get(name)?.isActive() ?? false
  }

  /**
   * Get client instance
   */
  getClient(name: string): McpClient | undefined {
    return this.clients.get(name)
  }
}
