import logger from '@shared/logger'
import { nanoid } from 'nanoid'

import {
  DEFAULT_SIMILARITY_THRESHOLD,
  FTS_SIMILARITY_BASELINE,
  isSafeAgentId,
  type AgentMemoryRow,
  type IMemoryVectorStore,
  type MemoryCandidate,
  type MemoryPresenterDeps,
  type MemoryRecallItem,
  type MemoryStatus,
  type MemoryVectorRecord,
  type WriteMemoriesOptions
} from './types'
import {
  buildMemoryProvenanceKey,
  distanceToSimilarity,
  resolveRetrieval,
  retrievalScore
} from './scoring'
import {
  appendMemorySection,
  buildMemorySection,
  type MemoryInjectionPayload,
  type MemoryInjectionPort,
  type MemoryRuntimePort
} from './injectionPort'
import {
  buildExtractionPrompt,
  buildTriagePrompt,
  parseMemoryCandidates,
  parseTriageDecision
} from './extraction'
import { buildReflectionPrompt, sanitizeSelfModel } from './extraction'
import type { MemoryExtractionInput, MemoryExtractionResult, MemoryUpdateReason } from './types'

export { appendMemorySection, buildMemorySection, isSafeAgentId }
export type { MemoryInjectionPayload, MemoryInjectionPort, MemoryRuntimePort }

// Minimum non-persona memories before reflection can run.
const MIN_MEMORIES_FOR_REFLECTION = 3
// Reflect once every N accumulated memories.
const REFLECT_EVERY_N_MEMORIES = 5
// Max memories fed into a single reflection prompt.
const REFLECTION_MEMORY_LIMIT = 20

function isUniqueConstraintError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true
  const message = error instanceof Error ? error.message : String(error)
  return /UNIQUE constraint failed/i.test(message)
}

export class MemoryPresenter implements MemoryRuntimePort {
  // One DuckDB sidecar per agent (keyed by agentId, not by embedding identity, because the
  // file path is per-agent). Caches the in-flight create promise so concurrent callers share
  // one open. The identity it was opened with is tracked separately to re-open on model/dim
  // switch. All open/close/reset go through a per-agent lock so the same file is never opened
  // by two DuckDBInstances at once.
  private readonly vectorStores = new Map<string, Promise<IMemoryVectorStore>>()
  private readonly vectorStoreIdentities = new Map<string, string>()
  private readonly vectorStoreLocks = new Map<string, Promise<unknown>>()
  // Serializes an agent's embedding drains. Distinct from vectorStoreLocks on purpose: this one
  // spans the network embedding call, the file lock must not.
  private readonly embeddingDrains = new Map<string, Promise<unknown>>()

  constructor(private readonly deps: MemoryPresenterDeps) {}

  isEnabled(agentId: string): boolean {
    return this.deps.resolveAgentConfig(agentId)?.memoryEnabled === true
  }

  // Rejects malformed agentIds (caller bug or abuse attempt) before they reach storage.
  private assertSafeAgentId(agentId: string): void {
    if (!isSafeAgentId(agentId)) {
      throw new Error(`[Memory] invalid agentId: ${JSON.stringify(agentId)}`)
    }
  }

  // Falls back to format validation only when no strict existence checker was injected.
  private isManagedAgent(agentId: string): boolean {
    return this.deps.isManagedAgent ? this.deps.isManagedAgent(agentId) : true
  }

  private emitChanged(agentId: string, reason: MemoryUpdateReason): void {
    this.deps.onMemoryChanged?.(agentId, reason)
  }

  // Phase 1 (synchronous, inside the caller's transaction): write memory rows as
  // pending_embedding with idempotent dedup. Returns the ids of newly-created (non-duplicate)
  // memories so the caller can anchor them on the tape and trigger phase 2.
  writeMemoriesSync(candidates: MemoryCandidate[], options: WriteMemoriesOptions): string[] {
    if (!candidates.length) return []
    const sourceSession = options.sourceSession ?? null
    // Tape entry_id lineage is only meaningful when scoped by a session; drop it otherwise
    // so a stray id can never be stored without a session to resolve it against.
    const sourceEntryIds = sourceSession ? (options.sourceEntryIds ?? null) : null
    const created: string[] = []
    for (const candidate of candidates) {
      const content = candidate.content.trim()
      if (!content) continue
      const provenanceKey = buildMemoryProvenanceKey(options.agentId, candidate.kind, content)
      if (this.deps.repository.getByProvenanceKey(options.agentId, provenanceKey)) {
        continue
      }
      const id = `mem-${nanoid(12)}`
      try {
        this.deps.repository.insert({
          id,
          agentId: options.agentId,
          kind: candidate.kind,
          content,
          importance: candidate.importance,
          status: 'pending_embedding',
          sourceSession,
          userScope: options.userScope ?? null,
          provenanceKey,
          sourceEntryIds
        })
        created.push(id)
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error
        // Unique-index race: treat as already present and skip.
        logger.warn(`[Memory] insert skipped (dedupe/race): ${String(error)}`)
      }
    }
    return created
  }

  // Serializes an agent's drains so two background triggers can't list and embed the same
  // pending rows at once (duplicate, costly getEmbeddings calls). An uncontended call starts
  // its drain synchronously; a contended one queues behind the in-flight drain and then finds
  // the rows already embedded. A failing drain never breaks the chain for the next one.
  processPendingEmbeddings(agentId: string, limit = 50): Promise<void> {
    const prev = this.embeddingDrains.get(agentId)
    const run = prev
      ? prev.then(
          () => this.drainPendingEmbeddings(agentId, limit),
          () => this.drainPendingEmbeddings(agentId, limit)
        )
      : this.drainPendingEmbeddings(agentId, limit)
    const tracked = run.then(
      () => undefined,
      () => undefined
    )
    this.embeddingDrains.set(agentId, tracked)
    void tracked.finally(() => {
      if (this.embeddingDrains.get(agentId) === tracked) {
        this.embeddingDrains.delete(agentId)
      }
    })
    return run
  }

  // Phase 2 (asynchronous, outside any transaction): embed the agent's pending_embedding
  // memories, write the vectors to its sidecar, and backfill status. With no embedding config
  // the rows are marked fts_only (still recallable via FTS).
  //
  // Pending rows are fetched scoped to this agent (SQL-level), embedded in a single batched
  // call, and written to the sidecar in one transaction under the per-agent lock. Scoping at
  // the query keeps a high-producing agent from consuming another agent's embedding budget.
  private async drainPendingEmbeddings(agentId: string, limit: number): Promise<void> {
    const config = this.deps.resolveAgentConfig(agentId)
    const pending = this.deps.repository.listPendingEmbedding(limit, agentId)
    if (!pending.length) return

    const embedding = config?.memoryEmbedding
    if (!embedding?.providerId || !embedding?.modelId) {
      for (const row of pending) {
        this.deps.repository.updateStatus(row.id, 'fts_only')
      }
      return
    }

    try {
      const vectors = await this.deps.getEmbeddings(
        embedding.providerId,
        embedding.modelId,
        pending.map((row) => row.content)
      )
      const dim = vectors.find((vector) => vector?.length)?.length ?? 0
      const records: MemoryVectorRecord[] = []
      for (let i = 0; i < pending.length; i += 1) {
        const vector = vectors[i]
        if (dim > 0 && vector?.length === dim) {
          records.push({ memoryId: pending[i].id, embedding: vector })
        } else {
          this.deps.repository.updateStatus(pending[i].id, 'error')
        }
      }
      if (!records.length) return

      // Open the store and write the whole batch under one per-agent lock, re-checking row
      // existence INSIDE the lock: a clear that ran during the embedding await drops those
      // rows here so it cannot interleave to resurrect the sidecar with stale vectors.
      const outcome = await this.runExclusiveForAgent(agentId, async () => {
        const live = records.filter((record) => this.deps.repository.getById(record.memoryId))
        if (!live.length) return { written: new Set<string>(), usable: true }
        const store = await this.openVectorStoreLocked(
          agentId,
          { providerId: embedding.providerId, modelId: embedding.modelId },
          dim
        )
        if (!store.isUsable()) return { written: new Set<string>(), usable: false }
        await store.upsert(live)
        return { written: new Set(live.map((record) => record.memoryId)), usable: true }
      })

      for (const record of records) {
        if (outcome.written.has(record.memoryId)) {
          this.deps.repository.updateStatus(record.memoryId, 'embedded', {
            embeddingId: record.memoryId,
            embeddingDim: dim
          })
        } else if (!outcome.usable) {
          this.deps.repository.updateStatus(record.memoryId, 'error')
        }
        // Rows cleared mid-flight are absent from `written`; their row no longer exists.
      }
    } catch (error) {
      logger.error(`[Memory] batch embedding failed for ${agentId}: ${String(error)}`)
      for (const row of pending) {
        this.deps.repository.updateStatus(row.id, 'error')
      }
    }
  }

  // Extracts memories from a span via an independent cheap LLM call and writes them. Returns
  // { ok:true, createdIds } on success (createdIds may be empty) or { ok:false } on failure.
  // Never throws and never disrupts the chat; on failure the caller keeps its cursor for retry.
  async extractAndStore(input: MemoryExtractionInput): Promise<MemoryExtractionResult> {
    // Disabled or empty span: a successful no-op consume, so the caller may advance its cursor.
    if (!this.isEnabled(input.agentId)) return { ok: true, createdIds: [] }
    const span = input.spanText.trim()
    if (!span) return { ok: true, createdIds: [] }
    const model = this.resolveExtractionModel(input.agentId, input.model)
    try {
      // Cheap triage gate: skip the larger extraction call on spans with nothing durable.
      // A triage failure is non-fatal — fall through to extraction so facts are never dropped.
      let shouldExtract = true
      try {
        const triage = await this.deps.generateText(
          model.providerId,
          model.modelId,
          buildTriagePrompt(span)
        )
        shouldExtract = parseTriageDecision(triage)
      } catch (error) {
        logger.warn(`[Memory] triage skipped, extracting anyway: ${String(error)}`)
      }
      if (!shouldExtract) return { ok: true, createdIds: [] }

      const response = await this.deps.generateText(
        model.providerId,
        model.modelId,
        buildExtractionPrompt(span)
      )
      const candidates = parseMemoryCandidates(response)
      const created = candidates.length
        ? this.writeMemoriesSync(candidates, {
            agentId: input.agentId,
            sourceSession: input.sourceSession ?? null,
            sourceEntryIds: input.sourceEntryIds ?? null
          })
        : []
      if (created.length) {
        this.emitChanged(input.agentId, 'extract')
        // Phase 2 embedding runs in the background; it must not block the caller.
        void this.processPendingEmbeddings(input.agentId).catch((error) => {
          logger.warn(`[Memory] background embedding failed: ${String(error)}`)
        })
      }
      return { ok: true, createdIds: created }
    } catch (error) {
      // Model/parse failure: return ok:false so the caller keeps its cursor for a later retry.
      logger.warn(`[Memory] extraction failed: ${String(error)}`)
      return { ok: false }
    }
  }

  // Explicit memory write (the `memory_remember` tool path): write + async embed + broadcast.
  // Shares the 'extract' change reason with auto-extraction; subscribers refresh by agentId
  // and do not distinguish finer reasons.
  async rememberMemory(
    candidate: MemoryCandidate,
    options: WriteMemoriesOptions
  ): Promise<string[]> {
    const created = this.writeMemoriesSync([candidate], options)
    if (created.length) {
      this.emitChanged(options.agentId, 'extract')
      void this.processPendingEmbeddings(options.agentId).catch((error) => {
        logger.warn(`[Memory] background embedding failed: ${String(error)}`)
      })
    }
    return created
  }

  // Hybrid recall: vector (embedded rows only) + FTS, ranked by combined score and capped at
  // top-K. Degrades to FTS-only when the agent has no embedding config.
  async recall(agentId: string, query: string, now = Date.now()): Promise<MemoryRecallItem[]> {
    const config = this.deps.resolveAgentConfig(agentId)
    const { topK, weights } = resolveRetrieval(config?.memoryRetrieval)
    const normalizedQuery = query.trim()

    const scored = new Map<string, MemoryRecallItem>()

    // FTS recall covers any status that still has content (embedded | fts_only | error).
    if (normalizedQuery) {
      for (const row of this.deps.repository.search(agentId, normalizedQuery, topK * 2)) {
        scored.set(row.id, this.toRecallItem(row, FTS_SIMILARITY_BASELINE, now, weights))
      }
    }

    // Vector recall (embedded rows only).
    const embedding = config?.memoryEmbedding
    if (normalizedQuery && embedding?.providerId && embedding?.modelId) {
      try {
        const vectors = await this.deps.getEmbeddings(embedding.providerId, embedding.modelId, [
          normalizedQuery
        ])
        const vector = vectors[0]
        if (vector?.length) {
          const store = await this.getVectorStore(
            agentId,
            { providerId: embedding.providerId, modelId: embedding.modelId },
            vector.length
          )
          const matches = store.isUsable() ? await store.query(vector, { topK: topK * 2 }) : []
          for (const match of matches) {
            const similarity = distanceToSimilarity(match.distance)
            if (similarity < DEFAULT_SIMILARITY_THRESHOLD) continue
            const row = this.deps.repository.getById(match.memoryId)
            if (!row || row.superseded_by) continue
            // A real vector similarity overrides the FTS baseline for the same row.
            scored.set(row.id, this.toRecallItem(row, similarity, now, weights))
          }
        }
      } catch (error) {
        logger.warn(`[Memory] vector recall failed, FTS only: ${String(error)}`)
      }
    }

    const results = Array.from(scored.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)

    for (const item of results) {
      this.deps.repository.recordAccess(item.id, now)
    }
    return results
  }

  async buildInjection(agentId: string, query: string): Promise<MemoryInjectionPayload | null> {
    if (!this.isEnabled(agentId)) return null
    const persona = this.deps.repository.getActivePersona(agentId)
    const recalled = await this.recall(agentId, query)
    if (!persona && recalled.length === 0) return null
    return {
      selfModel: persona?.content ?? null,
      memories: recalled.map((item) => ({ id: item.id, kind: item.kind, content: item.content }))
    }
  }

  // ==================== Persona evolution ====================

  // Persona currently auto-evolves without gating; controlled approval is planned later.
  // Reflects over recent memories and evolves the self-model. Throttled: runs only when the
  // memory count crosses a REFLECT_EVERY_N_MEMORIES boundary, or when no persona exists yet.
  // createdCount is the number written this round, used to detect the crossing. Returns the new
  // persona version id, or null (not triggered / failed). Independent cheap call, never throws.
  async maybeReflect(
    agentId: string,
    model: { providerId: string; modelId: string },
    createdCount: number
  ): Promise<string | null> {
    if (!this.isEnabled(agentId)) return null
    try {
      const active = this.deps.repository
        .listByAgent(agentId)
        .filter((row) => row.kind !== 'persona')
      if (active.length < MIN_MEMORIES_FOR_REFLECTION) return null

      const previous = this.deps.repository.getActivePersona(agentId)
      const before = Math.max(0, active.length - Math.max(0, createdCount))
      const crossed =
        Math.floor(before / REFLECT_EVERY_N_MEMORIES) <
        Math.floor(active.length / REFLECT_EVERY_N_MEMORIES)
      const shouldReflect = (!previous && active.length >= MIN_MEMORIES_FOR_REFLECTION) || crossed
      if (!shouldReflect) return null

      const top = active
        .slice()
        .sort((a, b) => b.importance - a.importance || b.created_at - a.created_at)
        .slice(0, REFLECTION_MEMORY_LIMIT)
      const reflectionModel = this.resolveExtractionModel(agentId, model)
      const selfModelText = await this.deps.generateText(
        reflectionModel.providerId,
        reflectionModel.modelId,
        buildReflectionPrompt(
          previous?.content ?? null,
          top.map((row) => row.content)
        )
      )
      const sanitized = sanitizeSelfModel(selfModelText)
      if (!sanitized) return null
      return this.evolvePersona(agentId, sanitized)
    } catch (error) {
      logger.warn(`[Memory] reflection skipped: ${String(error)}`)
      return null
    }
  }

  // Writes a new self-model version and supersedes the previous one. Anchored personas
  // (is_anchor) are never superseded.
  evolvePersona(agentId: string, content: string, sourceSession?: string | null): string | null {
    const trimmed = content.trim()
    if (!trimmed) return null
    const previous = this.deps.repository.getActivePersona(agentId)
    const id = `persona-${nanoid(12)}`
    this.deps.repository.insert({
      id,
      agentId,
      kind: 'persona',
      content: trimmed,
      importance: 1,
      status: 'fts_only',
      sourceSession: sourceSession ?? null
    })
    if (previous && previous.is_anchor === 0) {
      this.deps.repository.markSuperseded(previous.id, id)
    }
    this.emitChanged(agentId, 'persona-evolve')
    return id
  }

  listPersonaVersions(agentId: string): AgentMemoryRow[] {
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return []
    return this.deps.repository.listPersonaVersions(agentId)
  }

  // Rollback: reactivates a historical persona version (clears its superseded_by) and
  // supersedes the current active one.
  rollbackPersona(agentId: string, versionId: string): boolean {
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return false
    const target = this.deps.repository.getById(versionId)
    if (!target || target.agent_id !== agentId || target.kind !== 'persona') return false
    const current = this.deps.repository.getActivePersona(agentId)
    if (current && current.id !== versionId && current.is_anchor === 0) {
      this.deps.repository.markSuperseded(current.id, versionId)
    }
    this.deps.repository.markSuperseded(versionId, null)
    this.emitChanged(agentId, 'persona-rollback')
    return true
  }

  // ==================== Management ====================

  listMemories(agentId: string): AgentMemoryRow[] {
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return []
    return this.deps.repository.listByAgent(agentId)
  }

  async deleteMemory(agentId: string, memoryId: string): Promise<boolean> {
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return false
    const row = this.deps.repository.getById(memoryId)
    if (!row || row.agent_id !== agentId) return false
    this.deps.repository.delete(memoryId)
    const store = await this.vectorStoreForAgent(agentId)
    if (store) {
      await store.deleteByMemoryIds([memoryId]).catch((error) => {
        logger.warn(`[Memory] vector delete failed: ${String(error)}`)
      })
    }
    this.emitChanged(agentId, 'delete')
    return true
  }

  async clearMemories(agentId: string): Promise<number> {
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return 0
    const removed = this.deps.repository.clearByAgent(agentId)
    // Under the per-agent lock: close the cached connection (release the file handle), then
    // delete the on-disk store regardless of cache state — a restart leaves the cache empty
    // but a stale/mismatched .duckdb on disk, which would otherwise stay fail-closed forever.
    await this.runExclusiveForAgent(agentId, async () => {
      await this.closeVectorStore(agentId)
      await this.deps.resetVectorStore(agentId)
    }).catch((error) => {
      // The SQLite rows are gone, but the sidecar file could not be removed (lock/permission);
      // surface it so a failed recovery is not mistaken for success.
      logger.error(
        `[Memory] vector reset failed for ${agentId}; on-disk store may persist: ${String(error)}`
      )
    })
    if (removed > 0) this.emitChanged(agentId, 'clear')
    return removed
  }

  getStatus(agentId: string): MemoryStatus {
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) {
      return { total: 0, pendingEmbedding: 0, hasPersona: false }
    }
    const all = this.deps.repository.listByAgent(agentId, { includeSuperseded: true })
    return {
      total: all.length,
      pendingEmbedding: all.filter((row) => row.status === 'pending_embedding').length,
      hasPersona: all.some((row) => row.kind === 'persona' && !row.superseded_by)
    }
  }

  async dispose(): Promise<void> {
    for (const pending of this.vectorStores.values()) {
      const store = await pending.catch(() => null)
      if (store) await store.close().catch(() => undefined)
    }
    this.vectorStores.clear()
    this.vectorStoreIdentities.clear()
    this.vectorStoreLocks.clear()
  }

  // ==================== Internal ====================

  // Cheap extraction/reflection model when configured; falls back to the caller's model.
  private resolveExtractionModel(
    agentId: string,
    fallback: { providerId: string; modelId: string }
  ): { providerId: string; modelId: string } {
    const configured = this.deps.resolveAgentConfig(agentId)?.memoryExtractionModel
    if (configured?.providerId && configured?.modelId) {
      return { providerId: configured.providerId, modelId: configured.modelId }
    }
    return fallback
  }

  private toRecallItem(
    row: AgentMemoryRow,
    similarity: number,
    now: number,
    weights: { similarity: number; recency: number; importance: number }
  ): MemoryRecallItem {
    return {
      id: row.id,
      kind: row.kind,
      content: row.content,
      importance: row.importance,
      score: retrievalScore(row, similarity, now, weights)
    }
  }

  private vectorStoreCacheKey(
    agentId: string,
    embedding: { providerId: string; modelId: string },
    dimensions: number
  ): string {
    return `${agentId}::${embedding.providerId}::${embedding.modelId}::${dimensions}`
  }

  /** Serialize open/close/reset of an agent's single sidecar file so it is never opened twice. */
  private runExclusiveForAgent<T>(agentId: string, task: () => Promise<T>): Promise<T> {
    const prev = this.vectorStoreLocks.get(agentId) ?? Promise.resolve()
    const run = prev.then(() => task())
    this.vectorStoreLocks.set(
      agentId,
      run.then(
        () => undefined,
        () => undefined
      )
    )
    return run
  }

  private async vectorStoreForAgent(agentId: string): Promise<IMemoryVectorStore | null> {
    const pending = this.vectorStores.get(agentId)
    return pending ? pending.catch(() => null) : null
  }

  /** Close and evict the agent's cached store (caller must hold the per-agent lock). */
  private async closeVectorStore(agentId: string): Promise<void> {
    const pending = this.vectorStores.get(agentId)
    if (!pending) return
    this.vectorStores.delete(agentId)
    this.vectorStoreIdentities.delete(agentId)
    const store = await pending.catch(() => null)
    if (store) await store.close().catch(() => undefined)
  }

  private getVectorStore(
    agentId: string,
    embedding: { providerId: string; modelId: string },
    dimensions: number
  ): Promise<IMemoryVectorStore> {
    return this.runExclusiveForAgent(agentId, () =>
      this.openVectorStoreLocked(agentId, embedding, dimensions)
    )
  }

  /** Open/reuse the agent's single sidecar. Caller MUST hold the per-agent lock. */
  private async openVectorStoreLocked(
    agentId: string,
    embedding: { providerId: string; modelId: string },
    dimensions: number
  ): Promise<IMemoryVectorStore> {
    const identity = this.vectorStoreCacheKey(agentId, embedding, dimensions)
    const cached = this.vectorStores.get(agentId)
    if (cached && this.vectorStoreIdentities.get(agentId) === identity) return cached
    // Identity changed (model/dim switch): the same .duckdb file is reused, so close the
    // previous instance before opening it again to keep a single DuckDBInstance per file.
    await this.closeVectorStore(agentId)
    const pending = this.deps.createVectorStore(agentId, embedding, dimensions).catch((error) => {
      this.vectorStores.delete(agentId)
      this.vectorStoreIdentities.delete(agentId)
      throw error
    })
    this.vectorStores.set(agentId, pending)
    this.vectorStoreIdentities.set(agentId, identity)
    return pending
  }
}
