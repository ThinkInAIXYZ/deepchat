import { Buffer } from 'node:buffer'
import { z } from 'zod'
import type { SubagentTapeLinkReceipt } from '@shared/types/agent-interface'
import {
  LIVE_DELEGATION_MAX_EFFECT_EVIDENCE_BYTES,
  LIVE_DELEGATION_MAX_ACTIVE_PER_PARENT,
  LIVE_DELEGATION_MAX_HANDOFF_BYTES,
  LIVE_DELEGATION_MAX_MESSAGE_BYTES,
  LIVE_DELEGATION_MAX_PENDING_MESSAGE_BYTES,
  LIVE_DELEGATION_MAX_PROMPT_BYTES,
  LIVE_DELEGATION_MAX_RESULT_REF_BYTES,
  LiveDelegationEventSchema,
  LiveDelegationResultRefSchema,
  LiveDelegationSchema,
  LiveDelegationTapeReceiptSchema,
  LiveDelegationTurnSchema,
  type LiveDelegation,
  type LiveDelegationEvent,
  type LiveDelegationEventKind,
  type LiveDelegationResultRef,
  type LiveDelegationStatus,
  type LiveDelegationTurn,
  type LiveDelegationTurnStatus
} from '@shared/orchestration/liveDelegation'
import {
  OrchestrationEffectEvidenceSchema,
  OrchestrationEffectStateSchema,
  type OrchestrationEffectEvidence,
  type OrchestrationEffectState
} from '@shared/orchestration/toolEffect'
import type { LiveDelegationDatabase } from './data/database'
import type { LiveDelegationEventRow } from './data/tables/liveDelegationEvents'
import type { LiveDelegationRow } from './data/tables/liveDelegations'
import type { LiveDelegationTurnRow } from './data/tables/liveDelegationTurns'

const MAX_RETAINED_CONSUMED_MESSAGES_PER_PARENT = 500
const MAX_LIST_LIMIT = 100
const MAX_PENDING_MESSAGES = 16
const MAILBOX_RECOVERY_NOTICE =
  '[Some queued messages were truncated or omitted to satisfy host mailbox limits.]'
const StoredIdSchema = z.string().trim().min(1).max(256)
const ListLimitSchema = z.number().int().min(1).max(MAX_LIST_LIMIT)
const CursorSchema = z.number().int().nonnegative()
const ACTIVE_TURN_STATUSES = [
  'queued',
  'running',
  'waiting_permission',
  'waiting_question'
] as const
const EFFECT_RANK: Record<OrchestrationEffectState, number> = {
  none: 0,
  read: 1,
  unknown: 2,
  write: 3
}

export interface CreateLiveDelegationInput {
  id: string
  initialTurnId: string
  parentSessionId: string
  slotId: string
  targetAgentId: string
  title: string
  prompt: string
  now?: number
}

export interface LiveDelegationWithTurn {
  delegation: LiveDelegation
  turn: LiveDelegationTurn
}

export interface ActiveLiveDelegationTurn extends LiveDelegationWithTurn {}

export class LiveDelegationRepository {
  constructor(private readonly database: LiveDelegationDatabase) {}

  create(input: CreateLiveDelegationInput): LiveDelegationWithTurn {
    const id = StoredIdSchema.parse(input.id)
    const initialTurnId = StoredIdSchema.parse(input.initialTurnId)
    const parentSessionId = StoredIdSchema.parse(input.parentSessionId)
    const slotId = StoredIdSchema.parse(input.slotId)
    const targetAgentId = StoredIdSchema.parse(input.targetAgentId)
    const title = validateText(input.title, 160, 'Live delegation title')
    const prompt = validateBytes(input.prompt, LIVE_DELEGATION_MAX_PROMPT_BYTES, 'Delegated task')
    const now = validateTimestamp(input.now ?? Date.now())
    const db = this.database.getDatabase()

    return db.transaction(() => {
      this.assertParentHasActiveCapacity(parentSessionId)
      db.prepare(
        `INSERT INTO live_delegations (
           delegation_id, parent_session_id, child_session_id, slot_id, target_agent_id, title,
           status, last_turn_seq, last_summary, last_error, created_at, updated_at, revision
         ) VALUES (?, ?, NULL, ?, ?, ?, 'queued', 1, NULL, NULL, ?, ?, 0)`
      ).run(id, parentSessionId, slotId, targetAgentId, title, now, now)
      db.prepare(
        `INSERT INTO live_delegation_turns (
           turn_id, delegation_id, seq, kind, prompt, status, result_summary, error,
           tape_receipt_json, created_at, started_at, updated_at, completed_at
         ) VALUES (?, ?, 1, 'initial', ?, 'queued', NULL, NULL, NULL, ?, NULL, ?, NULL)`
      ).run(initialTurnId, id, prompt, now, now)
      return {
        delegation: this.require(id),
        turn: this.requireTurn(initialTurnId)
      }
    })()
  }

  get(id: string): LiveDelegation | null {
    const row = this.database.delegations.get(StoredIdSchema.parse(id))
    return row ? toDelegation(row) : null
  }

  require(id: string): LiveDelegation {
    const delegation = this.get(id)
    if (!delegation) throw new Error(`Unknown live delegation: ${id}`)
    return delegation
  }

  requireOwned(parentSessionId: string, id: string): LiveDelegation {
    const delegation = this.require(id)
    if (delegation.parentSessionId !== StoredIdSchema.parse(parentSessionId)) {
      throw new Error(`Live delegation ${id} does not belong to the current session.`)
    }
    return delegation
  }

  getTurn(id: string): LiveDelegationTurn | null {
    const row = this.database.turns.get(StoredIdSchema.parse(id))
    return row ? toTurn(row) : null
  }

  requireTurn(id: string): LiveDelegationTurn {
    const turn = this.getTurn(id)
    if (!turn) throw new Error(`Unknown live delegation turn: ${id}`)
    return turn
  }

  listByParent(parentSessionId: string, limit = 20): LiveDelegation[] {
    const rows = this.database
      .getDatabase()
      .prepare(
        `SELECT * FROM live_delegations
         WHERE parent_session_id = ?
         ORDER BY updated_at DESC, delegation_id DESC
         LIMIT ?`
      )
      .all(
        StoredIdSchema.parse(parentSessionId),
        ListLimitSchema.parse(limit)
      ) as LiveDelegationRow[]
    return rows.map(toDelegation)
  }

  listTurns(delegationId: string, limit = 20): LiveDelegationTurn[] {
    const rows = this.database
      .getDatabase()
      .prepare(
        `SELECT * FROM live_delegation_turns
         WHERE delegation_id = ?
         ORDER BY seq DESC
         LIMIT ?`
      )
      .all(
        StoredIdSchema.parse(delegationId),
        ListLimitSchema.parse(limit)
      ) as LiveDelegationTurnRow[]
    return rows.map(toTurn)
  }

  listActiveTurns(): ActiveLiveDelegationTurn[] {
    const rows = this.database
      .getDatabase()
      .prepare(
        `SELECT
           d.delegation_id AS d_delegation_id,
           d.parent_session_id AS d_parent_session_id,
           d.child_session_id AS d_child_session_id,
           d.slot_id AS d_slot_id,
           d.target_agent_id AS d_target_agent_id,
           d.title AS d_title,
           d.status AS d_status,
           d.last_turn_seq AS d_last_turn_seq,
           d.last_summary AS d_last_summary,
           d.last_error AS d_last_error,
           d.created_at AS d_created_at,
           d.updated_at AS d_updated_at,
           d.revision AS d_revision,
           t.*
         FROM live_delegation_turns AS t
         INNER JOIN live_delegations AS d ON d.delegation_id = t.delegation_id
         WHERE t.status IN ('queued', 'running', 'waiting_permission', 'waiting_question')
         ORDER BY t.updated_at ASC, t.turn_id ASC`
      )
      .all() as Array<LiveDelegationTurnRow & Record<`d_${string}`, unknown>>

    return rows.map((row) => ({
      delegation: toDelegation({
        delegation_id: String(row.d_delegation_id),
        parent_session_id: String(row.d_parent_session_id),
        child_session_id: row.d_child_session_id === null ? null : String(row.d_child_session_id),
        slot_id: String(row.d_slot_id),
        target_agent_id: String(row.d_target_agent_id),
        title: String(row.d_title),
        status: row.d_status as LiveDelegationStatus,
        last_turn_seq: Number(row.d_last_turn_seq),
        last_summary: row.d_last_summary === null ? null : String(row.d_last_summary),
        last_error: row.d_last_error === null ? null : String(row.d_last_error),
        created_at: Number(row.d_created_at),
        updated_at: Number(row.d_updated_at),
        revision: Number(row.d_revision)
      }),
      turn: toTurn(row)
    }))
  }

  countActiveByParent(parentSessionId: string): number {
    return this.readActiveCount(StoredIdSchema.parse(parentSessionId))
  }

  bindChild(id: string, childSessionId: string, now = Date.now()): LiveDelegation {
    const result = this.database
      .getDatabase()
      .prepare(
        `UPDATE live_delegations
         SET child_session_id = ?, updated_at = ?, revision = revision + 1
         WHERE delegation_id = ? AND child_session_id IS NULL`
      )
      .run(StoredIdSchema.parse(childSessionId), validateTimestamp(now), StoredIdSchema.parse(id))
    if (result.changes === 0) {
      const current = this.require(id)
      if (current.childSessionId !== childSessionId) {
        throw new Error(`Live delegation ${id} is already bound to another child session.`)
      }
    }
    return this.require(id)
  }

  createMessage(
    parentSessionId: string,
    delegationId: string,
    content: string
  ): LiveDelegationEvent {
    const delegation = this.requireOwned(parentSessionId, delegationId)
    const message = validateBytes(
      content,
      LIVE_DELEGATION_MAX_MESSAGE_BYTES,
      'Live delegation message'
    )
    const db = this.database.getDatabase()
    const messageBytes = Buffer.byteLength(message, 'utf8')
    const eventId = db.transaction(() => {
      const pending = db
        .prepare(
          `SELECT COUNT(*) AS count,
                  COALESCE(SUM(length(CAST(content AS BLOB))), 0) AS bytes
           FROM live_delegation_events
           WHERE delegation_id = ? AND direction = 'parent_to_child'
             AND kind = 'message' AND consumed_by_turn_id IS NULL`
        )
        .get(delegation.id) as { count: number; bytes: number }
      if (pending.count >= MAX_PENDING_MESSAGES) {
        throw new Error(`Live delegation ${delegation.id} has too many pending messages.`)
      }
      if (pending.bytes + messageBytes > LIVE_DELEGATION_MAX_PENDING_MESSAGE_BYTES) {
        throw new Error(
          `Live delegation ${delegation.id} pending mailbox would exceed ` +
            `${LIVE_DELEGATION_MAX_PENDING_MESSAGE_BYTES} UTF-8 bytes.`
        )
      }
      return this.insertEventRow({
        delegationId: delegation.id,
        parentSessionId: delegation.parentSessionId,
        direction: 'parent_to_child',
        kind: 'message',
        content: message,
        relatedTurnId: null,
        now: Date.now()
      })
    })()
    const row = db
      .prepare('SELECT * FROM live_delegation_events WHERE event_id = ?')
      .get(eventId) as LiveDelegationEventRow
    const event = toEvent(row)
    this.pruneEvents(delegation.parentSessionId)
    return event
  }

  createFollowUp(
    parentSessionId: string,
    delegationId: string,
    turnId: string,
    task: string,
    now = Date.now()
  ): LiveDelegationWithTurn {
    const delegation = this.requireOwned(parentSessionId, delegationId)
    const normalizedTask = validateBytes(task, LIVE_DELEGATION_MAX_PROMPT_BYTES, 'Follow-up task')
    const normalizedTurnId = StoredIdSchema.parse(turnId)
    const timestamp = validateTimestamp(now)
    const db = this.database.getDatabase()

    return db.transaction(() => {
      const active = db
        .prepare(
          `SELECT 1 FROM live_delegation_turns
           WHERE delegation_id = ?
             AND status IN ('queued', 'running', 'waiting_permission', 'waiting_question')`
        )
        .get(delegation.id)
      if (active) {
        throw new Error(`Live delegation ${delegation.id} already has an active turn.`)
      }
      this.assertParentHasActiveCapacity(delegation.parentSessionId)

      const messageRows = db
        .prepare(
          `SELECT event_id, content FROM live_delegation_events
           WHERE delegation_id = ? AND direction = 'parent_to_child'
             AND consumed_by_turn_id IS NULL
           ORDER BY event_id ASC`
        )
        .all(delegation.id) as Array<{ event_id: number; content: string }>
      const prompt = buildBoundedFollowUpPrompt(
        normalizedTask,
        messageRows.map((row) => row.content)
      )
      validateBytes(prompt, LIVE_DELEGATION_MAX_PROMPT_BYTES, 'Follow-up task with messages')
      const nextSeq = delegation.lastTurnSeq + 1
      db.prepare(
        `INSERT INTO live_delegation_turns (
           turn_id, delegation_id, seq, kind, prompt, status, result_summary, error,
           tape_receipt_json, created_at, started_at, updated_at, completed_at
         ) VALUES (?, ?, ?, 'follow_up', ?, 'queued', NULL, NULL, NULL, ?, NULL, ?, NULL)`
      ).run(normalizedTurnId, delegation.id, nextSeq, prompt, timestamp, timestamp)
      if (messageRows.length > 0) {
        const placeholders = messageRows.map(() => '?').join(', ')
        db.prepare(
          `UPDATE live_delegation_events SET consumed_by_turn_id = ?
           WHERE event_id IN (${placeholders}) AND consumed_by_turn_id IS NULL`
        ).run(normalizedTurnId, ...messageRows.map((row) => row.event_id))
      }
      db.prepare(
        `UPDATE live_delegations
         SET status = 'queued', last_turn_seq = ?, last_error = NULL,
             updated_at = ?, revision = revision + 1
         WHERE delegation_id = ?`
      ).run(nextSeq, timestamp, delegation.id)
      return {
        delegation: this.require(delegation.id),
        turn: this.requireTurn(normalizedTurnId)
      }
    })()
  }

  markTurnStarted(turnId: string, now = Date.now()): LiveDelegationWithTurn {
    return this.updateActiveTurn(turnId, 'running', now)
  }

  markTurnWaiting(
    turnId: string,
    status: 'waiting_permission' | 'waiting_question',
    now = Date.now()
  ): LiveDelegationWithTurn {
    return this.updateActiveTurn(turnId, status, now)
  }

  recordEffectIntent(
    turnId: string,
    effectState: Exclude<OrchestrationEffectState, 'none'>,
    evidence: OrchestrationEffectEvidence,
    now = Date.now()
  ): LiveDelegationWithTurn | null {
    const normalizedTurnId = StoredIdSchema.parse(turnId)
    const requested = OrchestrationEffectStateSchema.exclude(['none']).parse(effectState)
    const parsedEvidence = OrchestrationEffectEvidenceSchema.parse(evidence)
    if (parsedEvidence.classification !== requested) {
      throw new Error(
        'Live delegation effect evidence classification does not match its requested state.'
      )
    }
    const evidenceJson = JSON.stringify(parsedEvidence)
    if (Buffer.byteLength(evidenceJson, 'utf8') > LIVE_DELEGATION_MAX_EFFECT_EVIDENCE_BYTES) {
      throw new Error('Live delegation effect evidence exceeds its storage limit.')
    }
    const requestedTimestamp = validateTimestamp(now)
    const db = this.database.getDatabase()
    const changed = db.transaction(() => {
      const current = db
        .prepare(
          `SELECT t.delegation_id, t.status, t.effect_state, t.updated_at,
                  d.updated_at AS delegation_updated_at
           FROM live_delegation_turns AS t
           INNER JOIN live_delegations AS d ON d.delegation_id = t.delegation_id
           WHERE t.turn_id = ?`
        )
        .get(normalizedTurnId) as
        | {
            delegation_id: string
            status: LiveDelegationTurnStatus
            effect_state: OrchestrationEffectState
            updated_at: number
            delegation_updated_at: number
          }
        | undefined
      if (!current || !isActiveTurnStatus(current.status)) {
        throw new Error(
          `Live delegation effect intent could not be persisted before tool execution: ${normalizedTurnId}`
        )
      }
      if (EFFECT_RANK[current.effect_state] >= EFFECT_RANK[requested]) return false

      const timestamp = Math.max(
        requestedTimestamp,
        current.updated_at,
        current.delegation_updated_at
      )
      const updated = db
        .prepare(
          `UPDATE live_delegation_turns
           SET effect_state = ?, effect_evidence_json = ?, updated_at = ?
           WHERE turn_id = ?
             AND status IN ('queued', 'running', 'waiting_permission', 'waiting_question')`
        )
        .run(requested, evidenceJson, timestamp, normalizedTurnId)
      if (updated.changes !== 1) {
        throw new Error(
          `Live delegation effect intent could not be persisted before tool execution: ${normalizedTurnId}`
        )
      }
      db.prepare(
        `UPDATE live_delegations
         SET updated_at = ?, revision = revision + 1
         WHERE delegation_id = ?`
      ).run(timestamp, current.delegation_id)
      return true
    })()

    if (!changed) return null
    const turn = this.requireTurn(normalizedTurnId)
    return { delegation: this.require(turn.delegationId), turn }
  }

  finishTurn(input: {
    turnId: string
    status: 'completed' | 'failed' | 'cancelled' | 'interrupted'
    summary?: string | null
    error?: string | null
    resultRef?: LiveDelegationResultRef | null
    tapeReceipt?: SubagentTapeLinkReceipt | null
    now?: number
  }): LiveDelegationWithTurn {
    const turn = this.requireTurn(input.turnId)
    if (!ACTIVE_TURN_STATUSES.includes(turn.status as (typeof ACTIVE_TURN_STATUSES)[number])) {
      return { delegation: this.require(turn.delegationId), turn }
    }
    const summary = normalizeOptionalBytes(
      input.summary,
      LIVE_DELEGATION_MAX_HANDOFF_BYTES,
      'Live delegation handoff'
    )
    const error = normalizeOptionalBytes(
      input.error,
      LIVE_DELEGATION_MAX_HANDOFF_BYTES,
      'Live delegation error'
    )
    const now = validateTimestamp(input.now ?? Date.now())
    const threadStatus: LiveDelegationStatus =
      input.status === 'completed'
        ? 'idle'
        : input.status === 'interrupted' || input.status === 'cancelled'
          ? 'interrupted'
          : 'failed'
    const eventKind: LiveDelegationEventKind =
      input.status === 'completed'
        ? 'turn_completed'
        : input.status === 'cancelled'
          ? 'turn_cancelled'
          : input.status === 'interrupted'
            ? 'turn_interrupted'
            : 'turn_failed'
    const eventContent = summary || error || defaultEventContent(eventKind)
    const tapeReceiptJson = input.tapeReceipt
      ? JSON.stringify(LiveDelegationTapeReceiptSchema.parse(input.tapeReceipt))
      : null
    const resultRef = input.resultRef ? LiveDelegationResultRefSchema.parse(input.resultRef) : null
    const delegation = this.require(turn.delegationId)
    if (resultRef && resultRef.childSessionId !== delegation.childSessionId) {
      throw new Error('Live delegation result reference does not match its bound child Session.')
    }
    const resultRefJson = resultRef ? JSON.stringify(resultRef) : null
    if (
      resultRefJson &&
      Buffer.byteLength(resultRefJson, 'utf8') > LIVE_DELEGATION_MAX_RESULT_REF_BYTES
    ) {
      throw new Error('Live delegation result reference exceeds its storage limit.')
    }
    const db = this.database.getDatabase()

    db.transaction(() => {
      const result = db
        .prepare(
          `UPDATE live_delegation_turns
           SET status = ?, result_summary = ?, error = ?, tape_receipt_json = ?,
               result_ref_json = ?,
               updated_at = ?, completed_at = ?
           WHERE turn_id = ?
             AND status IN ('queued', 'running', 'waiting_permission', 'waiting_question')`
        )
        .run(input.status, summary, error, tapeReceiptJson, resultRefJson, now, now, turn.id)
      if (result.changes === 0) return
      db.prepare(
        `UPDATE live_delegations
         SET status = ?, last_summary = ?, last_error = ?, updated_at = ?, revision = revision + 1
         WHERE delegation_id = ?`
      ).run(threadStatus, summary, error, now, turn.delegationId)
      this.insertEventRow({
        delegationId: turn.delegationId,
        parentSessionId: delegation.parentSessionId,
        direction: 'child_to_parent',
        kind: eventKind,
        content: eventContent,
        relatedTurnId: turn.id,
        now
      })
    })()
    const settledDelegation = this.require(turn.delegationId)
    this.pruneEvents(settledDelegation.parentSessionId)
    return { delegation: settledDelegation, turn: this.requireTurn(turn.id) }
  }

  listEvents(
    parentSessionId: string,
    options?: { after?: number; limit?: number; delegationIds?: string[] }
  ): LiveDelegationEvent[] {
    const parent = StoredIdSchema.parse(parentSessionId)
    const after = CursorSchema.parse(options?.after ?? 0)
    const limit = ListLimitSchema.parse(options?.limit ?? 50)
    const delegationIds = [
      ...new Set((options?.delegationIds ?? []).map((id) => StoredIdSchema.parse(id)))
    ]
    const clauses = ['parent_session_id = ?', 'event_id > ?', "direction = 'child_to_parent'"]
    const params: unknown[] = [parent, after]
    if (delegationIds.length > 0) {
      clauses.push(`delegation_id IN (${delegationIds.map(() => '?').join(', ')})`)
      params.push(...delegationIds)
    }
    params.push(limit)
    const rows = this.database
      .getDatabase()
      .prepare(
        `SELECT * FROM live_delegation_events
         WHERE ${clauses.join(' AND ')}
         ORDER BY event_id ASC
         LIMIT ?`
      )
      .all(...params) as LiveDelegationEventRow[]
    return rows.map(toEvent)
  }

  private updateActiveTurn(
    turnId: string,
    status: Extract<
      LiveDelegationTurnStatus,
      'running' | 'waiting_permission' | 'waiting_question'
    >,
    now: number
  ): LiveDelegationWithTurn {
    const turn = this.requireTurn(turnId)
    const timestamp = validateTimestamp(now)
    const db = this.database.getDatabase()
    db.transaction(() => {
      const result = db
        .prepare(
          `UPDATE live_delegation_turns
           SET status = ?, started_at = COALESCE(started_at, ?), updated_at = ?
           WHERE turn_id = ?
             AND status IN ('queued', 'running', 'waiting_permission', 'waiting_question')`
        )
        .run(status, timestamp, timestamp, turn.id)
      if (result.changes === 0) {
        throw new Error(`Live delegation turn ${turn.id} is already terminal.`)
      }
      db.prepare(
        `UPDATE live_delegations
         SET status = ?, updated_at = ?, revision = revision + 1
         WHERE delegation_id = ?`
      ).run(status, timestamp, turn.delegationId)
    })()
    return { delegation: this.require(turn.delegationId), turn: this.requireTurn(turn.id) }
  }

  private assertParentHasActiveCapacity(parentSessionId: string): void {
    if (
      this.readActiveCount(StoredIdSchema.parse(parentSessionId)) >=
      LIVE_DELEGATION_MAX_ACTIVE_PER_PARENT
    ) {
      throw new Error(
        `A parent session can have at most ${LIVE_DELEGATION_MAX_ACTIVE_PER_PARENT} active live delegations.`
      )
    }
  }

  private readActiveCount(parentSessionId: string): number {
    const row = this.database
      .getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count FROM live_delegations
         WHERE parent_session_id = ?
           AND status IN ('queued', 'running', 'waiting_permission', 'waiting_question')`
      )
      .get(parentSessionId) as { count: number }
    return row.count
  }

  private insertEventRow(input: {
    delegationId: string
    parentSessionId: string
    direction: 'parent_to_child' | 'child_to_parent'
    kind: LiveDelegationEventKind
    content: string
    relatedTurnId: string | null
    now: number
  }): number {
    const result = this.database
      .getDatabase()
      .prepare(
        `INSERT INTO live_delegation_events (
           delegation_id, parent_session_id, direction, kind, content, related_turn_id,
           consumed_by_turn_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`
      )
      .run(
        input.delegationId,
        input.parentSessionId,
        input.direction,
        input.kind,
        input.content,
        input.relatedTurnId,
        input.now
      )
    return Number(result.lastInsertRowid)
  }

  private pruneEvents(parentSessionId: string): void {
    this.database
      .getDatabase()
      .prepare(
        `DELETE FROM live_delegation_events
         WHERE parent_session_id = ?
           AND direction = 'parent_to_child'
           AND consumed_by_turn_id IS NOT NULL
           AND event_id NOT IN (
             SELECT event_id FROM live_delegation_events
             WHERE parent_session_id = ?
               AND direction = 'parent_to_child'
               AND consumed_by_turn_id IS NOT NULL
             ORDER BY event_id DESC
             LIMIT ?
           )`
      )
      .run(parentSessionId, parentSessionId, MAX_RETAINED_CONSUMED_MESSAGES_PER_PARENT)
  }
}

function toDelegation(row: LiveDelegationRow): LiveDelegation {
  return LiveDelegationSchema.parse({
    schemaVersion: 1,
    id: row.delegation_id,
    parentSessionId: row.parent_session_id,
    childSessionId: row.child_session_id,
    slotId: row.slot_id,
    targetAgentId: row.target_agent_id,
    title: row.title,
    status: row.status,
    lastTurnSeq: row.last_turn_seq,
    lastSummary: row.last_summary,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision
  })
}

function toTurn(row: LiveDelegationTurnRow): LiveDelegationTurn {
  return LiveDelegationTurnSchema.parse({
    id: row.turn_id,
    delegationId: row.delegation_id,
    seq: row.seq,
    kind: row.kind,
    prompt: row.prompt,
    status: row.status,
    resultSummary: row.result_summary,
    error: row.error,
    resultRef: parseResultRef(row.result_ref_json),
    tapeReceipt: parseTapeReceipt(row.tape_receipt_json),
    effectState: row.effect_state,
    effectEvidence: parseEffectEvidence(row.effect_evidence_json),
    createdAt: row.created_at,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  })
}

function toEvent(row: LiveDelegationEventRow): LiveDelegationEvent {
  return LiveDelegationEventSchema.parse({
    id: row.event_id,
    delegationId: row.delegation_id,
    parentSessionId: row.parent_session_id,
    direction: row.direction,
    kind: row.kind,
    content: row.content,
    relatedTurnId: row.related_turn_id,
    consumedByTurnId: row.consumed_by_turn_id,
    createdAt: row.created_at
  })
}

function buildBoundedFollowUpPrompt(task: string, storedMessages: string[]): string {
  const messages: string[] = []
  let admittedBytes = 0
  let recovered = false
  for (const storedMessage of storedMessages.slice(0, MAX_PENDING_MESSAGES)) {
    const normalized = storedMessage.trim()
    if (!normalized || normalized.includes('\0')) {
      recovered = true
      continue
    }
    const message = truncateUtf8(normalized, LIVE_DELEGATION_MAX_MESSAGE_BYTES)
    if (message !== normalized) recovered = true
    const messageBytes = Buffer.byteLength(message, 'utf8')
    if (admittedBytes + messageBytes > LIVE_DELEGATION_MAX_PENDING_MESSAGE_BYTES) {
      recovered = true
      continue
    }
    admittedBytes += messageBytes
    messages.push(message)
  }
  if (storedMessages.length > MAX_PENDING_MESSAGES) recovered = true

  for (let count = messages.length; count >= 0; count -= 1) {
    const omittedForPrompt = count < messages.length
    const prompt = buildFollowUpPrompt(
      task,
      messages.slice(0, count),
      recovered || omittedForPrompt
    )
    if (Buffer.byteLength(prompt, 'utf8') <= LIVE_DELEGATION_MAX_PROMPT_BYTES) return prompt
  }

  throw new Error(
    'Follow-up task leaves no room for queued messages or their recovery notice. Shorten the task and retry.'
  )
}

function buildFollowUpPrompt(task: string, messages: string[], recovered: boolean): string {
  if (messages.length === 0 && !recovered) return task
  return [
    ...(messages.length > 0
      ? [
          '# Messages received without starting a turn',
          ...messages.map((message, index) => `## Message ${index + 1}\n${message}`)
        ]
      : []),
    ...(recovered ? [MAILBOX_RECOVERY_NOTICE] : []),
    '# Follow-up task',
    task
  ].join('\n\n')
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2)
    const candidate = value.slice(0, midpoint)
    if (Buffer.byteLength(candidate, 'utf8') <= maxBytes) low = midpoint
    else high = midpoint - 1
  }
  let end = low
  const code = value.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return value.slice(0, Math.max(0, end))
}

function validateText(value: string, maxLength: number, label: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength || normalized.includes('\0')) {
    throw new Error(`${label} must contain between 1 and ${maxLength} characters.`)
  }
  return normalized
}

function validateBytes(value: string, maxBytes: number, label: string): string {
  const normalized = value.trim()
  const bytes = Buffer.byteLength(normalized, 'utf8')
  if (!normalized || normalized.includes('\0') || bytes > maxBytes) {
    throw new Error(`${label} must contain between 1 and ${maxBytes} UTF-8 bytes.`)
  }
  return normalized
}

function normalizeOptionalBytes(
  value: string | null | undefined,
  maxBytes: number,
  label: string
): string | null {
  if (value == null || !value.trim()) return null
  return validateBytes(value, maxBytes, label)
}

function validateTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid timestamp.')
  return value
}

function parseTapeReceipt(value: string | null) {
  return value ? LiveDelegationTapeReceiptSchema.parse(JSON.parse(value)) : null
}

function parseResultRef(value: string | null): LiveDelegationResultRef | null {
  return value ? LiveDelegationResultRefSchema.parse(JSON.parse(value)) : null
}

function parseEffectEvidence(value: string | null): OrchestrationEffectEvidence | null {
  return value ? OrchestrationEffectEvidenceSchema.parse(JSON.parse(value)) : null
}

function isActiveTurnStatus(status: LiveDelegationTurnStatus): boolean {
  return ACTIVE_TURN_STATUSES.includes(status as (typeof ACTIVE_TURN_STATUSES)[number])
}

function defaultEventContent(kind: LiveDelegationEventKind): string {
  switch (kind) {
    case 'turn_completed':
      return 'Child turn completed.'
    case 'turn_cancelled':
      return 'Child turn was cancelled.'
    case 'turn_interrupted':
      return 'Child turn was interrupted.'
    case 'turn_failed':
      return 'Child turn failed.'
    case 'message':
      return 'Message queued.'
  }
}
