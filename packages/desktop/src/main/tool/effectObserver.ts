import type { ToolExecutionContract } from '@shared/types/mcp'
import type { PermissionMode } from '@shared/types/agent-interface'
import type { ToolSource } from './toolMapper'

export interface ToolEffectObservation {
  conversationId: string
  toolCallId: string
  toolName: string
  source: ToolSource
  reviewedExecution: ToolExecutionContract | null
  authorizedPermissionMode?: PermissionMode
}

export interface ToolEffectObserver {
  beforeToolAuthorization?(
    observation: ToolEffectObservation,
    signal?: AbortSignal
  ): Promise<{ permissionMode: PermissionMode } | null> | { permissionMode: PermissionMode } | null
  beforeToolExecution(
    observation: ToolEffectObservation,
    signal?: AbortSignal
  ): Promise<void> | void
}
