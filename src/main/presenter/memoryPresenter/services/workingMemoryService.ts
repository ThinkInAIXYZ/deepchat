import logger from '@shared/logger'
import { nanoid } from 'nanoid'

import { buildLegacyMemoryProvenanceKey, buildMemoryProvenanceKey } from '../core/scoring'
import { estimateTokens } from '../core/injectionPort'
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

export class WorkingMemoryService implements WorkingMemoryReadPort {
  private readonly ctx: MemoryRuntimeContext
  private readonly workingRefreshInFlight = new Set<string>()
  private readonly workingRefreshTimers = new Map<string, NodeJS.Timeout>()
  private readonly workingMemoryDirty = new Set<string>()

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
        this.ports.repository.delete(legacyRow.id)
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
      this.ports.repository.delete(legacyRow.id)
      return owner
    }
    return owner?.kind === 'working' ? owner : undefined
  }

  deleteWorkingMemory(agentId: string): void {
    const existing = this.resolveWorkingRow(agentId)
    if (existing) {
      this.ports.repository.delete(existing.id)
      this.ctx.markDomainMutationCommitted(agentId)
    }
  }

  syncWorkingMemoryAfterMutation(agentId: string): void {
    this.markWorkingMemoryDirty(agentId)
  }

  markWorkingMemoryDirty(agentId: string): void {
    this.workingMemoryDirty.add(agentId)
    this.scheduleDirtyRefresh(agentId)
  }

  flushWorkingMemoryIfDirty(agentId: string): void {
    const timer = this.workingRefreshTimers.get(agentId)
    if (timer) clearTimeout(timer)
    this.workingRefreshTimers.delete(agentId)
    if (!this.workingMemoryDirty.delete(agentId)) return
    try {
      if (this.ctx.canReadAgentMemory(agentId)) this.refreshWorkingMemory(agentId)
      else this.deleteWorkingMemory(agentId)
    } catch (error) {
      this.workingMemoryDirty.add(agentId)
      throw error
    }
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

  refreshWorkingMemory(agentId: string): void {
    if (!this.ctx.canReadAgentMemory(agentId)) return
    const workingKey = this.workingMemoryKey(agentId)
    let existing = this.resolveWorkingRow(agentId)
    let blob = this.buildWorkingBlob(agentId)
    if (!blob) {
      if (existing) {
        this.ports.repository.delete(existing.id)
        this.ctx.markDomainMutationCommitted(agentId)
      }
      return
    }
    if (existing) {
      for (let attempt = 0; attempt < 2 && existing; attempt += 1) {
        if (existing.content === blob) return
        if (
          this.ports.repository.updateInternalContent({
            agentId,
            id: existing.id,
            expectedRevision: existing.decision_revision,
            content: blob,
            provenanceKey: workingKey,
            at: Date.now()
          })
        ) {
          this.ctx.markDomainMutationCommitted(agentId)
          return
        }
        existing = this.resolveWorkingRow(agentId)
        blob = this.buildWorkingBlob(agentId)
        if (!blob) {
          if (existing) {
            this.ports.repository.delete(existing.id)
            this.ctx.markDomainMutationCommitted(agentId)
          }
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
    const now = Date.now()
    try {
      this.ports.repository.insert({
        id: `working-${nanoid(12)}`,
        agentId,
        kind: 'working',
        content: blob,
        importance: 0,
        lifecycleState: 'active',
        embeddingState: 'not_applicable',
        provenanceKey: workingKey,
        createdAt: now
      })
      this.ctx.markDomainMutationCommitted(agentId)
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
    }
  }

  buildWorkingBlob(agentId: string): string {
    const lines: string[] = []
    let tokens = 0
    let scanned = 0
    let cursor: AgentMemoryWorkingCandidateCursor | undefined
    while (scanned < WORKING_CANDIDATE_SCAN_LIMIT && tokens < WORKING_BLOB_TOKEN_LIMIT) {
      const pageLimit = Math.min(
        WORKING_CANDIDATE_PAGE_LIMIT,
        WORKING_CANDIDATE_SCAN_LIMIT - scanned
      )
      const units = this.ports.repository.listWorkingCandidates(agentId, pageLimit, cursor)
      if (!units.length) break
      scanned += units.length
      for (const unit of units) {
        const content = unit.content.trim()
        if (!content) continue
        const line = `- ${content}`
        const cost = estimateTokens(line)
        if (tokens + cost > WORKING_BLOB_TOKEN_LIMIT) continue
        lines.push(line)
        tokens += cost
        if (tokens >= WORKING_BLOB_TOKEN_LIMIT) break
      }
      const last = units[units.length - 1]
      cursor = {
        importance: last.importance,
        accessCount: last.access_count,
        createdAt: last.created_at,
        id: last.id
      }
      if (units.length < pageLimit) break
    }
    return lines.join('\n').trim()
  }

  cleanupAgent(agentId: string): void {
    const timer = this.workingRefreshTimers.get(agentId)
    if (timer) clearTimeout(timer)
    this.workingRefreshTimers.delete(agentId)
    this.workingRefreshInFlight.delete(agentId)
    this.workingMemoryDirty.delete(agentId)
  }

  clearAll(): void {
    for (const timer of this.workingRefreshTimers.values()) clearTimeout(timer)
    this.workingRefreshTimers.clear()
    this.workingRefreshInFlight.clear()
    this.workingMemoryDirty.clear()
  }
}
