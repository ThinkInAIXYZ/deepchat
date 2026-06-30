import logger from '@shared/logger'
import { eventBus } from '@/eventbus'
import { MCP_EVENTS } from '@/events'
import {
  MCPToolCall,
  MCPToolDefinition,
  MCPToolResponse,
  MCPContentItem,
  MCPTextContent,
  IConfigPresenter,
  MCPServerConfig,
  Resource
} from '@shared/presenter'
import { ServerManager } from './serverManager'
import { McpClient } from './mcpClient'
import { jsonrepair } from 'jsonrepair'
import { getErrorMessageLabels } from '@shared/i18n'
import { presenter } from '@/presenter'
import { getPluginToolPolicy } from '@/presenter/pluginPresenter/toolPolicyStore'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'

const CUA_PLUGIN_ID = 'com.deepchat.plugins.cua'

type McpToolAccessContext = {
  enabledTools?: string[]
  enabledServerIds?: string[]
  enabledPluginIds?: string[]
  agentId?: string
  conversationId?: string
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
    enabledPluginIds: normalizeStringList(input?.enabledPluginIds),
    agentId: input?.agentId?.trim() || undefined,
    conversationId: input?.conversationId?.trim() || undefined
  }
}

export class ToolManager {
  private configPresenter: IConfigPresenter
  private serverManager: ServerManager
  private cachedToolDefinitions: MCPToolDefinition[] | null = null
  private toolNameToTargetMap: Map<string, { client: McpClient; originalName: string }> | null =
    null
  // Session-scoped permission cache: conversationId -> Set of "serverName:permissionType"
  private sessionPermissions = new Map<string, Set<string>>()

  constructor(configPresenter: IConfigPresenter, serverManager: ServerManager) {
    this.configPresenter = configPresenter
    this.serverManager = serverManager
    eventBus.on(MCP_EVENTS.CLIENT_LIST_UPDATED, this.handleServerListUpdate)
    eventBus.on(MCP_EVENTS.CONFIG_CHANGED, this.handleConfigChange)
  }

  private handleServerListUpdate = (): void => {
    console.info('MCP client list updated, clearing tool definitions cache and target map.')
    this.cachedToolDefinitions = null
    this.toolNameToTargetMap = null
  }

  private handleConfigChange = (): void => {
    console.info('MCP configuration changed, clearing cached data.')
    this.cachedToolDefinitions = null
    this.toolNameToTargetMap = null
  }

  private isPluginOwnedClient(client: McpClient): boolean {
    const serverConfig = client.serverConfig as {
      ownerPluginId?: unknown
      source?: unknown
    }
    return Boolean(serverConfig.ownerPluginId || serverConfig.source === 'plugin')
  }

  private isCuaComputerUseServer(client: McpClient, serverConfig?: MCPServerConfig): boolean {
    const clientConfig = client.serverConfig as {
      ownerPluginId?: unknown
      sourceId?: unknown
    }
    const ownerPluginId = serverConfig?.ownerPluginId ?? clientConfig.ownerPluginId
    const sourceId = serverConfig?.sourceId ?? clientConfig.sourceId
    return ownerPluginId === CUA_PLUGIN_ID || sourceId === CUA_PLUGIN_ID
  }

  public async getRunningClients(): Promise<McpClient[]> {
    return this.serverManager.getRunningClients()
  }
  // Get all tool definitions
  public async getAllToolDefinitions(
    access?: string[] | McpToolAccessContext
  ): Promise<MCPToolDefinition[]> {
    const context = normalizeToolAccessContext(access)
    if (this.cachedToolDefinitions !== null && this.cachedToolDefinitions.length > 0) {
      return this.filterToolDefinitionsByContext(this.cachedToolDefinitions, context)
    }

    console.info('Fetching/refreshing tool definitions and target map...')
    const clients = await this.serverManager.getRunningClients()
    const results: MCPToolDefinition[] = []
    // Initialize/clear the map before processing
    if (this.toolNameToTargetMap) {
      this.toolNameToTargetMap.clear() // Clear existing map
    } else {
      this.toolNameToTargetMap = new Map() // Initialize if null
    }

    if (!clients || clients.length === 0) {
      console.warn('No running MCP clients found.')
      this.cachedToolDefinitions = []
      // Map is already cleared or initialized as empty
      return this.cachedToolDefinitions
    }

    const toolNameToServerMap: Map<string, string> = new Map()
    const toolsToRename: Map<string, Set<string>> = new Map()

    // Pass 1: Detect conflicts
    for (const client of clients) {
      try {
        const clientTools = await client.listTools()
        this.serverManager.clearServerLastError(client.serverName)
        if (!clientTools) continue

        const currentServerRenames: Set<string> = toolsToRename.get(client.serverName) || new Set()

        for (const tool of clientTools) {
          if (toolNameToServerMap.has(tool.name)) {
            const originalServerName = toolNameToServerMap.get(tool.name)!
            if (originalServerName !== client.serverName) {
              console.warn(
                `Conflict detected for tool '${tool.name}' between server '${originalServerName}' and '${client.serverName}'. Marking for rename.`
              )
              // Mark original tool for rename
              const originalServerRenames = toolsToRename.get(originalServerName) || new Set()
              originalServerRenames.add(tool.name)
              toolsToRename.set(originalServerName, originalServerRenames)
              // Mark current tool for rename
              currentServerRenames.add(tool.name)
            }
          } else {
            toolNameToServerMap.set(tool.name, client.serverName)
          }
        }
        if (currentServerRenames.size > 0) {
          toolsToRename.set(client.serverName, currentServerRenames)
        }
      } catch (error: unknown) {
        // Log error and notify, but continue conflict detection with other clients
        const errorMessage = error instanceof Error ? error.message : String(error)
        const serverName = client.serverName || 'Unknown server'
        console.error(
          `Pass 1 Error: Failed to get tool list from server '${serverName}':`,
          errorMessage
        )
        this.serverManager.setServerLastError(serverName, errorMessage)
        if (!this.isPluginOwnedClient(client)) {
          // Send notification for normal MCP servers. Plugin-owned MCP errors are shown in
          // plugin status surfaces instead of global toasts.
          const locale = this.configPresenter.getLanguage?.() || 'zh-CN'
          const errorMessages = getErrorMessageLabels(locale)
          const formattedMessage =
            errorMessages.getMcpToolListErrorMessage
              ?.replace('{serverName}', serverName)
              .replace('{errorMessage}', errorMessage) ||
            `Failed to get tool list from server '${serverName}': ${errorMessage}`
          publishDeepchatEvent('notification.error', {
            title: errorMessages.getMcpToolListErrorTitle || 'Failed to get tool definitions',
            message: formattedMessage,
            id: `mcp-error-pass1-${serverName}-${Date.now()}`,
            type: 'error'
          })
        }
        continue // Continue to next client
      }
    }

    // Pass 2: Build results with renaming AND populate the target map
    for (const client of clients) {
      try {
        const clientTools = await client.listTools()
        this.serverManager.clearServerLastError(client.serverName)
        if (!clientTools) continue

        const renamesForThisServer = toolsToRename.get(client.serverName) || new Set()

        for (const tool of clientTools) {
          let finalName = tool.name
          let finalDescription = tool.description
          const originalName = tool.name

          if (renamesForThisServer.has(originalName)) {
            finalName = `${client.serverName}_${originalName}`
            finalDescription = `[${client.serverName}] ${tool.description}`
          }

          // Validate the final name against the allowed pattern
          const namePattern = /^[a-zA-Z0-9_-]+$/
          if (!namePattern.test(finalName)) {
            console.error(
              `Generated tool name '${finalName}' is invalid. Skipping tool '${originalName}' from server '${client.serverName}'. Please ensure the tool name matches the allowed pattern: /^[a-zA-Z0-9_-]+$/`
            )
            continue // Skip adding this tool
          }

          const properties = tool.inputSchema.properties || {}
          const toolProperties = { ...properties }
          for (const key in toolProperties) {
            if (!toolProperties[key].description) {
              toolProperties[key].description = 'Params of ' + key
            }
          }

          results.push({
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
              name: client.serverName,
              icons: client.serverConfig.icons as string,
              description: client.serverConfig.descriptions as string
            }
          })

          // Populate the target map
          if (this.toolNameToTargetMap) {
            this.toolNameToTargetMap.set(finalName, { client: client, originalName: originalName })
          }
        }
      } catch (error: unknown) {
        // Log error but continue building results from other clients
        const errorMessage = error instanceof Error ? error.message : String(error)
        const serverName = client.serverName || 'Unknown server'
        console.error(
          `Pass 2 Error: Error processing tools from server '${serverName}':`,
          errorMessage
        )
        this.serverManager.setServerLastError(serverName, errorMessage)
        // Maybe skip adding tools from this client if listTools fails here again,
        // though it succeeded in Pass 1. Or rely on the notification from Pass 1.
        continue // Continue to next client
      }
    }

    // Cache results and return
    this.cachedToolDefinitions = results
    console.info(`Cached ${results.length} final tool definitions and populated target map.`)

    return this.filterToolDefinitionsByContext(this.cachedToolDefinitions, context)
  }

  private filterToolDefinitionsByContext(
    toolDefinitions: MCPToolDefinition[],
    context: McpToolAccessContext
  ): MCPToolDefinition[] {
    if (!context.enabledTools && !context.enabledServerIds && !context.enabledPluginIds) {
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
    const serverConfig = this.getServerConfigFromTargetMap(serverName)
    if (!serverConfig) {
      return !context.enabledServerIds || context.enabledServerIds.includes(serverName)
    }
    return this.isServerConfigAllowedByContext(serverName, serverConfig, context)
  }

  private isServerConfigAllowedByContext(
    serverName: string,
    serverConfig: MCPServerConfig,
    context: McpToolAccessContext
  ): boolean {
    const ownerPluginId =
      serverConfig.ownerPluginId?.trim() ||
      (serverConfig.source === 'plugin' ? serverConfig.sourceId?.trim() : undefined)
    if (ownerPluginId) {
      return !context.enabledPluginIds || context.enabledPluginIds.includes(ownerPluginId)
    }
    return !context.enabledServerIds || context.enabledServerIds.includes(serverName)
  }

  private getServerConfigFromTargetMap(serverName: string): MCPServerConfig | undefined {
    for (const target of this.toolNameToTargetMap?.values() ?? []) {
      if (target.client.serverName === serverName) {
        return target.client.serverConfig as unknown as MCPServerConfig
      }
    }
    return undefined
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

  private async resolveAcpSessionContext(conversationId?: string): Promise<{
    agentId: string
    providerId: string
    projectDir: string | null
  } | null> {
    const sessionId = conversationId?.trim()
    if (!sessionId) {
      return null
    }

    try {
      const session = await presenter.agentSessionPresenter.getSession(sessionId)
      const agentId = session?.agentId?.trim()
      const providerId = session?.providerId?.trim()
      if (session && providerId === 'acp' && agentId) {
        return {
          agentId,
          providerId,
          projectDir: session.projectDir?.trim() || null
        }
      }

      return null
    } catch (error) {
      console.warn('[ToolManager] Failed to resolve new session MCP context:', error)
      return null
    }
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

    const permissionType = this.determinePermissionType(originalToolName)
    logger.info(`[ToolManager] Tool '${originalToolName}' requires '${permissionType}' permission`)

    // 1. 优先检查 session 级别的内存权限（当前会话自动执行）
    if (conversationId && this.checkSessionPermission(conversationId, serverName, permissionType)) {
      logger.info(
        `[ToolManager] Permission granted via session cache: server '${serverName}' has '${permissionType}' permission`
      )
      return true
    }

    // 2. Plugin-owned exact policies override persisted server auto-approve settings.
    const pluginPolicy = getPluginToolPolicy(serverName, originalToolName)
    if (pluginPolicy === 'allow') {
      logger.info(
        `[ToolManager] Permission granted by plugin tool policy: ${serverName}.${originalToolName}`
      )
      return true
    }
    if (pluginPolicy === 'ask' || pluginPolicy === 'deny') {
      logger.info(
        `[ToolManager] Permission blocked by plugin tool policy '${pluginPolicy}': ${serverName}.${originalToolName}`
      )
      return false
    }

    // 3. 检查持久化的 'all' 权限
    if (autoApprove.includes('all')) {
      logger.info(`[ToolManager] Permission granted: server '${serverName}' has 'all' permissions`)
      return true
    }

    // 4. 检查持久化的特定权限类型
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
    access?: Pick<McpToolAccessContext, 'agentId' | 'enabledServerIds' | 'enabledPluginIds'>
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
    const finalName = toolCall.function.name

    // Ensure definitions and map are loaded/cached
    await this.getAllToolDefinitions()

    if (!this.toolNameToTargetMap) {
      console.error('[ToolManager] Tool target map is not available for permission check.')
      return null
    }

    const targetInfo = this.toolNameToTargetMap.get(finalName)

    if (!targetInfo) {
      console.error(`[ToolManager] Tool '${finalName}' not found for permission check.`)
      return null
    }

    const { originalName } = targetInfo
    const toolServerName = targetInfo.client.serverName

    // Get server config to check auto-approve settings
    const servers = await this.configPresenter.getMcpServers()
    const serverConfig = servers[toolServerName]
    const accessContext = normalizeToolAccessContext({
      agentId: access?.agentId,
      enabledServerIds: access?.enabledServerIds,
      enabledPluginIds: access?.enabledPluginIds,
      conversationId: toolCall.conversationId
    })
    if (
      serverConfig &&
      !this.isServerConfigAllowedByContext(toolServerName, serverConfig, accessContext)
    ) {
      return null
    }
    const autoApprove = serverConfig?.autoApprove || []
    const pluginPolicy = getPluginToolPolicy(toolServerName, originalName)

    if (pluginPolicy === 'deny') {
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
    access?: Pick<McpToolAccessContext, 'agentId' | 'enabledServerIds' | 'enabledPluginIds'>
  ): Promise<MCPToolResponse> {
    try {
      const finalName = toolCall.function.name
      const argsString = toolCall.function.arguments

      logger.info(`[ToolManager] Calling tool:`, {
        requestedName: finalName,
        originalName: finalName,
        serverName: toolCall.server?.name || 'unknown',
        rawArguments: argsString
      })

      // Ensure definitions and map are loaded/cached
      await this.getAllToolDefinitions()

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

      const { client: targetClient, originalName } = targetInfo
      const toolServerName = targetClient.serverName
      const accessContext = normalizeToolAccessContext({
        agentId: access?.agentId,
        enabledServerIds: access?.enabledServerIds,
        enabledPluginIds: access?.enabledPluginIds,
        conversationId: toolCall.conversationId
      })
      const hintedProviderId = toolCall.providerId?.trim()
      const shouldResolveAcpContext =
        Boolean(toolCall.conversationId) && (!hintedProviderId || hintedProviderId === 'acp')

      // ACP agent-level MCP access control resolves from session context, not global chat mode.
      if (shouldResolveAcpContext && toolCall.conversationId) {
        try {
          const acpContext = await this.resolveAcpSessionContext(toolCall.conversationId)
          if (acpContext?.providerId === 'acp' && acpContext.agentId) {
            const acpAgents = await this.configPresenter.getAcpAgents()
            if (acpAgents.some((item) => item.id === acpContext.agentId)) {
              const selections = await this.configPresenter.getAgentMcpSelections(
                acpContext.agentId
              )
              if (!selections?.length || !selections.includes(toolServerName)) {
                return {
                  toolCallId: toolCall.id,
                  content: `MCP server '${toolServerName}' is not allowed for ACP agent '${acpContext.agentId}'. Configure MCP access in ACP settings.`,
                  isError: true
                }
              }
            }
          }
        } catch (error) {
          console.warn(
            '[ToolManager] Failed to resolve ACP agent context for MCP access control:',
            error
          )
        }
      }

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
      const servers = await this.configPresenter.getMcpServers()
      const serverConfig = servers[toolServerName]
      if (!serverConfig) {
        console.error(`Configuration for server '${toolServerName}' not found.`)
        return {
          toolCallId: toolCall.id,
          content: `Error: Configuration missing for server '${toolServerName}'.`,
          isError: true
        }
      }
      if (!this.isServerConfigAllowedByContext(toolServerName, serverConfig, accessContext)) {
        return {
          toolCallId: toolCall.id,
          content: `MCP server '${toolServerName}' is not allowed for DeepChat agent '${accessContext.agentId ?? 'unknown'}'. Configure MCP access in DeepChat agent settings.`,
          isError: true
        }
      }
      const autoApprove = serverConfig?.autoApprove || []
      const pluginPolicy = getPluginToolPolicy(toolServerName, originalName)
      if (pluginPolicy === 'deny') {
        return {
          toolCallId: toolCall.id,
          content: `Tool '${originalName}' on server '${toolServerName}' is blocked by plugin policy.`,
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

      const preparedArgs = await this.prepareToolArguments(
        targetClient,
        serverConfig,
        originalName,
        args || {}
      )
      if (!preparedArgs.ok) {
        return {
          toolCallId: toolCall.id,
          content: `Error: ${preparedArgs.error}`,
          isError: true
        }
      }

      // Call the tool on the target client using the ORIGINAL name
      const result = await targetClient.callTool(originalName, preparedArgs.args)

      // Format response
      let formattedContent: string | MCPContentItem[] = ''
      if (typeof result.content === 'string') {
        formattedContent = result.content
      } else if (Array.isArray(result.content)) {
        formattedContent = result.content.map((item): MCPContentItem => {
          if (typeof item === 'string') {
            return { type: 'text', text: item } as MCPTextContent
          }
          if (item.type === 'text' || item.type === 'image' || item.type === 'resource') {
            return item as MCPContentItem
          }
          if (item.type && item.text) {
            return { type: 'text', text: item.text } as MCPTextContent
          }
          return { type: 'text', text: JSON.stringify(item) } as MCPTextContent
        })
      } else if (result.content) {
        formattedContent = JSON.stringify(result.content)
      }

      const response: MCPToolResponse = {
        toolCallId: toolCall.id,
        content: formattedContent,
        isError: result.isError
      }

      publishDeepchatEvent('mcp.toolCall.result', {
        functionName: toolCall.function.name,
        content: response.content,
        version: Date.now()
      })

      return response
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Unhandled error during tool call:', error)
      return {
        toolCallId: toolCall.id,
        content: `Error: Failed to execute tool '${toolCall.function.name}': ${errorMessage}`,
        isError: true
      }
    }
  }

  private async prepareToolArguments(
    client: McpClient,
    serverConfig: MCPServerConfig,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ ok: true; args: Record<string, unknown> } | { ok: false; error: string }> {
    if (
      toolName !== 'launch_app' ||
      process.platform !== 'win32' ||
      !this.isCuaComputerUseServer(client, serverConfig)
    ) {
      return { ok: true, args }
    }

    return await this.prepareCuaWindowsLaunchArgs(client, args)
  }

  private async prepareCuaWindowsLaunchArgs(
    client: McpClient,
    args: Record<string, unknown>
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

    const apps = await this.listCuaWindowsApps(client)
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
    client: McpClient
  ): Promise<Array<Record<string, unknown>> | null> {
    try {
      const result = (await client.callTool('list_apps', {})) as {
        structuredContent?: unknown
        content?: unknown
      }
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
    conversationId?: string
  ): Promise<void> {
    logger.info(
      `[ToolManager] Granting permission: ${permissionType} for server: ${serverName}, remember: ${remember}, conversationId: ${conversationId}`
    )

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
      const servers = await this.configPresenter.getMcpServers()
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
        await this.configPresenter.updateMcpServer(serverName, {
          ...serverConfig,
          autoApprove
        })

        logger.info(
          `[ToolManager] Successfully updated server ${serverName} permissions to:`,
          autoApprove
        )

        // Verify the update by reading back
        const updatedServers = await this.configPresenter.getMcpServers()
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

  public destroy(): void {
    eventBus.off(MCP_EVENTS.CLIENT_LIST_UPDATED, this.handleServerListUpdate)
    eventBus.off(MCP_EVENTS.CONFIG_CHANGED, this.handleConfigChange)
  }
}
