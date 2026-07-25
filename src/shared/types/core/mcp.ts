// MCP related core types (simplified, strong-typed)

export type McpServerLifecycleStatus =
  | 'connecting'
  | 'connected'
  | 'timeout'
  | 'retrying'
  | 'failed'
  | 'stopped'

export type McpServerStatusPhase = 'startup' | 'manual' | 'retry' | 'shutdown'

export type McpServerStatusReason = 'soft-timeout' | 'hard-timeout' | 'connect-error' | 'shutdown'

export interface McpServerStatusChangedPayload {
  serverName: string
  name?: string
  lifecycleStatus: McpServerLifecycleStatus
  status?: McpServerLifecycleStatus | 'running'
  isRunning: boolean
  phase?: McpServerStatusPhase
  attempt?: number
  reason?: McpServerStatusReason
  message?: string
  version: number
}

export type ToolExecutionMode = 'sequential' | 'parallel'

export type ToolEffect = 'read' | 'write'

export type ToolExecutionContract =
  | { readonly effect: 'read'; readonly mode: ToolExecutionMode }
  | { readonly effect: 'write'; readonly mode: 'sequential' }

type ToolExecutionPresetCatalog = {
  readonly read: {
    readonly [Mode in ToolExecutionMode]: {
      readonly effect: 'read'
      readonly mode: Mode
    }
  }
  readonly write: Extract<ToolExecutionContract, { effect: 'write' }>
}

export const TOOL_EXECUTION = Object.freeze({
  read: Object.freeze({
    sequential: Object.freeze({ effect: 'read', mode: 'sequential' }),
    parallel: Object.freeze({ effect: 'read', mode: 'parallel' })
  }),
  write: Object.freeze({ effect: 'write', mode: 'sequential' })
}) satisfies ToolExecutionPresetCatalog

export interface MCPToolDefinitionBase {
  type: string
  source?: 'mcp' | 'agent'
  function: {
    name: string
    description: string
    parameters: {
      type: string
      properties: Record<string, unknown>
      required?: string[]
    }
  }
  server: {
    name: string
    icons: string
    description: string
  }
}

export type MCPToolDefinition = MCPToolDefinitionBase & {
  readonly execution: ToolExecutionContract
}

export function stripToolExecutionContract({
  execution: _execution,
  ...baseDefinition
}: MCPToolDefinition): MCPToolDefinitionBase {
  return baseDefinition
}

export interface MCPToolCall {
  id: string
  type: string
  function: {
    name: string
    arguments: string
  }
  server?: {
    name: string
    icons: string
    description: string
  }
  conversationId?: string
  providerId?: string
}

export type MCPContentItem = MCPTextContent | MCPImageContent | MCPResourceContent

export interface MCPTextContent {
  type: 'text'
  text: string
}

export interface MCPImageContent {
  type: 'image'
  data: string
  mimeType: string
}

export type ToolCallImagePreviewSource = 'tool_output' | 'file_read' | 'screenshot' | 'mcp_image'

export interface ToolCallImagePreview {
  id: string
  data?: string | null
  mimeType: string
  title?: string
  source: ToolCallImagePreviewSource
}

export interface MCPResourceContent {
  type: 'resource'
  resource: {
    uri: string
    mimeType?: string
    text?: string
    blob?: string
  }
}

export interface MCPToolResponse {
  toolCallId: string
  content: string | MCPContentItem[]
  _meta?: Record<string, unknown>
  isError?: boolean
  toolResult?: unknown
  rtkApplied?: boolean
  rtkMode?: 'rewrite' | 'direct' | 'bypass'
  rtkFallbackReason?: string
  imagePreviews?: ToolCallImagePreview[]
  requiresPermission?: boolean
  permissionRequest?: {
    toolName: string
    serverName: string
    permissionType: 'read' | 'write' | 'all' | 'command'
    description: string
    command?: string
    commandSignature?: string
    commandInfo?: {
      command: string
      riskLevel: 'low' | 'medium' | 'high' | 'critical'
      suggestion: string
      signature?: string
      baseCommand?: string
    }
    conversationId?: string
  }
}

export type McpSamplingMessageType = 'text' | 'image' | 'audio'

export interface McpSamplingMessage {
  role: 'user' | 'assistant'
  type: McpSamplingMessageType
  /**
   * Plain text content when the message type is `text`.
   */
  text?: string
  /**
   * Base64 payload rendered as a data URL in the renderer when type is `image` or `audio`.
   */
  dataUrl?: string
  /**
   * MIME type of the binary payload when available.
   */
  mimeType?: string
}

export interface McpSamplingModelPreferences {
  costPriority?: number
  speedPriority?: number
  intelligencePriority?: number
  hints?: Array<{ name?: string | null }>
}

export interface McpSamplingRequestPayload {
  requestId: string
  serverName: string
  serverLabel?: string
  systemPrompt?: string
  maxTokens?: number
  modelPreferences?: McpSamplingModelPreferences
  requiresVision: boolean
  messages: McpSamplingMessage[]
}

export interface McpSamplingDecision {
  requestId: string
  approved: boolean
  providerId?: string
  modelId?: string
  reason?: string
}
