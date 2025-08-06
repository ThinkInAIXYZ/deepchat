import { FileMetaData } from './presenter'

export type Message = {
  id: string

  content: UserMessageContent | AssistantMessageBlock[]
  role: MESSAGE_ROLE
  timestamp: number
  avatar: string
  name: string
  model_name: string
  model_id: string
  model_provider: string
  status: 'sent' | 'pending' | 'error'
  error: string
  // user只有prompt_tokens，其他数值可以留为0
  usage: {
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
  parentId?: string
  conversationId: string
  is_variant: number
  variants?: Message[]
}

export type UserMessage = Message & {
  role: 'user'
  content: UserMessageContent
}

export type AssistantMessage = Message & {
  role: 'assistant'
  content: AssistantMessageBlock[]
}

export type UserMessageTextBlock = {
  type: 'text'
  content: string
}

export type UserMessageCodeBlock = {
  type: 'code'
  content: string
  language: string
}

export type UserMessageMentionBlock = {
  type: 'mention'
  content: string
  id: string
  category: string
}

export type UserMessageContent = {
  continue?: boolean
  files: MessageFile[]
  resources?: ResourceListEntryWithClient[]
  prompts?: PromptWithClient[]
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
  metadata: FileMetaData
  token: number
  path: string
  thumbnail?: string
}

export type AssistantMessageBlock = {
  type:
    | 'content'
    | 'search'
    | 'reasoning_content'
    | 'error'
    | 'tool_call'
    | 'action'
    | 'tool_call_permission' // NEW: Dedicated permission request block type
    | 'image'
    | 'artifact-thinking'
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
  image_data?: {
    data: string
    mimeType: string
  }
  reasoning_time?: {
    start: number
    end: number
  }
}
// 搜索相关的消息块类型
export type SearchBlock = {
  type: 'search'
  status: 'loading' | 'success' | 'error'
  timestamp: number
  extra: {
    total?: number
    pages?: Array<{
      title: string
      url: string
      content?: string
    }>
  }
}

export interface SearchEngineTemplate {
  id: string
  name: string
  selector: string
  searchUrl: string
  extractorScript: string
  isCustom?: boolean
}
