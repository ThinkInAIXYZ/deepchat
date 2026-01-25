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
  SESSION_READY = 'agentic.session.ready',
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
  // Tool permission lifecycle (DeepChat agents)
  TOOL_PERMISSION_REQUIRED = 'agentic.tool.permission-required',
  TOOL_PERMISSION_GRANTED = 'agentic.tool.permission-granted',
  TOOL_PERMISSION_DENIED = 'agentic.tool.permission-denied',

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
  blockType:
    | 'text'
    | 'tool'
    | 'reasoning'
    | 'error'
    | 'image'
    | 'action'
    | 'search'
    | 'mcp_ui_resource'
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

/**
 * Session ready event payload (emitted when loadSession completes)
 */
export interface SessionReadyEvent {
  sessionId: string
  agentId: string
  messageCount?: number
}

/**
 * Tool permission required event payload
 */
export interface ToolPermissionRequiredEvent {
  sessionId: string
  toolId: string
  toolName: string
  request: {
    permissionType: 'read' | 'write' | 'all' | 'command'
    toolName?: string
    serverName?: string
    description?: string
    command?: string
    commandInfo?: {
      command: string
      riskLevel: 'low' | 'medium' | 'high' | 'critical'
      suggestion: string
      signature?: string
      baseCommand?: string
    }
    rememberable?: boolean
  }
}

/**
 * Tool permission granted event payload
 */
export interface ToolPermissionGrantedEvent {
  sessionId: string
  toolId: string
}

/**
 * Tool permission denied event payload
 */
export interface ToolPermissionDeniedEvent {
  sessionId: string
  toolId: string
}

/**
 * Permission request payload (shared between agents)
 */
export interface PermissionRequestPayload {
  permissionType: 'read' | 'write' | 'all' | 'command'
  toolName?: string
  serverName?: string
  description?: string
  command?: string
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
}

/**
 * Agentic Event Emitter Interface
 * All agents MUST use this interface to send events to the renderer
 */
export interface AgenticEventEmitter {
  // Message flow events
  messageDelta(messageId: string, content: string, isComplete: boolean): void
  messageEnd(messageId: string): void
  messageBlock(messageId: string, blockType: string, content: unknown): void

  // Tool call events
  toolStart(toolId: string, toolName: string, toolArguments: Record<string, unknown>): void
  toolRunning(toolId: string, status?: string): void
  toolEnd(toolId: string, result?: unknown, error?: Error): void

  // Tool permission lifecycle (DeepChat agents)
  toolPermissionRequired(toolId: string, toolName: string, request: PermissionRequestPayload): void
  toolPermissionGranted(toolId: string): void
  toolPermissionDenied(toolId: string): void

  // Session lifecycle events (for internal use by presenters)
  sessionReady(sessionId: string, messageCount?: number): void
  sessionUpdated(info: Partial<SessionInfo>): void

  // Status events
  statusChanged(status: 'idle' | 'generating' | 'paused' | 'error', error?: Error): void
}
