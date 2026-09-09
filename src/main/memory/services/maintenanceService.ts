import logger from '@shared/logger'
import { isSafeAgentId } from '@shared/types/agent-memory'
import { ARCHIVE_AGE_MS, ARCHIVE_DECAY_THRESHOLD } from '../core/lifecycle'
import { MaintenanceBudget, type MaintenanceBudgetStep } from '../core/maintenanceBudget'
import { AsyncSemaphore } from '../../lib/asyncSemaphore'
import {
  CONSOLIDATION_COOLDOWN_MS,
  CONSOLIDATION_DIRTY_SEED_LIMIT,
  CONSOLIDATION_FAILURE_COOLDOWN_MS,
  CONSOLIDATION_IDLE_MS,
  MAINTENANCE_DRAIN_TIMEOUT_MS,
  MAINTENANCE_HEAVY_MAX_CONCURRENCY,
  MAINTENANCE_START_DELAY_MS,
  STARTUP_ARM_STAGGER_MS,
  STARTUP_PREWARM_AGENT_LIMIT,
  STARTUP_PREWARM_DELAY_MS,
  STARTUP_PREWARM_STAGGER_MS,
  VECTOR_PRUNE_BATCH_LIMIT
} from '../runtimeConstants'
import {
  FORGET_HALF_LIFE_MS,
  type MemoryMaintenancePersonaResult,
  type MemoryMaintenanceReflectionResult,
  type MemoryMaintenanceStepResult
} from '../types'
import {
  embeddingFingerprint,
  type MemoryModelRef,
  type MemoryOperationFence,
  type MemoryRuntimeContext
} from '../context'
import type {
  MemoryAgentPolicyPort,
  MemoryAuditMaintenancePort,
  MemoryAuditReadPort,
  MemoryDirtyRepositoryPort,
  MemoryEmbeddingRepositoryPort,
  MemoryLifecycleRepositoryPort,
  MemoryReadRepositoryPort
} from '../ports'
import { isLiveDirtyConsolidationRow } from './mergeService'

interface HeavyMaintenanceRun {
  agentId: string
  now: number
  model: MemoryModelRef
  operationFence: MemoryOperationFence
  budget: MaintenanceBudget
}

// One model-backed maintenance step. The scheduler owns cooldown, fence, concurrency, budget, and
// audit; a pass only performs its own work and reports LLM usage plus whether claims changed.
interface HeavyMaintenancePass {
  readonly step: MaintenanceBudgetStep
  run(run: HeavyMaintenanceRun): Promise<MemoryMaintenanceStepResult>
}

export class MaintenanceService {
  private readonly ctx: MemoryRuntimeContext
  private readonly consolidationTimers = new Map<string, NodeJS.Timeout>()
  private readonly consolidationTimerDueAt = new Map<string, number>()
  private readonly lastConsolidationAt = new Map<string, number>()
  private readonly lastConsolidationFailureAt = new Map<string, number>()
  private readonly consolidationPasses = new Map<string, Promise<void>>()
  private readonly heavySemaphore = new AsyncSemaphore(MAINTENANCE_HEAVY_MAX_CONCURRENCY)
  private maintenanceStartTimer: NodeJS.Timeout | null = null
  private prewarmStartTimer: NodeJS.Timeout | null = null
  private readonly prewarmTimers = new Map<string, NodeJS.Timeout>()
  private maintenanceStarted = false
  private maintenancePaused = false

  // Heavy passes run in this order under one shared budget; each is fenced independently so a
  // stop request lands at the next boundary instead of after the whole sequence.
  private readonly heavyPasses: readonly HeavyMaintenancePass[] = [
    {
      step: 'challenge',
      run: ({ agentId, model, budget }) =>
        // Arm after each applied resolution, even if a later pair fails before the pass returns.
        this.ports.runChallengeResolutionPass(agentId, model, budget, () =>
          this.scheduleConsolidation(agentId)
        )
    },
    {
      step: 'merge',
      run: ({ agentId, now, model, operationFence, budget }) =>
        this.ports.runMergePass(agentId, now, model, operationFence, budget)
    },
    {
      step: 'reflection',
      run: async ({ agentId, model, budget }) => {
        const pass = await this.ports.maybeReflect(agentId, model, budget)
        if (pass.result) {
          this.writePassAudit(agentId, {
            eventType: 'memory/reflect',
            actorType: 'scheduler',
            status: 'completed',
            inputRefs: { memoryIds: pass.result.sourceMemoryIds },
            outputRefs: { memoryIds: pass.result.reflectionIds },
            model
          })
        }
        return { touched: pass.result !== null, calls: pass.calls, failures: pass.failures }
      }
    },
    {
      step: 'persona',
      run: async ({ agentId, model, budget }) => {
        const pass = await this.ports.maybeEvolvePersona(agentId, model, budget)
        if (pass.result) {
          this.writePassAudit(agentId, {
            eventType: 'persona/evolve',
            actorType: 'scheduler',
            status: 'completed',
            outputRefs: {
              draftId: pass.result.draftId,
              needsReview: pass.result.needsReview,
              changeRatio: pass.result.changeRatio
            },
            model
          })
        }
        // A persona draft waits for user review; it does not change recallable claims.
        return { touched: false, calls: pass.calls, failures: pass.failures }
      }
    }
  ]

  // Audit is observability. A failed audit insert must not erase the step's LLM accounting,
  // otherwise a successful reflection could be counted as an all-steps-failed pass.
  private writePassAudit(
    agentId: string,
    input: Parameters<MemoryRuntimeContext['writeAudit']>[1]
  ): void {
    try {
      this.ctx.writeAudit(agentId, input)
    } catch (error) {
      logger.warn(`[Memory] ${input.eventType} audit failed for ${agentId}: ${String(error)}`)
    }
  }

  constructor(
    private readonly ports: {
      ctx: MemoryRuntimeContext
      repository: MemoryReadRepositoryPort &
        MemoryEmbeddingRepositoryPort &
        MemoryLifecycleRepositoryPort &
        MemoryDirtyRepositoryPort
      policy: MemoryAgentPolicyPort
      auditReader?: MemoryAuditReadPort
      auditMaintenance?: MemoryAuditMaintenancePort
      getReadyCertificateDimension: (agentId: string, embedding: MemoryModelRef) => number | null
      deletePrunableVectorsForMemoryIds: (
        agentId: string,
        embedding: MemoryModelRef,
        dimensions: number,
        memoryIds: string[]
      ) => Promise<string[]>
      syncWorkingMemoryAfterMutation: (agentId: string) => void
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
        budget: MaintenanceBudget,
        onApplied: () => void
      ) => Promise<MemoryMaintenanceStepResult>
      runMergePass: (
        agentId: string,
        now: number,
        model: MemoryModelRef,
        operationFence: MemoryOperationFence,
        budget: MaintenanceBudget
      ) => Promise<MemoryMaintenanceStepResult>
      repairConflictIntegrity: (agentId: string) => boolean
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
    this.maintenancePaused = false
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

  /**
   * Synchronously fences background maintenance: no timer stays armed, no new
   * pass is admitted, and every agent with an in-flight pass has its execution
   * fence invalidated and its provider requests aborted, so the pass and the
   * sub-services it delegates to stop at their next checkpoint instead of
   * waiting out a provider deadline. `startBackgroundMaintenance` re-arms after
   * the caller's maintenance window; `drainBackgroundMaintenance` waits for the
   * fenced passes to settle.
   */
  stopBackgroundMaintenance(): void {
    this.maintenanceStarted = false
    this.maintenancePaused = true
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
    for (const timer of this.consolidationTimers.values()) clearTimeout(timer)
    this.consolidationTimers.clear()
    this.consolidationTimerDueAt.clear()
    for (const agentId of this.consolidationPasses.keys()) {
      this.ctx.invalidateAgentOperations(agentId)
    }
  }

  /** Waits for in-flight passes and returns the agents whose pass is still running. */
  async drainBackgroundMaintenance(
    timeoutMs: number = MAINTENANCE_DRAIN_TIMEOUT_MS
  ): Promise<string[]> {
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      Promise.allSettled(this.consolidationPasses.values()),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
        if (typeof timer.unref === 'function') timer.unref()
      })
    ])
    if (timer) clearTimeout(timer)
    return [...this.consolidationPasses.keys()].sort()
  }

  prepareDispose(): void {
    this.stopBackgroundMaintenance()
    this.lastConsolidationAt.clear()
    this.lastConsolidationFailureAt.clear()
  }

  private shouldArmMaintenance(agentId: string): boolean {
    return isSafeAgentId(agentId) && this.ctx.canContinueAgentMemoryTask(agentId)
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

  scheduleConsolidation(
    agentId: string,
    delayMs: number = CONSOLIDATION_IDLE_MS,
    options: { preserveEarlier?: boolean } = {}
  ): void {
    if (this.ctx.isDisposed || this.maintenancePaused) return
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
      void this.runConsolidationPass(agentId).catch((error) => {
        logger.warn(`[Memory] consolidation pass failed for ${agentId}: ${String(error)}`)
      })
    }, delayMs)
    if (typeof timer.unref === 'function') timer.unref()
    this.consolidationTimers.set(agentId, timer)
    this.consolidationTimerDueAt.set(agentId, dueAt)
  }

  async runConsolidationPass(agentId: string, now?: number): Promise<void> {
    const effectiveNow = now ?? this.ctx.now()
    const existing = this.consolidationPasses.get(agentId)
    if (existing) return existing
    if (this.maintenancePaused) return
    const tracked = this.runConsolidationPassInternal(agentId, effectiveNow).finally(() => {
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

      const llmStats: MemoryMaintenanceStepResult = { touched: false, calls: 0, failures: 0 }
      const budget = new MaintenanceBudget()
      const run: HeavyMaintenanceRun = { agentId, now, model, operationFence, budget }
      let completedHeavyPass = false
      try {
        for (const pass of this.heavyPasses) {
          try {
            this.addLlmStats(llmStats, await pass.run(run))
          } catch (error) {
            logger.warn(`[Memory] ${pass.step} pass failed for ${agentId}: ${String(error)}`)
          }
          if (!this.ctx.canContinueOperation(operationFence)) return
        }
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
          outputRefs: { touched: llmStats.touched, budget: budget.snapshot() },
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

  private addLlmStats(total: MemoryMaintenanceStepResult, next: MemoryMaintenanceStepResult): void {
    total.calls += next.calls
    total.failures += next.failures
    total.touched = total.touched || next.touched
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

  private settleTerminalDirtySeeds(agentId: string): number {
    const terminalSeeds = this.ports.repository
      .listDirtySeeds(agentId, CONSOLIDATION_DIRTY_SEED_LIMIT)
      .filter(
        (seed) =>
          !isLiveDirtyConsolidationRow(agentId, this.ports.repository.getById(seed.memoryId))
      )
    return this.ports.repository.settleDirtySeeds(agentId, terminalSeeds)
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
      this.settleTerminalDirtySeeds(agentId)
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

  archiveStale(agentId: string, now?: number): number {
    const effectiveNow = now ?? this.ctx.now()
    const minimumBaseAgeMs =
      FORGET_HALF_LIFE_MS * (Math.log(ARCHIVE_DECAY_THRESHOLD) / Math.log(0.5))
    const archivedIds = this.ports.repository.archiveEligibleBatch(agentId, {
      now: effectiveNow,
      createdBefore: effectiveNow - ARCHIVE_AGE_MS,
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
    // An in-flight pass stays tracked until it settles so drain and dispose
    // keep waiting for it; its own `finally` removes the entry.
  }

  getInFlight(): Promise<unknown>[] {
    return [...this.consolidationPasses.values()]
  }

  clearInFlight(): void {
    this.consolidationPasses.clear()
  }
}
