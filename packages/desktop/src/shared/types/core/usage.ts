// Shared usage and rate limit types

export interface UsageStats {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  context_length?: number
}

export interface RateLimitInfo {
  providerId: string
  qpsLimit: number
  currentQps: number
  queueLength: number
  estimatedWaitTime?: number
}
