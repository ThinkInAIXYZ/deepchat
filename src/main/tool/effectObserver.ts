import type { ToolExecutionContract } from '@shared/types/mcp'
import type { ToolSource } from './toolMapper'

export interface ToolEffectObservation {
  conversationId: string
  toolCallId: string
  toolName: string
  source: ToolSource
  reviewedExecution: ToolExecutionContract | null
}

export interface ToolEffectObserver {
  beforeToolExecution(observation: ToolEffectObservation): Promise<void> | void
}
