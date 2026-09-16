export interface DeepChatMemoryIngestionProjectionInput {
  sessionId: string
  messageId: string
  orderSeq: number
  entryId: number
  role: 'user' | 'assistant'
  content: string
  status: 'sent' | 'error'
  hadToolUse: boolean
}

export interface DeepChatMemoryIngestionProjectionRow {
  session_id: string
  message_id: string
  order_seq: number
  entry_id: number
  role: 'user' | 'assistant'
  content: string
  status: 'sent' | 'error'
  had_tool_use: number
}

export interface DeepChatMemoryIngestionProjectionMeta {
  session_id: string
  projection_version: number
  max_entry_id: number
  updated_at: number
}

export interface DeepChatMemoryIngestionCurrentRange {
  current: boolean
  maxEntryId: number
  rows: DeepChatMemoryIngestionProjectionRow[]
}
