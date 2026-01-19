/**
 * Tool Presenter Types
 * Types for the unified tool routing presenter
 */

import type { MCPToolDefinition, MCPToolCall, MCPToolResponse } from './legacy.presenters'

/**
 * Tool Presenter interface
 * Unified interface for managing all tool sources (MCP, Agent)
 */
export interface IToolPresenter {
  /**
   * Get all tool definitions from all sources
   * @param context Context for tool definition retrieval
   */
  getAllToolDefinitions(context: {
    enabledMcpTools?: string[]
    chatMode?: 'chat' | 'agent' | 'acp agent'
    supportsVision?: boolean
    agentWorkspacePath?: string | null
    conversationId?: string
  }): Promise<MCPToolDefinition[]>

  /**
   * Call a tool, routing to the appropriate source
   * @param request Tool call request
   */
  callTool(request: MCPToolCall): Promise<{ content: unknown; rawData: MCPToolResponse }>

  /**
   * Build system prompt section for tool-related behavior.
   */
  buildToolSystemPrompt(context: { conversationId?: string }): string
}
