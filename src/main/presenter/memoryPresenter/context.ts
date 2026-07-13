import { nanoid } from 'nanoid'
import {
  isSafeAgentId,
  type AgentMemoryAuditActorType,
  type AgentMemoryAuditStatus
} from '@shared/types/agent-memory'
import type { MemoryUpdateReason } from '@shared/contracts/events/memory.events'

import type { MemoryModelRef, MemoryUpdateContext } from './domain/types'
import type {
  MemoryAgentPolicyPort,
  MemoryAuditWritePort,
  MemoryChangeSinkPort,
  MemoryProviderControlPort
} from './ports'

export type { MemoryModelRef } from './domain/types'

export interface MemoryOperationFence {
  agentId: string
  generation: number
}

export interface MemoryRuntimeContextOptions {
  policy: MemoryAgentPolicyPort
  auditWriter?: MemoryAuditWritePort
  changeSink?: MemoryChangeSinkPort
  onAgentMemoryMutated?: (agentId: string) => void
  providerControl: MemoryProviderControlPort
}

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
  private readonly readEpochByAgent = new Map<string, number>()
  private readonly operationGenerationByAgent = new Map<string, number>()

  constructor(private readonly options: MemoryRuntimeContextOptions) {}

  get isDisposed(): boolean {
    return this.disposed
  }

  markDisposed(): void {
    this.disposed = true
  }

  abortProviderRequests(): void {
    this.options.providerControl.abortAll()
  }

  captureOperationFence(agentId: string): MemoryOperationFence {
    return {
      agentId,
      generation: this.operationGenerationByAgent.get(agentId) ?? 0
    }
  }

  isOperationFenceCurrent(fence: MemoryOperationFence): boolean {
    return (
      !this.disposed &&
      (this.operationGenerationByAgent.get(fence.agentId) ?? 0) === fence.generation
    )
  }

  canContinueOperation(fence: MemoryOperationFence): boolean {
    return this.isOperationFenceCurrent(fence) && this.canContinueAgentMemoryTask(fence.agentId)
  }

  invalidateAgentOperations(agentId: string): number {
    const generation = (this.operationGenerationByAgent.get(agentId) ?? 0) + 1
    this.operationGenerationByAgent.set(agentId, generation)
    this.options.providerControl.abortAgent(agentId)
    return generation
  }

  captureReadEpoch(agentId: string): number {
    return this.readEpochByAgent.get(agentId) ?? 0
  }

  isReadEpochCurrent(agentId: string, epoch: number): boolean {
    return this.captureReadEpoch(agentId) === epoch
  }

  markDomainMutationCommitted(agentId: string): number {
    const epoch = this.captureReadEpoch(agentId) + 1
    this.readEpochByAgent.set(agentId, epoch)
    return epoch
  }

  cleanupAgent(agentId: string): void {
    this.readEpochByAgent.delete(agentId)
  }

  clearRuntimeState(): void {
    this.readEpochByAgent.clear()
    this.operationGenerationByAgent.clear()
  }

  isEnabled(agentId: string): boolean {
    return this.options.policy.resolveAgentConfig(agentId)?.memoryEnabled === true
  }

  isPersonaEvolutionEnabled(agentId: string): boolean {
    const config = this.options.policy.resolveAgentConfig(agentId)
    return config?.memoryEnabled === true && config.personaEvolutionEnabled === true
  }

  assertSafeAgentId(agentId: string): void {
    if (!isSafeAgentId(agentId)) {
      throw new Error(`[Memory] invalid agentId: ${JSON.stringify(agentId)}`)
    }
  }

  isManagedAgent(agentId: string): boolean {
    const isManagedAgent = this.options.policy.isManagedAgent
    return isManagedAgent ? isManagedAgent(agentId) : true
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
    const current = this.options.policy.resolveAgentConfig(agentId)?.memoryEmbedding
    return (
      current?.providerId === embedding.providerId &&
      current?.modelId === embedding.modelId &&
      this.canReadAgentMemory(agentId)
    )
  }

  emitChanged(agentId: string, reason: MemoryUpdateReason, context?: MemoryUpdateContext): void {
    if (this.disposed) return
    this.options.onAgentMemoryMutated?.(agentId)
    if (context) this.options.changeSink?.onMemoryChanged?.(agentId, reason, context)
    else this.options.changeSink?.onMemoryChanged?.(agentId, reason)
  }

  writeAudit(
    agentId: string,
    input: {
      eventType: string
      actorType: AgentMemoryAuditActorType
      status: AgentMemoryAuditStatus
      reason?: string | null
      inputRefs?: Record<string, unknown>
      outputRefs?: Record<string, unknown>
      model?: MemoryModelRef | null
      sessionId?: string | null
      createdAt?: number
    }
  ): void {
    if (this.disposed) return
    this.options.auditWriter?.insert({
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
    const configured = this.options.policy.resolveAgentConfig(agentId)?.memoryExtractionModel
    if (configured?.providerId && configured.modelId) {
      return { providerId: configured.providerId, modelId: configured.modelId }
    }
    return fallback
  }

  resolveConsolidationModel(agentId: string): MemoryModelRef | null {
    const configured = this.options.policy.resolveAgentConfig(agentId)?.memoryExtractionModel
    if (configured?.providerId && configured.modelId) {
      return { providerId: configured.providerId, modelId: configured.modelId }
    }
    return this.options.policy.resolveAgentDefaultModel?.(agentId) ?? null
  }
}
