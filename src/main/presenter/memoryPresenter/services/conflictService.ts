import logger from '@shared/logger'
import { AGENT_MEMORY_AUTO_CONTENT_MAX_CHARS } from '@shared/types/agent-memory'
import { unicodeCodePointLength } from '@shared/lib/unicodeText'

import {
  ADD_DECISION,
  buildDecisionPrompt,
  parseDecision,
  type MemoryDecision
} from '../core/decision'
import { normalizeMemoryCandidate } from '../core/candidates'
import { estimateTokens } from '../core/injectionPort'
import { MaintenanceBudget } from '../core/maintenanceBudget'
import { buildMemoryProvenanceKey } from '../core/scoring'
import type {
  AgentMemoryRow,
  MemoryConflictPair,
  MemoryConflictResolution,
  MemoryMaintenanceStepResult
} from '../types'
import { type MemoryModelRef, type MemoryRuntimeContext } from '../context'

interface ConflictResolutionOptions {
  mergedContent?: string | null
}

export interface ConflictIntegrityRepairResult {
  repairedTargets: number
  archivedChallengers: number
  clearedTargets: number
  clearedLinks: number
}

export class ConflictService {
  constructor(
    private readonly ctx: MemoryRuntimeContext,
    private readonly ports: {
      scheduleConsolidation: (agentId: string) => void
      syncWorkingMemoryAfterMutation: (agentId: string) => void
      triggerEmbedding: (agentId: string) => Promise<void>
    }
  ) {}

  listConflicts(agentId: string): MemoryConflictPair[] {
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return []
    const challengers = this.ctx.deps.repository.listByAgent(agentId, { statuses: ['conflicted'] })
    const pairs: MemoryConflictPair[] = []
    for (const challenger of challengers) {
      if (!challenger.conflict_with) {
        logger.warn(`[Memory] skipping conflict challenger without target: ${challenger.id}`)
        continue
      }
      const target = this.ctx.deps.repository.getById(challenger.conflict_with)
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

  repairConflictIntegrity(agentId: string): ConflictIntegrityRepairResult {
    const result = this.ctx.deps.repository.repairConflictIntegrityBatch(agentId, 256)

    const total =
      result.repairedTargets +
      result.archivedChallengers +
      result.clearedTargets +
      result.clearedLinks
    if (total > 0) {
      this.ctx.markDomainMutationCommitted(agentId)
      this.ctx.writeAudit(agentId, {
        eventType: 'memory/conflict_repair',
        actorType: 'scheduler',
        status: 'completed',
        outputRefs: {
          repairedTargets: result.repairedTargets,
          archivedChallengers: result.archivedChallengers,
          clearedTargets: result.clearedTargets,
          clearedLinks: result.clearedLinks
        }
      })
    }
    return result
  }

  async resolveConflict(
    agentId: string,
    challengerId: string,
    outcome: MemoryConflictResolution,
    actorType: 'scheduler' | 'user' = 'user',
    model?: MemoryModelRef | null,
    options: ConflictResolutionOptions = {}
  ): Promise<boolean> {
    if (this.ctx.isDisposed) return false
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return false
    if (!this.ctx.canWriteAgentMemory(agentId)) return false
    const challenger = this.ctx.deps.repository.getById(challengerId)
    const target = challenger?.conflict_with
      ? this.ctx.deps.repository.getById(challenger.conflict_with)
      : undefined
    const pair =
      challenger?.agent_id === agentId &&
      challenger.status === 'conflicted' &&
      challenger.superseded_by === null &&
      target?.agent_id === agentId &&
      target.conflict_state === 'challenged' &&
      target.superseded_by === null
        ? { challenger, target }
        : undefined
    if (!pair) return false
    if (!this.ctx.canWriteAgentMemory(agentId)) return false
    this.ctx.deps.repository.runInTransaction(() => {
      this.applyConflictResolution(agentId, pair, outcome, options)
    })
    this.ctx.markDomainMutationCommitted(agentId)
    this.ports.syncWorkingMemoryAfterMutation(agentId)
    this.ctx.writeAudit(agentId, {
      eventType: 'memory/challenge_resolved',
      actorType,
      status: 'completed',
      inputRefs: { challengerId: pair.challenger.id, targetId: pair.target.id },
      outputRefs: { action: outcome },
      model: model ?? undefined
    })
    if (outcome === 'keep_challenger' || outcome === 'keep_both') {
      void this.ports.triggerEmbedding(agentId).catch((error) => {
        logger.warn(`[Memory] background embedding failed: ${String(error)}`)
      })
    }
    this.ctx.emitChanged(agentId, 'extract')
    this.ports.scheduleConsolidation(agentId)
    return true
  }

  private applyConflictResolution(
    agentId: string,
    pair: MemoryConflictPair,
    outcome: MemoryConflictResolution,
    options: ConflictResolutionOptions = {}
  ): void {
    const now = Date.now()
    switch (outcome) {
      case 'keep_challenger':
        this.applyMergedChallengerContent(agentId, pair.challenger, options.mergedContent, now)
        this.ctx.deps.repository.setConflictWith(pair.challenger.id, null)
        this.ctx.deps.repository.activateForEmbedding(pair.challenger.id)
        this.ctx.deps.repository.retireConflictSiblings(
          agentId,
          pair.target.id,
          pair.challenger.id,
          pair.challenger.id,
          now
        )
        this.ctx.deps.repository.markSuperseded(pair.target.id, pair.challenger.id)
        this.ctx.deps.repository.markConflict(pair.target.id, null)
        this.ctx.deps.repository.archive(pair.target.id, now)
        return
      case 'keep_target':
        this.ctx.deps.repository.setConflictWith(pair.challenger.id, null)
        this.ctx.deps.repository.markSuperseded(pair.challenger.id, pair.target.id)
        this.ctx.deps.repository.archive(pair.challenger.id, now)
        this.ctx.deps.repository.clearTargetConflictIfNoChallengers(agentId, pair.target.id)
        return
      case 'keep_both':
        this.ctx.deps.repository.setConflictWith(pair.challenger.id, null)
        this.ctx.deps.repository.activateForEmbedding(pair.challenger.id)
        this.ctx.deps.repository.clearTargetConflictIfNoChallengers(agentId, pair.target.id)
        return
    }
  }

  private applyMergedChallengerContent(
    agentId: string,
    challenger: AgentMemoryRow,
    mergedContent: string | null | undefined,
    now: number
  ): void {
    const content = mergedContent?.trim()
    if (!content || content === challenger.content) return
    this.ctx.deps.repository.updateContent(
      challenger.id,
      content,
      buildMemoryProvenanceKey(agentId, challenger.kind, content),
      now,
      challenger.category
    )
  }

  async runChallengeResolutionPass(
    agentId: string,
    model: MemoryModelRef,
    budget: MaintenanceBudget = new MaintenanceBudget()
  ): Promise<MemoryMaintenanceStepResult> {
    let touched = false
    let calls = 0
    let failures = 0
    const operationFence = this.ctx.captureOperationFence(agentId)
    const challengers = this.ctx.deps.repository.listConflictChallengersForMaintenance(agentId, 4)
    const targets = this.ctx.deps.repository.listByIds(
      agentId,
      challengers.flatMap((challenger) =>
        challenger.conflict_with ? [challenger.conflict_with] : []
      )
    )
    const targetsById = new Map(targets.map((target) => [target.id, target]))
    const pairs = challengers.flatMap((challenger): MemoryConflictPair[] => {
      const target = challenger.conflict_with
        ? targetsById.get(challenger.conflict_with)
        : undefined
      return target?.conflict_state === 'challenged' && target.superseded_by === null
        ? [{ challenger, target }]
        : []
    })
    for (const pair of pairs) {
      if (!this.ctx.canContinueOperation(operationFence)) break
      const promptCandidate = normalizeMemoryCandidate({
        kind: pair.challenger.kind === 'episodic' ? 'episodic' : 'semantic',
        category: pair.challenger.category,
        content: pair.challenger.content,
        importance: pair.challenger.importance
      })
      if (!promptCandidate) {
        this.ctx.deps.repository.setLastConsolidatedAt(pair.challenger.id)
        continue
      }
      const estimatedPromptTokens =
        estimateTokens(pair.challenger.content) + estimateTokens(pair.target.content) + 256
      if (!budget.reserve('challenge', estimatedPromptTokens)) {
        this.ctx.deps.repository.setLastConsolidatedAt(pair.challenger.id)
        continue
      }
      const prompt = buildDecisionPrompt(promptCandidate, [{ content: pair.target.content }])
      let decision: MemoryDecision = ADD_DECISION
      try {
        calls += 1
        const raw = await this.ctx.provider.generateText(
          agentId,
          model.providerId,
          model.modelId,
          prompt,
          'maintenance'
        )
        decision = parseDecision(raw, 1)
      } catch (error) {
        failures += 1
        logger.warn(`[Memory] challenge decision failed: ${String(error)}`)
        this.ctx.deps.repository.setLastConsolidatedAt(pair.challenger.id)
        continue
      }
      this.ctx.deps.repository.setLastConsolidatedAt(pair.challenger.id)
      if (!this.ctx.canContinueOperation(operationFence)) break
      if (
        decision.mergedContent !== null &&
        unicodeCodePointLength(decision.mergedContent) > AGENT_MEMORY_AUTO_CONTENT_MAX_CHARS
      ) {
        decision = ADD_DECISION
      }
      const outcome: MemoryConflictResolution =
        decision.decision === 'NOOP'
          ? 'keep_target'
          : decision.decision === 'UPDATE' || decision.decision === 'SUPERSEDE'
            ? 'keep_challenger'
            : 'keep_both'
      const proposedMergedContent =
        decision.decision === 'UPDATE' || decision.decision === 'SUPERSEDE'
          ? decision.mergedContent
          : null
      const mergedContent =
        proposedMergedContent &&
        unicodeCodePointLength(proposedMergedContent) <= AGENT_MEMORY_AUTO_CONTENT_MAX_CHARS
          ? proposedMergedContent
          : null
      if (
        await this.resolveConflict(agentId, pair.challenger.id, outcome, 'scheduler', model, {
          mergedContent
        })
      ) {
        touched = true
      }
    }
    return { touched, calls, failures }
  }
}
