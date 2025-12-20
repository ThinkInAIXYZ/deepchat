import type {
  IConfigPresenter,
  IMCPPresenter,
  IYoBrowserPresenter,
  MCPToolDefinition,
  MCPToolCall,
  MCPToolResponse
} from '@shared/presenter'
import { ToolMapper } from './toolMapper'
import { AgentToolManager } from '../llmProviderPresenter/agent/agentToolManager'

export interface IToolPresenter {
  getAllToolDefinitions(context: {
    enabledMcpTools?: string[]
    chatMode?: 'chat' | 'agent' | 'acp agent'
    supportsVision?: boolean
    agentWorkspacePath?: string | null
  }): Promise<MCPToolDefinition[]>
  callTool(request: MCPToolCall): Promise<{ content: unknown; rawData: MCPToolResponse }>
}

interface ToolPresenterOptions {
  mcpPresenter: IMCPPresenter
  yoBrowserPresenter: IYoBrowserPresenter
  configPresenter: IConfigPresenter
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
          yoBrowserPresenter: this.options.yoBrowserPresenter,
          agentWorkspacePath
        })
      }

      try {
        const agentDefs = await this.agentToolManager.getAllToolDefinitions({
          chatMode,
          supportsVision,
          agentWorkspacePath
        })
        defs.push(...agentDefs)
        this.mapper.registerTools(agentDefs, 'agent')
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

    if (source === 'agent' && this.agentToolManager) {
      // Route to Agent tool manager
      const args = JSON.parse(request.function.arguments || '{}') as Record<string, unknown>
      const response = await this.agentToolManager.callTool(toolName, args)
      return {
        content: typeof response === 'string' ? response : JSON.stringify(response),
        rawData: {
          toolCallId: request.id,
          content: response
        }
      }
    }

    // Route to MCP (default)
    return await this.options.mcpPresenter.callTool(request)
  }
}
