import { vi } from 'vitest'

import { MemoryService } from '@/memory'
import {
  AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT,
  AGENT_MEMORY_CATEGORIES,
  AGENT_MEMORY_HEALTH_KIND_KEYS,
  AGENT_MEMORY_HEALTH_STATUS_KEYS,
  isAgentMemoryCategory
} from '@shared/types/agent-memory'
import type {
  AgentMemoryAuditInsertInput,
  AgentMemoryAuditRow,
  AgentMemoryHealthStats,
  AgentMemoryInsertInput,
  AgentMemoryLifecycleRow,
  AgentMemoryWorkingCandidateCursor,
  IMemoryVectorStore,
  MemoryAuditListOptions,
  MemoryAuditRepositoryPort,
  MemoryDirectiveRepositoryPort,
  MemoryClearBatchResult,
  MemoryClearJob,
  MemoryRepositoryPort,
  MemoryScope,
  MemoryServiceDeps,
  MemoryVectorMatch,
  MemoryVectorRecord
} from '@/memory/types'
import type { AgentMemoryHealthAuditStats } from '@/memory/domain/audit'
import type {
  MemoryAccessRepositoryPort,
  MemoryEmbeddingRepositoryPort,
  MemoryHealthRepositoryPort,
  MemoryDirtyRepositoryPort,
  MemoryLifecycleRepositoryPort,
  MemoryLineageRepositoryPort,
  MemoryMutationRepositoryPort,
  MemoryReadRepositoryPort,
  MemoryTransactionPort
} from '@/memory/ports'
import type {
  AgentMemoryDirectiveRow,
  MemoryDirectiveCounts,
  MemoryDirectiveInsertResult,
  MemoryDirectiveTransitionResult,
  MemoryDirectiveWriteInput,
  MemoryDirectiveWriteResult
} from '@/memory/domain/directives'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'
import { normalizeMemoryTemporalMetadata, temporalMetadataFromRow } from '@/memory/core/temporal'
import {
  buildMemoryTombstoneIdentities,
  isTombstoneEligibleMemoryKind
} from '@/memory/core/tombstone'
import {
  assertValidMemoryInsertState,
  deriveCanonicalStateFromLegacy,
  projectLegacyStatus
} from '@/memory/domain/stateModel'
import type {
  AgentMemoryEmbeddingState,
  AgentMemoryDerivationRow,
  AgentMemoryRow,
  InternalMemoryInsertInput,
  MemoryTemporalMetadata,
  MemoryClaimContentUpdateResult,
  MemoryDerivationInsertInput,
  MemoryDirtySeed,
  MemoryTombstoneDeleteInput,
  MemoryTombstoneIdentityKind,
  MemoryTombstoneReason,
  ResolveChallengerTransition
} from '@/memory/domain/types'
import {
  AGENT_MEMORY_AGENT_SCOPE_FILTER,
  legacyUserScopeForMemoryScope,
  memoryScopeFromRow,
  normalizeMemoryScope,
  normalizeMemoryScopeFilter,
  rowMatchesMemoryScopeFilter,
  rowsShareMemoryScope
} from '@/memory/core/scope'

class MemoryRowMap extends Map<string, AgentMemoryRow> {
  override set(key: string, row: AgentMemoryRow): this {
    row.scope_type ??= 'agent'
    row.scope_id ??= null
    if (row.lifecycle_state === undefined || row.embedding_state === undefined) {
      const state = deriveCanonicalStateFromLegacy(row)
      row.lifecycle_state = state.lifecycleState
      row.embedding_state = state.embeddingState
      row.status = projectLegacyStatus(state.lifecycleState, state.embeddingState)
    }
    return super.set(key, row)
  }
}

function toLifecycleRow(row: AgentMemoryRow): AgentMemoryLifecycleRow {
  return {
    id: row.id,
    agent_id: row.agent_id,
    kind: row.kind,
    importance: row.importance,
    lifecycle_state: row.lifecycle_state,
    embedding_state: row.embedding_state,
    is_anchor: row.is_anchor,
    superseded_by: row.superseded_by,
    created_at: row.created_at,
    last_accessed: row.last_accessed,
    access_count: row.access_count,
    decay_score: row.decay_score,
    confidence: row.confidence,
    conflict_state: row.conflict_state
  }
}

// In-memory stand-in for the SQLite-backed repository. Mirrors the authoritative table's observable
// behavior (provenance uniqueness, supersede/persona state machine, archive/decay) closely enough to
// exercise the presenter without a native database.
class FakeRepositoryBehavior implements MemoryRepositoryPort {
  rows = new MemoryRowMap()
  derivations = new Map<string, AgentMemoryDerivationRow>()
  dirtySeeds = new Map<string, MemoryDirtySeed & { agentId: string }>()
  tombstones = new Map<
    string,
    {
      agentId: string
      identityKind: MemoryTombstoneIdentityKind
      identityHash: string
      createdAt: number
      reason: MemoryTombstoneReason
    }
  >()
  clearJobs = new Map<string, MemoryClearJob>()
  private clearJobMemoryIds = new Map<string, string[]>()
  transactionCalls = 0

  private derivationKey(input: {
    agentId: string
    parentMemoryId: string
    childMemoryId: string
    derivationKind: string
  }): string {
    return JSON.stringify([
      input.agentId,
      input.parentMemoryId,
      input.childMemoryId,
      input.derivationKind
    ])
  }

  private dirtyKey(agentId: string, memoryId: string): string {
    return JSON.stringify([agentId, memoryId])
  }

  private touchDirty(row: AgentMemoryRow): void {
    if (row.kind !== 'episodic' && row.kind !== 'semantic' && row.kind !== 'reflection') return
    const key = this.dirtyKey(row.agent_id, row.id)
    const existing = this.dirtySeeds.get(key)
    this.dirtySeeds.set(key, {
      agentId: row.agent_id,
      memoryId: row.id,
      generation: (existing?.generation ?? 0) + 1,
      claimRevision: Math.max(1, row.decision_revision),
      enqueuedAt: Math.max(existing?.enqueuedAt ?? 0, row.last_accessed ?? row.created_at)
    })
  }

  private getBookkeepingWritableRow(id: string): AgentMemoryRow | undefined {
    const row = this.rows.get(id)
    return row && !this.clearJobs.has(row.agent_id) ? row : undefined
  }

  private tombstoneKey(
    agentId: string,
    identityKind: MemoryTombstoneIdentityKind,
    identityHash: string
  ): string {
    return `${agentId}\0${identityKind}\0${identityHash}`
  }

  private addTombstonesForRow(
    row: AgentMemoryRow,
    createdAt: number,
    reason: MemoryTombstoneReason
  ): void {
    if (!isTombstoneEligibleMemoryKind(row.kind)) return
    for (const identity of buildMemoryTombstoneIdentities({
      agentId: row.agent_id,
      content: row.content,
      provenanceKey: row.provenance_key,
      scope: memoryScopeFromRow(row)
    })) {
      const key = this.tombstoneKey(row.agent_id, identity.identityKind, identity.identityHash)
      if (this.tombstones.has(key)) continue
      this.tombstones.set(key, {
        agentId: row.agent_id,
        identityKind: identity.identityKind,
        identityHash: identity.identityHash,
        createdAt,
        reason
      })
    }
  }

  hasTombstoneForClaim(
    input: Pick<AgentMemoryInsertInput, 'agentId' | 'kind' | 'content' | 'provenanceKey' | 'scope'>
  ): boolean {
    if (!isTombstoneEligibleMemoryKind(input.kind)) return false
    return buildMemoryTombstoneIdentities({
      agentId: input.agentId,
      content: input.content,
      provenanceKey: input.provenanceKey ?? null,
      scope: normalizeMemoryScope(input.scope)
    }).some((identity) =>
      this.tombstones.has(
        this.tombstoneKey(input.agentId, identity.identityKind, identity.identityHash)
      )
    )
  }

  insert(input: AgentMemoryInsertInput): AgentMemoryRow {
    if (this.clearJobs.has(input.agentId)) {
      throw new Error('agent memory clear in progress')
    }
    if ((input.lifecycleState === undefined) !== (input.embeddingState === undefined)) {
      throw new Error('Memory inserts must provide both canonical state fields or neither')
    }
    if (input.provenanceKey) {
      for (const row of this.rows.values()) {
        if (row.agent_id === input.agentId && row.provenance_key === input.provenanceKey) {
          throw new Error('UNIQUE constraint failed')
        }
      }
    }
    const legacyStatus = input.status ?? 'pending_embedding'
    const canonicalState =
      input.lifecycleState && input.embeddingState
        ? { lifecycleState: input.lifecycleState, embeddingState: input.embeddingState }
        : deriveCanonicalStateFromLegacy({ status: legacyStatus, kind: input.kind })
    if (input.lifecycleState !== undefined && input.embeddingState !== undefined) {
      assertValidMemoryInsertState({
        kind: input.kind,
        lifecycleState: canonicalState.lifecycleState,
        embeddingState: canonicalState.embeddingState,
        conflictWith: input.conflictWith ?? null
      })
    }
    const temporal = normalizeMemoryTemporalMetadata(input.temporal)
    const scope = normalizeMemoryScope(input.scope)
    const row: AgentMemoryRow = {
      id: input.id,
      agent_id: input.agentId,
      user_scope: legacyUserScopeForMemoryScope(scope),
      scope_type: scope.type,
      scope_id: scope.type === 'agent' ? null : scope.id,
      kind: input.kind,
      category: input.category ?? null,
      content: input.content,
      importance: input.importance ?? 0.5,
      status: projectLegacyStatus(canonicalState.lifecycleState, canonicalState.embeddingState),
      lifecycle_state: canonicalState.lifecycleState,
      embedding_state: canonicalState.embeddingState,
      embedding_id: null,
      embedding_dim: null,
      embedding_model: null,
      source_session: input.sourceSession ?? null,
      provenance_key: input.provenanceKey ?? null,
      is_anchor: input.isAnchor ? 1 : 0,
      superseded_by: null,
      created_at: input.createdAt ?? 1000,
      last_accessed: null,
      access_count: 0,
      decay_score: null,
      source_entry_ids: input.sourceEntryIds?.length ? JSON.stringify(input.sourceEntryIds) : null,
      confidence: null,
      temporal_kind: temporal.temporalKind,
      valid_from: temporal.validFrom,
      valid_until: temporal.validUntil,
      temporal_confidence: temporal.temporalConfidence,
      temporal_precision: temporal.temporalPrecision,
      temporal_timezone: temporal.temporalTimeZone,
      last_consolidated_at: null,
      conflict_state: null,
      conflict_with: input.conflictWith ?? null,
      persona_state: input.personaState ?? null,
      decision_revision: 1
    }
    this.rows.set(row.id, row)
    this.touchDirty(row)
    return row
  }

  insertInternalMemory(input: InternalMemoryInsertInput): AgentMemoryRow {
    if (input.kind !== 'persona' && input.kind !== 'working') {
      throw new Error(`[Memory] unsupported internal memory kind: ${String(input.kind)}`)
    }
    return this.insert(input)
  }

  insertClaimUnlessTombstoned(input: AgentMemoryInsertInput): AgentMemoryRow | null {
    if (this.hasTombstoneForClaim(input)) return null
    return this.insert(input)
  }

  insertExplicitlyReauthorizedClaim(input: AgentMemoryInsertInput): AgentMemoryRow | null {
    return this.runInTransaction(() => {
      if (!isTombstoneEligibleMemoryKind(input.kind)) return null
      const identities = buildMemoryTombstoneIdentities({
        agentId: input.agentId,
        content: input.content,
        provenanceKey: input.provenanceKey ?? null,
        scope: normalizeMemoryScope(input.scope)
      })
      const matchingKeys = identities
        .map((identity) =>
          this.tombstoneKey(input.agentId, identity.identityKind, identity.identityHash)
        )
        .filter((key) => this.tombstones.has(key))
      if (matchingKeys.length === 0) return null
      for (const key of matchingKeys) this.tombstones.delete(key)
      return this.insert(input)
    })
  }

  insertDerivations(inputs: readonly MemoryDerivationInsertInput[]): number {
    let inserted = 0
    for (const input of inputs) {
      if (input.parentMemoryId === input.childMemoryId) continue
      const key = this.derivationKey(input)
      if (this.derivations.has(key)) continue
      this.derivations.set(key, {
        agent_id: input.agentId,
        parent_memory_id: input.parentMemoryId,
        child_memory_id: input.childMemoryId,
        derivation_kind: input.derivationKind,
        created_at: input.createdAt
      })
      inserted += 1
    }
    return inserted
  }

  listDerivationsByChild(agentId: string, childMemoryId: string) {
    return [...this.derivations.values()]
      .filter(
        (row) =>
          row.agent_id === agentId &&
          row.child_memory_id === childMemoryId &&
          row.parent_memory_id !== row.child_memory_id
      )
      .sort(
        (left, right) =>
          left.created_at - right.created_at ||
          left.parent_memory_id.localeCompare(right.parent_memory_id) ||
          left.derivation_kind.localeCompare(right.derivation_kind)
      )
  }

  listDerivationsByParent(agentId: string, parentMemoryId: string) {
    return [...this.derivations.values()]
      .filter(
        (row) =>
          row.agent_id === agentId &&
          row.parent_memory_id === parentMemoryId &&
          row.parent_memory_id !== row.child_memory_id
      )
      .sort(
        (left, right) =>
          left.created_at - right.created_at ||
          left.child_memory_id.localeCompare(right.child_memory_id) ||
          left.derivation_kind.localeCompare(right.derivation_kind)
      )
  }

  listDirtySeeds(agentId: string, limit: number): MemoryDirtySeed[] {
    const cappedLimit = Number.isFinite(limit)
      ? Math.min(256, Math.max(0, Math.floor(limit)))
      : limit === Number.POSITIVE_INFINITY
        ? 256
        : 0
    return [...this.dirtySeeds.values()]
      .filter((seed) => seed.agentId === agentId)
      .sort(
        (left, right) =>
          left.enqueuedAt - right.enqueuedAt || left.memoryId.localeCompare(right.memoryId)
      )
      .slice(0, cappedLimit)
      .map(({ memoryId, generation, claimRevision, enqueuedAt }) => ({
        memoryId,
        generation,
        claimRevision,
        enqueuedAt
      }))
  }

  settleDirtySeeds(agentId: string, seeds: readonly MemoryDirtySeed[]): number {
    let removed = 0
    const unique = [
      ...new Map(
        seeds.map((seed) => [JSON.stringify([seed.memoryId, seed.generation]), seed] as const)
      ).values()
    ].slice(0, 256)
    for (const seed of unique) {
      const key = this.dirtyKey(agentId, seed.memoryId)
      if (this.dirtySeeds.get(key)?.generation !== seed.generation) continue
      this.dirtySeeds.delete(key)
      removed += 1
    }
    return removed
  }

  deferDirtySeeds(agentId: string, seeds: readonly MemoryDirtySeed[], deferredAt: number): number {
    if (!Number.isFinite(deferredAt)) return 0
    let deferred = 0
    const normalizedDeferredAt = Math.max(0, Math.floor(deferredAt))
    const unique = [
      ...new Map(
        seeds.map((seed) => [JSON.stringify([seed.memoryId, seed.generation]), seed] as const)
      ).values()
    ].slice(0, 256)
    let latestEnqueuedAt = -1
    for (const queued of this.dirtySeeds.values()) {
      if (queued.agentId === agentId) {
        latestEnqueuedAt = Math.max(latestEnqueuedAt, queued.enqueuedAt)
      }
    }
    for (const seed of unique) {
      const key = this.dirtyKey(agentId, seed.memoryId)
      const current = this.dirtySeeds.get(key)
      if (!current || current.generation !== seed.generation) continue
      current.enqueuedAt = Math.max(latestEnqueuedAt + 1, normalizedDeferredAt)
      latestEnqueuedAt = current.enqueuedAt
      deferred += 1
    }
    return deferred
  }

  countDirtySeeds(agentId: string): number {
    return [...this.dirtySeeds.values()].filter((seed) => seed.agentId === agentId).length
  }

  getById(id: string) {
    return this.rows.get(id)
  }

  getByProvenanceKey(agentId: string, provenanceKey: string) {
    return [...this.rows.values()].find(
      (row) => row.agent_id === agentId && row.provenance_key === provenanceKey
    )
  }

  rekeyProvenance(agentId: string, id: string, expectedKey: string, nextKey: string) {
    const row = this.rows.get(id)
    if (!row || row.agent_id !== agentId || row.provenance_key !== expectedKey) return false
    for (const candidate of this.rows.values()) {
      if (
        candidate.id !== id &&
        candidate.agent_id === agentId &&
        candidate.provenance_key === nextKey
      ) {
        throw new Error('UNIQUE constraint failed')
      }
    }
    row.provenance_key = nextKey
    return true
  }

  listByAgent(
    agentId: string,
    options?: {
      kinds?: AgentMemoryRow['kind'][]
      includeSuperseded?: boolean
      includeArchived?: boolean
      statuses?: AgentMemoryRow['status'][]
      limit?: number
    }
  ) {
    let result = [...this.rows.values()].filter(
      (row) =>
        row.agent_id === agentId &&
        (options?.includeSuperseded || !row.superseded_by) &&
        (options?.includeArchived ||
          options?.statuses?.includes('archived') ||
          row.status !== 'archived') &&
        (options?.statuses?.includes('conflicted') || row.status !== 'conflicted') &&
        (!options?.statuses?.length || options.statuses.includes(row.status))
    )
    if (options?.kinds?.length) result = result.filter((row) => options.kinds!.includes(row.kind))
    else result = result.filter((row) => row.kind !== 'working')
    result.sort((a, b) => b.created_at - a.created_at)
    const limit = options?.limit
    if (typeof limit === 'number' && Number.isFinite(limit)) {
      result = result.slice(0, Math.max(1, Math.floor(limit)))
    }
    return result
  }

  listManagementPage(
    agentId: string,
    cursor: { createdAt: number; id: string } | null,
    limit: number
  ) {
    return this.listByAgent(agentId, { includeArchived: true })
      .filter((row) => row.kind !== 'persona')
      .filter(
        (row) =>
          cursor === null ||
          row.created_at < cursor.createdAt ||
          (row.created_at === cursor.createdAt && row.id < cursor.id)
      )
      .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
      .slice(0, Math.max(1, Math.floor(limit)))
  }

  listManagementVisibleByIds(agentId: string, ids: string[]) {
    const idSet = new Set(ids)
    return [...this.rows.values()].filter(
      (row) =>
        row.agent_id === agentId &&
        idSet.has(row.id) &&
        row.superseded_by === null &&
        row.status !== 'conflicted' &&
        row.kind !== 'persona' &&
        row.kind !== 'working'
    )
  }

  listByIds(agentId: string, ids: string[]) {
    const idSet = new Set(ids)
    return [...this.rows.values()].filter((row) => row.agent_id === agentId && idSet.has(row.id))
  }

  listApplicableByIds(
    agentId: string,
    ids: string[],
    scopeFilter: readonly MemoryScope[] = AGENT_MEMORY_AGENT_SCOPE_FILTER
  ) {
    const idSet = new Set(ids)
    const scopes = normalizeMemoryScopeFilter(scopeFilter)
    return [...this.rows.values()].filter(
      (row) =>
        row.agent_id === agentId && idSet.has(row.id) && rowMatchesMemoryScopeFilter(row, scopes)
    )
  }

  getCognitiveMaintenanceInput(
    agentId: string,
    options: { kinds: AgentMemoryRow['kind'][]; watermark: number; limit: number }
  ) {
    const eligible = [...this.rows.values()].filter(
      (row) =>
        row.agent_id === agentId &&
        row.scope_type === 'agent' &&
        row.scope_id === null &&
        row.superseded_by === null &&
        row.status !== 'archived' &&
        row.status !== 'conflicted' &&
        options.kinds.includes(row.kind)
    )
    return {
      eligibleCount: eligible.length,
      importanceAfterWatermark: eligible
        .filter((row) => row.created_at > options.watermark)
        .reduce((sum, row) => sum + Math.min(1, Math.max(0, row.importance)), 0),
      maxCreatedAt: eligible.reduce((max, row) => Math.max(max, row.created_at), 0),
      topRows: eligible
        .slice()
        .sort(
          (a, b) =>
            b.importance - a.importance || b.created_at - a.created_at || b.id.localeCompare(a.id)
        )
        .slice(0, Math.max(0, Math.floor(options.limit)))
    }
  }

  getActivePersona(agentId: string) {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.agent_id === agentId &&
          row.scope_type === 'agent' &&
          row.scope_id === null &&
          row.kind === 'persona' &&
          (row.persona_state === 'active' ||
            (row.persona_state == null && row.superseded_by === null))
      )
      .sort((a, b) => b.created_at - a.created_at)[0]
  }

  getDraftPersona(agentId: string) {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.agent_id === agentId &&
          row.scope_type === 'agent' &&
          row.scope_id === null &&
          row.kind === 'persona' &&
          row.persona_state === 'draft'
      )
      .sort((a, b) => b.created_at - a.created_at)[0]
  }

  setPersonaState(id: string, state: string, supersededBy?: string | null) {
    const row = this.rows.get(id)
    if (!row) return
    row.persona_state = state
    if (supersededBy !== undefined) row.superseded_by = supersededBy
    row.decision_revision += 1
    this.touchDirty(row)
  }

  setAnchor(id: string, anchored: boolean) {
    const row = this.rows.get(id)
    if (row) {
      row.is_anchor = anchored ? 1 : 0
      row.decision_revision += 1
      this.touchDirty(row)
    }
  }

  listPersonaVersions(agentId: string) {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.agent_id === agentId &&
          row.scope_type === 'agent' &&
          row.scope_id === null &&
          row.kind === 'persona'
      )
      .sort((a, b) => b.created_at - a.created_at)
  }

  search(
    agentId: string,
    query: string,
    limit = 20,
    options: { matchMode?: 'all' | 'any'; scopeFilter?: readonly MemoryScope[] } = {}
  ) {
    const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean)
    if (!terms.length) return []
    const matchMode = options.matchMode ?? 'all'
    const scopeFilter = normalizeMemoryScopeFilter(options.scopeFilter)
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.agent_id === agentId &&
          rowMatchesMemoryScopeFilter(row, scopeFilter) &&
          !row.superseded_by &&
          row.status !== 'archived' &&
          row.status !== 'conflicted' &&
          row.kind !== 'persona' &&
          row.kind !== 'working' &&
          (matchMode === 'any'
            ? terms.some((term) => row.content.toLowerCase().includes(term))
            : terms.every((term) => row.content.toLowerCase().includes(term)))
      )
      .slice(0, limit)
  }

  searchWithStrategy(
    agentId: string,
    query: string,
    limit = 20,
    options: { matchMode?: 'all' | 'any'; scopeFilter?: readonly MemoryScope[] } = {}
  ) {
    return {
      rows: this.search(agentId, query, limit, options),
      strategy: 'like-fallback' as const
    }
  }

  listPendingEmbedding(limit = 50, agentId?: string) {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.status === 'pending_embedding' &&
          !row.superseded_by &&
          row.kind !== 'persona' &&
          row.kind !== 'working' &&
          (!agentId || row.agent_id === agentId)
      )
      .slice(0, limit)
  }

  countPendingEmbedding(agentId?: string) {
    return this.listPendingEmbedding(Number.MAX_SAFE_INTEGER, agentId).length
  }

  seedLegacyStatus(
    id: string,
    status: AgentMemoryRow['status'],
    embedding?: {
      embeddingId?: string | null
      embeddingDim?: number | null
      embeddingModel?: string | null
    }
  ) {
    const row = this.rows.get(id)
    if (!row) return
    row.lifecycle_state =
      status === 'archived' ? 'archived' : status === 'conflicted' ? 'conflicted' : 'active'
    row.embedding_state =
      status === 'embedded'
        ? 'ready'
        : status === 'error'
          ? 'error'
          : status === 'fts_only'
            ? 'fts_only'
            : 'pending'
    row.status = status
    row.embedding_id = embedding?.embeddingId ?? null
    row.embedding_dim = embedding?.embeddingDim ?? null
    row.embedding_model = embedding?.embeddingModel ?? null
    this.touchDirty(row)
  }

  activateForEmbedding(id: string) {
    const row = this.rows.get(id)
    if (!row) return
    row.lifecycle_state = 'active'
    row.embedding_state = 'pending'
    row.status = 'pending_embedding'
    row.embedding_id = null
    row.embedding_dim = null
    row.embedding_model = null
    row.decision_revision += 1
    this.touchDirty(row)
  }

  activateForEmbeddingIfRevision(agentId: string, id: string, expectedRevision: number) {
    const row = this.rows.get(id)
    if (!row || row.agent_id !== agentId || row.decision_revision !== expectedRevision) return false
    this.activateForEmbedding(id)
    return true
  }

  restoreArchivedMemory(input: { agentId: string; id: string; expectedRevision: number }) {
    const row = this.rows.get(input.id)
    if (
      !row ||
      row.agent_id !== input.agentId ||
      row.decision_revision !== input.expectedRevision ||
      row.lifecycle_state !== 'archived' ||
      row.superseded_by !== null ||
      row.conflict_state !== null ||
      row.conflict_with !== null ||
      row.kind === 'persona' ||
      row.kind === 'working' ||
      this.isUnresolvedConflictParticipant(input.agentId, input.id)
    ) {
      return false
    }
    if (
      this.hasTombstoneForClaim({
        agentId: input.agentId,
        kind: row.kind,
        content: row.content,
        provenanceKey: row.provenance_key
      })
    ) {
      return false
    }
    this.activateForEmbedding(row.id)
    return true
  }

  reviveSupersededMemory(input: {
    agentId: string
    id: string
    expectedRevision: number
    retiredHead?: { id: string; expectedRevision: number } | null
  }) {
    const row = this.rows.get(input.id)
    const retiredHead = input.retiredHead ? this.rows.get(input.retiredHead.id) : undefined
    if (
      !row ||
      row.agent_id !== input.agentId ||
      row.decision_revision !== input.expectedRevision ||
      row.lifecycle_state !== 'active' ||
      row.superseded_by === null ||
      row.conflict_state !== null ||
      row.conflict_with !== null ||
      row.kind === 'persona' ||
      row.kind === 'working'
    ) {
      return false
    }
    if (
      this.hasTombstoneForClaim({
        agentId: input.agentId,
        kind: row.kind,
        content: row.content,
        provenanceKey: row.provenance_key
      })
    ) {
      return false
    }
    if (
      input.retiredHead &&
      (!retiredHead ||
        retiredHead.id === row.id ||
        retiredHead.agent_id !== input.agentId ||
        !rowsShareMemoryScope(row, retiredHead) ||
        retiredHead.decision_revision !== input.retiredHead.expectedRevision ||
        retiredHead.lifecycle_state !== 'active' ||
        retiredHead.superseded_by !== null ||
        retiredHead.conflict_state !== null ||
        retiredHead.conflict_with !== null ||
        retiredHead.kind === 'persona' ||
        retiredHead.kind === 'working')
    ) {
      return false
    }
    if (retiredHead) {
      retiredHead.superseded_by = row.id
      retiredHead.decision_revision += 1
      this.touchDirty(retiredHead)
    }
    row.superseded_by = null
    row.embedding_state = 'pending'
    row.status = 'pending_embedding'
    row.embedding_id = null
    row.embedding_dim = null
    row.embedding_model = null
    row.decision_revision += 1
    this.touchDirty(row)
    return true
  }

  activateResolvedChallenger(input: ResolveChallengerTransition) {
    const row = this.rows.get(input.id)
    const target = this.rows.get(input.targetId)
    if (
      !row ||
      !target ||
      row.agent_id !== input.agentId ||
      target.agent_id !== input.agentId ||
      row.decision_revision !== input.expectedRevision ||
      row.lifecycle_state !== 'conflicted' ||
      row.conflict_with !== input.targetId ||
      row.superseded_by !== null ||
      row.conflict_state !== null ||
      row.kind === 'persona' ||
      row.kind === 'working' ||
      target.lifecycle_state !== 'active' ||
      target.conflict_state !== 'challenged' ||
      target.superseded_by !== null ||
      !rowsShareMemoryScope(row, target)
    ) {
      return false
    }
    if (
      this.hasTombstoneForClaim({
        agentId: input.agentId,
        kind: row.kind,
        content: input.content ?? row.content,
        provenanceKey:
          input.content === undefined ? row.provenance_key : (input.provenanceKey ?? null)
      })
    ) {
      return false
    }
    row.lifecycle_state = 'active'
    row.embedding_state = 'pending'
    row.status = 'pending_embedding'
    row.conflict_with = null
    row.embedding_id = null
    row.embedding_dim = null
    row.embedding_model = null
    if (input.content !== undefined) {
      row.content = input.content
      row.provenance_key = input.provenanceKey ?? null
      if (Object.prototype.hasOwnProperty.call(input, 'category')) {
        row.category = input.category ?? null
      }
      const temporal = input.temporal
        ? normalizeMemoryTemporalMetadata(input.temporal)
        : temporalMetadataFromRow(row)
      row.temporal_kind = temporal.temporalKind
      row.valid_from = temporal.validFrom
      row.valid_until = temporal.validUntil
      row.temporal_confidence = temporal.temporalConfidence
      row.temporal_precision = temporal.temporalPrecision
      row.temporal_timezone = temporal.temporalTimeZone
      row.last_accessed = input.at ?? 0
    }
    row.decision_revision += 1
    this.touchDirty(row)
    return true
  }

  archiveResolvedChallenger(input: {
    agentId: string
    id: string
    expectedRevision: number
    targetId: string
    winnerId: string
  }) {
    const row = this.rows.get(input.id)
    const target = this.rows.get(input.targetId)
    const winner = this.rows.get(input.winnerId)
    if (
      !row ||
      !target ||
      !winner ||
      row.agent_id !== input.agentId ||
      target.agent_id !== input.agentId ||
      winner.agent_id !== input.agentId ||
      row.decision_revision !== input.expectedRevision ||
      row.lifecycle_state !== 'conflicted' ||
      row.conflict_with !== input.targetId ||
      row.superseded_by !== null ||
      row.conflict_state !== null ||
      row.kind === 'persona' ||
      row.kind === 'working' ||
      target.lifecycle_state !== 'active' ||
      target.conflict_state !== 'challenged' ||
      target.superseded_by !== null ||
      !rowsShareMemoryScope(row, target) ||
      !rowsShareMemoryScope(row, winner)
    ) {
      return false
    }
    row.lifecycle_state = 'archived'
    row.status = 'archived'
    row.conflict_with = null
    row.superseded_by = input.winnerId
    row.decision_revision += 1
    this.touchDirty(row)
    return true
  }

  archiveResolvedConflictTarget(input: {
    agentId: string
    id: string
    expectedRevision: number
    challengerId: string
  }) {
    const row = this.rows.get(input.id)
    const challenger = this.rows.get(input.challengerId)
    if (
      !row ||
      !challenger ||
      row.agent_id !== input.agentId ||
      challenger.agent_id !== input.agentId ||
      row.decision_revision !== input.expectedRevision ||
      row.lifecycle_state !== 'active' ||
      row.conflict_state !== 'challenged' ||
      row.superseded_by !== null ||
      challenger.lifecycle_state !== 'active' ||
      challenger.superseded_by !== null ||
      challenger.conflict_state !== null ||
      challenger.conflict_with !== null ||
      !rowsShareMemoryScope(row, challenger)
    ) {
      return false
    }
    row.lifecycle_state = 'archived'
    row.status = 'archived'
    row.conflict_state = null
    row.superseded_by = input.challengerId
    row.decision_revision += 1
    this.touchDirty(row)
    return true
  }

  markPendingEmbeddingsReady(
    agentId: string,
    updates: ReadonlyArray<{
      id: string
      expectedRevision: number
      embeddingId: string
      embeddingDim: number
      embeddingModel: string
    }>
  ) {
    const updated: string[] = []
    for (const update of updates) {
      const row = this.rows.get(update.id)
      if (
        !row ||
        row.agent_id !== agentId ||
        row.decision_revision !== update.expectedRevision ||
        row.lifecycle_state !== 'active' ||
        row.embedding_state !== 'pending' ||
        row.superseded_by !== null ||
        row.kind === 'persona' ||
        row.kind === 'working'
      ) {
        continue
      }
      row.embedding_state = 'ready'
      row.status = 'embedded'
      row.embedding_id = update.embeddingId
      row.embedding_dim = update.embeddingDim
      row.embedding_model = update.embeddingModel
      this.touchDirty(row)
      updated.push(row.id)
    }
    return updated
  }

  markPendingEmbeddingsError(
    agentId: string,
    updates: ReadonlyArray<{ id: string; expectedRevision: number }>,
    status: 'error' | 'fts_only' = 'error'
  ) {
    const updated: string[] = []
    for (const update of updates) {
      const row = this.rows.get(update.id)
      if (
        !row ||
        row.agent_id !== agentId ||
        row.decision_revision !== update.expectedRevision ||
        row.lifecycle_state !== 'active' ||
        row.embedding_state !== 'pending' ||
        row.superseded_by !== null ||
        row.kind === 'persona' ||
        row.kind === 'working'
      ) {
        continue
      }
      row.embedding_state = status
      row.status = status
      row.embedding_id = null
      row.embedding_dim = null
      row.embedding_model = null
      this.touchDirty(row)
      updated.push(row.id)
    }
    return updated
  }

  requeueForEmbedding(
    agentId: string,
    states: AgentMemoryEmbeddingState[],
    limit?: number,
    afterId?: string | null
  ) {
    let changed = 0
    const candidates = [...this.rows.values()]
      .filter(
        (row) =>
          row.agent_id === agentId &&
          !row.superseded_by &&
          row.kind !== 'persona' &&
          row.kind !== 'working' &&
          row.lifecycle_state === 'active' &&
          states.includes(row.embedding_state) &&
          (!afterId || row.id > afterId)
      )
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, limit === undefined ? undefined : Math.max(0, Math.floor(limit)))
    for (const row of candidates) {
      if (
        row.agent_id !== agentId ||
        row.superseded_by ||
        row.kind === 'persona' ||
        row.kind === 'working'
      )
        continue
      if (!states.includes(row.embedding_state)) continue
      row.embedding_state = 'pending'
      row.status = 'pending_embedding'
      row.embedding_id = null
      row.embedding_dim = null
      row.embedding_model = null
      this.touchDirty(row)
      changed += 1
    }
    return changed
  }

  listEmbeddingStateIds(
    agentId: string,
    states: AgentMemoryEmbeddingState[],
    limit: number,
    afterId?: string | null
  ) {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.agent_id === agentId &&
          !row.superseded_by &&
          row.kind !== 'persona' &&
          row.kind !== 'working' &&
          row.lifecycle_state === 'active' &&
          states.includes(row.embedding_state) &&
          (!afterId || row.id > afterId)
      )
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, Math.max(0, Math.floor(limit)))
      .map((row) => row.id)
  }

  listCurrentEmbeddedIds(
    agentId: string,
    embeddingDim: number,
    embeddingModel: string,
    afterId: string | null,
    limit: number
  ) {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.agent_id === agentId &&
          row.lifecycle_state === 'active' &&
          row.embedding_state === 'ready' &&
          row.superseded_by === null &&
          row.kind !== 'persona' &&
          row.kind !== 'working' &&
          row.embedding_dim === embeddingDim &&
          row.embedding_model === embeddingModel &&
          (afterId === null || row.id > afterId)
      )
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, Math.max(0, Math.floor(limit)))
      .map((row) => row.id)
  }

  seedSupersededBy(id: string, supersededBy: string | null) {
    const row = this.rows.get(id)
    if (row) {
      row.superseded_by = supersededBy
      row.decision_revision += 1
      this.touchDirty(row)
    }
  }

  markSupersededIfRevision(
    agentId: string,
    id: string,
    expectedRevision: number,
    supersededBy: string
  ) {
    const row = this.rows.get(id)
    const successor = this.rows.get(supersededBy)
    if (
      !row ||
      !successor ||
      row.agent_id !== agentId ||
      successor.agent_id !== agentId ||
      successor.id === row.id ||
      !rowsShareMemoryScope(row, successor) ||
      row.decision_revision !== expectedRevision ||
      row.superseded_by !== null ||
      row.conflict_state !== null ||
      row.conflict_with !== null ||
      row.lifecycle_state !== 'active' ||
      row.kind === 'persona' ||
      row.kind === 'working'
    ) {
      return false
    }
    row.superseded_by = supersededBy
    row.decision_revision += 1
    this.touchDirty(row)
    return true
  }

  recordAccess(id: string, accessedAt = 0) {
    const row = this.getBookkeepingWritableRow(id)
    if (row) {
      row.last_accessed = accessedAt
      row.access_count += 1
    }
  }

  recordAccessBatch(ids: string[], accessedAt = 0) {
    for (const id of new Set(ids)) {
      this.recordAccess(id, accessedAt)
    }
  }

  updateDecayScore(id: string, decayScore: number | null, consolidatedAt: number | null = null) {
    const row = this.getBookkeepingWritableRow(id)
    if (row) {
      row.decay_score = decayScore
      if (consolidatedAt !== null) row.last_consolidated_at = consolidatedAt
    }
  }

  seedContentFields(
    id: string,
    content: string,
    provenanceKey: string | null,
    at = 0,
    category?: string | null
  ) {
    const row = this.rows.get(id)
    if (row) {
      row.content = content
      row.provenance_key = provenanceKey
      row.last_accessed = at
      if (category !== undefined) row.category = category
      row.decision_revision += 1
      this.touchDirty(row)
    }
  }

  updateInternalContent(input: {
    agentId: string
    id: string
    expectedRevision: number
    content: string
    provenanceKey: string | null
    at: number
  }) {
    const row = this.rows.get(input.id)
    if (
      !row ||
      row.agent_id !== input.agentId ||
      row.decision_revision !== input.expectedRevision ||
      row.lifecycle_state !== 'active' ||
      row.superseded_by !== null ||
      row.conflict_state !== null ||
      row.conflict_with !== null ||
      (row.kind !== 'persona' && row.kind !== 'working')
    ) {
      return false
    }
    row.content = input.content
    row.provenance_key = input.provenanceKey
    row.last_accessed = input.at
    row.embedding_state = 'not_applicable'
    row.status = 'fts_only'
    row.embedding_id = null
    row.embedding_dim = null
    row.embedding_model = null
    row.decision_revision += 1
    return true
  }

  updateUserContentAndInvalidateEmbedding(input: {
    agentId: string
    id: string
    expectedRevision: number
    content: string
    provenanceKey: string | null
    at: number
    category?: string | null
    importance?: number
    temporal?: MemoryTemporalMetadata
  }): MemoryClaimContentUpdateResult {
    const row = this.rows.get(input.id)
    if (
      !row ||
      row.agent_id !== input.agentId ||
      row.decision_revision !== input.expectedRevision ||
      row.lifecycle_state !== 'active' ||
      row.superseded_by !== null ||
      row.conflict_state !== null ||
      row.conflict_with !== null ||
      row.kind === 'persona' ||
      row.kind === 'working'
    ) {
      return { action: 'suppressed', reason: 'concurrent-update' }
    }
    if (
      this.hasTombstoneForClaim({
        agentId: input.agentId,
        kind: row.kind,
        content: input.content,
        provenanceKey: input.provenanceKey
      })
    ) {
      return { action: 'suppressed', reason: 'forgotten' }
    }
    row.content = input.content
    row.provenance_key = input.provenanceKey
    row.last_accessed = input.at
    if (input.category !== undefined) row.category = input.category
    if (input.importance !== undefined) row.importance = input.importance
    if (input.temporal !== undefined) {
      const temporal = normalizeMemoryTemporalMetadata(input.temporal)
      row.temporal_kind = temporal.temporalKind
      row.valid_from = temporal.validFrom
      row.valid_until = temporal.validUntil
      row.temporal_confidence = temporal.temporalConfidence
      row.temporal_precision = temporal.temporalPrecision
      row.temporal_timezone = temporal.temporalTimeZone
    }
    row.embedding_state = 'pending'
    row.status = 'pending_embedding'
    row.embedding_id = null
    row.embedding_dim = null
    row.embedding_model = null
    row.decision_revision += 1
    this.touchDirty(row)
    return { action: 'updated' }
  }

  updateUserMetadataIfRevision(input: {
    agentId: string
    id: string
    expectedRevision: number
    category?: string | null
    importance?: number
    lastAccessedAt?: number
    temporal?: MemoryTemporalMetadata
  }) {
    const row = this.rows.get(input.id)
    if (
      !row ||
      row.agent_id !== input.agentId ||
      row.decision_revision !== input.expectedRevision ||
      row.lifecycle_state !== 'active' ||
      row.superseded_by !== null ||
      row.conflict_state !== null ||
      row.conflict_with !== null ||
      row.kind === 'persona' ||
      row.kind === 'working'
    ) {
      return false
    }
    if (Object.prototype.hasOwnProperty.call(input, 'category')) {
      row.category = input.category ?? null
    }
    if (Object.prototype.hasOwnProperty.call(input, 'importance')) {
      row.importance = input.importance ?? row.importance
    }
    if (Object.prototype.hasOwnProperty.call(input, 'lastAccessedAt')) {
      row.last_accessed = input.lastAccessedAt ?? row.last_accessed
    }
    if (input.temporal !== undefined) {
      const temporal = normalizeMemoryTemporalMetadata(input.temporal)
      row.temporal_kind = temporal.temporalKind
      row.valid_from = temporal.validFrom
      row.valid_until = temporal.validUntil
      row.temporal_confidence = temporal.temporalConfidence
      row.temporal_precision = temporal.temporalPrecision
      row.temporal_timezone = temporal.temporalTimeZone
    }
    row.decision_revision += 1
    this.touchDirty(row)
    return true
  }

  setConfidence(id: string, confidence: number) {
    const row = this.getBookkeepingWritableRow(id)
    if (row)
      row.confidence = row.confidence === null ? confidence : Math.max(row.confidence, confidence)
  }

  seedConflictState(id: string, state: 'challenged' | null) {
    const row = this.rows.get(id)
    if (row) {
      row.conflict_state = state
      row.decision_revision += 1
      this.touchDirty(row)
    }
  }

  markConflictIfRevision(
    agentId: string,
    id: string,
    expectedRevision: number,
    state: 'challenged'
  ) {
    const row = this.rows.get(id)
    if (
      !row ||
      row.agent_id !== agentId ||
      row.decision_revision !== expectedRevision ||
      row.superseded_by !== null ||
      row.conflict_state !== null ||
      row.status === 'archived' ||
      row.status === 'conflicted'
    ) {
      return false
    }
    row.conflict_state = state
    row.decision_revision += 1
    this.touchDirty(row)
    return true
  }

  seedConflictTarget(id: string, targetId: string | null) {
    const row = this.rows.get(id)
    if (row) {
      row.conflict_with = targetId
      row.decision_revision += 1
      this.touchDirty(row)
    }
  }

  setLastConsolidatedAt(id: string, at = 0) {
    const row = this.getBookkeepingWritableRow(id)
    if (row) row.last_consolidated_at = at
  }

  getLastConsolidatedAt(agentId: string) {
    let max: number | null = null
    for (const row of this.rows.values()) {
      if (row.agent_id !== agentId || row.last_consolidated_at === null) continue
      if (max === null || row.last_consolidated_at > max) max = row.last_consolidated_at
    }
    return max
  }

  getCurrentEmbeddingDimension(agentId: string, fingerprint: string) {
    const rowOrder = new Map([...this.rows.keys()].map((id, index) => [id, index]))
    const rows = this.listByAgent(agentId, { statuses: ['embedded'] })
      .filter(
        (candidate) =>
          candidate.kind !== 'persona' &&
          candidate.kind !== 'working' &&
          candidate.embedding_model === fingerprint &&
          typeof candidate.embedding_dim === 'number' &&
          Number.isFinite(candidate.embedding_dim) &&
          candidate.embedding_dim > 0
      )
      .sort(
        (a, b) =>
          b.created_at - a.created_at || (rowOrder.get(b.id) ?? -1) - (rowOrder.get(a.id) ?? -1)
      )
    return rows[0]?.embedding_dim ?? null
  }

  getHealthStats(agentId: string): AgentMemoryHealthStats {
    const rows = [...this.rows.values()].filter((row) => row.agent_id === agentId)
    const count = (predicate: (row: AgentMemoryRow) => boolean) => rows.filter(predicate).length
    const countByValue = <Key extends string>(
      keys: readonly Key[],
      read: (row: AgentMemoryRow) => string | null
    ): Record<Key, number> =>
      Object.fromEntries(keys.map((key) => [key, count((row) => read(row) === key)])) as Record<
        Key,
        number
      >
    const importanceValues = rows.map((row) => row.importance).sort((a, b) => a - b)
    const confidenceValues = rows
      .map((row) => row.confidence)
      .filter((value): value is number => typeof value === 'number')
    const median =
      importanceValues.length === 0
        ? null
        : importanceValues.length % 2 === 1
          ? importanceValues[Math.floor(importanceValues.length / 2)]
          : (importanceValues[importanceValues.length / 2 - 1] +
              importanceValues[importanceValues.length / 2]) /
            2

    return {
      totalRows: rows.length,
      byKind: countByValue(AGENT_MEMORY_HEALTH_KIND_KEYS, (row) => row.kind),
      byCategory: {
        ...countByValue(AGENT_MEMORY_CATEGORIES, (row) => row.category),
        uncategorized: count((row) => row.category == null || !isAgentMemoryCategory(row.category))
      },
      byStatus: countByValue(AGENT_MEMORY_HEALTH_STATUS_KEYS, (row) => row.status),
      neverAccessed: count((row) => row.access_count === 0),
      importanceAvg:
        rows.length === 0 ? null : rows.reduce((sum, row) => sum + row.importance, 0) / rows.length,
      importanceMedian: median,
      confidenceAvg:
        confidenceValues.length === 0
          ? null
          : confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length,
      conflicted: count((row) => row.status === 'conflicted'),
      challenged: count((row) => row.conflict_state === 'challenged' && row.superseded_by === null)
    }
  }

  hasStaleEmbeddings(agentId: string, currentDim: number, fingerprint: string) {
    return this.listByAgent(agentId, { statuses: ['embedded'] }).some(
      (row) =>
        row.kind !== 'persona' &&
        row.kind !== 'working' &&
        (row.embedding_dim !== currentDim || row.embedding_model !== fingerprint)
    )
  }

  countStaleEmbeddings(agentId: string, currentDim: number, fingerprint: string) {
    return this.listByAgent(agentId, { statuses: ['embedded'] }).filter(
      (row) =>
        row.kind !== 'persona' &&
        row.kind !== 'working' &&
        (row.embedding_dim !== currentDim || row.embedding_model !== fingerprint)
    ).length
  }

  seedArchived(id: string, _at = 0) {
    const row = this.rows.get(id)
    if (row) {
      row.lifecycle_state = 'archived'
      row.status = 'archived'
      row.decision_revision += 1
      this.touchDirty(row)
    }
  }

  archiveActiveMemory(input: { agentId: string; id: string; expectedRevision: number }) {
    const row = this.rows.get(input.id)
    if (
      !row ||
      row.agent_id !== input.agentId ||
      row.decision_revision !== input.expectedRevision ||
      row.lifecycle_state !== 'active' ||
      row.superseded_by !== null ||
      row.conflict_state !== null ||
      row.conflict_with !== null ||
      row.kind === 'persona' ||
      row.kind === 'working' ||
      this.isUnresolvedConflictParticipant(input.agentId, input.id)
    ) {
      return false
    }
    this.seedArchived(row.id)
    return true
  }

  archiveEligibleBatch(
    agentId: string,
    options: {
      now: number
      createdBefore: number
      minimumBaseAgeMs: number
      limit: number
    }
  ) {
    const eligible = [...this.rows.values()]
      .filter(
        (row) =>
          row.agent_id === agentId &&
          row.superseded_by === null &&
          row.conflict_state === null &&
          row.status !== 'archived' &&
          row.status !== 'conflicted' &&
          row.is_anchor === 0 &&
          row.kind !== 'persona' &&
          row.kind !== 'working' &&
          row.created_at < options.createdBefore &&
          options.now - (row.last_accessed ?? row.created_at) >
            options.minimumBaseAgeMs * (1 + Math.min(1, Math.max(0, row.importance)))
      )
      .sort(
        (a, b) =>
          (a.last_accessed ?? a.created_at) - (b.last_accessed ?? b.created_at) ||
          a.created_at - b.created_at ||
          a.id.localeCompare(b.id)
      )
      .slice(0, Math.max(0, Math.floor(options.limit)))
    eligible.forEach((row) => this.seedArchived(row.id, options.now))
    return eligible.map((row) => row.id)
  }

  countArchiveEligible(
    agentId: string,
    options: { now: number; createdBefore: number; minimumBaseAgeMs: number }
  ) {
    return [...this.rows.values()].filter(
      (row) =>
        row.agent_id === agentId &&
        row.superseded_by === null &&
        row.conflict_state === null &&
        row.status !== 'archived' &&
        row.status !== 'conflicted' &&
        row.is_anchor === 0 &&
        row.kind !== 'persona' &&
        row.kind !== 'working' &&
        row.created_at < options.createdBefore &&
        options.now - (row.last_accessed ?? row.created_at) >
          options.minimumBaseAgeMs * (1 + Math.min(1, Math.max(0, row.importance)))
    ).length
  }

  listArchiveCandidateLifecycleRows(agentId: string, before: number, limit: number) {
    const cappedLimit = Math.max(0, Math.floor(limit))
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.agent_id === agentId &&
          !row.superseded_by &&
          row.conflict_state === null &&
          row.status !== 'archived' &&
          row.status !== 'conflicted' &&
          row.is_anchor === 0 &&
          row.kind !== 'persona' &&
          row.kind !== 'working' &&
          row.created_at < before
      )
      .sort(
        (a, b) =>
          (a.last_accessed ?? a.created_at) - (b.last_accessed ?? b.created_at) ||
          a.created_at - b.created_at ||
          a.id.localeCompare(b.id)
      )
      .slice(0, cappedLimit)
      .map(toLifecycleRow)
  }

  listTopAccessed(agentId: string, limit: number) {
    return [...this.rows.values()]
      .filter((row) => row.agent_id === agentId && row.kind !== 'working' && row.access_count > 0)
      .filter((row) => row.superseded_by === null)
      .filter((row) => row.status !== 'archived' && row.status !== 'conflicted')
      .sort(
        (a, b) => b.access_count - a.access_count || (b.last_accessed ?? 0) - (a.last_accessed ?? 0)
      )
      .slice(0, Math.max(0, Math.floor(limit)))
  }

  delete(id: string) {
    const row = this.rows.get(id)
    if (row) this.touchDirty(row)
    this.rows.delete(id)
  }

  deleteInternalMemory(agentId: string, id: string): boolean {
    const row = this.rows.get(id)
    if (!row || row.agent_id !== agentId || (row.kind !== 'persona' && row.kind !== 'working')) {
      return false
    }
    this.delete(id)
    return true
  }

  tombstoneAndDelete(input: MemoryTombstoneDeleteInput): AgentMemoryRow | null {
    const row = this.rows.get(input.id)
    if (
      !row ||
      row.agent_id !== input.agentId ||
      row.decision_revision !== input.expectedRevision ||
      !isTombstoneEligibleMemoryKind(row.kind) ||
      this.isUnresolvedConflictParticipant(input.agentId, input.id)
    ) {
      return null
    }
    this.addTombstonesForRow(row, input.createdAt, 'selective_delete')
    this.delete(row.id)
    return row
  }

  clearByAgent(agentId: string) {
    let removed = 0
    for (const [id, row] of this.rows) {
      if (row.agent_id === agentId) {
        this.delete(id)
        removed += 1
      }
    }
    return removed
  }

  listPendingMemoryClearJobs(): MemoryClearJob[] {
    return [...this.clearJobs.values()]
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt || left.agentId.localeCompare(right.agentId)
      )
      .map((job) => ({ ...job }))
  }

  beginMemoryClear(agentId: string, createdAt: number): MemoryClearJob {
    const existing = this.clearJobs.get(agentId)
    if (existing) return { ...existing }
    const memoryIds = [...this.rows.values()]
      .filter((row) => row.agent_id === agentId)
      .map((row) => row.id)
    const job: MemoryClearJob = {
      agentId,
      cutoffRowId: memoryIds.length,
      createdAt,
      removed: 0,
      phase: 'claims'
    }
    this.clearJobs.set(agentId, job)
    this.clearJobMemoryIds.set(agentId, memoryIds)
    return { ...job }
  }

  processMemoryClearBatch(agentId: string): MemoryClearBatchResult | null {
    const job = this.clearJobs.get(agentId)
    if (!job) return null
    if (job.phase === 'vectors') {
      return { job: { ...job }, removedInBatch: 0 }
    }
    const pendingIds = this.clearJobMemoryIds.get(agentId) ?? []
    const batchIds = pendingIds.splice(0, 256)
    let removedInBatch = 0
    for (const id of batchIds) {
      const row = this.rows.get(id)
      if (!row || row.agent_id !== agentId) continue
      this.addTombstonesForRow(row, job.createdAt, 'agent_clear')
      this.delete(id)
      removedInBatch += 1
    }
    job.removed += removedInBatch
    if (pendingIds.length === 0) {
      job.phase = 'vectors'
      for (const [key, derivation] of this.derivations) {
        if (derivation.agent_id === agentId) this.derivations.delete(key)
      }
      for (const [key, seed] of this.dirtySeeds) {
        if (seed.agentId === agentId) this.dirtySeeds.delete(key)
      }
    }
    return { job: { ...job }, removedInBatch }
  }

  completeMemoryClear(agentId: string): boolean {
    const job = this.clearJobs.get(agentId)
    if (!job) return true
    if (job.phase !== 'vectors') return false
    this.clearJobs.delete(agentId)
    this.clearJobMemoryIds.delete(agentId)
    return true
  }

  retireAgentMemoryNamespace(agentId: string): number {
    const removed = this.clearByAgent(agentId)
    for (const [key, tombstone] of this.tombstones) {
      if (tombstone.agentId === agentId) this.tombstones.delete(key)
    }
    for (const [key, derivation] of this.derivations) {
      if (derivation.agent_id === agentId) this.derivations.delete(key)
    }
    for (const [key, seed] of this.dirtySeeds) {
      if (seed.agentId === agentId) this.dirtySeeds.delete(key)
    }
    this.clearJobs.delete(agentId)
    this.clearJobMemoryIds.delete(agentId)
    return removed
  }

  countByAgent(agentId: string) {
    return this.listByAgent(agentId, { includeSuperseded: true }).length
  }

  countStatusView(agentId: string) {
    const rows = [...this.rows.values()].filter(
      (row) =>
        row.agent_id === agentId &&
        row.status !== 'conflicted' &&
        row.superseded_by === null &&
        row.kind !== 'persona' &&
        row.kind !== 'working'
    )
    const activeMemoryCount = rows.filter((row) => row.status !== 'archived').length
    const archivedMemoryCount = rows.filter((row) => row.status === 'archived').length
    return {
      total: activeMemoryCount,
      pendingEmbedding: rows.filter((row) => row.status === 'pending_embedding').length,
      activeMemoryCount,
      archivedMemoryCount
    }
  }

  // Mirrors AgentMemoryTable.countConflictPairs / ConflictService.listConflicts's pair-validity
  // predicate: keep all three in sync.
  countConflictPairs(agentId: string): number {
    return [...this.rows.values()].filter((challenger) => {
      if (
        challenger.agent_id !== agentId ||
        challenger.status !== 'conflicted' ||
        challenger.superseded_by !== null ||
        !challenger.conflict_with
      ) {
        return false
      }
      const target = this.rows.get(challenger.conflict_with)
      return (
        !!target &&
        target.agent_id === agentId &&
        rowsShareMemoryScope(challenger, target) &&
        target.conflict_state === 'challenged' &&
        target.superseded_by === null
      )
    }).length
  }

  isUnresolvedConflictParticipant(agentId: string, memoryId: string): boolean {
    const row = this.rows.get(memoryId)
    if (!row || row.agent_id !== agentId) return false
    if (row.status === 'conflicted' && row.conflict_with !== null) return true
    return [...this.rows.values()].some(
      (challenger) =>
        challenger.agent_id === agentId &&
        challenger.status === 'conflicted' &&
        challenger.superseded_by === null &&
        challenger.conflict_with === memoryId &&
        rowsShareMemoryScope(challenger, row)
    )
  }

  listConflictIntegrityRows(agentId: string): AgentMemoryRow[] {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.agent_id === agentId &&
          (row.status === 'conflicted' || row.conflict_with !== null || row.conflict_state !== null)
      )
      .sort((left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id))
  }

  listConflictChallengersForMaintenance(agentId: string, limit: number): AgentMemoryRow[] {
    return [...this.rows.values()]
      .filter((challenger) => {
        const target = challenger.conflict_with
          ? this.rows.get(challenger.conflict_with)
          : undefined
        return (
          challenger.agent_id === agentId &&
          challenger.status === 'conflicted' &&
          challenger.superseded_by === null &&
          target?.agent_id === agentId &&
          rowsShareMemoryScope(challenger, target) &&
          target.conflict_state === 'challenged' &&
          target.superseded_by === null
        )
      })
      .sort(
        (a, b) =>
          (a.last_consolidated_at ?? 0) - (b.last_consolidated_at ?? 0) ||
          a.created_at - b.created_at ||
          a.id.localeCompare(b.id)
      )
      .slice(0, Math.max(0, Math.floor(limit)))
  }

  listConflictSiblings(
    agentId: string,
    targetId: string,
    excludeChallengerId: string
  ): AgentMemoryRow[] {
    const target = this.rows.get(targetId)
    if (!target || target.agent_id !== agentId) return []
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.agent_id === agentId &&
          rowsShareMemoryScope(row, target) &&
          row.conflict_with === targetId &&
          row.status === 'conflicted' &&
          row.superseded_by === null &&
          row.id !== excludeChallengerId
      )
      .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
  }

  retireConflictSiblings(
    agentId: string,
    targetId: string,
    excludeChallengerId: string,
    winnerId: string,
    at: number
  ) {
    const target = this.rows.get(targetId)
    const winner = this.rows.get(winnerId)
    if (
      !target ||
      !winner ||
      target.agent_id !== agentId ||
      winner.agent_id !== agentId ||
      !rowsShareMemoryScope(target, winner) ||
      winner.lifecycle_state !== 'active' ||
      winner.superseded_by !== null
    ) {
      return 0
    }
    const siblings = this.listConflictSiblings(agentId, targetId, excludeChallengerId).filter(
      (sibling) => sibling.id !== winner.id
    )
    for (const sibling of siblings) {
      sibling.conflict_with = null
      sibling.superseded_by = winnerId
      this.seedArchived(sibling.id, at)
    }
    return siblings.length
  }

  clearTargetConflictIfNoChallengers(agentId: string, targetId: string) {
    const target = this.rows.get(targetId)
    if (
      !target ||
      target.agent_id !== agentId ||
      target.conflict_state !== 'challenged' ||
      this.listConflictSiblings(agentId, targetId, '').length > 0
    ) {
      return false
    }
    this.seedConflictState(targetId, null)
    return true
  }

  repairConflictIntegrityBatch(agentId: string, limit: number) {
    const result = {
      repairedTargets: 0,
      archivedChallengers: 0,
      clearedTargets: 0,
      clearedLinks: 0
    }
    const rows = this.listConflictIntegrityRows(agentId).slice(
      0,
      Math.max(0, Math.min(256, Math.floor(limit)))
    )
    for (const row of rows) {
      if (row.status !== 'conflicted' && row.conflict_with !== null) {
        row.conflict_with = null
        row.decision_revision += 1
        this.touchDirty(row)
        result.clearedLinks += 1
      }
    }
    for (const challenger of rows) {
      if (challenger.status !== 'conflicted') continue
      const target = challenger.conflict_with ? this.rows.get(challenger.conflict_with) : undefined
      const validTarget =
        !!target &&
        target.id !== challenger.id &&
        target.agent_id === agentId &&
        rowsShareMemoryScope(challenger, target) &&
        target.status !== 'archived' &&
        target.status !== 'conflicted' &&
        target.superseded_by === null
      if (!validTarget || challenger.superseded_by !== null) {
        challenger.conflict_with = null
        this.seedArchived(challenger.id)
        result.archivedChallengers += 1
        continue
      }
      if (target.conflict_state !== 'challenged') {
        this.seedConflictState(target.id, 'challenged')
        result.repairedTargets += 1
      }
    }
    for (const target of rows) {
      if (
        target.conflict_state === 'challenged' &&
        this.listConflictSiblings(agentId, target.id, '').length === 0
      ) {
        this.seedConflictState(target.id, null)
        result.clearedTargets += 1
      }
    }
    return result
  }

  getPersonaCounts(agentId: string): { total: number; draft: number } {
    const versions = this.listPersonaVersions(agentId)
    return {
      total: versions.filter(
        (row) => row.persona_state !== 'draft' && row.persona_state !== 'rejected'
      ).length,
      draft: versions.filter((row) => row.persona_state === 'draft').length
    }
  }

  countLegacyShadowMismatches(agentId?: string): number {
    return [...this.rows.values()].filter(
      (row) =>
        (agentId === undefined || row.agent_id === agentId) &&
        row.status !== projectLegacyStatus(row.lifecycle_state, row.embedding_state)
    ).length
  }

  repairCorruptedLegacyShadow(agentId?: string): number {
    let repaired = 0
    for (const row of this.rows.values()) {
      if (agentId !== undefined && row.agent_id !== agentId) continue
      const projected = projectLegacyStatus(row.lifecycle_state, row.embedding_state)
      if (row.status === projected) continue
      row.status = projected
      repaired += 1
    }
    return repaired
  }

  runInTransaction<T>(fn: () => T): T {
    this.transactionCalls += 1
    const rowSnapshot = new MemoryRowMap()
    for (const [id, row] of this.rows) rowSnapshot.set(id, { ...row })
    const tombstoneSnapshot = new Map(
      [...this.tombstones].map(([key, tombstone]) => [key, { ...tombstone }])
    )
    const derivationSnapshot = new Map(
      [...this.derivations].map(([key, derivation]) => [key, { ...derivation }])
    )
    const dirtySeedSnapshot = new Map(
      [...this.dirtySeeds].map(([key, dirtySeed]) => [key, { ...dirtySeed }])
    )
    try {
      return fn()
    } catch (error) {
      this.rows = rowSnapshot
      this.tombstones = tombstoneSnapshot
      this.derivations = derivationSnapshot
      this.dirtySeeds = dirtySeedSnapshot
      throw error
    }
  }

  listWorkingCandidates(agentId: string, limit: number, after?: AgentMemoryWorkingCandidateCursor) {
    const isAfterCursor = (row: AgentMemoryRow): boolean => {
      if (!after) return true
      return (
        row.importance < after.importance ||
        (row.importance === after.importance && row.access_count < after.accessCount) ||
        (row.importance === after.importance &&
          row.access_count === after.accessCount &&
          row.created_at < after.createdAt) ||
        (row.importance === after.importance &&
          row.access_count === after.accessCount &&
          row.created_at === after.createdAt &&
          row.id < after.id)
      )
    }

    return [...this.rows.values()]
      .filter(
        (row) =>
          row.agent_id === agentId &&
          row.scope_type === 'agent' &&
          row.scope_id === null &&
          row.superseded_by === null &&
          row.status !== 'archived' &&
          row.status !== 'conflicted' &&
          (row.kind === 'semantic' || row.kind === 'reflection' || row.kind === 'episodic') &&
          isAfterCursor(row)
      )
      .sort(
        (a, b) =>
          b.importance - a.importance ||
          b.access_count - a.access_count ||
          b.created_at - a.created_at ||
          b.id.localeCompare(a.id)
      )
      .slice(0, Math.max(0, Math.floor(limit)))
  }

  hasActiveMemory(agentId: string) {
    return [...this.rows.values()].some(
      (row) => row.agent_id === agentId && row.status !== 'archived'
    )
  }

  listAgentIdsWithMemories() {
    return [
      ...new Set(
        [...this.rows.values()]
          .filter((row) => row.status !== 'archived')
          .map((row) => row.agent_id)
      )
    ]
  }

  listRecentlyActiveAgentIds(candidateAgentIds: readonly string[], limit: number) {
    const candidates = new Set(candidateAgentIds)
    const activityByAgent = new Map<string, number>()
    for (const row of this.rows.values()) {
      if (row.status === 'archived' || !candidates.has(row.agent_id)) continue
      activityByAgent.set(
        row.agent_id,
        Math.max(activityByAgent.get(row.agent_id) ?? 0, row.last_accessed ?? row.created_at)
      )
    }
    return [...activityByAgent.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, Math.max(0, Math.floor(limit)))
      .map(([agentId]) => agentId)
  }

  repairInternalKindStatuses(agentId: string) {
    let changed = 0
    for (const row of this.rows.values()) {
      if (row.agent_id !== agentId || (row.kind !== 'persona' && row.kind !== 'working')) continue
      if (row.embedding_state === 'not_applicable') continue
      row.embedding_state = 'not_applicable'
      row.status = 'fts_only'
      changed += 1
    }
    return changed
  }

  private isPrunableVectorRow(
    agentId: string,
    row: AgentMemoryRow | undefined,
    embeddingDim?: number,
    embeddingModel?: string
  ): row is AgentMemoryRow {
    return (
      !!row &&
      row.agent_id === agentId &&
      row.embedding_id !== null &&
      row.embedding_dim !== null &&
      row.embedding_dim > 0 &&
      row.embedding_model !== null &&
      (embeddingDim === undefined || row.embedding_dim === embeddingDim) &&
      (embeddingModel === undefined || row.embedding_model === embeddingModel) &&
      (row.kind === 'persona' ||
        row.kind === 'working' ||
        row.superseded_by !== null ||
        row.status === 'archived')
    )
  }

  listPrunableVectorRefs(
    agentId: string,
    options: { limit: number; embeddingModel?: string; embeddingDim?: number }
  ) {
    return [...this.rows.values()]
      .filter((row) =>
        this.isPrunableVectorRow(agentId, row, options.embeddingDim, options.embeddingModel)
      )
      .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
      .slice(0, Math.max(0, Math.floor(options.limit)))
      .map((row) => ({
        id: row.id,
        embeddingDim: row.embedding_dim!,
        embeddingModel: row.embedding_model!
      }))
  }

  filterPrunableVectorRefs(
    agentId: string,
    ids: string[],
    embeddingDim: number,
    embeddingModel: string
  ) {
    const uniqueIds = [...new Set(ids.filter((id) => id.trim()))]
    return uniqueIds.filter((id) => {
      const row = this.rows.get(id)
      return !row || this.isPrunableVectorRow(agentId, row, embeddingDim, embeddingModel)
    })
  }

  clearPrunableEmbeddingRefs(
    agentId: string,
    ids: string[],
    embeddingDim: number,
    embeddingModel: string
  ) {
    let changed = 0
    for (const id of new Set(ids)) {
      const row = this.rows.get(id)
      if (!this.isPrunableVectorRow(agentId, row, embeddingDim, embeddingModel)) continue
      row.embedding_id = null
      row.embedding_dim = null
      row.embedding_model = null
      this.touchDirty(row)
      changed += 1
    }
    return changed
  }
}

export interface FakeRepositoryState {
  rows: Map<string, AgentMemoryRow>
  tombstones: FakeRepositoryBehavior['tombstones']
  derivations: FakeRepositoryBehavior['derivations']
  dirtySeeds: FakeRepositoryBehavior['dirtySeeds']
  transactionCalls: number
}

interface FakeRepositoryRowAccess {
  insert(input: AgentMemoryInsertInput): AgentMemoryRow
  delete(id: string): void
  getById(...args: Parameters<MemoryRepositoryPort['getById']>): AgentMemoryRow | undefined
  getByProvenanceKey(
    ...args: Parameters<MemoryRepositoryPort['getByProvenanceKey']>
  ): AgentMemoryRow | undefined
  listByAgent(...args: Parameters<MemoryRepositoryPort['listByAgent']>): AgentMemoryRow[]
  listManagementPage(
    ...args: Parameters<MemoryRepositoryPort['listManagementPage']>
  ): AgentMemoryRow[]
  listManagementVisibleByIds(
    ...args: Parameters<MemoryRepositoryPort['listManagementVisibleByIds']>
  ): AgentMemoryRow[]
  listByIds(...args: Parameters<MemoryRepositoryPort['listByIds']>): AgentMemoryRow[]
}

type FakeRepositorySeedHelpers = Pick<
  FakeRepositoryBehavior,
  | 'seedArchived'
  | 'seedConflictState'
  | 'seedSupersededBy'
  | 'repairCorruptedLegacyShadow'
  | 'seedConflictTarget'
  | 'seedContentFields'
  | 'seedLegacyStatus'
>

export type FakeRepository = Omit<MemoryRepositoryPort, keyof FakeRepositoryRowAccess> &
  FakeRepositoryRowAccess &
  FakeRepositorySeedHelpers &
  FakeRepositoryState

export interface FakeRepositoryHarness {
  state: FakeRepositoryState
  read: MemoryReadRepositoryPort
  mutation: MemoryMutationRepositoryPort
  access: MemoryAccessRepositoryPort
  embedding: MemoryEmbeddingRepositoryPort
  lifecycle: MemoryLifecycleRepositoryPort
  health: MemoryHealthRepositoryPort
  lineage: MemoryLineageRepositoryPort
  dirty: MemoryDirtyRepositoryPort
  transaction: MemoryTransactionPort
}

export function bindCapability<T extends object, K extends keyof T>(
  owner: T,
  keys: readonly K[]
): Pick<T, K> {
  return Object.fromEntries(
    keys.map((key) => {
      const value = owner[key]
      return [key, typeof value === 'function' ? value.bind(owner) : value]
    })
  ) as Pick<T, K>
}

const READ_CAPABILITY_KEYS = [
  'getById',
  'getByProvenanceKey',
  'hasTombstoneForClaim',
  'listByAgent',
  'listManagementPage',
  'listManagementVisibleByIds',
  'listByIds',
  'listApplicableByIds',
  'getActivePersona',
  'getDraftPersona',
  'listPersonaVersions',
  'search',
  'searchWithStrategy',
  'listWorkingCandidates',
  'listAgentIdsWithMemories',
  'listRecentlyActiveAgentIds',
  'hasActiveMemory',
  'listPendingMemoryClearJobs'
] as const satisfies readonly (keyof MemoryReadRepositoryPort)[]

const MUTATION_CAPABILITY_KEYS = [
  'insertInternalMemory',
  'insertClaimUnlessTombstoned',
  'insertExplicitlyReauthorizedClaim',
  'rekeyProvenance',
  'updateInternalContent',
  'updateUserContentAndInvalidateEmbedding',
  'updateUserMetadataIfRevision',
  'setConfidence',
  'setPersonaState',
  'setAnchor',
  'markSupersededIfRevision',
  'markConflictIfRevision',
  'deleteInternalMemory',
  'tombstoneAndDelete',
  'beginMemoryClear',
  'processMemoryClearBatch',
  'completeMemoryClear',
  'retireAgentMemoryNamespace'
] as const satisfies readonly (keyof MemoryMutationRepositoryPort)[]

const ACCESS_CAPABILITY_KEYS = [
  'recordAccess',
  'recordAccessBatch'
] as const satisfies readonly (keyof MemoryAccessRepositoryPort)[]

const EMBEDDING_CAPABILITY_KEYS = [
  'listPendingEmbedding',
  'countPendingEmbedding',
  'markPendingEmbeddingsReady',
  'markPendingEmbeddingsError',
  'requeueForEmbedding',
  'listEmbeddingStateIds',
  'listCurrentEmbeddedIds',
  'getCurrentEmbeddingDimension',
  'hasStaleEmbeddings',
  'countStaleEmbeddings',
  'listPrunableVectorRefs',
  'filterPrunableVectorRefs',
  'clearPrunableEmbeddingRefs'
] as const satisfies readonly (keyof MemoryEmbeddingRepositoryPort)[]

const LIFECYCLE_CAPABILITY_KEYS = [
  'getCognitiveMaintenanceInput',
  'updateDecayScore',
  'setLastConsolidatedAt',
  'getLastConsolidatedAt',
  'archiveActiveMemory',
  'restoreArchivedMemory',
  'reviveSupersededMemory',
  'activateResolvedChallenger',
  'archiveResolvedChallenger',
  'archiveResolvedConflictTarget',
  'archiveEligibleBatch',
  'countArchiveEligible',
  'listArchiveCandidateLifecycleRows',
  'countConflictPairs',
  'isUnresolvedConflictParticipant',
  'listConflictIntegrityRows',
  'listConflictChallengersForMaintenance',
  'listConflictSiblings',
  'retireConflictSiblings',
  'clearTargetConflictIfNoChallengers',
  'repairConflictIntegrityBatch',
  'repairInternalKindStatuses'
] as const satisfies readonly (keyof MemoryLifecycleRepositoryPort)[]

const HEALTH_CAPABILITY_KEYS = [
  'getHealthStats',
  'listTopAccessed',
  'countByAgent',
  'countStatusView',
  'getPersonaCounts',
  'countLegacyShadowMismatches'
] as const satisfies readonly (keyof MemoryHealthRepositoryPort)[]

const LINEAGE_CAPABILITY_KEYS = [
  'insertDerivations',
  'listDerivationsByChild',
  'listDerivationsByParent'
] as const satisfies readonly (keyof MemoryLineageRepositoryPort)[]

const DIRTY_CAPABILITY_KEYS = [
  'listDirtySeeds',
  'settleDirtySeeds',
  'deferDirtySeeds',
  'countDirtySeeds'
] as const satisfies readonly (keyof MemoryDirtyRepositoryPort)[]

const TRANSACTION_CAPABILITY_KEYS = [
  'runInTransaction'
] as const satisfies readonly (keyof MemoryTransactionPort)[]

export function createFakeRepositoryHarness(): FakeRepositoryHarness {
  const state = new FakeRepositoryBehavior()
  return {
    state,
    read: bindCapability(state, READ_CAPABILITY_KEYS),
    mutation: bindCapability(state, MUTATION_CAPABILITY_KEYS),
    access: bindCapability(state, ACCESS_CAPABILITY_KEYS),
    embedding: bindCapability(state, EMBEDDING_CAPABILITY_KEYS),
    lifecycle: bindCapability(state, LIFECYCLE_CAPABILITY_KEYS),
    health: bindCapability(state, HEALTH_CAPABILITY_KEYS),
    lineage: bindCapability(state, LINEAGE_CAPABILITY_KEYS),
    dirty: bindCapability(state, DIRTY_CAPABILITY_KEYS),
    transaction: bindCapability(state, TRANSACTION_CAPABILITY_KEYS)
  }
}

export function createFakeRepository(): FakeRepository {
  const harness = createFakeRepositoryHarness()
  return Object.assign(
    harness.state,
    harness.read,
    harness.mutation,
    harness.access,
    harness.embedding,
    harness.lifecycle,
    harness.health,
    harness.lineage,
    harness.dirty,
    harness.transaction
  ) as FakeRepository
}

function copyDirective(row: AgentMemoryDirectiveRow): AgentMemoryDirectiveRow {
  return { ...row }
}

export class FakeDirectiveRepository implements MemoryDirectiveRepositoryPort {
  readonly rows = new Map<string, AgentMemoryDirectiveRow>()

  private key(agentId: string, directiveId: string): string {
    return JSON.stringify([agentId, directiveId])
  }

  private findByIdentity(
    agentId: string,
    kind: AgentMemoryDirectiveRow['kind'],
    identityHash: string
  ): AgentMemoryDirectiveRow | undefined {
    return [...this.rows.values()].find(
      (row) => row.agent_id === agentId && row.kind === kind && row.identity_hash === identityHash
    )
  }

  getDirective(agentId: string, directiveId: string): AgentMemoryDirectiveRow | undefined {
    const row = this.rows.get(this.key(agentId, directiveId))
    return row ? copyDirective(row) : undefined
  }

  listDirectives(
    agentId: string,
    options: {
      statuses?: readonly AgentMemoryDirectiveRow['status'][]
      limit?: number
    } = {}
  ): AgentMemoryDirectiveRow[] {
    const statuses = options.statuses?.length ? new Set(options.statuses) : null
    const limit = Math.min(200, Math.max(0, Math.floor(options.limit ?? 100)))
    return [...this.rows.values()]
      .filter((row) => row.agent_id === agentId && (!statuses || statuses.has(row.status)))
      .sort((left, right) => right.updated_at - left.updated_at || left.id.localeCompare(right.id))
      .slice(0, limit)
      .map(copyDirective)
  }

  listActiveDirectives(agentId: string, limit: number): AgentMemoryDirectiveRow[] {
    return this.listDirectives(agentId, { statuses: ['active'], limit })
  }

  upsertExplicitDirective(input: MemoryDirectiveWriteInput): MemoryDirectiveWriteResult {
    if (input.status !== 'active' || input.source === 'derived_suggestion') {
      throw new Error('[Memory] explicit directives must enter the active trust state')
    }
    const existing = this.findByIdentity(input.agentId, input.kind, input.identityHash)
    if (
      existing?.status !== 'active' &&
      this.countDirectivesByStatus(input.agentId).active >= AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT
    ) {
      return { action: 'capacity', row: null }
    }
    if (
      existing?.status === input.status &&
      existing.source === input.source &&
      existing.content === input.content &&
      existing.normalized_topic === input.normalizedTopic
    ) {
      return { action: 'unchanged', row: copyDirective(existing) }
    }
    const row: AgentMemoryDirectiveRow = existing
      ? {
          ...existing,
          status: input.status,
          source: input.source,
          content: input.content,
          normalized_topic: input.normalizedTopic,
          updated_at: Math.max(existing.updated_at, input.updatedAt)
        }
      : {
          agent_id: input.agentId,
          id: input.id,
          kind: input.kind,
          status: input.status,
          source: input.source,
          content: input.content,
          normalized_topic: input.normalizedTopic,
          identity_hash: input.identityHash,
          created_at: input.createdAt,
          updated_at: input.updatedAt
        }
    this.rows.set(this.key(row.agent_id, row.id), row)
    return { action: existing ? 'updated' : 'created', row: copyDirective(row) }
  }

  insertDerivedDirectiveDraft(input: MemoryDirectiveWriteInput): MemoryDirectiveInsertResult {
    if (input.status !== 'draft' || input.source !== 'derived_suggestion') {
      throw new Error('[Memory] derived directives must enter the draft trust state')
    }
    const existing = this.findByIdentity(input.agentId, input.kind, input.identityHash)
    if (existing) return { inserted: false, row: copyDirective(existing) }
    const row: AgentMemoryDirectiveRow = {
      agent_id: input.agentId,
      id: input.id,
      kind: input.kind,
      status: 'draft',
      source: 'derived_suggestion',
      content: input.content,
      normalized_topic: input.normalizedTopic,
      identity_hash: input.identityHash,
      created_at: input.createdAt,
      updated_at: input.updatedAt
    }
    this.rows.set(this.key(row.agent_id, row.id), row)
    return { inserted: true, row: copyDirective(row) }
  }

  transitionDirective(
    agentId: string,
    directiveId: string,
    fromStatus: AgentMemoryDirectiveRow['status'],
    toStatus: AgentMemoryDirectiveRow['status'],
    updatedAt: number
  ): MemoryDirectiveTransitionResult {
    if (fromStatus !== 'draft' || (toStatus !== 'active' && toStatus !== 'rejected')) {
      throw new Error('[Memory] invalid directive trust transition')
    }
    const key = this.key(agentId, directiveId)
    const row = this.rows.get(key)
    if (!row || row.status !== fromStatus) return { action: 'not-found', row: null }
    if (
      toStatus === 'active' &&
      this.countDirectivesByStatus(agentId).active >= AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT
    ) {
      return { action: 'capacity', row: null }
    }
    const updated = {
      ...row,
      status: toStatus,
      updated_at: Math.max(row.updated_at, Math.max(0, Math.floor(updatedAt)))
    }
    this.rows.set(key, updated)
    return { action: 'transitioned', row: copyDirective(updated) }
  }

  deleteDirective(agentId: string, directiveId: string): AgentMemoryDirectiveRow | null {
    const key = this.key(agentId, directiveId)
    const row = this.rows.get(key)
    if (!row) return null
    this.rows.delete(key)
    return copyDirective(row)
  }

  countDirectivesByStatus(agentId: string): MemoryDirectiveCounts {
    const counts: MemoryDirectiveCounts = { draft: 0, active: 0, rejected: 0 }
    for (const row of this.rows.values()) {
      if (row.agent_id === agentId) counts[row.status] += 1
    }
    return counts
  }

  retireDirectiveNamespace(agentId: string): number {
    let removed = 0
    for (const [key, row] of this.rows) {
      if (row.agent_id !== agentId) continue
      this.rows.delete(key)
      removed += 1
    }
    return removed
  }
}

export class FakeAuditRepository implements MemoryAuditRepositoryPort {
  rows: AgentMemoryAuditRow[] = []

  insert(input: AgentMemoryAuditInsertInput): AgentMemoryAuditRow {
    const row: AgentMemoryAuditRow = {
      id: input.id,
      agent_id: input.agentId,
      event_type: input.eventType,
      actor_type: input.actorType,
      session_id: input.sessionId ?? null,
      memory_ref_id:
        typeof input.outputRefs?.memoryId === 'string'
          ? input.outputRefs.memoryId
          : typeof input.inputRefs?.memoryId === 'string'
            ? input.inputRefs.memoryId
            : null,
      input_refs_json: JSON.stringify(input.inputRefs ?? {}),
      output_refs_json: JSON.stringify(input.outputRefs ?? {}),
      model_provider_id: input.modelProviderId ?? null,
      model_id: input.modelId ?? null,
      status: input.status,
      reason: input.reason ?? null,
      created_at: input.createdAt ?? Date.now()
    }
    this.rows.push(row)
    return row
  }

  listByAgent(
    agentId: string,
    optionsOrLimit: number | MemoryAuditListOptions = 100
  ): AgentMemoryAuditRow[] {
    const options = typeof optionsOrLimit === 'number' ? { limit: optionsOrLimit } : optionsOrLimit
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit ?? 100)))
    return this.rows
      .filter((row) => row.agent_id === agentId)
      .filter((row) => !options.eventType || row.event_type === options.eventType)
      .filter((row) => !options.actorType || row.actor_type === options.actorType)
      .filter((row) => !options.sessionId || row.session_id === options.sessionId)
      .filter((row) => !options.status || row.status === options.status)
      .filter(
        (row) =>
          !Number.isFinite(options.startCreatedAt) ||
          row.created_at >= (options.startCreatedAt as number)
      )
      .filter(
        (row) =>
          !Number.isFinite(options.endCreatedAt) ||
          row.created_at <= (options.endCreatedAt as number)
      )
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, limit)
  }

  getLatestCompletedEventAt(agentId: string, eventType: string): number | null {
    let latest: number | null = null
    for (const row of this.rows) {
      if (row.agent_id !== agentId || row.event_type !== eventType || row.status !== 'completed') {
        continue
      }
      if (latest === null || row.created_at > latest) latest = row.created_at
    }
    return latest
  }

  hasForgetEvent(agentId: string, memoryId: string): boolean {
    const rows = this.rows
      .filter((row) => {
        if (row.agent_id !== agentId || row.status !== 'completed') return false
        return (
          (row.event_type === 'memory/forget' && row.actor_type === 'runtime') ||
          (row.event_type === 'memory/archive' && row.actor_type === 'user') ||
          row.event_type === 'memory/restore'
        )
      })
      .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
    for (const row of rows) {
      const input = JSON.parse(row.input_refs_json) as Record<string, unknown>
      const output = JSON.parse(row.output_refs_json) as Record<string, unknown>
      if (input.memoryId !== memoryId && output.memoryId !== memoryId) continue
      return row.event_type !== 'memory/restore'
    }
    return false
  }

  getHealthAuditStats(
    agentId: string,
    scanLimit: number,
    failuresLimit: number
  ): AgentMemoryHealthAuditStats {
    const events = this.listByAgent(agentId, { limit: scanLimit })
    const stats: AgentMemoryHealthAuditStats = {
      completed: 0,
      skipped: 0,
      failed: 0,
      recentFailures: []
    }
    for (const event of events) {
      stats[event.status] += 1
      if (
        (event.status === 'failed' || event.status === 'skipped') &&
        stats.recentFailures.length < failuresLimit
      ) {
        stats.recentFailures.push({
          eventType: event.event_type,
          status: event.status,
          reason: event.reason,
          createdAt: event.created_at
        })
      }
    }
    return stats
  }

  pruneOperationalEvents(agentId: string, keep = 10_000, limit = 500): number {
    const operationalTypes = new Set([
      'memory/maintenance_llm',
      'memory/reflect',
      'memory/repair',
      'memory/conflict_repair',
      'memory/extract'
    ])
    const normalizedKeep = Math.max(0, Math.floor(keep))
    const normalizedLimit = Math.min(500, Math.max(0, Math.floor(limit)))
    const prunableIds = this.rows
      .filter((row) => row.agent_id === agentId && operationalTypes.has(row.event_type))
      .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
      .slice(normalizedKeep, normalizedKeep + normalizedLimit)
      .map((row) => row.id)
    const prunable = new Set(prunableIds)
    this.rows = this.rows.filter((row) => !prunable.has(row.id))
    return prunable.size
  }
}

export class FakeVectorStore implements IMemoryVectorStore {
  vectors = new Map<string, number[]>()
  closeCount = 0

  async upsert(records: MemoryVectorRecord[]) {
    for (const record of records) this.vectors.set(record.memoryId, record.embedding)
  }

  async query(embedding: number[], options: { topK: number }): Promise<MemoryVectorMatch[]> {
    return [...this.vectors.entries()]
      .map(([memoryId, vec]) => ({ memoryId, distance: 1 - cosine(embedding, vec) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, options.topK)
  }

  async queryByMemoryId(memoryId: string, options: { topK: number }): Promise<MemoryVectorMatch[]> {
    const embedding = this.vectors.get(memoryId)
    if (!embedding) return []
    return [...this.vectors.entries()]
      .filter(([id]) => id !== memoryId)
      .map(([id, vec]) => ({ memoryId: id, distance: 1 - cosine(embedding, vec) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, options.topK)
  }

  async deleteByMemoryIds(memoryIds: string[]) {
    for (const id of memoryIds) this.vectors.delete(id)
  }

  async listMemoryIds(afterId: string | null, limit: number) {
    return [...this.vectors.keys()]
      .filter((id) => afterId === null || id > afterId)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, Math.max(0, Math.floor(limit)))
  }

  async close() {
    this.closeCount += 1
  }

  isUsable() {
    return true
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

// Maps text to a keyword-correlated toy vector so similarity ordering is assertable.
export function textToVector(text: string): number[] {
  const t = text.toLowerCase()
  return [t.includes('redis') ? 1 : 0, t.includes('vue') ? 1 : 0, t.includes('简洁') ? 1 : 0, 0.01]
}

export const enabledConfig: DeepChatAgentConfig = {
  memoryEnabled: true,
  memoryEmbedding: { providerId: 'p', modelId: 'm' }
}

export function makePresenter(
  config: DeepChatAgentConfig | null,
  repo = createFakeRepository(),
  options: {
    isManagedAgent?: (agentId: string) => boolean
    directiveRepository?: MemoryDirectiveRepositoryPort
    markVectorStoreQuarantined?: MemoryServiceDeps['markVectorStoreQuarantined']
    onMemoryChanged?: MemoryServiceDeps['onMemoryChanged']
    clock?: MemoryServiceDeps['clock']
  } = {}
) {
  const store = new FakeVectorStore()
  const auditRepo = new FakeAuditRepository()
  const directiveRepo = options.directiveRepository ?? new FakeDirectiveRepository()
  const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) =>
    texts.map((text) => textToVector(text))
  )
  const getDimensions = vi.fn(async () => ({
    data: { dimensions: textToVector('').length, normalized: false }
  }))
  // Models the on-disk reset: clearing memories deletes the agent's vector file.
  const resetVectorStore = vi.fn(async () => {
    store.vectors.clear()
  })
  const presenter = new MemoryService({
    executeWithRateLimit: vi.fn(async () => undefined),
    repository: repo,
    directiveRepository: directiveRepo,
    auditRepository: auditRepo,
    resolveAgentConfig: () => config,
    isManagedAgent: options.isManagedAgent,
    ...(options.markVectorStoreQuarantined
      ? { markVectorStoreQuarantined: options.markVectorStoreQuarantined }
      : {}),
    onMemoryChanged: options.onMemoryChanged,
    getEmbeddings,
    getDimensions,
    generateText: vi.fn(async () => ''),
    createVectorStore: async () => store,
    resetVectorStore,
    clock: options.clock
  })
  return {
    presenter,
    repo,
    directiveRepo,
    auditRepo,
    store,
    getEmbeddings,
    getDimensions,
    resetVectorStore
  }
}
