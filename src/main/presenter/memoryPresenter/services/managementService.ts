import logger from '@shared/logger'

import {
  MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_PREVIEW_LIMIT,
  MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_SCAN_LIMIT,
  createEmptyMemoryHealth,
  type MemoryArchiveCandidateLifecyclePreview,
  type MemoryHealthDto,
  type MemoryLifecycle
} from '@shared/contracts/routes/memory.routes'
import { isAgentMemoryCategory } from '@shared/types/agent-memory'
import { ARCHIVE_AGE_MS, ARCHIVE_DECAY_THRESHOLD } from '../core/lifecycle'
import { deriveLifecycle, type DeriveLifecycleOptions } from '../core/lifecycle'
import { resolveRetrieval } from '../core/scoring'
import {
  MEMORY_HEALTH_AUDIT_SCAN_LIMIT,
  MEMORY_HEALTH_RECENT_FAILURES_LIMIT,
  MEMORY_HEALTH_TOP_ACCESSED_LIMIT
} from '../runtimeConstants'
import type { AgentMemoryRow, MemoryStatus } from '../types'
import { embeddingFingerprint, type MemoryRuntimeContext } from '../context'

function toHealthTopAccessedItem(
  row: AgentMemoryRow
): MemoryHealthDto['access']['topAccessed'][number] | null {
  const kind = row.kind
  if (kind === 'working') return null
  return {
    id: row.id,
    kind,
    category: isAgentMemoryCategory(row.category) ? row.category : null,
    content: row.content,
    importance: row.importance,
    accessCount: Math.max(0, row.access_count),
    lastAccessed: row.last_accessed
  }
}

export class ManagementService {
  constructor(
    private readonly ctx: MemoryRuntimeContext,
    private readonly ports: {
      deleteVectorsForMemoryIds: (agentId: string, memoryIds: string[]) => Promise<void>
      resetAgentStore: (agentId: string) => Promise<void>
      isReindexing: (agentId: string) => boolean
      syncWorkingMemoryAfterMutation: (agentId: string) => void
      triggerEmbedding: (agentId: string) => Promise<void>
      clearConsolidationCooldown: (agentId: string) => void
    }
  ) {}

  restoreMemory(agentId: string, memoryId: string): boolean {
    if (this.ctx.isDisposed) return false
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.canWriteAgentMemory(agentId)) return false
    const row = this.ctx.deps.repository.getById(memoryId)
    if (!row || row.agent_id !== agentId || row.status !== 'archived') return false
    this.ctx.deps.repository.updateStatus(memoryId, 'pending_embedding')
    this.ports.syncWorkingMemoryAfterMutation(agentId)
    void this.ports.triggerEmbedding(agentId).catch((error) => {
      logger.warn(`[Memory] background embedding failed: ${String(error)}`)
    })
    this.ctx.emitChanged(agentId, 'extract')
    return true
  }

  async forgetMemory(agentId: string, memoryId: string): Promise<boolean> {
    if (this.ctx.isDisposed) return false
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return false
    const row = this.ctx.deps.repository.getById(memoryId)
    if (!row || row.agent_id !== agentId) return false
    if (row.status === 'archived') return true
    this.ctx.deps.repository.archive(row.id, Date.now())
    if (this.ctx.isDisposed) return true
    this.ports.syncWorkingMemoryAfterMutation(agentId)
    this.ctx.emitChanged(agentId, 'extract')
    return true
  }

  async archiveUserMemory(agentId: string, memoryId: string): Promise<boolean> {
    if (this.ctx.isDisposed) return false
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return false
    const row = this.ctx.deps.repository.getById(memoryId)
    if (!row || row.agent_id !== agentId) return false
    const alreadyArchived = row.status === 'archived'
    if (!alreadyArchived) {
      this.ctx.deps.repository.archive(row.id, Date.now())
      if (!this.ctx.isDisposed) {
        this.ports.syncWorkingMemoryAfterMutation(agentId)
        this.ctx.emitChanged(agentId, 'extract')
      }
    }
    if (this.ctx.isDisposed) return true
    this.ctx.writeAudit(agentId, {
      eventType: 'memory/archive',
      actorType: 'user',
      status: 'completed',
      reason: alreadyArchived ? 'already_archived' : null,
      inputRefs: { memoryId },
      outputRefs: { action: alreadyArchived ? 'already_archived' : 'archived', memoryId }
    })
    return true
  }

  listMemories(agentId: string): AgentMemoryRow[] {
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return []
    return this.ctx.deps.repository.listByAgent(agentId, { includeArchived: true })
  }

  getByIds(agentId: string, memoryIds: string[]): AgentMemoryRow[] {
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return []
    const orderedIds = [...new Set(memoryIds.filter((id) => id.length > 0))]
    const rows = this.ctx.deps.repository.listByIds(agentId, orderedIds)
    const rowsById = new Map(rows.map((row) => [row.id, row]))
    return orderedIds.map((id) => rowsById.get(id)).filter((row): row is AgentMemoryRow => !!row)
  }

  getLifecycle(agentId: string, memoryId: string): MemoryLifecycle | null {
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return null

    const row = this.ctx.deps.repository.getById(memoryId)
    if (!row || row.agent_id !== agentId || row.kind === 'working') return null
    const context = this.createLifecycleDerivationContext(agentId)
    return deriveLifecycle(row, context.now, context.options)
  }

  getArchiveCandidateLifecyclePreview(agentId: string): MemoryArchiveCandidateLifecyclePreview {
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) {
      return {
        lifecycles: [],
        previewLimit: MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_PREVIEW_LIMIT,
        scanLimit: MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_SCAN_LIMIT,
        scanned: 0,
        previewTruncated: false,
        scanTruncated: false
      }
    }

    const context = this.createLifecycleDerivationContext(agentId)
    const rows = this.ctx.deps.repository.listArchiveCandidateLifecycleRows(
      agentId,
      context.now - ARCHIVE_AGE_MS,
      MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_SCAN_LIMIT + 1
    )
    const scanRows = rows.slice(0, MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_SCAN_LIMIT)
    const eligibleLifecycles = scanRows
      .map((row) => deriveLifecycle(row, context.now, context.options))
      .filter((lifecycle) => lifecycle.archiveEligibility.eligible)
      .sort(
        (a, b) =>
          a.forget.decayScore - b.forget.decayScore ||
          b.forget.ageDays - a.forget.ageDays ||
          a.memoryId.localeCompare(b.memoryId)
      )
    const lifecycles = eligibleLifecycles.slice(0, MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_PREVIEW_LIMIT)

    return {
      lifecycles,
      previewLimit: MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_PREVIEW_LIMIT,
      scanLimit: MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_SCAN_LIMIT,
      scanned: scanRows.length,
      previewTruncated:
        eligibleLifecycles.length > MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_PREVIEW_LIMIT,
      scanTruncated: rows.length > MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_SCAN_LIMIT
    }
  }

  private createLifecycleDerivationContext(agentId: string): {
    now: number
    options: DeriveLifecycleOptions
  } {
    const config = this.ctx.deps.resolveAgentConfig(agentId)
    return {
      now: Date.now(),
      options: {
        weights: resolveRetrieval(config?.memoryRetrieval).weights,
        archiveAgeMs: ARCHIVE_AGE_MS,
        archiveDecayThreshold: ARCHIVE_DECAY_THRESHOLD
      }
    }
  }

  getHealth(agentId: string): MemoryHealthDto {
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) {
      return createEmptyMemoryHealth(MEMORY_HEALTH_AUDIT_SCAN_LIMIT)
    }

    const stats = this.ctx.deps.repository.getHealthStats(agentId)
    const embedding = this.ctx.deps.resolveAgentConfig(agentId)?.memoryEmbedding
    let stale = 0
    if (embedding?.providerId && embedding.modelId) {
      const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
      const currentDim = this.ctx.deps.repository.getCurrentEmbeddingDimension(agentId, fingerprint)
      if (currentDim !== null) {
        stale = this.ctx.deps.repository.countStaleEmbeddings(agentId, currentDim, fingerprint)
      }
    }

    const auditStats = this.ctx.deps.auditRepository?.getHealthAuditStats(
      agentId,
      MEMORY_HEALTH_AUDIT_SCAN_LIMIT,
      MEMORY_HEALTH_RECENT_FAILURES_LIMIT
    )
    const topAccessed = this.ctx.deps.repository
      .listTopAccessed(agentId, MEMORY_HEALTH_TOP_ACCESSED_LIMIT)
      .map(toHealthTopAccessedItem)
      .filter((item): item is MemoryHealthDto['access']['topAccessed'][number] => item !== null)

    return {
      totalRows: stats.totalRows,
      byKind: stats.byKind,
      byCategory: stats.byCategory,
      byStatus: stats.byStatus,
      embeddings: {
        pending: stats.byStatus.pending_embedding,
        error: stats.byStatus.error,
        ftsOnly: stats.byStatus.fts_only,
        stale
      },
      lifecycle: {
        archiveCandidates: this.ctx.deps.repository.countArchiveCandidates(
          agentId,
          Date.now() - ARCHIVE_AGE_MS,
          ARCHIVE_DECAY_THRESHOLD
        ),
        archived: stats.byStatus.archived
      },
      conflicts: {
        conflicted: stats.conflicted,
        challenged: stats.challenged
      },
      access: {
        topAccessed,
        neverAccessed: stats.neverAccessed
      },
      quality: {
        importanceAvg: stats.importanceAvg,
        importanceMedian: stats.importanceMedian,
        confidenceAvg: stats.confidenceAvg
      },
      maintenance: {
        completed: auditStats?.completed ?? 0,
        skipped: auditStats?.skipped ?? 0,
        failed: auditStats?.failed ?? 0,
        scanLimit: MEMORY_HEALTH_AUDIT_SCAN_LIMIT,
        recentFailures: auditStats?.recentFailures ?? []
      }
    }
  }

  async deleteMemory(agentId: string, memoryId: string): Promise<boolean> {
    if (this.ctx.isDisposed) return false
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return false
    const row = this.ctx.deps.repository.getById(memoryId)
    if (!row || row.agent_id !== agentId) return false
    this.ctx.deps.repository.delete(memoryId)
    if (row.kind !== 'working') {
      this.ports.syncWorkingMemoryAfterMutation(agentId)
    }
    await this.ports.deleteVectorsForMemoryIds(agentId, [memoryId])
    if (this.ctx.isDisposed) return true
    this.ctx.emitChanged(agentId, 'delete', { memoryId })
    return true
  }

  async clearMemories(agentId: string): Promise<number> {
    if (this.ctx.isDisposed) return 0
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return 0
    const removed = this.ctx.deps.repository.clearByAgent(agentId)
    if (removed > 0) {
      this.ports.syncWorkingMemoryAfterMutation(agentId)
    }
    await this.ports.resetAgentStore(agentId).catch((error) => {
      logger.error(
        `[Memory] vector reset failed for ${agentId}; on-disk store may persist: ${String(error)}`
      )
    })
    if (removed > 0) this.ctx.emitChanged(agentId, 'clear')
    if (removed > 0 && this.ctx.deps.repository.countByAgent(agentId) === 0) {
      this.ports.clearConsolidationCooldown(agentId)
    }
    return removed
  }

  getStatus(agentId: string): MemoryStatus {
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) {
      return { total: 0, pendingEmbedding: 0, hasPersona: false }
    }
    const all = this.ctx.deps.repository.listByAgent(agentId, { includeSuperseded: true })
    return {
      total: all.length,
      pendingEmbedding: all.filter((row) => row.status === 'pending_embedding').length,
      hasPersona: this.ctx.deps.repository.getActivePersona(agentId) !== undefined,
      reindexing: this.ports.isReindexing(agentId)
    }
  }
}
