/**
 * Tool runtime types.
 */

import type {
  MCPToolDefinition,
  MCPToolCall,
  MCPToolResponse,
  ToolDispatchCommit,
  ToolOutcomeProjectionRegistrar
} from '../core/mcp'
import type { DeepChatSubagentCapability, PermissionMode, SessionKind } from '../agent-interface'
import type { AgentPlanSnapshot } from '../agent-plan'
import type { DeepChatExecutionContract } from './execution-contract'
import type { CommandShellProfile, ResolvedCommandShell } from '../commandShell'

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

export interface ToolDefinitionContext {
  enabledMcpTools?: string[]
  enabledMcpServerIds?: string[]
  requireCompleteCatalog?: boolean
  agentId?: string
  disabledAgentTools?: string[]
  chatMode?: 'agent' | 'acp agent'
  supportsVision?: boolean
  agentWorkspacePath?: string | null
  conversationId?: string
  sessionKind?: SessionKind
  activeSkillNames?: string[]
  subagentCapability?: DeepChatSubagentCapability
}

export interface ToolCallOptions {
  runId?: string
  messageId?: string
  requestSeq?: number
  manifestHash?: string
  tapeIncarnationId?: string
  executionContract?: DeepChatExecutionContract
  onProgress?: (update: AgentToolProgressUpdate) => void
  signal?: AbortSignal
  permissionMode?: PermissionMode
  activeSkillNames?: string[]
  agentId?: string
  enabledMcpServerIds?: string[]
  commitDispatch?: ToolDispatchCommit
  registerOutcomeProjection?: ToolOutcomeProjectionRegistrar
  commandShell?: ResolvedCommandShell
  oneShotCommandGrantId?: string
}

export interface ToolPermissionPreCheckResult {
  needsPermission: true
  toolName: string
  serverName: string
  permissionType: 'read' | 'write' | 'all' | 'command'
  description: string
  paths?: string[]
  command?: string
  commandSignature?: string
  shellProfile?: CommandShellProfile
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
  requiresUserConfirmation?: boolean
  [key: string]: unknown
}

/**
 * Interface for the merged Tool catalog and execution service.
 */
export interface ToolServicePort {
  /**
   * Get all tool definitions from all sources
   * @param context Context for tool definition retrieval
   */
  getAllToolDefinitions(context: ToolDefinitionContext): Promise<MCPToolDefinition[]>

  /**
   * Get only Agent tools that users may enable or disable.
   */
  getConfigurableAgentToolDefinitions(context: ToolDefinitionContext): Promise<MCPToolDefinition[]>

  /**
   * Synchronize agent-tool runtime state without rebuilding tool schemas.
   */
  syncAgentToolContext(context: {
    chatMode?: 'agent' | 'acp agent'
    agentWorkspacePath?: string | null
  }): void

  /**
   * Call a tool, routing to the appropriate source
   * @param request Tool call request
   */
  callTool(
    request: MCPToolCall,
    options?: ToolCallOptions
  ): Promise<{ content: unknown; rawData: MCPToolResponse }>

  /**
   * Pre-check tool permission without executing the tool.
   */
  preCheckToolPermission(
    request: MCPToolCall,
    options?: {
      permissionMode?: PermissionMode
      signal?: AbortSignal
      commandShell?: ResolvedCommandShell
    }
  ): Promise<ToolPermissionPreCheckResult | null>

  /**
   * Release any cached tool mapping for a conversation.
   */
  clearConversationToolMapping(conversationId: string): void

  /**
   * Reset only the per-turn agent plan state for a conversation.
   */
  clearAgentPlanState(conversationId: string): void

  /**
   * Build system prompt section for tool-related behavior.
   */
  buildToolSystemPrompt(context: {
    conversationId?: string
    toolDefinitions?: MCPToolDefinition[]
  }): string
}
