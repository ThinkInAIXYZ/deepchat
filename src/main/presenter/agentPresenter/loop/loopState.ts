import type { BaseLLMProvider } from '@/presenter/llmProviderPresenter/baseProvider'

export interface StreamState {
  isGenerating: boolean
  providerId: string
  modelId: string
  abortController: AbortController
  provider: BaseLLMProvider
}

export type LoopState = {
  loopId: string
  conversationMessages: any[]
  toolCallCount: number
  needContinueConversation: boolean
  currentContent: string
  currentReasoning?: string
  currentToolCalls: Array<{ id: string; name: string; arguments: string }>
  totalUsage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    context_length: number
  }
}
