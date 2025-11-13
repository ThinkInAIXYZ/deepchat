import { BaseLLMProvider } from './baseProvider'

export interface RateLimitConfig {
  qpsLimit: number
  enabled: boolean
}

export interface QueueItem {
  id: string
  timestamp: number
  resolve: () => void
  reject: (error: Error) => void
}

export interface ProviderRateLimitState {
  config: RateLimitConfig
  queue: QueueItem[]
  lastRequestTime: number
  isProcessing: boolean
}

export interface StreamState {
  isGenerating: boolean
  providerId: string
  modelId: string
  abortController: AbortController
  provider: BaseLLMProvider
}

export interface ProviderConfig {
  maxConcurrentStreams: number
}
