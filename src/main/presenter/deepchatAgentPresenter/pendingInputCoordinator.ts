import { eventBus, SendTarget } from '@/eventbus'
import { SESSION_EVENTS } from '@/events'
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

  return {
    text: typeof input?.text === 'string' ? input.text : '',
    files: Array.isArray(input?.files) ? input.files.filter(Boolean) : []
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

  deletePendingInput(sessionId: string, itemId: string): void {
    this.assertQueueInput(sessionId, itemId)
    this.store.deleteInput(itemId)
    this.emitUpdated(sessionId)
  }

  getNextQueuedInput(sessionId: string): PendingSessionInputRecord | null {
    return this.store.getNextPendingQueueInput(sessionId)
  }

  claimQueuedInput(sessionId: string, itemId: string): PendingSessionInputRecord {
    this.assertQueueInput(sessionId, itemId)
    const record = this.store.claimQueueInput(itemId)
    this.emitUpdated(sessionId)
    return record
  }

  releaseClaimedQueueInput(sessionId: string, itemId: string): PendingSessionInputRecord {
    const record = this.store.releaseClaimedQueueInput(itemId)
    this.emitUpdated(sessionId)
    return record
  }

  consumeQueuedInput(sessionId: string, itemId: string): void {
    this.store.consumeQueueInput(itemId)
    this.emitUpdated(sessionId)
  }

  claimSteerBatchForNextLoop(sessionId: string): PendingSessionInputRecord[] {
    const claimed = this.store.claimSteerBatch(sessionId)
    if (claimed.length > 0) {
      this.emitUpdated(sessionId)
    }
    return claimed
  }

  releaseClaimedInputs(sessionId: string): number {
    const released = this.store.releaseClaimedInputs(sessionId)
    if (released > 0) {
      this.emitUpdated(sessionId)
    }
    return released
  }

  consumeClaimedSteerBatch(sessionId: string): number {
    const consumed = this.store.consumeClaimedSteerBatch(sessionId)
    if (consumed > 0) {
      this.emitUpdated(sessionId)
    }
    return consumed
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
    return this.store.countActive(sessionId) >= MAX_ACTIVE_PENDING_INPUTS
  }

  deleteBySession(sessionId: string): void {
    this.store.deleteBySession(sessionId)
    this.emitUpdated(sessionId)
  }

  private ensureWithinLimit(sessionId: string): void {
    if (this.store.countActive(sessionId) >= MAX_ACTIVE_PENDING_INPUTS) {
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

  private emitUpdated(sessionId: string): void {
    eventBus.sendToRenderer(SESSION_EVENTS.PENDING_INPUTS_UPDATED, SendTarget.ALL_WINDOWS, {
      sessionId
    })
  }
}
