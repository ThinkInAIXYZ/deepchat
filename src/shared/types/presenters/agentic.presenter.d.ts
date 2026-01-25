// Agentic Unified Layer - Unified Presenter Interface
// This file defines the unified protocol for all agent types (ACP and DeepChat)

/**
 * Unified Agentic Presenter Protocol
 * All agent presenters must implement this interface
 */
export interface IAgenticPresenter {
  /** Unique identifier for this agent (e.g., 'deepchat.default', 'acp.anthropic.claude-code') */
  readonly agentId: string

  // Session management
  createSession(config: SessionConfig): Promise<string>
  getSession(sessionId: string): SessionInfo | null | Promise<SessionInfo | null>
  loadSession(sessionId: string, context: LoadContext): Promise<void>
  closeSession(sessionId: string): Promise<void>

  // Messaging
  sendMessage(sessionId: string, content: MessageContent): Promise<void>

  // Control
  cancelMessage(sessionId: string, messageId: string): Promise<void>

  // Model/Mode selection
  setModel(sessionId: string, modelId: string): Promise<void>
  setMode(sessionId: string, modeId: string): Promise<void>
}

/**
 * Session information
 */
export interface SessionInfo {
  sessionId: string
  agentId: string
  status: 'idle' | 'generating' | 'paused' | 'error'

  // Available modes = available permission policy options
  availableModes?: Array<{ id: string; name: string; description: string }>

  // Available models
  availableModels?: Array<{ id: string; name: string; description?: string }>

  // Current selection
  currentModeId?: string
  currentModelId?: string

  // Capability declarations
  capabilities: {
    supportsVision: boolean
    supportsTools: boolean
    supportsModes: boolean
  }
}

/**
 * Message content
 */
export interface MessageContent {
  text?: string
  images?: Array<{ type: 'url' | 'base64' | 'file'; data: string }>
  files?: Array<{ path: string; name: string }>
}

/**
 * Session configuration
 */
export interface SessionConfig {
  modelId?: string
  modeId?: string
  // Additional agent-specific config
  [key: string]: any
}

/**
 * Load context for session loading
 */
export interface LoadContext {
  maxHistory?: number
  includeSystemMessages?: boolean
}

/**
 * Unified event types for all agents
 */
export enum AgenticEventType {
  // Session lifecycle
  SESSION_CREATED = 'agentic.session.created',
  SESSION_UPDATED = 'agentic.session.updated',
  SESSION_CLOSED = 'agentic.session.closed',

  // Message flow
  MESSAGE_DELTA = 'agentic.message.delta',
  MESSAGE_BLOCK = 'agentic.message.block',
  MESSAGE_END = 'agentic.message.end',

  // Tool calls
  TOOL_START = 'agentic.tool.start',
  TOOL_RUNNING = 'agentic.tool.running',
  TOOL_END = 'agentic.tool.end',

  // Status
  STATUS_CHANGED = 'agentic.status.changed',
  ERROR = 'agentic.error'
}

/**
 * Session created event payload
 */
export interface SessionCreatedEvent {
  sessionId: string
  agentId: string
  sessionInfo: SessionInfo
}

/**
 * Session updated event payload
 */
export interface SessionUpdatedEvent {
  sessionId: string
  sessionInfo: Partial<SessionInfo>
}

/**
 * Session closed event payload
 */
export interface SessionClosedEvent {
  sessionId: string
}

/**
 * Message delta event payload
 */
export interface MessageDeltaEvent {
  sessionId: string
  messageId: string
  content: string
  isComplete: boolean
}

/**
 * Message block event payload
 */
export interface MessageBlockEvent {
  sessionId: string
  messageId: string
  blockType: 'text' | 'tool' | 'reasoning' | 'error'
  content: unknown
}

/**
 * Message end event payload
 */
export interface MessageEndEvent {
  sessionId: string
  messageId: string
}

/**
 * Tool start event payload
 */
export interface ToolStartEvent {
  sessionId: string
  toolId: string
  toolName: string
  arguments: Record<string, unknown>
}

/**
 * Tool running event payload
 */
export interface ToolRunningEvent {
  sessionId: string
  toolId: string
  status?: string
}

/**
 * Tool end event payload
 */
export interface ToolEndEvent {
  sessionId: string
  toolId: string
  result?: unknown
  error?: Error
}

/**
 * Status changed event payload
 */
export interface StatusChangedEvent {
  sessionId: string
  status: 'idle' | 'generating' | 'paused' | 'error'
  error?: Error
}

/**
 * Error event payload
 */
export interface AgenticErrorEvent {
  sessionId: string
  error: Error
  context?: Record<string, unknown>
}
