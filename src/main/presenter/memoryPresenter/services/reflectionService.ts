import logger from '@shared/logger'
import { nanoid } from 'nanoid'

import {
  MIN_MEMORIES_FOR_REFLECTION,
  REFLECTION_IMPORTANCE,
  REFLECTION_IMPORTANCE_THRESHOLD,
  REFLECTION_MEMORY_LIMIT
} from '../runtimeConstants'
import { buildMemoryProvenanceKey } from '../core/scoring'
import { buildReflectionInsightsPrompt, parseReflectionInsights } from '../core/extraction'
import type { MemoryReflectionResult } from '../types'
import { isUniqueConstraintError, type MemoryModelRef, type MemoryRuntimeContext } from '../context'

export class ReflectionService {
  private readonly reflectionAttemptWatermark = new Map<string, number>()

  constructor(
    private readonly ctx: MemoryRuntimeContext,
    private readonly ports: {
      syncWorkingMemoryAfterMutation: (agentId: string) => void
      triggerEmbedding: (agentId: string) => Promise<void>
    }
  ) {}

  async maybeReflect(
    agentId: string,
    model: MemoryModelRef,
    sourceSession?: string | null
  ): Promise<MemoryReflectionResult | null> {
    if (!this.ctx.canWriteAgentMemory(agentId)) return null
    try {
      const units = this.ctx.deps.repository.listByAgent(agentId, {
        kinds: ['episodic', 'semantic']
      })
      if (units.length < MIN_MEMORIES_FOR_REFLECTION) return null

      const lastReflection = this.ctx.deps.repository.listByAgent(agentId, {
        kinds: ['reflection'],
        limit: 1
      })[0]
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
      const reflectionModel = this.ctx.resolveExtractionModel(agentId, model)
      const raw = await this.ctx.deps.generateText(
        reflectionModel.providerId,
        reflectionModel.modelId,
        buildReflectionInsightsPrompt(top.map((row) => row.content))
      )
      if (!this.ctx.canWriteAgentMemory(agentId)) return null
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

      this.ports.syncWorkingMemoryAfterMutation(agentId)
      this.ctx.emitChanged(agentId, 'extract')
      void this.ports.triggerEmbedding(agentId).catch((error) => {
        logger.warn(`[Memory] background embedding failed: ${String(error)}`)
      })
      return { reflectionIds, sourceMemoryIds: top.map((row) => row.id) }
    } catch (error) {
      logger.warn(`[Memory] reflection skipped: ${String(error)}`)
      return null
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
    if (this.ctx.deps.repository.getByProvenanceKey(agentId, provenanceKey)) return null
    const id = `mem-${nanoid(12)}`
    try {
      this.ctx.deps.repository.insert({
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

  /** @internal Live mutable state for legacy facade-oracle tests only. */
  getMutableRuntimeStateForTests(): { reflectionAttemptWatermark: Map<string, number> } {
    return { reflectionAttemptWatermark: this.reflectionAttemptWatermark }
  }
}
