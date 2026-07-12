import logger from '@shared/logger'
import { nanoid } from 'nanoid'

import {
  MAINTENANCE_MAX_INPUT_TOKENS,
  MIN_MEMORIES_FOR_REFLECTION,
  REFLECTION_IMPORTANCE,
  REFLECTION_IMPORTANCE_THRESHOLD,
  REFLECTION_MEMORY_LIMIT,
  REFLECTION_PROMPT_OVERHEAD_TOKENS
} from '../runtimeConstants'
import { buildMemoryProvenanceKey } from '../core/scoring'
import { buildReflectionInsightsPrompt, parseReflectionInsights } from '../core/extraction'
import { estimateTokens } from '../core/injectionPort'
import { selectMaintenanceRowsWithinTokenBudget } from '../core/maintenanceBudget'
import { MaintenanceBudget } from '../core/maintenanceBudget'
import type { MemoryMaintenanceReflectionResult, MemoryReflectionResult } from '../types'
import { isUniqueConstraintError, type MemoryModelRef, type MemoryRuntimeContext } from '../context'
import type {
  MemoryLifecycleRepositoryPort,
  MemoryMutationRepositoryPort,
  MemoryProvenanceResolverPort,
  MemoryReadRepositoryPort,
  MemoryTextGenerationPort,
  MemoryTransactionPort
} from '../ports'

export class ReflectionService {
  private readonly ctx: MemoryRuntimeContext
  private readonly reflectionAttemptWatermark = new Map<string, number>()

  constructor(
    private readonly ports: {
      ctx: MemoryRuntimeContext
      repository: MemoryReadRepositoryPort &
        MemoryMutationRepositoryPort &
        MemoryLifecycleRepositoryPort &
        MemoryTransactionPort
      textGeneration: MemoryTextGenerationPort
      provenance: MemoryProvenanceResolverPort
      syncWorkingMemoryAfterMutation: (agentId: string) => void
      triggerEmbedding: (agentId: string) => Promise<void>
    }
  ) {
    this.ctx = ports.ctx
  }

  async maybeReflect(
    agentId: string,
    model: MemoryModelRef,
    sourceSession?: string | null,
    budget: MaintenanceBudget = new MaintenanceBudget()
  ): Promise<MemoryReflectionResult | null> {
    return (await this.runMaintenanceReflectionPass(agentId, model, sourceSession, budget)).result
  }

  async runMaintenanceReflectionPass(
    agentId: string,
    model: MemoryModelRef,
    sourceSession?: string | null,
    budget: MaintenanceBudget = new MaintenanceBudget()
  ): Promise<MemoryMaintenanceReflectionResult> {
    let calls = 0
    let failures = 0
    const finish = (result: MemoryReflectionResult | null): MemoryMaintenanceReflectionResult => ({
      result,
      calls,
      failures
    })
    if (!this.ctx.canWriteAgentMemory(agentId)) return finish(null)
    const operationFence = this.ctx.captureOperationFence(agentId)
    try {
      const lastReflection = this.ports.repository.listByAgent(agentId, {
        kinds: ['reflection'],
        limit: 1
      })[0]
      const watermark = Math.max(
        lastReflection?.created_at ?? 0,
        this.reflectionAttemptWatermark.get(agentId) ?? 0
      )
      const cognitive = this.ports.repository.getCognitiveMaintenanceInput(agentId, {
        kinds: ['episodic', 'semantic'],
        watermark,
        limit: REFLECTION_MEMORY_LIMIT
      })
      if (cognitive.eligibleCount < MIN_MEMORIES_FOR_REFLECTION) return finish(null)
      if (cognitive.importanceAfterWatermark < REFLECTION_IMPORTANCE_THRESHOLD) {
        return finish(null)
      }
      const maxUnitCreatedAt = cognitive.maxCreatedAt
      const availableTokens = Math.max(
        0,
        MAINTENANCE_MAX_INPUT_TOKENS -
          budget.snapshot().inputTokens -
          REFLECTION_PROMPT_OVERHEAD_TOKENS
      )
      const top = selectMaintenanceRowsWithinTokenBudget(
        cognitive.topRows,
        availableTokens,
        (row) => estimateTokens(row.content)
      )
      if (top.length < MIN_MEMORIES_FOR_REFLECTION) return finish(null)
      const reflectionModel = this.ctx.resolveExtractionModel(agentId, model)
      const prompt = buildReflectionInsightsPrompt(top.map((row) => row.content))
      if (!budget.reserve('reflection', estimateTokens(prompt))) return finish(null)
      let raw = ''
      try {
        calls += 1
        raw = await this.ports.textGeneration.generateText(
          agentId,
          reflectionModel.providerId,
          reflectionModel.modelId,
          prompt,
          'maintenance'
        )
      } catch (error) {
        failures += 1
        throw error
      }
      if (!this.ctx.canContinueOperation(operationFence)) return finish(null)
      const insights = parseReflectionInsights(raw)
      const reflectionIds = this.ports.repository.runInTransaction(() =>
        insights.flatMap((insight) => {
          const id = this.insertReflection(agentId, insight, sourceSession ?? null)
          return id ? [id] : []
        })
      )
      if (!reflectionIds.length) {
        this.reflectionAttemptWatermark.set(agentId, maxUnitCreatedAt)
        return finish(null)
      }
      this.reflectionAttemptWatermark.delete(agentId)

      this.ctx.markDomainMutationCommitted(agentId)
      this.ports.syncWorkingMemoryAfterMutation(agentId)
      this.ctx.emitChanged(agentId, 'extract')
      void this.ports.triggerEmbedding(agentId).catch((error) => {
        logger.warn(`[Memory] background embedding failed: ${String(error)}`)
      })
      return finish({ reflectionIds, sourceMemoryIds: top.map((row) => row.id) })
    } catch (error) {
      logger.warn(`[Memory] reflection skipped: ${String(error)}`)
      return finish(null)
    }
  }

  private insertReflection(
    agentId: string,
    content: string,
    sourceSession: string | null
  ): string | null {
    if (!this.ctx.canWriteAgentMemory(agentId)) return null
    const trimmed = content.trim()
    if (!trimmed) return null
    const provenanceKey = buildMemoryProvenanceKey(agentId, 'reflection', trimmed)
    if (this.ports.provenance.resolveProvenance(agentId, 'reflection', trimmed)) return null
    const id = `mem-${nanoid(12)}`
    try {
      this.ports.repository.insert({
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

  cleanupAgent(agentId: string): void {
    this.reflectionAttemptWatermark.delete(agentId)
  }
}
