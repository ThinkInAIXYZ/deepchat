import { nanoid } from 'nanoid'

import { isSafeAgentId, type MemoryPresenterDeps } from './types'
import type { MemoryUpdateContext, MemoryUpdateReason } from './types'

export type MemoryModelRef = { providerId: string; modelId: string }

export function embeddingFingerprint(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`
}

export function isUniqueConstraintError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true
  const message = error instanceof Error ? error.message : String(error)
  return /UNIQUE constraint failed/i.test(message)
}

export class MemoryRuntimeContext {
  private disposed = false

  constructor(readonly deps: MemoryPresenterDeps) {}

  get isDisposed(): boolean {
    return this.disposed
  }

  markDisposed(): void {
    this.disposed = true
  }

  isEnabled(agentId: string): boolean {
    return this.deps.resolveAgentConfig(agentId)?.memoryEnabled === true
  }

  isPersonaEvolutionEnabled(agentId: string): boolean {
    const config = this.deps.resolveAgentConfig(agentId)
    return config?.memoryEnabled === true && config?.personaEvolutionEnabled === true
  }

  assertSafeAgentId(agentId: string): void {
    if (!isSafeAgentId(agentId)) {
      throw new Error(`[Memory] invalid agentId: ${JSON.stringify(agentId)}`)
    }
  }

  isManagedAgent(agentId: string): boolean {
    return this.deps.isManagedAgent ? this.deps.isManagedAgent(agentId) : true
  }

  canWriteAgentMemory(agentId: string): boolean {
    return !this.disposed && this.isManagedAgent(agentId) && this.isEnabled(agentId)
  }

  canReadAgentMemory(agentId: string): boolean {
    return !this.disposed && this.isManagedAgent(agentId) && this.isEnabled(agentId)
  }

  canContinueAgentMemoryTask(agentId: string): boolean {
    return !this.disposed && this.isManagedAgent(agentId) && this.isEnabled(agentId)
  }

  canUseCurrentMemoryEmbedding(agentId: string, embedding: MemoryModelRef): boolean {
    const current = this.deps.resolveAgentConfig(agentId)?.memoryEmbedding
    return (
      current?.providerId === embedding.providerId &&
      current?.modelId === embedding.modelId &&
      this.canReadAgentMemory(agentId)
    )
  }

  emitChanged(agentId: string, reason: MemoryUpdateReason, context?: MemoryUpdateContext): void {
    if (context) this.deps.onMemoryChanged?.(agentId, reason, context)
    else this.deps.onMemoryChanged?.(agentId, reason)
  }

  writeAudit(
    agentId: string,
    input: {
      eventType: string
      actorType: 'scheduler' | 'user' | 'runtime'
      status: 'completed' | 'skipped' | 'failed'
      reason?: string | null
      inputRefs?: Record<string, unknown>
      outputRefs?: Record<string, unknown>
      model?: MemoryModelRef | null
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

  resolveExtractionModel(agentId: string, fallback: MemoryModelRef): MemoryModelRef {
    const configured = this.deps.resolveAgentConfig(agentId)?.memoryExtractionModel
    if (configured?.providerId && configured?.modelId) {
      return { providerId: configured.providerId, modelId: configured.modelId }
    }
    return fallback
  }

  resolveConsolidationModel(agentId: string): MemoryModelRef | null {
    const configured = this.deps.resolveAgentConfig(agentId)?.memoryExtractionModel
    if (configured?.providerId && configured?.modelId) {
      return { providerId: configured.providerId, modelId: configured.modelId }
    }
    return this.deps.resolveAgentDefaultModel?.(agentId) ?? null
  }
}
