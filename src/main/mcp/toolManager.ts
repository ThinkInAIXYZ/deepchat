import logger from '@shared/logger'
import {
  TOOL_EXECUTION,
  type MCPContentItem,
  type MCPTextContent,
  type MCPToolCall,
  type MCPToolDefinition,
  type MCPToolResponse,
  type Resource,
  type Tool
} from '@shared/types/mcp'
import type { AgentSettingsPort } from '@/agent/settings'
import { ServerManager } from './serverManager'
import { McpClient } from './mcpClient'
import { jsonrepair } from 'jsonrepair'
import { isDeepStrictEqual } from 'node:util'
import { getExplicitlyDeniedPluginTools, resolvePluginToolPolicy } from '@/plugin/toolPolicyStore'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import type { SemanticNotificationPublisher } from '@/notifications'
import { awaitWithAbort } from '@/lib/awaitWithAbort'
import type { McpSettings } from './settings'
import { CUA_PLUGIN_ID } from '@shared/types/plugin'
import { appendCuaResultProjections, normalizeCuaToolArguments } from '@/plugin/cuaToolAdapter'
import type {
  PluginOwnedToolCatalogRegistration,
  PluginRuntimeStartReason
} from '@/plugin/runtimeSupervisor'

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const PLUGIN_RUNTIME_DIAGNOSTIC_TIMEOUT_MS = 30_000
const TOOL_CATALOG_VALIDATION_TIMEOUT_MS = 30_000

type McpToolAccessContext = {
  enabledTools?: string[]
  enabledServerIds?: string[]
  agentId?: string
  conversationId?: string
}

export type ComputerUsePreviewCall = {
  conversationId: string
  runId: string
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  source: {
    serverName: string
    ownerPluginId?: string
  }
}

export type ComputerUsePreviewObserver = {
  shouldCaptureAfterClick?(call: ComputerUsePreviewCall): boolean
  started(call: ComputerUsePreviewCall): void
  completed(call: ComputerUsePreviewCall, result: MCPToolResponse): void
  failed(call: ComputerUsePreviewCall, error: unknown): void
}

type ActiveToolDefinitionsRefresh = {
  completion: Promise<void>
  settle: () => void
}

type PluginMcpOwnershipPort = {
  ownsServer(serverName: string): boolean
  isServerAvailable(serverName: string): boolean
  getOwnerPluginId(serverName: string): string | undefined
  getAvailableToolCatalogs(): PluginOwnedToolCatalogRegistration[]
  ensureRunning(serverName: string, reason: PluginRuntimeStartReason): Promise<void>
}

const NO_PLUGIN_OWNERSHIP: PluginMcpOwnershipPort = {
  ownsServer: () => false,
  isServerAvailable: () => false,
  getOwnerPluginId: () => undefined,
  getAvailableToolCatalogs: () => [],
  ensureRunning: async (serverName) => {
    throw new Error(`Plugin runtime server "${serverName}" is not registered`)
  }
}

type ToolSource = {
  serverName: string
  displayName: string
  icon: string
  tools: readonly Tool[]
  client?: McpClient
  catalogBacked: boolean
}

type ToolTarget = {
  serverName: string
  originalName: string
  client?: McpClient
  catalogBacked: boolean
  catalogTool?: Tool
}

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

export class ToolManager {
  private readonly agentSettings: Pick<AgentSettingsPort, 'getAcpAgents' | 'getAgentMcpSelections'>
  private readonly mcpSettings: McpSettings
  private serverManager: ServerManager
  private cachedToolDefinitions: MCPToolDefinition[] | null = null
  private toolNameToTargetMap: Map<string, ToolTarget> | null = null
  private catalogValidationPromises = new WeakMap<McpClient, Promise<Map<string, Tool>>>()
  private toolDefinitionsCacheGeneration = 0
  private activeToolDefinitionsRefresh: ActiveToolDefinitionsRefresh | null = null
  // Session-scoped permission cache. Ordinary MCP servers retain coarse
  // server/type grants; closed plugin policies use exact server/tool grants.
  private sessionPermissions = new Map<string, Set<string>>()

  constructor(
    agentSettings: Pick<AgentSettingsPort, 'getAcpAgents' | 'getAgentMcpSelections'>,
    mcpSettings: McpSettings,
    serverManager: ServerManager,
    private readonly semanticNotifications: SemanticNotificationPublisher,
    private readonly publishEvent: DeepchatEventPublisher,
    private readonly pluginOwnership: PluginMcpOwnershipPort = NO_PLUGIN_OWNERSHIP,
    private readonly computerUsePreviewObserver?: ComputerUsePreviewObserver
  ) {
    this.agentSettings = agentSettings
    this.mcpSettings = mcpSettings
    this.serverManager = serverManager
  }

  public invalidateRegistry(): void {
    console.info('MCP client list updated, clearing tool definitions cache and target map.')
    this.toolDefinitionsCacheGeneration += 1
    this.activeToolDefinitionsRefresh?.settle()
    this.activeToolDefinitionsRefresh = null
    this.cachedToolDefinitions = null
    this.toolNameToTargetMap = null
    this.catalogValidationPromises = new WeakMap()
  }

  private isPluginOwnedClient(client: McpClient): boolean {
    return this.pluginOwnership.ownsServer(client.serverName)
  }

  private isCuaComputerUseServer(client: McpClient): boolean {
    return (
      this.pluginOwnership.isServerAvailable(client.serverName) &&
      this.pluginOwnership.getOwnerPluginId(client.serverName) === CUA_PLUGIN_ID
    )
  }

  public async getRunningClients(): Promise<McpClient[]> {
    return this.serverManager.getRunningClients()
  }

  public async checkPluginRuntimePermissions(serverName: string): Promise<unknown> {
    if (!this.pluginOwnership.ownsServer(serverName)) {
      throw new Error(`MCP server "${serverName}" is not owned by a plugin runtime`)
    }
    if (!this.pluginOwnership.isServerAvailable(serverName)) {
      throw new Error(`Plugin runtime server "${serverName}" is not available`)
    }

    await this.pluginOwnership.ensureRunning(serverName, 'runtime-test')
    if (!this.pluginOwnership.isServerAvailable(serverName)) {
      throw new Error(`Plugin runtime server "${serverName}" is no longer available`)
    }
    const client = this.serverManager.getClient(serverName)
    if (!client) {
      throw new Error(`Plugin runtime server "${serverName}" has no running client`)
    }
    const signal = AbortSignal.timeout(PLUGIN_RUNTIME_DIAGNOSTIC_TIMEOUT_MS)
    const catalogTool = this.getCatalogTool(serverName, 'check_permissions')
    await this.verifyCatalogTool(client, catalogTool, signal)
    const result = await client.callTool('check_permissions', { prompt: false }, { signal })
    if (result.isError) {
      const detail = result.content
        ?.map((item) => item.text)
        .filter(Boolean)
        .join('; ')
      throw new Error(detail || `Plugin runtime server "${serverName}" permission check failed`)
    }
    return result
  }

  // Get all tool definitions
  public async getAllToolDefinitions(
    access?: string[] | McpToolAccessContext,
    options?: { signal?: AbortSignal }
  ): Promise<MCPToolDefinition[]> {
    options?.signal?.throwIfAborted()
    const context = normalizeToolAccessContext(access)
    if (this.cachedToolDefinitions !== null) {
      return this.filterToolDefinitionsByContext(this.cachedToolDefinitions, context)
    }

    const activeRefresh = this.activeToolDefinitionsRefresh
    if (activeRefresh) {
      await awaitWithAbort(activeRefresh.completion, options?.signal)
      return await this.getAllToolDefinitions(access, options)
    }

    let resolveRefresh = () => {}
    const refreshCompletion = new Promise<void>((resolve) => {
      resolveRefresh = resolve
    })
    const refresh: ActiveToolDefinitionsRefresh = {
      completion: refreshCompletion,
      settle: () => resolveRefresh()
    }
    this.activeToolDefinitionsRefresh = refresh

    try {
      const refreshGeneration = this.toolDefinitionsCacheGeneration
      console.info('Fetching/refreshing tool definitions and target map...')
      const clients = await awaitWithAbort(this.serverManager.getRunningClients(), options?.signal)
      const sources = await this.loadToolSources(clients ?? [], options?.signal)
      const results: MCPToolDefinition[] = []
      const nextToolNameToTargetMap = new Map<string, ToolTarget>()

      if (sources.length === 0) {
        console.warn('No live MCP tools or on-demand plugin tool catalogs found.')
      }

      const toolNameToServerMap: Map<string, string> = new Map()
      const toolsToRename: Map<string, Set<string>> = new Map()

      for (const source of sources) {
        const currentServerRenames = toolsToRename.get(source.serverName) ?? new Set<string>()
        for (const tool of source.tools) {
          const originalServerName = toolNameToServerMap.get(tool.name)
          if (originalServerName && originalServerName !== source.serverName) {
            console.warn(
              `Conflict detected for tool '${tool.name}' between server '${originalServerName}' and '${source.serverName}'. Marking for rename.`
            )
            const originalServerRenames = toolsToRename.get(originalServerName) ?? new Set()
            originalServerRenames.add(tool.name)
            toolsToRename.set(originalServerName, originalServerRenames)
            currentServerRenames.add(tool.name)
          } else if (!originalServerName) {
            toolNameToServerMap.set(tool.name, source.serverName)
          }
        }
        if (currentServerRenames.size > 0) {
          toolsToRename.set(source.serverName, currentServerRenames)
        }
      }

      for (const source of sources) {
        const renamesForThisServer = toolsToRename.get(source.serverName) ?? new Set()
        for (const tool of source.tools) {
          let finalName = tool.name
          let finalDescription = tool.description
          const originalName = tool.name

          if (renamesForThisServer.has(originalName)) {
            finalName = `${source.serverName}_${originalName}`
            finalDescription = `[${source.serverName}] ${tool.description}`
          }

          const namePattern = /^[a-zA-Z0-9_-]+$/
          if (!namePattern.test(finalName)) {
            console.error(
              `Generated tool name '${finalName}' is invalid. Skipping tool '${originalName}' from server '${source.serverName}'. Please ensure the tool name matches the allowed pattern: /^[a-zA-Z0-9_-]+$/`
            )
            continue
          }

          const properties = isRecord(tool.inputSchema.properties)
            ? tool.inputSchema.properties
            : {}
          const toolProperties = Object.fromEntries(
            Object.entries(properties).map(([key, value]) => [
              key,
              isRecord(value) && !value.description
                ? { ...value, description: `Params of ${key}` }
                : value
            ])
          )

          results.push({
            execution: TOOL_EXECUTION.write,
            type: 'function',
            function: {
              name: finalName,
              description: finalDescription,
              parameters: {
                type: 'object',
                properties: toolProperties,
                required: Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : []
              }
            },
            server: {
              name: source.serverName,
              icons: source.icon,
              description: source.displayName
            }
          })

          nextToolNameToTargetMap.set(finalName, {
            serverName: source.serverName,
            originalName,
            client: source.client,
            catalogBacked: source.catalogBacked,
            ...(source.catalogBacked ? { catalogTool: tool } : {})
          })
        }
      }

      // Cache results and return
      options?.signal?.throwIfAborted()
      if (refreshGeneration !== this.toolDefinitionsCacheGeneration) {
        if (this.activeToolDefinitionsRefresh === refresh) {
          this.activeToolDefinitionsRefresh = null
        }
        return await this.getAllToolDefinitions(access, options)
      }
      this.cachedToolDefinitions = results
      this.toolNameToTargetMap = nextToolNameToTargetMap
      console.info(`Cached ${results.length} final tool definitions and populated target map.`)

      return this.filterToolDefinitionsByContext(this.cachedToolDefinitions, context)
    } finally {
      refresh.settle()
      if (this.activeToolDefinitionsRefresh === refresh) {
        this.activeToolDefinitionsRefresh = null
      }
    }
  }

  private async loadToolSources(clients: McpClient[], signal?: AbortSignal): Promise<ToolSource[]> {
    const catalogRegistrations = this.pluginOwnership.getAvailableToolCatalogs()
    const catalogServerNames = new Set(
      catalogRegistrations.map((registration) => registration.serverName)
    )
    const sources: ToolSource[] = []

    for (const client of clients) {
      if (
        (this.pluginOwnership.ownsServer(client.serverName) &&
          !this.pluginOwnership.isServerAvailable(client.serverName)) ||
        catalogServerNames.has(client.serverName)
      ) {
        continue
      }

      try {
        const tools = await awaitWithAbort(client.listTools({ signal }), signal)
        this.serverManager.clearServerLastError(client.serverName)
        if (!this.isPluginOwnedClient(client)) {
          this.recoverToolListNotification(client.serverName)
        }
        if (!tools) {
          continue
        }
        sources.push({
          serverName: client.serverName,
          displayName: client.serverConfig.descriptions as string,
          icon: client.serverConfig.icons as string,
          tools: this.filterExplicitlyDeniedTools(client.serverName, tools),
          client,
          catalogBacked: false
        })
      } catch (error) {
        if (signal?.aborted) {
          throw error
        }
        this.handleToolListError(client, error)
      }
    }

    for (const registration of catalogRegistrations) {
      sources.push({
        serverName: registration.serverName,
        displayName: registration.displayName,
        icon: 'plugin',
        tools: this.filterExplicitlyDeniedTools(
          registration.serverName,
          registration.toolCatalog.tools
        ),
        catalogBacked: true
      })
    }
    return sources
  }

  private filterExplicitlyDeniedTools(serverName: string, tools: readonly Tool[]): readonly Tool[] {
    const deniedTools = new Set(getExplicitlyDeniedPluginTools(serverName))
    return deniedTools.size === 0 ? tools : tools.filter((tool) => !deniedTools.has(tool.name))
  }

  private handleToolListError(client: McpClient, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const serverName = client.serverName || 'Unknown server'
    console.error(`Failed to get tool list from server '${serverName}':`, errorMessage)
    this.serverManager.setServerLastError(serverName, errorMessage)
    if (this.isPluginOwnedClient(client)) {
      return
    }

    this.semanticNotifications.occur({
      code: 'mcp.toolListFailed',
      serverName
    })
  }

  private recoverToolListNotification(serverName: string): void {
    this.semanticNotifications.recover({
      code: 'mcp.toolListFailed',
      serverName
    })
  }

  private filterToolDefinitionsByContext(
    toolDefinitions: MCPToolDefinition[],
    context: McpToolAccessContext
  ): MCPToolDefinition[] {
    if (!context.enabledTools && !context.enabledServerIds) {
      return toolDefinitions
    }

    return toolDefinitions.filter((toolDef) => {
      const finalName = toolDef.function.name
      const target = this.toolNameToTargetMap?.get(finalName)
      const originalName = target?.originalName || finalName
      if (
        context.enabledTools &&
        !context.enabledTools.includes(finalName) &&
        !context.enabledTools.includes(originalName)
      ) {
        return false
      }
      return this.isServerAllowedByContext(toolDef.server.name, context)
    })
  }

  private isServerAllowedByContext(serverName: string, context: McpToolAccessContext): boolean {
    // Official plugin runtimes are app-global capabilities; per-agent MCP selections only govern
    // user-configured servers.
    if (this.pluginOwnership.isServerAvailable(serverName)) {
      return true
    }
    return !context.enabledServerIds || context.enabledServerIds.includes(serverName)
  }

  // 确定权限类型的新方法
  private determinePermissionType(toolName: string): 'read' | 'write' | 'all' {
    const lowerToolName = toolName.toLowerCase()

    // Read operations
    if (
      lowerToolName.includes('read') ||
      lowerToolName.includes('list') ||
      lowerToolName.includes('get') ||
      lowerToolName.includes('show') ||
      lowerToolName.includes('view') ||
      lowerToolName.includes('fetch') ||
      lowerToolName.includes('search') ||
      lowerToolName.includes('find') ||
      lowerToolName.includes('query') ||
      lowerToolName.includes('tree')
    ) {
      return 'read'
    }

    // Write operations
    if (
      lowerToolName.includes('write') ||
      lowerToolName.includes('create') ||
      lowerToolName.includes('update') ||
      lowerToolName.includes('delete') ||
      lowerToolName.includes('modify') ||
      lowerToolName.includes('edit') ||
      lowerToolName.includes('remove') ||
      lowerToolName.includes('add') ||
      lowerToolName.includes('insert') ||
      lowerToolName.includes('save') ||
      lowerToolName.includes('execute') ||
      lowerToolName.includes('run') ||
      lowerToolName.includes('call') ||
      lowerToolName.includes('move') ||
      lowerToolName.includes('copy') ||
      lowerToolName.includes('mkdir') ||
      lowerToolName.includes('rmdir')
    ) {
      return 'write'
    }

    // Default to write for safety (unknown operations require higher permissions)
    return 'write'
  }

  // 检查工具调用权限
  private checkToolPermission(
    originalToolName: string,
    serverName: string,
    autoApprove: string[],
    conversationId?: string
  ): boolean {
    logger.info(
      `[ToolManager] Checking permissions for tool '${originalToolName}' on server '${serverName}' with autoApprove:`,
      autoApprove,
      `conversationId: ${conversationId}`
    )

    const policy = resolvePluginToolPolicy(serverName, originalToolName)
    if (policy.decision === 'allow') {
      logger.info(
        `[ToolManager] Permission granted by plugin tool policy: ${serverName}.${originalToolName}`
      )
      return true
    }
    if (policy.managed) {
      if (
        policy.decision === 'ask' &&
        conversationId &&
        this.checkSessionToolPermission(conversationId, serverName, originalToolName)
      ) {
        logger.info(
          `[ToolManager] Permission granted by exact plugin session cache: ${serverName}.${originalToolName}`
        )
        return true
      }
      logger.info(
        `[ToolManager] Permission blocked by closed plugin tool policy '${policy.decision ?? 'undeclared'}': ${serverName}.${originalToolName}`
      )
      return false
    }

    const permissionType = this.determinePermissionType(originalToolName)
    logger.info(`[ToolManager] Tool '${originalToolName}' requires '${permissionType}' permission`)

    // Existing servers without a closed plugin policy retain coarse session grants.
    if (conversationId && this.checkSessionPermission(conversationId, serverName, permissionType)) {
      logger.info(
        `[ToolManager] Permission granted via session cache: server '${serverName}' has '${permissionType}' permission`
      )
      return true
    }

    // 检查持久化的 'all' 权限
    if (autoApprove.includes('all')) {
      logger.info(`[ToolManager] Permission granted: server '${serverName}' has 'all' permissions`)
      return true
    }

    // 检查持久化的特定权限类型
    if (autoApprove.includes(permissionType)) {
      logger.info(
        `[ToolManager] Permission granted: server '${serverName}' has '${permissionType}' permission`
      )
      return true
    }

    logger.info(
      `[ToolManager] Permission required for tool '${originalToolName}' on server '${serverName}'.`
    )
    return false
  }

  /**
   * Pre-check tool permissions without executing the tool
   * Returns permission requirement info if permission is needed, null if already has permission
   */
  async preCheckToolPermission(
    toolCall: MCPToolCall,
    access?: Pick<McpToolAccessContext, 'agentId' | 'enabledServerIds'> & {
      signal?: AbortSignal
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
    access?.signal?.throwIfAborted()
    const finalName = toolCall.function.name

    // Ensure definitions and map are loaded/cached
    await awaitWithAbort(
      this.getAllToolDefinitions(undefined, { signal: access?.signal }),
      access?.signal
    )
    access?.signal?.throwIfAborted()

    if (!this.toolNameToTargetMap) {
      console.error('[ToolManager] Tool target map is not available for permission check.')
      return null
    }

    const targetInfo = this.toolNameToTargetMap.get(finalName)

    if (!targetInfo) {
      console.error(`[ToolManager] Tool '${finalName}' not found for permission check.`)
      return null
    }

    const { originalName, serverName: toolServerName } = targetInfo

    // Get server config to check auto-approve settings
    const servers = await awaitWithAbort(this.mcpSettings.getMcpServers(), access?.signal)
    access?.signal?.throwIfAborted()
    const serverConfig = servers[toolServerName]
    const accessContext = normalizeToolAccessContext({
      agentId: access?.agentId,
      enabledServerIds: access?.enabledServerIds,
      conversationId: toolCall.conversationId
    })
    if (serverConfig && !this.isServerAllowedByContext(toolServerName, accessContext)) {
      return null
    }
    const autoApprove = serverConfig?.autoApprove || []
    const pluginPolicy = resolvePluginToolPolicy(toolServerName, originalName)

    if (
      pluginPolicy.managed &&
      pluginPolicy.decision !== 'allow' &&
      pluginPolicy.decision !== 'ask'
    ) {
      return null
    }

    // Check permission using existing logic
    const hasPermission = this.checkToolPermission(
      originalName,
      toolServerName,
      autoApprove,
      toolCall.conversationId
    )

    if (hasPermission) {
      return null // Already has permission
    }

    const permissionType = this.determinePermissionType(originalName)
    return {
      needsPermission: true,
      toolName: originalName,
      serverName: toolServerName,
      permissionType,
      description: `Allow ${originalName} to perform ${permissionType} operations on ${toolServerName}?`
    }
  }

  async callTool(
    toolCall: MCPToolCall,
    access?: Pick<McpToolAccessContext, 'agentId' | 'enabledServerIds'> & {
      signal?: AbortSignal
      runId?: string
    }
  ): Promise<MCPToolResponse> {
    let previewCall: ComputerUsePreviewCall | null = null
    let previewTerminalNotified = false
    try {
      access?.signal?.throwIfAborted()
      const finalName = toolCall.function.name
      const argsString = toolCall.function.arguments

      logger.info(`[ToolManager] Calling tool:`, {
        requestedName: finalName,
        originalName: finalName,
        serverName: toolCall.server?.name || 'unknown',
        rawArguments: argsString
      })

      // Ensure definitions and map are loaded/cached
      await awaitWithAbort(
        this.getAllToolDefinitions(undefined, { signal: access?.signal }),
        access?.signal
      )
      access?.signal?.throwIfAborted()

      if (!this.toolNameToTargetMap) {
        console.error('Tool target map is not available.')
        return {
          toolCallId: toolCall.id,
          content: `Error: Internal error - tool information not available.`,
          isError: true
        }
      }

      const targetInfo = this.toolNameToTargetMap.get(finalName)

      if (!targetInfo) {
        console.error(`Tool '${finalName}' not found in the target map.`)
        return {
          toolCallId: toolCall.id,
          content: `Error: Tool '${finalName}' not found or server not running.`,
          isError: true
        }
      }

      const { originalName, serverName: toolServerName } = targetInfo
      const accessContext = normalizeToolAccessContext({
        agentId: access?.agentId,
        enabledServerIds: access?.enabledServerIds,
        conversationId: toolCall.conversationId
      })
      const hintedProviderId = toolCall.providerId?.trim()
      const shouldCheckAcpAccess = Boolean(toolCall.conversationId) && hintedProviderId === 'acp'

      // Session execution passes agent identity with the tool access context.
      if (shouldCheckAcpAccess) {
        const agentId = accessContext.agentId
        if (!agentId) {
          return {
            toolCallId: toolCall.id,
            content: 'ACP agent context is required for MCP access control.',
            isError: true
          }
        }

        try {
          const acpAgents = await awaitWithAbort(this.agentSettings.getAcpAgents(), access?.signal)
          if (acpAgents.some((item) => item.id === agentId)) {
            const selections = await awaitWithAbort(
              this.agentSettings.getAgentMcpSelections(agentId),
              access?.signal
            )
            if (!selections?.length || !selections.includes(toolServerName)) {
              return {
                toolCallId: toolCall.id,
                content: `MCP server '${toolServerName}' is not allowed for ACP agent '${agentId}'. Configure MCP access in ACP settings.`,
                isError: true
              }
            }
          }
        } catch (error) {
          if (access?.signal?.aborted || isAbortError(error)) throw error
          console.warn('[ToolManager] Failed to check ACP agent MCP access control:', error)
        }
      }
      access?.signal?.throwIfAborted()

      // Log the call details including original name
      console.info('[MCP] ToolManager calling tool', {
        requestedName: finalName,
        originalName: originalName,
        serverName: toolServerName,
        rawArguments: argsString
      })

      // Parse arguments
      let args: Record<string, unknown> | null = null
      try {
        args = JSON.parse(argsString)
      } catch (error: unknown) {
        console.warn(
          'Error parsing tool call arguments with JSON.parse, trying jsonrepair:',
          error instanceof Error ? error.message : String(error)
        )
        try {
          args = JSON.parse(jsonrepair(argsString))
        } catch (e: unknown) {
          console.error('Error parsing tool call arguments even after jsonrepair:', argsString, e)
          // Decide how to handle: return error or proceed with empty args?
          // Let's proceed with empty args for now, mirroring previous behavior.
          args = {}
        }
      }

      // Get server configuration
      const servers = await awaitWithAbort(this.mcpSettings.getMcpServers(), access?.signal)
      access?.signal?.throwIfAborted()
      const serverConfig = servers[toolServerName]
      if (!serverConfig) {
        console.error(`Configuration for server '${toolServerName}' not found.`)
        return {
          toolCallId: toolCall.id,
          content: `Error: Configuration missing for server '${toolServerName}'.`,
          isError: true
        }
      }
      if (!this.isServerAllowedByContext(toolServerName, accessContext)) {
        return {
          toolCallId: toolCall.id,
          content: `MCP server '${toolServerName}' is not allowed for DeepChat agent '${accessContext.agentId ?? 'unknown'}'. Configure MCP access in DeepChat agent settings.`,
          isError: true
        }
      }
      const autoApprove = serverConfig?.autoApprove || []
      const pluginPolicy = resolvePluginToolPolicy(toolServerName, originalName)
      if (
        pluginPolicy.managed &&
        pluginPolicy.decision !== 'allow' &&
        pluginPolicy.decision !== 'ask'
      ) {
        return {
          toolCallId: toolCall.id,
          content:
            pluginPolicy.decision === 'deny'
              ? `Tool '${originalName}' on server '${toolServerName}' is blocked by plugin policy.`
              : `Tool '${originalName}' on server '${toolServerName}' is not declared by its closed plugin policy.`,
          isError: true
        }
      }
      logger.info(
        `Checking permissions for tool '${originalName}' on server '${toolServerName}' with autoApprove:`,
        autoApprove
      )
      // Use originalName and toolServerName for permission check, pass conversationId for session cache
      const hasPermission = this.checkToolPermission(
        originalName,
        toolServerName,
        autoApprove,
        toolCall.conversationId
      )

      if (!hasPermission) {
        console.warn(
          `Permission required for tool '${originalName}' on server '${toolServerName}'.`
        )

        const permissionType = this.determinePermissionType(originalName)

        // Return permission request instead of error
        return {
          toolCallId: toolCall.id,
          content: `components.messageBlockPermissionRequest.description.${permissionType}`,
          isError: false,
          requiresPermission: true,
          permissionRequest: {
            toolName: originalName,
            serverName: toolServerName,
            permissionType,
            conversationId: toolCall.conversationId,
            description: `Allow ${originalName} to perform ${permissionType} operations on ${toolServerName}?`
          }
        }
      }

      const targetClient = await this.resolveToolClient(targetInfo, access?.signal)
      access?.signal?.throwIfAborted()
      const preparedArgs = await this.prepareToolArguments(
        targetClient,
        originalName,
        args || {},
        access?.signal
      )
      access?.signal?.throwIfAborted()
      if (!preparedArgs.ok) {
        return {
          toolCallId: toolCall.id,
          content: `Error: ${preparedArgs.error}`,
          isError: true
        }
      }

      previewCall =
        originalName === 'get_window_state'
          ? this.createComputerUsePreviewCall({
              client: targetClient,
              toolCall,
              toolName: originalName,
              args: preparedArgs.args,
              runId: access?.runId
            })
          : null
      if (previewCall) {
        this.notifyComputerUsePreview('started', previewCall)
      }

      // Call the tool on the target client using the ORIGINAL name
      const result = access?.signal
        ? await targetClient.callTool(originalName, preparedArgs.args, { signal: access.signal })
        : await targetClient.callTool(originalName, preparedArgs.args)
      access?.signal?.throwIfAborted()

      const ownerPluginId = this.pluginOwnership.ownsServer(toolServerName)
        ? this.pluginOwnership.getOwnerPluginId(toolServerName)
        : undefined
      const formattedResponse = this.formatToolResponse(toolCall.id, result)
      const response: MCPToolResponse = {
        ...formattedResponse,
        content:
          ownerPluginId === CUA_PLUGIN_ID
            ? appendCuaResultProjections(
                formattedResponse.content,
                originalName,
                result.structuredContent
              )
            : formattedResponse.content,
        ...(ownerPluginId ? { ownerPluginId } : {})
      }

      if (previewCall) {
        this.notifyComputerUsePreview('completed', previewCall, response)
        previewTerminalNotified = true
      }

      this.publishEvent('mcp.toolCall.result', {
        functionName: toolCall.function.name,
        content: response.content,
        version: Date.now()
      })

      this.scheduleComputerUsePreviewAfterClick({
        client: targetClient,
        toolCall,
        toolName: originalName,
        args: preparedArgs.args,
        runId: access?.runId,
        response,
        signal: access?.signal
      })

      return response
    } catch (error: unknown) {
      if (previewCall && !previewTerminalNotified) {
        this.notifyComputerUsePreview('failed', previewCall, error)
      }
      if (access?.signal?.aborted || isAbortError(error)) {
        throw error
      }

      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Unhandled error during tool call:', error)
      return {
        toolCallId: toolCall.id,
        content: `Error: Failed to execute tool '${toolCall.function.name}': ${errorMessage}`,
        isError: true
      }
    }
  }

  private async resolveToolClient(target: ToolTarget, signal?: AbortSignal): Promise<McpClient> {
    let client = target.client
    if (this.pluginOwnership.ownsServer(target.serverName)) {
      await awaitWithAbort(this.pluginOwnership.ensureRunning(target.serverName, 'tool'), signal)
      signal?.throwIfAborted()
      if (!this.pluginOwnership.isServerAvailable(target.serverName)) {
        throw new Error(`Plugin runtime server "${target.serverName}" is no longer available`)
      }
      client = this.serverManager.getClient(target.serverName)
    }
    if (!client) {
      throw new Error(`MCP server "${target.serverName}" has no running client`)
    }

    if (target.catalogBacked) {
      if (!target.catalogTool) {
        throw new Error(
          `Catalog-backed MCP tool "${target.originalName}" has no packaged definition`
        )
      }
      await this.verifyCatalogTool(client, target.catalogTool, signal)
    }
    return client
  }

  private async verifyCatalogTool(
    client: McpClient,
    catalogTool: Tool,
    signal?: AbortSignal
  ): Promise<void> {
    let validationPromise = this.catalogValidationPromises.get(client)
    if (!validationPromise) {
      const validationSignal = AbortSignal.timeout(TOOL_CATALOG_VALIDATION_TIMEOUT_MS)
      validationPromise = client
        .listTools({ signal: validationSignal })
        .then((liveTools) => {
          this.serverManager.clearServerLastError(client.serverName)
          const tools = new Map<string, Tool>()
          for (const liveTool of liveTools ?? []) {
            if (tools.has(liveTool.name)) {
              throw new Error(
                `Live MCP server "${client.serverName}" returned duplicate tool "${liveTool.name}"`
              )
            }
            tools.set(liveTool.name, liveTool)
          }
          return tools
        })
        .catch((error) => {
          this.serverManager.setServerLastError(client.serverName, error)
          throw error
        })
      this.catalogValidationPromises.set(client, validationPromise)
      void validationPromise.catch(() => {
        if (this.catalogValidationPromises.get(client) === validationPromise) {
          this.catalogValidationPromises.delete(client)
        }
      })
    }

    const liveTools = await awaitWithAbort(validationPromise, signal)
    signal?.throwIfAborted()
    const liveTool = liveTools.get(catalogTool.name)
    if (!liveTool) {
      const errorMessage = `Live MCP tool "${catalogTool.name}" is missing from catalog-backed server "${client.serverName}"`
      this.serverManager.setServerLastError(client.serverName, errorMessage)
      throw new Error(errorMessage)
    }
    if (!isDeepStrictEqual(liveTool.inputSchema, catalogTool.inputSchema)) {
      const errorMessage = `Live MCP tool "${catalogTool.name}" schema differs from the packaged catalog for server "${client.serverName}"`
      this.serverManager.setServerLastError(client.serverName, errorMessage)
      throw new Error(errorMessage)
    }
  }

  private getCatalogTool(serverName: string, toolName: string): Tool {
    const tool = this.pluginOwnership
      .getAvailableToolCatalogs()
      .find((registration) => registration.serverName === serverName)
      ?.toolCatalog.tools.find((candidate) => candidate.name === toolName)
    if (!tool) {
      throw new Error(
        `Plugin runtime server "${serverName}" has no packaged catalog entry for "${toolName}"`
      )
    }
    return tool
  }

  private createComputerUsePreviewCall(input: {
    client: McpClient
    toolCall: MCPToolCall
    toolName: string
    args: Record<string, unknown>
    runId?: string
  }): ComputerUsePreviewCall | null {
    const conversationId = input.toolCall.conversationId?.trim()
    const runId = input.runId?.trim()
    if (!conversationId || !runId || !this.isCuaComputerUseServer(input.client)) {
      return null
    }

    const ownerPluginId = this.pluginOwnership.getOwnerPluginId(input.client.serverName)
    return {
      conversationId,
      runId,
      toolCallId: input.toolCall.id,
      toolName: input.toolName,
      args: { ...input.args },
      source: {
        serverName: input.client.serverName,
        ...(ownerPluginId ? { ownerPluginId } : {})
      }
    }
  }

  private scheduleComputerUsePreviewAfterClick(input: {
    client: McpClient
    toolCall: MCPToolCall
    toolName: string
    args: Record<string, unknown>
    runId?: string
    response: MCPToolResponse
    signal?: AbortSignal
  }): void {
    if (
      input.toolName !== 'click' ||
      input.response.isError === true ||
      resolvePluginToolPolicy(input.client.serverName, 'get_window_state').decision !== 'allow' ||
      !this.computerUsePreviewObserver?.shouldCaptureAfterClick
    ) {
      return
    }

    const clickCall = this.createComputerUsePreviewCall(input)
    const pid = this.readPositiveIntegerArg(input.args.pid)
    const windowId = this.readPositiveIntegerArg(input.args.window_id)
    if (!clickCall || pid == null || windowId == null) {
      return
    }

    let shouldCapture = false
    try {
      shouldCapture = this.computerUsePreviewObserver.shouldCaptureAfterClick(clickCall)
    } catch (error) {
      logger.warn('[ToolManager] Computer Use preview eligibility check failed', {
        toolCallId: clickCall.toolCallId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
    if (!shouldCapture) {
      return
    }

    const snapshotCall: ComputerUsePreviewCall = {
      ...clickCall,
      toolCallId: `${clickCall.toolCallId}:pip-snapshot`,
      toolName: 'get_window_state',
      args: {
        pid,
        window_id: windowId
      }
    }
    void this.captureComputerUsePreviewSnapshot(input.client, snapshotCall, input.signal)
  }

  private async captureComputerUsePreviewSnapshot(
    client: McpClient,
    call: ComputerUsePreviewCall,
    signal?: AbortSignal
  ): Promise<void> {
    let started = false
    try {
      signal?.throwIfAborted()
      this.notifyComputerUsePreview('started', call)
      started = true
      if (!this.pluginOwnership.isServerAvailable(client.serverName)) {
        throw new Error(`Plugin runtime server "${client.serverName}" is no longer available`)
      }
      await this.verifyCatalogTool(
        client,
        this.getCatalogTool(client.serverName, 'get_window_state'),
        signal
      )
      const result = signal
        ? await client.callTool('get_window_state', call.args, { signal })
        : await client.callTool('get_window_state', call.args)
      signal?.throwIfAborted()
      this.notifyComputerUsePreview(
        'completed',
        call,
        this.formatToolResponse(call.toolCallId, result)
      )
    } catch (error) {
      if (started) {
        this.notifyComputerUsePreview('failed', call, error)
      }
    }
  }

  private formatToolResponse(
    toolCallId: string,
    result: { content?: unknown; isError?: boolean; structuredContent?: unknown }
  ): MCPToolResponse {
    let formattedContent: string | MCPContentItem[] = ''
    if (typeof result.content === 'string') {
      formattedContent = result.content
    } else if (Array.isArray(result.content)) {
      formattedContent = result.content.map((item): MCPContentItem => {
        if (typeof item === 'string') {
          return { type: 'text', text: item } as MCPTextContent
        }
        if (item && typeof item === 'object' && ('type' in item || 'text' in item)) {
          const contentItem = item as { type?: unknown; text?: unknown }
          if (
            contentItem.type === 'text' ||
            contentItem.type === 'image' ||
            contentItem.type === 'resource'
          ) {
            return item as MCPContentItem
          }
          if (contentItem.type && contentItem.text) {
            return { type: 'text', text: String(contentItem.text) } as MCPTextContent
          }
        }
        return { type: 'text', text: JSON.stringify(item) } as MCPTextContent
      })
    } else if (result.content) {
      formattedContent = JSON.stringify(result.content)
    }

    return {
      toolCallId,
      content: formattedContent,
      isError: result.isError,
      ...(result.structuredContent !== undefined
        ? { structuredContent: result.structuredContent }
        : {})
    }
  }

  private readPositiveIntegerArg(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
  }

  private notifyComputerUsePreview(
    phase: 'started' | 'completed' | 'failed',
    call: ComputerUsePreviewCall,
    value?: MCPToolResponse | unknown
  ): void {
    const observer = this.computerUsePreviewObserver
    if (!observer) {
      return
    }
    try {
      if (phase === 'started') {
        observer.started(call)
      } else if (phase === 'completed') {
        observer.completed(call, value as MCPToolResponse)
      } else {
        observer.failed(call, value)
      }
    } catch (error) {
      logger.warn('[ToolManager] Computer Use preview observer failed', {
        phase,
        toolCallId: call.toolCallId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async prepareToolArguments(
    client: McpClient,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<{ ok: true; args: Record<string, unknown> } | { ok: false; error: string }> {
    if (!this.isCuaComputerUseServer(client)) {
      return { ok: true, args }
    }

    const normalizedArgs = normalizeCuaToolArguments(toolName, args)
    if (toolName !== 'launch_app' || process.platform !== 'win32') {
      return { ok: true, args: normalizedArgs }
    }

    return await this.prepareCuaWindowsLaunchArgs(client, normalizedArgs, signal)
  }

  private async prepareCuaWindowsLaunchArgs(
    client: McpClient,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<{ ok: true; args: Record<string, unknown> } | { ok: false; error: string }> {
    const normalizedArgs = { ...args }
    const bundleId = this.readStringArg(normalizedArgs.bundle_id)
    const name = this.readStringArg(normalizedArgs.name)

    if (bundleId && !bundleId.includes('!') && this.isWindowsPathLike(bundleId)) {
      delete normalizedArgs.bundle_id
      if (
        !this.readStringArg(normalizedArgs.path) &&
        !this.readStringArg(normalizedArgs.launch_path)
      ) {
        normalizedArgs.path = bundleId
      }
      return { ok: true, args: normalizedArgs }
    }

    if (
      this.readStringArg(normalizedArgs.path) ||
      this.readStringArg(normalizedArgs.launch_path) ||
      this.readStringArg(normalizedArgs.aumid) ||
      (bundleId && bundleId.includes('!')) ||
      this.hasUrlLaunchTargets(normalizedArgs)
    ) {
      return { ok: true, args: normalizedArgs }
    }

    const target = bundleId || name
    if (!target) {
      return { ok: true, args: normalizedArgs }
    }

    const apps = await this.listCuaWindowsApps(client, signal)
    if (!apps) {
      return {
        ok: false,
        error:
          'Unable to validate the Windows app target before launching. Call list_apps first, then retry with a Windows name, path, launch_path, or aumid.'
      }
    }

    if (!this.matchesCuaWindowsApp(apps, target)) {
      return {
        ok: false,
        error: `Windows app target '${target}' was not found. Call list_apps first and use a Windows app name, path, launch_path, or aumid. Do not use macOS bundle ids on Windows.`
      }
    }

    return { ok: true, args: normalizedArgs }
  }

  private readStringArg(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }

  private isWindowsPathLike(value: string): boolean {
    return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\') || /[\\/]/.test(value)
  }

  private hasUrlLaunchTargets(args: Record<string, unknown>): boolean {
    return Array.isArray(args.urls) && args.urls.some((item) => this.readStringArg(item))
  }

  private async listCuaWindowsApps(
    client: McpClient,
    signal?: AbortSignal
  ): Promise<Array<Record<string, unknown>> | null> {
    try {
      const result = (
        signal
          ? await client.callTool('list_apps', {}, { signal })
          : await client.callTool('list_apps', {})
      ) as {
        structuredContent?: unknown
        content?: unknown
      }
      signal?.throwIfAborted()
      const structured = result.structuredContent
      if (
        structured &&
        typeof structured === 'object' &&
        Array.isArray((structured as { apps?: unknown }).apps)
      ) {
        return (structured as { apps: Array<Record<string, unknown>> }).apps
      }

      const parsed = this.parseToolResultJsonObject(result.content)
      if (parsed && Array.isArray(parsed.apps)) {
        return parsed.apps as Array<Record<string, unknown>>
      }
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error
      console.warn('[MCP] Failed to preflight CUA Windows launch target:', error)
    }
    return null
  }

  private parseToolResultJsonObject(content: unknown): Record<string, unknown> | null {
    const text = Array.isArray(content)
      ? content
          .map((item) =>
            item && typeof item === 'object' && 'text' in item
              ? String((item as { text?: unknown }).text ?? '')
              : ''
          )
          .join('\n')
      : typeof content === 'string'
        ? content
        : ''
    if (!text.trim()) {
      return null
    }
    try {
      const parsed = JSON.parse(text)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  private matchesCuaWindowsApp(apps: Array<Record<string, unknown>>, target: string): boolean {
    const normalizedTarget = this.normalizeWindowsAppIdentifier(target)
    return apps.some((app) => {
      const candidates = [app.name, app.bundle_id, app.launch_path, app.path, app.aumid].flatMap(
        (value) => this.windowsAppIdentifierCandidates(value)
      )
      return candidates.some(
        (candidate) =>
          candidate === normalizedTarget ||
          candidate.includes(normalizedTarget) ||
          normalizedTarget.includes(candidate)
      )
    })
  }

  private windowsAppIdentifierCandidates(value: unknown): string[] {
    const raw = this.readStringArg(value)
    if (!raw) {
      return []
    }
    const normalized = this.normalizeWindowsAppIdentifier(raw)
    const basename = raw.split(/[\\/]/).pop()
    return basename && basename !== raw
      ? [normalized, this.normalizeWindowsAppIdentifier(basename)]
      : [normalized]
  }

  private normalizeWindowsAppIdentifier(value: string): string {
    return value.trim().replace(/^"|"$/g, '').toLowerCase()
  }

  // 根据客户端名称获取提示模板内容
  async getPromptByClient(
    clientName: string,
    promptName: string,
    params: Record<string, unknown> = {}
  ): Promise<unknown> {
    try {
      const clients = await this.getRunningClients()

      // 查找指定的客户端
      const client = clients.find((c) => c.serverName === clientName)
      if (!client) {
        throw new Error(`MCP client not found: ${clientName}`)
      }

      if (typeof client.getPrompt !== 'function') {
        throw new Error(`MCP client ${clientName} does not support getting prompt templates`)
      }

      return await client.getPrompt(promptName, params)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Failed to get prompt template:', errorMessage)
      throw new Error(`Failed to get prompt template: ${errorMessage}`)
    }
  }

  // 根据客户端名称读取资源内容
  async readResourceByClient(clientName: string, resourceUri: string): Promise<Resource> {
    try {
      const clients = await this.getRunningClients()

      // 查找指定的客户端
      const client = clients.find((c) => c.serverName === clientName)
      if (!client) {
        throw new Error(`MCP client not found: ${clientName}`)
      }

      if (typeof client.readResource !== 'function') {
        throw new Error(`MCP client ${clientName} does not support reading resources`)
      }

      return await client.readResource(resourceUri)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Failed to read resource:', errorMessage)
      throw new Error(`Failed to read resource: ${errorMessage}`)
    }
  }

  // 权限管理方法
  async grantPermission(
    serverName: string,
    permissionType: 'read' | 'write' | 'all',
    remember: boolean = true,
    conversationId?: string,
    toolName?: string
  ): Promise<void> {
    logger.info(
      `[ToolManager] Granting permission: ${permissionType} for server: ${serverName}, remember: ${remember}, conversationId: ${conversationId}`
    )

    const pluginPolicy = toolName
      ? resolvePluginToolPolicy(serverName, toolName)
      : resolvePluginToolPolicy(serverName, '')
    if (pluginPolicy.managed) {
      if (remember || !conversationId || !toolName || pluginPolicy.decision !== 'ask') {
        throw new Error(
          `Closed plugin policy permission for "${serverName}" requires an exact ask-policy tool and conversation`
        )
      }
      const key = this.pluginToolPermissionKey(serverName, toolName)
      const existing = this.sessionPermissions.get(conversationId) ?? new Set<string>()
      existing.add(key)
      this.sessionPermissions.set(conversationId, existing)
      logger.info(
        `[ToolManager] Exact plugin session permission stored: ${serverName}.${toolName} for conversation ${conversationId}`
      )
      return
    }

    if (remember) {
      // Persist to configuration
      await this.updateServerPermissions(serverName, permissionType)
    } else {
      // Store in temporary session storage (memory only)
      if (conversationId) {
        const key = `${serverName}:${permissionType}`
        const existing = this.sessionPermissions.get(conversationId) ?? new Set<string>()
        existing.add(key)
        this.sessionPermissions.set(conversationId, existing)
        logger.info(
          `[ToolManager] Session permission stored: ${key} for conversation ${conversationId}`
        )
      } else {
        logger.info(`[ToolManager] Temporary permission granted (no conversationId)`)
      }
    }
  }

  // 检查会话级别的权限
  // 当前会话权限遵循层级：all > write > read
  checkSessionPermission(
    conversationId: string,
    serverName: string,
    permissionType: 'read' | 'write' | 'all'
  ): boolean {
    const sessionPerms = this.sessionPermissions.get(conversationId)
    if (!sessionPerms) return false

    const permissionLevelMap: Record<'read' | 'write' | 'all', number> = {
      read: 1,
      write: 2,
      all: 3
    }
    const requiredLevel = permissionLevelMap[permissionType]
    const prefix = `${serverName}:`

    for (const permKey of sessionPerms) {
      if (!permKey.startsWith(prefix)) continue

      const storedPermission = permKey.slice(prefix.length) as 'read' | 'write' | 'all'
      const storedLevel = permissionLevelMap[storedPermission]
      if (storedLevel >= requiredLevel) {
        logger.info(
          `[ToolManager] Session auto-execute: server '${serverName}' has granted permission '${permKey}' in conversation '${conversationId}', required='${permissionType}'`
        )
        return true
      }
    }

    return false
  }

  private checkSessionToolPermission(
    conversationId: string,
    serverName: string,
    toolName: string
  ): boolean {
    return (
      this.sessionPermissions
        .get(conversationId)
        ?.has(this.pluginToolPermissionKey(serverName, toolName)) ?? false
    )
  }

  private pluginToolPermissionKey(serverName: string, toolName: string): string {
    return JSON.stringify(['plugin-tool', serverName, toolName])
  }

  // 清除会话的临时权限
  clearSessionPermissions(conversationId: string): void {
    this.sessionPermissions.delete(conversationId)
  }

  private async updateServerPermissions(
    serverName: string,
    permissionType: 'read' | 'write' | 'all'
  ): Promise<void> {
    try {
      logger.info(`[ToolManager] Updating server ${serverName} permissions: ${permissionType}`)
      const servers = await this.mcpSettings.getMcpServers()
      const serverConfig = servers[serverName]

      if (serverConfig) {
        let autoApprove = [...(serverConfig.autoApprove || [])]

        // If 'all' permission already exists, no need to add specific permissions
        if (autoApprove.includes('all')) {
          logger.info(`Server ${serverName} already has 'all' permissions`)
          return
        }

        // If requesting 'all' permission, remove specific permissions and add 'all'
        if (permissionType === 'all') {
          autoApprove = autoApprove.filter((p) => p !== 'read' && p !== 'write')
          autoApprove.push('all')
        } else {
          // Add the specific permission if not already present
          if (!autoApprove.includes(permissionType)) {
            autoApprove.push(permissionType)
          }
        }

        logger.info(
          `[ToolManager] Before update - Server ${serverName} permissions:`,
          serverConfig.autoApprove || []
        )
        logger.info(`[ToolManager] After update - Server ${serverName} permissions:`, autoApprove)

        // Update server configuration
        await this.mcpSettings.updateMcpServer(serverName, {
          ...serverConfig,
          autoApprove
        })

        logger.info(
          `[ToolManager] Successfully updated server ${serverName} permissions to:`,
          autoApprove
        )

        // Verify the update by reading back
        const updatedServers = await this.mcpSettings.getMcpServers()
        const updatedConfig = updatedServers[serverName]
        logger.info(
          `[ToolManager] Verification - Server ${serverName} current permissions:`,
          updatedConfig?.autoApprove || []
        )
      } else {
        console.error(`[ToolManager] Server configuration not found for: ${serverName}`)
      }
    } catch (error) {
      console.error('[ToolManager] Failed to update server permissions:', error)
    }
  }
}
