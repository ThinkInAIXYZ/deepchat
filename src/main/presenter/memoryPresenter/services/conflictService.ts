import logger from '@shared/logger'

import {
  ADD_DECISION,
  buildDecisionPrompt,
  parseDecision,
  type MemoryDecision
} from '../core/decision'
import { normalizeMemoryCandidate } from '../core/candidates'
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
    const pair = this.listConflicts(agentId).find(
      (conflict) => conflict.challenger.id === challengerId
    )
    if (!pair) return false
    if (!this.ctx.canWriteAgentMemory(agentId)) return false
    this.ctx.deps.repository.runInTransaction(() => {
      this.applyConflictResolution(agentId, pair, outcome, options)
    })
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
    const siblings = this.listConflictSiblings(agentId, pair.target.id, pair.challenger.id)
    switch (outcome) {
      case 'keep_challenger':
        this.applyMergedChallengerContent(agentId, pair.challenger, options.mergedContent, now)
        this.ctx.deps.repository.setConflictWith(pair.challenger.id, null)
        this.ctx.deps.repository.updateStatus(pair.challenger.id, 'pending_embedding')
        for (const sibling of siblings) {
          this.ctx.deps.repository.setConflictWith(sibling.id, null)
          this.ctx.deps.repository.markSuperseded(sibling.id, pair.challenger.id)
          this.ctx.deps.repository.archive(sibling.id, now)
        }
        this.ctx.deps.repository.markSuperseded(pair.target.id, pair.challenger.id)
        this.ctx.deps.repository.markConflict(pair.target.id, null)
        this.ctx.deps.repository.archive(pair.target.id, now)
        return
      case 'keep_target':
        this.ctx.deps.repository.setConflictWith(pair.challenger.id, null)
        this.ctx.deps.repository.markSuperseded(pair.challenger.id, pair.target.id)
        this.ctx.deps.repository.archive(pair.challenger.id, now)
        if (siblings.length === 0) this.ctx.deps.repository.markConflict(pair.target.id, null)
        return
      case 'keep_both':
        this.ctx.deps.repository.setConflictWith(pair.challenger.id, null)
        this.ctx.deps.repository.updateStatus(pair.challenger.id, 'pending_embedding')
        if (siblings.length === 0) this.ctx.deps.repository.markConflict(pair.target.id, null)
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

  private listConflictSiblings(
    agentId: string,
    targetId: string,
    excludeChallengerId: string
  ): AgentMemoryRow[] {
    return this.ctx.deps.repository
      .listByAgent(agentId, { statuses: ['conflicted'] })
      .filter((row) => row.id !== excludeChallengerId && row.conflict_with === targetId)
  }

  async runChallengeResolutionPass(
    agentId: string,
    model: MemoryModelRef
  ): Promise<MemoryMaintenanceStepResult> {
    let touched = false
    let calls = 0
    let failures = 0
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
        calls += 1
        const raw = await this.ctx.deps.generateText(model.providerId, model.modelId, prompt)
        decision = parseDecision(raw, 1)
      } catch (error) {
        failures += 1
        logger.warn(`[Memory] challenge decision failed: ${String(error)}`)
        continue
      }
      if (!this.ctx.canWriteAgentMemory(agentId)) break
      const outcome: MemoryConflictResolution =
        decision.decision === 'NOOP'
          ? 'keep_target'
          : decision.decision === 'UPDATE' || decision.decision === 'SUPERSEDE'
            ? 'keep_challenger'
            : 'keep_both'
      const mergedContent =
        decision.decision === 'UPDATE' || decision.decision === 'SUPERSEDE'
          ? decision.mergedContent
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
