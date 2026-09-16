import type {
  AttachmentPreparationSummary,
  ChatMessageRecord,
  PendingSessionInputRecord,
  PendingSessionInputState,
  SendMessageInput,
  UserMessageContent
} from '../shared/types/agent-interface.js'

export interface PendingInputRestartRecovery {
  affectedSessionIds: Set<string>
  heldQueueInputIds: Set<string>
}

/**
 * Durable pending-input surface the built-in kernel needs. Declared here so kernel modules depend
 * on this structural port instead of the SQLite-backed host store; the host class implements it,
 * and each method is a complete transaction unit.
 */
export interface PendingInputStorePort {
  listPendingInputs(sessionId: string): PendingSessionInputRecord[]
  getInput(sessionId: string, itemId: string): PendingSessionInputRecord | null
  createClaimedQueueUserMessage(
    sessionId: string,
    itemId: string,
    content: UserMessageContent
  ): string
  queuePendingInput(
    sessionId: string,
    input: SendMessageInput,
    options?: {
      state?: PendingSessionInputState
    }
  ): PendingSessionInputRecord
  acceptSteerMessage(
    sessionId: string,
    input: SendMessageInput,
    options?: {
      mergeItemId?: string | null
      preStreamAnchorMessageId?: string | null
    }
  ): {
    pendingInput: PendingSessionInputRecord
    message: ChatMessageRecord
    sourceMessage?: ChatMessageRecord
  }
  promoteQueuedInputToSteerMessage(
    sessionId: string,
    itemId: string,
    options?: {
      preStreamAnchorMessageId?: string | null
    }
  ): {
    pendingInput: PendingSessionInputRecord
    message: ChatMessageRecord
    sourceMessage?: ChatMessageRecord
  }
  updateQueuedInput(
    sessionId: string,
    itemId: string,
    input: SendMessageInput
  ): PendingSessionInputRecord
  moveQueuedInput(sessionId: string, itemId: string, toIndex: number): PendingSessionInputRecord[]
  deletePendingInput(sessionId: string, itemId: string): void
  getNextQueuedInput(sessionId: string): PendingSessionInputRecord | null
  getNextSteerInput(sessionId: string): PendingSessionInputRecord | null
  hasPendingTurnInput(sessionId: string): boolean
  hasBlockingInput(sessionId: string): boolean
  hasClaimedInput(sessionId: string): boolean
  claimQueuedInput(sessionId: string, itemId: string): PendingSessionInputRecord
  claimSteerInput(sessionId: string, itemId: string): PendingSessionInputRecord
  releaseClaimedQueueInput(sessionId: string, itemId: string): PendingSessionInputRecord
  releaseClaimedQueueInputForRetry(sessionId: string, itemId: string): PendingSessionInputRecord
  retryReleasedQueueInput(sessionId: string, itemId: string): PendingSessionInputRecord
  releaseClaimedInput(sessionId: string, itemId: string): PendingSessionInputRecord
  blockClaimedInput(
    sessionId: string,
    itemId: string,
    blocking: AttachmentPreparationSummary
  ): PendingSessionInputRecord
  retryBlockedInput(sessionId: string, itemId: string): PendingSessionInputRecord
  degradeBlockedInput(sessionId: string, itemId: string): PendingSessionInputRecord
  consumeQueuedInput(sessionId: string, itemId: string): void
  consumeSteerInput(sessionId: string, itemId: string): void
  recoverInputsAfterRestart(): PendingInputRestartRecovery
  hasActiveInputs(sessionId: string): boolean
  isAtCapacity(sessionId: string): boolean
  deleteBySession(sessionId: string): void
}
