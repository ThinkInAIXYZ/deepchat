import logger from '@shared/logger'
import { nanoid } from 'nanoid'

import {
  isSafeAgentId,
  type AgentMemoryRow,
  type IMemoryVectorStore,
  type MemoryCandidate,
  type MemoryConflictPair,
  type MemoryConflictResolution,
  type NormalizedMemoryCandidate,
  type MemoryPresenterDeps,
  type MemoryRecallItem,
  type MemorySearchHit,
  type MemoryStatus,
  type MemoryVectorRecord,
  type MemoryWriteOutcome,
  type WriteMemoriesOptions
} from './types'
import {
  CATEGORY_IMPORTANCE_FLOOR,
  isAgentMemoryCategory,
  type AgentMemoryCategory
} from '@shared/types/agent-memory'
import {
  MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_PREVIEW_LIMIT,
  MEMORY_ARCHIVE_CANDIDATE_LIFECYCLE_SCAN_LIMIT,
  MEMORY_HEALTH_DEFAULT_AUDIT_SCAN_LIMIT,
  createEmptyMemoryHealth,
  type MemoryArchiveCandidateLifecyclePreview,
  type MemoryHealthDto,
  type MemoryLifecycle
} from '@shared/contracts/routes/memory.routes'
import {
  buildMemoryProvenanceKey,
  decayScore,
  distanceToSimilarity,
  fuse,
  resolveRetrieval
} from './scoring'
import { deriveLifecycle, type DeriveLifecycleOptions } from './lifecycle'
import { ARCHIVE_AGE_MS, ARCHIVE_DECAY_THRESHOLD } from './lifecycleConstants'
import { ADD_DECISION, buildDecisionPrompt, parseDecision, type MemoryDecision } from './decision'
import { CONFIDENCE_INCREMENT, DEFAULT_CONFIDENCE } from './types'
import {
  appendMemorySection,
  appendMemorySectionWithManifest,
  buildMemorySection,
  estimateTokens,
  resolveInjectionTokenBudget,
  type MemoryInjectionManifest,
  type MemoryInjectionPayload,
  type MemoryInjectionPort,
  type MemoryInjectionResult,
  type MemoryRuntimePort
} from './injectionPort'
import {
  buildExtractionPrompt,
  buildReflectionInsightsPrompt,
  buildReflectionPrompt,
  buildTriagePrompt,
  parseMemoryCandidates,
  parseReflectionInsights,
  parseTriageDecision,
  personaChangeRatio,
  sanitizeSelfModel,
  PERSONA_MAX_CHANGE_RATIO
} from './extraction'
import type {
  MemoryExtractionInput,
  MemoryExtractionResult,
  MemoryPersonaDraftResult,
  MemoryReflectionResult,
  MemoryUpdateReason
} from './types'

export { appendMemorySection, appendMemorySectionWithManifest, buildMemorySection, isSafeAgentId }
export type {
  MemoryInjectionPayload,
  MemoryInjectionPort,
  MemoryInjectionResult,
  MemoryRuntimePort
}

// Minimum atomic units before reflection can run.
const MIN_MEMORIES_FOR_REFLECTION = 3
// Reflection fires once the importance of units accumulated since the last reflection crosses this.
const REFLECTION_IMPORTANCE_THRESHOLD = 5.0
// Reflection rows start high and decay slowly (60d half-life) so high-level insights persist.
const REFLECTION_IMPORTANCE = 0.8
// Max memories fed into a single reflection prompt.
const REFLECTION_MEMORY_LIMIT = 20

// Guarded persona evolution (opt-in, default off). A draft is distilled only once enough new
// importance has accumulated since the current self-model, and at most one draft is outstanding at a
// time. Mirrors the reflection throttle so an enabled agent never spends the model every turn.
const MIN_MEMORIES_FOR_PERSONA = 3
const PERSONA_EVOLUTION_IMPORTANCE_THRESHOLD = 5.0
const PERSONA_MEMORY_LIMIT = 20

// Working-memory L1 cache: a single condensed blob of an agent's highest-value resident memories,
// refreshed in the background and injected at session open without a full recall.
const WORKING_BLOB_TOKEN_LIMIT = 400
const WORKING_PROVENANCE_SEED = 'session-working-blob'
// Per-batch size and batch cap for a background reindex drain.
const REINDEX_BATCH_SIZE = 50
const REINDEX_MAX_BATCHES = 200

// Number of nearest existing memories fed to the write-decision model as context.
const DECISION_NEIGHBOR_TOP_S = 10

// Offline consolidation tuning. The idle timer absorbs bursts of extractions into one pass; the
// cooldown then caps how often a pass actually runs. A pass is bounded by an LLM call budget so it
// can never run away, with the remainder picked up on the next pass.
const CONSOLIDATION_IDLE_MS = 5 * 60 * 1000
const CONSOLIDATION_COOLDOWN_MS = 6 * 60 * 60 * 1000
const CONSOLIDATION_MAX_LLM_CALLS = 8
const CONSOLIDATION_MAX_INPUT_TOKENS = 24000
const CONSOLIDATION_MERGE_SIMILARITY = 0.85
const MAINTENANCE_START_DELAY_MS = 60 * 1000
const STARTUP_PREWARM_DELAY_MS = 3 * 1000
const STARTUP_ARM_STAGGER_MS = 5 * 1000
const STARTUP_PREWARM_STAGGER_MS = 1500
const EMBEDDING_PREWARM_TEXT = 'memory warmup'
const WARM_DIMENSION_FAILURE_COOLDOWN_MS = 30 * 1000
const MEMORY_HEALTH_TOP_ACCESSED_LIMIT = 5
const MEMORY_HEALTH_AUDIT_SCAN_LIMIT = MEMORY_HEALTH_DEFAULT_AUDIT_SCAN_LIMIT
const MEMORY_HEALTH_RECENT_FAILURES_LIMIT = 5

function embeddingFingerprint(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`
}

function isUniqueConstraintError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true
  const message = error instanceof Error ? error.message : String(error)
  return /UNIQUE constraint failed/i.test(message)
}

function createdIdsFromOutcome(outcome: MemoryWriteOutcome): string[] {
  switch (outcome.action) {
    case 'created':
      return [outcome.id]
    case 'superseded':
      return outcome.created === false ? [] : [outcome.id]
    case 'challenged':
      return [outcome.challengerId]
    default:
      return []
  }
}

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

function outcomeTouched(outcome: MemoryWriteOutcome): boolean {
  return outcome.action !== 'noop'
}

function clampImportance(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return 0.5
  return Math.min(1, Math.max(0, num))
}

function normalizeMemoryCandidate(candidate: MemoryCandidate): NormalizedMemoryCandidate | null {
  const content = candidate.content.trim()
  if (!content) return null

  const rawCategory = typeof candidate.category === 'string' ? candidate.category.trim() : ''
  const category = isAgentMemoryCategory(rawCategory) ? rawCategory : null
  const categoryWasProvided = rawCategory.length > 0
  const kind =
    category !== null
      ? category === 'task_outcome'
        ? 'episodic'
        : 'semantic'
      : categoryWasProvided
        ? 'semantic'
        : candidate.kind === 'episodic' || candidate.kind === 'semantic'
          ? candidate.kind
          : 'semantic'
  const importance = category
    ? Math.max(clampImportance(candidate.importance), CATEGORY_IMPORTANCE_FLOOR[category])
    : clampImportance(candidate.importance)

  return { kind, category, content, importance }
}

function canCarryCategory(kind: AgentMemoryRow['kind']): boolean {
  return kind === 'episodic' || kind === 'semantic'
}

// Maps a write outcome to its user-add audit shape. outputRefs carries only ids and the action,
// never raw content; a no-op records why it was skipped while a challenge surfaces the conflict.
function userAddAuditFromOutcome(outcome: MemoryWriteOutcome): {
  status: 'completed' | 'skipped'
  reason: string | null
  outputRefs: Record<string, unknown>
} {
  switch (outcome.action) {
    case 'created':
      return {
        status: 'completed',
        reason: null,
        outputRefs: { action: 'created', memoryId: outcome.id }
      }
    case 'updated':
      return {
        status: 'completed',
        reason: null,
        outputRefs: { action: 'updated', memoryId: outcome.id }
      }
    case 'superseded':
      return {
        status: 'completed',
        reason: null,
        outputRefs: {
          action: 'superseded',
          memoryId: outcome.id,
          supersededId: outcome.supersededId
        }
      }
    case 'challenged':
      return {
        status: 'completed',
        reason: 'challenged',
        outputRefs: {
          action: 'challenged',
          memoryId: outcome.challengerId,
          conflictWith: outcome.targetId
        }
      }
    case 'noop':
      return { status: 'skipped', reason: outcome.reason, outputRefs: { action: 'noop' } }
  }
}

export class MemoryPresenter implements MemoryRuntimePort {
  // One DuckDB sidecar per agent (keyed by agentId, not by embedding identity, because the
  // file path is per-agent). Caches the in-flight create promise so concurrent callers share
  // one open. The identity it was opened with is tracked separately to re-open on model/dim
  // switch. All open/close/reset go through a per-agent lock so the same file is never opened
  // by two DuckDBInstances at once.
  private readonly vectorStores = new Map<string, Promise<IMemoryVectorStore>>()
  private readonly vectorStoreIdentities = new Map<string, string>()
  private readonly vectorStoreReady = new Map<string, string>()
  private readonly vectorStoreWarmups = new Map<string, Promise<void>>()
  private readonly vectorStoreDimensionFailures = new Map<string, number>()
  private readonly vectorStoreLocks = new Map<string, Promise<unknown>>()
  private readonly embeddingWarmups = new Map<string, Promise<void>>()
  // Serializes an agent's embedding drains. Distinct from vectorStoreLocks on purpose: this one
  // spans the network embedding call, the file lock must not.
  private readonly embeddingDrains = new Map<string, Promise<unknown>>()
  // In-flight reindex per agent; recall coalesces onto it instead of starting a second rebuild.
  private readonly reindexing = new Map<string, Promise<void>>()
  // In-flight backfill per agent (embed fts_only / leftover pending rows without a store reset).
  private readonly backfilling = new Map<string, Promise<void>>()
  // Per-agent idle timer that debounces bursts of extractions into one offline consolidation pass.
  private readonly consolidationTimers = new Map<string, NodeJS.Timeout>()
  private readonly consolidationTimerDueAt = new Map<string, number>()
  // Last time a pass actually ran, per agent; enforces the cooldown between passes.
  private readonly lastConsolidationAt = new Map<string, number>()
  // In-flight timer-fired consolidation passes; dispose() awaits them so none writes after teardown.
  private readonly consolidationRuns = new Set<Promise<unknown>>()
  private maintenanceStartTimer: NodeJS.Timeout | null = null
  private prewarmStartTimer: NodeJS.Timeout | null = null
  private readonly prewarmTimers = new Map<string, NodeJS.Timeout>()
  private maintenanceStarted = false
  // Per-agent watermark for a reflection attempt that ran the model but wrote nothing new (empty or
  // all-duplicate output). Lets a quiet agent stop re-spending the model on the same units until
  // newer ones arrive. In-memory only: a restart costs at most one redundant attempt.
  private readonly reflectionAttemptWatermark = new Map<string, number>()
  // Same watermark idea for persona drafts: a no-op attempt advances it so an enabled-but-quiet agent
  // does not re-distill the self-model on every extraction.
  private readonly personaAttemptWatermark = new Map<string, number>()
  // Serializes all persona writes for one agent (draft production, approve, reject, rollback, anchor).
  // Per-AGENT because persona is an agent-level single chain — distinct from the per-SESSION extraction
  // cursor lock, and from the per-agent vector-store file lock; these guard different resources.
  private readonly personaLocks = new Map<string, Promise<unknown>>()
  // Agents with a cold-start blob refresh already scheduled, so concurrent open-misses coalesce into
  // one rebuild. Cleared when that pass finishes, so a memory written between opens is picked up next.
  private readonly workingRefreshInFlight = new Set<string>()
  // Set once dispose() begins so a timer that already fired turns its in-flight pass into a no-op
  // instead of writing to a database the teardown is about to close.
  private disposed = false

  constructor(private readonly deps: MemoryPresenterDeps) {}

  startBackgroundMaintenance(): void {
    if (this.disposed || this.maintenanceStarted) return
    this.maintenanceStarted = true
    this.prewarmStartTimer = setTimeout(() => {
      this.prewarmStartTimer = null
      if (this.disposed) return
      this.warmActiveAgents()
    }, STARTUP_PREWARM_DELAY_MS)
    if (typeof this.prewarmStartTimer.unref === 'function') this.prewarmStartTimer.unref()
    this.maintenanceStartTimer = setTimeout(() => {
      this.maintenanceStartTimer = null
      if (this.disposed) return
      this.armCurrentActiveAgents()
    }, MAINTENANCE_START_DELAY_MS)
    if (typeof this.maintenanceStartTimer.unref === 'function') this.maintenanceStartTimer.unref()
  }

  stopBackgroundMaintenance(): void {
    if (this.prewarmStartTimer) {
      clearTimeout(this.prewarmStartTimer)
      this.prewarmStartTimer = null
    }
    for (const timer of this.prewarmTimers.values()) clearTimeout(timer)
    this.prewarmTimers.clear()
    if (this.maintenanceStartTimer) {
      clearTimeout(this.maintenanceStartTimer)
      this.maintenanceStartTimer = null
    }
  }

  private shouldArmMaintenance(agentId: string): boolean {
    return isSafeAgentId(agentId) && this.isManagedAgent(agentId) && this.isEnabled(agentId)
  }

  private armCurrentActiveAgents(): void {
    try {
      this.armActiveAgentsStaggered(this.deps.repository.listAgentIdsWithMemories())
    } catch (error) {
      logger.warn(`[Memory] maintenance arm skipped: ${String(error)}`)
    }
  }

  warmActiveAgents(): void {
    if (this.disposed) return
    try {
      this.warmActiveAgentsStaggered(this.deps.repository.listAgentIdsWithMemories())
    } catch (error) {
      logger.warn(`[Memory] startup prewarm skipped: ${String(error)}`)
    }
  }

  private armActiveAgentsStaggered(agentIds: string[]): void {
    if (this.disposed) return
    agentIds
      .filter((agentId) => this.shouldArmMaintenance(agentId))
      .sort()
      .forEach((agentId, index) => {
        this.onAgentMemoryMaintenanceConfigChanged(
          agentId,
          CONSOLIDATION_IDLE_MS + index * STARTUP_ARM_STAGGER_MS
        )
      })
  }

  private warmActiveAgentsStaggered(agentIds: string[]): void {
    if (this.disposed) return
    agentIds
      .filter((agentId) => this.shouldArmMaintenance(agentId))
      .sort()
      .forEach((agentId, index) => {
        this.clearPrewarmTimer(agentId)
        const timer = setTimeout(() => {
          if (this.prewarmTimers.get(agentId) === timer) this.prewarmTimers.delete(agentId)
          if (this.disposed || !this.canReadAgentMemory(agentId)) return
          const embedding = this.deps.resolveAgentConfig(agentId)?.memoryEmbedding
          if (!embedding?.providerId || !embedding?.modelId) return
          void this.warmVectorStore(agentId, {
            providerId: embedding.providerId,
            modelId: embedding.modelId
          })
          this.warmEmbeddingConnection(agentId, {
            providerId: embedding.providerId,
            modelId: embedding.modelId
          })
        }, index * STARTUP_PREWARM_STAGGER_MS)
        this.prewarmTimers.set(agentId, timer)
        if (typeof timer.unref === 'function') timer.unref()
      })
  }

  private clearPrewarmTimer(agentId: string): void {
    const timer = this.prewarmTimers.get(agentId)
    if (!timer) return
    clearTimeout(timer)
    this.prewarmTimers.delete(agentId)
  }

  isEnabled(agentId: string): boolean {
    return this.deps.resolveAgentConfig(agentId)?.memoryEnabled === true
  }

  // Guarded persona evolution is a second, independent switch gated behind memoryEnabled: turning it
  // off (the default) leaves extraction/recall/reflection untouched and only stops persona drafts.
  private isPersonaEvolutionEnabled(agentId: string): boolean {
    const config = this.deps.resolveAgentConfig(agentId)
    return config?.memoryEnabled === true && config?.personaEvolutionEnabled === true
  }

  // Serializes an agent's persona mutations so concurrent reflections/approvals can never branch the
  // single self-model chain. Mirrors runExclusiveForAgent but on a distinct map and resource.
  private withPersonaLock<T>(agentId: string, task: () => T | Promise<T>): Promise<T> {
    const prev = this.personaLocks.get(agentId) ?? Promise.resolve()
    const run = prev.then(() => task())
    this.personaLocks.set(
      agentId,
      run.then(
        () => undefined,
        () => undefined
      )
    )
    return run
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

  private canWriteAgentMemory(agentId: string): boolean {
    return !this.disposed && this.isManagedAgent(agentId) && this.isEnabled(agentId)
  }

  private canReadAgentMemory(agentId: string): boolean {
    return !this.disposed && this.isManagedAgent(agentId) && this.isEnabled(agentId)
  }

  private canContinueAgentMemoryTask(agentId: string): boolean {
    return this.isManagedAgent(agentId) && this.isEnabled(agentId)
  }

  private isPendingEmbeddableRow(agentId: string, row: AgentMemoryRow | undefined): boolean {
    return (
      !!row &&
      row.agent_id === agentId &&
      row.status === 'pending_embedding' &&
      !row.superseded_by &&
      row.kind !== 'persona' &&
      row.kind !== 'working'
    )
  }

  private emitChanged(agentId: string, reason: MemoryUpdateReason): void {
    this.deps.onMemoryChanged?.(agentId, reason)
  }

  // Phase 1 (synchronous, inside the caller's transaction): write memory rows as
  // pending_embedding with idempotent dedup. Returns the ids of newly-created (non-duplicate)
  // memories so the caller can anchor them on the tape and trigger phase 2.
  writeMemoriesSync(candidates: MemoryCandidate[], options: WriteMemoriesOptions): string[] {
    if (!candidates.length) return []
    const created: string[] = []
    for (const candidate of candidates) {
      const normalized = normalizeMemoryCandidate(candidate)
      if (!normalized) continue
      const content = normalized.content
      const provenanceKey = buildMemoryProvenanceKey(options.agentId, normalized.kind, content)
      const duplicate = this.deps.repository.getByProvenanceKey(options.agentId, provenanceKey)
      if (duplicate) {
        if (this.absorbProvenanceHit(options.agentId, duplicate)) created.push(duplicate.id)
        continue
      }
      const id = this.insertMemory(options.agentId, normalized, content, provenanceKey, options)
      if (id) created.push(id)
    }
    return created
  }

  // Inserts a single candidate as pending_embedding. Tape entry_id lineage is only meaningful when
  // scoped by a session; drop it otherwise so a stray id can never be stored without a session to
  // resolve it against. A unique-index race is treated as already present and skipped (returns null).
  private insertMemory(
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
      this.deps.repository.insert({
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

  // Serializes an agent's drains so two background triggers can't list and embed the same
  // pending rows at once (duplicate, costly getEmbeddings calls). An uncontended call starts
  // its drain synchronously; a contended one queues behind the in-flight drain and then finds
  // the rows already embedded. A failing drain never breaks the chain for the next one.
  processPendingEmbeddings(agentId: string, limit = 50): Promise<void> {
    if (!this.canWriteAgentMemory(agentId)) return Promise.resolve()
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
    if (!this.canContinueAgentMemoryTask(agentId)) return
    const config = this.deps.resolveAgentConfig(agentId)
    const pending = this.deps.repository.listPendingEmbedding(limit, agentId)
    if (!pending.length) return

    const embedding = config?.memoryEmbedding
    if (!embedding?.providerId || !embedding?.modelId) {
      for (const row of pending) {
        this.deps.repository.updatePendingEmbeddingStatus(agentId, row.id, 'fts_only')
      }
      return
    }

    let vectors: number[][]
    try {
      vectors = await this.deps.getEmbeddings(
        embedding.providerId,
        embedding.modelId,
        pending.map((row) => row.content)
      )
    } catch (error) {
      // Transient embedding-service failure: keep the rows pending_embedding so the next drain
      // retries them rather than terminally marking the batch 'error'. Memory is never lost and a
      // service outage self-heals; without this a mid-reindex throw would strand the whole corpus.
      logger.error(`[Memory] embedding service failed for ${agentId}, will retry: ${String(error)}`)
      if (!this.canContinueAgentMemoryTask(agentId)) return
      for (const row of pending) {
        this.deps.repository.updatePendingEmbeddingStatus(agentId, row.id, 'pending_embedding')
      }
      return
    }

    if (!this.canContinueAgentMemoryTask(agentId)) return
    try {
      const dim = vectors.find((vector) => vector?.length)?.length ?? 0
      const records: MemoryVectorRecord[] = []
      for (let i = 0; i < pending.length; i += 1) {
        const vector = vectors[i]
        if (dim > 0 && vector?.length === dim) {
          records.push({ memoryId: pending[i].id, embedding: vector })
        } else {
          this.deps.repository.updatePendingEmbeddingStatus(agentId, pending[i].id, 'error')
        }
      }
      if (!records.length) return

      const outcome = await this.runExclusiveForAgent(agentId, async () => {
        if (!this.canContinueAgentMemoryTask(agentId)) {
          return { written: new Set<string>(), usable: true }
        }
        const live = records.filter((record) =>
          this.isPendingEmbeddableRow(agentId, this.deps.repository.getById(record.memoryId))
        )
        if (!live.length) return { written: new Set<string>(), usable: true }
        const currentEmbedding = this.deps.resolveAgentConfig(agentId)?.memoryEmbedding
        if (
          !currentEmbedding?.providerId ||
          !currentEmbedding?.modelId ||
          embeddingFingerprint(currentEmbedding.providerId, currentEmbedding.modelId) !==
            embeddingFingerprint(embedding.providerId, embedding.modelId)
        ) {
          return { written: new Set<string>(), usable: true }
        }
        const store = await this.openVectorStoreLocked(
          agentId,
          { providerId: embedding.providerId, modelId: embedding.modelId },
          dim
        )
        if (!this.canContinueAgentMemoryTask(agentId)) {
          return { written: new Set<string>(), usable: true }
        }
        if (!store.isUsable()) return { written: new Set<string>(), usable: false }
        await store.upsert(live)
        return { written: new Set(live.map((record) => record.memoryId)), usable: true }
      })

      if (!this.canContinueAgentMemoryTask(agentId)) return
      const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
      const currentEmbedding = this.deps.resolveAgentConfig(agentId)?.memoryEmbedding
      const currentFingerprint =
        currentEmbedding?.providerId && currentEmbedding?.modelId
          ? embeddingFingerprint(currentEmbedding.providerId, currentEmbedding.modelId)
          : null
      if (currentFingerprint !== fingerprint) {
        logger.info(
          `[Memory] embedding config changed during drain for ${agentId}; discarding stale vectors`
        )
        return
      }
      for (const record of records) {
        if (outcome.written.has(record.memoryId)) {
          this.deps.repository.updatePendingEmbeddingStatus(agentId, record.memoryId, 'embedded', {
            embeddingId: record.memoryId,
            embeddingDim: dim,
            embeddingModel: fingerprint
          })
        } else if (!outcome.usable) {
          this.deps.repository.updatePendingEmbeddingStatus(agentId, record.memoryId, 'error')
        }
      }
      if (!outcome.usable) {
        this.clearVectorStoreReady(agentId)
      } else if (outcome.written.size > 0 && !this.hasStaleEmbeddings(agentId, dim, fingerprint)) {
        this.markVectorStoreReady(
          agentId,
          { providerId: embedding.providerId, modelId: embedding.modelId },
          dim
        )
      }
    } catch (error) {
      // Embeddings succeeded but the vector store write failed: terminal for this batch.
      logger.error(`[Memory] vector store write failed for ${agentId}: ${String(error)}`)
      if (!this.canContinueAgentMemoryTask(agentId)) return
      for (const row of pending) {
        this.deps.repository.updatePendingEmbeddingStatus(agentId, row.id, 'error')
      }
    }
  }

  // Rebuilds an agent's vectors after an embedding model/dimension change (non-destructive): the
  // affected rows are re-queued, the old sidecar is dropped and recreated at the new dimension,
  // and the rows are re-embedded with the current model in the background. Coalesces concurrent
  // callers onto one run; never throws (the chat path must not be blocked).
  reindexEmbeddings(agentId: string, force = false): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.clearVectorStoreReady(agentId)
    const inflight = this.reindexing.get(agentId)
    if (inflight) return inflight
    const tracked = this.runReindex(agentId, force).finally(() => {
      if (this.reindexing.get(agentId) === tracked) this.reindexing.delete(agentId)
    })
    this.reindexing.set(agentId, tracked)
    return tracked
  }

  private async runReindex(agentId: string, force: boolean): Promise<void> {
    if (!this.canContinueAgentMemoryTask(agentId)) return
    // One batched UPDATE re-queues stale-model rows, recovers rows a prior failed embed left in
    // 'error', and picks up rows deferred as fts_only while no model was configured — without
    // scanning or looping per row on the caller's stack.
    const requeued = this.deps.repository.requeueForEmbedding(agentId, [
      'embedded',
      'error',
      'fts_only'
    ])
    // `force` rebuilds an unusable on-disk store even with nothing to re-queue (the foreign file is
    // itself what blocks recovery); otherwise skip the reset when there is no stale work.
    if (!requeued && !force) return
    // Wait for a drain that captured the previous embedding config before resetting the sidecar,
    // otherwise stale vectors can be written into the freshly reset store.
    const inFlightDrain = this.embeddingDrains.get(agentId)
    if (inFlightDrain) await inFlightDrain.catch(() => undefined)
    if (!this.canContinueAgentMemoryTask(agentId)) return
    // Drop the stale-dimension store under the per-agent lock; the next embed rebuilds it.
    await this.runExclusiveForAgent(agentId, async () => {
      if (!this.canContinueAgentMemoryTask(agentId)) return
      await this.closeVectorStore(agentId)
      await this.deps.resetVectorStore(agentId)
    })
    if (!this.canContinueAgentMemoryTask(agentId)) return
    this.emitChanged(agentId, 'reindex')
    await this.drainUntilExhausted(agentId)
  }

  // Embeds rows deferred as fts_only (written while no model was configured) and re-drains any
  // rows an earlier run left pending, into the existing store (no reset — those vectors are still
  // valid). Coalesces concurrent callers; never throws. recall only kicks this once the embedding
  // service has proven reachable this turn, so a service outage never starts a retry loop here.
  backfillEmbeddings(agentId: string): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const inflight = this.backfilling.get(agentId)
    if (inflight) return inflight
    const tracked = this.runBackfill(agentId).finally(() => {
      if (this.backfilling.get(agentId) === tracked) this.backfilling.delete(agentId)
    })
    this.backfilling.set(agentId, tracked)
    return tracked
  }

  private async runBackfill(agentId: string): Promise<void> {
    // Yield first so the requeue UPDATE runs off the recall call stack.
    await Promise.resolve()
    if (!this.canContinueAgentMemoryTask(agentId)) return
    this.deps.repository.requeueForEmbedding(agentId, ['fts_only'])
    await this.drainUntilExhausted(agentId)
  }

  // Drains an agent's pending rows in batches until none remain or a batch makes no progress. A
  // stalled head row means the embedding service is down: the rows stay queued (drainPending keeps
  // them pending on a transient failure) for the next trigger, so we stop instead of spinning.
  private async drainUntilExhausted(agentId: string): Promise<void> {
    for (let i = 0; i < REINDEX_MAX_BATCHES; i += 1) {
      if (!this.canContinueAgentMemoryTask(agentId)) break
      const head = this.deps.repository.listPendingEmbedding(1, agentId)
      if (!head.length) break
      await this.processPendingEmbeddings(agentId, REINDEX_BATCH_SIZE)
      if (!this.canContinueAgentMemoryTask(agentId)) break
      const next = this.deps.repository.listPendingEmbedding(1, agentId)
      if (next.length && next[0].id === head[0].id) break
    }
  }

  // Extracts memories from a span via an independent cheap LLM call and writes them. Returns
  // { ok:true, createdIds } on success (createdIds may be empty) or { ok:false } on failure.
  // Never throws and never disrupts the chat; on failure the caller keeps its cursor for retry.
  async extractAndStore(input: MemoryExtractionInput): Promise<MemoryExtractionResult> {
    // Disabled or empty span: a successful no-op consume, so the caller may advance its cursor.
    if (!this.canWriteAgentMemory(input.agentId)) return { ok: true, createdIds: [] }
    // The extraction chain is dispatched fire-and-forget and is not drained by dispose, so it must
    // fail closed itself: never start (or finish) a write against a database teardown is closing.
    if (this.disposed) return { ok: true, createdIds: [] }
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
      // Teardown may have begun during the triage await; stop before firing the extraction LLM.
      if (!this.canWriteAgentMemory(input.agentId)) return { ok: true, createdIds: [] }
      if (!shouldExtract) return { ok: true, createdIds: [] }

      const response = await this.deps.generateText(
        model.providerId,
        model.modelId,
        buildExtractionPrompt(span)
      )
      // Teardown may have begun during the extraction await; stop before any candidate processing.
      if (!this.canWriteAgentMemory(input.agentId)) return { ok: true, createdIds: [] }
      const parsed = parseMemoryCandidates(response)
      if (!parsed.ok) {
        logger.warn(`[Memory] extraction parse failed: ${parsed.reason}`)
        return { ok: false }
      }
      const candidates = parsed.candidates
      const options: WriteMemoriesOptions = {
        agentId: input.agentId,
        sourceSession: input.sourceSession ?? null,
        sourceEntryIds: input.sourceEntryIds ?? null
      }
      const now = Date.now()
      const createdIds: string[] = []
      let touched = false
      for (const candidate of candidates) {
        const outcome = await this.coordinateWrite(input.agentId, candidate, model, options, now)
        createdIds.push(...createdIdsFromOutcome(outcome))
        if (outcomeTouched(outcome)) touched = true
      }
      if (createdIds.length || touched) {
        this.syncWorkingMemoryAfterMutation(input.agentId)
        this.emitChanged(input.agentId, 'extract')
        // Phase 2 embedding runs in the background; it must not block the caller.
        void this.processPendingEmbeddings(input.agentId).catch((error) => {
          logger.warn(`[Memory] background embedding failed: ${String(error)}`)
        })
        this.scheduleConsolidation(input.agentId)
      }
      return { ok: true, createdIds }
    } catch (error) {
      // Model/parse failure: return ok:false so the caller keeps its cursor for a later retry.
      logger.warn(`[Memory] extraction failed: ${String(error)}`)
      return { ok: false }
    }
  }

  // Shared Mem0-style write coordinator for extraction and explicit memory_remember writes.
  // Any failure degrades to ADD so a candidate is never lost.
  private async coordinateWrite(
    agentId: string,
    candidate: MemoryCandidate,
    model: { providerId: string; modelId: string },
    options: WriteMemoriesOptions,
    now: number
  ): Promise<MemoryWriteOutcome> {
    const normalized = normalizeMemoryCandidate(candidate)
    if (!normalized) return { action: 'noop', reason: 'empty' }
    const content = normalized.content
    // Each disposed re-check below guards a write that follows an await: teardown may begin between
    // the candidate arriving and its decision landing, and no repository write may outlive it.
    if (!this.canWriteAgentMemory(agentId)) return { action: 'noop', reason: 'disposed' }

    const provenanceKey = buildMemoryProvenanceKey(agentId, normalized.kind, content)
    const duplicate = this.deps.repository.getByProvenanceKey(agentId, provenanceKey)
    if (duplicate) {
      const touched = this.absorbProvenanceHit(agentId, duplicate)
      return touched
        ? { action: 'updated', id: duplicate.id }
        : { action: 'noop', reason: 'duplicate', id: duplicate.id }
    }

    let neighbors: MemoryRecallItem[] = []
    try {
      // Cold vector stores deliberately degrade this neighbor lookup to FTS-only. Exact provenance
      // dedupe already ran above, and semantic merging can recover once the store warms; blocking a
      // write here would reintroduce the same first-turn DuckDB cold-start stall.
      const hits = await this.retrieve(agentId, content, now, false)
      neighbors = hits.slice(0, DECISION_NEIGHBOR_TOP_S)
    } catch (error) {
      logger.warn(`[Memory] decision neighbor recall failed, adding: ${String(error)}`)
    }
    if (!this.canWriteAgentMemory(agentId)) return { action: 'noop', reason: 'disposed' }
    if (!neighbors.length) {
      const id = this.insertMemory(agentId, normalized, content, provenanceKey, options)
      return id ? { action: 'created', id } : { action: 'noop', reason: 'insert-skipped' }
    }

    let decision: MemoryDecision = ADD_DECISION
    try {
      const raw = await this.deps.generateText(
        model.providerId,
        model.modelId,
        buildDecisionPrompt(
          normalized,
          neighbors.map((neighbor) => ({ content: neighbor.content }))
        )
      )
      decision = parseDecision(raw, neighbors.length)
    } catch (error) {
      logger.warn(`[Memory] decision model failed, adding: ${String(error)}`)
    }
    if (!this.canWriteAgentMemory(agentId)) return { action: 'noop', reason: 'disposed' }

    const target = decision.targetIndex !== null ? neighbors[decision.targetIndex] : null
    switch (decision.decision) {
      case 'NOOP':
        return { action: 'noop', reason: 'decision-noop', id: target?.id }
      case 'UPDATE':
        if (target) {
          const targetRow = this.deps.repository.getById(target.id)
          if (targetRow) {
            const merged = decision.mergedContent ?? content
            const survivorId = this.applyContentUpdate(
              agentId,
              targetRow,
              merged,
              now,
              normalized.category
            )
            this.bumpConfidence(survivorId)
            this.deps.repository.updateStatus(survivorId, 'pending_embedding')
            return { action: 'updated', id: survivorId }
          }
        }
        break
      case 'SUPERSEDE':
        if (target) {
          const merged = decision.mergedContent ?? content
          const mergedKey = buildMemoryProvenanceKey(agentId, normalized.kind, merged)
          const newId = this.insertMemory(agentId, normalized, merged, mergedKey, options)
          if (newId) {
            this.deps.repository.markSuperseded(target.id, newId)
            return { action: 'superseded', id: newId, supersededId: target.id, created: true }
          }
          // The merged wording collided with an existing memory: revive that row if it was inactive
          // (so the surviving truth is recallable), then retire the old contradicting row into it so
          // the contradiction is never left silently active.
          const existing = this.deps.repository.getByProvenanceKey(agentId, mergedKey)
          if (existing && existing.id !== target.id) {
            this.absorbProvenanceHit(agentId, existing)
            if (existing.category === null && normalized.category !== null) {
              this.deps.repository.updateContent(
                existing.id,
                existing.content,
                existing.provenance_key,
                now,
                normalized.category
              )
            }
            this.deps.repository.markSuperseded(target.id, existing.id)
            return {
              action: 'superseded',
              id: existing.id,
              supersededId: target.id,
              created: false
            }
          }
          return { action: 'noop', reason: 'supersede-collided', id: target.id }
        }
        break
      case 'CHALLENGE':
        if (target) {
          const challengerId = this.insertConflictedMemory(
            agentId,
            normalized,
            content,
            provenanceKey,
            target.id,
            options
          )
          if (challengerId) {
            const currentTarget = this.deps.repository.getById(target.id)
            if (
              currentTarget &&
              currentTarget.agent_id === agentId &&
              currentTarget.status !== 'archived' &&
              currentTarget.superseded_by === null
            ) {
              this.deps.repository.markConflict(target.id, 'challenged')
              return { action: 'challenged', targetId: target.id, challengerId }
            }
            this.deps.repository.setConflictWith(challengerId, null)
            this.deps.repository.updateStatus(challengerId, 'pending_embedding')
            return { action: 'created', id: challengerId }
          }
          return { action: 'noop', reason: 'challenge-insert-skipped', id: target.id }
        }
        break
    }
    const id = this.insertMemory(agentId, normalized, content, provenanceKey, options)
    return id ? { action: 'created', id } : { action: 'noop', reason: 'insert-skipped' }
  }

  private insertConflictedMemory(
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
      this.deps.repository.insert({
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

  private bumpConfidence(id: string): void {
    const current = this.deps.repository.getById(id)?.confidence ?? DEFAULT_CONFIDENCE
    this.deps.repository.setConfidence(id, Math.min(1, current + CONFIDENCE_INCREMENT))
  }

  // Rewrites a row's content and keeps its provenance_key aligned with the new content so the dedup
  // short-circuit keeps matching. Returns the id of the row that now holds the content. If the new
  // content's key is already owned by a different row, that owner is the canonical holder (the
  // unique index forbids a second one), so this row is folded into it — the owner is revived first
  // if it had gone inactive — instead of leaving two rows with the same content and a stale key.
  private applyContentUpdate(
    agentId: string,
    row: AgentMemoryRow,
    content: string,
    now: number,
    category?: AgentMemoryCategory | null
  ): string {
    const newKey = buildMemoryProvenanceKey(agentId, row.kind, content)
    const nextCategory = canCarryCategory(row.kind) ? (row.category ?? category ?? null) : undefined
    if (newKey !== row.provenance_key) {
      const owner = this.deps.repository.getByProvenanceKey(agentId, newKey)
      if (owner && owner.id !== row.id) {
        this.absorbProvenanceHit(agentId, owner)
        if (canCarryCategory(owner.kind) && owner.category === null && nextCategory != null) {
          this.deps.repository.updateContent(
            owner.id,
            owner.content,
            owner.provenance_key,
            now,
            nextCategory
          )
        }
        this.deps.repository.markSuperseded(row.id, owner.id)
        return owner.id
      }
    }
    this.deps.repository.updateContent(row.id, content, newKey, now, nextCategory)
    return row.id
  }

  // Walks a supersede chain to its head (the row no longer pointed past), guarding against cycles
  // and cross-agent links.
  private supersedeHead(agentId: string, row: AgentMemoryRow): AgentMemoryRow {
    let current = row
    const seen = new Set<string>([row.id])
    while (current.superseded_by) {
      const next = this.deps.repository.getById(current.superseded_by)
      if (!next || next.agent_id !== agentId || seen.has(next.id)) break
      seen.add(next.id)
      current = next
    }
    return current
  }

  // Resolves a provenance-key collision against an existing row. An active hit is a genuine
  // duplicate (nothing to do). An archived or superseded hit means the user is re-asserting a fact
  // that had left the current truth, so it is revived: cleared back to pending_embedding, and for a
  // superseded fact the head that had replaced it is superseded back into it (so the whole
  // contradicting lineage retires and the revived row becomes current truth). Returns whether the
  // store changed, so the caller can re-embed + broadcast.
  private absorbProvenanceHit(agentId: string, existing: AgentMemoryRow): boolean {
    const archived = existing.status === 'archived'
    const superseded = existing.superseded_by !== null
    if (!archived && !superseded) return false

    if (superseded) {
      const head = this.supersedeHead(agentId, existing)
      this.deps.repository.markSuperseded(existing.id, null)
      if (head.id !== existing.id && head.superseded_by === null && head.status !== 'archived') {
        this.deps.repository.markSuperseded(head.id, existing.id)
      }
    }
    this.deps.repository.updateStatus(existing.id, 'pending_embedding')
    return true
  }

  // ==================== Offline consolidation ====================

  onAgentMemoryMaintenanceConfigChanged(
    agentId: string,
    delayMs: number = CONSOLIDATION_IDLE_MS
  ): void {
    if (this.disposed || !this.shouldArmMaintenance(agentId)) return
    // Batched startup/builtin callers already start from active-memory ids, but the single-agent
    // config-change entrypoint does not. Keep the guard centralized; batched redundancy is expected.
    if (!this.deps.repository.hasActiveMemory(agentId)) return
    this.scheduleConsolidation(agentId, delayMs, { preserveEarlier: true })
  }

  onBuiltinDeepChatMemoryMaintenanceConfigChanged(): void {
    if (this.disposed) return
    this.armCurrentActiveAgents()
  }

  // Arms (or resets) the per-agent idle timer so a burst of extractions collapses into one pass
  // that fires after the burst settles. The timer is unref'd so it never keeps the process alive.
  private scheduleConsolidation(
    agentId: string,
    delayMs: number = CONSOLIDATION_IDLE_MS,
    options: { preserveEarlier?: boolean } = {}
  ): void {
    if (this.disposed) return
    const dueAt = Date.now() + delayMs
    const existing = this.consolidationTimers.get(agentId)
    const existingDueAt = this.consolidationTimerDueAt.get(agentId)
    if (
      options.preserveEarlier === true &&
      existing &&
      existingDueAt !== undefined &&
      existingDueAt <= dueAt
    ) {
      return
    }
    if (existing) clearTimeout(existing)
    this.consolidationTimerDueAt.delete(agentId)
    const timer = setTimeout(() => {
      this.consolidationTimers.delete(agentId)
      this.consolidationTimerDueAt.delete(agentId)
      // Track the in-flight pass so dispose() can await it before the database is closed.
      const run = this.runConsolidationPass(agentId).catch((error) => {
        logger.warn(`[Memory] consolidation pass failed for ${agentId}: ${String(error)}`)
      })
      this.consolidationRuns.add(run)
      void run.finally(() => this.consolidationRuns.delete(run))
    }, delayMs)
    if (typeof timer.unref === 'function') timer.unref()
    this.consolidationTimers.set(agentId, timer)
    this.consolidationTimerDueAt.set(agentId, dueAt)
  }

  // Offline maintenance: cheap local upkeep always runs when due, while model-backed work is gated
  // by the latest completed LLM maintenance audit so the cooldown survives restarts.
  async runConsolidationPass(agentId: string, now: number = Date.now()): Promise<void> {
    if (!this.canWriteAgentMemory(agentId)) return
    let last = this.lastConsolidationAt.get(agentId)
    if (last === undefined) {
      last =
        this.deps.auditRepository?.getLatestCompletedEventAt(agentId, 'memory/maintenance_llm') ?? 0
      this.lastConsolidationAt.set(agentId, last)
    }
    if (now - last < CONSOLIDATION_COOLDOWN_MS) {
      this.runCheapMaintenance(agentId, now, true)
      return
    }
    this.runCheapMaintenance(agentId, now, false)
    const model = this.resolveConsolidationModel(agentId)
    if (!model) {
      this.archiveStale(agentId, now)
      this.writeAudit(agentId, {
        eventType: 'memory/maintenance_llm',
        actorType: 'scheduler',
        status: 'skipped',
        reason: 'missing-model',
        createdAt: now
      })
      return
    }
    this.lastConsolidationAt.set(agentId, now)

    let touched = false
    try {
      touched = await this.mergeNearDuplicates(agentId, now, model)
    } catch (error) {
      logger.warn(`[Memory] consolidation merge failed for ${agentId}: ${String(error)}`)
    }
    if (!this.canWriteAgentMemory(agentId)) return
    try {
      if (await this.runChallengeResolutionPass(agentId, model)) touched = true
    } catch (error) {
      logger.warn(`[Memory] challenge resolution failed for ${agentId}: ${String(error)}`)
    }
    if (!this.canWriteAgentMemory(agentId)) return
    try {
      const reflection = await this.maybeReflect(agentId, model)
      if (reflection) {
        this.writeAudit(agentId, {
          eventType: 'memory/reflect',
          actorType: 'scheduler',
          status: 'completed',
          inputRefs: { memoryIds: reflection.sourceMemoryIds },
          outputRefs: { memoryIds: reflection.reflectionIds },
          model
        })
        touched = true
      }
    } catch (error) {
      logger.warn(`[Memory] background reflection failed for ${agentId}: ${String(error)}`)
    }
    if (!this.canWriteAgentMemory(agentId)) return
    try {
      const personaDraft = await this.maybeEvolvePersona(agentId, model)
      if (personaDraft) {
        this.writeAudit(agentId, {
          eventType: 'persona/evolve',
          actorType: 'scheduler',
          status: 'completed',
          outputRefs: {
            draftId: personaDraft.draftId,
            needsReview: personaDraft.needsReview,
            changeRatio: personaDraft.changeRatio
          },
          model
        })
      }
    } catch (error) {
      logger.warn(`[Memory] background persona evolution failed for ${agentId}: ${String(error)}`)
    }
    // Teardown may have started during the merge's awaits; bail before touching the DB it will close.
    if (!this.canWriteAgentMemory(agentId)) return
    this.refreshDecayScores(agentId, now)
    this.archiveStale(agentId, now)
    this.syncWorkingMemoryAfterMutation(agentId)
    this.stampConsolidation(agentId, now)
    this.writeAudit(agentId, {
      eventType: 'memory/maintenance_llm',
      actorType: 'scheduler',
      status: 'completed',
      outputRefs: { touched },
      model,
      createdAt: now
    })

    if (touched) {
      void this.processPendingEmbeddings(agentId).catch((error) => {
        logger.warn(`[Memory] background embedding failed: ${String(error)}`)
      })
      this.emitChanged(agentId, 'extract')
    }
  }

  // Folds near-duplicate memories into a single current-truth row: the more recent row keeps the
  // merged wording and the older one is superseded into it (never hard-deleted). Bounded by an LLM
  // call and input-token budget; the remainder is picked up on the next pass.
  private async mergeNearDuplicates(
    agentId: string,
    now: number,
    model: { providerId: string; modelId: string }
  ): Promise<boolean> {
    const embedding = this.deps.resolveAgentConfig(agentId)?.memoryEmbedding
    if (embedding?.providerId && embedding?.modelId) {
      await this.warmVectorStore(agentId, {
        providerId: embedding.providerId,
        modelId: embedding.modelId
      })
      if (!this.canWriteAgentMemory(agentId)) return false
    }

    const active = this.deps.repository
      .listByAgent(agentId)
      .filter((row) => row.kind !== 'persona')
      .sort((a, b) => a.created_at - b.created_at)

    let calls = 0
    let inputTokens = 0
    const merged = new Set<string>()
    let touched = false

    for (const row of active) {
      if (calls >= CONSOLIDATION_MAX_LLM_CALLS || inputTokens >= CONSOLIDATION_MAX_INPUT_TOKENS) {
        break
      }
      if (merged.has(row.id)) continue

      let hits: MemoryRecallItem[] = []
      try {
        hits = await this.retrieve(agentId, row.content, now, false)
      } catch {
        continue
      }
      if (!this.canWriteAgentMemory(agentId)) break
      const neighbor = hits.find(
        (hit) =>
          hit.id !== row.id &&
          !merged.has(hit.id) &&
          (hit.similarity ?? 0) >= CONSOLIDATION_MERGE_SIMILARITY
      )
      if (!neighbor) continue

      const promptCandidate = normalizeMemoryCandidate({
        kind: row.kind === 'episodic' ? 'episodic' : 'semantic',
        category: row.category,
        content: row.content,
        importance: row.importance
      })
      if (!promptCandidate) continue
      const prompt = buildDecisionPrompt(promptCandidate, [{ content: neighbor.content }])
      calls += 1
      inputTokens += estimateTokens(prompt)
      let decision: MemoryDecision = ADD_DECISION
      try {
        const raw = await this.deps.generateText(model.providerId, model.modelId, prompt)
        decision = parseDecision(raw, 1)
      } catch (error) {
        logger.warn(`[Memory] consolidation decision failed: ${String(error)}`)
        continue
      }
      // Teardown may have started during the decision await; bail before any repository write.
      if (!this.canWriteAgentMemory(agentId)) break

      // Only UPDATE/SUPERSEDE fold the pair; NOOP means "already covered, leave both intact" so a
      // re-run over an already-merged corpus converges instead of superseding a live memory.
      if (decision.decision === 'UPDATE' || decision.decision === 'SUPERSEDE') {
        const neighborRow = this.deps.repository.getById(neighbor.id)
        if (!neighborRow) continue
        const [primary, secondary] =
          row.created_at >= neighborRow.created_at ? [row, neighborRow] : [neighborRow, row]
        const mergedContent = decision.mergedContent ?? primary.content
        const secondaryCategory = isAgentMemoryCategory(secondary.category)
          ? secondary.category
          : null
        const survivorId = this.applyContentUpdate(
          agentId,
          primary,
          mergedContent,
          now,
          secondaryCategory
        )
        this.bumpConfidence(survivorId)
        this.deps.repository.setImportance(survivorId, secondary.importance)
        this.deps.repository.updateStatus(survivorId, 'pending_embedding')
        if (secondary.id !== survivorId) {
          this.deps.repository.markSuperseded(secondary.id, survivorId)
        }
        merged.add(primary.id)
        merged.add(secondary.id)
        merged.add(survivorId)
        touched = true
      }
      this.deps.repository.setLastConsolidatedAt(row.id, now)
    }
    return touched
  }

  private runCheapMaintenance(agentId: string, now: number, archive: boolean): void {
    this.refreshDecayScores(agentId, now)
    if (archive) this.archiveStale(agentId, now)
    this.syncWorkingMemoryAfterMutation(agentId)
  }

  private stampConsolidation(agentId: string, now: number): void {
    for (const row of this.deps.repository.listByAgent(agentId)) {
      if (row.kind === 'persona') continue
      this.deps.repository.setLastConsolidatedAt(row.id, now)
    }
  }

  // Materializes the decay score for active non-persona rows so archiving can pre-filter in SQL.
  private refreshDecayScores(agentId: string, now: number): void {
    for (const row of this.deps.repository.listByAgent(agentId)) {
      if (row.kind === 'persona') continue
      this.deps.repository.updateDecayScore(row.id, decayScore(row, now), null)
    }
  }

  // Soft-deletes memories that satisfy all four archive conditions: decayed, zero-interaction, aged
  // past the floor, and still active (anchors / persona are exempt via listArchiveCandidates).
  // Never hard-deletes. Returns how many rows were archived.
  archiveStale(agentId: string, now: number = Date.now()): number {
    const before = now - ARCHIVE_AGE_MS
    const candidates = this.deps.repository.listArchiveCandidates(
      agentId,
      before,
      ARCHIVE_DECAY_THRESHOLD
    )
    let archived = 0
    for (const row of candidates) {
      if (row.access_count !== 0) continue
      this.deps.repository.archive(row.id, now)
      archived += 1
    }
    if (archived > 0) {
      this.syncWorkingMemoryAfterMutation(agentId)
      this.emitChanged(agentId, 'extract')
    }
    return archived
  }

  // Brings an archived memory back into recall by re-queuing it for embedding.
  restoreMemory(agentId: string, memoryId: string): boolean {
    if (this.disposed) return false
    this.assertSafeAgentId(agentId)
    if (!this.canWriteAgentMemory(agentId)) return false
    const row = this.deps.repository.getById(memoryId)
    if (!row || row.agent_id !== agentId || row.status !== 'archived') return false
    this.deps.repository.updateStatus(memoryId, 'pending_embedding')
    this.syncWorkingMemoryAfterMutation(agentId)
    void this.processPendingEmbeddings(agentId).catch((error) => {
      logger.warn(`[Memory] background embedding failed: ${String(error)}`)
    })
    this.emitChanged(agentId, 'extract')
    return true
  }

  async forgetMemory(agentId: string, memoryId: string): Promise<boolean> {
    if (this.disposed) return false
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return false
    const row = this.deps.repository.getById(memoryId)
    if (!row || row.agent_id !== agentId) return false
    if (row.status === 'archived') return true
    this.deps.repository.archive(row.id, Date.now())
    if (this.disposed) return true
    this.syncWorkingMemoryAfterMutation(agentId)
    this.emitChanged(agentId, 'extract')
    return true
  }

  listConflicts(agentId: string): MemoryConflictPair[] {
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return []
    const challengers = this.deps.repository.listByAgent(agentId, { statuses: ['conflicted'] })
    const pairs: MemoryConflictPair[] = []
    for (const challenger of challengers) {
      if (!challenger.conflict_with) {
        logger.warn(`[Memory] skipping conflict challenger without target: ${challenger.id}`)
        continue
      }
      const target = this.deps.repository.getById(challenger.conflict_with)
      if (
        !target ||
        target.agent_id !== agentId ||
        target.conflict_state !== 'challenged' ||
        target.superseded_by !== null
      ) {
        logger.warn(`[Memory] skipping invalid conflict pair: ${challenger.id}`)
        continue
      }
      pairs.push({ challenger, target })
    }
    return pairs
  }

  async resolveConflict(
    agentId: string,
    challengerId: string,
    outcome: MemoryConflictResolution,
    actorType: 'scheduler' | 'user' = 'user',
    model?: { providerId: string; modelId: string } | null
  ): Promise<boolean> {
    if (this.disposed) return false
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return false
    const pair = this.listConflicts(agentId).find(
      (conflict) => conflict.challenger.id === challengerId
    )
    if (!pair) return false
    this.applyConflictResolution(agentId, pair, outcome)
    this.syncWorkingMemoryAfterMutation(agentId)
    this.writeAudit(agentId, {
      eventType: 'memory/challenge_resolved',
      actorType,
      status: 'completed',
      inputRefs: { challengerId: pair.challenger.id, targetId: pair.target.id },
      outputRefs: { action: outcome },
      model: model ?? undefined
    })
    if (outcome === 'keep_challenger' || outcome === 'keep_both') {
      void this.processPendingEmbeddings(agentId).catch((error) => {
        logger.warn(`[Memory] background embedding failed: ${String(error)}`)
      })
    }
    this.emitChanged(agentId, 'extract')
    this.scheduleConsolidation(agentId)
    return true
  }

  private applyConflictResolution(
    agentId: string,
    pair: MemoryConflictPair,
    outcome: MemoryConflictResolution
  ): void {
    const now = Date.now()
    const siblings = this.listConflictSiblings(agentId, pair.target.id, pair.challenger.id)
    switch (outcome) {
      case 'keep_challenger':
        this.deps.repository.setConflictWith(pair.challenger.id, null)
        this.deps.repository.updateStatus(pair.challenger.id, 'pending_embedding')
        for (const sibling of siblings) {
          this.deps.repository.setConflictWith(sibling.id, null)
          this.deps.repository.markSuperseded(sibling.id, pair.challenger.id)
          this.deps.repository.archive(sibling.id, now)
        }
        this.deps.repository.markSuperseded(pair.target.id, pair.challenger.id)
        this.deps.repository.markConflict(pair.target.id, null)
        this.deps.repository.archive(pair.target.id, now)
        return
      case 'keep_target':
        this.deps.repository.setConflictWith(pair.challenger.id, null)
        this.deps.repository.markSuperseded(pair.challenger.id, pair.target.id)
        this.deps.repository.archive(pair.challenger.id, now)
        if (siblings.length === 0) this.deps.repository.markConflict(pair.target.id, null)
        return
      case 'keep_both':
        this.deps.repository.setConflictWith(pair.challenger.id, null)
        this.deps.repository.updateStatus(pair.challenger.id, 'pending_embedding')
        if (siblings.length === 0) this.deps.repository.markConflict(pair.target.id, null)
        return
    }
  }

  private listConflictSiblings(
    agentId: string,
    targetId: string,
    excludeChallengerId: string
  ): AgentMemoryRow[] {
    return this.deps.repository
      .listByAgent(agentId, { statuses: ['conflicted'] })
      .filter((row) => row.id !== excludeChallengerId && row.conflict_with === targetId)
  }

  private async runChallengeResolutionPass(
    agentId: string,
    model: { providerId: string; modelId: string }
  ): Promise<boolean> {
    let touched = false
    for (const pair of this.listConflicts(agentId)) {
      const promptCandidate = normalizeMemoryCandidate({
        kind: pair.challenger.kind === 'episodic' ? 'episodic' : 'semantic',
        category: pair.challenger.category,
        content: pair.challenger.content,
        importance: pair.challenger.importance
      })
      if (!promptCandidate) continue
      const prompt = buildDecisionPrompt(promptCandidate, [{ content: pair.target.content }])
      let decision: MemoryDecision = ADD_DECISION
      try {
        const raw = await this.deps.generateText(model.providerId, model.modelId, prompt)
        decision = parseDecision(raw, 1)
      } catch (error) {
        logger.warn(`[Memory] challenge decision failed: ${String(error)}`)
        continue
      }
      if (!this.canWriteAgentMemory(agentId)) break
      const outcome: MemoryConflictResolution =
        decision.decision === 'NOOP'
          ? 'keep_target'
          : decision.decision === 'UPDATE' || decision.decision === 'SUPERSEDE'
            ? 'keep_challenger'
            : 'keep_both'
      if (await this.resolveConflict(agentId, pair.challenger.id, outcome, 'scheduler', model)) {
        touched = true
      }
    }
    return touched
  }

  private writeAudit(
    agentId: string,
    input: {
      eventType: string
      actorType: 'scheduler' | 'user' | 'runtime'
      status: 'completed' | 'skipped' | 'failed'
      reason?: string | null
      inputRefs?: Record<string, unknown>
      outputRefs?: Record<string, unknown>
      model?: { providerId: string; modelId: string } | null
      sessionId?: string | null
      createdAt?: number
    }
  ): void {
    if (!this.deps.auditRepository) return
    this.deps.auditRepository.insert({
      id: `audit-${nanoid(12)}`,
      agentId,
      eventType: input.eventType,
      actorType: input.actorType,
      status: input.status,
      reason: input.reason ?? null,
      inputRefs: input.inputRefs,
      outputRefs: input.outputRefs,
      modelProviderId: input.model?.providerId ?? null,
      modelId: input.model?.modelId ?? null,
      sessionId: input.sessionId ?? null,
      createdAt: input.createdAt
    })
  }

  private resolveConsolidationModel(
    agentId: string
  ): { providerId: string; modelId: string } | null {
    const configured = this.deps.resolveAgentConfig(agentId)?.memoryExtractionModel
    if (configured?.providerId && configured?.modelId) {
      return { providerId: configured.providerId, modelId: configured.modelId }
    }
    return this.deps.resolveAgentDefaultModel?.(agentId) ?? null
  }

  // Explicit memory write (the `memory_remember` tool path): write + async embed + broadcast.
  // Shares the 'extract' change reason with auto-extraction; subscribers refresh by agentId
  // and do not distinguish finer reasons.
  async rememberMemory(
    candidate: MemoryCandidate,
    options: WriteMemoriesOptions,
    model?: { providerId: string; modelId: string } | null
  ): Promise<MemoryWriteOutcome> {
    if (!this.canWriteAgentMemory(options.agentId)) return { action: 'noop', reason: 'disposed' }
    const resolvedModel = model ? this.resolveExtractionModel(options.agentId, model) : null
    const outcome = resolvedModel
      ? await this.coordinateWrite(options.agentId, candidate, resolvedModel, options, Date.now())
      : this.directAddMemory(options.agentId, candidate, options)
    if (outcomeTouched(outcome)) {
      this.syncWorkingMemoryAfterMutation(options.agentId)
      this.emitChanged(options.agentId, 'extract')
      if (outcome.action !== 'challenged') {
        void this.processPendingEmbeddings(options.agentId).catch((error) => {
          logger.warn(`[Memory] background embedding failed: ${String(error)}`)
        })
      }
      this.scheduleConsolidation(options.agentId)
    }
    return outcome
  }

  private directAddMemory(
    agentId: string,
    candidate: MemoryCandidate,
    options: WriteMemoriesOptions
  ): MemoryWriteOutcome {
    const normalized = normalizeMemoryCandidate(candidate)
    if (!normalized) return { action: 'noop', reason: 'empty' }
    const content = normalized.content
    const provenanceKey = buildMemoryProvenanceKey(agentId, normalized.kind, content)
    const duplicate = this.deps.repository.getByProvenanceKey(agentId, provenanceKey)
    if (duplicate) {
      const touched = this.absorbProvenanceHit(agentId, duplicate)
      return touched
        ? { action: 'updated', id: duplicate.id }
        : { action: 'noop', reason: 'duplicate', id: duplicate.id }
    }
    const id = this.insertMemory(agentId, normalized, content, provenanceKey, options)
    return id ? { action: 'created', id } : { action: 'noop', reason: 'insert-skipped' }
  }

  // Hybrid recall: keyword (FTS) and vector candidates fused with Reciprocal Rank Fusion, then
  // reranked by combined score and capped at top-K. Degrades to FTS-only when the agent has no
  // embedding config, when the query has no vector hits, or while a reindex is rebuilding vectors.
  async recall(agentId: string, query: string, now = Date.now()): Promise<MemoryRecallItem[]> {
    if (!this.canReadAgentMemory(agentId)) return []
    return this.retrieve(agentId, query, now, true)
  }

  // Read-only search for the management surface: the same hybrid retrieval as recall, but it never
  // records access, so browsing memories does not inflate access_count or skew archive-eligibility
  // fairness. Re-queries the authoritative row for each hit and pairs it with its score; limit caps
  // the result count only (it cannot widen the agent's configured topK).
  async searchMemories(
    agentId: string,
    query: string,
    options: { limit?: number } = {}
  ): Promise<MemorySearchHit[]> {
    if (!this.canReadAgentMemory(agentId)) return []
    // Management search follows recall's cold-store contract: return FTS-only hits immediately and
    // let the background warm restore vector results on the next query.
    const hits = await this.retrieve(agentId, query, Date.now(), false)
    const limited =
      options.limit != null ? hits.slice(0, Math.max(0, Math.floor(options.limit))) : hits
    const results: MemorySearchHit[] = []
    for (const hit of limited) {
      const row = this.deps.repository.getById(hit.id)
      if (row)
        results.push({ row, score: hit.score, sources: hit.sources, similarity: hit.similarity })
    }
    return results
  }

  // User-initiated manual write from the management surface. Shares the exact write path as the
  // tool/extraction flow (decision ring when an extraction model is configured, otherwise a direct
  // dedupe-add), so manual memories receive no recall or forgetting exemption. Records a user audit
  // whose refs carry provenance metadata and ids only, never the raw content.
  async addUserMemory(
    agentId: string,
    input: {
      content: string
      kind?: 'episodic' | 'semantic'
      category?: string | null
      importance?: number
    },
    sessionId?: string | null
  ): Promise<MemoryWriteOutcome> {
    this.assertSafeAgentId(agentId)
    if (!this.canWriteAgentMemory(agentId)) return { action: 'noop', reason: 'disposed' }
    const candidate: MemoryCandidate = {
      kind: input.kind ?? 'semantic',
      category: input.category,
      content: input.content,
      importance: input.importance
    }
    const configured = this.deps.resolveAgentConfig(agentId)?.memoryExtractionModel
    const model =
      configured?.providerId && configured?.modelId
        ? { providerId: configured.providerId, modelId: configured.modelId }
        : null
    const outcome = await this.rememberMemory(
      candidate,
      { agentId, sourceSession: sessionId ?? null },
      model
    )
    // Teardown may begin during the write above; no audit row may outlive the closing database.
    if (!this.canWriteAgentMemory(agentId)) return outcome
    const audit = userAddAuditFromOutcome(outcome)
    this.writeAudit(agentId, {
      eventType: 'memory/add',
      actorType: 'user',
      status: audit.status,
      reason: audit.reason,
      inputRefs: {
        kind: candidate.kind,
        category: candidate.category ?? null,
        importance: candidate.importance ?? null
      },
      outputRefs: audit.outputRefs,
      model,
      sessionId: sessionId ?? null
    })
    return outcome
  }

  // Core hybrid retrieval. recordAccessHits is false for internal lookups (the decision ring's
  // neighbor fetch) so they never inflate access_count and skew archive eligibility.
  private async retrieve(
    agentId: string,
    query: string,
    now: number,
    recordAccessHits: boolean,
    trace: boolean = false
  ): Promise<MemoryRecallItem[]> {
    // The read path is gated on disposed too: after teardown begins it must neither reopen a vector
    // store nor record access on a database that is closing.
    if (!this.canReadAgentMemory(agentId)) return []
    const config = this.deps.resolveAgentConfig(agentId)
    const { topK, rrfK, similarityThreshold, weights } = resolveRetrieval(config?.memoryRetrieval)
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return []

    const candidateLimit = topK * 2

    // Keyword path covers any status that still has content (embedded | fts_only | error). persona
    // is excluded (the self-model is injected separately, never recalled) and working (an internal
    // open-session cache row that must never feed back into recall).
    const ftsRows = this.deps.repository
      .search(agentId, normalizedQuery, candidateLimit)
      .filter((row) => row.kind !== 'persona' && row.kind !== 'working')

    // Vector path (embedded rows only).
    const vecMatches: { row: AgentMemoryRow; similarity: number }[] = []
    const embedding = config?.memoryEmbedding
    if (embedding?.providerId && embedding?.modelId) {
      const currentEmbedding = { providerId: embedding.providerId, modelId: embedding.modelId }
      if (!this.isVectorStoreWarm(agentId, currentEmbedding)) {
        void this.warmVectorStore(agentId, currentEmbedding)
        this.warmEmbeddingConnection(agentId, currentEmbedding)
      } else {
        try {
          const vectors = await this.deps.getEmbeddings(embedding.providerId, embedding.modelId, [
            normalizedQuery
          ])
          // Teardown may have started during the embedding await: bail before opening the store so a
          // late recall cannot reopen a sidecar the dispose close-loop has already passed.
          if (!this.canReadAgentMemory(agentId)) return []
          const vector = vectors[0]
          if (vector?.length) {
            const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
            if (this.hasStaleEmbeddings(agentId, vector.length, fingerprint)) {
              this.clearVectorStoreReady(agentId)
              // The embedding model or dimension changed: rebuild vectors in the background and
              // answer from FTS this turn instead of querying a store with stale dimensions. Skipped
              // during teardown so no background write outlives the database connection.
              if (this.canReadAgentMemory(agentId)) {
                void this.reindexEmbeddings(agentId).catch((error) => {
                  logger.warn(`[Memory] reindex failed for ${agentId}: ${String(error)}`)
                })
              }
            } else {
              const store = await this.getVectorStore(agentId, currentEmbedding, vector.length)
              // Teardown may have begun while the store opened: bail before querying or reading rows.
              // dispose awaits the per-agent open lock, so the store this call cached is closed there.
              if (!this.canReadAgentMemory(agentId)) return []
              if (store.isUsable()) {
                this.markVectorStoreReady(agentId, currentEmbedding, vector.length)
                const matches = await store.query(vector, { topK: candidateLimit })
                // ...and again after the query await, before any repository.getById on a closing DB.
                if (!this.canReadAgentMemory(agentId)) return []
                for (const match of matches) {
                  const similarity = distanceToSimilarity(match.distance)
                  if (similarity < similarityThreshold) continue
                  const row = this.deps.repository.getById(match.memoryId)
                  // Skip persona even if an old/anomalous vector for it sits in the store: the
                  // self-model is injected separately, never recalled as a normal memory. working
                  // rows are never embedded, but skip them defensively too. Archived rows keep their
                  // vector but must stay out of recall until restored.
                  if (
                    !row ||
                    row.superseded_by ||
                    row.kind === 'persona' ||
                    row.kind === 'working' ||
                    row.status === 'archived' ||
                    row.status === 'conflicted'
                  )
                    continue
                  vecMatches.push({ row, similarity })
                }
                // The service embedded the query and the store is healthy: opportunistically embed
                // rows deferred as fts_only (config added later) and re-drain any an earlier run left
                // pending. Background, coalesced, and skipped while a reindex owns the requeue.
                if (this.canReadAgentMemory(agentId) && !this.reindexing.has(agentId)) {
                  void this.backfillEmbeddings(agentId).catch((error) => {
                    logger.warn(`[Memory] backfill failed for ${agentId}: ${String(error)}`)
                  })
                }
              } else if (this.canReadAgentMemory(agentId) && !this.reindexing.has(agentId)) {
                this.clearVectorStoreReady(agentId)
                // The on-disk sidecar carries a foreign/legacy identity we can never query (and there
                // were no embedded rows to flag it as stale). Rebuild it under the current identity so
                // the corpus stops failing closed; force the reset even if there is nothing to
                // re-queue, since the unusable file itself is what blocks recovery.
                void this.reindexEmbeddings(agentId, true).catch((error) => {
                  logger.warn(`[Memory] store rebuild failed for ${agentId}: ${String(error)}`)
                })
              }
            }
          }
        } catch (error) {
          this.clearVectorStoreReady(agentId)
          logger.warn(`[Memory] vector recall degraded to FTS for ${agentId}: ${String(error)}`)
        }
      }
    }

    const results = fuse(ftsRows, vecMatches, { topK, rrfK, weights, now, trace })
    // Re-check after the store/query awaits: never write access counters once teardown has begun.
    if (recordAccessHits && this.canReadAgentMemory(agentId)) {
      for (const item of results) {
        this.deps.repository.recordAccess(item.id, now)
      }
    }
    return results
  }

  async buildInjection(agentId: string, query: string): Promise<MemoryInjectionResult | null> {
    if (!this.canReadAgentMemory(agentId)) return null
    const config = this.deps.resolveAgentConfig(agentId)
    const persona = this.deps.repository.getActivePersona(agentId)
    // The working blob is a precomputed L1 read (no recall, no access bump). At session open the
    // query is empty so recall is a no-op and the blob carries the injection; on a normal turn the
    // blob is injected alongside the query-relevant recall.
    const working = this.readWorkingMemory(agentId)
    // Cold start (or an evicted blob): serve this turn from recall and rebuild the blob off the hot
    // path so the next open is served from L1.
    if (!working) this.scheduleWorkingRefresh(agentId)
    const recalled = query.trim()
      ? await this.retrieve(agentId, query, Date.now(), true)
      : await this.recall(agentId, query)
    if (!persona && !working && recalled.length === 0) return null
    const tokenBudget = resolveInjectionTokenBudget(config?.memoryInjectionTokenBudget)
    const payload: MemoryInjectionPayload = {
      selfModel: persona?.content ?? null,
      working,
      memories: recalled.map((item) => ({
        id: item.id,
        kind: item.kind,
        content: item.content,
        score: item.score,
        sources: item.sources,
        similarity: item.similarity,
        breakdown: item.breakdown
      })),
      tokenBudget
    }
    const manifest: MemoryInjectionManifest = {
      policyVersion: 1,
      selected: [],
      dropped: [],
      tokenBudget,
      estimatedTokens: 0,
      queryHash: query.trim() ? buildMemoryProvenanceKey(agentId, 'query', query.trim()) : undefined
    }
    return { ...payload, payload, manifest }
  }

  // Reads the agent's working-memory blob without bumping its access clock, so last_accessed stays
  // a pure "last refreshed at" stamp. Returns null on cold start (no blob), where recall takes over.
  private readWorkingMemory(agentId: string): string | null {
    const row = this.deps.repository.getByProvenanceKey(agentId, this.workingMemoryKey(agentId))
    const content = row?.content?.trim()
    return content ? content : null
  }

  private workingMemoryKey(agentId: string): string {
    return buildMemoryProvenanceKey(agentId, 'working', WORKING_PROVENANCE_SEED)
  }

  private deleteWorkingMemory(agentId: string): void {
    const existing = this.deps.repository.getByProvenanceKey(
      agentId,
      this.workingMemoryKey(agentId)
    )
    if (existing) this.deps.repository.delete(existing.id)
  }

  private syncWorkingMemoryAfterMutation(agentId: string): void {
    if (this.disposed) return
    if (this.canReadAgentMemory(agentId)) this.refreshWorkingMemory(agentId)
    else this.deleteWorkingMemory(agentId)
  }

  // Rebuilds the working-memory blob from the agent's highest-value resident memories (by importance,
  // then access, then recency) into a single kind='working' row, capped at the blob token limit.
  // Persona is injected separately as the self-model, so it stays out of the blob to avoid double
  // injection. Synchronous SQLite-only work; runs on the offline maintenance pass.
  // Fire-and-forget cold-start refresh: rebuilds the blob on a microtask so buildInjection never
  // blocks on it. An in-flight flag coalesces concurrent open-misses; once the pass finishes the flag
  // clears, so a memory written between opens is reflected on the next open rather than after a timer.
  private scheduleWorkingRefresh(agentId: string): void {
    if (!this.canReadAgentMemory(agentId)) return
    if (this.workingRefreshInFlight.has(agentId)) return
    this.workingRefreshInFlight.add(agentId)
    void Promise.resolve()
      .then(() => {
        if (this.canReadAgentMemory(agentId)) this.refreshWorkingMemory(agentId)
      })
      .catch((error) => {
        logger.warn(`[Memory] working refresh skipped: ${String(error)}`)
      })
      .finally(() => {
        this.workingRefreshInFlight.delete(agentId)
      })
  }

  refreshWorkingMemory(agentId: string): void {
    if (!this.canReadAgentMemory(agentId)) return
    const workingKey = this.workingMemoryKey(agentId)
    const existing = this.deps.repository.getByProvenanceKey(agentId, workingKey)
    const blob = this.buildWorkingBlob(agentId)
    if (!blob) {
      if (existing) this.deps.repository.delete(existing.id)
      return
    }
    if (existing) {
      if (existing.content === blob) return
      this.deps.repository.updateContent(existing.id, blob, workingKey, Date.now())
      return
    }
    const now = Date.now()
    try {
      this.deps.repository.insert({
        id: `working-${nanoid(12)}`,
        agentId,
        kind: 'working',
        content: blob,
        importance: 0,
        status: 'fts_only',
        provenanceKey: workingKey,
        createdAt: now
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
    }
  }

  private buildWorkingBlob(agentId: string): string {
    const units = this.deps.repository
      .listByAgent(agentId, { kinds: ['semantic', 'reflection', 'episodic'] })
      .slice()
      .sort(
        (a, b) =>
          b.importance - a.importance ||
          b.access_count - a.access_count ||
          b.created_at - a.created_at
      )
    const lines: string[] = []
    let tokens = 0
    for (const unit of units) {
      const content = unit.content.trim()
      if (!content) continue
      const line = `- ${content}`
      const cost = estimateTokens(line)
      // Skip a single oversized memory rather than break, so it cannot starve the smaller, lower
      // importance memories that would still fit under the cap.
      if (tokens + cost > WORKING_BLOB_TOKEN_LIMIT) continue
      lines.push(line)
      tokens += cost
    }
    return lines.join('\n').trim()
  }

  // ==================== Reflection ====================

  // Generative-Agents reflection: when the importance of atomic units accumulated since the last
  // reflection crosses a threshold, synthesize a few high-level insight rows (kind=reflection) that
  // participate in recall. The most recent reflection's timestamp is the watermark for "new since
  // last reflection", so reflections never feed on themselves and a quiet agent never re-fires.
  // Independent cheap-model call, fully throttled, never throws. Returns the new reflection rows and
  // the units that fed them (for the audit anchor), or null when not triggered / no usable output.
  async maybeReflect(
    agentId: string,
    model: { providerId: string; modelId: string },
    sourceSession?: string | null
  ): Promise<MemoryReflectionResult | null> {
    if (!this.canWriteAgentMemory(agentId)) return null
    try {
      const units = this.deps.repository.listByAgent(agentId, { kinds: ['episodic', 'semantic'] })
      if (units.length < MIN_MEMORIES_FOR_REFLECTION) return null

      const lastReflection = this.deps.repository.listByAgent(agentId, {
        kinds: ['reflection'],
        limit: 1
      })[0]
      // A no-op model attempt advances an in-memory watermark too, so empty/duplicate output cannot
      // re-trigger the model on the same units every extraction.
      const watermark = Math.max(
        lastReflection?.created_at ?? 0,
        this.reflectionAttemptWatermark.get(agentId) ?? 0
      )
      const recentImportance = units
        .filter((unit) => unit.created_at > watermark)
        .reduce((sum, unit) => sum + Math.min(1, Math.max(0, unit.importance)), 0)
      if (recentImportance < REFLECTION_IMPORTANCE_THRESHOLD) return null
      const maxUnitCreatedAt = units.reduce((max, unit) => Math.max(max, unit.created_at), 0)

      const top = units
        .slice()
        .sort((a, b) => b.importance - a.importance || b.created_at - a.created_at)
        .slice(0, REFLECTION_MEMORY_LIMIT)
      const reflectionModel = this.resolveExtractionModel(agentId, model)
      const raw = await this.deps.generateText(
        reflectionModel.providerId,
        reflectionModel.modelId,
        buildReflectionInsightsPrompt(top.map((row) => row.content))
      )
      if (!this.canWriteAgentMemory(agentId)) return null
      const insights = parseReflectionInsights(raw)
      const reflectionIds: string[] = []
      for (const insight of insights) {
        const id = this.insertReflection(agentId, insight, sourceSession ?? null)
        if (id) reflectionIds.push(id)
      }
      if (!reflectionIds.length) {
        this.reflectionAttemptWatermark.set(agentId, maxUnitCreatedAt)
        return null
      }
      this.reflectionAttemptWatermark.delete(agentId)

      this.syncWorkingMemoryAfterMutation(agentId)
      this.emitChanged(agentId, 'extract')
      void this.processPendingEmbeddings(agentId).catch((error) => {
        logger.warn(`[Memory] background embedding failed: ${String(error)}`)
      })
      return { reflectionIds, sourceMemoryIds: top.map((row) => row.id) }
    } catch (error) {
      logger.warn(`[Memory] reflection skipped: ${String(error)}`)
      return null
    }
  }

  // Inserts one reflection insight. source_entry_ids stays null: a reflection has no direct tape
  // span (the units it reasons over are tracked only in the audit anchor). Idempotent on content so
  // a repeated insight is not re-added.
  private insertReflection(
    agentId: string,
    content: string,
    sourceSession: string | null
  ): string | null {
    if (!this.canWriteAgentMemory(agentId)) return null
    const trimmed = content.trim()
    if (!trimmed) return null
    const provenanceKey = buildMemoryProvenanceKey(agentId, 'reflection', trimmed)
    if (this.deps.repository.getByProvenanceKey(agentId, provenanceKey)) return null
    const id = `mem-${nanoid(12)}`
    try {
      this.deps.repository.insert({
        id,
        agentId,
        kind: 'reflection',
        content: trimmed,
        importance: REFLECTION_IMPORTANCE,
        status: 'pending_embedding',
        sourceSession,
        provenanceKey
      })
      return id
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      return null
    }
  }

  // ==================== Persona ====================

  // Writes a new self-model as a DRAFT: never active, never superseding the current persona, never
  // injected (getActivePersona ignores drafts) until the user approves it. Returns the draft id.
  evolvePersona(agentId: string, content: string, sourceSession?: string | null): string | null {
    if (!this.canWriteAgentMemory(agentId)) return null
    const trimmed = content.trim()
    if (!trimmed) return null
    const id = `persona-${nanoid(12)}`
    this.deps.repository.insert({
      id,
      agentId,
      kind: 'persona',
      content: trimmed,
      importance: 1,
      status: 'fts_only',
      sourceSession: sourceSession ?? null,
      personaState: 'draft'
    })
    this.emitChanged(agentId, 'persona-draft')
    return id
  }

  // Guarded persona evolution: when enabled for the agent, distill an updated self-model from recent
  // memories and write it as a draft for user approval. Gated (default off), throttled on accumulated
  // importance since the current self-model, and capped at one outstanding draft. Independent cheap
  // model call; never throws, never injects — approval is the only path to active. Returns the draft
  // (for the audit anchor) or null when off / throttled / unchanged.
  async maybeEvolvePersona(
    agentId: string,
    model: { providerId: string; modelId: string },
    sourceSession?: string | null
  ): Promise<MemoryPersonaDraftResult | null> {
    if (!this.canWriteAgentMemory(agentId) || !this.isPersonaEvolutionEnabled(agentId)) return null
    try {
      return await this.withPersonaLock(agentId, async () => {
        if (!this.canWriteAgentMemory(agentId) || !this.isPersonaEvolutionEnabled(agentId)) {
          return null
        }
        // One outstanding draft at a time: skip before any model call until the user resolves it.
        if (this.deps.repository.getDraftPersona(agentId)) return null

        const units = this.deps.repository.listByAgent(agentId, {
          kinds: ['semantic', 'reflection', 'episodic']
        })
        if (units.length < MIN_MEMORIES_FOR_PERSONA) return null

        const previous = this.deps.repository.getActivePersona(agentId)
        const watermark = Math.max(
          previous?.created_at ?? 0,
          this.personaAttemptWatermark.get(agentId) ?? 0
        )
        const recentImportance = units
          .filter((unit) => unit.created_at > watermark)
          .reduce((sum, unit) => sum + Math.min(1, Math.max(0, unit.importance)), 0)
        if (recentImportance < PERSONA_EVOLUTION_IMPORTANCE_THRESHOLD) return null
        const maxUnitCreatedAt = units.reduce((max, unit) => Math.max(max, unit.created_at), 0)

        const top = units
          .slice()
          .sort((a, b) => b.importance - a.importance || b.created_at - a.created_at)
          .slice(0, PERSONA_MEMORY_LIMIT)
        const personaModel = this.resolveExtractionModel(agentId, model)
        const raw = await this.deps.generateText(
          personaModel.providerId,
          personaModel.modelId,
          buildReflectionPrompt(
            previous?.content ?? null,
            top.map((row) => row.content)
          )
        )
        if (!this.canWriteAgentMemory(agentId) || !this.isPersonaEvolutionEnabled(agentId)) {
          return null
        }
        const content = sanitizeSelfModel(raw)
        // No usable output or no change from the current self-model: advance the watermark so the
        // model is not re-spent on the same units, and produce no draft.
        if (!content || content === (previous?.content?.trim() ?? '')) {
          this.personaAttemptWatermark.set(agentId, maxUnitCreatedAt)
          return null
        }
        const changeRatio = personaChangeRatio(previous?.content ?? null, content)
        const needsReview = previous ? changeRatio > PERSONA_MAX_CHANGE_RATIO : false
        const draftId = this.evolvePersona(agentId, content, sourceSession ?? null)
        this.personaAttemptWatermark.set(agentId, maxUnitCreatedAt)
        if (!draftId) return null
        return { draftId, needsReview, changeRatio }
      })
    } catch (error) {
      logger.warn(`[Memory] persona evolution skipped: ${String(error)}`)
      return null
    }
  }

  // Approve a draft: the user's explicit replacement of the self-model. Supersedes the current active
  // persona (even an anchored one — anchoring guards against automatic drift, not deliberate approval)
  // and promotes the draft to active. Returns false on a stale / foreign / non-draft id.
  async approvePersonaDraft(agentId: string, draftId: string): Promise<boolean> {
    if (this.disposed) return false
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return false
    return this.withPersonaLock(agentId, () => {
      if (this.disposed) return false
      const draft = this.deps.repository.getById(draftId)
      if (
        !draft ||
        draft.agent_id !== agentId ||
        draft.kind !== 'persona' ||
        draft.persona_state !== 'draft'
      ) {
        return false
      }
      const current = this.deps.repository.getActivePersona(agentId)
      if (current && current.id !== draft.id) {
        this.deps.repository.setPersonaState(current.id, 'superseded', draft.id)
      }
      this.deps.repository.setPersonaState(draft.id, 'active', null)
      this.emitChanged(agentId, 'persona-approve')
      return true
    })
  }

  // Reject a draft: it leaves the approval queue and is never injected; the active persona is unchanged.
  async rejectPersonaDraft(agentId: string, draftId: string): Promise<boolean> {
    if (this.disposed) return false
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return false
    return this.withPersonaLock(agentId, () => {
      if (this.disposed) return false
      const draft = this.deps.repository.getById(draftId)
      if (
        !draft ||
        draft.agent_id !== agentId ||
        draft.kind !== 'persona' ||
        draft.persona_state !== 'draft'
      ) {
        return false
      }
      this.deps.repository.setPersonaState(draft.id, 'rejected')
      this.emitChanged(agentId, 'persona-reject')
      return true
    })
  }

  // Anchors (or un-anchors) a persona version. An anchored active persona is never superseded by an
  // automatic rollback, making the is_anchor guard real (it was previously unreachable).
  async setPersonaAnchor(agentId: string, versionId: string, anchored: boolean): Promise<boolean> {
    if (this.disposed) return false
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return false
    return this.withPersonaLock(agentId, () => {
      if (this.disposed) return false
      const row = this.deps.repository.getById(versionId)
      if (!row || row.agent_id !== agentId || row.kind !== 'persona') return false
      this.deps.repository.setAnchor(row.id, anchored)
      this.emitChanged(agentId, 'persona-anchor')
      return true
    })
  }

  listPersonaVersions(agentId: string): AgentMemoryRow[] {
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return []
    return this.deps.repository.listPersonaVersions(agentId)
  }

  // Pending drafts paired with a freshly-computed needsReview: the drift from the current self-model is
  // recomputed on read (not persisted), so it always reflects the live active persona.
  listPersonaDrafts(agentId: string): { row: AgentMemoryRow; needsReview: boolean }[] {
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return []
    const active = this.deps.repository.getActivePersona(agentId)
    return this.deps.repository
      .listPersonaVersions(agentId)
      .filter((row) => row.persona_state === 'draft')
      .map((row) => ({
        row,
        needsReview: active
          ? personaChangeRatio(active.content, row.content) > PERSONA_MAX_CHANGE_RATIO
          : false
      }))
  }

  // Rollback: re-activate a historical persona version and supersede the current active one. Refuses
  // when the current active is anchored, so a rollback can never silently move an anchored self-model;
  // the single-active invariant is preserved either way. The target must be a historical version
  // (superseded, or a legacy row that was already superseded): drafts and rejected versions are never
  // injectable, and re-activating them here would smuggle an unapproved self-model past approval.
  async rollbackPersona(agentId: string, versionId: string): Promise<boolean> {
    if (this.disposed) return false
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return false
    return this.withPersonaLock(agentId, () => {
      if (this.disposed) return false
      const target = this.deps.repository.getById(versionId)
      if (!target || target.agent_id !== agentId || target.kind !== 'persona') return false
      const current = this.deps.repository.getActivePersona(agentId)
      if (current && current.id === versionId) return true
      const isHistorical =
        target.persona_state === 'superseded' ||
        (target.persona_state == null && target.superseded_by != null)
      if (!isHistorical) return false
      if (current && current.is_anchor === 1) return false
      if (current) {
        this.deps.repository.setPersonaState(current.id, 'superseded', versionId)
      }
      this.deps.repository.setPersonaState(versionId, 'active', null)
      this.emitChanged(agentId, 'persona-rollback')
      return true
    })
  }

  // ==================== Management ====================

  listMemories(agentId: string): AgentMemoryRow[] {
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return []
    return this.deps.repository.listByAgent(agentId, { includeArchived: true })
  }

  getLifecycle(agentId: string, memoryId: string): MemoryLifecycle[] {
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return []

    const row = this.deps.repository.getById(memoryId)
    if (!row || row.agent_id !== agentId || row.kind === 'working') return []
    const context = this.createLifecycleDerivationContext(agentId)
    return [deriveLifecycle(row, context.now, context.options)]
  }

  getArchiveCandidateLifecyclePreview(agentId: string): MemoryArchiveCandidateLifecyclePreview {
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) {
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
    const rows = this.deps.repository.listArchiveCandidateLifecycleRows(
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
    const config = this.deps.resolveAgentConfig(agentId)
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
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) {
      return createEmptyMemoryHealth(MEMORY_HEALTH_AUDIT_SCAN_LIMIT)
    }

    const stats = this.deps.repository.getHealthStats(agentId)
    const embedding = this.deps.resolveAgentConfig(agentId)?.memoryEmbedding
    let stale = 0
    if (embedding?.providerId && embedding.modelId) {
      const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
      const currentDim = this.resolveStoredCurrentEmbeddingDimension(agentId, fingerprint)
      if (currentDim !== null) {
        stale = this.deps.repository.countStaleEmbeddings(agentId, currentDim, fingerprint)
      }
    }

    const auditStats = this.deps.auditRepository?.getHealthAuditStats(
      agentId,
      MEMORY_HEALTH_AUDIT_SCAN_LIMIT,
      MEMORY_HEALTH_RECENT_FAILURES_LIMIT
    )
    const topAccessed = this.deps.repository
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
        archiveCandidates: this.deps.repository.countArchiveCandidates(
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
    if (this.disposed) return false
    this.assertSafeAgentId(agentId)
    if (!this.isManagedAgent(agentId)) return false
    const row = this.deps.repository.getById(memoryId)
    if (!row || row.agent_id !== agentId) return false
    this.deps.repository.delete(memoryId)
    if (row.kind !== 'working') {
      this.syncWorkingMemoryAfterMutation(agentId)
    }
    await this.deleteVectorsForMemoryIds(agentId, [memoryId])
    if (this.disposed) return true
    this.emitChanged(agentId, 'delete')
    return true
  }

  async clearMemories(agentId: string): Promise<number> {
    if (this.disposed) return 0
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
    if (removed > 0 && this.deps.repository.countByAgent(agentId) === 0) {
      this.lastConsolidationAt.delete(agentId)
    }
    return removed
  }

  async cleanupDeletedAgentResources(agentId: string): Promise<void> {
    if (this.disposed) return
    this.assertSafeAgentId(agentId)
    this.clearPrewarmTimer(agentId)
    let resetError: unknown
    try {
      await this.runExclusiveForAgent(agentId, async () => {
        await this.closeVectorStore(agentId)
        await this.deps.resetVectorStore(agentId)
      })
    } catch (error) {
      resetError = error
    } finally {
      const timer = this.consolidationTimers.get(agentId)
      if (timer) clearTimeout(timer)
      this.consolidationTimers.delete(agentId)
      this.consolidationTimerDueAt.delete(agentId)
      this.lastConsolidationAt.delete(agentId)
      this.reflectionAttemptWatermark.delete(agentId)
      this.personaAttemptWatermark.delete(agentId)
      this.workingRefreshInFlight.delete(agentId)
      await this.settleDeletedAgentInFlight(agentId)
    }
    if (resetError) throw resetError
  }

  private async deleteVectorsForMemoryIds(agentId: string, memoryIds: string[]): Promise<void> {
    if (!memoryIds.length) return
    // Run vector deletes under the per-agent lock so dispose() awaits them (via vectorStoreLocks)
    // before closing the sidecar. If teardown already began, skip it: SQLite status is authoritative
    // and recall ignores rows that are archived/deleted.
    await this.runExclusiveForAgent(agentId, async () => {
      if (this.disposed) return
      const store = await this.vectorStoreForAgent(agentId)
      if (!store) return
      await store.deleteByMemoryIds(memoryIds).catch((error) => {
        logger.warn(`[Memory] vector delete failed: ${String(error)}`)
      })
    })
  }

  private async settleDeletedAgentInFlight(agentId: string): Promise<void> {
    const reindexing = this.reindexing.get(agentId)
    const backfilling = this.backfilling.get(agentId)
    const embeddingDrain = this.embeddingDrains.get(agentId)
    const vectorStoreLock = this.vectorStoreLocks.get(agentId)
    const personaLock = this.personaLocks.get(agentId)
    const vectorWarmups = [...this.vectorStoreWarmups.entries()].filter(([key]) =>
      key.startsWith(`${agentId}::`)
    )
    const embeddingWarmups = [...this.embeddingWarmups.entries()].filter(([key]) =>
      key.startsWith(`${agentId}::`)
    )
    await Promise.allSettled(
      [
        reindexing,
        backfilling,
        embeddingDrain,
        vectorStoreLock,
        personaLock,
        ...vectorWarmups.map(([, promise]) => promise),
        ...embeddingWarmups.map(([, promise]) => promise)
      ].filter((promise): promise is Promise<unknown> => Boolean(promise))
    )
    if (this.reindexing.get(agentId) === reindexing) this.reindexing.delete(agentId)
    if (this.backfilling.get(agentId) === backfilling) this.backfilling.delete(agentId)
    if (this.embeddingDrains.get(agentId) === embeddingDrain) this.embeddingDrains.delete(agentId)
    if (this.vectorStoreLocks.get(agentId) === vectorStoreLock)
      this.vectorStoreLocks.delete(agentId)
    if (this.personaLocks.get(agentId) === personaLock) this.personaLocks.delete(agentId)
    for (const [key, promise] of vectorWarmups) {
      if (this.vectorStoreWarmups.get(key) === promise) this.vectorStoreWarmups.delete(key)
    }
    for (const [key, promise] of embeddingWarmups) {
      if (this.embeddingWarmups.get(key) === promise) this.embeddingWarmups.delete(key)
    }
    for (const key of this.vectorStoreDimensionFailures.keys()) {
      if (key.startsWith(`${agentId}::`)) this.vectorStoreDimensionFailures.delete(key)
    }
    this.vectorStoreReady.delete(agentId)
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
      // Reflects an approved self-model only; a pending draft does not count as having a persona.
      hasPersona: this.deps.repository.getActivePersona(agentId) !== undefined,
      reindexing: this.reindexing.has(agentId)
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.stopBackgroundMaintenance()
    for (const timer of this.consolidationTimers.values()) clearTimeout(timer)
    this.consolidationTimers.clear()
    this.consolidationTimerDueAt.clear()
    this.lastConsolidationAt.clear()
    // Drain every background writer started before teardown so none touches the database after it
    // closes: consolidation passes, plus the reindex/backfill/embedding drains and prewarm calls a
    // pass's retrieve() may have fired. `disposed` blocks new ones, so the in-flight set shrinks to
    // empty. Bounded in case a drain keeps spawning follow-up work.
    for (let i = 0; i < REINDEX_MAX_BATCHES; i += 1) {
      const inflight = [
        ...this.consolidationRuns,
        ...this.reindexing.values(),
        ...this.backfilling.values(),
        ...this.embeddingDrains.values(),
        ...this.vectorStoreWarmups.values(),
        ...this.embeddingWarmups.values()
      ]
      if (!inflight.length) break
      await Promise.allSettled(inflight)
    }
    this.consolidationRuns.clear()
    // A recall's store open started before teardown is not a background writer, so it is not in the
    // drain set above. Await the per-agent open/close lock chains so any store opened during teardown
    // is cached by the time the close-loop runs and is closed here instead of leaking past it. Store
    // opens are fast file ops (no network/embedding await), so this cannot stall teardown.
    await Promise.allSettled(this.vectorStoreLocks.values())
    for (const pending of this.vectorStores.values()) {
      const store = await pending.catch(() => null)
      if (store) await store.close().catch(() => undefined)
    }
    this.vectorStores.clear()
    this.vectorStoreIdentities.clear()
    this.vectorStoreReady.clear()
    this.vectorStoreWarmups.clear()
    this.vectorStoreDimensionFailures.clear()
    this.embeddingWarmups.clear()
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

  // True when any embedded row was produced by a different model/dimension than the current
  // config (or carries no fingerprint, i.e. predates the fingerprint column). Such rows can no
  // longer be served by the current vector store and must be re-embedded. persona rows are
  // ignored: they are never meant to be vectors, so an anomalous embedded persona (buggy/manual
  // data) must not be read as "stale" and drive a reindex on every recall.
  private hasStaleEmbeddings(agentId: string, currentDim: number, fingerprint: string): boolean {
    return this.deps.repository.hasStaleEmbeddings(agentId, currentDim, fingerprint)
  }

  private canUseCurrentMemoryEmbedding(
    agentId: string,
    embedding: { providerId: string; modelId: string }
  ): boolean {
    const current = this.deps.resolveAgentConfig(agentId)?.memoryEmbedding
    return (
      current?.providerId === embedding.providerId &&
      current?.modelId === embedding.modelId &&
      this.canReadAgentMemory(agentId)
    )
  }

  private vectorStoreCacheKey(
    agentId: string,
    embedding: { providerId: string; modelId: string },
    dimensions: number
  ): string {
    return `${agentId}::${embedding.providerId}::${embedding.modelId}::${dimensions}`
  }

  private vectorStoreWarmupKey(
    agentId: string,
    embedding: { providerId: string; modelId: string }
  ): string {
    return `${agentId}::${embedding.providerId}::${embedding.modelId}`
  }

  private isVectorStoreWarm(
    agentId: string,
    embedding: { providerId: string; modelId: string }
  ): boolean {
    const readyIdentity = this.vectorStoreReady.get(agentId)
    if (!readyIdentity) return false
    if (this.vectorStoreIdentities.get(agentId) !== readyIdentity) return false
    if (!this.vectorStores.has(agentId)) return false
    // The warmup key is the 3-part identity prefix; the ready/cache key appends the dimension.
    return readyIdentity.startsWith(`${this.vectorStoreWarmupKey(agentId, embedding)}::`)
  }

  private markVectorStoreReady(
    agentId: string,
    embedding: { providerId: string; modelId: string },
    dimensions: number
  ): void {
    this.vectorStoreReady.set(agentId, this.vectorStoreCacheKey(agentId, embedding, dimensions))
  }

  private clearVectorStoreReady(agentId: string): void {
    this.vectorStoreReady.delete(agentId)
  }

  private resolveStoredCurrentEmbeddingDimension(
    agentId: string,
    fingerprint: string
  ): number | null {
    return this.deps.repository.getCurrentEmbeddingDimension(agentId, fingerprint)
  }

  private async resolveWarmVectorDimensions(
    agentId: string,
    embedding: { providerId: string; modelId: string }
  ): Promise<number> {
    const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
    const storedDim = this.resolveStoredCurrentEmbeddingDimension(agentId, fingerprint)
    const key = this.vectorStoreWarmupKey(agentId, embedding)
    if (storedDim !== null) {
      this.vectorStoreDimensionFailures.delete(key)
      return storedDim
    }
    const lastFailureAt = this.vectorStoreDimensionFailures.get(key)
    if (
      lastFailureAt !== undefined &&
      Date.now() - lastFailureAt < WARM_DIMENSION_FAILURE_COOLDOWN_MS
    ) {
      throw new Error(
        `[Memory] embedding dimension warm is cooling down for ${embedding.providerId}/${embedding.modelId}`
      )
    }

    try {
      const attrs = await this.deps.getDimensions(embedding.providerId, embedding.modelId)
      const dimensions = attrs.data.dimensions
      if (!Number.isFinite(dimensions) || dimensions <= 0) {
        throw new Error(
          attrs.errorMsg ??
            `[Memory] invalid embedding dimension for ${embedding.providerId}/${embedding.modelId}`
        )
      }
      this.vectorStoreDimensionFailures.delete(key)
      return dimensions
    } catch (error) {
      this.vectorStoreDimensionFailures.set(key, Date.now())
      throw error
    }
  }

  private warmVectorStore(
    agentId: string,
    embedding: { providerId: string; modelId: string }
  ): Promise<void> {
    if (this.disposed || !this.canUseCurrentMemoryEmbedding(agentId, embedding))
      return Promise.resolve()
    const key = this.vectorStoreWarmupKey(agentId, embedding)
    const inflight = this.vectorStoreWarmups.get(key)
    if (inflight) return inflight

    const tracked = Promise.resolve()
      .then(() => this.runWarmVectorStore(agentId, embedding))
      .catch((error) => {
        this.clearVectorStoreReady(agentId)
        logger.warn(`[Memory] vector store warm failed for ${agentId}: ${String(error)}`)
      })
      .finally(() => {
        if (this.vectorStoreWarmups.get(key) === tracked) this.vectorStoreWarmups.delete(key)
      })
    this.vectorStoreWarmups.set(key, tracked)
    return tracked
  }

  private async runWarmVectorStore(
    agentId: string,
    embedding: { providerId: string; modelId: string }
  ): Promise<void> {
    if (!this.canUseCurrentMemoryEmbedding(agentId, embedding)) return
    const dimensions = await this.resolveWarmVectorDimensions(agentId, embedding)
    if (!this.canUseCurrentMemoryEmbedding(agentId, embedding)) return

    const store = await this.getVectorStore(agentId, embedding, dimensions)
    if (!this.canUseCurrentMemoryEmbedding(agentId, embedding)) return

    if (!store.isUsable()) {
      this.clearVectorStoreReady(agentId)
      if (!this.reindexing.has(agentId)) {
        void this.reindexEmbeddings(agentId, true).catch((error) => {
          logger.warn(`[Memory] store rebuild failed for ${agentId}: ${String(error)}`)
        })
      }
      return
    }

    const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
    if (this.hasStaleEmbeddings(agentId, dimensions, fingerprint)) {
      this.clearVectorStoreReady(agentId)
      void this.reindexEmbeddings(agentId).catch((error) => {
        logger.warn(`[Memory] reindex failed for ${agentId}: ${String(error)}`)
      })
      return
    }

    this.markVectorStoreReady(agentId, embedding, dimensions)
    if (!this.reindexing.has(agentId)) {
      void this.backfillEmbeddings(agentId).catch((error) => {
        logger.warn(`[Memory] backfill failed for ${agentId}: ${String(error)}`)
      })
    }
  }

  private warmEmbeddingConnection(
    agentId: string,
    embedding: { providerId: string; modelId: string }
  ): void {
    if (this.disposed || !this.canUseCurrentMemoryEmbedding(agentId, embedding)) return
    const key = this.vectorStoreWarmupKey(agentId, embedding)
    if (this.embeddingWarmups.has(key)) return
    const tracked = Promise.resolve()
      .then(async () => {
        await this.deps.getEmbeddings(embedding.providerId, embedding.modelId, [
          EMBEDDING_PREWARM_TEXT
        ])
      })
      .catch((error) => {
        logger.warn(`[Memory] embedding warm failed for ${agentId}: ${String(error)}`)
      })
      .finally(() => {
        if (this.embeddingWarmups.get(key) === tracked) this.embeddingWarmups.delete(key)
      })
    this.embeddingWarmups.set(key, tracked)
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
    this.clearVectorStoreReady(agentId)
    const pending = this.vectorStores.get(agentId)
    if (!pending) {
      this.vectorStoreIdentities.delete(agentId)
      return
    }
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
      this.clearVectorStoreReady(agentId)
      throw error
    })
    this.vectorStores.set(agentId, pending)
    this.vectorStoreIdentities.set(agentId, identity)
    return pending
  }
}
