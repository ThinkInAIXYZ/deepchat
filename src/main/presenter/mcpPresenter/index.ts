import {
  IMCPPresenter,
  MCPConfig,
  MCPServerConfig,
  MCPToolDefinition,
  MCPToolCall
} from '@shared/presenter'
import { ServerManager } from './serverManager'
import { ToolManager } from './toolManager'
import { eventBus } from '@/eventbus'
import { MCP_EVENTS } from '@/events'
import { IConfigPresenter } from '@shared/presenter'

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

interface GeminiTool {
  functionDeclarations: {
    name: string
    description: string
    parameters?: {
      type: string
      properties: Record<string, Record<string, unknown>>
      required: string[]
    }
  }[]
}

// 完整版的 McpPresenter 实现
export class McpPresenter implements IMCPPresenter {
  private serverManager: ServerManager
  private toolManager: ToolManager
  private configPresenter: IConfigPresenter

  constructor(configPresenter?: IConfigPresenter) {
    console.log('初始化 MCP Presenter')

    // 如果提供了configPresenter实例，则使用它，否则保持与当前方式兼容
    if (configPresenter) {
      this.configPresenter = configPresenter
    } else {
      // 这里需要处理项目环境下的循环引用问题，通过延迟初始化解决
      // McpPresenter会在Presenter初始化过程中创建，此时presenter还不可用
      // 我们在initialize方法中会设置configPresenter
      this.configPresenter = {} as IConfigPresenter
    }

    this.serverManager = new ServerManager(this.configPresenter)
    this.toolManager = new ToolManager(this.configPresenter, this.serverManager)

    // 应用启动时初始化
    this.initialize()
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
      const config = await this.configPresenter.getMcpConfig()

      // 如果有默认服务器，尝试启动
      if (config.defaultServer && config.mcpServers[config.defaultServer]) {
        const serverName = config.defaultServer
        console.log(`[MCP] 尝试启动默认服务器: ${serverName}`)

        try {
          await this.serverManager.startServer(serverName)
          console.log(`[MCP] 默认服务器 ${serverName} 启动成功`)

          // 通知渲染进程服务器已启动
          eventBus.emit(MCP_EVENTS.SERVER_STARTED, serverName)
        } catch (error) {
          console.error(`[MCP] 默认服务器 ${serverName} 启动失败:`, error)
        }
      }
    } catch (error) {
      console.error('[MCP] 初始化失败:', error)
    }
  }

  async getMcpConfig(): Promise<MCPConfig> {
    return this.configPresenter.getMcpConfig()
  }

  async addMcpServer(serverName: string, config: MCPServerConfig): Promise<void> {
    await this.configPresenter.addMcpServer(serverName, config)
  }

  async updateMcpServer(serverName: string, config: Partial<MCPServerConfig>): Promise<void> {
    await this.configPresenter.updateMcpServer(serverName, config)
  }

  async removeMcpServer(serverName: string): Promise<void> {
    // 如果服务器正在运行，先停止
    if (await this.isServerRunning(serverName)) {
      await this.stopServer(serverName)
      // 通知渲染进程服务器已停止
    }

    await this.configPresenter.removeMcpServer(serverName)
  }

  async setDefaultServer(serverName: string): Promise<void> {
    await this.configPresenter.setDefaultServer(serverName)
  }

  async isServerRunning(serverName: string): Promise<boolean> {
    return Promise.resolve(this.serverManager.isServerRunning(serverName))
  }

  async startServer(serverName: string): Promise<void> {
    await this.serverManager.startServer(serverName)
    // 通知渲染进程服务器已启动
    eventBus.emit(MCP_EVENTS.SERVER_STARTED, serverName)
  }

  async stopServer(serverName: string): Promise<void> {
    await this.serverManager.stopServer(serverName)
    // 通知渲染进程服务器已停止
    eventBus.emit(MCP_EVENTS.SERVER_STOPPED, serverName)
  }

  async getAllToolDefinitions(): Promise<MCPToolDefinition[]> {
    const mcpConfig = await this.configPresenter.getMcpConfig()
    if (mcpConfig.mcpEnabled) {
      return this.toolManager.getAllToolDefinitions()
    }
    return []
  }

  async callTool(request: MCPToolCall): Promise<{ content: string }> {
    return this.toolManager.callTool(request)
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
    const getSubMap = (obj: Record<string, unknown>, keys: string[]): Record<string, unknown> => {
      return Object.fromEntries(Object.entries(obj).filter(([key]) => keys.includes(key)))
    }

    const result: Record<string, Record<string, unknown>> = {}
    for (const [key, val] of Object.entries(properties)) {
      result[key] = getSubMap(val, supportedAttributes)
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
          id: tool.id,
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
    mcpTools: MCPToolDefinition[] | undefined,
    llmTool: OpenAIToolCall,
    serverName: string
  ): Promise<MCPToolCall | undefined> {
    if (!mcpTools) return undefined

    const tool = mcpTools.find((tool) => tool.function.name === llmTool.function.name)
    if (!tool) {
      return undefined
    }

    // 创建MCP工具调用
    const mcpToolCall: MCPToolCall = {
      id: `${serverName}:${tool.function.name}-${Date.now()}`, // 生成唯一ID，包含服务器名称
      type: tool.type,
      function: {
        name: tool.function.name,
        arguments: llmTool.function.arguments
      }
    }

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
        name: tool.id,
        description: tool.description,
        input_schema: {
          type: 'object',
          properties: tool.inputSchema.properties,
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
    mcpTools: MCPToolDefinition[] | undefined,
    toolUse: AnthropicToolUse,
    serverName: string
  ): Promise<MCPToolCall | undefined> {
    if (!mcpTools) return undefined

    const tool = mcpTools.find((tool) => tool.function.name === toolUse.name)
    console.log('tool', tool, toolUse)
    if (!tool) {
      return undefined
    }

    // 创建MCP工具调用
    const mcpToolCall: MCPToolCall = {
      id: `${serverName}:${tool.function.name}-${Date.now()}`, // 生成唯一ID，包含服务器名称
      type: tool.type,
      function: {
        name: tool.function.name,
        arguments: JSON.stringify(toolUse.input)
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
  ): Promise<GeminiTool[]> {
    if (!mcpTools || mcpTools.length === 0) {
      return []
    }

    // 递归清理Schema对象，确保符合Gemini API要求
    const cleanSchema = (schema: Record<string, unknown>): Record<string, unknown> => {
      const allowedTopLevelFields = [
        'type',
        'description',
        'enum',
        'properties',
        'items',
        'nullable',
        'anyOf'
      ]

      // 创建新对象，只保留允许的字段
      const cleanedSchema: Record<string, unknown> = {}

      // 处理允许的顶级字段
      for (const field of allowedTopLevelFields) {
        if (field in schema) {
          if (field === 'properties' && typeof schema.properties === 'object') {
            // 递归处理properties中的每个属性
            const properties = schema.properties as Record<string, unknown>
            const cleanedProperties: Record<string, unknown> = {}

            for (const [propName, propValue] of Object.entries(properties)) {
              if (typeof propValue === 'object' && propValue !== null) {
                cleanedProperties[propName] = cleanSchema(propValue as Record<string, unknown>)
              } else {
                cleanedProperties[propName] = propValue
              }
            }

            cleanedSchema.properties = cleanedProperties
          } else if (field === 'items' && typeof schema.items === 'object') {
            // 递归处理items对象
            cleanedSchema.items = cleanSchema(schema.items as Record<string, unknown>)
          } else if (field === 'anyOf' && Array.isArray(schema.anyOf)) {
            // 递归处理anyOf数组中的每个选项
            cleanedSchema.anyOf = (schema.anyOf as Array<Record<string, unknown>>).map((item) =>
              cleanSchema(item)
            )
          } else {
            // 其他字段直接复制
            cleanedSchema[field] = schema[field]
          }
        }
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
          processedProperties[propName] = cleanSchema(propValue as Record<string, unknown>)
        }
      }

      // 准备函数声明结构
      const functionDeclaration = {
        name: tool.id,
        description: tool.description
      } as {
        name: string
        description: string
        parameters?: {
          type: string
          properties: Record<string, Record<string, unknown>>
          required: string[]
        }
      }
      if (Object.keys(processedProperties).length > 0) {
        functionDeclaration.parameters = {
          type: 'object',
          properties: processedProperties,
          required: tool.inputSchema.required || []
        }
      }

      // 记录没有参数的函数
      if (Object.keys(processedProperties).length === 0) {
        console.log(`[MCP] 函数 ${tool.id} 没有参数，提供了最小化的参数结构`)
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
    mcpTools: MCPToolDefinition[] | undefined,
    fcall: GeminiFunctionCall | undefined,
    serverName: string
  ): Promise<MCPToolCall | undefined> {
    if (!fcall) return undefined
    if (!mcpTools) return undefined

    const tool = mcpTools.find((tool) => tool.function.name === fcall.name)
    if (!tool) {
      return undefined
    }

    // 创建MCP工具调用
    const mcpToolCall: MCPToolCall = {
      id: `${serverName}:${tool.function.name}-${Date.now()}`, // 生成唯一ID，包含服务器名称
      type: tool.type,
      function: {
        name: tool.function.name,
        arguments: JSON.stringify(fcall.args)
      }
    }

    return mcpToolCall
  }

  // 获取MCP启用状态
  async getMcpEnabled(): Promise<boolean> {
    const mcpConfig = await this.configPresenter.getMcpConfig()
    return mcpConfig.mcpEnabled
  }

  // 设置MCP启用状态
  async setMcpEnabled(enabled: boolean): Promise<void> {
    const mcpConfig = await this.configPresenter.getMcpConfig()
    mcpConfig.mcpEnabled = enabled
    await this.configPresenter.setMcpConfig(mcpConfig)
  }
}
