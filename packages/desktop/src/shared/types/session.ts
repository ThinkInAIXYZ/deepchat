import type { AssistantMessageBlock } from '../chat'
import type { ReasoningEffort, Verbosity } from './model-db'
import type { SearchResult } from './core/search'

export type CONVERSATION_SETTINGS = {
  systemPrompt: string
  temperature: number
  contextLength: number
  maxTokens: number
  providerId: string
  modelId: string
  artifacts: 0 | 1
  enabledMcpTools?: string[]
  thinkingBudget?: number
  enableSearch?: boolean
  forcedSearch?: boolean
  searchStrategy?: 'turbo' | 'max'
  reasoningEffort?: ReasoningEffort
  verbosity?: Verbosity
  acpWorkdirMap?: Record<string, string | null>
  chatMode?: 'agent' | 'acp agent'
  agentWorkspacePath?: string | null
  selectedVariantsMap?: Record<string, string>
  activeSkills?: string[]
}

export type ParentSelection = {
  selectedText: string
  startOffset: number
  endOffset: number
  contextBefore: string
  contextAfter: string
  contentHash: string
  version?: number
}

export type CONVERSATION = {
  id: string
  title: string
  settings: CONVERSATION_SETTINGS
  createdAt: number
  updatedAt: number
  is_new?: number
  artifacts?: number
  is_pinned?: number
  parentConversationId?: string | null
  parentMessageId?: string | null
  parentSelection?: ParentSelection | null
}

export type MESSAGE_STATUS = 'sent' | 'pending' | 'error'
export type MESSAGE_ROLE = 'user' | 'assistant' | 'system' | 'function' | 'agent'

export type MESSAGE_METADATA = {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  generationTime: number
  firstTokenTime: number
  tokensPerSecond: number
  contextUsage: number
  model?: string
  provider?: string
  reasoningStartTime?: number
  reasoningEndTime?: number
}

export interface MESSAGE {
  id: string
  conversation_id: string
  content: string | AssistantMessageBlock[]
  role: MESSAGE_ROLE
  parent_id?: string
  status: MESSAGE_STATUS
  created_at: number
  updated_at: number
  metadata?: MESSAGE_METADATA
  is_variant?: boolean
  is_context_edge?: boolean
}

export type SQLITE_MESSAGE = {
  id: string
  conversation_id: string
  parent_id?: string
  role: MESSAGE_ROLE
  content: string
  created_at: number
  order_seq: number
  token_count: number
  status: MESSAGE_STATUS
  metadata: string
  is_context_edge: number
  is_variant: number
  variants?: SQLITE_MESSAGE[]
}

export type { SearchResult }
