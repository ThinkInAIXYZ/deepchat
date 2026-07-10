import { vi } from 'vitest'

import { MemoryPresenter } from '@/presenter/memoryPresenter'
import {
  AGENT_MEMORY_CATEGORIES,
  AGENT_MEMORY_HEALTH_KIND_KEYS,
  AGENT_MEMORY_HEALTH_STATUS_KEYS,
  isAgentMemoryCategory
} from '@shared/types/agent-memory'
import type {
  AgentMemoryAuditInsertInput,
  AgentMemoryAuditRow,
  AgentMemoryHealthAuditStats,
  AgentMemoryHealthStats,
  AgentMemoryInsertInput,
  AgentMemoryLifecycleRow,
  AgentMemoryRow,
  AgentMemoryWorkingCandidateCursor,
  IMemoryVectorStore,
  MemoryAuditListOptions,
  MemoryAuditRepositoryPort,
  MemoryRepositoryPort,
  MemoryVectorMatch,
  MemoryVectorRecord
} from '@/presenter/memoryPresenter/types'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'

function toLifecycleRow(row: AgentMemoryRow): AgentMemoryLifecycleRow {
  return {
    id: row.id,
    agent_id: row.agent_id,
    kind: row.kind,
    importance: row.importance,
    status: row.status,
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
export class FakeRepository implements MemoryRepositoryPort {
  rows = new Map<string, AgentMemoryRow>()
  transactionCalls = 0

  insert(input: AgentMemoryInsertInput): AgentMemoryRow {
    if (input.provenanceKey) {
      for (const row of this.rows.values()) {
        if (row.agent_id === input.agentId && row.provenance_key === input.provenanceKey) {
          throw new Error('UNIQUE constraint failed')
        }
      }
    }
    const row: AgentMemoryRow = {
      id: input.id,
      agent_id: input.agentId,
      user_scope: input.userScope ?? null,
      kind: input.kind,
      category: input.category ?? null,
      content: input.content,
      importance: input.importance ?? 0.5,
      status: input.status ?? 'pending_embedding',
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
      last_consolidated_at: null,
      conflict_state: null,
      conflict_with: input.conflictWith ?? null,
      persona_state: input.personaState ?? null,
      decision_revision: 1
    }
    this.rows.set(row.id, row)
    return row
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

  listByIds(agentId: string, ids: string[]) {
    const idSet = new Set(ids)
    return [...this.rows.values()].filter((row) => row.agent_id === agentId && idSet.has(row.id))
  }

  getActivePersona(agentId: string) {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.agent_id === agentId &&
          row.kind === 'persona' &&
          (row.persona_state === 'active' ||
            (row.persona_state == null && row.superseded_by === null))
      )
      .sort((a, b) => b.created_at - a.created_at)[0]
  }

  getDraftPersona(agentId: string) {
    return [...this.rows.values()]
      .filter(
        (row) => row.agent_id === agentId && row.kind === 'persona' && row.persona_state === 'draft'
      )
      .sort((a, b) => b.created_at - a.created_at)[0]
  }

  setPersonaState(id: string, state: string, supersededBy?: string | null) {
    const row = this.rows.get(id)
    if (!row) return
    row.persona_state = state
    if (supersededBy !== undefined) row.superseded_by = supersededBy
    row.decision_revision += 1
  }

  setAnchor(id: string, anchored: boolean) {
    const row = this.rows.get(id)
    if (row) {
      row.is_anchor = anchored ? 1 : 0
      row.decision_revision += 1
    }
  }

  listPersonaVersions(agentId: string) {
    return [...this.rows.values()]
      .filter((row) => row.agent_id === agentId && row.kind === 'persona')
      .sort((a, b) => b.created_at - a.created_at)
  }

  search(agentId: string, query: string, limit = 20, options: { matchMode?: 'all' | 'any' } = {}) {
    const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean)
    if (!terms.length) return []
    const matchMode = options.matchMode ?? 'all'
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.agent_id === agentId &&
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

  getRecallKeywordTermStats(agentId: string, terms: string[]) {
    const normalizedTerms = [...new Set(terms.map((term) => term.trim().toLowerCase()))].filter(
      Boolean
    )
    const rows = [...this.rows.values()].filter(
      (row) =>
        row.agent_id === agentId &&
        !row.superseded_by &&
        row.conflict_state === null &&
        row.status !== 'archived' &&
        row.status !== 'conflicted' &&
        row.kind !== 'persona' &&
        row.kind !== 'working'
    )
    return normalizedTerms.map((term) => ({
      term,
      hitCount: rows.filter((row) => row.content.toLowerCase().includes(term)).length,
      totalRows: rows.length
    }))
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

  updateStatus(
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
    row.status = status
    row.embedding_id = embedding?.embeddingId ?? null
    row.embedding_dim = embedding?.embeddingDim ?? null
    row.embedding_model = embedding?.embeddingModel ?? null
  }

  activateForEmbedding(id: string) {
    const row = this.rows.get(id)
    if (!row) return
    row.status = 'pending_embedding'
    row.embedding_id = null
    row.embedding_dim = null
    row.embedding_model = null
    row.decision_revision += 1
  }

  updatePendingEmbeddingStatus(
    agentId: string,
    id: string,
    status: AgentMemoryRow['status'],
    embedding?: {
      embeddingId?: string | null
      embeddingDim?: number | null
      embeddingModel?: string | null
    }
  ) {
    const row = this.rows.get(id)
    if (
      !row ||
      row.agent_id !== agentId ||
      row.status !== 'pending_embedding' ||
      row.superseded_by ||
      row.kind === 'persona' ||
      row.kind === 'working'
    ) {
      return false
    }
    row.status = status
    row.embedding_id = embedding?.embeddingId ?? null
    row.embedding_dim = embedding?.embeddingDim ?? null
    row.embedding_model = embedding?.embeddingModel ?? null
    return true
  }

  requeueForEmbedding(
    agentId: string,
    statuses: AgentMemoryRow['status'][],
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
          statuses.includes(row.status) &&
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
      if (!statuses.includes(row.status)) continue
      row.status = 'pending_embedding'
      row.embedding_id = null
      row.embedding_dim = null
      row.embedding_model = null
      changed += 1
    }
    return changed
  }

  listEmbeddingStatusIds(
    agentId: string,
    statuses: AgentMemoryRow['status'][],
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
          statuses.includes(row.status) &&
          (!afterId || row.id > afterId)
      )
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, Math.max(0, Math.floor(limit)))
      .map((row) => row.id)
  }

  markSuperseded(id: string, supersededBy: string | null) {
    const row = this.rows.get(id)
    if (row) {
      row.superseded_by = supersededBy
      row.decision_revision += 1
    }
  }

  markSupersededIfRevision(
    agentId: string,
    id: string,
    expectedRevision: number,
    supersededBy: string
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
    row.superseded_by = supersededBy
    row.decision_revision += 1
    return true
  }

  recordAccess(id: string, accessedAt = 0) {
    const row = this.rows.get(id)
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
    const row = this.rows.get(id)
    if (row) {
      row.decay_score = decayScore
      if (consolidatedAt !== null) row.last_consolidated_at = consolidatedAt
    }
  }

  refreshDecayScoresForAgent(agentId: string, now: number, halfLifeMs: number) {
    for (const row of this.listByAgent(agentId)) {
      if (row.kind === 'persona') continue
      const anchor = row.last_accessed ?? row.created_at
      const age = Math.max(0, now - anchor)
      const importance = Math.min(1, Math.max(0, row.importance))
      row.decay_score = Math.pow(0.5, age / (halfLifeMs * (1 + importance)))
    }
  }

  stampConsolidationForAgent(agentId: string, at: number) {
    for (const row of this.listByAgent(agentId)) {
      if (row.kind === 'persona') continue
      row.last_consolidated_at = at
    }
  }

  updateContent(
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
    }
  }

  updateDecisionContentIfRevision(input: {
    agentId: string
    id: string
    expectedRevision: number
    content: string
    provenanceKey: string | null
    at: number
    category?: string | null
  }) {
    const { agentId, id, expectedRevision, content, provenanceKey, at, category } = input
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
    row.content = content
    row.provenance_key = provenanceKey
    row.last_accessed = at
    if (category !== undefined) row.category = category
    row.status = 'pending_embedding'
    row.embedding_id = null
    row.embedding_dim = null
    row.embedding_model = null
    row.decision_revision += 1
    return true
  }

  updateUserMetadata(
    id: string,
    patch: {
      category?: string | null
      importance?: number
    }
  ) {
    const row = this.rows.get(id)
    if (!row) return
    if (Object.prototype.hasOwnProperty.call(patch, 'category')) {
      row.category = patch.category ?? null
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'importance')) {
      row.importance = patch.importance ?? row.importance
    }
    row.decision_revision += 1
  }

  setConfidence(id: string, confidence: number) {
    const row = this.rows.get(id)
    if (row)
      row.confidence = row.confidence === null ? confidence : Math.max(row.confidence, confidence)
  }

  setImportance(id: string, importance: number) {
    const row = this.rows.get(id)
    if (row && row.importance < importance) {
      row.importance = importance
      row.decision_revision += 1
    }
  }

  markConflict(id: string, state: 'challenged' | null) {
    const row = this.rows.get(id)
    if (row) {
      row.conflict_state = state
      row.decision_revision += 1
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
    return true
  }

  setConflictWith(id: string, targetId: string | null) {
    const row = this.rows.get(id)
    if (row) {
      row.conflict_with = targetId
      row.decision_revision += 1
    }
  }

  setLastConsolidatedAt(id: string, at = 0) {
    const row = this.rows.get(id)
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

  archive(id: string, _at = 0) {
    const row = this.rows.get(id)
    if (row) {
      row.status = 'archived'
      row.decision_revision += 1
    }
  }

  listArchiveCandidates(agentId: string, before: number, decayBelow: number) {
    return [...this.rows.values()].filter(
      (row) =>
        row.agent_id === agentId &&
        !row.superseded_by &&
        row.status !== 'archived' &&
        row.status !== 'conflicted' &&
        row.is_anchor === 0 &&
        row.kind !== 'persona' &&
        row.kind !== 'working' &&
        row.access_count === 0 &&
        row.created_at < before &&
        row.decay_score !== null &&
        row.decay_score < decayBelow
    )
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
          row.access_count === 0 &&
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

  countArchiveCandidates(agentId: string, before: number, decayBelow: number) {
    return this.listArchiveCandidates(agentId, before, decayBelow).length
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
    this.rows.delete(id)
  }

  clearByAgent(agentId: string) {
    let removed = 0
    for (const [id, row] of this.rows) {
      if (row.agent_id === agentId) {
        this.rows.delete(id)
        removed += 1
      }
    }
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
        challenger.conflict_with === memoryId
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

  getPersonaCounts(agentId: string): { total: number; draft: number } {
    const versions = this.listPersonaVersions(agentId)
    return {
      total: versions.filter(
        (row) => row.persona_state !== 'draft' && row.persona_state !== 'rejected'
      ).length,
      draft: versions.filter((row) => row.persona_state === 'draft').length
    }
  }

  runInTransaction<T>(fn: () => T): T {
    this.transactionCalls += 1
    const snapshot = new Map([...this.rows.entries()].map(([id, row]) => [id, { ...row }]))
    try {
      return fn()
    } catch (error) {
      this.rows = snapshot
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

  listConsolidationScanRows(
    agentId: string,
    options: {
      embeddingDim: number
      embeddingModel: string
      after?: { createdAt: number; id: string }
      limit: number
    }
  ) {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.agent_id === agentId &&
          row.status === 'embedded' &&
          row.superseded_by === null &&
          row.kind !== 'persona' &&
          row.kind !== 'working' &&
          row.embedding_dim === options.embeddingDim &&
          row.embedding_model === options.embeddingModel &&
          (!options.after ||
            row.created_at > options.after.createdAt ||
            (row.created_at === options.after.createdAt && row.id > options.after.id))
      )
      .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
      .slice(0, Math.max(0, Math.floor(options.limit)))
  }

  repairInternalKindStatuses(agentId: string) {
    let changed = 0
    for (const row of this.rows.values()) {
      if (row.agent_id !== agentId || (row.kind !== 'persona' && row.kind !== 'working')) continue
      if (row.status === 'fts_only') continue
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
      changed += 1
    }
    return changed
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
  repo = new FakeRepository(),
  options: {
    isManagedAgent?: (agentId: string) => boolean
    onMemoryChanged?: MemoryPresenterDeps['onMemoryChanged']
  } = {}
) {
  const store = new FakeVectorStore()
  const auditRepo = new FakeAuditRepository()
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
  const presenter = new MemoryPresenter({
    executeWithRateLimit: vi.fn(async () => undefined),
    repository: repo,
    auditRepository: auditRepo,
    resolveAgentConfig: () => config,
    isManagedAgent: options.isManagedAgent,
    onMemoryChanged: options.onMemoryChanged,
    getEmbeddings,
    getDimensions,
    generateText: vi.fn(async () => ''),
    createVectorStore: async () => store,
    resetVectorStore
  })
  return { presenter, repo, auditRepo, store, getEmbeddings, getDimensions, resetVectorStore }
}
