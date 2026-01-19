import type {
  IToolPresenter,
  MCPToolCall,
  MCPToolDefinition,
  MCPToolResponse
} from '@shared/presenter'

export type ToolCallContext = {
  enabledMcpTools?: string[]
  chatMode?: 'agent' | 'acp agent'
  supportsVision?: boolean
  agentWorkspacePath?: string | null
}

export class ToolCallCenter {
  constructor(private readonly toolPresenter: IToolPresenter) {}

  async getAllToolDefinitions(context: ToolCallContext): Promise<MCPToolDefinition[]> {
    return this.toolPresenter.getAllToolDefinitions(context)
  }

  async callTool(request: MCPToolCall): Promise<{ content: unknown; rawData: MCPToolResponse }> {
    return this.toolPresenter.callTool(request)
  }
}
