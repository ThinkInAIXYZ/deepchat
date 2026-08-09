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
    id?: string
    configGeneration?: number
    bindingHash?: string
  }
  raw?: {
    name: string
    title?: string
    description?: string
    icons?: Array<{
      src: string
      mimeType?: string
      sizes?: string[]
      theme?: 'light' | 'dark'
    }>
    inputSchema: Record<string, unknown>
    outputSchema?: Record<string, unknown>
    annotations?: Record<string, unknown>
    _meta?: Record<string, unknown>
    execution?: Record<string, unknown>
  }
}

export type MCPToolDefinition = MCPToolDefinitionBase & {
  readonly execution: ToolExecutionContract
}

export interface ToolDispatchCommitInput {
  toolName: string
  toolSource: 'agent' | 'mcp'
  normalizedArguments: Record<string, unknown>
  target: {
    serverName: string
    originalName?: string
    ownerPluginId?: string
  }
}

export type ToolDispatchCommit = (input: ToolDispatchCommitInput) => void

export type ToolOutcomeProjection = () => void

export type ToolOutcomeProjectionRegistrar = (projection: ToolOutcomeProjection) => void

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

export interface MCPContentAnnotations {
  [key: string]: unknown
  audience?: Array<'user' | 'assistant'>
  priority?: number
  lastModified?: string
}

export interface MCPContentBase {
  [key: string]: unknown
  annotations?: MCPContentAnnotations
  _meta?: Record<string, unknown>
}

export type MCPContentItem =
  | MCPTextContent
  | MCPImageContent
  | MCPAudioContent
  | MCPResourceContent
  | MCPResourceLinkContent

export interface MCPTextContent extends MCPContentBase {
  type: 'text'
  text: string
}

export interface MCPImageContent extends MCPContentBase {
  type: 'image'
  data: string
  mimeType: string
}

export interface MCPAudioContent extends MCPContentBase {
  type: 'audio'
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

export interface MCPResourceContent extends MCPContentBase {
  type: 'resource'
  resource: MCPResourceContents
}

export interface MCPResourceContents {
  [key: string]: unknown
  uri: string
  mimeType?: string
  text?: string
  blob?: string
  _meta?: Record<string, unknown>
}

export interface MCPResourceLinkContent extends MCPContentBase {
  type: 'resource_link'
  uri: string
  name: string
  title?: string
  description?: string
  mimeType?: string
  size?: number
  icons?: Array<{
    src: string
    mimeType?: string
    sizes?: string[]
    theme?: 'light' | 'dark'
  }>
}

export interface McpAppDescriptor {
  schemaVersion: 1
  serverId: string
  configGeneration: number
  bindingHash: string
  serverName: string
  toolName: string
  resourceUri: string
  resourceMimeType: string
}

export interface McpAppModelContext {
  content?: MCPContentItem[]
  structuredContent?: Record<string, unknown>
  approvedHash?: string
}

export interface PersistedMcpToolResult {
  schemaVersion: 1
  serverId: string
  configGeneration: number
  bindingHash: string
  toolName: string
  isError?: boolean
  content?: MCPContentItem[]
  structuredContent?: unknown
  meta?: Record<string, unknown>
  app?: McpAppDescriptor
  modelContext?: McpAppModelContext
  truncated?: {
    content?: boolean
    structuredContent?: boolean
    meta?: boolean
    binaryContentOmitted?: boolean
  }
}

export interface MCPToolResponse {
  toolCallId: string
  content: string | MCPContentItem[]
  _meta?: Record<string, unknown>
  isError?: boolean
  structuredContent?: unknown
  mcpResult?: PersistedMcpToolResult
  ownerPluginId?: string
  toolResult?: unknown
  rtkApplied?: boolean
  rtkMode?: 'rewrite' | 'direct' | 'bypass'
  rtkFallbackReason?: string
  outputOffloadPath?: string
  imagePreviews?: ToolCallImagePreview[]
  requiresPermission?: boolean
  permissionRequest?: {
    toolName: string
    serverName: string
    permissionType: 'read' | 'write' | 'all' | 'command'
    description: string
    command?: string
    commandSignature?: string
    shellProfile?: import('../../commandShell').CommandShellProfile
    commandInfo?: {
      command: string
      riskLevel: 'low' | 'medium' | 'high' | 'critical'
      suggestion: string
      signature?: string
      baseCommand?: string
    }
    conversationId?: string
    requestId?: string
    rememberable?: boolean
    requiresUserConfirmation?: boolean
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
  serverId?: string
  configGeneration?: number
  bindingHash?: string
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
