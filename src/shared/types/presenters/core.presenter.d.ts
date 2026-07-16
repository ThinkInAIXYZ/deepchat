/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReasoningEffort, Verbosity } from '../model-db'
import type { FileItem } from '../file'

export type SQLITE_MESSAGE = {
  id: string
  conversation_id: string
  parent_id?: string
  role: MESSAGE_ROLE
  content: string
  created_at: number
  order_seq: number
  token_count: number
  status: MESSAGE_STATUS
  metadata: string // JSON string of MESSAGE_METADATA
  is_context_edge: number // 0 or 1
  is_variant: number
  variants?: SQLITE_MESSAGE[]
}

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
export interface Prompt {
  id: string
  name: string
  description: string
  content?: string
  parameters?: Array<{
    name: string
    description: string
    required: boolean
  }>
  files?: FileItem[] // Associated files
  messages?: Array<{ role: string; content: { text: string } }> // Added based on getPrompt example
  enabled?: boolean // Whether enabled
  source?: 'local' | 'imported' | 'builtin' // Source type
  createdAt?: number // Creation time
  updatedAt?: number // Update time
}

export interface SystemPrompt {
  id: string
  name: string
  content: string
  isDefault?: boolean
  createdAt?: number
  updatedAt?: number
}
export interface PromptListEntry {
  name: string
  description?: string
  arguments?: {
    name: string
    description?: string
    required: boolean
  }[]
  files?: FileItem[] // Associated files
  client: {
    name: string
    icon: string
  }
}
// Interface for tool call results
export interface ToolCallResult {
  isError?: boolean
  content: Array<{
    type: string
    text: string
  }>
}

// Interface for tool lists
export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: {
    title?: string // A human-readable title for the tool.
    readOnlyHint?: boolean // default false
    destructiveHint?: boolean // default true
    idempotentHint?: boolean // default false
    openWorldHint?: boolean // default true
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

export type CONVERSATION_SETTINGS = {
  systemPrompt: string
  temperature: number
  contextLength: number
  maxTokens: number
  providerId: string
  modelId: string
  artifacts: 0 | 1
  enabledMcpTools?: string[]
  thinkingBudget?: number
  reasoningEffort?: ReasoningEffort
  verbosity?: Verbosity
  selectedVariantsMap?: Record<string, string>
  acpWorkdirMap?: Record<string, string | null>
  chatMode?: 'agent' | 'acp agent'
  agentWorkspacePath?: string | null
  activeSkills?: string[] // Activated skills for this conversation
}

export type ParentSelection = {
  selectedText: string
  startOffset: number
  endOffset: number
  contextBefore: string
  contextAfter: string
  contentHash: string
  version?: number
}

export type CONVERSATION = {
  id: string
  title: string
  settings: CONVERSATION_SETTINGS
  createdAt: number
  updatedAt: number
  is_new?: number
  artifacts?: number
  is_pinned?: number
  parentConversationId?: string | null
  parentMessageId?: string | null
  parentSelection?: ParentSelection | null
}

export interface IThreadPresenter {
  // Basic conversation operations
  createConversation(
    title: string,
    settings: Partial<CONVERSATION_SETTINGS>,
    tabId: number,
    options?: { forceNewAndActivate?: boolean } // Added options parameter, supports forced creation of new sessions, avoiding singleton detection for empty sessions
  ): Promise<string>
  deleteConversation(conversationId: string): Promise<void>
  getConversation(conversationId: string): Promise<CONVERSATION>
  renameConversation(conversationId: string, title: string): Promise<CONVERSATION>
  updateConversationTitle(conversationId: string, title: string): Promise<void>
  updateConversationSettings(
    conversationId: string,
    settings: Partial<CONVERSATION_SETTINGS>
  ): Promise<void>

  // Conversation branching operations
  forkConversation(
    targetConversationId: string,
    targetMessageId: string,
    newTitle: string,
    settings?: Partial<CONVERSATION_SETTINGS>,
    selectedVariantsMap?: Record<string, string>
  ): Promise<string>

  createChildConversationFromSelection(payload: {
    parentConversationId: string
    parentMessageId: string
    parentSelection: ParentSelection | string
    title: string
    settings?: Partial<CONVERSATION_SETTINGS>
    tabId?: number
    openInNewTab?: boolean
  }): Promise<string>

  // Conversation list and activation status
  getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }>
  listChildConversationsByParent(parentConversationId: string): Promise<CONVERSATION[]>
  listChildConversationsByMessageIds(parentMessageIds: string[]): Promise<CONVERSATION[]>
  loadMoreThreads(): Promise<{ hasMore: boolean; total: number }>
  setActiveConversation(conversationId: string, tabId: number): Promise<void>
  openConversationInNewTab(payload: {
    conversationId: string
    tabId?: number
    messageId?: string
    childConversationId?: string
  }): Promise<number | null>
  getActiveConversation(tabId: number): Promise<CONVERSATION | null>
  getActiveConversationId(tabId: number): Promise<string | null>
  clearActiveThread(tabId: number): Promise<void>
  findTabForConversation(conversationId: string): Promise<number | null>

  clearAllMessages(conversationId: string): Promise<void>

  // Message operations
  getMessages(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: MESSAGE[] }>
  getMessageThread(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; messages: MESSAGE[] }>
  editMessage(messageId: string, content: string): Promise<MESSAGE>
  deleteMessage(messageId: string): Promise<void>
  getMessage(messageId: string): Promise<MESSAGE>
  getMessageVariants(messageId: string): Promise<MESSAGE[]>
  updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void>
  updateMessageMetadata(messageId: string, metadata: Partial<MESSAGE_METADATA>): Promise<void>
  getMessageExtraInfo(messageId: string, type: string): Promise<Record<string, unknown>[]>
  getMainMessageByParentId(conversationId: string, parentId: string): Promise<MESSAGE | null>
  getLastUserMessage(conversationId: string): Promise<MESSAGE | null>

  // Context control
  getContextMessages(conversationId: string): Promise<MESSAGE[]>
  clearContext(conversationId: string): Promise<void>
  markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void>
  destroy(): void
  toggleConversationPinned(conversationId: string, isPinned: boolean): Promise<void>
}

export type MESSAGE_STATUS = 'sent' | 'pending' | 'error'
export type MESSAGE_ROLE = 'user' | 'assistant' | 'system' | 'function'

export type MESSAGE_METADATA = {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  generationTime: number
  firstTokenTime: number
  tokensPerSecond: number
  contextUsage: number
  model?: string
  provider?: string
  reasoningStartTime?: number
  reasoningEndTime?: number
}

export interface IMessageManager {
  // Basic message operations
  sendMessage(
    conversationId: string,
    content: string,
    role: MESSAGE_ROLE,
    parentId: string,
    isVariant: boolean,
    metadata: MESSAGE_METADATA
  ): Promise<MESSAGE>
  editMessage(messageId: string, content: string): Promise<MESSAGE>
  deleteMessage(messageId: string): Promise<void>
  retryMessage(messageId: string, metadata: MESSAGE_METADATA): Promise<MESSAGE>

  // Message queries
  getMessage(messageId: string): Promise<MESSAGE>
  getMessageVariants(messageId: string): Promise<MESSAGE[]>
  getMessageThread(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{
    total: number
    list: MESSAGE[]
  }>
  getContextMessages(conversationId: string, contextLength: number): Promise<MESSAGE[]>

  // Message status management
  updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void>
  updateMessageMetadata(messageId: string, metadata: Partial<MESSAGE_METADATA>): Promise<void>

  // Context management
  markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void>
}

export type LLMResponse = {
  content: string
  reasoning_content?: string
  tool_call_name?: string
  tool_call_params?: string
  tool_call_response?: string
  tool_call_id?: string
  tool_call_server_name?: string
  tool_call_server_icons?: string
  tool_call_server_description?: string
  tool_call_response_raw?: MCPToolResponse
  maximum_tool_calls_reached?: boolean
  totalUsage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}
export type LLMResponseStream = {
  content?: string
  reasoning_content?: string
  image_data?: {
    data: string
    mimeType: string
  }
  tool_call?: 'start' | 'end' | 'error'
  tool_call_name?: string
  tool_call_params?: string
  tool_call_response?: string
  tool_call_id?: string
  tool_call_server_name?: string
  tool_call_server_icons?: string
  tool_call_server_description?: string
  tool_call_response_raw?: MCPToolResponse
  maximum_tool_calls_reached?: boolean
  totalUsage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}
// Update status types
export type UpdateStatus =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateProgress {
  bytesPerSecond: number
  percent: number
  transferred: number
  total: number
}

// Define model interface based on Ollama SDK
// Define progress callback interface
// MCP related type definitions
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
  source?: string // Source identifier: "mcprouter" | "modelscope" | undefined(for manual)
  sourceId?: string // Source ID: mcprouter uuid or modelscope mcpServer.id
  ownerPluginId?: string // Plugin owner id for managed plugin MCP servers
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

export interface MCPToolDefinition {
  type: string
  source?: 'mcp' | 'agent'
  function: {
    name: string
    description: string
    parameters: {
      type: string
      properties: Record<string, any>
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
  /**
   * Optional conversation context (used for ACP agent MCP access control).
   */
  conversationId?: string
  /** Session provider used for ACP MCP access control. */
  providerId?: string
}

export interface MCPToolResponse {
  /** Unique identifier for tool call */
  toolCallId: string

  /**
   * Tool call response content
   * Can be simple string or structured content array
   */
  content: string | MCPContentItem[]

  /** Optional metadata */
  _meta?: Record<string, any>

  /** Whether an error occurred */
  isError?: boolean

  /** When using compatibility mode, may directly return tool results */
  toolResult?: unknown

  /** Image previews extracted from tool output for renderer display */
  imagePreviews?: import('../core/mcp').ToolCallImagePreview[]

  /** Whether permission is required */
  requiresPermission?: boolean

  /** Permission request information */
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

export type McpSamplingMessage = import('../../core/mcp').McpSamplingMessage
export type McpSamplingRequestPayload = import('../../core/mcp').McpSamplingRequestPayload
export type McpSamplingDecision = import('../../core/mcp').McpSamplingDecision
export type McpSamplingModelPreferences = import('../../core/mcp').McpSamplingModelPreferences

/** Content item type */
export type MCPContentItem = MCPTextContent | MCPImageContent | MCPResourceContent

/** Text content */
export interface MCPTextContent {
  type: 'text'
  text: string
}

/** Image content */
export interface MCPImageContent {
  type: 'image'
  data: string // Base64 encoded image data
  mimeType: string // E.g., "image/png", "image/jpeg", etc.
}

/** Resource content */
export interface MCPResourceContent {
  type: 'resource'
  resource: {
    uri: string
    mimeType?: string
    /** Resource text content, mutually exclusive with blob */
    text?: string
    /** Resource binary content, mutually exclusive with text */
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

  // Permission management
  grantPermission(
    serverName: string,
    permissionType: 'read' | 'write' | 'all',
    remember?: boolean,
    conversationId?: string
  ): Promise<void>
  clearSessionPermissions(conversationId: string): void
  // NPM Registry management methods
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
  // Get npm/uv registry for internal use (ACP, etc.)
  getNpmRegistry(): string | null
  getUvRegistry(): string | null

  // McpRouter marketplace
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
  updateMcpRouterServersAuth(apiKey: string): Promise<void>
}

// Standardized events returned from LLM Provider's coreStream
export type LLMCoreStreamEvent = import('../../core/llm-events').LLMCoreStreamEvent

// Define ChatMessage interface for unified message format
export type ChatMessage = import('../../core/llm-events').ChatMessage

export type ChatMessageContent = import('../../core/llm-events').ChatMessageContent

export type LLMAgentEventData = import('../../core/agent-events').LLMAgentEventData
export type LLMAgentEvent = import('../../core/agent-events').LLMAgentEvent
