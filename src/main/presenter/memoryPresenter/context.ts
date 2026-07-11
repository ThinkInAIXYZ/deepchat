import { nanoid } from 'nanoid'
import type { LLM_EMBEDDING_ATTRS } from '@shared/presenter'

import { isSafeAgentId, type MemoryPresenterDeps } from './types'
import type { MemoryUpdateContext, MemoryUpdateReason } from './types'
import {
  buildLegacyMemoryProvenanceKey,
  buildMemoryProvenanceKey,
  normalizeForProvenanceV2
} from './core/scoring'
import type { AgentMemoryRow } from './types'

function materializedRowCount(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (!value || typeof value !== 'object') return 0
  const record = value as Record<string, unknown>
  if (Array.isArray(record.rows)) return record.rows.length
  if (Array.isArray(record.topRows)) return record.topRows.length
  return 0
}

function observeRepository(deps: MemoryPresenterDeps): MemoryPresenterDeps['repository'] {
  const observer = deps.perfObserver
  if (!observer) return deps.repository
  const repository = deps.repository
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        observer.increment('repositoryCalls')
        const result = Reflect.apply(value, target, args)
        observer.increment('materializedRows', materializedRowCount(result))
        return result
      }
    }
  })
}

export type MemoryModelRef = { providerId: string; modelId: string }

export interface MemoryOperationFence {
  agentId: string
  generation: number
}

export interface MemoryProviderPort {
  abortAll(): void
  abortAgent(agentId: string): void
  generateText(
    agentId: string,
    providerId: string,
    modelId: string,
    prompt: string,
    purpose: 'extraction' | 'decision' | 'maintenance'
  ): Promise<string>
  getEmbeddings(
    agentId: string,
    providerId: string,
    modelId: string,
    texts: string[],
    purpose: 'query-embedding' | 'embedding-batch' | 'embedding-warm'
  ): Promise<number[][]>
  getDimensions(
    agentId: string,
    providerId: string,
    modelId: string
  ): Promise<{ data: LLM_EMBEDDING_ATTRS; errorMsg?: string }>
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

function isEquivalentProvenanceOwner(
  owner: AgentMemoryRow | undefined,
  kind: string,
  normalizedContent: string
): owner is AgentMemoryRow {
  return (
    owner !== undefined &&
    owner.kind === kind &&
    normalizeForProvenanceV2(owner.content) === normalizedContent
  )
}

export class MemoryRuntimeContext {
  private disposed = false
  private readonly readEpochByAgent = new Map<string, number>()
  private readonly operationGenerationByAgent = new Map<string, number>()
  readonly provider: MemoryProviderPort
  readonly deps: MemoryPresenterDeps

  constructor(
    deps: MemoryPresenterDeps,
    private readonly onAgentMemoryMutated: ((agentId: string) => void) | undefined,
    provider: MemoryProviderPort
  ) {
    this.deps = { ...deps, repository: observeRepository(deps) }
    this.provider = provider
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  markDisposed(): void {
    this.disposed = true
  }

  abortProviderRequests(): void {
    this.provider.abortAll()
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

  isOperationGenerationCurrent(fence: MemoryOperationFence): boolean {
    return (this.operationGenerationByAgent.get(fence.agentId) ?? 0) === fence.generation
  }

  canContinueOperation(fence: MemoryOperationFence): boolean {
    return this.isOperationFenceCurrent(fence) && this.canContinueAgentMemoryTask(fence.agentId)
  }

  invalidateAgentOperations(agentId: string): number {
    const generation = (this.operationGenerationByAgent.get(agentId) ?? 0) + 1
    this.operationGenerationByAgent.set(agentId, generation)
    this.provider.abortAgent(agentId)
    return generation
  }

  resolveProvenance(agentId: string, kind: string, content: string): AgentMemoryRow | undefined {
    const normalizedContent = normalizeForProvenanceV2(content)
    const v2Key = buildMemoryProvenanceKey(agentId, kind, content)
    const resolveEquivalentV2Owner = (): AgentMemoryRow | undefined => {
      const owner = this.deps.repository.getByProvenanceKey(agentId, v2Key)
      return isEquivalentProvenanceOwner(owner, kind, normalizedContent) ? owner : undefined
    }
    const v2Owner = resolveEquivalentV2Owner()
    if (v2Owner) return v2Owner

    const legacyKey = buildLegacyMemoryProvenanceKey(agentId, kind, content)
    const legacyOwner = this.deps.repository.getByProvenanceKey(agentId, legacyKey)
    if (
      !legacyOwner ||
      legacyOwner.kind !== kind ||
      normalizeForProvenanceV2(legacyOwner.content) !== normalizedContent
    ) {
      return undefined
    }
    try {
      let rekeyed = false
      this.deps.repository.runInTransaction(() => {
        rekeyed = this.deps.repository.rekeyProvenance(agentId, legacyOwner.id, legacyKey, v2Key)
      })
      return rekeyed
        ? (this.deps.repository.getById(legacyOwner.id) ?? legacyOwner)
        : resolveEquivalentV2Owner()
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      return resolveEquivalentV2Owner()
    }
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
    this.onAgentMemoryMutated?.(agentId)
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
