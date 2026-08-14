import type { ProviderSettingsPort } from '@/provider/settings'
import logger from '@shared/logger'
import { performance } from 'node:perf_hooks'
import type { Prompt } from '@shared/types/prompt'
import {
  type McpElicitationDecision,
  type McpElicitationRequestPayload,
  type McpAppDescriptor,
  type McpClient,
  type McpCredentialBinding,
  type McpCredentialInput,
  type McpCredentialKind,
  type McpCredentialStatus,
  type McpEnterpriseIdentityProfile,
  type McpEnterpriseIdentityStatus,
  type McpExpectedToolTarget,
  type McpSamplingDecision,
  type McpSamplingRequestPayload,
  type MCPServerConfig,
  type McpAddServerResult,
  type McpServerAuthStatus,
  type McpServerDiagnostics,
  type McpServicePort,
  type McpAppHostPort,
  type MCPContentItem,
  type MCPToolCall,
  type MCPToolDefinition,
  type MCPToolResponse,
  type ToolDispatchCommit,
  type ToolOutcomeProjectionRegistrar,
  type PromptListEntry,
  type Resource,
  type ResourceListEntry
} from '@shared/types/mcp'
import type { ToolCallImagePreview } from '@shared/types/core/mcp'
import type { ProviderRuntimePort } from '@shared/types/provider'
import { ServerManager } from './serverManager'
import type { McpClient as RuntimeMcpClient } from './mcpClient'
import { ToolManager, type ComputerUsePreviewObserver } from './toolManager'
import { McpRouterManager } from './mcprouterManager'
import {
  AUTH_EXTENSION_CLIENT_CREDENTIALS,
  MCP_CLIENT_CREDENTIALS_DRAFT_REVISION,
  McpOAuthManager
} from './mcpOAuthManager'
import { prepareToolCallImageContent } from '@/lib/toolCallImagePreviews'
import type { InMemoryServerFactory } from './inMemoryServers/builder'
import type { PromptSettings } from '@/agent/promptSettings'
import type { PrivacySettingsPort } from '@/app/privacy'
import type { AgentSettingsPort } from '@/agent/settings'
import { PluginRuntimeSupervisor } from '@/plugin/runtimeSupervisor'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import type { SemanticNotificationPublisher } from '@/notifications'
import { McpSettings } from './settings'
import type { PermissionMode } from '@shared/types/agent-interface'
import type { ToolPermissionBroker } from '@/tool/permission'
import type { McpAppSandboxRegistry } from './apps/sandboxRegistry'
import { McpAppHost } from './apps/appHost'
import { hasMcpIdentityBearingChange } from './serverIdentity'
import type { CacheImageOptions } from '@/platform/imageCache'
import { awaitWithAbort } from '@/lib/awaitWithAbort'

type McpToolAccessContext = {
  enabledTools?: string[]
  enabledServerIds?: string[]
  agentId?: string
  conversationId?: string
}

const MCP_SHUTDOWN_SERVER_TIMEOUT_MS = 10_000
const MCP_SHUTDOWN_CONCURRENCY = 4
const MCP_MAX_PENDING_INTERACTIONS = 64

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
  public readonly appHost: McpAppHostPort | null
  private serverManager: ServerManager
  private toolManager: ToolManager
  private mcpOAuthManager: McpOAuthManager
  private providerSettings: Pick<ProviderSettingsPort, 'getProviderModels' | 'getCustomModels'>
  private readonly promptSettings: Pick<PromptSettings, 'getCustomPrompts'>
  private readonly mcpSettings: McpSettings
  private readonly privacy: PrivacySettingsPort
  private isInitialized: boolean = false
  // McpRouter
  private mcprouter?: McpRouterManager
  private cacheImage?: (data: string, options?: CacheImageOptions) => Promise<string>
  private readonly onRegistryChanged: () => void
  private shutdownPromise: Promise<void> | null = null
  private addMcpServerTail: Promise<void> = Promise.resolve()
  private readonly pluginRuntimeSupervisor: PluginRuntimeSupervisor
  private readonly mcpAppSandboxRegistry?: McpAppSandboxRegistry
  private pendingSamplingRequests = new Map<
    string,
    { resolve: (decision: McpSamplingDecision) => void; reject: (error: Error) => void }
  >()
  private pendingElicitationRequests = new Map<
    string,
    { resolve: (decision: McpElicitationDecision) => void; reject: (error: Error) => void }
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
    mcpSettings: McpSettings,
    privacy: PrivacySettingsPort,
    inMemoryServerFactory: InMemoryServerFactory,
    providerRuntime: Pick<ProviderRuntimePort, 'generateCompletionStandalone'>,
    onRegistryChanged: () => void,
    semanticNotifications: SemanticNotificationPublisher,
    private readonly publishEvent: DeepchatEventPublisher,
    cacheImage?: (data: string, options?: CacheImageOptions) => Promise<string>,
    pluginRuntimeSupervisor?: PluginRuntimeSupervisor,
    computerUsePreviewObserver?: ComputerUsePreviewObserver,
    mcpApps?: {
      registry: McpAppSandboxRegistry
      permissionBroker: ToolPermissionBroker
      getPermissionMode(conversationId: string): Promise<PermissionMode>
      validateSource(input: {
        descriptor: McpAppDescriptor
        conversationId: string
        messageId: string
        blockId: string
        toolInput: Record<string, unknown>
      }): boolean
      persistModelContext(
        messageId: string,
        blockId: string,
        descriptor: McpAppDescriptor,
        toolInput: Record<string, unknown>,
        context: {
          content?: MCPContentItem[]
          structuredContent?: Record<string, unknown>
          approvedHash: string
        }
      ): boolean
    },
    private readonly onInitializationFailed: () => void = () => undefined
  ) {
    logger.info('Initializing MCP service')

    this.providerSettings = providerSettings
    this.promptSettings = promptSettings
    this.mcpSettings = mcpSettings
    this.privacy = privacy
    this.cacheImage = cacheImage
    this.onRegistryChanged = onRegistryChanged
    this.pluginRuntimeSupervisor = pluginRuntimeSupervisor ?? new PluginRuntimeSupervisor()
    this.mcpAppSandboxRegistry = mcpApps?.registry
    this.mcpOAuthManager = new McpOAuthManager(
      undefined,
      this.publishEvent,
      (serverName) => this.restartServerAfterAuthentication(serverName),
      this.mcpSettings,
      (serverId) => {
        this.revokeMcpAppsByServer(serverId)
        this.handleRegistryChanged()
      }
    )
    this.serverManager = new ServerManager(
      this.mcpSettings,
      this.privacy,
      inMemoryServerFactory,
      {
        sampling: this,
        elicitation: this,
        completion: providerRuntime,
        config: this.providerSettings
      },
      () => this.handleRegistryChanged(),
      semanticNotifications,
      this.publishEvent,
      this.mcpOAuthManager
    )
    this.toolManager = new ToolManager(
      agentSettings,
      this.mcpSettings,
      this.serverManager,
      semanticNotifications,
      this.publishEvent,
      {
        ownsServer: (serverName) => this.pluginRuntimeSupervisor.ownsServer(serverName),
        isServerAvailable: (serverName) =>
          this.pluginRuntimeSupervisor.isServerAvailable(serverName),
        getOwnerPluginId: (serverName) => this.pluginRuntimeSupervisor.getOwnerPluginId(serverName),
        getAvailableToolCatalogs: () => this.pluginRuntimeSupervisor.getAvailableToolCatalogs(),
        getAvailableToolServerNames: () =>
          this.pluginRuntimeSupervisor.getAvailableToolServerNames(),
        ensureRunning: (serverName, reason) =>
          this.pluginRuntimeSupervisor.ensureRunning(serverName, reason)
      },
      computerUsePreviewObserver
    )
    this.appHost = mcpApps
      ? new McpAppHost({
          settings: this.mcpSettings,
          serverManager: this.serverManager,
          permissionBroker: mcpApps.permissionBroker,
          registry: mcpApps.registry,
          ensureServerRunning: async (serverName) => {
            if (this.pluginRuntimeSupervisor.ownsServer(serverName)) {
              await this.pluginRuntimeSupervisor.ensureRunning(serverName, 'external')
              return
            }
            await this.serverManager.startServer(serverName, { waitForConnection: true })
          },
          getPermissionMode: mcpApps.getPermissionMode,
          validateSource: mcpApps.validateSource,
          persistModelContext: mcpApps.persistModelContext
        })
      : null
    this.pluginRuntimeSupervisor.attachProcessPort({
      isReady: () => this.isReady(),
      isRunning: (serverName) => this.serverManager.isServerRunning(serverName),
      isActive: (serverName) => this.serverManager.isServerActive(serverName),
      start: (serverName, configOverride) =>
        this.startServerDirect(serverName, configOverride, true),
      stop: (serverName, mode) =>
        mode === 'shutdown'
          ? this.stopPluginServerDuringShutdownDirect(serverName)
          : this.stopServerDirect(serverName)
    })
    this.pluginRuntimeSupervisor.subscribeRegistryChanged(() => this.handleRegistryChanged())
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

  revokeMcpAppsByServer(serverId: string): void {
    this.mcpAppSandboxRegistry?.revokeByServer(serverId)
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
    if (this.pluginRuntimeSupervisor.ownsServer(serverName)) {
      return true
    }
    const servers = await this.mcpSettings.getMcpServers()
    return this.isPluginOwnedServerConfig(servers[serverName])
  }

  private isServerAllowedByContext(serverName: string, context: McpToolAccessContext): boolean {
    if (this.pluginRuntimeSupervisor.isServerAvailable(serverName)) {
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
            mcpEnabled &&
            !this.isPluginOwnedServerConfig(serverConfig) &&
            !this.pluginRuntimeSupervisor.ownsServer(serverName)
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
      try {
        this.onInitializationFailed()
      } catch {
        // Diagnostics must not alter MCP initialization compatibility.
      }
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
    for (const requestId of this.pendingSamplingRequests.keys()) {
      await this.cancelSamplingRequest(requestId, 'MCP service is shutting down')
    }
    for (const requestId of this.pendingElicitationRequests.keys()) {
      await this.cancelElicitationRequest(requestId, 'MCP service is shutting down')
    }

    try {
      await this.pluginRuntimeSupervisor.shutdown()
    } catch (error) {
      console.error('[MCP] Failed to stop plugin-owned runtimes during shutdown:', error)
    }

    const activeClients = (await this.serverManager.getActiveClients()).filter(
      (client) => !this.pluginRuntimeSupervisor.ownsServer(client.serverName)
    )
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
    if (this.pluginRuntimeSupervisor.ownsServer(serverName)) {
      await this.pluginRuntimeSupervisor.requestExternalStop(serverName)
      return
    }
    const client = this.serverManager.getClient(serverName)
    if (!client) {
      return
    }

    await this.stopServerDuringShutdown(client)
  }

  private async stopPluginServerDuringShutdownDirect(serverName: string): Promise<void> {
    const client = this.serverManager.getClient(serverName)
    if (!client) {
      return
    }
    await this.stopServerDuringShutdown(client, true)
  }

  private async stopServerDuringShutdown(
    client: RuntimeMcpClient,
    failOnIncompleteStop = false
  ): Promise<void> {
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
      await Promise.race([this.stopServerDirect(client.serverName), timeoutPromise])
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
        if (failOnIncompleteStop && !forceTerminated) {
          throw new Error(
            `Plugin runtime server ${client.serverName} could not be terminated during shutdown`
          )
        }
        return
      }

      console.error(`[MCP] Failed to stop server ${client.serverName} during shutdown:`, error)
      if (failOnIncompleteStop) {
        throw error
      }
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }

  private async restartServerAfterAuthentication(serverName: string): Promise<void> {
    try {
      if (await this.pluginRuntimeSupervisor.restartIfRunning(serverName, 'authentication')) {
        return
      }
      const servers = await this.mcpSettings.getMcpServers()
      const serverConfig = servers[serverName]
      if (this.isPluginOwnedServerConfig(serverConfig)) {
        console.warn(
          `[MCP] Refusing to restart unregistered plugin-owned server ${serverName} after authentication`
        )
        return
      }
      if (!serverConfig?.enabled) {
        return
      }

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
    const normalizedApiKey = key.trim()
    await this.synchronizeMcpRouterServersAuth(normalizedApiKey)
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

  private async synchronizeMcpRouterServersAuth(normalizedApiKey: string): Promise<void> {
    const currentApiKey = this.mcpSettings.getRouterApiKey()
    const servers = await this.mcpSettings.getMcpServers()
    let updatedServerCount = 0
    const invalidatedServerIds = new Set<string>()

    for (const [serverName, config] of Object.entries(servers)) {
      if (config.source !== 'mcprouter') {
        continue
      }

      const updatedHeaders = { ...config.customHeaders }
      const authorizationHeaderNames = Object.keys(updatedHeaders).filter(
        (name) => name.toLowerCase() === 'authorization'
      )
      const expectedAuthorization = normalizedApiKey ? `Bearer ${normalizedApiKey}` : undefined
      const alreadySynchronized = expectedAuthorization
        ? authorizationHeaderNames.length === 1 &&
          authorizationHeaderNames[0] === 'Authorization' &&
          updatedHeaders.Authorization === expectedAuthorization
        : authorizationHeaderNames.length === 0

      if (alreadySynchronized) {
        continue
      }

      for (const name of authorizationHeaderNames) {
        delete updatedHeaders[name]
      }
      if (expectedAuthorization) {
        updatedHeaders.Authorization = expectedAuthorization
      }

      servers[serverName] = {
        ...config,
        customHeaders: updatedHeaders
      }
      if (config.serverId) {
        invalidatedServerIds.add(config.serverId)
      }
      updatedServerCount += 1
    }

    if (currentApiKey === normalizedApiKey && updatedServerCount === 0) {
      return
    }

    for (const serverId of invalidatedServerIds) {
      this.revokeMcpAppsByServer(serverId)
    }

    this.mcpSettings.setRouterApiKeyAndServers(
      normalizedApiKey,
      updatedServerCount > 0 ? servers : undefined
    )
    for (const serverId of invalidatedServerIds) {
      this.mcpOAuthManager.clearServerCredentials(serverId)
    }
    logger.info(`Synchronized Authorization for ${updatedServerCount} mcprouter servers`)
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
    const clients = (await this.toolManager.getRunningClients()).filter(
      (client) => enabled || this.pluginRuntimeSupervisor.isServerAvailable(client.serverName)
    )
    const toolDefinitions = await this.toolManager.getAllToolDefinitions()
    const clientsList: McpClient[] = []
    for (const client of clients) {
      const results = toolDefinitions.filter(
        (definition) => definition.server.name === client.serverName
      )

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
    const servers = await this.mcpSettings.getMcpServers()
    const serverConfig = servers[serverName]
    if (this.pluginRuntimeSupervisor.ownsServer(serverName)) {
      throw new Error(
        `Plugin-owned MCP server "${serverName}" is controlled by its plugin, not MCP settings`
      )
    }
    if (this.isPluginOwnedServerConfig(serverConfig)) {
      throw new Error(
        `Plugin-owned MCP server "${serverName}" is not registered by an enabled plugin`
      )
    }

    if (!enabled && serverConfig?.serverId) {
      this.revokeMcpAppsByServer(serverConfig.serverId)
    }
    await this.mcpSettings.setMcpServerEnabled(serverName, enabled)
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
  async addMcpServer(serverName: string, config: MCPServerConfig): Promise<McpAddServerResult> {
    const result = this.addMcpServerTail.then(() => this.addMcpServerOnce(serverName, config))
    this.addMcpServerTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private async addMcpServerOnce(
    serverName: string,
    config: MCPServerConfig
  ): Promise<McpAddServerResult> {
    if (this.pluginRuntimeSupervisor.ownsServer(serverName)) {
      throw new Error(`MCP server "${serverName}" is owned by an enabled plugin`)
    }
    const existingServers = await this.getMcpServers()
    if (existingServers[serverName]) {
      return { status: 'duplicate' }
    }
    await this.mcpSettings.addMcpServer(serverName, config)
    return { status: 'added' }
  }

  // Update MCP server configuration
  async updateMcpServer(serverName: string, config: Partial<MCPServerConfig>): Promise<void> {
    const servers = await this.mcpSettings.getMcpServers()
    if (
      this.pluginRuntimeSupervisor.ownsServer(serverName) ||
      this.isPluginOwnedServerConfig(servers[serverName])
    ) {
      throw new Error(
        `Plugin-owned MCP server "${serverName}" cannot be edited through MCP settings`
      )
    }
    const wasRunning = this.serverManager.isServerRunning(serverName)
    const previousConfig = servers[serverName]
    if (
      previousConfig?.serverId &&
      (config.enabled === false ||
        hasMcpIdentityBearingChange(previousConfig, { ...previousConfig, ...config }))
    ) {
      this.revokeMcpAppsByServer(previousConfig.serverId)
    }
    await this.mcpSettings.updateMcpServer(serverName, config)
    const updatedConfig = (await this.mcpSettings.getMcpServers())[serverName]
    if (
      previousConfig?.serverId &&
      updatedConfig?.configGeneration !== previousConfig.configGeneration
    ) {
      this.mcpOAuthManager.clearServerCredentials(previousConfig.serverId)
    }

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
    const currentServers = await this.mcpSettings.getMcpServers()
    if (
      this.pluginRuntimeSupervisor.ownsServer(serverName) ||
      this.isPluginOwnedServerConfig(currentServers[serverName])
    ) {
      throw new Error(`Plugin-owned MCP server "${serverName}" must be removed by its plugin`)
    }
    const serverId = currentServers[serverName]?.serverId
    if (serverId) {
      this.revokeMcpAppsByServer(serverId)
    }
    // If server is running, stop it first
    if (await this.isServerRunning(serverName)) {
      await this.stopServer(serverName)
    }
    const servers = await this.mcpSettings.getMcpServers()
    const persistedServerId = servers[serverName]?.serverId
    if (persistedServerId) {
      this.mcpOAuthManager.clearServerCredentials(persistedServerId)
    }
    await this.mcpSettings.removeMcpServer(serverName)
  }

  async isServerRunning(serverName: string): Promise<boolean> {
    return Promise.resolve(this.serverManager.isServerRunning(serverName))
  }

  async isServerActive(serverName: string): Promise<boolean> {
    return Promise.resolve(this.serverManager.isServerActive(serverName))
  }

  async startServer(serverName: string): Promise<void> {
    if (this.pluginRuntimeSupervisor.ownsServer(serverName)) {
      throw new Error(
        `Plugin-owned MCP server "${serverName}" cannot be started through the generic MCP route`
      )
    }
    if (await this.isPluginOwnedServerName(serverName)) {
      throw new Error(
        `Plugin-owned MCP server "${serverName}" is not registered by an enabled plugin`
      )
    }
    await this.startServerDirect(serverName)
  }

  private async startServerDirect(
    serverName: string,
    configOverride?: Partial<MCPServerConfig>,
    waitForConnection = false
  ): Promise<void> {
    const connectResult = await this.serverManager.startServer(serverName, {
      onBackgroundConnected: waitForConnection
        ? undefined
        : () => this.emitServerStarted(serverName),
      configOverride,
      waitForConnection
    })
    if (connectResult === 'connected') {
      this.emitServerStarted(serverName)
      return
    }
    if (connectResult === 'stopped' && waitForConnection) {
      throw new Error(`Plugin runtime server "${serverName}" stopped during startup`)
    }
  }

  async stopServer(serverName: string): Promise<void> {
    if (this.pluginRuntimeSupervisor.ownsServer(serverName)) {
      throw new Error(
        `Plugin-owned MCP server "${serverName}" cannot be stopped through the generic MCP route`
      )
    }
    if (await this.isPluginOwnedServerName(serverName)) {
      throw new Error(
        `Plugin-owned MCP server "${serverName}" is not registered by an enabled plugin`
      )
    }
    await this.stopServerDirect(serverName)
  }

  private async stopServerDirect(serverName: string): Promise<void> {
    await this.serverManager.stopServer(serverName)
    this.emitServerStopped(serverName)
  }

  getServerLastError(serverName: string): string | undefined {
    return this.serverManager.getServerLastError(serverName)
  }

  async getMcpServerAuthStatus(serverId: string): Promise<McpServerAuthStatus> {
    const { name, config } = await this.requireServerById(serverId)
    return this.mcpOAuthManager.getStatus(name, config)
  }

  async startMcpServerAuth(serverId: string): Promise<McpServerAuthStatus> {
    const { name, config } = await this.requireServerById(serverId)
    return this.mcpOAuthManager.startAuth(name, config)
  }

  async completeMcpServerAuthFromCallbackUrl(
    serverId: string,
    callbackUrl: string
  ): Promise<McpServerAuthStatus> {
    const { name, config } = await this.requireServerById(serverId)
    return this.mcpOAuthManager.completeAuthFromCallbackUrl(name, config, callbackUrl)
  }

  async logoutMcpServerAuth(serverId: string): Promise<McpServerAuthStatus> {
    const { name, config } = await this.requireServerById(serverId)
    return this.mcpOAuthManager.logout(name, config)
  }

  async getMcpCredentialStatus(serverId: string): Promise<McpCredentialStatus[]> {
    const { config } = await this.requireServerById(serverId)
    return this.mcpOAuthManager.getCredentialStatuses(config)
  }

  async setMcpCredential(
    binding: McpCredentialBinding,
    credential: McpCredentialInput
  ): Promise<McpCredentialStatus> {
    const { name, config } = await this.requireCurrentCredentialBinding(binding)
    const expectedKind: McpCredentialKind =
      config.authorization?.mode === 'private_key_jwt'
        ? 'private_key'
        : config.authorization?.mode === 'cross_app_access'
          ? 'enterprise_resource_secret'
          : 'client_secret'
    if (credential.kind !== expectedKind) {
      throw new Error('MCP credential type does not match the selected authorization mode')
    }
    if (
      credential.kind === 'private_key' &&
      config.authorization?.keyAlgorithm !== credential.algorithm
    ) {
      throw new Error('MCP private key algorithm does not match the server configuration')
    }
    const status = this.mcpOAuthManager.setCredential(binding, credential)
    await this.restartServerAfterAuthentication(name)
    return status
  }

  async removeMcpCredential(
    binding: McpCredentialBinding,
    kind: McpCredentialKind
  ): Promise<McpCredentialStatus> {
    const { name } = await this.requireCurrentCredentialBinding(binding)
    const status = this.mcpOAuthManager.removeCredential(binding, kind)
    if (this.serverManager.isServerRunning(name)) {
      await this.stopServer(name)
    }
    return status
  }

  listMcpEnterpriseProfiles(): Promise<McpEnterpriseIdentityProfile[]> {
    return Promise.resolve(this.mcpOAuthManager.listEnterpriseProfiles())
  }

  saveMcpEnterpriseProfile(
    profile: McpEnterpriseIdentityProfile
  ): Promise<McpEnterpriseIdentityProfile> {
    return Promise.resolve(this.mcpOAuthManager.saveEnterpriseProfile(profile))
  }

  async removeMcpEnterpriseProfile(profileId: string): Promise<void> {
    const servers = await this.mcpSettings.getMcpServers()
    for (const [serverName, config] of Object.entries(servers)) {
      if (config.authorization?.identityProfileId !== profileId) {
        continue
      }
      if (config.serverId) {
        this.mcpOAuthManager.clearServerCredentials(config.serverId)
      }
      await this.updateMcpServer(serverName, {
        authorization: { mode: 'interactive' }
      })
    }
    this.mcpOAuthManager.removeEnterpriseProfile(profileId)
  }

  setMcpEnterpriseProfileClientSecret(
    profileId: string,
    secret: string
  ): Promise<McpEnterpriseIdentityStatus> {
    return Promise.resolve(this.mcpOAuthManager.setEnterpriseProfileClientSecret(profileId, secret))
  }

  getMcpEnterpriseProfileStatus(profileId: string): Promise<McpEnterpriseIdentityStatus> {
    return Promise.resolve(this.mcpOAuthManager.getEnterpriseProfileStatus(profileId))
  }

  startMcpEnterpriseProfileAuth(profileId: string): Promise<McpEnterpriseIdentityStatus> {
    return this.mcpOAuthManager.startEnterpriseProfileAuth(profileId)
  }

  completeMcpEnterpriseProfileAuthFromCallbackUrl(
    profileId: string,
    callbackUrl: string
  ): Promise<McpEnterpriseIdentityStatus> {
    return this.mcpOAuthManager.completeEnterpriseProfileAuthFromCallbackUrl(profileId, callbackUrl)
  }

  logoutMcpEnterpriseProfile(profileId: string): Promise<McpEnterpriseIdentityStatus> {
    return Promise.resolve(this.mcpOAuthManager.logoutEnterpriseProfile(profileId))
  }

  private async requireServerById(
    serverId: string
  ): Promise<{ name: string; config: MCPServerConfig }> {
    const servers = await this.mcpSettings.getMcpServers()
    const match = Object.entries(servers).find(([, config]) => config.serverId === serverId)
    if (!match) {
      throw new Error('MCP server identity was not found')
    }
    return { name: match[0], config: match[1] }
  }

  private async requireCurrentCredentialBinding(
    binding: McpCredentialBinding
  ): Promise<{ name: string; config: MCPServerConfig }> {
    const match = await this.requireServerById(binding.serverId)
    const config = match.config
    if (
      config.configGeneration !== binding.configGeneration ||
      config.bindingHash !== binding.bindingHash ||
      config.baseUrl !== binding.endpoint ||
      config.authorization?.protectedResourceUrl !== binding.protectedResourceUrl ||
      config.authorization?.authorizationServerIssuer !== binding.authorizationServerIssuer ||
      config.authorization?.clientId !== binding.clientId
    ) {
      throw new Error('MCP credential binding is stale')
    }
    return match
  }

  async getServerDiagnostics(serverId: string): Promise<McpServerDiagnostics> {
    const { name: serverName, config } = await this.requireServerById(serverId)
    const auth = this.mcpOAuthManager.getStatus(serverName, config)
    const client = this.serverManager.getClient(serverName)
    if (client) {
      return client.getDiagnostics(auth)
    }

    let authorizationExtensions: string[] = []
    try {
      authorizationExtensions = this.mcpOAuthManager.getUsableAuthorizationExtensions(config)
    } catch {
      authorizationExtensions = []
    }
    return {
      serverId,
      serverName,
      owner: config.ownerPluginId ? 'plugin' : 'deepchat',
      transport: config.type,
      connectionState: 'stopped',
      era: 'unknown',
      probe: { outcome: 'not-run' },
      extensions: [],
      clientExtensions: [
        { id: 'io.modelcontextprotocol/ui' },
        ...authorizationExtensions.map((id) => ({
          id,
          ...(id === AUTH_EXTENSION_CLIENT_CREDENTIALS
            ? { revision: MCP_CLIENT_CREDENTIALS_DRAFT_REVISION }
            : {})
        }))
      ],
      cacheState: 'unknown',
      subscriptions: [],
      auth: {
        state: auth.state,
        persistent: auth.persistent,
        mode: auth.mode
      },
      updatedAt: Date.now()
    }
  }

  async getAllToolDefinitions(
    enabledMcpTools?: string[] | McpToolAccessContext
  ): Promise<MCPToolDefinition[]> {
    const context = normalizeToolAccessContext(enabledMcpTools)
    const enabled = await this.mcpSettings.getMcpEnabled()
    const tools = await this.toolManager.getAllToolDefinitions(context)
    return tools.filter((tool) => {
      if (!enabled && !this.pluginRuntimeSupervisor.isServerAvailable(tool.server.name)) {
        return false
      }
      return this.isServerAllowedByContext(tool.server.name, context)
    })
  }

  async snapshotCachedToolDefinitions(
    enabledMcpTools?: string[] | McpToolAccessContext
  ): Promise<import('@shared/types/mcp').McpToolDefinitionsSnapshot> {
    const context = normalizeToolAccessContext(enabledMcpTools)
    const enabled = await this.mcpSettings.getMcpEnabled()
    const [configuredEnabledServerNames, serverConfigs] = enabled
      ? await Promise.all([
          this.mcpSettings.getEnabledMcpServers(),
          this.mcpSettings.getMcpServers()
        ])
      : [[], {}]
    const selectedServerNames = context.enabledServerIds ? new Set(context.enabledServerIds) : null
    const expectedServerNames = enabled
      ? configuredEnabledServerNames.filter(
          (serverName) =>
            (!selectedServerNames || selectedServerNames.has(serverName)) &&
            !this.isPluginOwnedServerConfig(serverConfigs[serverName]) &&
            !this.pluginRuntimeSupervisor.ownsServer(serverName)
        )
      : []
    return this.toolManager.snapshotCachedToolDefinitions({
      ...context,
      includeRegularServers: enabled,
      expectedServerNames
    })
  }

  /**
   * 获取所有客户端的提示模板，并附加客户端信息
   * @returns 所有提示模板列表，每个提示模板附带所属客户端信息
   */
  async getAllPrompts(): Promise<Array<PromptListEntry>> {
    const enabled = await this.mcpSettings.getMcpEnabled()
    const clients = (await this.toolManager.getRunningClients()).filter(
      (client) => enabled || this.pluginRuntimeSupervisor.isServerAvailable(client.serverName)
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
    const clients = (await this.toolManager.getRunningClients()).filter(
      (client) => enabled || this.pluginRuntimeSupervisor.isServerAvailable(client.serverName)
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
      expectedTarget?: McpExpectedToolTarget
      assertCurrentToolDefinition?: (definition: MCPToolDefinition) => void
      throwPreDispatchErrors?: boolean
      commitDispatch?: ToolDispatchCommit
      registerOutcomeProjection?: ToolOutcomeProjectionRegistrar
    }
  ): Promise<{ content: string; rawData: MCPToolResponse }> {
    let dispatchCommitted = false
    const toolCallResult = await this.toolManager.callTool(
      request,
      options?.commitDispatch
        ? {
            ...options,
            commitDispatch: (input) => {
              options.commitDispatch?.(input)
              dispatchCommitted = true
            }
          }
        : options
    )
    if (!dispatchCommitted) {
      options?.signal?.throwIfAborted()
    }
    let normalizedContent = toolCallResult.content
    let imagePreviews: ToolCallImagePreview[] = []

    if (!options?.signal?.aborted) {
      try {
        const serverName = request.server?.name
        const serverConfig = serverName
          ? (await awaitWithAbort(this.mcpSettings.getMcpServers(), options?.signal))[serverName]
          : undefined
        const allowPrivateNetwork =
          serverConfig?.type === 'stdio' ||
          serverConfig?.type === 'inmemory' ||
          Boolean(serverName && this.pluginRuntimeSupervisor.ownsServer(serverName))
        const cacheImage = this.cacheImage
        const preparedImages = await prepareToolCallImageContent({
          toolName: request.function.name,
          toolArgs: request.function.arguments,
          content: toolCallResult.content,
          cacheImage: cacheImage
            ? (data) =>
                cacheImage(data, {
                  signal: options?.signal,
                  allowPrivateNetwork
                })
            : undefined,
          signal: options?.signal
        })
        imagePreviews = preparedImages.imagePreviews
        normalizedContent = preparedImages.content
      } catch (error) {
        if (!dispatchCommitted || !options?.signal?.aborted) throw error
      }
    }

    // Format tool call results into strings that are easy for large models to parse
    let formattedContent = ''

    // Determine content type
    if (typeof normalizedContent === 'string') {
      // Content is already a string
      formattedContent = normalizedContent
    } else if (Array.isArray(normalizedContent)) {
      // Content is structured array, needs formatting
      const contentParts: string[] = []

      // Process each content item
      for (const item of normalizedContent) {
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

    if (!dispatchCommitted) {
      options?.signal?.throwIfAborted()
    }

    return {
      content: formattedContent,
      rawData: {
        ...toolCallResult,
        content: normalizedContent,
        ...(imagePreviews.length > 0 ? { imagePreviews } : {})
      }
    }
  }

  async checkPluginRuntimePermissions(serverName: string): Promise<unknown> {
    return await this.toolManager.checkPluginRuntimePermissions(serverName)
  }

  async handleSamplingRequest(request: McpSamplingRequestPayload): Promise<McpSamplingDecision> {
    if (!request || !request.requestId) {
      throw new Error('Invalid sampling request: missing requestId')
    }
    this.assertInteractionCapacity(request.requestId, 'sampling')

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

  async handleElicitationRequest(
    request: McpElicitationRequestPayload
  ): Promise<McpElicitationDecision> {
    if (!request?.requestId) {
      throw new Error('Invalid elicitation request: missing requestId')
    }
    this.assertInteractionCapacity(request.requestId, 'elicitation')

    return new Promise<McpElicitationDecision>((resolve, reject) => {
      this.pendingElicitationRequests.set(request.requestId, { resolve, reject })
      try {
        this.publishEvent('mcp.elicitation.request', {
          request,
          version: Date.now()
        })
      } catch (error) {
        this.pendingElicitationRequests.delete(request.requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async submitElicitationDecision(decision: McpElicitationDecision): Promise<void> {
    if (!decision?.requestId) {
      throw new Error('Invalid elicitation decision: missing requestId')
    }

    const pending = this.pendingElicitationRequests.get(decision.requestId)
    if (!pending) {
      console.warn(
        `[MCP] Elicitation request ${decision.requestId} not found when submitting decision`
      )
      return
    }

    this.pendingElicitationRequests.delete(decision.requestId)
    pending.resolve(decision)
    this.publishEvent('mcp.elicitation.decision', {
      decision,
      version: Date.now()
    })
  }

  async cancelElicitationRequest(requestId: string, reason?: string): Promise<void> {
    if (!requestId) {
      return
    }

    const pending = this.pendingElicitationRequests.get(requestId)
    if (!pending) {
      return
    }

    this.pendingElicitationRequests.delete(requestId)
    pending.reject(new Error(reason ?? 'Elicitation request cancelled'))
    this.publishEvent('mcp.elicitation.cancelled', {
      requestId,
      reason: reason ?? 'cancelled',
      version: Date.now()
    })
  }

  private assertInteractionCapacity(requestId: string, kind: 'sampling' | 'elicitation'): void {
    if (
      this.pendingSamplingRequests.has(requestId) ||
      this.pendingElicitationRequests.has(requestId)
    ) {
      throw new Error(`Duplicate MCP interaction request: ${requestId}`)
    }
    if (
      this.pendingSamplingRequests.size + this.pendingElicitationRequests.size >=
      MCP_MAX_PENDING_INTERACTIONS
    ) {
      throw new Error(`Too many pending MCP ${kind} requests`)
    }
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
        if (
          this.pluginRuntimeSupervisor.ownsServer(serverName) ||
          this.isPluginOwnedServerConfig(servers[serverName])
        ) {
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
      if (this.pluginRuntimeSupervisor.ownsServer(client.serverName)) {
        continue
      }
      try {
        if (this.isPluginOwnedServerConfig(servers[client.serverName])) {
          await this.stopServerDirect(client.serverName)
        } else {
          await this.stopServer(client.serverName)
        }
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
