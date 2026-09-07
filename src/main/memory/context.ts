import { nanoid } from 'nanoid'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'
import {
  isSafeAgentId,
  type AgentMemoryAuditActorType,
  type AgentMemoryAuditStatus
} from '@shared/types/agent-memory'
import type { MemoryUpdateReason } from '@shared/contracts/events/memory.events'

import type { MemoryModelRef, MemoryUpdateContext } from './domain/types'
import {
  memoryEmbeddingStorageFingerprint,
  memoryExecutionConfigFingerprint,
  type MemoryExecutionConfigObservation,
  type MemoryExecutionToken
} from './core/executionIdentity'
import type {
  MemoryAgentPolicyPort,
  MemoryAuditWritePort,
  MemoryChangeSinkPort,
  MemoryProviderControlPort
} from './ports'
import {
  canonicalizeMemoryTimeZone,
  systemMemoryDomainClock,
  type MemoryDomainClock
} from './domain/clock'

export type { MemoryModelRef } from './domain/types'

export type MemoryOperationFence = MemoryExecutionToken

interface MemoryExecutionState {
  generation: number
  configFingerprint?: string
}

export interface MemoryRuntimeContextOptions {
  policy: MemoryAgentPolicyPort
  auditWriter?: MemoryAuditWritePort
  changeSink?: MemoryChangeSinkPort
  onAgentMemoryMutated?: (agentId: string) => void
  providerControl: MemoryProviderControlPort
  clock?: MemoryDomainClock
  pendingMemoryClearAgentIds?: readonly string[]
}

export function embeddingFingerprint(providerId: string, modelId: string): string {
  return memoryEmbeddingStorageFingerprint({ providerId, modelId })
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
  private readonly executionStateByAgent = new Map<string, MemoryExecutionState>()
  private readonly pendingMemoryClearAgentIds: Set<string>
  private readonly clock: MemoryDomainClock

  constructor(private readonly options: MemoryRuntimeContextOptions) {
    this.clock = options.clock ?? systemMemoryDomainClock
    this.pendingMemoryClearAgentIds = new Set(options.pendingMemoryClearAgentIds)
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  now(): number {
    const now = this.clock.now()
    if (!Number.isFinite(now)) {
      throw new Error(`[Memory] domain clock returned a non-finite timestamp: ${String(now)}`)
    }
    return Math.trunc(now)
  }

  timeZone(): string {
    return canonicalizeMemoryTimeZone(this.clock.timeZone()) ?? 'UTC'
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
      generation: this.getOrCreateExecutionState(agentId).generation
    }
  }

  isOperationFenceCurrent(fence: MemoryOperationFence): boolean {
    return (
      !this.disposed &&
      (this.executionStateByAgent.get(fence.agentId)?.generation ?? 0) === fence.generation
    )
  }

  canContinueOperation(fence: MemoryOperationFence): boolean {
    return this.isOperationFenceCurrent(fence) && this.canContinueAgentMemoryTask(fence.agentId)
  }

  invalidateAgentOperations(agentId: string): number {
    const state = this.getOrCreateExecutionState(agentId)
    const generation = state.generation + 1
    state.generation = generation
    this.options.providerControl.abortAgent(agentId)
    return generation
  }

  noteAgentExecutionConfig(
    agentId: string,
    config: DeepChatAgentConfig | null
  ): MemoryExecutionConfigObservation {
    const state = this.getOrCreateExecutionState(agentId)
    const fingerprint = memoryExecutionConfigFingerprint(config)
    if (state.configFingerprint === undefined) {
      state.configFingerprint = fingerprint
      return 'seeded'
    }
    if (state.configFingerprint === fingerprint) return 'unchanged'
    state.configFingerprint = fingerprint
    this.invalidateAgentOperations(agentId)
    return 'changed'
  }

  listObservedExecutionAgentIds(): string[] {
    return [...this.executionStateByAgent.entries()]
      .filter(([, state]) => state.configFingerprint !== undefined)
      .map(([agentId]) => agentId)
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
    this.pendingMemoryClearAgentIds.delete(agentId)
    const executionState = this.executionStateByAgent.get(agentId)
    if (executionState) executionState.configFingerprint = undefined
  }

  clearRuntimeState(): void {
    this.readEpochByAgent.clear()
    this.executionStateByAgent.clear()
    this.pendingMemoryClearAgentIds.clear()
  }

  private getOrCreateExecutionState(agentId: string): MemoryExecutionState {
    let state = this.executionStateByAgent.get(agentId)
    if (!state) {
      state = { generation: 0 }
      this.executionStateByAgent.set(agentId, state)
    }
    return state
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

  isMemoryClearPending(agentId: string): boolean {
    return this.pendingMemoryClearAgentIds.has(agentId)
  }

  markMemoryClearPending(agentId: string): void {
    this.pendingMemoryClearAgentIds.add(agentId)
  }

  markMemoryClearCompleted(agentId: string): void {
    this.pendingMemoryClearAgentIds.delete(agentId)
  }

  canWriteAgentMemory(agentId: string): boolean {
    return (
      !this.disposed &&
      !this.isMemoryClearPending(agentId) &&
      this.isManagedAgent(agentId) &&
      this.isEnabled(agentId)
    )
  }

  canManageAgentMemory(agentId: string): boolean {
    return !this.disposed && this.isManagedAgent(agentId)
  }

  canManageClaimMemory(agentId: string): boolean {
    return this.canManageAgentMemory(agentId) && !this.isMemoryClearPending(agentId)
  }

  canReadDirectivePlane(agentId: string): boolean {
    return !this.disposed && this.isManagedAgent(agentId) && this.isEnabled(agentId)
  }

  canReadAgentMemory(agentId: string): boolean {
    return this.canReadDirectivePlane(agentId) && !this.isMemoryClearPending(agentId)
  }

  canContinueAgentMemoryTask(agentId: string): boolean {
    return this.canReadAgentMemory(agentId)
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
      createdAt: input.createdAt ?? this.now()
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
