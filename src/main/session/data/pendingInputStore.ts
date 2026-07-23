import { nanoid } from 'nanoid'
import type {
  AttachmentPreparationSummary,
  PendingSessionInputRecord,
  PendingSessionInputState,
  SendMessageInput
} from '@shared/types/agent-interface'
import type { SessionDatabase } from './database'
import type { DeepChatPendingInputRow } from '@/session/data/tables/deepchatPendingInputs'
import {
  AttachmentPreparationSummarySchema,
  SendMessageInputSchema
} from '@shared/contracts/common'
import { normalizeAttachmentResolvedRepresentation } from '@shared/utils/attachmentRepresentation'

type InlineItem = NonNullable<SendMessageInput['inlineItems']>[number]

function shiftInlineItems(
  inlineItems: SendMessageInput['inlineItems'],
  offset: number
): InlineItem[] {
  if (!Array.isArray(inlineItems) || inlineItems.length === 0) {
    return []
  }

  return inlineItems.map((item) => ({
    ...item,
    offset: Math.max(0, item.offset + offset)
  }))
}

export class SessionPendingInputStore {
  private readonly database: SessionDatabase

  constructor(database: SessionDatabase) {
    this.database = database
  }

  listPendingInputs(sessionId: string): PendingSessionInputRecord[] {
    return this.database.deepchatPendingInputsTable
      .listActiveBySession(sessionId)
      .filter((row) => row.state !== 'claimed')
      .map((row) => this.toRecord(row))
  }

  countActive(sessionId: string): number {
    return this.database.deepchatPendingInputsTable.countActiveBySession(sessionId)
  }

  countActiveQueue(sessionId: string): number {
    return this.database.deepchatPendingInputsTable
      .listActiveBySession(sessionId)
      .filter((row) => row.mode === 'queue').length
  }

  getInput(itemId: string): PendingSessionInputRecord | null {
    const row = this.database.deepchatPendingInputsTable.get(itemId)
    return row ? this.toRecord(row) : null
  }

  createQueueInput(sessionId: string, input: SendMessageInput): PendingSessionInputRecord {
    return this.createQueueInputWithState(sessionId, input, 'pending')
  }

  createQueueInputWithState(
    sessionId: string,
    input: SendMessageInput,
    state: PendingSessionInputState
  ): PendingSessionInputRecord {
    const id = nanoid()
    const nextQueueOrder = this.getNextQueueOrder(sessionId)
    const claimedAt = state === 'claimed' ? Date.now() : null
    this.database.deepchatPendingInputsTable.insert({
      id,
      sessionId,
      mode: 'queue',
      state,
      payloadJson: JSON.stringify(input),
      queueOrder: nextQueueOrder,
      claimedAt
    })
    const row = this.database.deepchatPendingInputsTable.get(id)
    if (!row) {
      throw new Error(`Failed to create pending input ${id}`)
    }
    return this.toRecord(row)
  }

  createSteerInput(sessionId: string, input: SendMessageInput): PendingSessionInputRecord {
    const id = nanoid()
    this.database.deepchatPendingInputsTable.insert({
      id,
      sessionId,
      mode: 'steer',
      state: 'pending',
      payloadJson: JSON.stringify(input),
      queueOrder: null,
      claimedAt: null
    })
    const row = this.database.deepchatPendingInputsTable.get(id)
    if (!row) {
      throw new Error(`Failed to create steer input ${id}`)
    }
    return this.toRecord(row)
  }

  appendSteerInput(itemId: string, input: SendMessageInput): PendingSessionInputRecord {
    const row = this.requireRow(itemId)
    if (row.mode !== 'steer') {
      throw new Error(`Pending input ${itemId} is not a steer item.`)
    }
    if (row.state !== 'pending') {
      throw new Error(`Pending steer item ${itemId} is not editable.`)
    }

    const existing = this.decodePayload(row)
    const next = input
    const existingText = existing.text.trim()
    const nextText = next.text.trim()
    const separator = existingText && nextText ? '\n\n' : ''
    const text = [existingText, nextText].filter(Boolean).join(separator)
    const nextOffset = existingText.length + separator.length
    const files = [...(existing.files ?? []), ...(next.files ?? [])].filter(Boolean)
    const activeSkills = Array.from(
      new Set([...(existing.activeSkills ?? []), ...(next.activeSkills ?? [])])
    )
    const inlineItems = [
      ...(existing.inlineItems ?? []),
      ...shiftInlineItems(next.inlineItems, nextOffset)
    ]
    const attachmentFallbackPolicy =
      next.attachmentFallbackPolicy ?? existing.attachmentFallbackPolicy
    this.database.deepchatPendingInputsTable.update(itemId, {
      payload_json: JSON.stringify({
        text,
        files,
        ...(activeSkills.length > 0 ? { activeSkills } : {}),
        ...(inlineItems.length > 0 ? { inlineItems } : {}),
        ...(attachmentFallbackPolicy ? { attachmentFallbackPolicy } : {})
      })
    })
    return this.toRecord(this.requireRow(itemId, row.session_id))
  }

  updateQueueInput(itemId: string, input: SendMessageInput): PendingSessionInputRecord {
    const row = this.requireRow(itemId)
    if (row.mode !== 'queue') {
      throw new Error(`Pending input ${itemId} is not a queue item.`)
    }
    if (row.state !== 'pending' && row.state !== 'blocked') {
      throw new Error(`Pending queue item ${itemId} is not editable.`)
    }
    this.database.deepchatPendingInputsTable.update(itemId, {
      payload_json: JSON.stringify(input),
      ...(row.state === 'blocked'
        ? { state: 'pending' as const, blocking_json: null, claimed_at: null }
        : {})
    })
    return this.toRecord(this.requireRow(itemId, row.session_id))
  }

  moveQueueInput(sessionId: string, itemId: string, toIndex: number): PendingSessionInputRecord[] {
    const queueRows = this.getWaitingQueueRows(sessionId)
    const fromIndex = queueRows.findIndex((row) => row.id === itemId)
    if (fromIndex === -1) {
      throw new Error(`Pending queue item not found: ${itemId}`)
    }

    const clampedIndex = Math.max(0, Math.min(toIndex, queueRows.length - 1))
    if (fromIndex === clampedIndex) {
      return this.listPendingInputs(sessionId)
    }

    const [moved] = queueRows.splice(fromIndex, 1)
    queueRows.splice(clampedIndex, 0, moved)
    this.resequenceQueueRows(queueRows)

    return this.listPendingInputs(sessionId)
  }

  convertQueueInputToSteer(itemId: string): PendingSessionInputRecord {
    const row = this.requireRow(itemId)
    if (row.mode !== 'queue') {
      throw new Error(`Pending input ${itemId} is not a queue item.`)
    }
    if (row.state !== 'pending') {
      throw new Error(`Pending queue item ${itemId} is not steerable.`)
    }
    this.database.deepchatPendingInputsTable.update(itemId, {
      mode: 'steer',
      queue_order: null
    })
    this.resequenceQueue(row.session_id)
    return this.toRecord(this.requireRow(itemId, row.session_id))
  }

  convertSteerInputToQueue(itemId: string): PendingSessionInputRecord {
    const row = this.requireRow(itemId)
    if (row.mode !== 'steer') {
      throw new Error(`Pending input ${itemId} is not a steer item.`)
    }
    this.database.deepchatPendingInputsTable.update(itemId, {
      mode: 'queue',
      queue_order: this.getNextQueueOrder(row.session_id)
    })
    this.resequenceQueue(row.session_id)
    return this.toRecord(this.requireRow(itemId, row.session_id))
  }

  deleteInput(itemId: string): void {
    const row = this.requireRow(itemId)
    this.database.deepchatPendingInputsTable.delete(itemId)
    if (row.mode === 'queue') {
      this.resequenceQueue(row.session_id)
    }
  }

  getNextPendingQueueInput(sessionId: string): PendingSessionInputRecord | null {
    const row = this.getWaitingQueueRows(sessionId)[0]
    return row?.state === 'pending' ? this.toRecord(row) : null
  }

  getNextPendingSteerInput(sessionId: string): PendingSessionInputRecord | null {
    const row = this.getWaitingSteerRows(sessionId)[0]
    return row?.state === 'pending' ? this.toRecord(row) : null
  }

  hasBlockingInput(sessionId: string): boolean {
    return this.database.deepchatPendingInputsTable
      .listActiveBySession(sessionId)
      .some((row) => row.state === 'blocked')
  }

  hasClaimedInput(sessionId: string): boolean {
    return this.database.deepchatPendingInputsTable
      .listActiveBySession(sessionId)
      .some((row) => row.state === 'claimed')
  }

  claimQueueInput(itemId: string): PendingSessionInputRecord {
    const row = this.requireRow(itemId)
    if (row.mode !== 'queue') {
      throw new Error(`Pending input ${itemId} is not a queue item.`)
    }
    if (row.state !== 'pending') {
      throw new Error(`Pending queue item ${itemId} is not claimable.`)
    }

    this.database.deepchatPendingInputsTable.update(itemId, {
      state: 'claimed',
      claimed_at: Date.now()
    })
    return this.toRecord(this.requireRow(itemId, row.session_id))
  }

  claimSteerInput(itemId: string): PendingSessionInputRecord {
    const row = this.requireRow(itemId)
    if (row.mode !== 'steer') {
      throw new Error(`Pending input ${itemId} is not a steer item.`)
    }
    if (row.state !== 'pending') {
      throw new Error(`Pending steer item ${itemId} is not claimable.`)
    }

    this.database.deepchatPendingInputsTable.update(itemId, {
      state: 'claimed',
      claimed_at: Date.now()
    })
    return this.toRecord(this.requireRow(itemId, row.session_id))
  }

  releaseClaimedQueueInput(itemId: string): PendingSessionInputRecord {
    const row = this.requireRow(itemId)
    if (row.mode !== 'queue') {
      throw new Error(`Pending input ${itemId} is not a queue item.`)
    }
    return this.releaseClaimedInput(itemId, row)
  }

  releaseClaimedInput(
    itemId: string,
    existingRow?: DeepChatPendingInputRow
  ): PendingSessionInputRecord {
    const row = existingRow ?? this.requireRow(itemId)
    if (row.state !== 'claimed') {
      return this.toRecord(row)
    }

    this.database.deepchatPendingInputsTable.update(itemId, {
      state: 'pending',
      claimed_at: null,
      blocking_json: null
    })
    return this.toRecord(this.requireRow(itemId, row.session_id))
  }

  consumeQueueInput(itemId: string): void {
    this.deleteInput(itemId)
  }

  consumeSteerInput(itemId: string): void {
    const row = this.requireRow(itemId)
    if (row.mode !== 'steer') {
      throw new Error(`Pending input ${itemId} is not a steer item.`)
    }
    this.database.deepchatPendingInputsTable.update(itemId, {
      state: 'consumed',
      consumed_at: Date.now()
    })
  }

  blockClaimedInput(
    itemId: string,
    blocking: AttachmentPreparationSummary
  ): PendingSessionInputRecord {
    const row = this.requireRow(itemId)
    if (row.state !== 'claimed') {
      throw new Error(`Pending input ${itemId} is not claimed.`)
    }
    const bodyFreeBlocking = AttachmentPreparationSummarySchema.parse(blocking)
    this.database.deepchatPendingInputsTable.update(itemId, {
      state: 'blocked',
      blocking_json: JSON.stringify(bodyFreeBlocking),
      claimed_at: null
    })
    return this.toRecord(this.requireRow(itemId, row.session_id))
  }

  retryBlockedInput(itemId: string): PendingSessionInputRecord {
    const row = this.requireRow(itemId)
    if (row.state !== 'blocked') {
      throw new Error(`Pending input ${itemId} is not blocked.`)
    }
    this.database.deepchatPendingInputsTable.update(itemId, {
      state: 'pending',
      blocking_json: null,
      claimed_at: null
    })
    return this.toRecord(this.requireRow(itemId, row.session_id))
  }

  degradeBlockedInput(itemId: string): PendingSessionInputRecord {
    const row = this.requireRow(itemId)
    if (row.state !== 'blocked') {
      throw new Error(`Pending input ${itemId} is not blocked.`)
    }
    const payload = this.decodePayload(row)
    this.database.deepchatPendingInputsTable.update(itemId, {
      state: 'pending',
      payload_json: JSON.stringify({
        ...payload,
        attachmentFallbackPolicy: 'send_without_image_content'
      }),
      blocking_json: null,
      claimed_at: null
    })
    return this.toRecord(this.requireRow(itemId, row.session_id))
  }

  recoverClaimedInputs(): string[] {
    const rows = this.listClaimedRows()
    const recoveredSessionIds = new Set<string>()

    for (const row of rows) {
      if (!this.database.deepchatSessionsTable.get(row.session_id)) {
        continue
      }

      this.database.deepchatPendingInputsTable.update(row.id, {
        state: 'pending',
        claimed_at: null,
        blocking_json: null
      })
      recoveredSessionIds.add(row.session_id)
    }

    return Array.from(recoveredSessionIds)
  }

  deleteBySession(sessionId: string): void {
    this.database.deepchatPendingInputsTable.deleteBySession(sessionId)
  }

  private getNextQueueOrder(sessionId: string): number {
    const queueRows = this.getQueueRows(sessionId)
    if (queueRows.length === 0) {
      return 1
    }
    return Math.max(...queueRows.map((row) => row.queue_order ?? 0)) + 1
  }

  private getQueueRows(sessionId: string): DeepChatPendingInputRow[] {
    return this.database.deepchatPendingInputsTable
      .listBySession(sessionId)
      .filter((row) => row.mode === 'queue')
      .sort((left, right) => {
        const leftQueueOrder = left.queue_order ?? Number.MAX_SAFE_INTEGER
        const rightQueueOrder = right.queue_order ?? Number.MAX_SAFE_INTEGER

        if (leftQueueOrder !== rightQueueOrder) {
          return leftQueueOrder - rightQueueOrder
        }

        return left.created_at - right.created_at
      })
  }

  private getWaitingQueueRows(sessionId: string): DeepChatPendingInputRow[] {
    return this.getQueueRows(sessionId).filter(
      (row) => row.state === 'pending' || row.state === 'blocked'
    )
  }

  private getSteerRows(sessionId: string): DeepChatPendingInputRow[] {
    return this.database.deepchatPendingInputsTable
      .listActiveBySession(sessionId)
      .filter((row) => row.mode === 'steer')
      .sort((left, right) => left.created_at - right.created_at)
  }

  private getWaitingSteerRows(sessionId: string): DeepChatPendingInputRow[] {
    return this.getSteerRows(sessionId).filter(
      (row) => row.state === 'pending' || row.state === 'blocked'
    )
  }

  private listClaimedRows(): DeepChatPendingInputRow[] {
    return this.database.deepchatPendingInputsTable.listClaimed()
  }

  private resequenceQueue(sessionId: string): void {
    this.resequenceQueueRows(this.getWaitingQueueRows(sessionId))
  }

  private resequenceQueueRows(rows: DeepChatPendingInputRow[]): void {
    rows.forEach((row, index) => {
      this.database.deepchatPendingInputsTable.update(row.id, {
        queue_order: index + 1
      })
    })
  }

  private requireRow(itemId: string, expectedSessionId?: string): DeepChatPendingInputRow {
    const row = this.database.deepchatPendingInputsTable.get(itemId)
    if (!row) {
      throw new Error(`Pending input not found: ${itemId}`)
    }
    if (expectedSessionId && row.session_id !== expectedSessionId) {
      throw new Error(`Pending input ${itemId} does not belong to session ${expectedSessionId}`)
    }
    return row
  }

  private toRecord(row: DeepChatPendingInputRow): PendingSessionInputRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      mode: row.mode,
      state: row.state as PendingSessionInputState,
      payload: this.decodePayload(row),
      blocking: this.decodeBlocking(row),
      queueOrder: row.queue_order,
      claimedAt: row.claimed_at,
      consumedAt: row.consumed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private decodePayload(row: DeepChatPendingInputRow): SendMessageInput {
    let parsed: unknown
    try {
      parsed = JSON.parse(row.payload_json)
    } catch (error) {
      console.error(
        `[DeepChatPendingInputStore] Invalid pending input payload JSON: ${row.id}`,
        error
      )
      return { text: row.payload_json, files: [] }
    }

    const result = SendMessageInputSchema.safeParse(parsed)
    if (!result.success) {
      console.error(
        `[DeepChatPendingInputStore] Invalid pending input payload shape: ${row.id}`,
        result.error
      )
      return { text: row.payload_json, files: [] }
    }

    const rawFiles = Array.isArray((parsed as { files?: unknown }).files)
      ? ((parsed as { files: unknown[] }).files ?? [])
      : []
    const files = result.data.files?.map((file, index) => {
      const rawFile = rawFiles[index]
      const resolved =
        rawFile && typeof rawFile === 'object' && !Array.isArray(rawFile)
          ? normalizeAttachmentResolvedRepresentation(
              (rawFile as Record<string, unknown>).resolvedRepresentation
            )
          : undefined
      return resolved ? { ...file, resolvedRepresentation: resolved } : file
    })
    return files ? { ...result.data, files } : result.data
  }

  private decodeBlocking(row: DeepChatPendingInputRow): AttachmentPreparationSummary | null {
    if (!row.blocking_json) return null
    try {
      const parsed = AttachmentPreparationSummarySchema.safeParse(JSON.parse(row.blocking_json))
      if (parsed.success) return parsed.data
    } catch {
      // Fall through to a body-free recovery result for corrupt derived queue metadata.
    }
    return {
      status: 'needs_user_action',
      issues: [],
      suggestedActions: ['retry', 'send_without_image_content']
    }
  }
}
