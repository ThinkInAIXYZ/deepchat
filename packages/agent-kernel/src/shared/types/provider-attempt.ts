export interface DeepChatProviderAttemptIdentity {
  readonly logicalRound: number
  readonly requestSeq: number
  readonly physicalAttempt: number
}

export type DeepChatProviderRequestOrigin = 'chat' | 'resume' | 'tool_loop' | 'context_recovery'

export type DeepChatProviderAttemptOrigin = 'initial' | 'transient_retry'

export type DeepChatProviderFailureClassification =
  | 'aborted'
  | 'context_overflow'
  | 'permanent'
  | 'transient'
  | 'unknown'

export type DeepChatProviderRetryDecision =
  | 'none'
  | 'retry_scheduled'
  | 'context_recovery_scheduled'
  | 'context_recovery_exhausted'
  | 'not_retryable'
  | 'retry_budget_exhausted'
  | 'output_committed'
  | 'retry_after_exceeds_limit'

export type DeepChatProviderContextPressureKind =
  | 'successful_prompt_overflow'
  | 'zero_output_length_at_limit'

export interface DeepChatProviderContextPressureObservation {
  readonly kind: DeepChatProviderContextPressureKind
  readonly contextWindowTokens: number
  readonly thresholdTokens: number
}
