export type ChatMessageRole = 'system' | 'user' | 'assistant' | 'tool'

export type ChatMessageProviderOptions = Record<string, Record<string, unknown>>

export type ChatMessageToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
  provider_options?: ChatMessageProviderOptions
}

export type ChatMessageContent =
  | { type: 'text'; text: string; provider_options?: ChatMessageProviderOptions }
  | {
      type: 'image_url'
      image_url: { url: string; detail?: 'auto' | 'low' | 'high' }
      provider_options?: ChatMessageProviderOptions
    }

export type ChatMessage = {
  role: ChatMessageRole
  content?: string | ChatMessageContent[]
  tool_calls?: ChatMessageToolCall[]
  tool_call_id?: string
  reasoning_content?: string
  reasoning_provider_options?: ChatMessageProviderOptions
  provider_options?: ChatMessageProviderOptions
}
