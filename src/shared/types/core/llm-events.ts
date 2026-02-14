// Strong-typed LLM core stream events (discriminated union)

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
  | 'video_data'
  | 'rate_limit'

export interface TextStreamEvent {
  type: 'text'
  content: string
}

export interface ReasoningStreamEvent {
  type: 'reasoning'
  reasoning_content: string
}

export interface ToolCallStartEvent {
  type: 'tool_call_start'
  tool_call_id: string
  tool_call_name: string
}

export interface ToolCallChunkEvent {
  type: 'tool_call_chunk'
  tool_call_id: string
  tool_call_arguments_chunk: string
}

export interface ToolCallEndEvent {
  type: 'tool_call_end'
  tool_call_id: string
  tool_call_arguments_complete?: string
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

export interface VideoDataStreamEvent {
  type: 'video_data'
  video_data: {
    url: string
    cover?: string
    duration?: number
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
  | VideoDataStreamEvent
  | RateLimitStreamEvent

export type {
  ChatMessage,
  ChatMessageContent,
  ChatMessageRole,
  ChatMessageToolCall
} from './chat-message'

export const createStreamEvent = {
  text: (content: string): TextStreamEvent => ({ type: 'text', content }),
  reasoning: (reasoning_content: string): ReasoningStreamEvent => ({
    type: 'reasoning',
    reasoning_content
  }),
  toolCallStart: (tool_call_id: string, tool_call_name: string): ToolCallStartEvent => ({
    type: 'tool_call_start',
    tool_call_id,
    tool_call_name
  }),
  toolCallChunk: (tool_call_id: string, tool_call_arguments_chunk: string): ToolCallChunkEvent => ({
    type: 'tool_call_chunk',
    tool_call_id,
    tool_call_arguments_chunk
  }),
  toolCallEnd: (tool_call_id: string, tool_call_arguments_complete?: string): ToolCallEndEvent => ({
    type: 'tool_call_end',
    tool_call_id,
    tool_call_arguments_complete
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
  videoData: (video_data: {
    url: string
    cover?: string
    duration?: number
  }): VideoDataStreamEvent => ({
    type: 'video_data',
    video_data
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
  options?: PermissionRequestOption[]
  metadata?: Record<string, unknown>
}
