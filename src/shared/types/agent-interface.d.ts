/**
 * Agent Interface Protocol
 *
 * The unified contract every agent implementation must satisfy.
 * v2: multi-turn chat with MCP tool calling, no permission checks.
 */

export type SessionStatus = 'idle' | 'generating' | 'error'

export interface DeepChatSessionState {
  status: SessionStatus
  providerId: string
  modelId: string
}

export interface IAgentImplementation {
  /** Initialize a new session for this agent */
  initSession(
    sessionId: string,
    config: { providerId: string; modelId: string; projectDir?: string | null }
  ): Promise<void>

  /** Destroy a session and all its data */
  destroySession(sessionId: string): Promise<void>

  /** Get runtime state for a session */
  getSessionState(sessionId: string): Promise<DeepChatSessionState | null>

  /** Process a user message: persist, call LLM, stream response */
  processMessage(
    sessionId: string,
    content: string,
    context?: { projectDir?: string | null }
  ): Promise<void>

  /** Cancel an in-progress generation */
  cancelGeneration(sessionId: string): Promise<void>

  /** Get all messages for a session, ordered by order_seq */
  getMessages(sessionId: string): Promise<ChatMessageRecord[]>

  /** Get only message IDs for a session, ordered by order_seq */
  getMessageIds(sessionId: string): Promise<string[]>

  /** Get a single message by ID */
  getMessage(messageId: string): Promise<ChatMessageRecord | null>
}

// ---- Message Types ----

export interface UserMessageContent {
  text: string
  files: MessageFile[]
  links: string[]
  search: boolean
  think: boolean
}

export interface MessageFile {
  name: string
  path: string
  type: string
  size: number
}

export type AssistantBlockType = 'content' | 'reasoning_content' | 'error' | 'tool_call'

export interface ToolCallBlockData {
  id: string
  name: string
  params: string
  response: string
  server_name?: string
  server_icons?: string
  server_description?: string
}

export interface AssistantMessageBlock {
  type: AssistantBlockType
  content: string
  status: 'pending' | 'success' | 'error'
  timestamp: number
  reasoning_time?: number // only for reasoning_content blocks
  tool_call?: ToolCallBlockData // only for tool_call blocks
}

export interface MessageMetadata {
  totalTokens?: number
  inputTokens?: number
  outputTokens?: number
  generationTime?: number
  firstTokenTime?: number
  tokensPerSecond?: number
  model?: string
  provider?: string
}

export interface ChatMessageRecord {
  id: string
  sessionId: string
  orderSeq: number
  role: 'user' | 'assistant'
  content: string // JSON string: UserMessageContent or AssistantMessageBlock[]
  status: 'pending' | 'sent' | 'error'
  isContextEdge: number
  metadata: string // JSON string: MessageMetadata
  createdAt: number
  updatedAt: number
}

// ---- Session / Agent Types ----

export interface Agent {
  id: string
  name: string
  type: 'deepchat' | 'acp'
  enabled: boolean
}

export interface SessionRecord {
  id: string
  agentId: string
  title: string
  projectDir: string | null
  isPinned: boolean
  createdAt: number
  updatedAt: number
}

export interface SessionWithState extends SessionRecord {
  status: SessionStatus
  providerId: string
  modelId: string
}

export interface CreateSessionInput {
  agentId: string
  message: string
  projectDir?: string
  providerId?: string
  modelId?: string
}

// ---- Project Types ----

export interface Project {
  path: string
  name: string
  icon: string | null
  lastAccessedAt: number
}
