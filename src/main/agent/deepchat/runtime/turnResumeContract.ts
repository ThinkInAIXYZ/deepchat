import type { AssistantMessageBlock, MessageMetadata } from '@shared/types/agent-interface'

export type ResumeBudgetToolCall = {
  id: string
  name: string
  responseText?: string
  /** Guard-created file that may be deleted after its persisted reference is replaced. */
  offloadPath?: string
  /** Tool-created file that remains tool-owned and must never be deleted by the guard. */
  existingOffloadPath?: string
}

/**
 * Neutral contract between the interaction owner, which decides that a paused assistant message can
 * continue, and the turn owner, which runs the continuation. Keeping it here stops the two owners
 * from importing each other.
 */
export interface TurnResumePort {
  resume(
    sessionId: string,
    messageId: string,
    initialBlocks: AssistantMessageBlock[],
    budgetToolCall?: ResumeBudgetToolCall | null,
    initialAccounting?: MessageMetadata
  ): Promise<boolean>
}
