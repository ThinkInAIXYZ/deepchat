import type {
  AttachmentPreparationSummary,
  ChatMessageRecord,
  PendingSessionInputRecord,
  PendingSessionInputState,
  SendMessageInput,
  UserMessageContent
} from '@shared/types/agent-interface'
import { SessionPendingInputStore } from './pendingInputStore'
import type { SessionTranscript } from './transcript'

const MAX_ACTIVE_PENDING_INPUTS = 5

function toUserMessageContent(input: SendMessageInput): UserMessageContent {
  return {
    text: input.text,
    files: input.files ?? [],
    links: [],
    search: input.search === true,
    think: false,
    ...(input.activeSkills?.length ? { activeSkills: input.activeSkills } : {}),
    ...(input.inlineItems?.length ? { inlineItems: input.inlineItems } : {})
  }
}

export class SessionPendingInputs {
  constructor(
    private readonly store: SessionPendingInputStore,
    private readonly transcript: SessionTranscript,
    private readonly events: {
      publishPendingInputsChanged(sessionId: string): void
      publishMessagesChanged(sessionId: string, messages: ChatMessageRecord[]): void
    }
  ) {}

  listPendingInputs(sessionId: string): PendingSessionInputRecord[] {
    return this.store.listPendingInputs(sessionId)
  }

  getInput(sessionId: string, itemId: string): PendingSessionInputRecord | null {
    const record = this.store.getInput(itemId)
    if (!record) {
      return null
    }
    if (record.sessionId !== sessionId) {
      throw new Error(`Pending input ${itemId} does not belong to session ${sessionId}`)
    }
    return record
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
  } {
    const accepted = this.store.runInTransaction(() => {
      if (options?.mergeItemId) {
        const mergeTarget = this.store.getInput(options.mergeItemId)
        if (
          !mergeTarget ||
          mergeTarget.sessionId !== sessionId ||
          mergeTarget.mode !== 'steer' ||
          mergeTarget.state !== 'pending'
        ) {
          throw new Error(`Pending steer item ${options.mergeItemId} is not open.`)
        }
      }

      const sourceMessage = Object.prototype.hasOwnProperty.call(
        options ?? {},
        'preStreamAnchorMessageId'
      )
        ? this.materializePreStreamSource(sessionId, options?.preStreamAnchorMessageId ?? null)
        : undefined
      const messageId = this.transcript.createUserMessage(
        sessionId,
        this.transcript.getNextOrderSeq(sessionId),
        toUserMessageContent(input),
        {
          status: 'pending',
          metadata: {
            inputReceipt: {
              mode: 'steer',
              readAt: null
            }
          }
        }
      )
      const pendingInput = options?.mergeItemId
        ? this.store.appendSteerInput(options.mergeItemId, input, messageId)
        : this.store.createSteerInput(sessionId, input, messageId)
      const message = this.requireMessage(messageId)
      return { pendingInput, message, sourceMessage }
    })

    this.emitUpdated(sessionId)
    this.events.publishMessagesChanged(
      sessionId,
      accepted.sourceMessage ? [accepted.sourceMessage, accepted.message] : [accepted.message]
    )
    return accepted
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
  } {
    const accepted = this.store.runInTransaction(() => {
      const queued = this.store.getInput(itemId)
      if (
        !queued ||
        queued.sessionId !== sessionId ||
        queued.mode !== 'queue' ||
        queued.state !== 'pending'
      ) {
        throw new Error(`Pending queue item ${itemId} is not steerable.`)
      }
      const sourceMessage = Object.prototype.hasOwnProperty.call(
        options ?? {},
        'preStreamAnchorMessageId'
      )
        ? this.materializePreStreamSource(sessionId, options?.preStreamAnchorMessageId ?? null)
        : undefined
      const messageId = this.transcript.createUserMessage(
        sessionId,
        this.transcript.getNextOrderSeq(sessionId),
        toUserMessageContent(queued.payload),
        {
          status: 'pending',
          metadata: {
            inputReceipt: {
              mode: 'steer',
              readAt: null
            }
          }
        }
      )
      this.store.convertQueueInputToSteer(itemId)
      const pendingInput = this.store.linkSteerMessage(itemId, messageId)
      return {
        pendingInput,
        message: this.requireMessage(messageId),
        sourceMessage
      }
    })

    this.emitUpdated(sessionId)
    this.events.publishMessagesChanged(
      sessionId,
      accepted.sourceMessage ? [accepted.sourceMessage, accepted.message] : [accepted.message]
    )
    return accepted
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
    let changedMessages: ChatMessageRecord[] = []
    const record = this.store.runInTransaction(() => {
      const pendingInput = this.store.getInput(itemId)
      if (!pendingInput || pendingInput.messageIds.length === 0) {
        throw new Error(`Pending steer item ${itemId} has no linked messages.`)
      }
      if (pendingInput.assistantMessageId) {
        throw new Error(`Pending steer item ${itemId} already has an assistant message.`)
      }

      const readAt = Date.now()
      const assistantMessageId = this.transcript.createAssistantMessage(
        sessionId,
        this.transcript.getNextOrderSeq(sessionId)
      )
      const claimed = this.store.claimSteerInput(itemId, {
        claimedAt: readAt,
        assistantMessageId
      })
      changedMessages = [
        ...this.transcript.markSteerMessagesRead(claimed.messageIds, readAt),
        this.requireMessage(assistantMessageId)
      ]
      return claimed
    })
    this.emitUpdated(sessionId)
    this.events.publishMessagesChanged(sessionId, changedMessages)
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
    const claimed = this.store.getInput(itemId)
    if (
      claimed?.mode === 'steer' &&
      (claimed.messageIds.length > 0 || claimed.assistantMessageId)
    ) {
      throw new Error(`Read steer input ${itemId} cannot be released.`)
    }
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
    let changedMessages: ChatMessageRecord[] = []
    this.store.runInTransaction(() => {
      const claimed = this.store.getInput(itemId)
      if (!claimed || claimed.state !== 'claimed') {
        throw new Error(`Pending steer item ${itemId} is not claimed.`)
      }
      changedMessages = this.transcript.settleSteerMessages(claimed.messageIds)
      this.store.consumeSteerInput(itemId)
    })
    this.emitUpdated(sessionId)
    this.events.publishMessagesChanged(sessionId, changedMessages)
  }

  recoverClaimedInputsAfterRestart(): number {
    const sessionIds = new Set<string>()
    this.store.runInTransaction(() => {
      for (const input of this.store.listActiveInputs()) {
        if (input.mode === 'queue') {
          if (input.state === 'claimed') {
            if (input.messageIds.length > 0) {
              this.store.consumeQueueInput(input.id)
            } else {
              this.store.releaseClaimedQueueInput(input.id)
            }
            sessionIds.add(input.sessionId)
          }
          continue
        }

        if (input.state === 'blocked') {
          this.store.convertSteerInputToQueue(input.id)
          sessionIds.add(input.sessionId)
          continue
        }

        if (input.state === 'claimed' && input.messageIds.length > 0) {
          this.transcript.settleSteerMessages(input.messageIds)
          this.store.consumeSteerInput(input.id)
          sessionIds.add(input.sessionId)
          continue
        }

        if (input.state === 'claimed') {
          this.store.releaseClaimedInput(input.id)
        }
        if (input.messageIds.length > 0) {
          continue
        }
        const messageId = this.transcript.createUserMessage(
          input.sessionId,
          this.transcript.getNextOrderSeq(input.sessionId),
          toUserMessageContent(input.payload),
          {
            status: 'pending',
            metadata: {
              inputReceipt: {
                mode: 'steer',
                readAt: null
              }
            }
          }
        )
        this.store.linkSteerMessage(input.id, messageId)
        sessionIds.add(input.sessionId)
      }
    })
    for (const sessionId of sessionIds) {
      this.emitUpdated(sessionId)
    }
    return sessionIds.size
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

  private materializePreStreamSource(
    sessionId: string,
    anchorMessageId: string | null
  ): ChatMessageRecord | undefined {
    const anchor = anchorMessageId ? this.requireMessage(anchorMessageId) : undefined
    if (anchor && anchor.sessionId !== sessionId) {
      throw new Error(`Pre-stream message ${anchor.id} does not belong to session ${sessionId}.`)
    }

    const claimedInput = this.store.getClaimedInput(sessionId)
    if (claimedInput?.mode === 'queue') {
      const linkedMessageId = claimedInput.messageIds.at(-1)
      let sourceMessage = linkedMessageId ? this.requireMessage(linkedMessageId) : anchor
      if (sourceMessage && sourceMessage.role !== 'user') {
        sourceMessage = undefined
      }
      if (!sourceMessage) {
        const messageId = this.transcript.createUserMessage(
          sessionId,
          this.transcript.getNextOrderSeq(sessionId),
          toUserMessageContent(claimedInput.payload)
        )
        sourceMessage = this.requireMessage(messageId)
      }
      this.store.linkClaimedQueueMessage(claimedInput.id, sourceMessage.id)
      return sourceMessage
    }

    if (anchor) {
      return anchor.role === 'user' ? anchor : undefined
    }

    if (claimedInput?.mode === 'steer') return undefined

    throw new Error('Unable to identify the active pre-stream transcript boundary.')
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
    const record = this.store.listPendingInputs(sessionId).find((item) => item.id === itemId)
    if (!record) {
      throw new Error(`Pending input not found: ${itemId}`)
    }
    if (record.mode !== 'queue') {
      throw new Error('Steer messages are sent conversation facts and cannot be deleted.')
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
    this.events.publishPendingInputsChanged(sessionId)
  }

  private requireMessage(messageId: string): ChatMessageRecord {
    const message = this.transcript.getMessage(messageId)
    if (!message) {
      throw new Error(`Message not found: ${messageId}`)
    }
    return message
  }
}
