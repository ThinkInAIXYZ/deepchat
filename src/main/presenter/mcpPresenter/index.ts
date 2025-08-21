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
import { CONFIG_EVENTS } from '@/events'
import { presenter } from '@/presenter'

// 定义MCP工具接口
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

// 定义各家LLM的工具类型接口
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

// 定义工具转换接口
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

// 完整版的 McpPresenter 实现
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

    // 监听自定义提示词服务器检查事件
    eventBus.on(CONFIG_EVENTS.CUSTOM_PROMPTS_SERVER_CHECK_REQUIRED, async () => {
      await this.checkAndManageCustomPromptsServer()
    })

    // 延迟初始化，确保其他组件已经准备好
    setTimeout(() => {
      this.initialize()
    }, 1000)
  }

  private async initialize() {
    try {
      // 如果没有提供configPresenter，从presenter中获取
      if (!this.configPresenter.getLanguage) {
        // 重新创建管理器
        this.serverManager = new ServerManager(this.configPresenter)
        this.toolManager = new ToolManager(this.configPresenter, this.serverManager)
      }

      // 加载配置
      const [servers, defaultServers] = await Promise.all([
        this.configPresenter.getMcpServers(),
        this.configPresenter.getMcpDefaultServers()
      ])

      // 初始化npm registry（优先使用缓存）
      console.log('[MCP] Initializing npm registry...')
      try {
        await this.serverManager.testNpmRegistrySpeed(true)
        console.log(`[MCP] npm registry initialized: ${this.serverManager.getNpmRegistry()}`)
      } catch (error) {
        console.error('[MCP] npm registry initialization failed:', error)
      }

      // 检查并启动 deepchat-inmemory/custom-prompts-server
      const customPromptsServerName = 'deepchat-inmemory/custom-prompts-server'
      if (servers[customPromptsServerName]) {
        console.log(`[MCP] Attempting to start custom prompts server: ${customPromptsServerName}`)

        try {
          await this.serverManager.startServer(customPromptsServerName)
          console.log(`[MCP] Custom prompts server ${customPromptsServerName} started successfully`)

          // 通知渲染进程服务器已启动
          eventBus.send(MCP_EVENTS.SERVER_STARTED, SendTarget.ALL_WINDOWS, customPromptsServerName)
        } catch (error) {
          console.error(
            `[MCP] Failed to start custom prompts server ${customPromptsServerName}:`,
            error
          )
        }
      }

      // 如果有默认服务器，尝试启动
      if (defaultServers.length > 0) {
        for (const serverName of defaultServers) {
          if (servers[serverName]) {
            console.log(`[MCP] Attempting to start default server: ${serverName}`)

            try {
              await this.serverManager.startServer(serverName)
              console.log(`[MCP] Default server ${serverName} started successfully`)

              // 通知渲染进程服务器已启动
              eventBus.send(MCP_EVENTS.SERVER_STARTED, SendTarget.ALL_WINDOWS, serverName)
            } catch (error) {
              console.error(`[MCP] Failed to start default server ${serverName}:`, error)
            }
          }
        }
      }

      // 标记初始化完成并发出事件
      this.isInitialized = true
      console.log('[MCP] Initialization completed')
      eventBus.send(MCP_EVENTS.INITIALIZED, SendTarget.ALL_WINDOWS)

      // 检查并管理自定义提示词服务器
      await this.checkAndManageCustomPromptsServer()

      this.scheduleBackgroundRegistryUpdate()
    } catch (error) {
      console.error('[MCP] Initialization failed:', error)
      // 即使初始化失败也标记为已完成，避免系统卡在未初始化状态
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

    // 批量更新所有服务器的 Authorization
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

  // 添加获取初始化状态的方法
  isReady(): boolean {
    return this.isInitialized
  }

  // 检查并管理自定义提示词服务器
  private async checkAndManageCustomPromptsServer(): Promise<void> {
    const customPromptsServerName = 'deepchat-inmemory/custom-prompts-server'

    try {
      // 获取当前自定义提示词
      const customPrompts = await this.configPresenter.getCustomPrompts()
      const hasCustomPrompts = customPrompts && customPrompts.length > 0

      // 检查服务器是否正在运行
      const isServerRunning = this.serverManager.isServerRunning(customPromptsServerName)

      if (hasCustomPrompts && !isServerRunning) {
        // 有自定义提示词但服务器未运行，启动服务器
        try {
          await this.serverManager.startServer(customPromptsServerName)
          eventBus.send(MCP_EVENTS.SERVER_STARTED, SendTarget.ALL_WINDOWS, customPromptsServerName)
        } catch (error) {
          console.error(`Failed to start custom prompts server ${customPromptsServerName}:`, error)
        }
      } else if (!hasCustomPrompts && isServerRunning) {
        // 没有自定义提示词但服务器正在运行，停止服务器
        try {
          await this.serverManager.stopServer(customPromptsServerName)
          eventBus.send(MCP_EVENTS.SERVER_STOPPED, SendTarget.ALL_WINDOWS, customPromptsServerName)
        } catch (error) {
          console.error(`Failed to stop custom prompts server ${customPromptsServerName}:`, error)
        }
      } else if (hasCustomPrompts && isServerRunning) {
        // 有自定义提示词且服务器正在运行，重启服务器以刷新缓存
        try {
          await this.serverManager.stopServer(customPromptsServerName)
          await this.serverManager.startServer(customPromptsServerName)
          eventBus.send(MCP_EVENTS.SERVER_STARTED, SendTarget.ALL_WINDOWS, customPromptsServerName)
        } catch (error) {
          console.error(
            `Failed to restart custom prompts server ${customPromptsServerName}:`,
            error
          )
        }
      }

      // 通知客户端列表已更新
      eventBus.send(MCP_EVENTS.CLIENT_LIST_UPDATED, SendTarget.ALL_WINDOWS)
    } catch (error) {
      console.error('Failed to manage custom prompts server:', error)
    }
  }

  // 获取MCP服务器配置
  getMcpServers(): Promise<Record<string, MCPServerConfig>> {
    return this.configPresenter.getMcpServers()
  }

  // 获取所有MCP服务器
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

      // 创建客户端基本信息对象
      const clientObj: McpClient = {
        name: client.serverName,
        icon: client.serverConfig['icons'] as string,
        isRunning: client.isServerRunning(),
        tools: results
      }

      // 检查并添加 prompts（如果支持）
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

      // 检查并添加 resources（如果支持）
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

  // 获取所有默认MCP服务器
  getMcpDefaultServers(): Promise<string[]> {
    return this.configPresenter.getMcpDefaultServers()
  }

  // 添加默认MCP服务器
  async addMcpDefaultServer(serverName: string): Promise<void> {
    await this.configPresenter.addMcpDefaultServer(serverName)
  }

  // 移除默认MCP服务器
  async removeMcpDefaultServer(serverName: string): Promise<void> {
    await this.configPresenter.removeMcpDefaultServer(serverName)
  }

  // 切换服务器的默认状态
  async toggleMcpDefaultServer(serverName: string): Promise<void> {
    await this.configPresenter.toggleMcpDefaultServer(serverName)
  }

  // 添加MCP服务器
  async addMcpServer(serverName: string, config: MCPServerConfig): Promise<boolean> {
    const existingServers = await this.getMcpServers()
    if (existingServers[serverName]) {
      console.error(`[MCP] Failed to add server: Server name "${serverName}" already exists.`)
      // 获取当前语言并发送通知
      const locale = this.configPresenter.getLanguage?.() || 'zh-CN'
      const errorMessages = getErrorMessageLabels(locale)
      eventBus.sendToRenderer(NOTIFICATION_EVENTS.SHOW_ERROR, SendTarget.ALL_WINDOWS, {
        title: errorMessages.addMcpServerErrorTitle || '添加服务器失败',
        message:
          errorMessages.addMcpServerDuplicateMessage?.replace('{serverName}', serverName) ||
          `服务器名称 "${serverName}" 已存在。请选择一个不同的名称。`,
        id: `mcp-error-add-server-${serverName}-${Date.now()}`,
        type: 'error'
      })
      return false
    }
    await this.configPresenter.addMcpServer(serverName, config)
    return true
  }

  // 更新MCP服务器配置
  async updateMcpServer(serverName: string, config: Partial<MCPServerConfig>): Promise<void> {
    const wasRunning = this.serverManager.isServerRunning(serverName)
    await this.configPresenter.updateMcpServer(serverName, config)

    // 如果服务器之前正在运行，则重启它以应用新配置
    if (wasRunning) {
      console.log(`[MCP] Configuration updated, restarting server: ${serverName}`)
      try {
        await this.stopServer(serverName) // stopServer 会发出 SERVER_STOPPED 事件
        await this.startServer(serverName) // startServer 会发出 SERVER_STARTED 事件
        console.log(`[MCP] Server ${serverName} restarted successfully`)
      } catch (error) {
        console.error(`[MCP] Failed to restart server ${serverName}:`, error)
        // 即使重启失败，也要确保状态正确，标记为未运行
        eventBus.send(MCP_EVENTS.SERVER_STOPPED, SendTarget.ALL_WINDOWS, serverName)
      }
    }
  }

  // 移除MCP服务器
  async removeMcpServer(serverName: string): Promise<void> {
    // 如果服务器正在运行，先停止
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
    // 通知渲染进程服务器已启动
    eventBus.send(MCP_EVENTS.SERVER_STARTED, SendTarget.ALL_WINDOWS, serverName)
  }

  async stopServer(serverName: string): Promise<void> {
    await this.serverManager.stopServer(serverName)
    // 通知渲染进程服务器已停止
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
            // 为每个提示模板添加客户端信息
            const clientPrompts = prompts.map((prompt) => ({
              id: prompt.name,
              name: prompt.name,
              description: prompt.description || '',
              arguments: prompt.arguments || [],
              files: prompt.files || [], // 添加 files 字段
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
            // 为每个资源添加客户端信息
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

    // 格式化工具调用结果为大模型易于解析的字符串
    let formattedContent = ''

    // 判断内容类型
    if (typeof toolCallResult.content === 'string') {
      // 内容已经是字符串
      formattedContent = toolCallResult.content
    } else if (Array.isArray(toolCallResult.content)) {
      // 内容是结构化数组，需要格式化
      const contentParts: string[] = []

      // 处理每个内容项
      for (const item of toolCallResult.content) {
        if (item.type === 'text') {
          contentParts.push(item.text)
        } else if (item.type === 'image') {
          contentParts.push(`[图片: ${item.mimeType}]`)
        } else if (item.type === 'resource') {
          if ('text' in item.resource && item.resource.text) {
            contentParts.push(`[资源: ${item.resource.uri}]\n${item.resource.text}`)
          } else if ('blob' in item.resource) {
            contentParts.push(`[二进制资源: ${item.resource.uri}]`)
          } else {
            contentParts.push(`[资源: ${item.resource.uri}]`)
          }
        } else {
          // 处理其他未知类型
          contentParts.push(JSON.stringify(item))
        }
      }

      // 合并所有内容
      formattedContent = contentParts.join('\n\n')
    }

    // 添加错误标记（如果有）
    if (toolCallResult.isError) {
      formattedContent = `错误: ${formattedContent}`
    }

    return { content: formattedContent, rawData: toolCallResult }
  }

  // 将MCPToolDefinition转换为MCPTool
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

  // 工具属性过滤函数
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

    // 递归清理函数，确保所有值都是可序列化的
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

      // 对于函数、Symbol等不可序列化的值，返回字符串表示
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

  // 新增工具转换方法
  /**
   * 将MCP工具定义转换为OpenAI工具格式
   * @param mcpTools MCP工具定义数组
   * @param serverName 服务器名称
   * @returns OpenAI工具格式的工具定义
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
   * 将OpenAI工具调用转换回MCP工具调用
   * @param mcpTools MCP工具定义数组
   * @param llmTool OpenAI工具调用
   * @param serverName 服务器名称
   * @returns 匹配的MCP工具调用
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

    // 创建MCP工具调用
    const mcpToolCall: MCPToolCall = {
      id: `${providerId}:${tool.function.name}-${Date.now()}`, // 生成唯一ID，包含服务器名称
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
   * 将MCP工具定义转换为Anthropic工具格式
   * @param mcpTools MCP工具定义数组
   * @param serverName 服务器名称
   * @returns Anthropic工具格式的工具定义
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
   * 将Anthropic工具使用转换回MCP工具调用
   * @param mcpTools MCP工具定义数组
   * @param toolUse Anthropic工具使用
   * @param serverName 服务器名称
   * @returns 匹配的MCP工具调用
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

    // 创建MCP工具调用
    const mcpToolCall: MCPToolCall = {
      id: `${providerId}:${tool.function.name}-${Date.now()}`, // 生成唯一ID，包含服务器名称
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
   * 将MCP工具定义转换为Gemini工具格式
   * @param mcpTools MCP工具定义数组
   * @param serverName 服务器名称
   * @returns Gemini工具格式的工具定义
   */
  async mcpToolsToGeminiTools(
    mcpTools: MCPToolDefinition[] | undefined,
    serverName: string
  ): Promise<ToolListUnion> {
    if (!mcpTools || mcpTools.length === 0) {
      return []
    }

    // 递归清理Schema对象，确保符合Gemini API要求
    const cleanSchema = (schema: Record<string, unknown>): Record<string, unknown> => {
      const cleanedSchema: Record<string, unknown> = {}

      // 处理type字段 - 确保始终有有效值
      if ('type' in schema) {
        const type = schema.type
        if (typeof type === 'string' && type.trim() !== '') {
          cleanedSchema.type = type
        } else if (Array.isArray(type) && type.length > 0) {
          // 如果是类型数组，取第一个非空类型
          const validType = type.find((t) => typeof t === 'string' && t.trim() !== '')
          if (validType) {
            cleanedSchema.type = validType
          } else {
            cleanedSchema.type = 'string' // 默认类型
          }
        } else {
          // 如果没有有效的type，根据其他属性推断
          if ('enum' in schema) {
            cleanedSchema.type = 'string'
          } else if ('properties' in schema) {
            cleanedSchema.type = 'object'
          } else if ('items' in schema) {
            cleanedSchema.type = 'array'
          } else {
            cleanedSchema.type = 'string' // 默认类型
          }
        }
      } else {
        // 如果完全没有type字段，根据其他属性推断
        if ('enum' in schema) {
          cleanedSchema.type = 'string'
        } else if ('properties' in schema) {
          cleanedSchema.type = 'object'
        } else if ('items' in schema) {
          cleanedSchema.type = 'array'
        } else if ('anyOf' in schema || 'oneOf' in schema) {
          // 对于union类型，尝试推断最合适的类型
          cleanedSchema.type = 'string' // 默认为string
        } else {
          cleanedSchema.type = 'string' // 最终默认类型
        }
      }

      // 处理description
      if ('description' in schema && typeof schema.description === 'string') {
        cleanedSchema.description = schema.description
      }

      // 处理enum
      if ('enum' in schema && Array.isArray(schema.enum)) {
        cleanedSchema.enum = schema.enum
        // 确保enum类型是string
        if (!cleanedSchema.type || cleanedSchema.type === '') {
          cleanedSchema.type = 'string'
        }
      }

      // 处理properties
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

      // 处理items (数组类型)
      if ('items' in schema && typeof schema.items === 'object' && schema.items !== null) {
        cleanedSchema.items = cleanSchema(schema.items as Record<string, unknown>)
        cleanedSchema.type = 'array'
      }

      // 处理nullable
      if ('nullable' in schema && typeof schema.nullable === 'boolean') {
        cleanedSchema.nullable = schema.nullable
      }

      // 处理anyOf/oneOf (union类型) - 简化为单一类型
      if ('anyOf' in schema && Array.isArray(schema.anyOf)) {
        const anyOfOptions = schema.anyOf as Array<Record<string, unknown>>

        // 尝试找到最适合的类型
        let bestOption = anyOfOptions[0]

        // 优先选择有enum的选项
        for (const option of anyOfOptions) {
          if ('enum' in option && Array.isArray(option.enum)) {
            bestOption = option
            break
          }
        }

        // 如果没有enum，优先选择string类型
        if (!('enum' in bestOption)) {
          for (const option of anyOfOptions) {
            if (option.type === 'string') {
              bestOption = option
              break
            }
          }
        }

        // 递归清理选中的选项
        const cleanedOption = cleanSchema(bestOption)
        Object.assign(cleanedSchema, cleanedOption)
      }

      // 处理oneOf类似anyOf
      if ('oneOf' in schema && Array.isArray(schema.oneOf)) {
        const oneOfOptions = schema.oneOf as Array<Record<string, unknown>>
        const bestOption = oneOfOptions[0] || {}
        const cleanedOption = cleanSchema(bestOption)
        Object.assign(cleanedSchema, cleanedOption)
      }

      // 最终检查：确保必须有type字段
      if (!cleanedSchema.type || cleanedSchema.type === '') {
        cleanedSchema.type = 'string'
      }

      return cleanedSchema
    }

    // 处理每个工具定义，构建符合Gemini API的函数声明
    const functionDeclarations = mcpTools.map((toolDef) => {
      // 转换为内部工具表示
      const tool = this.mcpToolDefinitionToMcpTool(toolDef, serverName)

      // 获取参数属性
      const properties = tool.inputSchema.properties
      const processedProperties: Record<string, Record<string, unknown>> = {}

      // 处理每个属性，应用清理函数
      for (const [propName, propValue] of Object.entries(properties)) {
        if (typeof propValue === 'object' && propValue !== null) {
          const cleaned = cleanSchema(propValue as Record<string, unknown>)
          // 确保清理后的属性有有效的type
          if (cleaned.type && cleaned.type !== '') {
            processedProperties[propName] = cleaned
          } else {
            console.warn(`[MCP] Skipping property ${propName} due to invalid type`)
          }
        }
      }

      // 准备函数声明结构
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

      // 记录没有参数的函数
      if (Object.keys(processedProperties).length === 0) {
        console.log(
          `[MCP] Function ${tool.id} has no parameters, providing minimal parameter structure`
        )
      }

      return functionDeclaration
    })

    // 返回符合Gemini工具格式的结果
    return [
      {
        functionDeclarations
      }
    ]
  }

  /**
   * 将Gemini函数调用转换回MCP工具调用
   * @param mcpTools MCP工具定义数组
   * @param fcall Gemini函数调用
   * @param serverName 服务器名称
   * @returns 匹配的MCP工具调用
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

    // 创建MCP工具调用
    const mcpToolCall: MCPToolCall = {
      id: `${providerId}:${tool.function.name}-${Date.now()}`, // 生成唯一ID，包含服务器名称
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

  // 获取MCP启用状态
  async getMcpEnabled(): Promise<boolean> {
    return this.configPresenter.getMcpEnabled()
  }

  // 设置MCP启用状态
  async setMcpEnabled(enabled: boolean): Promise<void> {
    await this.configPresenter?.setMcpEnabled(enabled)
  }

  async resetToDefaultServers(): Promise<void> {
    await this.configPresenter?.getMcpConfHelper().resetToDefaultServers()
  }

  /**
   * 获取指定提示模板
   * @param prompt 提示模板对象（包含客户端信息）
   * @param params 提示模板参数
   * @returns 提示模板内容
   */
  async getPrompt(prompt: PromptListEntry, args?: Record<string, unknown>): Promise<unknown> {
    const enabled = await this.configPresenter.getMcpEnabled()
    if (!enabled) {
      throw new Error('MCP功能已禁用')
    }

    // 传递客户端信息和提示模板名称给toolManager
    return this.toolManager.getPromptByClient(prompt.client.name, prompt.name, args)
  }

  /**
   * 读取指定资源
   * @param resource 资源对象（包含客户端信息）
   * @returns 资源内容
   */
  async readResource(resource: ResourceListEntry): Promise<Resource> {
    const enabled = await this.configPresenter.getMcpEnabled()
    if (!enabled) {
      throw new Error('MCP功能已禁用')
    }

    // 传递客户端信息和资源URI给toolManager
    return this.toolManager.readResourceByClient(resource.client.name, resource.uri)
  }

  /**
   * 将MCP工具定义转换为OpenAI Responses API工具格式
   * @param mcpTools MCP工具定义数组
   * @param serverName 服务器名称
   * @returns OpenAI Responses API工具格式的工具定义
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
