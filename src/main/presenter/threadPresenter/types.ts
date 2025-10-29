import type { AssistantMessage } from '@shared/chat'
import type { PendingToolCall } from './promptBuilder'

export interface GeneratingMessageState {
  message: AssistantMessage
  conversationId: string
  startTime: number
  firstTokenTime: number | null
  promptTokens: number
  reasoningStartTime: number | null
  reasoningEndTime: number | null
  lastReasoningTime: number | null
  isSearching?: boolean
  isCancelled?: boolean
  pendingToolCall?: PendingToolCall
  totalUsage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    context_length: number
  }
  adaptiveBuffer?: {
    content: string
    lastUpdateTime: number
    updateCount: number
    totalSize: number
    isLargeContent: boolean
    chunks?: string[]
    currentChunkIndex?: number
    sentPosition: number
    isProcessing?: boolean
  }
  flushTimeout?: NodeJS.Timeout
  throttleTimeout?: NodeJS.Timeout
  lastRendererUpdateTime?: number
}
