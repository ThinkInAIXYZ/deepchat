import type { MCPToolCall, MCPToolDefinition, MCPToolResponse } from '@shared/types/mcp'
import type { ToolCallOptions } from '@shared/types/tool'

export interface SessionToolProvider {
  getToolDefinitions(conversationId: string): MCPToolDefinition[]
  callTool(
    request: MCPToolCall,
    options?: ToolCallOptions
  ): Promise<{ content: unknown; rawData: MCPToolResponse }>
}
