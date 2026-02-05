import type {
  IConfigPresenter,
  IMCPPresenter,
  IYoBrowserPresenter,
  MCPToolDefinition,
  MCPToolCall,
  MCPToolResponse
} from '@shared/presenter'
import { resolveToolOffloadTemplatePath } from '../sessionPresenter/sessionPaths'
import { QUESTION_TOOL_NAME } from '../agentPresenter/tools/questionTool'
import { ToolMapper } from './toolMapper'
import { AgentToolManager, type AgentToolCallResult } from '../agentPresenter/acp'
import { jsonrepair } from 'jsonrepair'
import { CommandPermissionService } from '../permission'

export interface IToolPresenter {
  getAllToolDefinitions(context: {
    enabledMcpTools?: string[]
    chatMode?: 'chat' | 'agent' | 'acp agent'
    supportsVision?: boolean
    agentWorkspacePath?: string | null
    conversationId?: string
  }): Promise<MCPToolDefinition[]>
  callTool(request: MCPToolCall): Promise<{ content: unknown; rawData: MCPToolResponse }>
  buildToolSystemPrompt(context: { conversationId?: string }): string
}

interface ToolPresenterOptions {
  mcpPresenter: IMCPPresenter
  yoBrowserPresenter: IYoBrowserPresenter
  configPresenter: IConfigPresenter
  commandPermissionHandler?: CommandPermissionService
}

/**
 * ToolPresenter - Unified tool routing presenter
 * Manages all tool sources (MCP, Agent) and provides unified interface
 */
export class ToolPresenter implements IToolPresenter {
  private readonly mapper: ToolMapper
  private readonly options: ToolPresenterOptions
  private agentToolManager: AgentToolManager | null = null

  constructor(options: ToolPresenterOptions) {
    this.options = options
    this.mapper = new ToolMapper()
  }

  /**
   * Get all tool definitions from all sources
   * Returns unified MCP-format tool definitions
   */
  async getAllToolDefinitions(context: {
    enabledMcpTools?: string[]
    chatMode?: 'chat' | 'agent' | 'acp agent'
    supportsVision?: boolean
    agentWorkspacePath?: string | null
    conversationId?: string
  }): Promise<MCPToolDefinition[]> {
    const defs: MCPToolDefinition[] = []
    this.mapper.clear()

    const chatMode = context.chatMode || 'chat'
    const supportsVision = context.supportsVision || false
    const agentWorkspacePath = context.agentWorkspacePath || null

    // 1. Get MCP tools
    const mcpDefs = await this.options.mcpPresenter.getAllToolDefinitions(context.enabledMcpTools)
    defs.push(...mcpDefs)
    this.mapper.registerTools(mcpDefs, 'mcp')

    // 2. Get Agent tools (only in agent or acp agent mode)
    if (chatMode !== 'chat') {
      // Initialize or update AgentToolManager if workspace path changed
      if (!this.agentToolManager) {
        this.agentToolManager = new AgentToolManager({
          agentWorkspacePath,
          configPresenter: this.options.configPresenter,
          commandPermissionHandler: this.options.commandPermissionHandler
        })
      }

      try {
        const agentDefs = await this.agentToolManager.getAllToolDefinitions({
          chatMode,
          supportsVision,
          agentWorkspacePath,
          conversationId: context.conversationId
        })
        const filteredAgentDefs = agentDefs.filter((tool) => {
          if (!this.mapper.hasTool(tool.function.name)) return true
          console.warn(
            `[ToolPresenter] Tool name conflict for '${tool.function.name}', preferring MCP tool.`
          )
          return false
        })
        defs.push(...filteredAgentDefs)
        this.mapper.registerTools(filteredAgentDefs, 'agent')
      } catch (error) {
        console.warn('[ToolPresenter] Failed to load Agent tool definitions', error)
      }
    }

    return defs
  }

  /**
   * Call a tool, routing to the appropriate source based on mapping
   */
  async callTool(request: MCPToolCall): Promise<{ content: unknown; rawData: MCPToolResponse }> {
    const toolName = request.function.name
    const source = this.mapper.getToolSource(toolName)

    if (!source) {
      throw new Error(`Tool ${toolName} not found in any source`)
    }

    if (source === 'agent') {
      if (!this.agentToolManager) {
        throw new Error(`Agent tool manager not initialized for tool ${toolName}`)
      }
      // Route to Agent tool manager
      let args: Record<string, unknown> = {}
      const argsString = request.function.arguments || ''
      if (argsString.trim().length > 0) {
        try {
          args = JSON.parse(argsString) as Record<string, unknown>
        } catch (error) {
          console.warn('[ToolPresenter] Failed to parse tool arguments, trying jsonrepair:', error)
          try {
            args = JSON.parse(jsonrepair(argsString)) as Record<string, unknown>
          } catch (error) {
            console.warn(
              '[ToolPresenter] Failed to repair tool arguments, using empty args.',
              error
            )
            args = {}
          }
        }
      }
      const response = await this.agentToolManager.callTool(toolName, args, request.conversationId)
      const resolvedResponse = this.resolveAgentToolResponse(response)
      return {
        content: resolvedResponse.content,
        rawData: {
          toolCallId: request.id,
          content: resolvedResponse.rawData?.content ?? resolvedResponse.content,
          isError: resolvedResponse.rawData?.isError,
          toolResult: resolvedResponse.rawData?.toolResult,
          requiresPermission: resolvedResponse.rawData?.requiresPermission,
          permissionRequest: resolvedResponse.rawData?.permissionRequest
        }
      }
    }

    // Route to MCP (default)
    return await this.options.mcpPresenter.callTool(request)
  }

  private resolveAgentToolResponse(response: AgentToolCallResult | string): AgentToolCallResult {
    if (typeof response === 'string') {
      return { content: response }
    }
    return response
  }

  buildToolSystemPrompt(context: { conversationId?: string }): string {
    const conversationId = context.conversationId || '<conversationId>'
    const offloadPath =
      resolveToolOffloadTemplatePath(conversationId) ??
      '~/.deepchat/sessions/<conversationId>/tool_<toolCallId>.offload'

    return [
      'Tool outputs may be offloaded when large.',
      `When you see an offload stub, read the full output from: ${offloadPath}`,
      'Use file tools to read that path. Access is limited to the current conversation session.',
      `If you need user confirmation or choices, ask with the ${QUESTION_TOOL_NAME} tool.`
    ].join('\n')
  }
}
