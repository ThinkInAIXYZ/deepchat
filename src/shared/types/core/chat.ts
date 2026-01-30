// Core chat types (strong-typed UI blocks)

export type Message = {
  id: string
  content: UserMessageContent | AssistantMessageBlock[]
  role: MESSAGE_ROLE
  timestamp: number
  avatar: string
  name: string
}

export type MESSAGE_ROLE = 'user' | 'assistant' | 'system' | 'agent'

export type UserMessageTextBlock = { type: 'text'; content: string }
export type UserMessageCodeBlock = { type: 'code'; content: string; language: string }
export type UserMessageMentionBlock = {
  type: 'mention'
  content: string
  id: string
  category: string
}

export type UserMessageContent = {
  continue?: boolean
  files: MessageFile[]
  resources?: Array<{ uri: string; name?: string; client: { name: string; icon: string } }>
  prompts?: Array<{
    name: string
    description?: string
    arguments?: { name: string; description?: string; required: boolean }[]
  }>
  links: string[]
  think: boolean
  search: boolean
  text: string
  content?: (UserMessageTextBlock | UserMessageMentionBlock | UserMessageCodeBlock)[]
}

export type MessageFile = {
  name: string
  content: string
  mimeType: string
  token?: number
  path?: string
  thumbnail?: string
}

export type AssistantMessageBlock = {
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
  content?: string
  extra?: Record<string, string | number | object[] | boolean>
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
  action_type?: 'tool_call_permission' | 'maximum_tool_calls_reached' | 'rate_limit'
  image_data?: { data: string; mimeType: string }
  reasoning_time?: { start: number; end: number }
}

export type {
  ChatMessage,
  ChatMessageContent,
  ChatMessageRole,
  ChatMessageToolCall
} from './chat-message'
