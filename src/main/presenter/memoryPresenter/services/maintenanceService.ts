import logger from '@shared/logger'

import { isAgentMemoryCategory } from '@shared/types/agent-memory'
import { ARCHIVE_AGE_MS, ARCHIVE_DECAY_THRESHOLD } from '../core/lifecycle'
import { distanceToSimilarity } from '../core/scoring'
import {
  ADD_DECISION,
  buildDecisionPrompt,
  parseDecision,
  type MemoryDecision
} from '../core/decision'
import { normalizeMemoryCandidate } from '../core/candidates'
import { estimateTokens } from '../core/injectionPort'
import {
  CONSOLIDATION_COOLDOWN_MS,
  CONSOLIDATION_IDLE_MS,
  CONSOLIDATION_MAX_INPUT_TOKENS,
  CONSOLIDATION_MAX_LLM_CALLS,
  CONSOLIDATION_MAX_NEIGHBOR_SCANS,
  CONSOLIDATION_MERGE_SIMILARITY,
  DECISION_NEIGHBOR_TOP_S,
  MAINTENANCE_START_DELAY_MS,
  STARTUP_ARM_STAGGER_MS,
  STARTUP_PREWARM_DELAY_MS,
  STARTUP_PREWARM_STAGGER_MS,
  VECTOR_PRUNE_BATCH_LIMIT
} from '../runtimeConstants'
import {
  isSafeAgentId,
  type AgentMemoryRow,
  type ConsolidationScanCursor,
  FORGET_HALF_LIFE_MS,
  type MemoryPersonaDraftResult,
  type MemoryReflectionResult
} from '../types'
import type { MemoryRowMutations } from './rowMutations'
import { embeddingFingerprint, type MemoryModelRef, type MemoryRuntimeContext } from '../context'

export class MaintenanceService {
  private readonly consolidationTimers = new Map<string, NodeJS.Timeout>()
  private readonly consolidationTimerDueAt = new Map<string, number>()
  private readonly lastConsolidationAt = new Map<string, number>()
  private readonly consolidationScanCursor = new Map<string, ConsolidationScanCursor>()
  private readonly consolidationRuns = new Set<Promise<unknown>>()
  private maintenanceStartTimer: NodeJS.Timeout | null = null
  private prewarmStartTimer: NodeJS.Timeout | null = null
  private readonly prewarmTimers = new Map<string, NodeJS.Timeout>()
  private maintenanceStarted = false

  constructor(
    private readonly ctx: MemoryRuntimeContext,
    private readonly rows: MemoryRowMutations,
    private readonly ports: {
      queryNeighborsByMemoryId: (
        agentId: string,
        embedding: MemoryModelRef,
        dimensions: number,
        memoryId: string,
        topK: number
      ) => Promise<Array<{ memoryId: string; distance: number }>>
      getWarmVectorStoreDimension: (agentId: string, embedding: MemoryModelRef) => number | null
      deletePrunableVectorsForMemoryIds: (
        agentId: string,
        embedding: MemoryModelRef,
        dimensions: number,
        memoryIds: string[]
      ) => Promise<string[]>
      syncWorkingMemoryAfterMutation: (agentId: string) => void
      triggerEmbedding: (agentId: string) => Promise<void>
      warmVectorStore: (agentId: string, embedding: MemoryModelRef) => Promise<void>
      warmEmbeddingConnection: (agentId: string, embedding: MemoryModelRef) => void
      maybeReflect: (
        agentId: string,
        model: MemoryModelRef
      ) => Promise<MemoryReflectionResult | null>
      maybeEvolvePersona: (
        agentId: string,
        model: MemoryModelRef
      ) => Promise<MemoryPersonaDraftResult | null>
      runChallengeResolutionPass: (agentId: string, model: MemoryModelRef) => Promise<boolean>
      runConsolidationPass: (agentId: string) => Promise<void>
    }
  ) {}

  startBackgroundMaintenance(): void {
    if (this.ctx.isDisposed || this.maintenanceStarted) return
    this.maintenanceStarted = true
    this.prewarmStartTimer = setTimeout(() => {
      this.prewarmStartTimer = null
      if (this.ctx.isDisposed) return
      this.warmActiveAgents()
    }, STARTUP_PREWARM_DELAY_MS)
    if (typeof this.prewarmStartTimer.unref === 'function') this.prewarmStartTimer.unref()
    this.maintenanceStartTimer = setTimeout(() => {
      this.maintenanceStartTimer = null
      if (this.ctx.isDisposed) return
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

  prepareDispose(): void {
    this.stopBackgroundMaintenance()
    for (const timer of this.consolidationTimers.values()) clearTimeout(timer)
    this.consolidationTimers.clear()
    this.consolidationTimerDueAt.clear()
    this.lastConsolidationAt.clear()
    this.consolidationScanCursor.clear()
  }

  private shouldArmMaintenance(agentId: string): boolean {
    return isSafeAgentId(agentId) && this.ctx.isManagedAgent(agentId) && this.ctx.isEnabled(agentId)
  }

  private armCurrentActiveAgents(): void {
    try {
      this.armActiveAgentsStaggered(this.ctx.deps.repository.listAgentIdsWithMemories())
    } catch (error) {
      logger.warn(`[Memory] maintenance arm skipped: ${String(error)}`)
    }
  }

  warmActiveAgents(): void {
    if (this.ctx.isDisposed) return
    try {
      this.warmActiveAgentsStaggered(this.ctx.deps.repository.listAgentIdsWithMemories())
    } catch (error) {
      logger.warn(`[Memory] startup prewarm skipped: ${String(error)}`)
    }
  }

  private armActiveAgentsStaggered(agentIds: string[]): void {
    if (this.ctx.isDisposed) return
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
    if (this.ctx.isDisposed) return
    agentIds
      .filter((agentId) => this.shouldArmMaintenance(agentId))
      .sort()
      .forEach((agentId, index) => {
        this.clearPrewarmTimer(agentId)
        const timer = setTimeout(() => {
          if (this.prewarmTimers.get(agentId) === timer) this.prewarmTimers.delete(agentId)
          if (this.ctx.isDisposed || !this.ctx.canReadAgentMemory(agentId)) return
          const embedding = this.ctx.deps.resolveAgentConfig(agentId)?.memoryEmbedding
          if (!embedding?.providerId || !embedding?.modelId) return
          const currentEmbedding = {
            providerId: embedding.providerId,
            modelId: embedding.modelId
          }
          void this.ports.warmVectorStore(agentId, currentEmbedding).catch((error) => {
            logger.warn(`[Memory] startup prewarm failed for ${agentId}: ${String(error)}`)
          })
          this.ports.warmEmbeddingConnection(agentId, currentEmbedding)
        }, index * STARTUP_PREWARM_STAGGER_MS)
        this.prewarmTimers.set(agentId, timer)
        if (typeof timer.unref === 'function') timer.unref()
      })
  }

  clearPrewarmTimer(agentId: string): void {
    const timer = this.prewarmTimers.get(agentId)
    if (!timer) return
    clearTimeout(timer)
    this.prewarmTimers.delete(agentId)
  }

  onAgentMemoryMaintenanceConfigChanged(
    agentId: string,
    delayMs: number = CONSOLIDATION_IDLE_MS
  ): void {
    if (this.ctx.isDisposed || !this.shouldArmMaintenance(agentId)) return
    if (!this.ctx.deps.repository.hasActiveMemory(agentId)) return
    this.scheduleConsolidation(agentId, delayMs, { preserveEarlier: true })
  }

  onBuiltinDeepChatMemoryMaintenanceConfigChanged(): void {
    if (this.ctx.isDisposed) return
    this.armCurrentActiveAgents()
  }

  scheduleConsolidation(
    agentId: string,
    delayMs: number = CONSOLIDATION_IDLE_MS,
    options: { preserveEarlier?: boolean } = {}
  ): void {
    if (this.ctx.isDisposed) return
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
      const run = this.ports.runConsolidationPass(agentId).catch((error) => {
        logger.warn(`[Memory] consolidation pass failed for ${agentId}: ${String(error)}`)
      })
      this.consolidationRuns.add(run)
      void run.finally(() => this.consolidationRuns.delete(run))
    }, delayMs)
    if (typeof timer.unref === 'function') timer.unref()
    this.consolidationTimers.set(agentId, timer)
    this.consolidationTimerDueAt.set(agentId, dueAt)
  }

  async runConsolidationPass(agentId: string, now: number = Date.now()): Promise<void> {
    if (!this.ctx.canWriteAgentMemory(agentId)) return
    let last = this.lastConsolidationAt.get(agentId)
    if (last === undefined) {
      last =
        this.ctx.deps.auditRepository?.getLatestCompletedEventAt(
          agentId,
          'memory/maintenance_llm'
        ) ?? 0
      this.lastConsolidationAt.set(agentId, last)
    }
    if (now - last < CONSOLIDATION_COOLDOWN_MS) {
      await this.runCheapMaintenance(agentId, now, true)
      return
    }
    await this.runCheapMaintenance(agentId, now, false)
    const model = this.ctx.resolveConsolidationModel(agentId)
    if (!model) {
      this.archiveStale(agentId, now)
      await this.pruneDeadVectors(agentId)
      this.ctx.writeAudit(agentId, {
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
    if (!this.ctx.canWriteAgentMemory(agentId)) return
    try {
      if (await this.ports.runChallengeResolutionPass(agentId, model)) touched = true
    } catch (error) {
      logger.warn(`[Memory] challenge resolution failed for ${agentId}: ${String(error)}`)
    }
    if (!this.ctx.canWriteAgentMemory(agentId)) return
    try {
      const reflection = await this.ports.maybeReflect(agentId, model)
      if (reflection) {
        this.ctx.writeAudit(agentId, {
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
    if (!this.ctx.canWriteAgentMemory(agentId)) return
    try {
      const personaDraft = await this.ports.maybeEvolvePersona(agentId, model)
      if (personaDraft) {
        this.ctx.writeAudit(agentId, {
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
    if (!this.ctx.canWriteAgentMemory(agentId)) return
    this.refreshDecayScores(agentId, now)
    this.archiveStale(agentId, now)
    await this.pruneDeadVectors(agentId)
    this.ports.syncWorkingMemoryAfterMutation(agentId)
    this.stampConsolidation(agentId, now)
    this.ctx.writeAudit(agentId, {
      eventType: 'memory/maintenance_llm',
      actorType: 'scheduler',
      status: 'completed',
      outputRefs: { touched },
      model,
      createdAt: now
    })

    if (touched) {
      void this.ports.triggerEmbedding(agentId).catch((error) => {
        logger.warn(`[Memory] background embedding failed: ${String(error)}`)
      })
      this.ctx.emitChanged(agentId, 'extract')
    }
  }

  private async mergeNearDuplicates(
    agentId: string,
    now: number,
    model: MemoryModelRef
  ): Promise<boolean> {
    const embedding = this.ctx.deps.resolveAgentConfig(agentId)?.memoryEmbedding
    if (!embedding?.providerId || !embedding?.modelId) return false
    const currentEmbedding = { providerId: embedding.providerId, modelId: embedding.modelId }
    const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
    const dimensions = this.ctx.deps.repository.getCurrentEmbeddingDimension(agentId, fingerprint)
    if (dimensions === null) return false
    await this.ports.warmVectorStore(agentId, currentEmbedding)
    if (!this.ctx.canWriteAgentMemory(agentId)) return false

    const cursor = this.consolidationScanCursor.get(agentId)
    let scanRows = this.ctx.deps.repository.listConsolidationScanRows(agentId, {
      embeddingDim: dimensions,
      embeddingModel: fingerprint,
      after: cursor,
      limit: CONSOLIDATION_MAX_NEIGHBOR_SCANS + 1
    })
    if (cursor && scanRows.length === 0) {
      scanRows = this.ctx.deps.repository.listConsolidationScanRows(agentId, {
        embeddingDim: dimensions,
        embeddingModel: fingerprint,
        limit: CONSOLIDATION_MAX_NEIGHBOR_SCANS + 1
      })
    }
    const hasMore = scanRows.length > CONSOLIDATION_MAX_NEIGHBOR_SCANS
    scanRows = scanRows.slice(0, CONSOLIDATION_MAX_NEIGHBOR_SCANS)
    if (!scanRows.length) {
      this.consolidationScanCursor.delete(agentId)
      return false
    }

    let calls = 0
    let inputTokens = 0
    const merged = new Set<string>()
    let lastScanned: AgentMemoryRow | null = null
    let touched = false

    for (const row of scanRows) {
      if (calls >= CONSOLIDATION_MAX_LLM_CALLS || inputTokens >= CONSOLIDATION_MAX_INPUT_TOKENS) {
        break
      }
      lastScanned = row
      if (merged.has(row.id)) continue
      const source = this.ctx.deps.repository.getById(row.id)
      if (!this.isCurrentEmbeddedConsolidationRow(agentId, source, dimensions, fingerprint))
        continue

      let matches: Array<{ memoryId: string; distance: number }> = []
      try {
        matches = await this.ports.queryNeighborsByMemoryId(
          agentId,
          currentEmbedding,
          dimensions,
          source.id,
          DECISION_NEIGHBOR_TOP_S
        )
      } catch {
        continue
      }
      if (!this.ctx.canWriteAgentMemory(agentId)) break
      let neighbor: AgentMemoryRow | null = null
      for (const match of matches) {
        if (match.memoryId === source.id || merged.has(match.memoryId)) continue
        if (distanceToSimilarity(match.distance) < CONSOLIDATION_MERGE_SIMILARITY) continue
        const neighborRow = this.ctx.deps.repository.getById(match.memoryId)
        if (!this.isCurrentEmbeddedConsolidationRow(agentId, neighborRow, dimensions, fingerprint))
          continue
        neighbor = neighborRow
        break
      }
      if (!neighbor) continue

      const promptCandidate = normalizeMemoryCandidate({
        kind: source.kind === 'episodic' ? 'episodic' : 'semantic',
        category: source.category,
        content: source.content,
        importance: source.importance
      })
      if (!promptCandidate) continue
      const prompt = buildDecisionPrompt(promptCandidate, [{ content: neighbor.content }])
      calls += 1
      inputTokens += estimateTokens(prompt)
      let decision: MemoryDecision = ADD_DECISION
      try {
        const raw = await this.ctx.deps.generateText(model.providerId, model.modelId, prompt)
        decision = parseDecision(raw, 1)
      } catch (error) {
        logger.warn(`[Memory] consolidation decision failed: ${String(error)}`)
        continue
      }
      if (!this.ctx.canWriteAgentMemory(agentId)) break

      if (decision.decision === 'UPDATE' || decision.decision === 'SUPERSEDE') {
        const [primary, secondary] =
          source.created_at >= neighbor.created_at ? [source, neighbor] : [neighbor, source]
        const mergedContent = decision.mergedContent ?? primary.content
        const secondaryCategory = isAgentMemoryCategory(secondary.category)
          ? secondary.category
          : null
        const update = this.rows.applyContentUpdate(
          agentId,
          primary,
          mergedContent,
          now,
          secondaryCategory
        )
        if (update.action === 'suppressed') {
          this.ctx.deps.repository.setLastConsolidatedAt(source.id, now)
          this.ctx.deps.repository.setLastConsolidatedAt(neighbor.id, now)
          merged.add(source.id)
          merged.add(neighbor.id)
          continue
        }
        const survivorId = update.id
        this.rows.bumpConfidence(survivorId)
        this.ctx.deps.repository.setImportance(survivorId, secondary.importance)
        this.ctx.deps.repository.updateStatus(survivorId, 'pending_embedding')
        if (secondary.id !== survivorId) {
          this.ctx.deps.repository.markSuperseded(secondary.id, survivorId)
        }
        merged.add(primary.id)
        merged.add(secondary.id)
        merged.add(survivorId)
        touched = true
      }
      this.ctx.deps.repository.setLastConsolidatedAt(source.id, now)
    }
    const windowFullyScanned =
      !!lastScanned &&
      scanRows.length > 0 &&
      lastScanned.id === scanRows[scanRows.length - 1].id &&
      lastScanned.created_at === scanRows[scanRows.length - 1].created_at
    if (lastScanned && (hasMore || !windowFullyScanned)) {
      this.consolidationScanCursor.set(agentId, {
        createdAt: lastScanned.created_at,
        id: lastScanned.id
      })
    } else {
      this.consolidationScanCursor.delete(agentId)
    }
    return touched
  }

  private isLiveConsolidationNeighbor(
    agentId: string,
    row: AgentMemoryRow | undefined
  ): row is AgentMemoryRow {
    return (
      !!row &&
      row.agent_id === agentId &&
      !row.superseded_by &&
      row.kind !== 'persona' &&
      row.kind !== 'working' &&
      row.status !== 'archived' &&
      row.status !== 'conflicted'
    )
  }

  private isCurrentEmbeddedConsolidationRow(
    agentId: string,
    row: AgentMemoryRow | undefined,
    dimensions: number,
    fingerprint: string
  ): row is AgentMemoryRow {
    return (
      this.isLiveConsolidationNeighbor(agentId, row) &&
      row.status === 'embedded' &&
      row.embedding_dim === dimensions &&
      row.embedding_model === fingerprint
    )
  }

  private async runCheapMaintenance(agentId: string, now: number, archive: boolean): Promise<void> {
    this.refreshDecayScores(agentId, now)
    if (archive) {
      this.archiveStale(agentId, now)
      await this.pruneDeadVectors(agentId)
    }
    const repaired = this.ctx.deps.repository.repairInternalKindStatuses(agentId)
    if (repaired > 0) {
      this.ctx.writeAudit(agentId, {
        eventType: 'memory/repair',
        actorType: 'scheduler',
        status: 'completed',
        outputRefs: { repaired }
      })
    }
    this.ports.syncWorkingMemoryAfterMutation(agentId)
  }

  private async pruneDeadVectors(agentId: string): Promise<void> {
    const embedding = this.ctx.deps.resolveAgentConfig(agentId)?.memoryEmbedding
    if (!embedding?.providerId || !embedding?.modelId) return
    const currentEmbedding = { providerId: embedding.providerId, modelId: embedding.modelId }
    const dimensions = this.ports.getWarmVectorStoreDimension(agentId, currentEmbedding)
    if (dimensions === null) return
    const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
    const refs = this.ctx.deps.repository.listPrunableVectorRefs(agentId, {
      limit: VECTOR_PRUNE_BATCH_LIMIT,
      embeddingModel: fingerprint,
      embeddingDim: dimensions
    })
    if (!refs.length) return
    if (!this.ctx.canWriteAgentMemory(agentId)) return
    const deletedIds = await this.ports.deletePrunableVectorsForMemoryIds(
      agentId,
      currentEmbedding,
      dimensions,
      refs.map((ref) => ref.id)
    )
    if (deletedIds.length && this.ctx.canWriteAgentMemory(agentId)) {
      this.ctx.deps.repository.clearPrunableEmbeddingRefs(
        agentId,
        deletedIds,
        dimensions,
        fingerprint
      )
    }
  }

  private stampConsolidation(agentId: string, now: number): void {
    this.ctx.deps.repository.stampConsolidationForAgent(agentId, now)
  }

  refreshDecayScores(agentId: string, now: number): void {
    this.ctx.deps.repository.refreshDecayScoresForAgent(agentId, now, FORGET_HALF_LIFE_MS)
  }

  archiveStale(agentId: string, now: number = Date.now()): number {
    const before = now - ARCHIVE_AGE_MS
    const candidates = this.ctx.deps.repository.listArchiveCandidates(
      agentId,
      before,
      ARCHIVE_DECAY_THRESHOLD
    )
    let archived = 0
    for (const row of candidates) {
      if (row.access_count !== 0) continue
      this.ctx.deps.repository.archive(row.id, now)
      archived += 1
    }
    if (archived > 0) {
      this.ports.syncWorkingMemoryAfterMutation(agentId)
      this.ctx.emitChanged(agentId, 'extract')
    }
    return archived
  }

  clearCooldown(agentId: string): void {
    this.lastConsolidationAt.delete(agentId)
  }

  cleanupAgent(agentId: string): void {
    this.clearPrewarmTimer(agentId)
    const timer = this.consolidationTimers.get(agentId)
    if (timer) clearTimeout(timer)
    this.consolidationTimers.delete(agentId)
    this.consolidationTimerDueAt.delete(agentId)
    this.lastConsolidationAt.delete(agentId)
    this.consolidationScanCursor.delete(agentId)
  }

  getInFlight(): Promise<unknown>[] {
    return [...this.consolidationRuns]
  }

  clearInFlight(): void {
    this.consolidationRuns.clear()
  }

  /** @internal Live mutable state for legacy facade-oracle tests only. */
  getMutableRuntimeStateForTests(): {
    consolidationTimers: Map<string, NodeJS.Timeout>
    lastConsolidationAt: Map<string, number>
    consolidationScanCursor: Map<string, ConsolidationScanCursor>
  } {
    return {
      consolidationTimers: this.consolidationTimers,
      lastConsolidationAt: this.lastConsolidationAt,
      consolidationScanCursor: this.consolidationScanCursor
    }
  }
}
