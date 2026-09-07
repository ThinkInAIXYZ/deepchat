import logger from '@shared/logger'
import { nanoid } from 'nanoid'

import { buildLegacyMemoryProvenanceKey, buildMemoryProvenanceKey } from '../core/scoring'
import { buildStructuredWorkingProjection } from '../core/workingProjection'
import {
  WORKING_BLOB_TOKEN_LIMIT,
  WORKING_CANDIDATE_PAGE_LIMIT,
  WORKING_CANDIDATE_SCAN_LIMIT,
  WORKING_REFRESH_DEBOUNCE_MS,
  WORKING_PROVENANCE_SEED
} from '../runtimeConstants'
import { isUniqueConstraintError, type MemoryRuntimeContext } from '../context'
import type {
  MemoryMutationRepositoryPort,
  MemoryReadRepositoryPort,
  MemoryTransactionPort,
  WorkingMemoryReadPort
} from '../ports'
import type { AgentMemoryWorkingCandidateCursor } from '../types'
import type { AgentMemoryRow } from '../types'

interface WorkingProjection {
  content: string
  builtAt: number
  nextRefreshAt: number | null
  sourceCandidatesScanned: number
}

export class WorkingMemoryService implements WorkingMemoryReadPort {
  private readonly ctx: MemoryRuntimeContext
  private readonly workingRefreshInFlight = new Set<string>()
  private readonly workingRefreshTimers = new Map<string, NodeJS.Timeout>()
  private readonly workingMemoryDirty = new Set<string>()
  private readonly workingProjectionFreshness = new Map<
    string,
    Pick<WorkingProjection, 'builtAt' | 'nextRefreshAt'>
  >()

  constructor(
    private readonly ports: {
      ctx: MemoryRuntimeContext
      repository: MemoryReadRepositoryPort & MemoryMutationRepositoryPort & MemoryTransactionPort
    }
  ) {
    this.ctx = ports.ctx
  }

  readWorkingMemory(agentId: string): string | null {
    this.flushWorkingMemoryIfDirty(agentId)
    const row = this.resolveWorkingRow(agentId)
    const content = row?.content?.trim()
    return content ? content : null
  }

  workingMemoryKey(agentId: string): string {
    return buildMemoryProvenanceKey(agentId, 'working', WORKING_PROVENANCE_SEED)
  }

  private legacyWorkingMemoryKey(agentId: string): string {
    return buildLegacyMemoryProvenanceKey(agentId, 'working', WORKING_PROVENANCE_SEED)
  }

  private resolveWorkingRow(agentId: string): AgentMemoryRow | undefined {
    const v2Key = this.workingMemoryKey(agentId)
    const legacyKey = this.legacyWorkingMemoryKey(agentId)
    const v2Row = this.ports.repository.getByProvenanceKey(agentId, v2Key)
    const legacyRow = this.ports.repository.getByProvenanceKey(agentId, legacyKey)
    const validLegacy = legacyRow?.agent_id === agentId && legacyRow.kind === 'working'

    if (v2Row) {
      if (validLegacy && legacyRow.id !== v2Row.id) {
        this.ports.repository.deleteInternalMemory(agentId, legacyRow.id)
      }
      return v2Row.kind === 'working' ? v2Row : undefined
    }
    if (!validLegacy) return undefined

    try {
      const rekeyed = this.ports.repository.runInTransaction(() =>
        this.ports.repository.rekeyProvenance(agentId, legacyRow.id, legacyKey, v2Key)
      )
      if (rekeyed) return this.ports.repository.getById(legacyRow.id) ?? legacyRow
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
    }

    const owner = this.ports.repository.getByProvenanceKey(agentId, v2Key)
    if (owner?.kind === 'working' && owner.id !== legacyRow.id) {
      this.ports.repository.deleteInternalMemory(agentId, legacyRow.id)
      return owner
    }
    return owner?.kind === 'working' ? owner : undefined
  }

  deleteWorkingMemory(agentId: string): void {
    this.workingProjectionFreshness.delete(agentId)
    const existing = this.resolveWorkingRow(agentId)
    if (existing) {
      this.ports.repository.deleteInternalMemory(agentId, existing.id)
      this.ctx.markDomainMutationCommitted(agentId)
    }
  }

  syncWorkingMemoryAfterMutation(agentId: string): void {
    this.markWorkingMemoryDirty(agentId)
  }

  markWorkingMemoryDirty(agentId: string): void {
    this.workingProjectionFreshness.delete(agentId)
    this.workingMemoryDirty.add(agentId)
    this.scheduleDirtyRefresh(agentId)
  }

  flushWorkingMemoryIfDirty(agentId: string): void {
    const timer = this.workingRefreshTimers.get(agentId)
    if (timer) clearTimeout(timer)
    this.workingRefreshTimers.delete(agentId)
    if (this.workingMemoryDirty.delete(agentId)) {
      try {
        if (this.ctx.canReadAgentMemory(agentId)) this.refreshWorkingMemory(agentId)
        else this.deleteWorkingMemory(agentId)
      } catch (error) {
        this.workingMemoryDirty.add(agentId)
        throw error
      }
      return
    }
    this.refreshWorkingMemoryAtTemporalBoundary(agentId)
  }

  scheduleWorkingRefresh(agentId: string): void {
    if (!this.ctx.canReadAgentMemory(agentId)) return
    this.workingMemoryDirty.add(agentId)
    this.scheduleDirtyRefresh(agentId)
  }

  private scheduleDirtyRefresh(agentId: string): void {
    const existing = this.workingRefreshTimers.get(agentId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.workingRefreshTimers.delete(agentId)
      if (this.workingRefreshInFlight.has(agentId)) {
        this.scheduleDirtyRefresh(agentId)
        return
      }
      this.workingRefreshInFlight.add(agentId)
      try {
        this.flushWorkingMemoryIfDirty(agentId)
      } catch (error) {
        logger.warn(`[Memory] working refresh skipped: ${String(error)}`)
      } finally {
        this.workingRefreshInFlight.delete(agentId)
      }
    }, WORKING_REFRESH_DEBOUNCE_MS)
    if (typeof timer.unref === 'function') timer.unref()
    this.workingRefreshTimers.set(agentId, timer)
  }

  refreshWorkingMemory(
    agentId: string,
    options: { preserveOrphanedExisting?: boolean } = {}
  ): void {
    if (!this.ctx.canReadAgentMemory(agentId)) return
    const workingKey = this.workingMemoryKey(agentId)
    let existing = this.resolveWorkingRow(agentId)
    let projection = this.buildWorkingProjection(agentId)
    if (!projection.content) {
      if (
        existing &&
        (!options.preserveOrphanedExisting || projection.sourceCandidatesScanned > 0)
      ) {
        this.ports.repository.deleteInternalMemory(agentId, existing.id)
        this.ctx.markDomainMutationCommitted(agentId)
      }
      this.recordProjectionFreshness(agentId, projection)
      return
    }
    if (existing) {
      for (let attempt = 0; attempt < 2 && existing; attempt += 1) {
        if (existing.content === projection.content) {
          this.recordProjectionFreshness(agentId, projection)
          return
        }
        if (
          this.ports.repository.updateInternalContent({
            agentId,
            id: existing.id,
            expectedRevision: existing.decision_revision,
            content: projection.content,
            provenanceKey: workingKey,
            at: this.ctx.now()
          })
        ) {
          this.ctx.markDomainMutationCommitted(agentId)
          this.recordProjectionFreshness(agentId, projection)
          return
        }
        existing = this.resolveWorkingRow(agentId)
        projection = this.buildWorkingProjection(agentId)
        if (!projection.content) {
          if (
            existing &&
            (!options.preserveOrphanedExisting || projection.sourceCandidatesScanned > 0)
          ) {
            this.ports.repository.deleteInternalMemory(agentId, existing.id)
            this.ctx.markDomainMutationCommitted(agentId)
          }
          this.recordProjectionFreshness(agentId, projection)
          return
        }
      }
      if (existing) {
        this.workingMemoryDirty.add(agentId)
        this.scheduleDirtyRefresh(agentId)
        logger.warn(`[Memory] working refresh CAS rejected twice for ${agentId}; retry scheduled`)
        return
      }
    }
    const now = this.ctx.now()
    try {
      this.ports.repository.insertInternalMemory({
        id: `working-${nanoid(12)}`,
        agentId,
        kind: 'working',
        content: projection.content,
        importance: 0,
        lifecycleState: 'active',
        embeddingState: 'not_applicable',
        provenanceKey: workingKey,
        createdAt: now
      })
      this.ctx.markDomainMutationCommitted(agentId)
      this.recordProjectionFreshness(agentId, projection)
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const owner = this.resolveWorkingRow(agentId)
      if (owner?.content === projection.content) {
        this.recordProjectionFreshness(agentId, projection)
      } else {
        this.workingMemoryDirty.add(agentId)
        this.scheduleDirtyRefresh(agentId)
      }
    }
  }

  private buildWorkingProjection(agentId: string): WorkingProjection {
    const now = this.ctx.now()
    let scanned = 0
    let cursor: AgentMemoryWorkingCandidateCursor | undefined
    const candidates: AgentMemoryRow[] = []
    while (scanned < WORKING_CANDIDATE_SCAN_LIMIT) {
      const pageLimit = Math.min(
        WORKING_CANDIDATE_PAGE_LIMIT,
        WORKING_CANDIDATE_SCAN_LIMIT - scanned
      )
      const units = this.ports.repository.listWorkingCandidates(agentId, pageLimit, cursor)
      if (!units.length) break
      scanned += units.length
      candidates.push(...units)
      const last = units[units.length - 1]
      cursor = {
        importance: last.importance,
        accessCount: last.access_count,
        createdAt: last.created_at,
        id: last.id
      }
      if (units.length < pageLimit) break
    }
    const projection = buildStructuredWorkingProjection(candidates, now, WORKING_BLOB_TOKEN_LIMIT)
    return {
      content: projection.content,
      builtAt: now,
      nextRefreshAt: projection.nextRefreshAt,
      sourceCandidatesScanned: scanned
    }
  }

  private recordProjectionFreshness(agentId: string, projection: WorkingProjection): void {
    this.workingProjectionFreshness.set(agentId, {
      builtAt: projection.builtAt,
      nextRefreshAt: projection.nextRefreshAt
    })
  }

  private refreshWorkingMemoryAtTemporalBoundary(agentId: string): void {
    if (!this.ctx.canReadAgentMemory(agentId)) return
    const freshness = this.workingProjectionFreshness.get(agentId)
    const now = this.ctx.now()
    if (
      freshness &&
      now >= freshness.builtAt &&
      (freshness.nextRefreshAt === null || now < freshness.nextRefreshAt)
    ) {
      return
    }
    const existing = this.resolveWorkingRow(agentId)
    if (!existing) return
    this.refreshWorkingMemory(agentId, { preserveOrphanedExisting: true })
  }

  cleanupAgent(agentId: string): void {
    const timer = this.workingRefreshTimers.get(agentId)
    if (timer) clearTimeout(timer)
    this.workingRefreshTimers.delete(agentId)
    this.workingRefreshInFlight.delete(agentId)
    this.workingMemoryDirty.delete(agentId)
    this.workingProjectionFreshness.delete(agentId)
  }

  clearAll(): void {
    for (const timer of this.workingRefreshTimers.values()) clearTimeout(timer)
    this.workingRefreshTimers.clear()
    this.workingRefreshInFlight.clear()
    this.workingMemoryDirty.clear()
    this.workingProjectionFreshness.clear()
  }
}
