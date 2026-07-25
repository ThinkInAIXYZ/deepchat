/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FileItem } from './file'
import type { MCPToolDefinition as CoreMCPToolDefinition } from './core/mcp'

export { TOOL_EXECUTION, stripToolExecutionContract } from './core/mcp'
export type {
  MCPToolDefinitionBase,
  ToolEffect,
  ToolExecutionContract,
  ToolExecutionMode
} from './core/mcp'

export interface McpClient {
  name: string
  icon: string
  isRunning: boolean
  tools: MCPToolDefinition[]
  prompts?: PromptListEntry[]
  resources?: ResourceListEntry[]
}

export interface Resource {
  uri: string
  mimeType?: string
  text?: string
  blob?: string
}

export interface PromptListEntry {
  name: string
  description?: string
  arguments?: {
    name: string
    description?: string
    required: boolean
  }[]
  files?: FileItem[]
  client: {
    name: string
    icon: string
  }
}

export interface ToolCallResult {
  isError?: boolean
  content: Array<{
    type: string
    text: string
  }>
}

export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
}

export interface ResourceListEntry {
  uri: string
  name?: string
  client: {
    name: string
    icon: string
  }
}

export interface MCPServerConfig {
  command: string
  args: string[]
  env: Record<string, unknown>
  descriptions: string
  icons: string
  autoApprove: string[]
  enabled: boolean
  disable?: boolean
  baseUrl?: string
  customHeaders?: Record<string, string>
  customNpmRegistry?: string
  type: 'sse' | 'stdio' | 'inmemory' | 'http'
  source?: string
  sourceId?: string
  ownerPluginId?: string
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>
  mcpEnabled: boolean
  ready: boolean
}

export type McpServerAuthState =
  | 'unsupported'
  | 'none'
  | 'required'
  | 'authenticating'
  | 'authenticated'
  | 'error'

export interface McpServerAuthStatus {
  serverName: string
  state: McpServerAuthState
  authenticated: boolean
  error?: string
  updatedAt?: number
  storage?: 'safeStorage' | 'file' | 'none'
}

export type MCPToolDefinition = CoreMCPToolDefinition

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

export interface MCPToolResponse {
  toolCallId: string
  content: string | MCPContentItem[]
  _meta?: Record<string, any>
  isError?: boolean
  toolResult?: unknown
  imagePreviews?: import('./core/mcp').ToolCallImagePreview[]
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

export type McpSamplingMessage = import('./core/mcp').McpSamplingMessage
export type McpSamplingRequestPayload = import('./core/mcp').McpSamplingRequestPayload
export type McpSamplingDecision = import('./core/mcp').McpSamplingDecision
export type McpSamplingModelPreferences = import('./core/mcp').McpSamplingModelPreferences

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

export interface McpServicePort {
  initialize(): Promise<void>
  shutdown(): Promise<void>
  isReady(): boolean
  getMcpServers(): Promise<Record<string, MCPServerConfig>>
  getMcpClients(): Promise<McpClient[]>
  getEnabledMcpServers(): Promise<string[]>
  setMcpServerEnabled(serverName: string, enabled: boolean): Promise<void>
  addMcpServer(serverName: string, config: MCPServerConfig): Promise<boolean>
  removeMcpServer(serverName: string): Promise<void>
  updateMcpServer(serverName: string, config: Partial<MCPServerConfig>): Promise<void>
  isServerRunning(serverName: string): Promise<boolean>
  isServerActive(serverName: string): Promise<boolean>
  startServer(serverName: string): Promise<void>
  stopServer(serverName: string): Promise<void>
  stopServerDuringShutdownByName(serverName: string): Promise<void>
  getServerLastError(serverName: string): string | undefined
  getMcpServerAuthStatus(serverName: string): Promise<McpServerAuthStatus>
  startMcpServerAuth(serverName: string): Promise<McpServerAuthStatus>
  completeMcpServerAuthFromCallbackUrl(
    serverName: string,
    callbackUrl: string
  ): Promise<McpServerAuthStatus>
  logoutMcpServerAuth(serverName: string): Promise<McpServerAuthStatus>
  getAllToolDefinitions(
    enabledMcpTools?:
      | string[]
      | {
          enabledTools?: string[]
          enabledServerIds?: string[]
          agentId?: string
          conversationId?: string
        }
  ): Promise<MCPToolDefinition[]>
  getAllPrompts(): Promise<Array<PromptListEntry & { client: { name: string; icon: string } }>>
  getAllResources(): Promise<Array<ResourceListEntry & { client: { name: string; icon: string } }>>
  getPrompt(prompt: PromptListEntry, args?: Record<string, unknown>): Promise<unknown>
  readResource(resource: ResourceListEntry): Promise<Resource>
  callTool(
    request: MCPToolCall,
    options?: {
      onProgress?: (update: {
        kind: 'subagent_orchestrator'
        toolCallId: string
        responseMarkdown: string
        progressJson: string
      }) => void
      signal?: AbortSignal
      agentId?: string
      enabledServerIds?: string[]
    }
  ): Promise<{ content: string; rawData: MCPToolResponse }>
  preCheckToolPermission(
    request: MCPToolCall,
    options?: {
      signal?: AbortSignal
      agentId?: string
      enabledServerIds?: string[]
    }
  ): Promise<{
    needsPermission: true
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
  } | null>
  handleSamplingRequest(request: McpSamplingRequestPayload): Promise<McpSamplingDecision>
  submitSamplingDecision(decision: McpSamplingDecision): Promise<void>
  cancelSamplingRequest(requestId: string, reason?: string): Promise<void>
  setMcpEnabled(enabled: boolean): Promise<void>
  getMcpEnabled(): Promise<boolean>
  grantPermission(
    serverName: string,
    permissionType: 'read' | 'write' | 'all',
    remember?: boolean,
    conversationId?: string
  ): Promise<void>
  clearSessionPermissions(conversationId: string): void
  getNpmRegistryStatus(): Promise<{
    currentRegistry: string | null
    isFromCache: boolean
    lastChecked?: number
    autoDetectEnabled: boolean
    customRegistry?: string
  }>
  refreshNpmRegistry(): Promise<string>
  setCustomNpmRegistry(registry: string | undefined): Promise<void>
  setAutoDetectNpmRegistry(enabled: boolean): Promise<void>
  clearNpmRegistryCache(): Promise<void>
  getNpmRegistry(): string | null
  getUvRegistry(): string | null
  listMcpRouterServers(
    page: number,
    limit: number
  ): Promise<{
    servers: Array<{
      uuid: string
      created_at: string
      updated_at: string
      name: string
      author_name: string
      title: string
      description: string
      content?: string
      server_key: string
      config_name?: string
      server_url?: string
    }>
  }>
  installMcpRouterServer(serverKey: string): Promise<boolean>
  getMcpRouterApiKey(): Promise<string | ''>
  setMcpRouterApiKey(key: string): Promise<void>
  isServerInstalled(source: string, sourceId: string): Promise<boolean>
  listInstalledServerIds(source: string, sourceIds: string[]): Promise<string[]>
  updateMcpRouterServersAuth(apiKey: string): Promise<void>
}
