import type { MessageFile } from '@shared/types/agent-interface'

export type DisplayMessageUsage = {
  context_usage: number
  tokens_per_second: number
  total_tokens: number
  generation_time: number
  first_token_time: number
  reasoning_start_time: number
  reasoning_end_time: number
  input_tokens: number
  output_tokens: number
}

export type DisplayUserMessageTextBlock = {
  type: 'text'
  content: string
}

export type DisplayUserMessageCodeBlock = {
  type: 'code'
  content: string
  language: string
}

export type DisplayUserMessageMentionBlock = {
  type: 'mention'
  content: string
  id: string
  category: string
}

export type DisplayUserMessageContent = {
  continue?: boolean
  files: MessageFile[]
  resources?: unknown[]
  prompts?: unknown[]
  links: string[]
  think: boolean
  search: boolean
  text: string
  content?: (
    | DisplayUserMessageTextBlock
    | DisplayUserMessageMentionBlock
    | DisplayUserMessageCodeBlock
  )[]
}

export type DisplayAssistantMessageExtra = Record<string, string | number | object[] | boolean> & {
  needsUserAction?: boolean
  permissionType?: 'read' | 'write' | 'all' | 'command'
  grantedPermissions?: 'read' | 'write' | 'all' | 'command'
  toolName?: string
  serverName?: string
  providerId?: string
  permissionRequestId?: string
  permissionRequest?: string
  commandInfo?: string
  rememberable?: boolean
  questionHeader?: string
  questionText?: string
  questionOptions?:
    | Array<{
        label: string
        description?: string
      }>
    | string
  questionMultiple?: boolean
  questionCustom?: boolean
  questionResolution?: 'asked' | 'replied' | 'rejected'
  answerText?: string
  answerMessageId?: string
}

export type DisplayAssistantMessageBlock = {
  type:
    | 'content'
    | 'search'
    | 'reasoning_content'
    | 'plan'
    | 'error'
    | 'tool_call'
    | 'action'
    | 'image'
    | 'audio'
    | 'artifact-thinking'
    | 'mcp_ui_resource'
  id?: string
  content?: string
  extra?: DisplayAssistantMessageExtra
  status:
    | 'success'
    | 'loading'
    | 'cancel'
    | 'error'
    | 'reading'
    | 'optimizing'
    | 'pending'
    | 'granted'
    | 'denied'
  timestamp: number
  artifact?: {
    identifier: string
    title: string
    type:
      | 'application/vnd.ant.code'
      | 'text/markdown'
      | 'text/html'
      | 'image/svg+xml'
      | 'application/vnd.ant.mermaid'
      | 'application/vnd.ant.react'
    language?: string
  }
  mcp_ui_resource?: {
    uri: string
    mimeType: 'text/html' | 'text/uri-list' | 'application/vnd.mcp-ui.remote-dom'
    text?: string
    blob?: string
    _meta?: Record<string, unknown>
  }
  tool_call?: {
    id?: string
    name?: string
    params?: string
    response?: string
    server_name?: string
    server_icons?: string
    server_description?: string
  }
  action_type?:
    | 'tool_call_permission'
    | 'maximum_tool_calls_reached'
    | 'rate_limit'
    | 'question_request'
  image_data?: {
    data: string
    mimeType: string
  }
  reasoning_time?:
    | number
    | {
        start: number
        end: number
      }
}

type DisplayMessageBase = {
  id: string
  role: 'user' | 'assistant'
  timestamp: number
  avatar: string
  name: string
  model_name: string
  model_id: string
  model_provider: string
  status: 'sent' | 'pending' | 'error'
  error: string
  usage: DisplayMessageUsage
  parentId?: string
  conversationId: string
  is_variant: number
  variants?: DisplayMessage[]
  orderSeq: number
  messageType?: 'normal' | 'compaction'
  compactionStatus?: 'compacting' | 'compacted'
  summaryUpdatedAt?: number | null
}

export type DisplayUserMessage = DisplayMessageBase & {
  role: 'user'
  content: DisplayUserMessageContent
}

export type DisplayAssistantMessage = DisplayMessageBase & {
  role: 'assistant'
  content: DisplayAssistantMessageBlock[]
}

export type DisplayMessage = DisplayUserMessage | DisplayAssistantMessage

export type MessageListItem = DisplayMessage

export function isCompactionMessageItem(item: MessageListItem): boolean {
  return item.messageType === 'compaction'
}
