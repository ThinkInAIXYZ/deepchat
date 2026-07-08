import logger from '@shared/logger'
import { nanoid } from 'nanoid'

import type { AgentMemoryCategory } from '@shared/types/agent-memory'
import { buildMemoryProvenanceKey } from '../core/scoring'
import {
  CONFIDENCE_INCREMENT,
  DEFAULT_CONFIDENCE,
  type AgentMemoryRow,
  type NormalizedMemoryCandidate,
  type WriteMemoriesOptions
} from '../types'
import { isUniqueConstraintError, type MemoryRuntimeContext } from '../context'

function canCarryCategory(kind: AgentMemoryRow['kind']): boolean {
  return kind === 'episodic' || kind === 'semantic'
}

export type ProvenanceHitResult =
  | { action: 'absorbed' }
  | { action: 'continue' }
  | { action: 'noop'; reason: string }

export type ContentUpdateResult =
  | { action: 'updated'; id: string }
  | { action: 'folded'; id: string }
  | { action: 'superseded'; id: string; supersededId: string; created?: boolean }
  | { action: 'suppressed'; id: string; reason: string }

// Which metadata fields the caller's edit patch actually touched, so a fold only overwrites the
// surviving owner's fields the user explicitly set rather than whatever the edited row happened
// to carry (e.g. its own untouched category/importance).
export interface ManualEditFieldFlags {
  category: boolean
  importance: boolean
}

export class MemoryRowMutations {
  constructor(private readonly ctx: MemoryRuntimeContext) {}

  isPendingEmbeddableRow(agentId: string, row: AgentMemoryRow | undefined): boolean {
    return (
      !!row &&
      row.agent_id === agentId &&
      row.status === 'pending_embedding' &&
      !row.superseded_by &&
      row.kind !== 'persona' &&
      row.kind !== 'working'
    )
  }

  insertMemory(
    agentId: string,
    candidate: NormalizedMemoryCandidate,
    content: string,
    provenanceKey: string,
    options: WriteMemoriesOptions
  ): string | null {
    const sourceSession = options.sourceSession ?? null
    const sourceEntryIds = sourceSession ? (options.sourceEntryIds ?? null) : null
    const id = `mem-${nanoid(12)}`
    try {
      this.ctx.deps.repository.insert({
        id,
        agentId,
        kind: candidate.kind,
        category: candidate.category,
        content,
        importance: candidate.importance,
        status: 'pending_embedding',
        sourceSession,
        userScope: options.userScope ?? null,
        provenanceKey,
        sourceEntryIds
      })
      return id
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      logger.warn(`[Memory] insert skipped (dedupe/race): ${String(error)}`)
      return null
    }
  }

  insertConflictedMemory(
    agentId: string,
    candidate: NormalizedMemoryCandidate,
    content: string,
    provenanceKey: string,
    targetId: string,
    options: WriteMemoriesOptions
  ): string | null {
    const sourceSession = options.sourceSession ?? null
    const sourceEntryIds = sourceSession ? (options.sourceEntryIds ?? null) : null
    const id = `mem-${nanoid(12)}`
    try {
      this.ctx.deps.repository.insert({
        id,
        agentId,
        kind: candidate.kind,
        category: candidate.category,
        content,
        importance: candidate.importance,
        status: 'conflicted',
        sourceSession,
        userScope: options.userScope ?? null,
        provenanceKey,
        sourceEntryIds,
        conflictWith: targetId
      })
      return id
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      logger.warn(`[Memory] conflicted insert skipped (dedupe/race): ${String(error)}`)
      return null
    }
  }

  bumpConfidence(id: string): void {
    const current = this.ctx.deps.repository.getById(id)?.confidence ?? DEFAULT_CONFIDENCE
    this.ctx.deps.repository.setConfidence(id, Math.min(1, current + CONFIDENCE_INCREMENT))
  }

  applyContentUpdate(
    agentId: string,
    row: AgentMemoryRow,
    content: string,
    now: number,
    category?: AgentMemoryCategory | null
  ): ContentUpdateResult {
    const newKey = buildMemoryProvenanceKey(agentId, row.kind, content)
    const nextCategory = canCarryCategory(row.kind) ? (row.category ?? category ?? null) : undefined
    if (newKey !== row.provenance_key) {
      const owner = this.ctx.deps.repository.getByProvenanceKey(agentId, newKey)
      if (owner && owner.id !== row.id) {
        const hit = this.handleProvenanceHit(agentId, owner, {
          allowDecisionForSuperseded: true
        })
        if (hit.action === 'noop' && (owner.status === 'archived' || owner.superseded_by)) {
          return {
            action: 'suppressed',
            id: owner.id,
            reason: hit.reason
          }
        }
        this.ctx.deps.repository.runInTransaction(() => {
          if (hit.action === 'absorbed') {
            this.ctx.deps.repository.updateStatus(owner.id, 'pending_embedding')
          }
          if (hit.action === 'continue') {
            this.reviveSupersededAfterDecision(agentId, owner)
          }
          if (canCarryCategory(owner.kind) && owner.category === null && nextCategory != null) {
            this.ctx.deps.repository.updateContent(
              owner.id,
              owner.content,
              owner.provenance_key,
              now,
              nextCategory
            )
          }
          this.ctx.deps.repository.markSuperseded(row.id, owner.id)
        })
        return { action: 'folded', id: owner.id }
      }
    }
    this.ctx.deps.repository.updateContent(row.id, content, newKey, now, nextCategory)
    return { action: 'updated', id: row.id }
  }

  applyManualContentEdit(
    agentId: string,
    row: AgentMemoryRow,
    candidate: NormalizedMemoryCandidate,
    content: string,
    now: number,
    options: WriteMemoriesOptions,
    providedFields: ManualEditFieldFlags
  ): ContentUpdateResult {
    const newKey = buildMemoryProvenanceKey(agentId, row.kind, content)
    const nextCategory = canCarryCategory(row.kind) ? candidate.category : undefined

    if (newKey !== row.provenance_key) {
      const owner = this.ctx.deps.repository.getByProvenanceKey(agentId, newKey)
      if (owner && owner.id !== row.id) {
        return this.resolveManualEditFold(agentId, row, owner, candidate, providedFields)
      }
    }

    if (newKey === row.provenance_key) {
      this.ctx.deps.repository.runInTransaction(() => {
        this.ctx.deps.repository.updateContent(row.id, content, newKey, now, nextCategory)
        this.ctx.deps.repository.updateUserMetadata(row.id, {
          category: candidate.category,
          importance: candidate.importance
        })
        this.ctx.deps.repository.updateStatus(row.id, 'pending_embedding')
      })
      return { action: 'updated', id: row.id }
    }

    let newId: string | null = null
    this.ctx.deps.repository.runInTransaction(() => {
      newId = this.insertMemory(agentId, candidate, content, newKey, options)
      if (newId) this.ctx.deps.repository.markSuperseded(row.id, newId)
    })

    if (!newId) {
      const owner = this.ctx.deps.repository.getByProvenanceKey(agentId, newKey)
      if (owner && owner.id !== row.id) {
        return this.resolveManualEditFold(agentId, row, owner, candidate, providedFields)
      }
      return { action: 'suppressed', id: row.id, reason: 'insert-skipped' }
    }

    return { action: 'superseded', id: newId, supersededId: row.id, created: true }
  }

  // Shared by the primary provenance-hit branch and the UNIQUE-constraint recovery branch above so
  // both resolve a manual edit into an existing owner with identical semantics: refuse conflict
  // participants outright (M1), and only overwrite metadata fields the caller's patch actually
  // provided (M3) rather than whatever the edited row's fully-resolved candidate happens to carry.
  private resolveManualEditFold(
    agentId: string,
    row: AgentMemoryRow,
    owner: AgentMemoryRow,
    candidate: NormalizedMemoryCandidate,
    providedFields: ManualEditFieldFlags
  ): ContentUpdateResult {
    if (owner.status === 'conflicted' || owner.conflict_state === 'challenged') {
      return { action: 'suppressed', id: owner.id, reason: 'conflict' }
    }

    const hit = this.handleProvenanceHit(agentId, owner, { allowDecisionForSuperseded: true })
    if (hit.action === 'noop' && hit.reason !== 'duplicate') {
      return { action: 'suppressed', id: owner.id, reason: hit.reason }
    }

    const isRetiredOwner = owner.status === 'archived' || owner.superseded_by !== null
    const action: 'folded' | 'superseded' = isRetiredOwner ? 'superseded' : 'folded'

    this.ctx.deps.repository.runInTransaction(() => {
      if (hit.action === 'absorbed') {
        this.ctx.deps.repository.updateStatus(owner.id, 'pending_embedding')
      }
      if (hit.action === 'continue') {
        this.reviveSupersededAfterDecision(agentId, owner)
      }
      const metadataPatch: { category?: string | null; importance?: number } = {}
      if (
        providedFields.category &&
        canCarryCategory(owner.kind) &&
        owner.category !== candidate.category
      ) {
        metadataPatch.category = candidate.category
      }
      if (providedFields.importance && owner.importance !== candidate.importance) {
        metadataPatch.importance = candidate.importance
      }
      if (Object.keys(metadataPatch).length > 0) {
        this.ctx.deps.repository.updateUserMetadata(owner.id, metadataPatch)
      }
      this.ctx.deps.repository.markSuperseded(row.id, owner.id)
    })

    return action === 'folded'
      ? { action: 'folded', id: owner.id }
      : { action: 'superseded', id: owner.id, supersededId: row.id, created: false }
  }

  supersedeHead(agentId: string, row: AgentMemoryRow): AgentMemoryRow {
    let current = row
    const seen = new Set<string>([row.id])
    while (current.superseded_by) {
      const next = this.ctx.deps.repository.getById(current.superseded_by)
      if (!next || next.agent_id !== agentId || seen.has(next.id)) break
      seen.add(next.id)
      current = next
    }
    return current
  }

  handleProvenanceHit(
    agentId: string,
    existing: AgentMemoryRow,
    options: { allowDecisionForSuperseded?: boolean } = {}
  ): ProvenanceHitResult {
    const archived = existing.status === 'archived'
    const superseded = existing.superseded_by !== null
    if (!archived && !superseded) return { action: 'noop', reason: 'duplicate' }

    if (archived && this.ctx.deps.auditRepository?.hasForgetEvent(agentId, existing.id)) {
      return { action: 'noop', reason: 'suppressed-user-forget' }
    }

    if (archived && superseded) {
      return { action: 'noop', reason: 'suppressed-conflict-loser' }
    }

    if (superseded && !archived && options.allowDecisionForSuperseded) {
      return { action: 'continue' }
    }

    if (superseded && !archived) {
      return { action: 'noop', reason: 'duplicate' }
    }

    return { action: 'absorbed' }
  }

  reviveSupersededAfterDecision(
    agentId: string,
    existing: AgentMemoryRow
  ): { retiredHeadId: string | null } {
    if (existing.status === 'archived' || existing.superseded_by === null) {
      return { retiredHeadId: null }
    }

    const head = this.supersedeHead(agentId, existing)
    this.ctx.deps.repository.markSuperseded(existing.id, null)
    this.ctx.deps.repository.updateStatus(existing.id, 'pending_embedding')

    if (head.id !== existing.id && head.status !== 'archived' && head.superseded_by === null) {
      this.ctx.deps.repository.markSuperseded(head.id, existing.id)
      return { retiredHeadId: head.id }
    }
    return { retiredHeadId: null }
  }
}
