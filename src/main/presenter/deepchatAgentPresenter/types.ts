import type {
  AssistantMessageBlock,
  MessageMetadata,
  PermissionMode,
  QuestionOption
} from '@shared/types/agent-interface'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { MCPToolDefinition, ModelConfig } from '@shared/presenter'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import type { DeepChatMessageStore } from './messageStore'
import type { ToolOutputGuard } from './toolOutputGuard'

export interface ToolCallResult {
  id: string
  name: string
  arguments: string
  serverName?: string
  serverIcons?: string
  serverDescription?: string
}

export interface StreamState {
  blocks: AssistantMessageBlock[]
  metadata: MessageMetadata
  startTime: number
  firstTokenTime: number | null
  pendingToolCalls: Map<string, { name: string; arguments: string; blockIndex: number }>
  completedToolCalls: ToolCallResult[]
  stopReason: 'complete' | 'tool_use' | 'error' | 'abort' | 'max_tokens'
  dirty: boolean
}

export interface IoParams {
  sessionId: string
  messageId: string
  messageStore: DeepChatMessageStore
  abortSignal: AbortSignal
}

export interface ProcessHooks {
  onPreToolUse?: (tool: { callId?: string; name?: string; params?: string }) => void
  onPostToolUse?: (tool: {
    callId?: string
    name?: string
    params?: string
    response?: string
  }) => void
  onPostToolUseFailure?: (tool: {
    callId?: string
    name?: string
    params?: string
    error?: string
  }) => void
  onPermissionRequest?: (
    permission: Record<string, unknown>,
    tool: {
      callId?: string
      name?: string
      params?: string
    }
  ) => void
}

export interface PendingToolInteraction {
  type: 'question' | 'permission'
  messageId: string
  toolCallId: string
  toolName: string
  toolArgs: string
  serverName?: string
  serverIcons?: string
  serverDescription?: string
  question?: {
    header?: string
    question: string
    options: QuestionOption[]
    custom: boolean
    multiple: boolean
  }
  permission?: {
    permissionType: 'read' | 'write' | 'all' | 'command'
    description: string
    toolName?: string
    serverName?: string
    providerId?: string
    requestId?: string
    rememberable?: boolean
    command?: string
    commandSignature?: string
    paths?: string[]
    commandInfo?: {
      command: string
      riskLevel: 'low' | 'medium' | 'high' | 'critical'
      suggestion: string
      signature?: string
      baseCommand?: string
    }
  }
}

export interface ProcessResult {
  status: 'completed' | 'paused' | 'aborted' | 'error'
  pendingInteractions?: PendingToolInteraction[]
  terminalError?: string
  stopReason?: string
  usage?: Record<string, number>
  errorMessage?: string
}

export interface ProcessParams {
  messages: ChatMessage[]
  tools: MCPToolDefinition[]
  toolPresenter: IToolPresenter | null
  coreStream: (
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    tools: MCPToolDefinition[]
  ) => AsyncGenerator<LLMCoreStreamEvent>
  providerId: string
  modelId: string
  modelConfig: ModelConfig
  temperature: number
  maxTokens: number
  permissionMode: PermissionMode
  toolOutputGuard: ToolOutputGuard
  initialBlocks?: AssistantMessageBlock[]
  hooks?: ProcessHooks
  io: IoParams
}

export function createState(): StreamState {
  return {
    blocks: [],
    metadata: {},
    startTime: Date.now(),
    firstTokenTime: null,
    pendingToolCalls: new Map(),
    completedToolCalls: [],
    stopReason: 'complete',
    dirty: false
  }
}
