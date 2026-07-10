import logger from '@shared/logger'
import { nanoid } from 'nanoid'

import {
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
import type {
  AgentMemoryRow,
  MemoryMaintenancePersonaResult,
  MemoryPersonaDraftResult
} from '../types'
import { type MemoryModelRef, type MemoryRuntimeContext } from '../context'

export class PersonaService {
  private readonly personaAttemptWatermark = new Map<string, number>()
  private readonly personaLocks = new Map<string, Promise<unknown>>()

  constructor(private readonly ctx: MemoryRuntimeContext) {}

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
    this.ctx.deps.repository.insert({
      id,
      agentId,
      kind: 'persona',
      content: trimmed,
      importance: 1,
      status: 'fts_only',
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
    sourceSession?: string | null
  ): Promise<MemoryPersonaDraftResult | null> {
    return (await this.runMaintenancePersonaPass(agentId, model, sourceSession)).result
  }

  async runMaintenancePersonaPass(
    agentId: string,
    model: MemoryModelRef,
    sourceSession?: string | null
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
        if (this.ctx.deps.repository.getDraftPersona(agentId)) return finish(null)

        const units = this.ctx.deps.repository.listByAgent(agentId, {
          kinds: ['semantic', 'reflection', 'episodic']
        })
        if (units.length < MIN_MEMORIES_FOR_PERSONA) return finish(null)

        const previous = this.ctx.deps.repository.getActivePersona(agentId)
        const watermark = Math.max(
          previous?.created_at ?? 0,
          this.personaAttemptWatermark.get(agentId) ?? 0
        )
        const recentImportance = units
          .filter((unit) => unit.created_at > watermark)
          .reduce((sum, unit) => sum + Math.min(1, Math.max(0, unit.importance)), 0)
        if (recentImportance < PERSONA_EVOLUTION_IMPORTANCE_THRESHOLD) return finish(null)
        const maxUnitCreatedAt = units.reduce((max, unit) => Math.max(max, unit.created_at), 0)

        const top = units
          .slice()
          .sort((a, b) => b.importance - a.importance || b.created_at - a.created_at)
          .slice(0, PERSONA_MEMORY_LIMIT)
        const personaModel = this.ctx.resolveExtractionModel(agentId, model)
        const operationFence = this.ctx.captureOperationFence(agentId)
        let raw = ''
        try {
          calls += 1
          raw = await this.ctx.provider.generateText(
            agentId,
            personaModel.providerId,
            personaModel.modelId,
            buildReflectionPrompt(
              previous?.content ?? null,
              top.map((row) => row.content)
            ),
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
      const draft = this.ctx.deps.repository.getById(draftId)
      if (
        !draft ||
        draft.agent_id !== agentId ||
        draft.kind !== 'persona' ||
        draft.persona_state !== 'draft'
      ) {
        return false
      }
      const current = this.ctx.deps.repository.getActivePersona(agentId)
      if (current && current.id !== draft.id) {
        this.ctx.deps.repository.setPersonaState(current.id, 'superseded', draft.id)
      }
      this.ctx.deps.repository.setPersonaState(draft.id, 'active', null)
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
      const draft = this.ctx.deps.repository.getById(draftId)
      if (
        !draft ||
        draft.agent_id !== agentId ||
        draft.kind !== 'persona' ||
        draft.persona_state !== 'draft'
      ) {
        return false
      }
      this.ctx.deps.repository.setPersonaState(draft.id, 'rejected')
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
      const row = this.ctx.deps.repository.getById(versionId)
      if (!row || row.agent_id !== agentId || row.kind !== 'persona') return false
      if ((row.is_anchor === 1) === anchored) return true
      this.ctx.deps.repository.setAnchor(row.id, anchored)
      this.ctx.markDomainMutationCommitted(agentId)
      this.ctx.emitChanged(agentId, 'persona-anchor')
      return true
    })
  }

  listPersonaVersions(agentId: string): AgentMemoryRow[] {
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return []
    return this.ctx.deps.repository.listPersonaVersions(agentId)
  }

  listPersonaDrafts(agentId: string): { row: AgentMemoryRow; needsReview: boolean }[] {
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.isManagedAgent(agentId)) return []
    const active = this.ctx.deps.repository.getActivePersona(agentId)
    return this.ctx.deps.repository
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
      const target = this.ctx.deps.repository.getById(versionId)
      if (!target || target.agent_id !== agentId || target.kind !== 'persona') return false
      const current = this.ctx.deps.repository.getActivePersona(agentId)
      if (current && current.id === versionId) return true
      const isHistorical =
        target.persona_state === 'superseded' ||
        (target.persona_state == null && target.superseded_by != null)
      if (!isHistorical) return false
      if (current && current.is_anchor === 1) return false
      if (current) {
        this.ctx.deps.repository.setPersonaState(current.id, 'superseded', versionId)
      }
      this.ctx.deps.repository.setPersonaState(versionId, 'active', null)
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

  /** @internal Live mutable state for legacy facade-oracle tests only. */
  getMutableRuntimeStateForTests(): {
    personaAttemptWatermark: Map<string, number>
    personaLocks: Map<string, Promise<unknown>>
  } {
    return {
      personaAttemptWatermark: this.personaAttemptWatermark,
      personaLocks: this.personaLocks
    }
  }
}
