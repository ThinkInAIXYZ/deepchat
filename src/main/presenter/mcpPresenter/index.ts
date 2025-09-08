import {
  IMCPPresenter,
  MCPServerConfig,
  MCPToolDefinition,
  MCPToolCall,
  McpClient,
  MCPToolResponse,
  Prompt,
  ResourceListEntry,
  Resource,
  PromptListEntry
} from '@shared/presenter'
import { ServerManager } from './serverManager'
import { ToolManager } from './toolManager'
import { McpRouterManager } from './mcprouterManager'
import { eventBus, SendTarget } from '@/eventbus'
import { MCP_EVENTS, NOTIFICATION_EVENTS } from '@/events'
import { IConfigPresenter } from '@shared/presenter'
import { getErrorMessageLabels } from '@shared/i18n'
import { OpenAI } from 'openai'
import { ToolListUnion, Type, FunctionDeclaration } from '@google/genai'
import { presenter } from '@/presenter'

// Define MCP tool interface
interface MCPTool {
  id: string
  name: string
  type: string
  description: string
  serverName: string
  inputSchema: {
    properties: Record<string, Record<string, unknown>>
    required: string[]
    [key: string]: unknown
  }
}

// Define tool type interfaces for various LLM providers
interface OpenAIToolCall {
  function: {
    name: string
    arguments: string
  }
}

interface AnthropicToolUse {
  name: string
  input: Record<string, unknown>
}

interface GeminiFunctionCall {
  name: string
  args: Record<string, unknown>
}

// Define tool conversion interfaces
interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: string
      properties: Record<string, Record<string, unknown>>
      required: string[]
    }
  }
}

interface AnthropicTool {
  name: string
  description: string
  input_schema: {
    type: string
    properties: Record<string, Record<string, unknown>>
    required: string[]
  }
}

// Complete McpPresenter implementation
export class McpPresenter implements IMCPPresenter {
  private serverManager: ServerManager
  private toolManager: ToolManager
  private configPresenter: IConfigPresenter
  private isInitialized: boolean = false
  // McpRouter
  private mcprouter?: McpRouterManager

  constructor(configPresenter?: IConfigPresenter) {
    console.log('Initializing MCP Presenter')

    this.configPresenter = configPresenter || presenter.configPresenter
    this.serverManager = new ServerManager(this.configPresenter)
    this.toolManager = new ToolManager(this.configPresenter, this.serverManager)
    // init mcprouter manager
    try {
      this.mcprouter = new McpRouterManager(this.configPresenter)
    } catch (e) {
      console.warn('[MCP] McpRouterManager init failed:', e)
    }

    // Delayed initialization to ensure other components are ready
    setTimeout(() => {
      this.initialize()
    }, 1000)
  }

  private async initialize() {
    try {
      // If no configPresenter is provided, get it from presenter
      if (!this.configPresenter.getLanguage) {
        // Recreate managers
        this.serverManager = new ServerManager(this.configPresenter)
        this.toolManager = new ToolManager(this.configPresenter, this.serverManager)
      }

      // Load configuration
      const [servers, defaultServers] = await Promise.all([
        this.configPresenter.getMcpServers(),
        this.configPresenter.getMcpDefaultServers()
      ])

      // Initialize npm registry (prefer cache if available)
      console.log('[MCP] Initializing npm registry...')
      try {
        await this.serverManager.testNpmRegistrySpeed(true)
        console.log(`[MCP] npm registry initialized: ${this.serverManager.getNpmRegistry()}`)
      } catch (error) {
        console.error('[MCP] npm registry initialization failed:', error)
      }

      // Check and start deepchat-inmemory/custom-prompts-server
      const customPromptsServerName = 'deepchat-inmemory/custom-prompts-server'
      if (servers[customPromptsServerName]) {
        console.log(`[MCP] Attempting to start custom prompts server: ${customPromptsServerName}`)

        try {
          await this.serverManager.startServer(customPromptsServerName)
          console.log(`[MCP] Custom prompts server ${customPromptsServerName} started successfully`)

          // Notify renderer process that server has started
          eventBus.send(MCP_EVENTS.SERVER_STARTED, SendTarget.ALL_WINDOWS, customPromptsServerName)
        } catch (error) {
          console.error(
            `[MCP] Failed to start custom prompts server ${customPromptsServerName}:`,
            error
          )
        }
      }

      // If there are default servers, attempt to start them
      if (defaultServers.length > 0) {
        for (const serverName of defaultServers) {
          if (servers[serverName]) {
            console.log(`[MCP] Attempting to start default server: ${serverName}`)

            try {
              await this.serverManager.startServer(serverName)
              console.log(`[MCP] Default server ${serverName} started successfully`)

              // Notify renderer process that server has started
              eventBus.send(MCP_EVENTS.SERVER_STARTED, SendTarget.ALL_WINDOWS, serverName)
            } catch (error) {
              console.error(`[MCP] Failed to start default server ${serverName}:`, error)
            }
          }
        }
      }

      // Mark initialization complete and emit event
      this.isInitialized = true
      console.log('[MCP] Initialization completed')
      eventBus.send(MCP_EVENTS.INITIALIZED, SendTarget.ALL_WINDOWS)

      this.scheduleBackgroundRegistryUpdate()
    } catch (error) {
      console.error('[MCP] Initialization failed:', error)
      // Mark as complete even if initialization fails to avoid system stuck in uninitialized state
      this.isInitialized = true
      eventBus.send(MCP_EVENTS.INITIALIZED, SendTarget.ALL_WINDOWS)
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
    return this.configPresenter.getSetting<string>('mcprouterApiKey') || ''
  }

  async setMcpRouterApiKey(key: string): Promise<void> {
    this.configPresenter.setSetting('mcprouterApiKey', key)
  }

  async isServerInstalled(source: string, sourceId: string): Promise<boolean> {
    const servers = await this.configPresenter.getMcpServers()
    for (const config of Object.values(servers)) {
      if (config.source === source && config.sourceId === sourceId) {
        return true
      }
    }
    return false
  }

  async updateMcpRouterServersAuth(apiKey: string): Promise<void> {
    const servers = await this.configPresenter.getMcpServers()
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
      await this.configPresenter.updateMcpServer(update.name, update.config)
    }

    console.log(`Updated Authorization for ${updates.length} mcprouter servers`)
  }

  private scheduleBackgroundRegistryUpdate(): void {
    setTimeout(async () => {
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
    return this.configPresenter.getMcpServers()
  }

  // Get all MCP servers
  async getMcpClients(): Promise<McpClient[]> {
    const clients = await this.toolManager.getRunningClients()
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

  // Get all default MCP servers
  getMcpDefaultServers(): Promise<string[]> {
    return this.configPresenter.getMcpDefaultServers()
  }

  // Add default MCP server
  async addMcpDefaultServer(serverName: string): Promise<void> {
    await this.configPresenter.addMcpDefaultServer(serverName)
  }

  // Remove default MCP server
  async removeMcpDefaultServer(serverName: string): Promise<void> {
    await this.configPresenter.removeMcpDefaultServer(serverName)
  }

  // Toggle server default status
  async toggleMcpDefaultServer(serverName: string): Promise<void> {
    await this.configPresenter.toggleMcpDefaultServer(serverName)
  }

  // Add MCP server
  async addMcpServer(serverName: string, config: MCPServerConfig): Promise<boolean> {
    const existingServers = await this.getMcpServers()
    if (existingServers[serverName]) {
      console.error(`[MCP] Failed to add server: Server name "${serverName}" already exists.`)
      // Get current language and send notification
      const locale = this.configPresenter.getLanguage?.() || 'zh-CN'
      const errorMessages = getErrorMessageLabels(locale)
      eventBus.sendToRenderer(NOTIFICATION_EVENTS.SHOW_ERROR, SendTarget.ALL_WINDOWS, {
        title: errorMessages.addMcpServerErrorTitle || 'Failed to add server',
        message:
          errorMessages.addMcpServerDuplicateMessage?.replace('{serverName}', serverName) ||
          `Server name "${serverName}" already exists. Please choose a different name.`,
        id: `mcp-error-add-server-${serverName}-${Date.now()}`,
        type: 'error'
      })
      return false
    }
    await this.configPresenter.addMcpServer(serverName, config)
    return true
  }

  // Update MCP server configuration
  async updateMcpServer(serverName: string, config: Partial<MCPServerConfig>): Promise<void> {
    const wasRunning = this.serverManager.isServerRunning(serverName)
    await this.configPresenter.updateMcpServer(serverName, config)

    // If server was previously running, restart it to apply new configuration
    if (wasRunning) {
      console.log(`[MCP] Configuration updated, restarting server: ${serverName}`)
      try {
        await this.stopServer(serverName) // stopServer will emit SERVER_STOPPED event
        await this.startServer(serverName) // startServer will emit SERVER_STARTED event
        console.log(`[MCP] Server ${serverName} restarted successfully`)
      } catch (error) {
        console.error(`[MCP] Failed to restart server ${serverName}:`, error)
        // Even if restart fails, ensure correct state by marking as not running
        eventBus.send(MCP_EVENTS.SERVER_STOPPED, SendTarget.ALL_WINDOWS, serverName)
      }
    }
  }

  // Remove MCP server
  async removeMcpServer(serverName: string): Promise<void> {
    // If server is running, stop it first
    if (await this.isServerRunning(serverName)) {
      await this.stopServer(serverName)
    }
    await this.configPresenter.removeMcpServer(serverName)
  }

  async isServerRunning(serverName: string): Promise<boolean> {
    return Promise.resolve(this.serverManager.isServerRunning(serverName))
  }

  async startServer(serverName: string): Promise<void> {
    await this.serverManager.startServer(serverName)
    // Notify renderer process that server has started
    eventBus.send(MCP_EVENTS.SERVER_STARTED, SendTarget.ALL_WINDOWS, serverName)
  }

  async stopServer(serverName: string): Promise<void> {
    await this.serverManager.stopServer(serverName)
    // Notify renderer process that server has stopped
    eventBus.send(MCP_EVENTS.SERVER_STOPPED, SendTarget.ALL_WINDOWS, serverName)
  }
  async getAllToolDefinitions(enabledMcpTools?: string[]): Promise<MCPToolDefinition[]> {
    const enabled = await this.configPresenter.getMcpEnabled()
    if (enabled) {
      return await this.toolManager.getAllToolDefinitions(enabledMcpTools)
    }
    return []
  }

  /**
   * 获取所有客户端的提示模板，并附加客户端信息
   * @returns 所有提示模板列表，每个提示模板附带所属客户端信息
   */
  async getAllPrompts(): Promise<Array<PromptListEntry>> {
    const enabled = await this.configPresenter.getMcpEnabled()
    if (!enabled) {
      return []
    }

    const clients = await this.toolManager.getRunningClients()
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
    const enabled = await this.configPresenter.getMcpEnabled()
    if (!enabled) {
      return []
    }

    const clients = await this.toolManager.getRunningClients()
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

  async callTool(request: MCPToolCall): Promise<{ content: string; rawData: MCPToolResponse }> {
    const toolCallResult = await this.toolManager.callTool(request)

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

    return { content: formattedContent, rawData: toolCallResult }
  }

  // Convert MCPToolDefinition to MCPTool
  private mcpToolDefinitionToMcpTool(
    toolDefinition: MCPToolDefinition,
    serverName: string
  ): MCPTool {
    const mcpTool = {
      id: toolDefinition.function.name,
      name: toolDefinition.function.name,
      type: toolDefinition.type,
      description: toolDefinition.function.description,
      serverName,
      inputSchema: {
        properties: toolDefinition.function.parameters.properties as Record<
          string,
          Record<string, unknown>
        >,
        type: toolDefinition.function.parameters.type,
        required: toolDefinition.function.parameters.required
      }
    } as MCPTool
    return mcpTool
  }

  // Tool properties filter function
  private filterPropertieAttributes(tool: MCPTool): Record<string, Record<string, unknown>> {
    const supportedAttributes = [
      'type',
      'nullable',
      'description',
      'properties',
      'items',
      'enum',
      'anyOf'
    ]

    const properties = tool.inputSchema.properties

    // Recursive cleanup function to ensure all values are serializable
    const cleanValue = (value: unknown): unknown => {
      if (value === null || value === undefined) {
        return value
      }

      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value
      }

      if (Array.isArray(value)) {
        return value.map(cleanValue)
      }

      if (typeof value === 'object') {
        const cleaned: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          cleaned[k] = cleanValue(v)
        }
        return cleaned
      }

      // For functions, Symbols and other non-serializable values, return string representation
      return String(value)
    }

    const getSubMap = (obj: Record<string, unknown>, keys: string[]): Record<string, unknown> => {
      const filtered = Object.fromEntries(Object.entries(obj).filter(([key]) => keys.includes(key)))
      const cleaned: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(filtered)) {
        if (key === 'type') {
          // Handle type property specifically to ensure it has a valid value
          const typeValue = cleanValue(value)
          if (
            !typeValue ||
            typeof typeValue !== 'string' ||
            typeValue.trim() === '' ||
            typeValue.toLowerCase() === 'any' ||
            typeValue.toLowerCase() === 'unknown'
          ) {
            // Set to 'string' if type is missing, empty, 'any', or 'unknown'
            cleaned[key] = 'string'
          } else {
            // Validate that it's a supported JSON Schema type
            const supportedTypes = [
              'string',
              'number',
              'integer',
              'boolean',
              'array',
              'object',
              'null'
            ]
            if (supportedTypes.includes(typeValue.toLowerCase())) {
              cleaned[key] = typeValue.toLowerCase()
            } else {
              // If it's not a supported type, default to 'string'
              cleaned[key] = 'string'
            }
          }
        } else {
          cleaned[key] = cleanValue(value)
        }
      }

      // Ensure type property exists if it was supposed to be included
      if (keys.includes('type') && !cleaned.hasOwnProperty('type')) {
        cleaned.type = 'string'
      }

      return cleaned
    }

    const result: Record<string, Record<string, unknown>> = {}
    for (const [key, val] of Object.entries(properties)) {
      if (typeof val === 'object' && val !== null) {
        result[key] = getSubMap(val as Record<string, unknown>, supportedAttributes)
      }
    }

    return result
  }

  // New tool conversion methods
  /**
   * Convert MCP tool definitions to OpenAI tool format
   * @param mcpTools Array of MCP tool definitions
   * @param serverName Server name
   * @returns Tool definitions in OpenAI tool format
   */
  async mcpToolsToOpenAITools(
    mcpTools: MCPToolDefinition[],
    serverName: string
  ): Promise<OpenAITool[]> {
    const openaiTools: OpenAITool[] = mcpTools.map((toolDef) => {
      const tool = this.mcpToolDefinitionToMcpTool(toolDef, serverName)
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'object',
            properties: this.filterPropertieAttributes(tool),
            required: tool.inputSchema.required || []
          }
        }
      }
    })
    // console.log('openaiTools', JSON.stringify(openaiTools))
    return openaiTools
  }

  /**
   * Convert OpenAI tool call back to MCP tool call
   * @param mcpTools Array of MCP tool definitions
   * @param llmTool OpenAI tool call
   * @param serverName Server name
   * @returns Matching MCP tool call
   */
  async openAIToolsToMcpTool(
    llmTool: OpenAIToolCall,
    providerId: string
  ): Promise<MCPToolCall | undefined> {
    const mcpTools = await this.getAllToolDefinitions()
    const tool = mcpTools.find((tool) => tool.function.name === llmTool.function.name)
    if (!tool) {
      return undefined
    }

    // Create MCP tool call
    const mcpToolCall: MCPToolCall = {
      id: `${providerId}:${tool.function.name}-${Date.now()}`, // Generate unique ID including server name
      type: tool.type,
      function: {
        name: tool.function.name,
        arguments: llmTool.function.arguments
      },
      server: {
        name: tool.server.name,
        icons: tool.server.icons,
        description: tool.server.description
      }
    }
    // console.log('mcpToolCall', mcpToolCall, tool)

    return mcpToolCall
  }

  /**
   * Convert MCP tool definitions to Anthropic tool format
   * @param mcpTools Array of MCP tool definitions
   * @param serverName Server name
   * @returns Tool definitions in Anthropic tool format
   */
  async mcpToolsToAnthropicTools(
    mcpTools: MCPToolDefinition[],
    serverName: string
  ): Promise<AnthropicTool[]> {
    return mcpTools.map((toolDef) => {
      const tool = this.mcpToolDefinitionToMcpTool(toolDef, serverName)
      return {
        name: tool.name,
        description: tool.description,
        input_schema: {
          type: 'object',
          properties: this.filterPropertieAttributes(tool),
          required: tool.inputSchema.required as string[]
        }
      }
    })
  }

  /**
   * Convert Anthropic tool use back to MCP tool call
   * @param mcpTools Array of MCP tool definitions
   * @param toolUse Anthropic tool use
   * @param serverName Server name
   * @returns Matching MCP tool call
   */
  async anthropicToolUseToMcpTool(
    toolUse: AnthropicToolUse,
    providerId: string
  ): Promise<MCPToolCall | undefined> {
    const mcpTools = await this.getAllToolDefinitions()

    const tool = mcpTools.find((tool) => tool.function.name === toolUse.name)
    // console.log('tool', tool, toolUse)
    if (!tool) {
      return undefined
    }

    // Create MCP tool call
    const mcpToolCall: MCPToolCall = {
      id: `${providerId}:${tool.function.name}-${Date.now()}`, // Generate unique ID including server name
      type: tool.type,
      function: {
        name: tool.function.name,
        arguments: JSON.stringify(toolUse.input)
      },
      server: {
        name: tool.server.name,
        icons: tool.server.icons,
        description: tool.server.description
      }
    }

    return mcpToolCall
  }

  /**
   * Convert MCP tool definitions to Gemini tool format
   * @param mcpTools Array of MCP tool definitions
   * @param serverName Server name
   * @returns Tool definitions in Gemini tool format
   */
  async mcpToolsToGeminiTools(
    mcpTools: MCPToolDefinition[] | undefined,
    serverName: string
  ): Promise<ToolListUnion> {
    if (!mcpTools || mcpTools.length === 0) {
      return []
    }

    // Recursively clean Schema objects to ensure compliance with Gemini API requirements
    const cleanSchema = (schema: Record<string, unknown>): Record<string, unknown> => {
      const cleanedSchema: Record<string, unknown> = {}

      // Handle type field - ensure always has valid value
      if ('type' in schema) {
        const type = schema.type
        if (typeof type === 'string' && type.trim() !== '') {
          cleanedSchema.type = type
        } else if (Array.isArray(type) && type.length > 0) {
          // If it's a type array, take the first non-empty type
          const validType = type.find((t) => typeof t === 'string' && t.trim() !== '')
          if (validType) {
            cleanedSchema.type = validType
          } else {
            cleanedSchema.type = 'string' // Default type
          }
        } else {
          // If no valid type, infer from other attributes
          if ('enum' in schema) {
            cleanedSchema.type = 'string'
          } else if ('properties' in schema) {
            cleanedSchema.type = 'object'
          } else if ('items' in schema) {
            cleanedSchema.type = 'array'
          } else {
            cleanedSchema.type = 'string' // Default type
          }
        }
      } else {
        // If there's no type field at all, infer from other attributes
        if ('enum' in schema) {
          cleanedSchema.type = 'string'
        } else if ('properties' in schema) {
          cleanedSchema.type = 'object'
        } else if ('items' in schema) {
          cleanedSchema.type = 'array'
        } else if ('anyOf' in schema || 'oneOf' in schema) {
          // For union types, try to infer the most appropriate type
          cleanedSchema.type = 'string' // Default to string
        } else {
          cleanedSchema.type = 'string' // Final default type
        }
      }

      // Handle description
      if ('description' in schema && typeof schema.description === 'string') {
        cleanedSchema.description = schema.description
      }

      // Handle enum
      if ('enum' in schema && Array.isArray(schema.enum)) {
        cleanedSchema.enum = schema.enum
        // Ensure enum type is string
        if (!cleanedSchema.type || cleanedSchema.type === '') {
          cleanedSchema.type = 'string'
        }
      }

      // Handle properties
      if (
        'properties' in schema &&
        typeof schema.properties === 'object' &&
        schema.properties !== null
      ) {
        const properties = schema.properties as Record<string, unknown>
        const cleanedProperties: Record<string, unknown> = {}

        for (const [propName, propValue] of Object.entries(properties)) {
          if (typeof propValue === 'object' && propValue !== null) {
            cleanedProperties[propName] = cleanSchema(propValue as Record<string, unknown>)
          }
        }

        if (Object.keys(cleanedProperties).length > 0) {
          cleanedSchema.properties = cleanedProperties
          cleanedSchema.type = 'object'
        }
      }

      // Handle items (array type)
      if ('items' in schema && typeof schema.items === 'object' && schema.items !== null) {
        cleanedSchema.items = cleanSchema(schema.items as Record<string, unknown>)
        cleanedSchema.type = 'array'
      }

      // Handle nullable
      if ('nullable' in schema && typeof schema.nullable === 'boolean') {
        cleanedSchema.nullable = schema.nullable
      }

      // Handle anyOf/oneOf (union types) - simplify to single type
      if ('anyOf' in schema && Array.isArray(schema.anyOf)) {
        const anyOfOptions = schema.anyOf as Array<Record<string, unknown>>

        // Try to find the most suitable type
        let bestOption = anyOfOptions[0]

        // Prefer options with enum
        for (const option of anyOfOptions) {
          if ('enum' in option && Array.isArray(option.enum)) {
            bestOption = option
            break
          }
        }

        // If no enum, prefer string type
        if (!('enum' in bestOption)) {
          for (const option of anyOfOptions) {
            if (option.type === 'string') {
              bestOption = option
              break
            }
          }
        }

        // Recursively clean the selected option
        const cleanedOption = cleanSchema(bestOption)
        Object.assign(cleanedSchema, cleanedOption)
      }

      // Handle oneOf similar to anyOf
      if ('oneOf' in schema && Array.isArray(schema.oneOf)) {
        const oneOfOptions = schema.oneOf as Array<Record<string, unknown>>
        const bestOption = oneOfOptions[0] || {}
        const cleanedOption = cleanSchema(bestOption)
        Object.assign(cleanedSchema, cleanedOption)
      }

      // Final check: ensure type field is mandatory
      if (!cleanedSchema.type || cleanedSchema.type === '') {
        cleanedSchema.type = 'string'
      }

      return cleanedSchema
    }

    // Process each tool definition to build function declarations that comply with Gemini API
    const functionDeclarations = mcpTools.map((toolDef) => {
      // Convert to internal tool representation
      const tool = this.mcpToolDefinitionToMcpTool(toolDef, serverName)

      // Get parameter properties
      const properties = tool.inputSchema.properties
      const processedProperties: Record<string, Record<string, unknown>> = {}

      // Process each property and apply cleanup function
      for (const [propName, propValue] of Object.entries(properties)) {
        if (typeof propValue === 'object' && propValue !== null) {
          const cleaned = cleanSchema(propValue as Record<string, unknown>)
          // Ensure cleaned property has valid type
          if (cleaned.type && cleaned.type !== '') {
            processedProperties[propName] = cleaned
          } else {
            console.warn(`[MCP] Skipping property ${propName} due to invalid type`)
          }
        }
      }

      // Prepare function declaration structure
      const functionDeclaration: FunctionDeclaration = {
        name: tool.id,
        description: tool.description
      }

      if (Object.keys(processedProperties).length > 0) {
        functionDeclaration.parameters = {
          type: Type.OBJECT,
          properties: processedProperties,
          required: tool.inputSchema.required || []
        }
      }

      // Log functions without parameters
      if (Object.keys(processedProperties).length === 0) {
        console.log(
          `[MCP] Function ${tool.id} has no parameters, providing minimal parameter structure`
        )
      }

      return functionDeclaration
    })

    // Return result in Gemini tool format
    return [
      {
        functionDeclarations
      }
    ]
  }

  /**
   * Convert Gemini function call back to MCP tool call
   * @param mcpTools Array of MCP tool definitions
   * @param fcall Gemini function call
   * @param serverName Server name
   * @returns Matching MCP tool call
   */
  async geminiFunctionCallToMcpTool(
    fcall: GeminiFunctionCall | undefined,
    providerId: string
  ): Promise<MCPToolCall | undefined> {
    const mcpTools = await this.getAllToolDefinitions()
    if (!fcall) return undefined
    if (!mcpTools) return undefined

    const tool = mcpTools.find((tool) => tool.function.name === fcall.name)
    if (!tool) {
      return undefined
    }

    // Create MCP tool call
    const mcpToolCall: MCPToolCall = {
      id: `${providerId}:${tool.function.name}-${Date.now()}`, // Generate unique ID including server name
      type: tool.type,
      function: {
        name: tool.function.name,
        arguments: JSON.stringify(fcall.args)
      },
      server: {
        name: tool.server.name,
        icons: tool.server.icons,
        description: tool.server.description
      }
    }

    return mcpToolCall
  }

  // Get MCP enabled status
  async getMcpEnabled(): Promise<boolean> {
    return this.configPresenter.getMcpEnabled()
  }

  // Set MCP enabled status
  async setMcpEnabled(enabled: boolean): Promise<void> {
    await this.configPresenter?.setMcpEnabled(enabled)
  }

  async resetToDefaultServers(): Promise<void> {
    await this.configPresenter?.getMcpConfHelper().resetToDefaultServers()
  }

  /**
   * Get specified prompt template
   * @param prompt Prompt template object (containing client information)
   * @param params Prompt template parameters
   * @returns Prompt template content
   */
  async getPrompt(prompt: PromptListEntry, args?: Record<string, unknown>): Promise<unknown> {
    const enabled = await this.configPresenter.getMcpEnabled()
    if (!enabled) {
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
    const enabled = await this.configPresenter.getMcpEnabled()
    if (!enabled) {
      throw new Error('MCP functionality is disabled')
    }

    // Pass client information and resource URI to toolManager
    return this.toolManager.readResourceByClient(resource.client.name, resource.uri)
  }

  /**
   * Convert MCP tool definitions to OpenAI Responses API tool format
   * @param mcpTools Array of MCP tool definitions
   * @param serverName Server name
   * @returns Tool definitions in OpenAI Responses API tool format
   */
  async mcpToolsToOpenAIResponsesTools(
    mcpTools: MCPToolDefinition[],
    serverName: string
  ): Promise<OpenAI.Responses.Tool[]> {
    const openaiTools: OpenAI.Responses.Tool[] = mcpTools.map((toolDef) => {
      const tool = this.mcpToolDefinitionToMcpTool(toolDef, serverName)
      return {
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: this.filterPropertieAttributes(tool),
          required: tool.inputSchema.required || []
        },
        strict: false
      }
    })
    return openaiTools
  }

  async grantPermission(
    serverName: string,
    permissionType: 'read' | 'write' | 'all',
    remember: boolean = false
  ): Promise<void> {
    try {
      console.log(
        `[MCP] Granting ${permissionType} permission for server: ${serverName}, remember: ${remember}`
      )
      await this.toolManager.grantPermission(serverName, permissionType, remember)
      console.log(
        `[MCP] Successfully granted ${permissionType} permission for server: ${serverName}`
      )
    } catch (error) {
      console.error(`[MCP] Failed to grant permission for server ${serverName}:`, error)
      throw error
    }
  }

  async getNpmRegistryStatus(): Promise<{
    currentRegistry: string | null
    isFromCache: boolean
    lastChecked?: number
    autoDetectEnabled: boolean
    customRegistry?: string
  }> {
    const cache = this.configPresenter.getNpmRegistryCache?.()
    const autoDetectEnabled = this.configPresenter.getAutoDetectNpmRegistry?.() ?? true
    const customRegistry = this.configPresenter.getCustomNpmRegistry?.()
    const currentRegistry = this.serverManager.getNpmRegistry()

    let isFromCache = false
    if (customRegistry && currentRegistry === customRegistry) {
      isFromCache = false
    } else if (cache && this.configPresenter.isNpmRegistryCacheValid?.()) {
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
    this.configPresenter.setCustomNpmRegistry?.(registry)
    if (registry) {
      console.log(`[MCP] Setting custom NPM registry: ${registry}`)
    } else {
      console.log('[MCP] Clearing custom NPM registry')
    }
    this.serverManager.loadRegistryFromCache()
  }

  async setAutoDetectNpmRegistry(enabled: boolean): Promise<void> {
    this.configPresenter.setAutoDetectNpmRegistry?.(enabled)
    if (enabled) {
      this.serverManager.loadRegistryFromCache()
    }
  }

  async clearNpmRegistryCache(): Promise<void> {
    this.configPresenter.clearNpmRegistryCache?.()
    console.log('[MCP] NPM Registry cache cleared')
  }
}
