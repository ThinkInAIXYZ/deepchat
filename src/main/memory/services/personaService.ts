import logger from '@shared/logger'
import { nanoid } from 'nanoid'

import {
  MAINTENANCE_MAX_INPUT_TOKENS,
  MIN_MEMORIES_FOR_PERSONA,
  PERSONA_EVOLUTION_IMPORTANCE_THRESHOLD,
  PERSONA_MEMORY_LIMIT
} from '../runtimeConstants'
import {
  buildReflectionPrompt,
  personaChangeRatio,
  sanitizeSelfModel,
  PERSONA_MAX_CHANGE_RATIO
} from '../core/extraction'
import { estimateTokens } from '../core/injectionPort'
import { selectMaintenanceRowsWithinTokenBudget } from '../core/maintenanceBudget'
import { MaintenanceBudget } from '../core/maintenanceBudget'
import type {
  AgentMemoryRow,
  MemoryMaintenancePersonaResult,
  MemoryPersonaDraftResult
} from '../types'
import { type MemoryModelRef, type MemoryRuntimeContext } from '../context'
import type {
  MemoryLifecycleRepositoryPort,
  MemoryMutationRepositoryPort,
  MemoryReadRepositoryPort,
  MemoryTextGenerationPort
} from '../ports'

export class PersonaService {
  private readonly ctx: MemoryRuntimeContext
  private readonly personaAttemptWatermark = new Map<string, number>()
  private readonly personaLocks = new Map<string, Promise<unknown>>()

  constructor(
    private readonly ports: {
      ctx: MemoryRuntimeContext
      repository: MemoryReadRepositoryPort &
        MemoryMutationRepositoryPort &
        MemoryLifecycleRepositoryPort
      textGeneration: MemoryTextGenerationPort
    }
  ) {
    this.ctx = ports.ctx
  }

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

  evolvePersona(agentId: string, content: string, sourceSession?: string | null): string | null {
    if (!this.ctx.canWriteAgentMemory(agentId)) return null
    const trimmed = content.trim()
    if (!trimmed) return null
    const id = `persona-${nanoid(12)}`
    this.ports.repository.insert({
      id,
      agentId,
      kind: 'persona',
      content: trimmed,
      importance: 1,
      lifecycleState: 'active',
      embeddingState: 'not_applicable',
      sourceSession: sourceSession ?? null,
      personaState: 'draft'
    })
    this.ctx.markDomainMutationCommitted(agentId)
    this.ctx.emitChanged(agentId, 'persona-draft')
    return id
  }

  async maybeEvolvePersona(
    agentId: string,
    model: MemoryModelRef,
    sourceSession?: string | null,
    budget: MaintenanceBudget = new MaintenanceBudget()
  ): Promise<MemoryPersonaDraftResult | null> {
    return (await this.runMaintenancePersonaPass(agentId, model, sourceSession, budget)).result
  }

  async runMaintenancePersonaPass(
    agentId: string,
    model: MemoryModelRef,
    sourceSession?: string | null,
    budget: MaintenanceBudget = new MaintenanceBudget()
  ): Promise<MemoryMaintenancePersonaResult> {
    let calls = 0
    let failures = 0
    const finish = (result: MemoryPersonaDraftResult | null): MemoryMaintenancePersonaResult => ({
      result,
      calls,
      failures
    })
    if (!this.ctx.canWriteAgentMemory(agentId) || !this.ctx.isPersonaEvolutionEnabled(agentId)) {
      return finish(null)
    }
    try {
      return await this.withPersonaLock(agentId, async () => {
        if (
          !this.ctx.canWriteAgentMemory(agentId) ||
          !this.ctx.isPersonaEvolutionEnabled(agentId)
        ) {
          return finish(null)
        }
        if (this.ports.repository.getDraftPersona(agentId)) return finish(null)

        const previous = this.ports.repository.getActivePersona(agentId)
        const watermark = Math.max(
          previous?.created_at ?? 0,
          this.personaAttemptWatermark.get(agentId) ?? 0
        )
        const cognitive = this.ports.repository.getCognitiveMaintenanceInput(agentId, {
          kinds: ['semantic', 'reflection', 'episodic'],
          watermark,
          limit: PERSONA_MEMORY_LIMIT
        })
        if (cognitive.eligibleCount < MIN_MEMORIES_FOR_PERSONA) return finish(null)
        if (cognitive.importanceAfterWatermark < PERSONA_EVOLUTION_IMPORTANCE_THRESHOLD) {
          return finish(null)
        }
        const maxUnitCreatedAt = cognitive.maxCreatedAt
        const availableTokens = Math.max(
          0,
          MAINTENANCE_MAX_INPUT_TOKENS -
            budget.snapshot().inputTokens -
            estimateTokens(previous?.content ?? '') -
            384
        )
        const top = selectMaintenanceRowsWithinTokenBudget(
          cognitive.topRows,
          availableTokens,
          (row) => estimateTokens(row.content)
        )
        if (top.length < MIN_MEMORIES_FOR_PERSONA) return finish(null)
        const personaModel = this.ctx.resolveExtractionModel(agentId, model)
        const operationFence = this.ctx.captureOperationFence(agentId)
        const prompt = buildReflectionPrompt(
          previous?.content ?? null,
          top.map((row) => row.content)
        )
        if (!budget.reserve('persona', estimateTokens(prompt))) return finish(null)
        let raw = ''
        try {
          calls += 1
          raw = await this.ports.textGeneration.generateText(
            agentId,
            personaModel.providerId,
            personaModel.modelId,
            prompt,
            'maintenance'
          )
        } catch (error) {
          failures += 1
          throw error
        }
        if (
          !this.ctx.canContinueOperation(operationFence) ||
          !this.ctx.isPersonaEvolutionEnabled(agentId)
        ) {
          return finish(null)
        }
        const content = sanitizeSelfModel(raw)
        if (!content || content === (previous?.content?.trim() ?? '')) {
          this.personaAttemptWatermark.set(agentId, maxUnitCreatedAt)
          return finish(null)
        }
        const changeRatio = personaChangeRatio(previous?.content ?? null, content)
        const needsReview = previous ? changeRatio > PERSONA_MAX_CHANGE_RATIO : false
        const draftId = this.evolvePersona(agentId, content, sourceSession ?? null)
        this.personaAttemptWatermark.set(agentId, maxUnitCreatedAt)
        if (!draftId) return finish(null)
        return finish({ draftId, needsReview, changeRatio })
      })
    } catch (error) {
      logger.warn(`[Memory] persona evolution skipped: ${String(error)}`)
      return finish(null)
    }
  }

  async approvePersonaDraft(agentId: string, draftId: string): Promise<boolean> {
    if (this.ctx.isDisposed) return false
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return false
    return this.withPersonaLock(agentId, () => {
      if (this.ctx.isDisposed) return false
      const draft = this.ports.repository.getById(draftId)
      if (
        !draft ||
        draft.agent_id !== agentId ||
        draft.kind !== 'persona' ||
        draft.persona_state !== 'draft'
      ) {
        return false
      }
      const current = this.ports.repository.getActivePersona(agentId)
      if (current && current.id !== draft.id) {
        this.ports.repository.setPersonaState(current.id, 'superseded', draft.id)
      }
      this.ports.repository.setPersonaState(draft.id, 'active', null)
      this.ctx.markDomainMutationCommitted(agentId)
      this.ctx.emitChanged(agentId, 'persona-approve')
      return true
    })
  }

  async rejectPersonaDraft(agentId: string, draftId: string): Promise<boolean> {
    if (this.ctx.isDisposed) return false
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return false
    return this.withPersonaLock(agentId, () => {
      if (this.ctx.isDisposed) return false
      const draft = this.ports.repository.getById(draftId)
      if (
        !draft ||
        draft.agent_id !== agentId ||
        draft.kind !== 'persona' ||
        draft.persona_state !== 'draft'
      ) {
        return false
      }
      this.ports.repository.setPersonaState(draft.id, 'rejected')
      this.ctx.markDomainMutationCommitted(agentId)
      this.ctx.emitChanged(agentId, 'persona-reject')
      return true
    })
  }

  async setPersonaAnchor(agentId: string, versionId: string, anchored: boolean): Promise<boolean> {
    if (this.ctx.isDisposed) return false
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return false
    return this.withPersonaLock(agentId, () => {
      if (this.ctx.isDisposed) return false
      const row = this.ports.repository.getById(versionId)
      if (!row || row.agent_id !== agentId || row.kind !== 'persona') return false
      if ((row.is_anchor === 1) === anchored) return true
      this.ports.repository.setAnchor(row.id, anchored)
      this.ctx.markDomainMutationCommitted(agentId)
      this.ctx.emitChanged(agentId, 'persona-anchor')
      return true
    })
  }

  listPersonaVersions(agentId: string): AgentMemoryRow[] {
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return []
    return this.ports.repository.listPersonaVersions(agentId)
  }

  listPersonaDrafts(agentId: string): { row: AgentMemoryRow; needsReview: boolean }[] {
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return []
    const active = this.ports.repository.getActivePersona(agentId)
    return this.ports.repository
      .listPersonaVersions(agentId)
      .filter((row) => row.persona_state === 'draft')
      .map((row) => ({
        row,
        needsReview: active
          ? personaChangeRatio(active.content, row.content) > PERSONA_MAX_CHANGE_RATIO
          : false
      }))
  }

  async rollbackPersona(agentId: string, versionId: string): Promise<boolean> {
    if (this.ctx.isDisposed) return false
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return false
    return this.withPersonaLock(agentId, () => {
      if (this.ctx.isDisposed) return false
      const target = this.ports.repository.getById(versionId)
      if (!target || target.agent_id !== agentId || target.kind !== 'persona') return false
      const current = this.ports.repository.getActivePersona(agentId)
      if (current && current.id === versionId) return true
      const isHistorical =
        target.persona_state === 'superseded' ||
        (target.persona_state == null && target.superseded_by != null)
      if (!isHistorical) return false
      if (current && current.is_anchor === 1) return false
      if (current) {
        this.ports.repository.setPersonaState(current.id, 'superseded', versionId)
      }
      this.ports.repository.setPersonaState(versionId, 'active', null)
      this.ctx.markDomainMutationCommitted(agentId)
      this.ctx.emitChanged(agentId, 'persona-rollback')
      return true
    })
  }

  async cleanupAgent(agentId: string): Promise<void> {
    const personaLock = this.personaLocks.get(agentId)
    this.personaAttemptWatermark.delete(agentId)
    if (personaLock) await Promise.allSettled([personaLock])
    if (this.personaLocks.get(agentId) === personaLock) this.personaLocks.delete(agentId)
  }
}
