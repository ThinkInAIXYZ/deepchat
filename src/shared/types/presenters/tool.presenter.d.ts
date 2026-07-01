/**
 * Tool Presenter Types
 * Types for the unified tool routing presenter
 */

import type { MCPToolDefinition, MCPToolCall, MCPToolResponse } from '../core/mcp'
import type { PermissionMode } from '../agent-interface'
import type { AgentPlanSnapshot } from '../agent-plan'

export type AgentToolProgressUpdate =
  | {
      kind: 'subagent_orchestrator'
      toolCallId: string
      responseMarkdown: string
      progressJson: string
    }
  | {
      kind: 'agent_plan'
      toolCallId: string
      snapshot: AgentPlanSnapshot
    }

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
    enabledMcpServerIds?: string[]
    enabledPluginIds?: string[]
    agentId?: string
    disabledAgentTools?: string[]
    chatMode?: 'agent' | 'acp agent'
    supportsVision?: boolean
    agentWorkspacePath?: string | null
    conversationId?: string
    activeSkillNames?: string[]
  }): Promise<MCPToolDefinition[]>

  /**
   * Synchronize agent-tool runtime state without rebuilding tool schemas.
   */
  syncAgentToolContext?(context: {
    chatMode?: 'agent' | 'acp agent'
    agentWorkspacePath?: string | null
  }): void

  /**
   * Call a tool, routing to the appropriate source
   * @param request Tool call request
   */
  callTool(
    request: MCPToolCall,
    options?: {
      onProgress?: (update: AgentToolProgressUpdate) => void
      signal?: AbortSignal
      permissionMode?: PermissionMode
      activeSkillNames?: string[]
      agentId?: string
      enabledMcpServerIds?: string[]
      enabledPluginIds?: string[]
    }
  ): Promise<{ content: unknown; rawData: MCPToolResponse }>

  /**
   * Pre-check tool permission without executing the tool.
   */
  preCheckToolPermission?(
    request: MCPToolCall,
    options?: {
      permissionMode?: PermissionMode
    }
  ): Promise<{
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
   * Release any cached tool mapping for a conversation.
   */
  clearConversationToolMapping?(conversationId: string): void

  /**
   * Reset only the per-turn agent plan state for a conversation.
   */
  clearAgentPlanState?(conversationId: string): void

  /**
   * Build system prompt section for tool-related behavior.
   */
  buildToolSystemPrompt(context: {
    conversationId?: string
    toolDefinitions?: MCPToolDefinition[]
  }): string
}
