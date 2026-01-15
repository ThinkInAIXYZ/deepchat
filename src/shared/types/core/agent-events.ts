import type { PermissionRequestOption } from './llm-events'
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
  totalUsage?: UsageStats
  image_data?: { data: string; mimeType: string }
  rate_limit?: RateLimitInfo
  error?: string
  userStop?: boolean
}

export type LLMAgentEvent =
  | { type: 'response'; data: LLMAgentEventData }
  | { type: 'error'; data: { eventId: string; error: string } }
  | { type: 'end'; data: { eventId: string; userStop: boolean } }
