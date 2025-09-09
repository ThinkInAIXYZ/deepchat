// Common types for UI Kit components

export interface BaseComponentProps {
  class?: string
}

export interface ChatComponentProps extends BaseComponentProps {
  loading?: boolean
  disabled?: boolean
}

export interface MessageComponentProps extends BaseComponentProps {
  variant?: 'user' | 'assistant' | 'system' | 'error'
}

export interface BlockComponentProps extends BaseComponentProps {
  collapsible?: boolean
  defaultCollapsed?: boolean
}

// Message content types
export interface MessageContent {
  id: string
  type: 'text' | 'code' | 'image' | 'file' | 'tool_call' | 'search' | 'thinking'
  content: any
  metadata?: Record<string, any>
}

// Tool execution types
export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, any>
  status: 'pending' | 'running' | 'completed' | 'error'
  result?: any
  error?: string
}

// Search result types
export interface SearchResult {
  id: string
  title: string
  url: string
  snippet: string
  source: string
}

// Task types
export interface TaskItem {
  id: string
  title: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  progress?: number
  assignee?: string
  dueDate?: Date
}
