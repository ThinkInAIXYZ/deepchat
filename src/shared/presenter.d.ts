// Compatibility stub: keep '@shared/presenter' import path stable during refactor

// Re-declared based on usage in threadPresenter and chat.ts to add the new property
export interface CONVERSATION_SETTINGS {
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
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  verbosity?: 'low' | 'medium' | 'high'
  selectedVariantsMap?: Record<string, string> // New property for variant selection
}

export * from './types/index'
