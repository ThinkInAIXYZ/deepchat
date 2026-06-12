// Strong-typed LLM core stream events (discriminated union)

import type { ChatMessageProviderOptions } from './chat-message'

export type StreamEventType =
  | 'text'
  | 'reasoning'
  | 'tool_call_start'
  | 'tool_call_chunk'
  | 'tool_call_end'
  | 'permission'
  | 'error'
  | 'usage'
  | 'stop'
  | 'image_data'
  | 'rate_limit'

export interface TextStreamEvent {
  type: 'text'
  content: string
  provider_options?: ChatMessageProviderOptions
}

export interface ReasoningStreamEvent {
  type: 'reasoning'
  reasoning_content: string
  provider_options?: ChatMessageProviderOptions
}

export interface ToolCallStartEvent {
  type: 'tool_call_start'
  tool_call_id: string
  tool_call_name: string
  provider_options?: ChatMessageProviderOptions
}

export interface ToolCallChunkEvent {
  type: 'tool_call_chunk'
  tool_call_id: string
  tool_call_arguments_chunk: string
  provider_options?: ChatMessageProviderOptions
}

export interface ToolCallEndEvent {
  type: 'tool_call_end'
  tool_call_id: string
  tool_call_arguments_complete?: string
  provider_options?: ChatMessageProviderOptions
}

export interface PermissionRequestEvent {
  type: 'permission'
  permission: PermissionRequestPayload
}

export interface ErrorStreamEvent {
  type: 'error'
  error_message: string
}

export interface UsageStreamEvent {
  type: 'usage'
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    cached_tokens?: number
    cache_write_tokens?: number
  }
}

export interface StopStreamEvent {
  type: 'stop'
  stop_reason: 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error' | 'complete'
}

export interface ImageDataStreamEvent {
  type: 'image_data'
  image_data: {
    data: string
    mimeType: string
  }
}

export interface RateLimitStreamEvent {
  type: 'rate_limit'
  rate_limit: {
    providerId: string
    qpsLimit: number
    currentQps: number
    queueLength: number
    estimatedWaitTime?: number
  }
}

export type LLMCoreStreamEvent =
  | TextStreamEvent
  | ReasoningStreamEvent
  | ToolCallStartEvent
  | ToolCallChunkEvent
  | ToolCallEndEvent
  | PermissionRequestEvent
  | ErrorStreamEvent
  | UsageStreamEvent
  | StopStreamEvent
  | ImageDataStreamEvent
  | RateLimitStreamEvent

export type {
  ChatMessage,
  ChatMessageContent,
  ChatMessageProviderOptions,
  ChatMessageRole,
  ChatMessageToolCall
} from './chat-message'

export const createStreamEvent = {
  text: (content: string, provider_options?: ChatMessageProviderOptions): TextStreamEvent => ({
    type: 'text',
    content,
    ...(provider_options ? { provider_options } : {})
  }),
  reasoning: (
    reasoning_content: string,
    provider_options?: ChatMessageProviderOptions
  ): ReasoningStreamEvent => ({
    type: 'reasoning',
    reasoning_content,
    ...(provider_options ? { provider_options } : {})
  }),
  toolCallStart: (
    tool_call_id: string,
    tool_call_name: string,
    provider_options?: ChatMessageProviderOptions
  ): ToolCallStartEvent => ({
    type: 'tool_call_start',
    tool_call_id,
    tool_call_name,
    ...(provider_options ? { provider_options } : {})
  }),
  toolCallChunk: (
    tool_call_id: string,
    tool_call_arguments_chunk: string,
    provider_options?: ChatMessageProviderOptions
  ): ToolCallChunkEvent => ({
    type: 'tool_call_chunk',
    tool_call_id,
    tool_call_arguments_chunk,
    ...(provider_options ? { provider_options } : {})
  }),
  toolCallEnd: (
    tool_call_id: string,
    tool_call_arguments_complete?: string,
    provider_options?: ChatMessageProviderOptions
  ): ToolCallEndEvent => ({
    type: 'tool_call_end',
    tool_call_id,
    tool_call_arguments_complete,
    ...(provider_options ? { provider_options } : {})
  }),
  permission: (permission: PermissionRequestPayload): PermissionRequestEvent => ({
    type: 'permission',
    permission
  }),
  error: (error_message: string): ErrorStreamEvent => ({ type: 'error', error_message }),
  usage: (usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    cached_tokens?: number
    cache_write_tokens?: number
  }): UsageStreamEvent => ({
    type: 'usage',
    usage
  }),
  stop: (
    stop_reason: 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error' | 'complete'
  ): StopStreamEvent => ({
    type: 'stop',
    stop_reason
  }),
  imageData: (image_data: { data: string; mimeType: string }): ImageDataStreamEvent => ({
    type: 'image_data',
    image_data
  }),
  rateLimit: (rate_limit: {
    providerId: string
    qpsLimit: number
    currentQps: number
    queueLength: number
    estimatedWaitTime?: number
  }): RateLimitStreamEvent => ({
    type: 'rate_limit',
    rate_limit
  })
}

export const isTextEvent = (e: LLMCoreStreamEvent): e is TextStreamEvent => e.type === 'text'
export const isToolCallStartEvent = (e: LLMCoreStreamEvent): e is ToolCallStartEvent =>
  e.type === 'tool_call_start'
export const isErrorEvent = (e: LLMCoreStreamEvent): e is ErrorStreamEvent => e.type === 'error'

export interface PermissionRequestOption {
  optionId: string
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
  name?: string
}

export interface PermissionRequestPayload {
  providerId: string
  providerName?: string
  requestId: string
  sessionId?: string
  conversationId?: string
  agentId?: string
  agentName?: string
  tool_call_id: string
  tool_call_name?: string
  tool_call_params?: string
  description?: string
  permissionType?: 'read' | 'write' | 'all' | 'command'
  server_name?: string
  server_description?: string
  server_icons?: string
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
  options?: PermissionRequestOption[]
  metadata?: Record<string, unknown>
}
