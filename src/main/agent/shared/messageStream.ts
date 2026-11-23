import type { AssistantMessageBlock, MessageMetadata } from '@shared/types/agent-interface'
import type { ProviderRoundStopReason, ToolCallExecutionOwner } from '@shared/types/core/llm-events'
import type { ChatMessageProviderOptions } from '@shared/types/core/chat-message'
import type { DeepChatOutputPort } from './output'
import type { SessionTranscriptPort } from '@/session/data/contracts'

/** Desktop stream projection only; it owns no inference, loop, queue or tool execution. */
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
      executionOwner: ToolCallExecutionOwner
      providerOptions?: ChatMessageProviderOptions
    }
  >
  completedToolCalls: ToolCallResult[]
  stopReason: ProviderRoundStopReason | null
  roundUsage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cachedInputTokens?: number
    cacheWriteInputTokens?: number
  } | null
  toolCallCount: number
  dirty: boolean
  blocksRevision: number
}

export interface IoParams {
  sessionId: string
  requestId: string
  messageId: string
  providerId: string
  modelId: string
  messageStore: SessionTranscriptPort
  abortSignal: AbortSignal
  output: DeepChatOutputPort
}

export function createState(): StreamState {
  return {
    blocks: [],
    metadata: {},
    startTime: Date.now(),
    firstTokenTime: null,
    pendingToolCalls: new Map(),
    completedToolCalls: [],
    stopReason: null,
    roundUsage: null,
    toolCallCount: 0,
    dirty: false,
    blocksRevision: 0
  }
}

export function markStreamChanged(state: StreamState): void {
  state.dirty = true
  state.blocksRevision += 1
}
