import logger from '@shared/logger'

import {
  MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_PREVIEW_LIMIT,
  MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_SCAN_LIMIT,
  MEMORY_PAGE_DEFAULT_LIMIT,
  MEMORY_PAGE_MAX_LIMIT,
  createEmptyMemoryHealth,
  type MemoryArchiveCandidateLifecyclePreview,
  type MemoryHealthDto,
  type MemoryLifecycle,
  type MemoryRuntimeDiagnosticsDto,
  type MemoryUpdateResult
} from '@shared/contracts/routes/memory.routes'
import {
  AGENT_MEMORY_MANUAL_CONTENT_MAX_CHARS,
  isAgentMemoryCategory,
  type AgentMemoryCategory
} from '@shared/types/agent-memory'
import { parseAgentMemorySourceEntryIds } from '@shared/lib/agentMemoryLineage'
import { unicodeCodePointLength } from '@shared/lib/unicodeText'
import { ARCHIVE_AGE_MS, ARCHIVE_DECAY_THRESHOLD } from '../core/lifecycle'
import { deriveLifecycle, type DeriveLifecycleOptions } from '../core/lifecycle'
import { resolveRetrieval } from '../core/scoring'
import {
  MEMORY_HEALTH_AUDIT_SCAN_LIMIT,
  MEMORY_HEALTH_RECENT_FAILURES_LIMIT,
  MEMORY_HEALTH_TOP_ACCESSED_LIMIT
} from '../runtimeConstants'
import type {
  AgentMemoryRow,
  MemoryManagementPage,
  MemoryManagementPageCursor,
  MemoryStatus,
  NormalizedMemoryCandidate
} from '../types'
import type { ManualEditFieldFlags } from '../domain/types'
import { FORGET_HALF_LIFE_MS } from '../types'
import { embeddingFingerprint, type MemoryRuntimeContext } from '../context'
import type {
  MemoryAgentPolicyPort,
  MemoryAuditReadPort,
  MemoryEmbeddingRepositoryPort,
  MemoryHealthRepositoryPort,
  MemoryLifecycleRepositoryPort,
  MemoryManualEditPort,
  MemoryMutationRepositoryPort,
  MemoryReadRepositoryPort,
  MemoryTransactionPort
} from '../ports'

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
    row.lifecycle_state === 'active' &&
    row.conflict_state !== 'challenged' &&
    isEditableUserKind(row) &&
    !isInternalMemoryKind(row)
  )
}

function isConflictParticipant(row: AgentMemoryRow | undefined): boolean {
  return !!row && (row.lifecycle_state === 'conflicted' || row.conflict_state === 'challenged')
}

function mapContentSuppressedReason(reason: string): 'conflict' | 'duplicate' | 'suppressed' {
  if (reason === 'conflict') return 'conflict'
  if (reason === 'duplicate') return 'duplicate'
  return 'suppressed'
}

type DeleteVectorResult = 'deleted' | 'skipped' | 'unusable'

export class ManagementService {
  private readonly ctx: MemoryRuntimeContext

  constructor(
    private readonly ports: {
      ctx: MemoryRuntimeContext
      repository: MemoryReadRepositoryPort &
        MemoryMutationRepositoryPort &
        MemoryEmbeddingRepositoryPort &
        MemoryLifecycleRepositoryPort &
        MemoryHealthRepositoryPort &
        MemoryTransactionPort
      policy: MemoryAgentPolicyPort
      auditReader?: MemoryAuditReadPort
      rows: MemoryManualEditPort
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
      getRuntimeDiagnostics: (agentId: string) => MemoryRuntimeDiagnosticsDto
    }
  ) {
    this.ctx = ports.ctx
  }

  restoreMemory(agentId: string, memoryId: string): boolean {
    if (this.ctx.isDisposed) return false
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.canWriteAgentMemory(agentId)) return false
    const row = this.ports.repository.getById(memoryId)
    if (!row || row.agent_id !== agentId || row.lifecycle_state !== 'archived') return false
    if (this.ports.repository.isUnresolvedConflictParticipant(agentId, memoryId)) return false
    if (isInternalMemoryKind(row)) return false
    let restored = false
    this.ports.repository.runInTransaction(() => {
      restored = this.ports.repository.restoreArchivedMemory({
        agentId,
        id: memoryId,
        expectedRevision: row.decision_revision
      })
      if (!restored) return
      this.ctx.writeAudit(agentId, {
        eventType: 'memory/restore',
        actorType: 'user',
        status: 'completed',
        inputRefs: { memoryId },
        outputRefs: { action: 'restored', memoryId }
      })
    })
    if (!restored) return false
    this.ctx.markDomainMutationCommitted(agentId)
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
    const row = this.ports.repository.getById(memoryId)
    if (!row || row.agent_id !== agentId) return false
    if (this.ports.repository.isUnresolvedConflictParticipant(agentId, memoryId)) return false
    if (isInternalMemoryKind(row)) return false
    this.ctx.invalidateAgentOperations(agentId)
    const alreadyArchived = row.lifecycle_state === 'archived'
    let archived = alreadyArchived
    this.ports.repository.runInTransaction(() => {
      if (!alreadyArchived) {
        archived = this.ports.repository.archiveActiveMemory({
          agentId,
          id: row.id,
          expectedRevision: row.decision_revision
        })
        if (!archived) return
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
    if (!archived) return false
    if (!alreadyArchived) {
      this.ctx.markDomainMutationCommitted(agentId)
      this.ports.syncWorkingMemoryAfterMutation(agentId)
      this.ctx.emitChanged(agentId, 'extract')
    }
    return true
  }

  async archiveUserMemory(agentId: string, memoryId: string): Promise<boolean> {
    if (this.ctx.isDisposed) return false
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return false
    const row = this.ports.repository.getById(memoryId)
    if (!row || row.agent_id !== agentId) return false
    if (this.ports.repository.isUnresolvedConflictParticipant(agentId, memoryId)) return false
    if (isInternalMemoryKind(row)) return false
    this.ctx.invalidateAgentOperations(agentId)
    const alreadyArchived = row.lifecycle_state === 'archived'
    let archived = alreadyArchived
    this.ports.repository.runInTransaction(() => {
      if (!alreadyArchived) {
        archived = this.ports.repository.archiveActiveMemory({
          agentId,
          id: row.id,
          expectedRevision: row.decision_revision
        })
        if (!archived) return
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
    if (!archived) return false
    if (!alreadyArchived) {
      this.ctx.markDomainMutationCommitted(agentId)
      this.ports.syncWorkingMemoryAfterMutation(agentId)
      this.ctx.emitChanged(agentId, 'extract')
    }
    return true
  }

  /** @deprecated Use pageMemories for bounded management reads. */
  listMemories(agentId: string): AgentMemoryRow[] {
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return []
    return this.ports.repository
      .listByAgent(agentId, { includeArchived: true })
      .filter((row) => !isInternalMemoryKind(row))
  }

  pageMemories(
    agentId: string,
    cursor: MemoryManagementPageCursor | null,
    limit: number
  ): MemoryManagementPage {
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return { rows: [], nextCursor: null }
    const normalizedLimit = Number.isFinite(limit)
      ? Math.min(MEMORY_PAGE_MAX_LIMIT, Math.max(1, Math.floor(limit)))
      : MEMORY_PAGE_DEFAULT_LIMIT
    const rows = this.ports.repository.listManagementPage(agentId, cursor, normalizedLimit + 1)
    const pageRows = rows.slice(0, normalizedLimit)
    const lastRow = pageRows.at(-1)
    return {
      rows: pageRows,
      nextCursor:
        rows.length > normalizedLimit && lastRow
          ? { createdAt: lastRow.created_at, id: lastRow.id }
          : null
    }
  }

  getByIds(agentId: string, memoryIds: string[]): AgentMemoryRow[] {
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return []
    const orderedIds = [...new Set(memoryIds.filter((id) => id.length > 0))]
    const rows = this.ports.repository.listByIds(agentId, orderedIds)
    const rowsById = new Map(rows.map((row) => [row.id, row]))
    return orderedIds.map((id) => rowsById.get(id)).filter((row): row is AgentMemoryRow => !!row)
  }

  getManagementVisibleByIds(agentId: string, memoryIds: string[]): AgentMemoryRow[] {
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return []
    const orderedIds = [...new Set(memoryIds.filter((id) => id.length > 0))]
    const rows = this.ports.repository.listManagementVisibleByIds(agentId, orderedIds)
    const rowsById = new Map(rows.map((row) => [row.id, row]))
    return orderedIds.map((id) => rowsById.get(id)).filter((row): row is AgentMemoryRow => !!row)
  }

  getLifecycle(agentId: string, memoryId: string): MemoryLifecycle | null {
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return null

    const row = this.ports.repository.getById(memoryId)
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
    const rows = this.ports.repository.listArchiveCandidateLifecycleRows(
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
    const config = this.ports.policy.resolveAgentConfig(agentId)
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
      const health = createEmptyMemoryHealth(MEMORY_HEALTH_AUDIT_SCAN_LIMIT)
      health.runtime = this.ports.getRuntimeDiagnostics(agentId)
      return health
    }

    const stats = this.ports.repository.getHealthStats(agentId)
    const embedding = this.ports.policy.resolveAgentConfig(agentId)?.memoryEmbedding
    let stale = 0
    if (embedding?.providerId && embedding.modelId) {
      const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
      const currentDim = this.ports.repository.getCurrentEmbeddingDimension(agentId, fingerprint)
      if (currentDim !== null) {
        stale = this.ports.repository.countStaleEmbeddings(agentId, currentDim, fingerprint)
      }
    }

    const auditStats = this.ports.auditReader?.getHealthAuditStats(
      agentId,
      MEMORY_HEALTH_AUDIT_SCAN_LIMIT,
      MEMORY_HEALTH_RECENT_FAILURES_LIMIT
    )
    const topAccessed = this.ports.repository
      .listTopAccessed(agentId, MEMORY_HEALTH_TOP_ACCESSED_LIMIT)
      .map(toHealthTopAccessedItem)
      .filter((item): item is MemoryHealthDto['access']['topAccessed'][number] => item !== null)

    const now = Date.now()
    const minimumBaseAgeMs =
      FORGET_HALF_LIFE_MS * (Math.log(ARCHIVE_DECAY_THRESHOLD) / Math.log(0.5))
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
        archiveCandidates: this.ports.repository.countArchiveEligible(agentId, {
          now,
          createdBefore: now - ARCHIVE_AGE_MS,
          minimumBaseAgeMs
        }),
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
      },
      runtime: this.ports.getRuntimeDiagnostics(agentId)
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
    const row = this.ports.repository.getById(memoryId)
    if (
      row?.agent_id === agentId &&
      this.ports.repository.isUnresolvedConflictParticipant(agentId, memoryId)
    ) {
      return { action: 'noop', reason: 'conflict' }
    }
    if (!isEditableUserMemory(agentId, row)) {
      return { action: 'noop', reason: isConflictParticipant(row) ? 'conflict' : 'not-editable' }
    }

    const hasContent = hasOwn(patch, 'content')
    if (
      hasContent &&
      typeof patch.content === 'string' &&
      unicodeCodePointLength(patch.content) > AGENT_MEMORY_MANUAL_CONTENT_MAX_CHARS
    ) {
      return { action: 'noop', reason: 'content-too-large' }
    }
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

    const updated = this.ports.repository.runInTransaction(() => {
      if (
        !this.ports.repository.updateUserMetadataIfRevision({
          agentId,
          id: row.id,
          expectedRevision: row.decision_revision,
          ...nextMetadata
        })
      ) {
        return false
      }
      this.ctx.writeAudit(agentId, {
        eventType: 'memory/manual_edit',
        actorType: 'user',
        status: 'completed',
        inputRefs: { memoryId: row.id },
        outputRefs: { action: 'updated', memoryId: row.id }
      })
      return true
    })
    if (!updated) return { action: 'noop', reason: 'suppressed' }
    this.ctx.markDomainMutationCommitted(agentId)
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
    const result = this.ports.repository.runInTransaction((): MemoryUpdateResult => {
      const update = this.ports.rows.applyManualContentEdit(
        agentId,
        row,
        candidate,
        content,
        Date.now(),
        {
          agentId,
          sourceSession: row.source_session,
          userScope: row.user_scope,
          sourceEntryIds: parseAgentMemorySourceEntryIds(row.source_entry_ids)
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

    this.ctx.markDomainMutationCommitted(agentId)
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
    const row = this.ports.repository.getById(memoryId)
    if (!row || row.agent_id !== agentId) return false
    if (this.ports.repository.isUnresolvedConflictParticipant(agentId, memoryId)) return false
    this.ctx.invalidateAgentOperations(agentId)
    this.ports.repository.delete(memoryId)
    this.ctx.markDomainMutationCommitted(agentId)
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
    this.ctx.invalidateAgentOperations(agentId)
    const removed = this.ports.repository.clearByAgent(agentId)
    if (removed > 0) {
      this.ctx.markDomainMutationCommitted(agentId)
      this.ports.syncWorkingMemoryAfterMutation(agentId)
    }
    await this.ports.resetAgentStore(agentId).catch((error) => {
      logger.error(
        `[Memory] vector reset failed for ${agentId}; on-disk store may persist: ${String(error)}`
      )
    })
    if (removed > 0) this.ctx.emitChanged(agentId, 'clear')
    if (removed > 0 && this.ports.repository.countByAgent(agentId) === 0) {
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
    const counts = this.ports.repository.countStatusView(agentId)
    const personaCounts = this.ports.repository.getPersonaCounts(agentId)
    return {
      total: counts.total,
      pendingEmbedding: counts.pendingEmbedding,
      hasPersona: this.ports.repository.getActivePersona(agentId) !== undefined,
      activeMemoryCount: counts.activeMemoryCount,
      archivedMemoryCount: counts.archivedMemoryCount,
      conflictCount: this.ports.repository.countConflictPairs(agentId),
      personaDraftCount: personaCounts.draft,
      personaVersionCount: personaCounts.total,
      reindexing: this.ports.isReindexing(agentId)
    }
  }
}
