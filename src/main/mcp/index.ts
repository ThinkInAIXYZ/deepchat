import type { ProviderSettingsPort } from '@/provider/settings'
import logger from '@shared/logger'
import { performance } from 'node:perf_hooks'
import type { Prompt } from '@shared/types/prompt'
import {
  TOOL_EXECUTION,
  type McpClient,
  type McpSamplingDecision,
  type McpSamplingRequestPayload,
  type MCPServerConfig,
  type McpServerAuthStatus,
  type McpServicePort,
  type MCPToolCall,
  type MCPToolDefinition,
  type MCPToolResponse,
  type PromptListEntry,
  type Resource,
  type ResourceListEntry
} from '@shared/types/mcp'
import type { ProviderRuntimePort } from '@shared/types/provider'
import { ServerManager } from './serverManager'
import type { McpClient as RuntimeMcpClient } from './mcpClient'
import { ToolManager, type ComputerUsePreviewObserver } from './toolManager'
import { McpRouterManager } from './mcprouterManager'
import { McpOAuthManager } from './mcpOAuthManager'
import { getErrorMessageLabels } from '@shared/i18n'
import { extractToolCallImagePreviews } from '@/lib/toolCallImagePreviews'
import type { InMemoryServerFactory } from './inMemoryServers/builder'
import type { PromptSettings } from '@/agent/promptSettings'
import type { DesktopSettings } from '@/desktop/settings'
import type { PrivacySettingsPort } from '@/app/privacy'
import type { AgentSettingsPort } from '@/agent/settings'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import { McpSettings } from './settings'

type McpToolAccessContext = {
  enabledTools?: string[]
  enabledServerIds?: string[]
  agentId?: string
  conversationId?: string
}

const MCP_SHUTDOWN_SERVER_TIMEOUT_MS = 10_000
const MCP_SHUTDOWN_CONCURRENCY = 4

const normalizeStringList = (items?: string[]): string[] | undefined => {
  if (!Array.isArray(items)) {
    return undefined
  }
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)))
}

const normalizeToolAccessContext = (
  input?: string[] | McpToolAccessContext
): McpToolAccessContext => {
  if (Array.isArray(input)) {
    return { enabledTools: normalizeStringList(input) }
  }
  return {
    enabledTools: normalizeStringList(input?.enabledTools),
    enabledServerIds: normalizeStringList(input?.enabledServerIds),
    agentId: input?.agentId?.trim() || undefined,
    conversationId: input?.conversationId?.trim() || undefined
  }
}

export class McpService implements McpServicePort {
  private serverManager: ServerManager
  private toolManager: ToolManager
  private mcpOAuthManager: McpOAuthManager
  private providerSettings: Pick<ProviderSettingsPort, 'getProviderModels' | 'getCustomModels'>
  private readonly promptSettings: Pick<PromptSettings, 'getCustomPrompts'>
  private readonly locale: Pick<DesktopSettings, 'getLanguage'>
  private readonly mcpSettings: McpSettings
  private readonly privacy: PrivacySettingsPort
  private isInitialized: boolean = false
  // McpRouter
  private mcprouter?: McpRouterManager
  private cacheImage?: (data: string) => Promise<string>
  private readonly onRegistryChanged: () => void
  private shutdownPromise: Promise<void> | null = null
  private pendingSamplingRequests = new Map<
    string,
    { resolve: (decision: McpSamplingDecision) => void; reject: (error: Error) => void }
  >()

  private emitServerStarted(serverName: string): void {
    this.publishEvent('mcp.server.started', {
      serverName,
      version: Date.now()
    })
  }

  private emitServerStopped(serverName: string): void {
    this.publishEvent('mcp.server.stopped', {
      serverName,
      version: Date.now()
    })
  }

  private startServerInBackground(
    serverName: string,
    successMessage: string,
    failureMessage: string
  ): void {
    void this.serverManager
      .startServer(serverName, {
        onBackgroundConnected: () => {
          logger.info(successMessage)
          this.emitServerStarted(serverName)
        }
      })
      .then((connectResult) => {
        if (connectResult === 'connected') {
          logger.info(successMessage)
          this.emitServerStarted(serverName)
        } else if (connectResult === 'soft-timeout-released') {
          logger.info(`[MCP] Server ${serverName} startup released after soft timeout`)
        }
      })
      .catch((error) => {
        console.error(failureMessage, error)
      })
  }

  constructor(
    providerSettings: Pick<ProviderSettingsPort, 'getProviderModels' | 'getCustomModels'>,
    agentSettings: Pick<AgentSettingsPort, 'getAcpAgents' | 'getAgentMcpSelections'>,
    promptSettings: Pick<PromptSettings, 'getCustomPrompts'>,
    locale: Pick<DesktopSettings, 'getLanguage'>,
    mcpSettings: McpSettings,
    privacy: PrivacySettingsPort,
    inMemoryServerFactory: InMemoryServerFactory,
    providerRuntime: Pick<ProviderRuntimePort, 'generateCompletionStandalone'>,
    onRegistryChanged: () => void,
    private readonly publishEvent: DeepchatEventPublisher,
    cacheImage?: (data: string) => Promise<string>,
    computerUsePreviewObserver?: ComputerUsePreviewObserver
  ) {
    logger.info('Initializing MCP service')

    this.providerSettings = providerSettings
    this.promptSettings = promptSettings
    this.locale = locale
    this.mcpSettings = mcpSettings
    this.privacy = privacy
    this.cacheImage = cacheImage
    this.onRegistryChanged = onRegistryChanged
    this.mcpOAuthManager = new McpOAuthManager(undefined, this.publishEvent, (serverName) =>
      this.restartServerAfterAuthentication(serverName)
    )
    this.serverManager = new ServerManager(
      this.locale,
      this.mcpSettings,
      this.privacy,
      inMemoryServerFactory,
      {
        sampling: this,
        completion: providerRuntime,
        config: this.providerSettings
      },
      () => this.handleRegistryChanged(),
      this.publishEvent,
      this.mcpOAuthManager
    )
    this.toolManager = new ToolManager(
      agentSettings,
      this.locale,
      this.mcpSettings,
      this.serverManager,
      this.publishEvent,
      computerUsePreviewObserver
    )
    // init mcprouter manager
    try {
      this.mcprouter = new McpRouterManager(this.mcpSettings)
    } catch (e) {
      console.warn('[MCP] McpRouterManager init failed:', e)
    }
  }

  handleConfigChanged(): void {
    this.handleRegistryChanged()
  }

  private handleRegistryChanged(): void {
    this.toolManager.invalidateRegistry()
    this.onRegistryChanged()
  }

  private isPrivacyModeEnabled(): boolean {
    return this.privacy.isEnabled()
  }

  private isPluginOwnedServerConfig(config?: Partial<MCPServerConfig> | null): boolean {
    return Boolean(config?.ownerPluginId || config?.source === 'plugin')
  }

  private async isPluginOwnedServerName(serverName: string): Promise<boolean> {
    const servers = await this.mcpSettings.getMcpServers()
    return this.isPluginOwnedServerConfig(servers[serverName])
  }

  private isServerAllowedByContext(
    serverName: string,
    serverConfig: MCPServerConfig | undefined,
    context: McpToolAccessContext
  ): boolean {
    if (this.isPluginOwnedServerConfig(serverConfig)) {
      return true
    }

    return !context.enabledServerIds || context.enabledServerIds.includes(serverName)
  }

  async initialize() {
    if (this.isInitialized) {
      return
    }

    try {
      // Load configuration
      const [servers, enabledServers, mcpEnabled] = await Promise.all([
        this.mcpSettings.getMcpServers(),
        this.mcpSettings.getEnabledMcpServers(),
        this.mcpSettings.getMcpEnabled()
      ])

      // Initialize npm registry (prefer cache if available)
      if (this.isPrivacyModeEnabled()) {
        logger.info('[MCP] Privacy mode enabled, skipping automatic npm registry detection')
      } else {
        logger.info('[MCP] Initializing npm registry...')
        try {
          await this.serverManager.testNpmRegistrySpeed(true)
          logger.info(`[MCP] npm registry initialized: ${this.serverManager.getNpmRegistry()}`)
        } catch (error) {
          console.error('[MCP] npm registry initialization failed:', error)
        }
      }

      // Check and start deepchat-inmemory/custom-prompts-server
      const customPromptsServerName = 'deepchat-inmemory/custom-prompts-server'
      const startingServers = new Set<string>()
      if (mcpEnabled && servers[customPromptsServerName]) {
        logger.info(`[MCP] Attempting to start custom prompts server: ${customPromptsServerName}`)
        startingServers.add(customPromptsServerName)
        this.startServerInBackground(
          customPromptsServerName,
          `[MCP] Custom prompts server ${customPromptsServerName} started successfully`,
          `[MCP] Failed to start custom prompts server ${customPromptsServerName}:`
        )
      }

      if (enabledServers.length > 0) {
        for (const serverName of enabledServers) {
          const serverConfig = servers[serverName]
          if (
            serverConfig &&
            !startingServers.has(serverName) &&
            (mcpEnabled || this.isPluginOwnedServerConfig(serverConfig))
          ) {
            logger.info(`[MCP] Attempting to start enabled server: ${serverName}`)
            startingServers.add(serverName)
            this.startServerInBackground(
              serverName,
              `[MCP] Enabled server ${serverName} started successfully`,
              `[MCP] Failed to start enabled server ${serverName}:`
            )
          }
        }
      }

      // Mark initialization complete
      this.isInitialized = true
      logger.info('[MCP] Initialization completed')

      this.scheduleBackgroundRegistryUpdate()
    } catch (error) {
      console.error('[MCP] Initialization failed:', error)
      // Mark as complete even if initialization fails to avoid system stuck in uninitialized state
      this.isInitialized = true
    }
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise
    }

    this.shutdownPromise = this.shutdownRunningClients()
    try {
      await this.shutdownPromise
    } finally {
      this.shutdownPromise = null
    }
  }

  private async shutdownRunningClients(): Promise<void> {
    const activeClients = await this.serverManager.getActiveClients()
    let nextIndex = 0

    const stopNext = async (): Promise<void> => {
      while (nextIndex < activeClients.length) {
        const client = activeClients[nextIndex++]
        await this.stopServerDuringShutdown(client)
      }
    }

    const workers = Array.from(
      { length: Math.min(MCP_SHUTDOWN_CONCURRENCY, activeClients.length) },
      () => stopNext()
    )
    await Promise.all(workers)
  }

  async stopServerDuringShutdownByName(serverName: string): Promise<void> {
    const client = this.serverManager.getClient(serverName)
    if (!client) {
      return
    }

    await this.stopServerDuringShutdown(client)
  }

  private async stopServerDuringShutdown(client: RuntimeMcpClient): Promise<void> {
    const startedAt = performance.now()
    let timeoutId: NodeJS.Timeout | null = null
    let timedOut = false

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true
        reject(new Error(`MCP server ${client.serverName} stop timed out`))
      }, MCP_SHUTDOWN_SERVER_TIMEOUT_MS)
    })

    try {
      await Promise.race([this.stopServer(client.serverName), timeoutPromise])
      console.info(
        `[MCP] Stopped server ${client.serverName} during shutdown durationMs=${(performance.now() - startedAt).toFixed(1)}`
      )
    } catch (error) {
      if (timedOut) {
        const forceTerminated = await client.forceTerminateStdioProcessTree(
          `shutdown stop timed out after ${MCP_SHUTDOWN_SERVER_TIMEOUT_MS}ms`
        )
        console.warn('[MCP] Server stop timed out during shutdown; continuing shutdown:', {
          serverName: client.serverName,
          timeoutMs: MCP_SHUTDOWN_SERVER_TIMEOUT_MS,
          durationMs: Number((performance.now() - startedAt).toFixed(1)),
          forceTerminatedStdioProcess: forceTerminated,
          note: forceTerminated
            ? 'stdio process tree force termination was attempted; the underlying stop promise may still finish later'
            : 'no stdio process tree was available to force terminate; underlying stop may still be pending'
        })
        return
      }

      console.error(`[MCP] Failed to stop server ${client.serverName} during shutdown:`, error)
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }

  private async restartServerAfterAuthentication(serverName: string): Promise<void> {
    const servers = await this.mcpSettings.getMcpServers()
    const serverConfig = servers[serverName]
    if (!serverConfig?.enabled) {
      return
    }

    try {
      const connectResult = await this.serverManager.startServer(serverName, {
        onBackgroundConnected: () => this.emitServerStarted(serverName)
      })
      if (connectResult === 'connected') {
        this.emitServerStarted(serverName)
      }
    } catch (error) {
      console.error(`[MCP] Failed to restart authenticated server ${serverName}:`, error)
    }
  }

  // =============== McpRouter marketplace APIs ===============
  async listMcpRouterServers(
    page: number,
    limit: number
  ): Promise<{
    servers: Array<{
      uuid: string
      created_at: string
      updated_at: string
      name: string
      author_name: string
      title: string
      description: string
      content?: string
      server_key: string
      config_name?: string
      server_url?: string
    }>
  }> {
    if (!this.mcprouter) throw new Error('McpRouterManager not available')
    const data = await this.mcprouter.listServers(page, limit)
    return { servers: data && data.servers ? data.servers : [] }
  }

  async installMcpRouterServer(serverKey: string): Promise<boolean> {
    if (!this.mcprouter) throw new Error('McpRouterManager not available')
    return this.mcprouter.installServer(serverKey)
  }

  async getMcpRouterApiKey(): Promise<string> {
    return this.mcpSettings.getRouterApiKey()
  }

  async setMcpRouterApiKey(key: string): Promise<void> {
    this.mcpSettings.setRouterApiKey(key)
  }

  async isServerInstalled(source: string, sourceId: string): Promise<boolean> {
    const servers = await this.mcpSettings.getMcpServers()
    for (const config of Object.values(servers)) {
      if (config.source === source && config.sourceId === sourceId) {
        return true
      }
    }
    return false
  }

  async listInstalledServerIds(source: string, sourceIds: string[]): Promise<string[]> {
    const requestedIds = new Set(sourceIds)
    if (requestedIds.size === 0) return []

    const installedIds = new Set<string>()
    const servers = await this.mcpSettings.getMcpServers()
    for (const config of Object.values(servers)) {
      if (config.source === source && config.sourceId && requestedIds.has(config.sourceId)) {
        installedIds.add(config.sourceId)
      }
    }
    return [...installedIds]
  }

  async updateMcpRouterServersAuth(apiKey: string): Promise<void> {
    const servers = await this.mcpSettings.getMcpServers()
    const updates: Array<{ name: string; config: Partial<MCPServerConfig> }> = []

    for (const [serverName, config] of Object.entries(servers)) {
      if (config.source === 'mcprouter' && config.customHeaders) {
        const updatedHeaders = {
          ...config.customHeaders,
          Authorization: `Bearer ${apiKey}`
        }
        updates.push({
          name: serverName,
          config: { customHeaders: updatedHeaders }
        })
      }
    }

    // Batch update Authorization for all servers
    for (const update of updates) {
      await this.mcpSettings.updateMcpServer(update.name, update.config)
    }

    logger.info(`Updated Authorization for ${updates.length} mcprouter servers`)
  }

  private scheduleBackgroundRegistryUpdate(): void {
    if (this.isPrivacyModeEnabled()) {
      return
    }

    setTimeout(async () => {
      if (this.isPrivacyModeEnabled()) {
        return
      }

      try {
        await this.serverManager.updateNpmRegistryInBackground()
      } catch (error) {
        console.error('[MCP] Background registry update failed:', error)
      }
    }, 5000)
  }

  // Add method to get initialization status
  isReady(): boolean {
    return this.isInitialized
  }

  // Get MCP server configuration
  getMcpServers(): Promise<Record<string, MCPServerConfig>> {
    return this.mcpSettings.getMcpServers()
  }

  // Get all MCP servers
  async getMcpClients(): Promise<McpClient[]> {
    const enabled = await this.mcpSettings.getMcpEnabled()
    const servers = await this.mcpSettings.getMcpServers()
    const clients = (await this.toolManager.getRunningClients()).filter(
      (client) => enabled || this.isPluginOwnedServerConfig(servers[client.serverName])
    )
    const clientsList: McpClient[] = []
    for (const client of clients) {
      const results: MCPToolDefinition[] = []
      const tools = await client.listTools()
      for (const tool of tools) {
        const properties = tool.inputSchema.properties || {}
        const toolProperties = { ...properties }
        for (const key in toolProperties) {
          if (!toolProperties[key].description) {
            toolProperties[key].description = 'Params of ' + key
          }
        }
        results.push({
          execution: TOOL_EXECUTION.write,
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: {
              type: 'object',
              properties: toolProperties,
              required: Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : []
            }
          },
          server: {
            name: client.serverName,
            icons: client.serverConfig['icons'] as string,
            description: client.serverConfig['description'] as string
          }
        })
      }

      // Create client basic info object
      const clientObj: McpClient = {
        name: client.serverName,
        icon: client.serverConfig['icons'] as string,
        isRunning: client.isServerRunning(),
        tools: results
      }

      // Check and add prompts (if supported)
      if (typeof client.listPrompts === 'function') {
        try {
          const prompts = await client.listPrompts()
          if (prompts && prompts.length > 0) {
            clientObj.prompts = prompts.map((prompt) => ({
              id: prompt.name,
              name: prompt.name,
              content: prompt.description || '',
              description: prompt.description || '',
              arguments: prompt.arguments || [],
              client: {
                name: client.serverName,
                icon: client.serverConfig['icons'] as string
              }
            }))
          }
        } catch (error) {
          console.error(
            `[MCP] Failed to get prompt templates for client ${client.serverName}:`,
            error
          )
        }
      }

      // Check and add resources (if supported)
      if (typeof client.listResources === 'function') {
        try {
          const resources = await client.listResources()
          if (resources && resources.length > 0) {
            clientObj.resources = resources
          }
        } catch (error) {
          console.error(`[MCP] Failed to get resources for client ${client.serverName}:`, error)
        }
      }

      clientsList.push(clientObj)
    }
    return clientsList
  }

  getEnabledMcpServers(): Promise<string[]> {
    return this.mcpSettings.getEnabledMcpServers()
  }

  async setMcpServerEnabled(serverName: string, enabled: boolean): Promise<void> {
    await this.mcpSettings.setMcpServerEnabled(serverName, enabled)

    const servers = await this.mcpSettings.getMcpServers()
    const serverConfig = servers[serverName]
    if (
      !this.isPluginOwnedServerConfig(serverConfig) &&
      !(await this.mcpSettings.getMcpEnabled())
    ) {
      return
    }

    if (enabled) {
      await this.startServer(serverName)
      return
    }

    await this.stopServer(serverName)
  }

  // Add MCP server
  async addMcpServer(serverName: string, config: MCPServerConfig): Promise<boolean> {
    const existingServers = await this.getMcpServers()
    if (existingServers[serverName]) {
      console.error(`[MCP] Failed to add server: Server name "${serverName}" already exists.`)
      // Get current language and send notification
      const locale = this.locale.getLanguage() || 'zh-CN'
      const errorMessages = getErrorMessageLabels(locale)
      this.publishEvent('notification.error', {
        title: errorMessages.addMcpServerErrorTitle || 'Failed to add server',
        message:
          errorMessages.addMcpServerDuplicateMessage?.replace('{serverName}', serverName) ||
          `Server name "${serverName}" already exists. Please choose a different name.`,
        id: `mcp-error-add-server-${serverName}-${Date.now()}`,
        type: 'error'
      })
      return false
    }
    await this.mcpSettings.addMcpServer(serverName, config)
    return true
  }

  // Update MCP server configuration
  async updateMcpServer(serverName: string, config: Partial<MCPServerConfig>): Promise<void> {
    const wasRunning = this.serverManager.isServerRunning(serverName)
    await this.mcpSettings.updateMcpServer(serverName, config)

    // If server was previously running, restart it to apply new configuration
    if (wasRunning) {
      logger.info(`[MCP] Configuration updated, restarting server: ${serverName}`)
      try {
        await this.stopServer(serverName) // stopServer will emit SERVER_STOPPED event
        await this.startServer(serverName) // startServer will emit SERVER_STARTED event
        logger.info(`[MCP] Server ${serverName} restarted successfully`)
      } catch (error) {
        console.error(`[MCP] Failed to restart server ${serverName}:`, error)
        // Even if restart fails, ensure correct state by marking as not running
        this.emitServerStopped(serverName)
      }
    }
  }

  // Remove MCP server
  async removeMcpServer(serverName: string): Promise<void> {
    // If server is running, stop it first
    if (await this.isServerRunning(serverName)) {
      await this.stopServer(serverName)
    }
    const servers = await this.mcpSettings.getMcpServers()
    this.mcpOAuthManager.logout(serverName, servers[serverName])
    await this.mcpSettings.removeMcpServer(serverName)
  }

  async isServerRunning(serverName: string): Promise<boolean> {
    return Promise.resolve(this.serverManager.isServerRunning(serverName))
  }

  async isServerActive(serverName: string): Promise<boolean> {
    return Promise.resolve(this.serverManager.isServerActive(serverName))
  }

  async startServer(serverName: string): Promise<void> {
    const connectResult = await this.serverManager.startServer(serverName, {
      onBackgroundConnected: () => this.emitServerStarted(serverName)
    })
    if (connectResult === 'connected') {
      this.emitServerStarted(serverName)
    }
  }

  async stopServer(serverName: string): Promise<void> {
    await this.serverManager.stopServer(serverName)
    this.emitServerStopped(serverName)
  }

  getServerLastError(serverName: string): string | undefined {
    return this.serverManager.getServerLastError(serverName)
  }

  async getMcpServerAuthStatus(serverName: string): Promise<McpServerAuthStatus> {
    const servers = await this.mcpSettings.getMcpServers()
    return this.mcpOAuthManager.getStatus(serverName, servers[serverName])
  }

  async startMcpServerAuth(serverName: string): Promise<McpServerAuthStatus> {
    const servers = await this.mcpSettings.getMcpServers()
    const serverConfig = servers[serverName]
    if (!serverConfig) {
      throw new Error(`MCP server ${serverName} not found`)
    }
    return this.mcpOAuthManager.startAuth(serverName, serverConfig)
  }

  async completeMcpServerAuthFromCallbackUrl(
    serverName: string,
    callbackUrl: string
  ): Promise<McpServerAuthStatus> {
    const servers = await this.mcpSettings.getMcpServers()
    const serverConfig = servers[serverName]
    if (!serverConfig) {
      throw new Error(`MCP server ${serverName} not found`)
    }
    return this.mcpOAuthManager.completeAuthFromCallbackUrl(serverName, serverConfig, callbackUrl)
  }

  async logoutMcpServerAuth(serverName: string): Promise<McpServerAuthStatus> {
    const servers = await this.mcpSettings.getMcpServers()
    return this.mcpOAuthManager.logout(serverName, servers[serverName])
  }

  async getAllToolDefinitions(
    enabledMcpTools?: string[] | McpToolAccessContext
  ): Promise<MCPToolDefinition[]> {
    const context = normalizeToolAccessContext(enabledMcpTools)
    const enabled = await this.mcpSettings.getMcpEnabled()
    const tools = await this.toolManager.getAllToolDefinitions(context)
    const servers = await this.mcpSettings.getMcpServers()
    return tools.filter((tool) => {
      const serverConfig = servers[tool.server.name]
      if (!enabled && !this.isPluginOwnedServerConfig(serverConfig)) {
        return false
      }
      return this.isServerAllowedByContext(tool.server.name, serverConfig, context)
    })
  }

  /**
   * 获取所有客户端的提示模板，并附加客户端信息
   * @returns 所有提示模板列表，每个提示模板附带所属客户端信息
   */
  async getAllPrompts(): Promise<Array<PromptListEntry>> {
    const enabled = await this.mcpSettings.getMcpEnabled()
    const servers = await this.mcpSettings.getMcpServers()
    const clients = (await this.toolManager.getRunningClients()).filter(
      (client) => enabled || this.isPluginOwnedServerConfig(servers[client.serverName])
    )
    const promptsList: Array<Prompt & { client: { name: string; icon: string } }> = []

    for (const client of clients) {
      if (typeof client.listPrompts === 'function') {
        try {
          const prompts = await client.listPrompts()
          if (prompts && prompts.length > 0) {
            // Add client information to each prompt template
            const clientPrompts = prompts.map((prompt) => ({
              id: prompt.name,
              name: prompt.name,
              description: prompt.description || '',
              arguments: prompt.arguments || [],
              files: prompt.files || [], // Add files field
              client: {
                name: client.serverName,
                icon: client.serverConfig['icons'] as string
              }
            }))
            promptsList.push(...clientPrompts)
          }
        } catch (error) {
          console.error(
            `[MCP] Failed to get prompt templates for client ${client.serverName}:`,
            error
          )
        }
      }
    }

    return promptsList
  }

  /**
   * 获取所有客户端的资源列表，并附加客户端信息
   * @returns 所有资源列表，每个资源附带所属客户端信息
   */
  async getAllResources(): Promise<
    Array<ResourceListEntry & { client: { name: string; icon: string } }>
  > {
    const enabled = await this.mcpSettings.getMcpEnabled()
    const servers = await this.mcpSettings.getMcpServers()
    const clients = (await this.toolManager.getRunningClients()).filter(
      (client) => enabled || this.isPluginOwnedServerConfig(servers[client.serverName])
    )
    const resourcesList: Array<ResourceListEntry & { client: { name: string; icon: string } }> = []

    for (const client of clients) {
      if (typeof client.listResources === 'function') {
        try {
          const resources = await client.listResources()
          if (resources && resources.length > 0) {
            // Add client information to each resource
            const clientResources = resources.map((resource) => ({
              ...resource,
              client: {
                name: client.serverName,
                icon: client.serverConfig['icons'] as string
              }
            }))
            resourcesList.push(...clientResources)
          }
        } catch (error) {
          console.error(`[MCP] Failed to get resources for client ${client.serverName}:`, error)
        }
      }
    }

    return resourcesList
  }

  async callTool(
    request: MCPToolCall,
    options?: {
      signal?: AbortSignal
      agentId?: string
      enabledServerIds?: string[]
      runId?: string
    }
  ): Promise<{ content: string; rawData: MCPToolResponse }> {
    const toolCallResult = await this.toolManager.callTool(request, options)
    options?.signal?.throwIfAborted()
    const imagePreviews = await extractToolCallImagePreviews({
      toolName: request.function.name,
      toolArgs: request.function.arguments,
      content: toolCallResult.content,
      cacheImage: this.cacheImage,
      signal: options?.signal
    })
    options?.signal?.throwIfAborted()

    // Format tool call results into strings that are easy for large models to parse
    let formattedContent = ''

    // Determine content type
    if (typeof toolCallResult.content === 'string') {
      // Content is already a string
      formattedContent = toolCallResult.content
    } else if (Array.isArray(toolCallResult.content)) {
      // Content is structured array, needs formatting
      const contentParts: string[] = []

      // Process each content item
      for (const item of toolCallResult.content) {
        if (item.type === 'text') {
          contentParts.push(item.text)
        } else if (item.type === 'image') {
          contentParts.push(`[Image: ${item.mimeType}]`)
        } else if (item.type === 'resource') {
          if ('text' in item.resource && item.resource.text) {
            contentParts.push(`[Resource: ${item.resource.uri}]\n${item.resource.text}`)
          } else if ('blob' in item.resource) {
            contentParts.push(`[Binary Resource: ${item.resource.uri}]`)
          } else {
            contentParts.push(`[Resource: ${item.resource.uri}]`)
          }
        } else {
          // Handle other unknown types
          contentParts.push(JSON.stringify(item))
        }
      }

      // Combine all content
      formattedContent = contentParts.join('\n\n')
    }

    // Add error marker (if any)
    if (toolCallResult.isError) {
      formattedContent = `Error: ${formattedContent}`
    }

    return {
      content: formattedContent,
      rawData: {
        ...toolCallResult,
        ...(imagePreviews.length > 0 ? { imagePreviews } : {})
      }
    }
  }

  /**
   * Pre-check tool permissions without executing the tool
   * Delegates to ToolManager for the actual permission check
   */
  async preCheckToolPermission(
    request: MCPToolCall,
    options?: {
      signal?: AbortSignal
      agentId?: string
      enabledServerIds?: string[]
    }
  ): Promise<{
    needsPermission: true
    toolName: string
    serverName: string
    permissionType: 'read' | 'write' | 'all' | 'command'
    description: string
    command?: string
    commandSignature?: string
    commandInfo?: {
      command: string
      riskLevel: 'low' | 'medium' | 'high' | 'critical'
      suggestion: string
      signature?: string
      baseCommand?: string
    }
  } | null> {
    return await this.toolManager.preCheckToolPermission(request, options)
  }

  async handleSamplingRequest(request: McpSamplingRequestPayload): Promise<McpSamplingDecision> {
    if (!request || !request.requestId) {
      throw new Error('Invalid sampling request: missing requestId')
    }

    return new Promise<McpSamplingDecision>((resolve, reject) => {
      try {
        this.pendingSamplingRequests.set(request.requestId, { resolve, reject })
        this.publishEvent('mcp.sampling.request', {
          request,
          version: Date.now()
        })
      } catch (error) {
        this.pendingSamplingRequests.delete(request.requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async submitSamplingDecision(decision: McpSamplingDecision): Promise<void> {
    if (!decision || !decision.requestId) {
      throw new Error('Invalid sampling decision: missing requestId')
    }

    const pending = this.pendingSamplingRequests.get(decision.requestId)
    if (!pending) {
      console.warn(
        `[MCP] Sampling request ${decision.requestId} not found when submitting decision`
      )
      return
    }

    this.pendingSamplingRequests.delete(decision.requestId)
    pending.resolve(decision)

    this.publishEvent('mcp.sampling.decision', {
      decision,
      version: Date.now()
    })
  }

  async cancelSamplingRequest(requestId: string, reason?: string): Promise<void> {
    if (!requestId) {
      return
    }

    const pending = this.pendingSamplingRequests.get(requestId)
    if (!pending) {
      return
    }

    this.pendingSamplingRequests.delete(requestId)
    pending.reject(new Error(reason ?? 'Sampling request cancelled'))

    this.publishEvent('mcp.sampling.cancelled', {
      requestId,
      reason: reason ?? 'cancelled',
      version: Date.now()
    })
  }

  // Get MCP enabled status
  async getMcpEnabled(): Promise<boolean> {
    return this.mcpSettings.getMcpEnabled()
  }

  // Set MCP enabled status
  async setMcpEnabled(enabled: boolean): Promise<void> {
    await this.mcpSettings.setMcpEnabled(enabled)

    if (enabled) {
      const servers = await this.mcpSettings.getMcpServers()
      const enabledServers = await this.mcpSettings.getEnabledMcpServers()
      for (const serverName of enabledServers) {
        if (this.isPluginOwnedServerConfig(servers[serverName])) {
          continue
        }
        try {
          await this.startServer(serverName)
        } catch (error) {
          console.error(`[MCP] Failed to start enabled server ${serverName}:`, error)
        }
      }
      return
    }

    const activeClients = await this.serverManager.getActiveClients()
    const servers = await this.mcpSettings.getMcpServers()
    for (const client of activeClients) {
      if (this.isPluginOwnedServerConfig(servers[client.serverName])) {
        continue
      }
      try {
        await this.stopServer(client.serverName)
      } catch (error) {
        console.error(`[MCP] Failed to stop server ${client.serverName}:`, error)
      }
    }
  }

  /**
   * Get specified prompt template
   * @param prompt Prompt template object (containing client information)
   * @param params Prompt template parameters
   * @returns Prompt template content
   */
  async getPrompt(prompt: PromptListEntry, args?: Record<string, unknown>): Promise<unknown> {
    // Check if this is a custom prompt from deepchat/custom-prompts-server
    if (prompt.client.name === 'deepchat/custom-prompts-server') {
      logger.info(`[MCP] Getting custom prompt: ${prompt.name}`)
      try {
        const customPrompts = await this.promptSettings.getCustomPrompts()
        const foundPrompt = customPrompts.find((p) => p.name === prompt.name)

        if (foundPrompt) {
          // Return the prompt in the expected format
          return {
            name: foundPrompt.name,
            description: foundPrompt.description,
            content: foundPrompt.content || '',
            messages: foundPrompt.messages || [],
            arguments: foundPrompt.parameters || []
          }
        } else {
          throw new Error(`Custom prompt "${prompt.name}" not found`)
        }
      } catch (error) {
        console.error(`[MCP] Failed to get custom prompt "${prompt.name}":`, error)
        throw error
      }
    }

    // For MCP server prompts, check if MCP is enabled
    const enabled = await this.mcpSettings.getMcpEnabled()
    if (!enabled && !(await this.isPluginOwnedServerName(prompt.client.name))) {
      throw new Error('MCP functionality is disabled')
    }

    // Pass client information and prompt template name to toolManager
    return this.toolManager.getPromptByClient(prompt.client.name, prompt.name, args)
  }

  /**
   * Read specified resource
   * @param resource Resource object (containing client information)
   * @returns Resource content
   */
  async readResource(resource: ResourceListEntry): Promise<Resource> {
    const enabled = await this.mcpSettings.getMcpEnabled()
    if (!enabled && !(await this.isPluginOwnedServerName(resource.client.name))) {
      throw new Error('MCP functionality is disabled')
    }

    // Pass client information and resource URI to toolManager
    return this.toolManager.readResourceByClient(resource.client.name, resource.uri)
  }

  async grantPermission(
    serverName: string,
    permissionType: 'read' | 'write' | 'all',
    remember: boolean = false,
    conversationId?: string
  ): Promise<void> {
    try {
      logger.info(
        `[MCP] Granting ${permissionType} permission for server: ${serverName}, remember: ${remember}, conversationId: ${conversationId}`
      )
      await this.toolManager.grantPermission(serverName, permissionType, remember, conversationId)
      logger.info(
        `[MCP] Successfully granted ${permissionType} permission for server: ${serverName}`
      )
    } catch (error) {
      console.error(`[MCP] Failed to grant permission for server ${serverName}:`, error)
      throw error
    }
  }

  clearSessionPermissions(conversationId: string): void {
    this.toolManager.clearSessionPermissions(conversationId)
  }

  async getNpmRegistryStatus(): Promise<{
    currentRegistry: string | null
    isFromCache: boolean
    lastChecked?: number
    autoDetectEnabled: boolean
    customRegistry?: string
  }> {
    const cache = this.mcpSettings.getNpmRegistryCache()
    const autoDetectEnabled = this.mcpSettings.getAutoDetectNpmRegistry()
    const customRegistry = this.mcpSettings.getCustomNpmRegistry()
    const currentRegistry = this.serverManager.getNpmRegistry()

    let isFromCache = false
    if (customRegistry && currentRegistry === customRegistry) {
      isFromCache = false
    } else if (cache && this.mcpSettings.isNpmRegistryCacheValid()) {
      isFromCache = currentRegistry === cache.registry
    }

    return {
      currentRegistry,
      isFromCache,
      lastChecked: cache?.lastChecked,
      autoDetectEnabled,
      customRegistry
    }
  }

  async refreshNpmRegistry(): Promise<string> {
    return await this.serverManager.refreshNpmRegistry()
  }

  async setCustomNpmRegistry(registry: string | undefined): Promise<void> {
    this.mcpSettings.setCustomNpmRegistry(registry)
    if (registry) {
      logger.info(`[MCP] Setting custom NPM registry: ${registry}`)
    } else {
      logger.info('[MCP] Clearing custom NPM registry')
    }
    this.serverManager.loadRegistryFromCache()
  }

  async setAutoDetectNpmRegistry(enabled: boolean): Promise<void> {
    this.mcpSettings.setAutoDetectNpmRegistry(enabled)
    if (enabled) {
      this.serverManager.loadRegistryFromCache()
    }
  }

  async clearNpmRegistryCache(): Promise<void> {
    this.mcpSettings.clearNpmRegistryCache()
    logger.info('[MCP] NPM Registry cache cleared')
  }

  // Get npm registry (for ACP and other internal use)
  getNpmRegistry(): string | null {
    return this.serverManager.getNpmRegistry()
  }

  // Get uv registry (for ACP and other internal use)
  getUvRegistry(): string | null {
    return this.serverManager.getUvRegistry()
  }
}
