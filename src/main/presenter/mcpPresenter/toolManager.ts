import { nanoid } from 'nanoid'
import { eventBus } from '@/eventbus'
import { MCP_EVENTS } from '@/events'
import {
  MCPToolCall,
  MCPToolDefinition,
  MCPToolResponse,
  IConfigPresenter
} from '@shared/presenter'
import { ServerManager } from './serverManager'
import { McpClient, Tool } from './mcpClient'

export class ToolManager {
  private configPresenter: IConfigPresenter
  private serverManager: ServerManager

  constructor(configPresenter: IConfigPresenter, serverManager: ServerManager) {
    this.configPresenter = configPresenter
    this.serverManager = serverManager
  }

  // 获取所有工具定义
  public async getAllToolDefinitions(): Promise<MCPToolDefinition[]> {
    // 获取运行中的默认客户端
    const clients = await this.serverManager.getRunningClients()

    if (!clients) {
      console.error('未找到正在运行的MCP客户端')
      return []
    }

    try {
      // 获取工具列表
      const tools: Tool[] = []
      for (const client of clients) {
        const clientTools = await client.listTools()
        if (clientTools) {
          tools.push(...clientTools)
        }
      }
      if (!tools) {
        return []
      }

      // 转换为MCPToolDefinition格式
      const results: MCPToolDefinition[] = []
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
          }
        })
      }
      return results
    } catch (error) {
      console.error('获取工具定义失败:', error)
      return []
    }
  }

  // 检查工具调用权限
  private checkToolPermission(toolName: string, autoApprove: string[]): boolean {
    // 如果有 'all' 权限，则允许所有操作
    if (autoApprove.includes('all')) {
      return true
    }

    // 根据操作类型检查特定权限
    switch (toolName) {
      case 'get_file_content':
      case 'list_directory':
      case 'read_file':
        // 读取操作需要 'read' 权限
        return autoApprove.includes('read')
      case 'write_file':
        // 写入操作需要 'write' 权限
        return autoApprove.includes('write')
      default:
        // 未知操作默认不授权
        return false
    }
  }

  async callTool(toolCall: MCPToolCall): Promise<MCPToolResponse> {
    console.log('callTool', toolCall)
    try {
      // 获取默认服务器名称和配置
      const mcpConfig = await this.configPresenter.getMcpConfig()
      const defaultServerName = await this.serverManager.getDefaultServerName()

      if (!defaultServerName) {
        throw new Error('No default MCP server configured')
      }

      // 获取服务器配置和权限设置
      const serverConfig = mcpConfig.mcpServers[defaultServerName]
      const autoApprove = serverConfig.autoApprove || []

      // 解析工具调用参数
      const { name, arguments: argsString } = toolCall.function
      let args = {}
      try {
        args = JSON.parse(argsString)
      } catch (error) {
        console.warn('Error parsing tool call arguments:', error)
      }

      // 检查权限
      const hasPermission = this.checkToolPermission(name, autoApprove)

      // 如果没有权限，则拒绝操作
      if (!hasPermission) {
        return {
          toolCallId: toolCall.id,
          content: `Error: Operation not permitted. The '${name}' operation requires appropriate permissions.`
        }
      }

      // 获取正在运行的默认客户端
      const clients = await this.serverManager.getRunningClients()

      if (!clients) {
        return {
          toolCallId: toolCall.id,
          content: `Error: MCP服务未运行，请先启动服务`
        }
      }
      let client: McpClient | null = null
      for (const c of clients) {
        const clientTools = await c.listTools()
        if (clientTools) {
          for (const tool of clientTools) {
            if (tool.name === name) {
              client = c
              break
            }
          }
        }
      }
      if (!client) {
        return {
          toolCallId: toolCall.id,
          content: `Error: 未找到工具 ${name}`
        }
      }
      // 调用 MCP 工具
      const result = await client.callTool(name, args)

      // 返回工具调用结果
      const response: MCPToolResponse = {
        toolCallId: toolCall.id,
        content: result
      }

      // 触发工具调用结果事件
      eventBus.emit(MCP_EVENTS.TOOL_CALL_RESULT, response)

      return response
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Tool call error:', error)
      return {
        toolCallId: toolCall.id,
        content: `Error: ${errorMessage}`
      }
    }
  }

  // 创建工具调用对象
  createToolCall(toolName: string, args: Record<string, string>): MCPToolCall {
    return {
      id: nanoid(),
      type: 'function',
      function: {
        name: `${toolName}`,
        arguments: JSON.stringify(args)
      }
    }
  }
}
