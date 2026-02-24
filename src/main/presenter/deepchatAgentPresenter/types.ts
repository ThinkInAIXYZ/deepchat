import type { AssistantMessageBlock, MessageMetadata } from '@shared/types/agent-interface'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { MCPToolDefinition, ModelConfig } from '@shared/presenter'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import type { DeepChatMessageStore } from './messageStore'

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
  modelId: string
  modelConfig: ModelConfig
  temperature: number
  maxTokens: number
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
