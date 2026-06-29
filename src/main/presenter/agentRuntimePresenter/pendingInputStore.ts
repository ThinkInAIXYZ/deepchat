import { nanoid } from 'nanoid'
import type {
  PendingSessionInputRecord,
  PendingSessionInputState,
  SendMessageInput
} from '@shared/types/agent-interface'
import type { SQLitePresenter } from '../sqlitePresenter'
import type { DeepChatPendingInputRow } from '../sqlitePresenter/tables/deepchatPendingInputs'

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

export class DeepChatPendingInputStore {
  private readonly sqlitePresenter: SQLitePresenter

  constructor(sqlitePresenter: SQLitePresenter) {
    this.sqlitePresenter = sqlitePresenter
  }

  listPendingInputs(sessionId: string): PendingSessionInputRecord[] {
    return this.sqlitePresenter.deepchatPendingInputsTable
      .listActiveBySession(sessionId)
      .filter((row) => row.state !== 'claimed')
      .map((row) => this.toRecord(row))
  }

  countActive(sessionId: string): number {
    return this.sqlitePresenter.deepchatPendingInputsTable.countActiveBySession(sessionId)
  }

  countActiveQueue(sessionId: string): number {
    return this.sqlitePresenter.deepchatPendingInputsTable
      .listActiveBySession(sessionId)
      .filter((row) => row.mode === 'queue').length
  }

  getInput(itemId: string): PendingSessionInputRecord | null {
    const row = this.sqlitePresenter.deepchatPendingInputsTable.get(itemId)
    return row ? this.toRecord(row) : null
  }

  createQueueInput(sessionId: string, input: string | SendMessageInput): PendingSessionInputRecord {
    return this.createQueueInputWithState(sessionId, input, 'pending')
  }

  createQueueInputWithState(
    sessionId: string,
    input: string | SendMessageInput,
    state: PendingSessionInputState
  ): PendingSessionInputRecord {
    const normalized = normalizeInput(input)
    const id = nanoid()
    const nextQueueOrder = this.getNextQueueOrder(sessionId)
    const claimedAt = state === 'claimed' ? Date.now() : null
    this.sqlitePresenter.deepchatPendingInputsTable.insert({
      id,
      sessionId,
      mode: 'queue',
      state,
      payloadJson: JSON.stringify(normalized),
      queueOrder: nextQueueOrder,
      claimedAt
    })
    const row = this.sqlitePresenter.deepchatPendingInputsTable.get(id)
    if (!row) {
      throw new Error(`Failed to create pending input ${id}`)
    }
    return this.toRecord(row)
  }

  createSteerInput(sessionId: string, input: string | SendMessageInput): PendingSessionInputRecord {
    const normalized = normalizeInput(input)
    const id = nanoid()
    this.sqlitePresenter.deepchatPendingInputsTable.insert({
      id,
      sessionId,
      mode: 'steer',
      state: 'pending',
      payloadJson: JSON.stringify(normalized),
      queueOrder: null,
      claimedAt: null
    })
    const row = this.sqlitePresenter.deepchatPendingInputsTable.get(id)
    if (!row) {
      throw new Error(`Failed to create steer input ${id}`)
    }
    return this.toRecord(row)
  }

  appendSteerInput(itemId: string, input: string | SendMessageInput): PendingSessionInputRecord {
    const row = this.requireRow(itemId)
    if (row.mode !== 'steer') {
      throw new Error(`Pending input ${itemId} is not a steer item.`)
    }
    if (row.state !== 'pending') {
      throw new Error(`Pending steer item ${itemId} is not editable.`)
    }

    const existing = this.parsePayload(row.payload_json)
    const next = normalizeInput(input)
    const text = [existing.text.trim(), next.text.trim()].filter(Boolean).join('\n\n')
    const files = [...(existing.files ?? []), ...(next.files ?? [])].filter(Boolean)
    const activeSkills = Array.from(
      new Set([...(existing.activeSkills ?? []), ...(next.activeSkills ?? [])])
    )
    this.sqlitePresenter.deepchatPendingInputsTable.update(itemId, {
      payload_json: JSON.stringify({
        text,
        files,
        ...(activeSkills.length > 0 ? { activeSkills } : {})
      })
    })
    return this.toRecord(this.requireRow(itemId, row.session_id))
  }

  updateQueueInput(itemId: string, input: string | SendMessageInput): PendingSessionInputRecord {
    const row = this.requireRow(itemId)
    this.sqlitePresenter.deepchatPendingInputsTable.update(itemId, {
      payload_json: JSON.stringify(normalizeInput(input))
    })
    return this.toRecord(this.requireRow(itemId, row.session_id))
  }

  moveQueueInput(sessionId: string, itemId: string, toIndex: number): PendingSessionInputRecord[] {
    const queueRows = this.getPendingQueueRows(sessionId)
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
    this.sqlitePresenter.deepchatPendingInputsTable.update(itemId, {
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
    this.sqlitePresenter.deepchatPendingInputsTable.update(itemId, {
      mode: 'queue',
      queue_order: this.getNextQueueOrder(row.session_id)
    })
    this.resequenceQueue(row.session_id)
    return this.toRecord(this.requireRow(itemId, row.session_id))
  }

  deleteInput(itemId: string): void {
    const row = this.requireRow(itemId)
    this.sqlitePresenter.deepchatPendingInputsTable.delete(itemId)
    if (row.mode === 'queue') {
      this.resequenceQueue(row.session_id)
    }
  }

  getNextPendingQueueInput(sessionId: string): PendingSessionInputRecord | null {
    const row = this.getPendingQueueRows(sessionId)[0]
    return row ? this.toRecord(row) : null
  }

  getNextPendingSteerInput(sessionId: string): PendingSessionInputRecord | null {
    const row = this.getPendingSteerRows(sessionId)[0]
    return row ? this.toRecord(row) : null
  }

  claimQueueInput(itemId: string): PendingSessionInputRecord {
    const row = this.requireRow(itemId)
    if (row.mode !== 'queue') {
      throw new Error(`Pending input ${itemId} is not a queue item.`)
    }
    if (row.state !== 'pending') {
      throw new Error(`Pending queue item ${itemId} is not claimable.`)
    }

    this.sqlitePresenter.deepchatPendingInputsTable.update(itemId, {
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

    this.sqlitePresenter.deepchatPendingInputsTable.update(itemId, {
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

    this.sqlitePresenter.deepchatPendingInputsTable.update(itemId, {
      state: 'pending',
      claimed_at: null
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
    this.sqlitePresenter.deepchatPendingInputsTable.update(itemId, {
      state: 'consumed',
      consumed_at: Date.now()
    })
  }

  recoverClaimedInputs(): string[] {
    const rows = this.listClaimedRows()
    const recoveredSessionIds = new Set<string>()

    for (const row of rows) {
      if (!this.sqlitePresenter.deepchatSessionsTable.get(row.session_id)) {
        continue
      }

      this.sqlitePresenter.deepchatPendingInputsTable.update(row.id, {
        state: 'pending',
        claimed_at: null
      })
      recoveredSessionIds.add(row.session_id)
    }

    return Array.from(recoveredSessionIds)
  }

  deleteBySession(sessionId: string): void {
    this.sqlitePresenter.deepchatPendingInputsTable.deleteBySession(sessionId)
  }

  private getNextQueueOrder(sessionId: string): number {
    const queueRows = this.getQueueRows(sessionId)
    if (queueRows.length === 0) {
      return 1
    }
    return Math.max(...queueRows.map((row) => row.queue_order ?? 0)) + 1
  }

  private getQueueRows(sessionId: string): DeepChatPendingInputRow[] {
    return this.sqlitePresenter.deepchatPendingInputsTable
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

  private getPendingQueueRows(sessionId: string): DeepChatPendingInputRow[] {
    return this.getQueueRows(sessionId).filter((row) => row.state === 'pending')
  }

  private getSteerRows(sessionId: string): DeepChatPendingInputRow[] {
    return this.sqlitePresenter.deepchatPendingInputsTable
      .listActiveBySession(sessionId)
      .filter((row) => row.mode === 'steer')
      .sort((left, right) => left.created_at - right.created_at)
  }

  private getPendingSteerRows(sessionId: string): DeepChatPendingInputRow[] {
    return this.getSteerRows(sessionId).filter((row) => row.state === 'pending')
  }

  private listClaimedRows(): DeepChatPendingInputRow[] {
    return this.sqlitePresenter.deepchatPendingInputsTable.listClaimed()
  }

  private resequenceQueue(sessionId: string): void {
    this.resequenceQueueRows(this.getPendingQueueRows(sessionId))
  }

  private resequenceQueueRows(rows: DeepChatPendingInputRow[]): void {
    rows.forEach((row, index) => {
      this.sqlitePresenter.deepchatPendingInputsTable.update(row.id, {
        queue_order: index + 1
      })
    })
  }

  private requireRow(itemId: string, expectedSessionId?: string): DeepChatPendingInputRow {
    const row = this.sqlitePresenter.deepchatPendingInputsTable.get(itemId)
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
      payload: this.parsePayload(row.payload_json),
      queueOrder: row.queue_order,
      claimedAt: row.claimed_at,
      consumedAt: row.consumed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private parsePayload(raw: string): SendMessageInput {
    try {
      return normalizeInput(JSON.parse(raw) as SendMessageInput)
    } catch {
      return normalizeInput(raw)
    }
  }
}
