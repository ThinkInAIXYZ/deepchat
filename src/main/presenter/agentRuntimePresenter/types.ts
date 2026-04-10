import type {
  AssistantMessageBlock,
  MessageMetadata,
  PermissionMode,
  QuestionOption
} from '@shared/types/agent-interface'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { ChatMessage, ChatMessageProviderOptions } from '@shared/types/core/chat-message'
import type { MCPToolDefinition, MCPToolResponse } from '@shared/types/core/mcp'
import type { ModelConfig } from '@shared/presenter'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import type { DeepChatMessageStore } from './messageStore'
import type { ToolOutputGuard } from './toolOutputGuard'

export interface InterleavedReasoningConfig {
  preserveReasoningContent: boolean
  forcedBySessionSetting: boolean
  portraitInterleaved: boolean
  reasoningSupported: boolean
  providerDbSourceUrl: string
}

export interface ToolCallResult {
  id: string
  name: string
  arguments: string
  providerOptions?: ChatMessageProviderOptions
  serverName?: string
  serverIcons?: string
  serverDescription?: string
}

export interface StreamState {
  blocks: AssistantMessageBlock[]
  metadata: MessageMetadata
  startTime: number
  firstTokenTime: number | null
  pendingToolCalls: Map<
    string,
    {
      name: string
      arguments: string
      blockIndex: number
      providerOptions?: ChatMessageProviderOptions
    }
  >
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
  onInterleavedReasoningGap?: (gap: {
    providerId: string
    modelId: string
    providerDbSourceUrl: string
    reasoningContentLength: number
    toolCallCount: number
  }) => void
  autoGrantPermission?: (
    permission: NonNullable<PendingToolInteraction['permission']>
  ) => Promise<void>
  normalizeToolResult?: (tool: {
    sessionId: string
    toolCallId: string
    toolName: string
    toolArgs: string
    content: MCPToolResponse['content']
    isError: boolean
  }) => Promise<MCPToolResponse['content']>
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
  interleavedReasoning: InterleavedReasoningConfig
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
