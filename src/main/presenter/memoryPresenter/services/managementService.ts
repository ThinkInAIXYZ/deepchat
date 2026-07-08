import logger from '@shared/logger'

import {
  MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_PREVIEW_LIMIT,
  MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_SCAN_LIMIT,
  createEmptyMemoryHealth,
  type MemoryArchiveCandidateLifecyclePreview,
  type MemoryHealthDto,
  type MemoryLifecycle,
  type MemoryUpdateResult
} from '@shared/contracts/routes/memory.routes'
import { isAgentMemoryCategory, type AgentMemoryCategory } from '@shared/types/agent-memory'
import { ARCHIVE_AGE_MS, ARCHIVE_DECAY_THRESHOLD } from '../core/lifecycle'
import { deriveLifecycle, type DeriveLifecycleOptions } from '../core/lifecycle'
import { resolveRetrieval } from '../core/scoring'
import {
  MEMORY_HEALTH_AUDIT_SCAN_LIMIT,
  MEMORY_HEALTH_RECENT_FAILURES_LIMIT,
  MEMORY_HEALTH_TOP_ACCESSED_LIMIT
} from '../runtimeConstants'
import type { AgentMemoryRow, MemoryStatus, NormalizedMemoryCandidate } from '../types'
import { embeddingFingerprint, type MemoryRuntimeContext } from '../context'
import { MemoryRowMutations, type ManualEditFieldFlags } from './rowMutations'

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

function isInternalMemoryKind(row: AgentMemoryRow): boolean {
  return row.kind === 'persona' || row.kind === 'working'
}

function hasOwn<T extends object, K extends PropertyKey>(
  object: T,
  key: K
): object is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function clampImportance(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function parseSourceEntryIds(raw: string | null): number[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    const ids = parsed.filter((value): value is number => Number.isInteger(value) && value >= 0)
    return ids.length === parsed.length ? ids : null
  } catch {
    return null
  }
}

function isEditableUserKind(row: AgentMemoryRow): row is AgentMemoryRow & {
  kind: 'episodic' | 'semantic'
} {
  return row.kind === 'episodic' || row.kind === 'semantic'
}

function isEditableUserMemory(
  agentId: string,
  row: AgentMemoryRow | undefined
): row is AgentMemoryRow & { kind: 'episodic' | 'semantic' } {
  return (
    !!row &&
    row.agent_id === agentId &&
    row.superseded_by === null &&
    row.status !== 'archived' &&
    row.status !== 'conflicted' &&
    row.conflict_state !== 'challenged' &&
    isEditableUserKind(row) &&
    !isInternalMemoryKind(row)
  )
}

function isConflictParticipant(row: AgentMemoryRow | undefined): boolean {
  return !!row && (row.status === 'conflicted' || row.conflict_state === 'challenged')
}

function mapContentSuppressedReason(reason: string): 'conflict' | 'duplicate' | 'suppressed' {
  if (reason === 'conflict') return 'conflict'
  if (reason === 'duplicate') return 'duplicate'
  return 'suppressed'
}

type DeleteVectorResult = 'deleted' | 'skipped' | 'unusable'

export class ManagementService {
  constructor(
    private readonly ctx: MemoryRuntimeContext,
    private readonly rows: MemoryRowMutations,
    private readonly ports: {
      deleteVectorsForDeletedMemory: (
        agentId: string,
        memoryIds: string[],
        embedding: { embeddingModel: string | null; embeddingDim: number | null }
      ) => Promise<DeleteVectorResult>
      resetAgentStore: (agentId: string) => Promise<void>
      isReindexing: (agentId: string) => boolean
      reindexEmbeddings: (agentId: string, force?: boolean) => Promise<void>
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
    if (isInternalMemoryKind(row)) return false
    this.ctx.deps.repository.runInTransaction(() => {
      this.ctx.deps.repository.updateStatus(memoryId, 'pending_embedding')
      this.ports.syncWorkingMemoryAfterMutation(agentId)
      this.ctx.writeAudit(agentId, {
        eventType: 'memory/restore',
        actorType: 'user',
        status: 'completed',
        inputRefs: { memoryId },
        outputRefs: { action: 'restored', memoryId }
      })
    })
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
    if (isInternalMemoryKind(row)) return false
    const alreadyArchived = row.status === 'archived'
    this.ctx.deps.repository.runInTransaction(() => {
      if (!alreadyArchived) {
        this.ctx.deps.repository.archive(row.id, Date.now())
        this.ports.syncWorkingMemoryAfterMutation(agentId)
      }
      this.ctx.writeAudit(agentId, {
        eventType: 'memory/forget',
        actorType: 'runtime',
        status: 'completed',
        reason: alreadyArchived ? 'already_archived' : null,
        inputRefs: { memoryId },
        outputRefs: { action: alreadyArchived ? 'already_archived' : 'archived', memoryId }
      })
    })
    if (!alreadyArchived) {
      this.ctx.emitChanged(agentId, 'extract')
    }
    return true
  }

  async archiveUserMemory(agentId: string, memoryId: string): Promise<boolean> {
    if (this.ctx.isDisposed) return false
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return false
    const row = this.ctx.deps.repository.getById(memoryId)
    if (!row || row.agent_id !== agentId) return false
    if (isInternalMemoryKind(row)) return false
    const alreadyArchived = row.status === 'archived'
    this.ctx.deps.repository.runInTransaction(() => {
      if (!alreadyArchived) {
        this.ctx.deps.repository.archive(row.id, Date.now())
        this.ports.syncWorkingMemoryAfterMutation(agentId)
      }
      this.ctx.writeAudit(agentId, {
        eventType: 'memory/archive',
        actorType: 'user',
        status: 'completed',
        reason: alreadyArchived ? 'already_archived' : null,
        inputRefs: { memoryId },
        outputRefs: { action: alreadyArchived ? 'already_archived' : 'archived', memoryId }
      })
    })
    if (!alreadyArchived) {
      this.ctx.emitChanged(agentId, 'extract')
    }
    return true
  }

  listMemories(agentId: string): AgentMemoryRow[] {
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return []
    return this.ctx.deps.repository
      .listByAgent(agentId, { includeArchived: true })
      .filter((row) => !isInternalMemoryKind(row))
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

  updateMemory(
    agentId: string,
    memoryId: string,
    patch: {
      content?: string
      category?: string | null
      importance?: number
    }
  ): MemoryUpdateResult {
    if (this.ctx.isDisposed) return { action: 'noop' }
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.canWriteAgentMemory(agentId)) return { action: 'noop' }
    const row = this.ctx.deps.repository.getById(memoryId)
    if (!isEditableUserMemory(agentId, row)) {
      return { action: 'noop', reason: isConflictParticipant(row) ? 'conflict' : 'not-editable' }
    }

    const hasContent = hasOwn(patch, 'content')
    const nextContent = hasContent ? String(patch.content ?? '').trim() : row.content
    if (hasContent && !nextContent) return { action: 'noop', reason: 'empty' }

    const metadataPatch: { category?: AgentMemoryCategory | null; importance?: number } = {}
    if (hasOwn(patch, 'category')) {
      metadataPatch.category = isAgentMemoryCategory(patch.category) ? patch.category : null
    }
    if (hasOwn(patch, 'importance') && typeof patch.importance === 'number') {
      metadataPatch.importance = clampImportance(patch.importance)
    }

    const contentChanged = hasContent && nextContent !== row.content.trim()
    if (contentChanged) {
      return this.updateMemoryContent(agentId, row, nextContent, metadataPatch)
    }

    const nextMetadata: { category?: string | null; importance?: number } = {}
    if (hasOwn(metadataPatch, 'category') && metadataPatch.category !== row.category) {
      nextMetadata.category = metadataPatch.category
    }
    if (
      hasOwn(metadataPatch, 'importance') &&
      typeof metadataPatch.importance === 'number' &&
      metadataPatch.importance !== row.importance
    ) {
      nextMetadata.importance = metadataPatch.importance
    }
    if (!hasOwn(nextMetadata, 'category') && !hasOwn(nextMetadata, 'importance')) {
      return { action: 'noop', memoryId: row.id }
    }

    this.ctx.deps.repository.runInTransaction(() => {
      this.ctx.deps.repository.updateUserMetadata(row.id, nextMetadata)
      this.ctx.writeAudit(agentId, {
        eventType: 'memory/manual_edit',
        actorType: 'user',
        status: 'completed',
        inputRefs: { memoryId: row.id },
        outputRefs: { action: 'updated', memoryId: row.id }
      })
    })
    this.ports.syncWorkingMemoryAfterMutation(agentId)
    this.ctx.emitChanged(agentId, 'manual-edit', { memoryId: row.id })
    return { action: 'updated', memoryId: row.id }
  }

  private updateMemoryContent(
    agentId: string,
    row: AgentMemoryRow & { kind: 'episodic' | 'semantic' },
    content: string,
    metadataPatch: { category?: AgentMemoryCategory | null; importance?: number }
  ): MemoryUpdateResult {
    const currentCategory = isAgentMemoryCategory(row.category) ? row.category : null
    const categoryProvided = hasOwn(metadataPatch, 'category')
    const importanceProvided =
      hasOwn(metadataPatch, 'importance') && typeof metadataPatch.importance === 'number'
    const nextCategory = categoryProvided ? (metadataPatch.category ?? null) : currentCategory
    const nextImportance = importanceProvided
      ? (metadataPatch.importance as number)
      : row.importance

    const candidate: NormalizedMemoryCandidate = {
      kind: row.kind,
      category: nextCategory,
      content,
      importance: nextImportance
    }
    const providedFields: ManualEditFieldFlags = {
      category: categoryProvided,
      importance: importanceProvided
    }

    // Wrapped in one transaction so the row mutation and its audit event commit atomically, same as
    // the metadata-only path below — a suppressed/noop outcome writes neither.
    const result = this.ctx.deps.repository.runInTransaction((): MemoryUpdateResult => {
      const update = this.rows.applyManualContentEdit(
        agentId,
        row,
        candidate,
        content,
        Date.now(),
        {
          agentId,
          sourceSession: row.source_session,
          userScope: row.user_scope,
          sourceEntryIds: parseSourceEntryIds(row.source_entry_ids)
        },
        providedFields
      )
      if (update.action === 'suppressed') {
        return { action: 'noop', reason: mapContentSuppressedReason(update.reason) }
      }

      const memoryId = update.id
      const outcome: MemoryUpdateResult =
        update.action === 'folded'
          ? { action: 'folded', memoryId, supersededId: row.id }
          : update.action === 'superseded'
            ? { action: 'superseded', memoryId, supersededId: update.supersededId }
            : { action: 'updated', memoryId }

      this.ctx.writeAudit(agentId, {
        eventType: 'memory/manual_edit',
        actorType: 'user',
        status: 'completed',
        inputRefs: { memoryId: row.id },
        outputRefs: outcome
      })
      return outcome
    })

    if (result.action === 'noop') return result

    this.ports.syncWorkingMemoryAfterMutation(agentId)
    this.ctx.emitChanged(agentId, 'manual-edit', { memoryId: result.memoryId })
    if (result.action !== 'folded') {
      void this.ports.triggerEmbedding(agentId).catch((error) => {
        logger.warn(`[Memory] background embedding failed: ${String(error)}`)
      })
    }
    return result
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
    const deleteResult = await this.ports.deleteVectorsForDeletedMemory(agentId, [memoryId], {
      embeddingModel: row.embedding_model,
      embeddingDim: row.embedding_dim
    })
    if (deleteResult === 'unusable' && !this.ports.isReindexing(agentId)) {
      void this.ports.reindexEmbeddings(agentId, true).catch((error) => {
        logger.warn(`[Memory] store rebuild after delete failed for ${agentId}: ${String(error)}`)
      })
    }
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
      return {
        total: 0,
        pendingEmbedding: 0,
        hasPersona: false,
        activeMemoryCount: 0,
        archivedMemoryCount: 0,
        conflictCount: 0,
        personaDraftCount: 0,
        personaVersionCount: 0
      }
    }
    const counts = this.ctx.deps.repository.countStatusView(agentId)
    const personaCounts = this.ctx.deps.repository.getPersonaCounts(agentId)
    return {
      total: counts.total,
      pendingEmbedding: counts.pendingEmbedding,
      hasPersona: this.ctx.deps.repository.getActivePersona(agentId) !== undefined,
      activeMemoryCount: counts.activeMemoryCount,
      archivedMemoryCount: counts.archivedMemoryCount,
      conflictCount: this.ctx.deps.repository.countConflictPairs(agentId),
      personaDraftCount: personaCounts.draft,
      personaVersionCount: personaCounts.total,
      reindexing: this.ports.isReindexing(agentId)
    }
  }
}
