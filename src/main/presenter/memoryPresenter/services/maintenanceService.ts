import logger from '@shared/logger'
import { unicodeCodePointLength } from '@shared/lib/unicodeText'

import {
  AGENT_MEMORY_AUTO_CONTENT_MAX_CHARS,
  isAgentMemoryCategory
} from '@shared/types/agent-memory'
import { ARCHIVE_AGE_MS, ARCHIVE_DECAY_THRESHOLD } from '../core/lifecycle'
import { buildMemoryProvenanceKey, distanceToSimilarity } from '../core/scoring'
import {
  ADD_DECISION,
  buildDecisionPrompt,
  parseDecision,
  type MemoryDecision
} from '../core/decision'
import { normalizeMemoryCandidate } from '../core/candidates'
import { estimateTokens } from '../core/injectionPort'
import { MaintenanceBudget } from '../core/maintenanceBudget'
import { AsyncSemaphore } from '../../../lib/asyncSemaphore'
import {
  CONSOLIDATION_COOLDOWN_MS,
  CONSOLIDATION_FAILURE_COOLDOWN_MS,
  CONSOLIDATION_IDLE_MS,
  CONSOLIDATION_MAX_NEIGHBOR_SCANS,
  CONSOLIDATION_MERGE_SIMILARITY,
  DECISION_NEIGHBOR_TOP_S,
  MAINTENANCE_HEAVY_MAX_CONCURRENCY,
  MAINTENANCE_MAX_INPUT_TOKENS,
  MAINTENANCE_START_DELAY_MS,
  STARTUP_ARM_STAGGER_MS,
  STARTUP_PREWARM_AGENT_LIMIT,
  STARTUP_PREWARM_DELAY_MS,
  STARTUP_PREWARM_STAGGER_MS,
  VECTOR_PRUNE_BATCH_LIMIT
} from '../runtimeConstants'
import {
  type AgentMemoryRow,
  type ConsolidationScanCursor,
  FORGET_HALF_LIFE_MS,
  type MemoryMaintenancePersonaResult,
  type MemoryMaintenanceReflectionResult,
  type MemoryMaintenanceStepResult
} from '../types'
import { isSafeAgentId } from '@shared/types/agent-memory'
import {
  embeddingFingerprint,
  isUniqueConstraintError,
  type MemoryModelRef,
  type MemoryOperationFence,
  type MemoryRuntimeContext
} from '../context'
import type {
  MemoryAgentPolicyPort,
  MemoryAuditMaintenancePort,
  MemoryAuditReadPort,
  MemoryEmbeddingRepositoryPort,
  MemoryLifecycleRepositoryPort,
  MemoryMaintenanceRowMutationPort,
  MemoryMutationRepositoryPort,
  MemoryReadRepositoryPort,
  MemoryTextGenerationPort,
  MemoryTransactionPort
} from '../ports'

class MaintenanceRevisionConflictError extends Error {}

export class MaintenanceService {
  private readonly ctx: MemoryRuntimeContext
  private readonly consolidationTimers = new Map<string, NodeJS.Timeout>()
  private readonly consolidationTimerDueAt = new Map<string, number>()
  private readonly lastConsolidationAt = new Map<string, number>()
  private readonly lastConsolidationFailureAt = new Map<string, number>()
  private readonly consolidationScanCursor = new Map<string, ConsolidationScanCursor>()
  private readonly consolidationRuns = new Set<Promise<unknown>>()
  private readonly consolidationPasses = new Map<string, Promise<void>>()
  private readonly heavySemaphore = new AsyncSemaphore(MAINTENANCE_HEAVY_MAX_CONCURRENCY)
  private maintenanceStartTimer: NodeJS.Timeout | null = null
  private prewarmStartTimer: NodeJS.Timeout | null = null
  private readonly prewarmTimers = new Map<string, NodeJS.Timeout>()
  private maintenanceStarted = false

  constructor(
    private readonly ports: {
      ctx: MemoryRuntimeContext
      repository: MemoryReadRepositoryPort &
        MemoryMutationRepositoryPort &
        MemoryEmbeddingRepositoryPort &
        MemoryLifecycleRepositoryPort &
        MemoryTransactionPort
      policy: MemoryAgentPolicyPort
      textGeneration: MemoryTextGenerationPort
      auditReader?: MemoryAuditReadPort
      auditMaintenance?: MemoryAuditMaintenancePort
      rows: MemoryMaintenanceRowMutationPort
      queryNeighborsByMemoryId: (
        agentId: string,
        embedding: MemoryModelRef,
        dimensions: number,
        memoryId: string,
        topK: number
      ) => Promise<Array<{ memoryId: string; distance: number }>>
      getReadyCertificateDimension: (agentId: string, embedding: MemoryModelRef) => number | null
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
        model: MemoryModelRef,
        budget: MaintenanceBudget
      ) => Promise<MemoryMaintenanceReflectionResult>
      maybeEvolvePersona: (
        agentId: string,
        model: MemoryModelRef,
        budget: MaintenanceBudget
      ) => Promise<MemoryMaintenancePersonaResult>
      runChallengeResolutionPass: (
        agentId: string,
        model: MemoryModelRef,
        budget: MaintenanceBudget
      ) => Promise<MemoryMaintenanceStepResult>
      repairConflictIntegrity: (agentId: string) => boolean
      runConsolidationPass: (agentId: string) => Promise<void>
      diagnostics?: {
        recordMaintenance(
          agentId: string,
          sample: {
            phase: 'cheap' | 'heavy'
            durationMs: number
            outcome: 'completed' | 'skipped' | 'failed'
            llmCalls: number
            llmTokens: number
            budgetDeniedByStep?: Partial<
              Record<'challenge' | 'merge' | 'reflection' | 'persona', number>
            >
          }
        ): void
      }
    }
  ) {
    this.ctx = ports.ctx
  }

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
    this.lastConsolidationFailureAt.clear()
    this.consolidationScanCursor.clear()
    this.consolidationPasses.clear()
  }

  private shouldArmMaintenance(agentId: string): boolean {
    return isSafeAgentId(agentId) && this.ctx.isManagedAgent(agentId) && this.ctx.isEnabled(agentId)
  }

  private armCurrentActiveAgents(): void {
    try {
      this.armActiveAgentsStaggered(this.ports.repository.listAgentIdsWithMemories())
    } catch (error) {
      logger.warn(`[Memory] maintenance arm skipped: ${String(error)}`)
    }
  }

  warmActiveAgents(): void {
    if (this.ctx.isDisposed) return
    try {
      const candidates = (
        this.ports.policy.listManagedMemoryAgentIds?.() ??
        this.ports.repository.listAgentIdsWithMemories()
      ).filter((agentId) => this.shouldArmMaintenance(agentId))
      const agentIds = this.ports.repository.listRecentlyActiveAgentIds(
        candidates,
        STARTUP_PREWARM_AGENT_LIMIT
      )
      this.warmActiveAgentsStaggered(agentIds)
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
    agentIds.forEach((agentId, index) => {
      this.clearPrewarmTimer(agentId)
      const timer = setTimeout(() => {
        if (this.prewarmTimers.get(agentId) === timer) this.prewarmTimers.delete(agentId)
        if (this.ctx.isDisposed || !this.ctx.canReadAgentMemory(agentId)) return
        this.ports.repairConflictIntegrity(agentId)
        const embedding = this.ports.policy.resolveAgentConfig(agentId)?.memoryEmbedding
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
    if (!this.ports.repository.hasActiveMemory(agentId)) return
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
    const existing = this.consolidationPasses.get(agentId)
    if (existing) return existing
    const tracked = this.runConsolidationPassInternal(agentId, now).finally(() => {
      if (this.consolidationPasses.get(agentId) === tracked) {
        this.consolidationPasses.delete(agentId)
      }
    })
    this.consolidationPasses.set(agentId, tracked)
    return tracked
  }

  private async runConsolidationPassInternal(agentId: string, now: number): Promise<void> {
    if (!this.ctx.canWriteAgentMemory(agentId)) return
    const operationFence = this.ctx.captureOperationFence(agentId)
    let last = this.lastConsolidationAt.get(agentId)
    if (last === undefined) {
      last =
        this.ports.auditReader?.getLatestCompletedEventAt(agentId, 'memory/maintenance_llm') ?? 0
      this.lastConsolidationAt.set(agentId, last)
    }
    if (now - last < CONSOLIDATION_COOLDOWN_MS) {
      await this.runCheapMaintenance(agentId, now, true)
      return
    }
    const latestFailureAt = this.getLatestMaintenanceFailureAt(agentId)
    if (latestFailureAt !== null && now - latestFailureAt < CONSOLIDATION_FAILURE_COOLDOWN_MS) {
      await this.runCheapMaintenance(agentId, now, true)
      return
    }
    await this.runCheapMaintenance(agentId, now, false)
    const heavyEligibilityStartedAt = performance.now()
    const model = this.ctx.resolveConsolidationModel(agentId)
    if (!model) {
      this.archiveStale(agentId, now)
      await this.pruneDeadVectors(agentId)
      if (!this.ctx.canContinueOperation(operationFence)) return
      this.ctx.writeAudit(agentId, {
        eventType: 'memory/maintenance_llm',
        actorType: 'scheduler',
        status: 'skipped',
        reason: 'missing-model',
        createdAt: now
      })
      this.ports.diagnostics?.recordMaintenance(agentId, {
        phase: 'heavy',
        durationMs: performance.now() - heavyEligibilityStartedAt,
        outcome: 'skipped',
        llmCalls: 0,
        llmTokens: 0
      })
      return
    }
    await this.heavySemaphore.run(async () => {
      const heavyStartedAt = performance.now()
      if (!this.ctx.canContinueOperation(operationFence)) return
      const previousLast = last ?? 0
      this.lastConsolidationAt.set(agentId, now)

      let touched = false
      const llmStats: MemoryMaintenanceStepResult = { touched: false, calls: 0, failures: 0 }
      const budget = new MaintenanceBudget()
      let completedHeavyPass = false
      try {
        try {
          const challenge = await this.ports.runChallengeResolutionPass(agentId, model, budget)
          this.addLlmStats(llmStats, challenge)
          if (challenge.touched) touched = true
        } catch (error) {
          logger.warn(`[Memory] challenge resolution failed for ${agentId}: ${String(error)}`)
        }
        if (!this.ctx.canContinueOperation(operationFence)) return
        try {
          const merge = await this.mergeNearDuplicates(agentId, now, model, operationFence, budget)
          this.addLlmStats(llmStats, merge)
          if (merge.touched) touched = true
        } catch (error) {
          logger.warn(`[Memory] consolidation merge failed for ${agentId}: ${String(error)}`)
        }
        if (!this.ctx.canContinueOperation(operationFence)) return
        try {
          const reflectionPass = await this.ports.maybeReflect(agentId, model, budget)
          this.addLlmStats(llmStats, reflectionPass)
          const reflection = reflectionPass.result
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
        if (!this.ctx.canContinueOperation(operationFence)) return
        try {
          const personaPass = await this.ports.maybeEvolvePersona(agentId, model, budget)
          this.addLlmStats(llmStats, personaPass)
          const personaDraft = personaPass.result
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
          logger.warn(
            `[Memory] background persona evolution failed for ${agentId}: ${String(error)}`
          )
        }
        if (!this.ctx.canContinueOperation(operationFence)) return
        if (this.didAllAttemptedLlmCallsFail(llmStats)) {
          this.lastConsolidationAt.set(agentId, previousLast)
          this.lastConsolidationFailureAt.set(agentId, now)
          this.ctx.writeAudit(agentId, {
            eventType: 'memory/maintenance_llm',
            actorType: 'scheduler',
            status: 'failed',
            reason: 'all-llm-steps-failed',
            outputRefs: { calls: llmStats.calls, failures: llmStats.failures },
            model,
            createdAt: now
          })
          return
        }
        this.archiveStale(agentId, now)
        await this.pruneDeadVectors(agentId)
        if (!this.ctx.canContinueOperation(operationFence)) return
        this.ctx.writeAudit(agentId, {
          eventType: 'memory/maintenance_llm',
          actorType: 'scheduler',
          status: 'completed',
          outputRefs: { touched, budget: budget.snapshot() },
          model,
          createdAt: now
        })
        completedHeavyPass = true
        this.lastConsolidationFailureAt.delete(agentId)
      } finally {
        const budgetSnapshot = budget.snapshot()
        this.ports.diagnostics?.recordMaintenance(agentId, {
          phase: 'heavy',
          durationMs: performance.now() - heavyStartedAt,
          outcome: completedHeavyPass
            ? 'completed'
            : this.didAllAttemptedLlmCallsFail(llmStats)
              ? 'failed'
              : 'skipped',
          llmCalls: budgetSnapshot.calls,
          llmTokens: budgetSnapshot.inputTokens,
          budgetDeniedByStep: budgetSnapshot.deniedByStep
        })
        if (!completedHeavyPass && this.lastConsolidationAt.get(agentId) === now) {
          this.lastConsolidationAt.set(agentId, previousLast)
        }
      }
    })
  }

  private async mergeNearDuplicates(
    agentId: string,
    now: number,
    model: MemoryModelRef,
    operationFence: MemoryOperationFence,
    budget: MaintenanceBudget
  ): Promise<MemoryMaintenanceStepResult> {
    const result: MemoryMaintenanceStepResult = { touched: false, calls: 0, failures: 0 }
    try {
      const embedding = this.ports.policy.resolveAgentConfig(agentId)?.memoryEmbedding
      if (!embedding?.providerId || !embedding?.modelId) return result
      const currentEmbedding = { providerId: embedding.providerId, modelId: embedding.modelId }
      const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
      const dimensions = this.ports.repository.getCurrentEmbeddingDimension(agentId, fingerprint)
      if (dimensions === null) return result
      await this.ports.warmVectorStore(agentId, currentEmbedding)
      if (!this.ctx.canContinueOperation(operationFence)) return result

      const cursor = this.consolidationScanCursor.get(agentId)
      let scanRows = this.ports.repository.listConsolidationScanRows(agentId, {
        embeddingDim: dimensions,
        embeddingModel: fingerprint,
        after: cursor,
        limit: CONSOLIDATION_MAX_NEIGHBOR_SCANS + 1
      })
      if (cursor && scanRows.length === 0) {
        scanRows = this.ports.repository.listConsolidationScanRows(agentId, {
          embeddingDim: dimensions,
          embeddingModel: fingerprint,
          limit: CONSOLIDATION_MAX_NEIGHBOR_SCANS + 1
        })
      }
      const hasMore = scanRows.length > CONSOLIDATION_MAX_NEIGHBOR_SCANS
      scanRows = scanRows.slice(0, CONSOLIDATION_MAX_NEIGHBOR_SCANS)
      if (!scanRows.length) {
        this.consolidationScanCursor.delete(agentId)
        return result
      }
      const merged = new Set<string>()
      let lastScanned: AgentMemoryRow | null = null
      let touched = false

      for (const row of scanRows) {
        if (budget.snapshot().inputTokens >= MAINTENANCE_MAX_INPUT_TOKENS) break
        lastScanned = row
        if (merged.has(row.id)) continue
        const source = this.ports.repository.getById(row.id)
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
        if (!this.ctx.canContinueOperation(operationFence)) break
        let neighbor: AgentMemoryRow | null = null
        for (const match of matches) {
          if (match.memoryId === source.id || merged.has(match.memoryId)) continue
          if (distanceToSimilarity(match.distance) < CONSOLIDATION_MERGE_SIMILARITY) continue
          const neighborRow = this.ports.repository.getById(match.memoryId)
          if (
            !this.isCurrentEmbeddedConsolidationRow(agentId, neighborRow, dimensions, fingerprint)
          )
            continue
          neighbor = neighborRow
          break
        }
        if (!neighbor) continue

        const sourceSnapshot = { ...source }
        const neighborSnapshot = { ...neighbor }
        const promptCandidate = normalizeMemoryCandidate({
          kind: sourceSnapshot.kind === 'episodic' ? 'episodic' : 'semantic',
          category: sourceSnapshot.category,
          content: sourceSnapshot.content,
          importance: sourceSnapshot.importance
        })
        if (!promptCandidate) continue
        const estimatedPromptTokens =
          estimateTokens(sourceSnapshot.content) + estimateTokens(neighborSnapshot.content) + 256
        if (estimatedPromptTokens > MAINTENANCE_MAX_INPUT_TOKENS - budget.snapshot().inputTokens) {
          continue
        }
        const prompt = buildDecisionPrompt(promptCandidate, [{ content: neighborSnapshot.content }])
        if (!budget.reserve('merge', estimateTokens(prompt))) break
        result.calls += 1
        let decision: MemoryDecision = ADD_DECISION
        try {
          const raw = await this.ports.textGeneration.generateText(
            agentId,
            model.providerId,
            model.modelId,
            prompt,
            'maintenance'
          )
          decision = parseDecision(raw, 1)
        } catch (error) {
          result.failures += 1
          logger.warn(`[Memory] consolidation decision failed: ${String(error)}`)
          continue
        }
        if (!this.ctx.canContinueOperation(operationFence)) break

        if (
          decision.mergedContent !== null &&
          unicodeCodePointLength(decision.mergedContent) > AGENT_MEMORY_AUTO_CONTENT_MAX_CHARS
        ) {
          decision = ADD_DECISION
        }
        if (decision.decision === 'UPDATE' || decision.decision === 'SUPERSEDE') {
          const [primary, secondary] =
            sourceSnapshot.created_at >= neighborSnapshot.created_at
              ? [sourceSnapshot, neighborSnapshot]
              : [neighborSnapshot, sourceSnapshot]
          const mergedContent = decision.mergedContent ?? primary.content
          const applied = this.applyMaintenanceMerge(
            agentId,
            primary,
            secondary,
            mergedContent,
            now
          )
          merged.add(primary.id)
          merged.add(secondary.id)
          if (applied) {
            touched = true
            result.touched = true
          }
        }
        this.ports.repository.setLastConsolidatedAt(source.id, now)
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
      result.touched = result.touched || touched
      return result
    } catch (error) {
      logger.warn(`[Memory] consolidation merge scan aborted for ${agentId}: ${String(error)}`)
      return result
    }
  }

  private applyMaintenanceMerge(
    agentId: string,
    primary: AgentMemoryRow,
    secondary: AgentMemoryRow,
    mergedContent: string,
    now: number
  ): boolean {
    const owner = this.ports.rows.resolveProvenance(agentId, primary.kind, mergedContent)
    if (owner && owner.id !== primary.id && owner.id !== secondary.id) {
      this.ports.repository.setLastConsolidatedAt(primary.id, now)
      this.ports.repository.setLastConsolidatedAt(secondary.id, now)
      return false
    }

    const survivor = owner?.id === secondary.id ? secondary : primary
    const retired = survivor.id === primary.id ? secondary : primary
    const otherCategory = isAgentMemoryCategory(retired.category) ? retired.category : null
    const nextCategory =
      survivor.kind === 'episodic' || survivor.kind === 'semantic'
        ? (survivor.category ?? otherCategory)
        : undefined
    const provenanceKey = buildMemoryProvenanceKey(agentId, survivor.kind, mergedContent)

    try {
      this.ports.repository.runInTransaction(() => {
        const contentApplied = this.ports.repository.updateDecisionContentIfRevision({
          agentId,
          id: survivor.id,
          expectedRevision: survivor.decision_revision,
          content: mergedContent,
          provenanceKey,
          at: now,
          category: nextCategory
        })
        if (!contentApplied) throw new MaintenanceRevisionConflictError()
        if (
          !this.ports.repository.markSupersededIfRevision(
            agentId,
            retired.id,
            retired.decision_revision,
            survivor.id
          )
        ) {
          throw new MaintenanceRevisionConflictError()
        }
        this.ports.rows.bumpConfidence(survivor.id)
        this.ports.repository.setImportance(survivor.id, retired.importance)
      })
    } catch (error) {
      if (error instanceof MaintenanceRevisionConflictError || isUniqueConstraintError(error)) {
        return false
      }
      throw error
    }

    this.ctx.markDomainMutationCommitted(agentId)
    this.ports.syncWorkingMemoryAfterMutation(agentId)
    void this.ports.triggerEmbedding(agentId).catch((error) => {
      logger.warn(`[Memory] background embedding failed: ${String(error)}`)
    })
    this.ctx.emitChanged(agentId, 'extract')
    return true
  }

  private addLlmStats(
    total: MemoryMaintenanceStepResult,
    next: { touched?: boolean; calls: number; failures: number }
  ): void {
    total.calls += next.calls
    total.failures += next.failures
    total.touched = total.touched || next.touched === true
  }

  private didAllAttemptedLlmCallsFail(stats: { calls: number; failures: number }): boolean {
    return stats.calls > 0 && stats.failures >= stats.calls
  }

  private getLatestMaintenanceFailureAt(agentId: string): number | null {
    const localFailureAt = this.lastConsolidationFailureAt.get(agentId)
    if (localFailureAt !== undefined) return localFailureAt
    const persisted = this.ports.auditReader?.listByAgent(agentId, {
      eventType: 'memory/maintenance_llm',
      status: 'failed',
      limit: 1
    })[0]?.created_at
    if (persisted !== undefined) {
      this.lastConsolidationFailureAt.set(agentId, persisted)
      return persisted
    }
    return null
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
    const startedAt = performance.now()
    let outcome: 'completed' | 'failed' = 'completed'
    try {
      let workingDirty = this.ports.repairConflictIntegrity(agentId)
      this.ports.auditMaintenance?.pruneOperationalEvents(agentId)
      if (archive) {
        this.archiveStale(agentId, now)
        await this.pruneDeadVectors(agentId)
      }
      const repaired = this.ports.repository.repairInternalKindStatuses(agentId)
      if (repaired > 0) {
        workingDirty = true
        this.ctx.writeAudit(agentId, {
          eventType: 'memory/repair',
          actorType: 'scheduler',
          status: 'completed',
          outputRefs: { repaired }
        })
      }
      if (workingDirty) this.ports.syncWorkingMemoryAfterMutation(agentId)
    } catch (error) {
      outcome = 'failed'
      throw error
    } finally {
      this.ports.diagnostics?.recordMaintenance(agentId, {
        phase: 'cheap',
        durationMs: performance.now() - startedAt,
        outcome,
        llmCalls: 0,
        llmTokens: 0
      })
    }
  }

  private async pruneDeadVectors(agentId: string): Promise<void> {
    const embedding = this.ports.policy.resolveAgentConfig(agentId)?.memoryEmbedding
    if (!embedding?.providerId || !embedding?.modelId) return
    const currentEmbedding = { providerId: embedding.providerId, modelId: embedding.modelId }
    const dimensions = this.ports.getReadyCertificateDimension(agentId, currentEmbedding)
    if (dimensions === null) return
    const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
    const refs = this.ports.repository.listPrunableVectorRefs(agentId, {
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
      this.ports.repository.clearPrunableEmbeddingRefs(agentId, deletedIds, dimensions, fingerprint)
    }
  }

  archiveStale(agentId: string, now: number = Date.now()): number {
    const minimumBaseAgeMs =
      FORGET_HALF_LIFE_MS * (Math.log(ARCHIVE_DECAY_THRESHOLD) / Math.log(0.5))
    const archivedIds = this.ports.repository.archiveEligibleBatch(agentId, {
      now,
      createdBefore: now - ARCHIVE_AGE_MS,
      minimumBaseAgeMs,
      limit: 256
    })
    const archived = archivedIds.length
    if (archived > 0) {
      this.ctx.markDomainMutationCommitted(agentId)
      this.ports.syncWorkingMemoryAfterMutation(agentId)
      this.ctx.emitChanged(agentId, 'extract')
    }
    return archived
  }

  clearCooldown(agentId: string): void {
    this.lastConsolidationAt.delete(agentId)
    this.lastConsolidationFailureAt.delete(agentId)
  }

  cleanupAgent(agentId: string): void {
    this.clearPrewarmTimer(agentId)
    const timer = this.consolidationTimers.get(agentId)
    if (timer) clearTimeout(timer)
    this.consolidationTimers.delete(agentId)
    this.consolidationTimerDueAt.delete(agentId)
    this.lastConsolidationAt.delete(agentId)
    this.lastConsolidationFailureAt.delete(agentId)
    this.consolidationScanCursor.delete(agentId)
    this.consolidationPasses.delete(agentId)
  }

  getInFlight(): Promise<unknown>[] {
    return [...this.consolidationRuns]
  }

  clearInFlight(): void {
    this.consolidationRuns.clear()
  }
}
