import logger from '@shared/logger'
import { nanoid } from 'nanoid'

import {
  buildLegacyMemoryProvenanceKey,
  buildMemoryProvenanceKey,
  normalizeForProvenanceV2
} from '../core/scoring'
import {
  CONFIDENCE_INCREMENT,
  DEFAULT_CONFIDENCE,
  type AgentMemoryRow,
  type NormalizedMemoryCandidate,
  type WriteMemoriesOptions
} from '../types'
import type {
  ContentUpdateResult,
  ManualEditFieldFlags,
  ProvenanceHitResult
} from '../domain/types'
import { isEmbeddingEligibleState } from '../domain/stateModel'
import { isUniqueConstraintError } from '../context'
import type {
  MemoryAuditReadPort,
  MemoryEmbeddingRepositoryPort,
  MemoryLifecycleRepositoryPort,
  MemoryMutationRepositoryPort,
  MemoryReadRepositoryPort,
  MemoryTransactionPort
} from '../ports'

function canCarryCategory(kind: AgentMemoryRow['kind']): boolean {
  return kind === 'episodic' || kind === 'semantic'
}

type RowMutationRepository = MemoryReadRepositoryPort &
  MemoryMutationRepositoryPort &
  MemoryEmbeddingRepositoryPort &
  MemoryLifecycleRepositoryPort &
  MemoryTransactionPort

export class MemoryRowMutations {
  constructor(
    private readonly ports: {
      repository: RowMutationRepository
      auditReader?: MemoryAuditReadPort
    }
  ) {}

  private runAtomicTransition(apply: () => boolean): boolean {
    const rejected = new Error('memory transition rejected')
    try {
      return this.ports.repository.runInTransaction(() => {
        if (!apply()) throw rejected
        return true
      })
    } catch (error) {
      if (error === rejected) return false
      throw error
    }
  }

  resolveProvenance(agentId: string, kind: string, content: string): AgentMemoryRow | undefined {
    const normalizedContent = normalizeForProvenanceV2(content)
    const v2Key = buildMemoryProvenanceKey(agentId, kind, content)
    const resolveEquivalentV2Owner = (): AgentMemoryRow | undefined => {
      const owner = this.ports.repository.getByProvenanceKey(agentId, v2Key)
      return this.isEquivalentProvenanceOwner(owner, kind, normalizedContent) ? owner : undefined
    }
    const v2Owner = resolveEquivalentV2Owner()
    if (v2Owner) return v2Owner

    const legacyKey = buildLegacyMemoryProvenanceKey(agentId, kind, content)
    const legacyOwner = this.ports.repository.getByProvenanceKey(agentId, legacyKey)
    if (!this.isEquivalentProvenanceOwner(legacyOwner, kind, normalizedContent)) return undefined

    try {
      let rekeyed = false
      this.ports.repository.runInTransaction(() => {
        rekeyed = this.ports.repository.rekeyProvenance(agentId, legacyOwner.id, legacyKey, v2Key)
      })
      return rekeyed
        ? (this.ports.repository.getById(legacyOwner.id) ?? legacyOwner)
        : resolveEquivalentV2Owner()
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      return resolveEquivalentV2Owner()
    }
  }

  private isEquivalentProvenanceOwner(
    owner: AgentMemoryRow | undefined,
    kind: string,
    normalizedContent: string
  ): owner is AgentMemoryRow {
    return (
      owner !== undefined &&
      owner.kind === kind &&
      normalizeForProvenanceV2(owner.content) === normalizedContent
    )
  }

  isPendingEmbeddableRow(agentId: string, row: AgentMemoryRow | undefined): boolean {
    return !!row && row.agent_id === agentId && isEmbeddingEligibleState(row)
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
      this.ports.repository.insert({
        id,
        agentId,
        kind: candidate.kind,
        category: candidate.category,
        content,
        importance: candidate.importance,
        lifecycleState: 'active',
        embeddingState: 'pending',
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
      this.ports.repository.insert({
        id,
        agentId,
        kind: candidate.kind,
        category: candidate.category,
        content,
        importance: candidate.importance,
        lifecycleState: 'conflicted',
        embeddingState: 'pending',
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
    const current = this.ports.repository.getById(id)?.confidence ?? DEFAULT_CONFIDENCE
    this.ports.repository.setConfidence(id, Math.min(1, current + CONFIDENCE_INCREMENT))
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
      const owner = this.resolveProvenance(agentId, row.kind, content)
      if (owner && owner.id !== row.id) {
        return this.resolveManualEditFold(agentId, row, owner, candidate, providedFields, now)
      }
    }

    if (newKey === row.provenance_key) {
      const updated = this.ports.repository.updateUserContentAndInvalidateEmbedding({
        agentId,
        id: row.id,
        expectedRevision: row.decision_revision,
        content,
        provenanceKey: newKey,
        at: now,
        category: nextCategory,
        importance: candidate.importance
      })
      if (!updated) return { action: 'suppressed', id: row.id, reason: 'concurrent-update' }
      return { action: 'updated', id: row.id }
    }

    let newId: string | null = null
    const insertedAndSuperseded = this.runAtomicTransition(() => {
      newId = this.insertMemory(agentId, candidate, content, newKey, options)
      if (!newId) return false
      return this.ports.repository.markSupersededIfRevision(
        agentId,
        row.id,
        row.decision_revision,
        newId
      )
    })
    if (!insertedAndSuperseded) newId = null

    if (!newId) {
      const owner = this.resolveProvenance(agentId, row.kind, content)
      if (owner && owner.id !== row.id) {
        return this.resolveManualEditFold(agentId, row, owner, candidate, providedFields, now)
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
    providedFields: ManualEditFieldFlags,
    now: number
  ): ContentUpdateResult {
    if (owner.lifecycle_state === 'conflicted' || owner.conflict_state === 'challenged') {
      return { action: 'suppressed', id: owner.id, reason: 'conflict' }
    }

    const hit = this.handleProvenanceHit(agentId, owner, { allowDecisionForSuperseded: true })
    if (hit.action === 'noop' && hit.reason !== 'duplicate') {
      return { action: 'suppressed', id: owner.id, reason: hit.reason }
    }

    const isRetiredOwner = owner.lifecycle_state === 'archived' || owner.superseded_by !== null
    const action: 'folded' | 'superseded' = isRetiredOwner ? 'superseded' : 'folded'

    const transitionApplied = this.runAtomicTransition(() => {
      let ownerRevision = owner.decision_revision
      let retiredHeadId: string | null = null
      if (hit.action === 'absorbed') {
        if (
          !this.ports.repository.restoreArchivedMemory({
            agentId,
            id: owner.id,
            expectedRevision: owner.decision_revision
          })
        ) {
          return false
        }
        ownerRevision += 1
      }
      if (hit.action === 'continue') {
        const revival = this.reviveSupersededAfterDecision(agentId, owner)
        if (!revival.applied) return false
        ownerRevision += 1
        retiredHeadId = revival.retiredHeadId
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
        if (
          !this.ports.repository.updateUserMetadataIfRevision({
            agentId,
            id: owner.id,
            expectedRevision: ownerRevision,
            ...metadataPatch,
            lastAccessedAt: now
          })
        ) {
          return false
        }
      }
      if (retiredHeadId === row.id) return true
      return this.ports.repository.markSupersededIfRevision(
        agentId,
        row.id,
        row.decision_revision,
        owner.id
      )
    })

    if (!transitionApplied) {
      return { action: 'suppressed', id: owner.id, reason: 'concurrent-update' }
    }

    return action === 'folded'
      ? { action: 'folded', id: owner.id }
      : { action: 'superseded', id: owner.id, supersededId: row.id, created: false }
  }

  supersedeHead(agentId: string, row: AgentMemoryRow): AgentMemoryRow {
    let current = row
    const seen = new Set<string>([row.id])
    while (current.superseded_by) {
      const next = this.ports.repository.getById(current.superseded_by)
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
    const archived = existing.lifecycle_state === 'archived'
    const superseded = existing.superseded_by !== null
    if (!archived && !superseded) return { action: 'noop', reason: 'duplicate' }

    if (archived && this.ports.auditReader?.hasForgetEvent(agentId, existing.id)) {
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
  ): { applied: boolean; retiredHeadId: string | null } {
    if (existing.lifecycle_state === 'archived' || existing.superseded_by === null) {
      return { applied: false, retiredHeadId: null }
    }

    const head = this.supersedeHead(agentId, existing)
    const retiredHead =
      head.id !== existing.id && head.lifecycle_state !== 'archived' && head.superseded_by === null
        ? { id: head.id, expectedRevision: head.decision_revision }
        : null
    if (
      !this.ports.repository.reviveSupersededMemory({
        agentId,
        id: existing.id,
        expectedRevision: existing.decision_revision,
        retiredHead
      })
    ) {
      return { applied: false, retiredHeadId: null }
    }
    return { applied: true, retiredHeadId: retiredHead?.id ?? null }
  }
}
