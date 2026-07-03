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
  ): string {
    const newKey = buildMemoryProvenanceKey(agentId, row.kind, content)
    const nextCategory = canCarryCategory(row.kind) ? (row.category ?? category ?? null) : undefined
    if (newKey !== row.provenance_key) {
      const owner = this.ctx.deps.repository.getByProvenanceKey(agentId, newKey)
      if (owner && owner.id !== row.id) {
        this.absorbProvenanceHit(agentId, owner)
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
        return owner.id
      }
    }
    this.ctx.deps.repository.updateContent(row.id, content, newKey, now, nextCategory)
    return row.id
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

  absorbProvenanceHit(agentId: string, existing: AgentMemoryRow): boolean {
    const archived = existing.status === 'archived'
    const superseded = existing.superseded_by !== null
    if (!archived && !superseded) return false

    if (superseded) {
      const head = this.supersedeHead(agentId, existing)
      this.ctx.deps.repository.markSuperseded(existing.id, null)
      if (head.id !== existing.id && head.superseded_by === null && head.status !== 'archived') {
        this.ctx.deps.repository.markSuperseded(head.id, existing.id)
      }
    }
    this.ctx.deps.repository.updateStatus(existing.id, 'pending_embedding')
    return true
  }
}
