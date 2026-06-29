import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import type {
  PendingSessionInputRecord,
  PendingSessionInputState,
  SendMessageInput
} from '@shared/types/agent-interface'
import { DeepChatPendingInputStore } from './pendingInputStore'

const MAX_ACTIVE_PENDING_INPUTS = 5

function normalizeInput(input: string | SendMessageInput): SendMessageInput {
  if (typeof input === 'string') {
    return { text: input, files: [] }
  }

  const activeSkills = Array.isArray(input?.activeSkills)
    ? Array.from(
        new Set(
          input.activeSkills
            .map((skillName) => (typeof skillName === 'string' ? skillName.trim() : ''))
            .filter((skillName) => skillName.length > 0)
        )
      )
    : []

  return {
    text: typeof input?.text === 'string' ? input.text : '',
    files: Array.isArray(input?.files) ? input.files.filter(Boolean) : [],
    ...(activeSkills.length > 0 ? { activeSkills } : {})
  }
}

export class PendingInputCoordinator {
  private readonly store: DeepChatPendingInputStore

  constructor(store: DeepChatPendingInputStore) {
    this.store = store
  }

  listPendingInputs(sessionId: string): PendingSessionInputRecord[] {
    return this.store.listPendingInputs(sessionId)
  }

  queuePendingInput(
    sessionId: string,
    input: string | SendMessageInput,
    options?: {
      state?: PendingSessionInputState
    }
  ): PendingSessionInputRecord {
    this.ensureWithinLimit(sessionId)
    const record = this.store.createQueueInputWithState(
      sessionId,
      normalizeInput(input),
      options?.state ?? 'pending'
    )
    this.emitUpdated(sessionId)
    return record
  }

  queueSteerInput(
    sessionId: string,
    input: string | SendMessageInput,
    options?: {
      mergeItemId?: string | null
    }
  ): PendingSessionInputRecord {
    let record: PendingSessionInputRecord
    if (options?.mergeItemId) {
      record = this.store.appendSteerInput(options.mergeItemId, normalizeInput(input))
    } else {
      record = this.store.createSteerInput(sessionId, normalizeInput(input))
    }
    this.emitUpdated(sessionId)
    return record
  }

  updateQueuedInput(
    sessionId: string,
    itemId: string,
    input: string | SendMessageInput
  ): PendingSessionInputRecord {
    this.assertQueueInput(sessionId, itemId)
    const record = this.store.updateQueueInput(itemId, normalizeInput(input))
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
    // listPendingInputs only returns pending (not claimed/consumed) items, so any item it returns —
    // queued or a locked steer item — is safe to remove. Deleting is the recovery path for a steer
    // item whose interrupt could not be started.
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
    publishDeepchatEvent('sessions.pendingInputs.changed', {
      sessionId,
      version: Date.now()
    })
  }
}
