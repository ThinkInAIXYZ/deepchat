export type ChatMessageRole = 'system' | 'user' | 'assistant' | 'tool'

export type ChatMessageToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ChatMessageContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }

export type ChatMessage = {
  role: ChatMessageRole
  content?: string | ChatMessageContent[]
  tool_calls?: ChatMessageToolCall[]
  tool_call_id?: string
}
