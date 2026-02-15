import type { PermissionRequestOption } from './llm-events'
import type { QuestionInfo } from './question'
import type { UsageStats, RateLimitInfo } from './usage'

export interface LLMAgentEventData {
  eventId: string
  conversationId?: string
  parentId?: string
  is_variant?: boolean
  stream_kind?: 'init' | 'delta' | 'final'
  seq?: number
  content?: string
  reasoning_content?: string
  reasoning_time?: { start: number; end: number }
  tool_call_id?: string
  tool_call_name?: string
  tool_call_params?: string
  tool_call_response?: string | Array<unknown>
  maximum_tool_calls_reached?: boolean
  tool_call_server_name?: string
  tool_call_server_icons?: string
  tool_call_server_description?: string
  tool_call_response_raw?: unknown
  tool_call?:
    | 'start'
    | 'running'
    | 'end'
    | 'error'
    | 'update'
    | 'permission-required'
    | 'permission-granted'
    | 'permission-denied'
    | 'continue'
    | 'question-required'
  permission_request?: {
    toolName: string
    serverName: string
    permissionType: 'read' | 'write' | 'all' | 'command'
    description: string
    command?: string
    commandSignature?: string
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
    options?: PermissionRequestOption[]
    rememberable?: boolean
  }
  question_request?: QuestionInfo
  question_error?: string
  totalUsage?: UsageStats
  image_data?: { data: string; mimeType: string }
  video_data?: { url: string; cover?: string; duration?: number }
  rate_limit?: RateLimitInfo
  media_generation_pending?: {
    taskId: string
    mediaType: 'image' | 'video'
    status: 'queued' | 'processing'
    message?: string
    pollCount?: number
    maxPolls?: number
    canManualRefresh?: boolean
  }
  media_generation_progress?: {
    taskId: string
    mediaType: 'image' | 'video'
    status: 'queued' | 'processing' | 'completed' | 'failed'
    progress?: number
    message?: string
    pollCount: number
    maxPolls: number
    canManualRefresh: boolean
  }
  media_generation_complete?: {
    taskId: string
    mediaType: 'image' | 'video'
    url?: string
    cover?: string
    duration?: number
    error?: string
  }
  error?: string
  userStop?: boolean
}

export type LLMAgentEvent =
  | { type: 'response'; data: LLMAgentEventData }
  | { type: 'error'; data: { eventId: string; error: string } }
  | { type: 'end'; data: { eventId: string; userStop: boolean } }
