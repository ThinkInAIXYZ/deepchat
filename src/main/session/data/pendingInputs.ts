import type {
  AttachmentPreparationSummary,
  PendingSessionInputRecord,
  PendingSessionInputState,
  SendMessageInput
} from '@shared/types/agent-interface'
import { SessionPendingInputStore } from './pendingInputStore'

const MAX_ACTIVE_PENDING_INPUTS = 5

export class SessionPendingInputs {
  constructor(
    private readonly store: SessionPendingInputStore,
    private readonly publishPendingInputsChanged: (sessionId: string) => void
  ) {}

  listPendingInputs(sessionId: string): PendingSessionInputRecord[] {
    return this.store.listPendingInputs(sessionId)
  }

  queuePendingInput(
    sessionId: string,
    input: SendMessageInput,
    options?: {
      state?: PendingSessionInputState
    }
  ): PendingSessionInputRecord {
    this.ensureWithinLimit(sessionId)
    const record = this.store.createQueueInputWithState(
      sessionId,
      input,
      options?.state ?? 'pending'
    )
    this.emitUpdated(sessionId)
    return record
  }

  queueSteerInput(
    sessionId: string,
    input: SendMessageInput,
    options?: {
      mergeItemId?: string | null
    }
  ): PendingSessionInputRecord {
    let record: PendingSessionInputRecord
    if (options?.mergeItemId) {
      record = this.store.appendSteerInput(options.mergeItemId, input)
    } else {
      record = this.store.createSteerInput(sessionId, input)
    }
    this.emitUpdated(sessionId)
    return record
  }

  updateQueuedInput(
    sessionId: string,
    itemId: string,
    input: SendMessageInput
  ): PendingSessionInputRecord {
    this.assertQueueInput(sessionId, itemId)
    const record = this.store.updateQueueInput(itemId, input)
    this.emitUpdated(sessionId)
    return record
  }

  moveQueuedInput(sessionId: string, itemId: string, toIndex: number): PendingSessionInputRecord[] {
    this.assertQueueInput(sessionId, itemId)
    const records = this.store.moveQueueInput(sessionId, itemId, toIndex)
    this.emitUpdated(sessionId)
    return records
  }

  convertPendingInputToSteer(sessionId: string, itemId: string): PendingSessionInputRecord {
    this.assertQueueInput(sessionId, itemId)
    const record = this.store.convertQueueInputToSteer(itemId)
    this.emitUpdated(sessionId)
    return record
  }

  /**
   * Roll a still-pending steer item back to the queue. Used to recover when a steer promotion cannot
   * actually start (so the item is never stranded in the locked steer lane).
   */
  restoreSteerInputToQueue(sessionId: string, itemId: string): PendingSessionInputRecord {
    this.assertSteerInput(sessionId, itemId)
    const record = this.store.convertSteerInputToQueue(itemId)
    this.emitUpdated(sessionId)
    return record
  }

  deletePendingInput(sessionId: string, itemId: string): void {
    this.assertDeletablePendingInput(sessionId, itemId)
    this.store.deleteInput(itemId)
    this.emitUpdated(sessionId)
  }

  getNextQueuedInput(sessionId: string): PendingSessionInputRecord | null {
    return this.store.getNextPendingQueueInput(sessionId)
  }

  getNextSteerInput(sessionId: string): PendingSessionInputRecord | null {
    return this.store.getNextPendingSteerInput(sessionId)
  }

  hasPendingTurnInput(sessionId: string): boolean {
    return Boolean(this.getNextSteerInput(sessionId) ?? this.getNextQueuedInput(sessionId))
  }

  hasBlockingInput(sessionId: string): boolean {
    return this.store.hasBlockingInput(sessionId)
  }

  hasClaimedInput(sessionId: string): boolean {
    return this.store.hasClaimedInput(sessionId)
  }

  claimQueuedInput(sessionId: string, itemId: string): PendingSessionInputRecord {
    this.assertQueueInput(sessionId, itemId)
    const record = this.store.claimQueueInput(itemId)
    this.emitUpdated(sessionId)
    return record
  }

  claimSteerInput(sessionId: string, itemId: string): PendingSessionInputRecord {
    this.assertSteerInput(sessionId, itemId)
    const record = this.store.claimSteerInput(itemId)
    this.emitUpdated(sessionId)
    return record
  }

  releaseClaimedQueueInput(sessionId: string, itemId: string): PendingSessionInputRecord {
    this.assertQueueInputForSession(sessionId, itemId)
    const record = this.store.releaseClaimedQueueInput(itemId)
    this.emitUpdated(sessionId)
    return record
  }

  releaseClaimedInput(sessionId: string, itemId: string): PendingSessionInputRecord {
    this.assertInputOwnedBySession(sessionId, itemId)
    const record = this.store.releaseClaimedInput(itemId)
    this.emitUpdated(sessionId)
    return record
  }

  blockClaimedInput(
    sessionId: string,
    itemId: string,
    blocking: AttachmentPreparationSummary
  ): PendingSessionInputRecord {
    this.assertInputOwnedBySession(sessionId, itemId)
    const record = this.store.blockClaimedInput(itemId, blocking)
    this.emitUpdated(sessionId)
    return record
  }

  retryBlockedInput(sessionId: string, itemId: string): PendingSessionInputRecord {
    this.assertInputOwnedBySession(sessionId, itemId)
    const record = this.store.retryBlockedInput(itemId)
    this.emitUpdated(sessionId)
    return record
  }

  degradeBlockedInput(sessionId: string, itemId: string): PendingSessionInputRecord {
    this.assertInputOwnedBySession(sessionId, itemId)
    const record = this.store.degradeBlockedInput(itemId)
    this.emitUpdated(sessionId)
    return record
  }

  consumeQueuedInput(sessionId: string, itemId: string): void {
    this.assertQueueInputForSession(sessionId, itemId)
    this.store.consumeQueueInput(itemId)
    this.emitUpdated(sessionId)
  }

  consumeSteerInput(sessionId: string, itemId: string): void {
    this.assertSteerInputForSession(sessionId, itemId)
    this.store.consumeSteerInput(itemId)
    this.emitUpdated(sessionId)
  }

  recoverClaimedInputsAfterRestart(): number {
    const sessionIds = this.store.recoverClaimedInputs()
    for (const sessionId of sessionIds) {
      this.emitUpdated(sessionId)
    }
    return sessionIds.length
  }

  hasActiveInputs(sessionId: string): boolean {
    return this.store.countActive(sessionId) > 0
  }

  isAtCapacity(sessionId: string): boolean {
    return this.store.countActiveQueue(sessionId) >= MAX_ACTIVE_PENDING_INPUTS
  }

  deleteBySession(sessionId: string): void {
    this.store.deleteBySession(sessionId)
    this.emitUpdated(sessionId)
  }

  private ensureWithinLimit(sessionId: string): void {
    if (this.store.countActiveQueue(sessionId) >= MAX_ACTIVE_PENDING_INPUTS) {
      throw new Error('Pending input limit reached for this session.')
    }
  }

  private assertQueueInput(sessionId: string, itemId: string): void {
    const record = this.store.listPendingInputs(sessionId).find((item) => item.id === itemId)
    if (!record) {
      throw new Error(`Pending input not found: ${itemId}`)
    }
    if (record.mode !== 'queue') {
      throw new Error('Steer inputs are locked and cannot be modified.')
    }
  }

  private assertDeletablePendingInput(sessionId: string, itemId: string): void {
    // listPendingInputs returns waiting (pending or blocked), but never claimed/consumed, items. Any
    // queued or locked steer item it returns is safe to remove. Deleting is also the recovery path
    // for a steer item whose interrupt could not be started.
    const record = this.store.listPendingInputs(sessionId).find((item) => item.id === itemId)
    if (!record) {
      throw new Error(`Pending input not found: ${itemId}`)
    }
  }

  private assertSteerInput(sessionId: string, itemId: string): void {
    const record = this.store.listPendingInputs(sessionId).find((item) => item.id === itemId)
    if (!record) {
      throw new Error(`Pending input not found: ${itemId}`)
    }
    if (record.mode !== 'steer') {
      throw new Error('Pending input is not a steer item.')
    }
  }

  private assertInputOwnedBySession(sessionId: string, itemId: string): PendingSessionInputRecord {
    const record = this.store.getInput(itemId)
    if (!record) {
      throw new Error(`Pending input not found: ${itemId}`)
    }
    if (record.sessionId !== sessionId) {
      throw new Error(`Pending input ${itemId} does not belong to session ${sessionId}`)
    }
    return record
  }

  private assertQueueInputForSession(sessionId: string, itemId: string): void {
    const record = this.assertInputOwnedBySession(sessionId, itemId)
    if (record.mode !== 'queue') {
      throw new Error('Steer inputs are locked and cannot be modified.')
    }
  }

  private assertSteerInputForSession(sessionId: string, itemId: string): void {
    const record = this.assertInputOwnedBySession(sessionId, itemId)
    if (record.mode !== 'steer') {
      throw new Error('Pending input is not a steer item.')
    }
  }

  private emitUpdated(sessionId: string): void {
    this.publishPendingInputsChanged(sessionId)
  }
}
