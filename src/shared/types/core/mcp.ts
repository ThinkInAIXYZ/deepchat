// MCP related core types (simplified, strong-typed)

export interface MCPToolDefinition {
  type: string
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
  requiresPermission?: boolean
  permissionRequest?: {
    toolName: string
    serverName: string
    permissionType: 'read' | 'write' | 'all'
    description: string
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
