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
    disabledAgentTools?: string[]
    chatMode?: 'agent' | 'acp agent'
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
   * Pre-check tool permission without executing the tool.
   */
  preCheckToolPermission?(request: MCPToolCall): Promise<{
    needsPermission: true
    toolName: string
    serverName: string
    permissionType: 'read' | 'write' | 'all' | 'command'
    description: string
    paths?: string[]
    command?: string
    commandSignature?: string
    commandInfo?: {
      command: string
      riskLevel: 'low' | 'medium' | 'high' | 'critical'
      suggestion: string
      signature?: string
      baseCommand?: string
    }
    providerId?: string
    requestId?: string
    sessionId?: string
    agentId?: string
    agentName?: string
    conversationId?: string
    rememberable?: boolean
    [key: string]: unknown
  } | null>

  /**
   * Build system prompt section for tool-related behavior.
   */
  buildToolSystemPrompt(context: {
    conversationId?: string
    toolDefinitions?: MCPToolDefinition[]
  }): string
}
