import {
  appendMemorySection,
  appendMemorySectionWithManifest,
  buildMemorySection,
  type MemoryInjectionPayload,
  type MemoryInjectionPort,
  type MemoryInjectionResult,
  type MemoryRuntimePort
} from './injection'
import { isSafeAgentId } from '@shared/types/agent-memory'
import type { AgentMemoryRow } from './types'
import {
  VectorStoreQuarantineMarkerError,
  type DeletedAgentMemoryCleanupResult,
  type MemoryClearResult
} from './domain/types'
import type {
  MemoryCandidate,
  MemoryConflictPair,
  MemoryConflictResolution,
  MemoryPresenterDeps,
  MemoryRecallItem,
  MemorySearchHit,
  MemoryStatus,
  MemoryWriteOutcome,
  WriteMemoriesOptions
} from './types'
import type {
  MemoryArchiveCandidateLifecyclePreview,
  MemoryHealthDto,
  MemoryLifecycle,
  MemoryUpdateResult
} from '@shared/contracts/routes/memory.routes'
import { AGENT_MEMORY_MANUAL_CONTENT_MAX_CHARS } from '@shared/types/agent-memory'
import { unicodeCodePointLength } from '@shared/lib/unicodeText'
import type {
  MemoryExtractionInput,
  MemoryExtractionResult,
  MemoryPersonaDraftResult,
  MemoryReflectionResult
} from './types'
import { REINDEX_MAX_BATCHES } from './runtimeConstants'
import { MemoryRuntimeContext } from './context'
import { MemoryRowMutations } from './services/rowMutations'
import { VectorStoreManager } from './infra/vectorStoreManager'
import { MemoryProviderGateway } from './infra/providerGateway'
import { EmbeddingPipeline } from './infra/embeddingPipeline'
import { WorkingMemoryService } from './services/workingMemoryService'
import { RetrievalService } from './services/retrievalService'
import { ReflectionService } from './services/reflectionService'
import { PersonaService } from './services/personaService'
import { ConflictService } from './services/conflictService'
import { MaintenanceService } from './services/maintenanceService'
import { WriteCoordinator } from './services/writeCoordinator'
import { ManagementService } from './services/managementService'
import {
  createCompositeMemoryPerfObserver,
  MemoryDiagnosticsCollector
} from './infra/diagnostics/memoryDiagnosticsCollector'
import { BUILTIN_DEEPCHAT_AGENT_ID } from '../agentRepository'
import type {
  MemoryAgentPolicyPort,
  MemoryPerfObserver,
  MemoryRepositoryPort,
  MemoryVectorStoreFactoryPort
} from './ports'

export { appendMemorySection, appendMemorySectionWithManifest, buildMemorySection, isSafeAgentId }
export type {
  MemoryInjectionPayload,
  MemoryInjectionPort,
  MemoryInjectionResult,
  MemoryRuntimePort
}

function materializedRowCount(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (!value || typeof value !== 'object') return 0
  const record = value as Record<string, unknown>
  if (Array.isArray(record.rows)) return record.rows.length
  if (Array.isArray(record.topRows)) return record.topRows.length
  return 0
}

function observeRepository(
  repository: MemoryRepositoryPort,
  observer?: MemoryPerfObserver
): MemoryRepositoryPort {
  if (!observer) return repository
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

export class MemoryPresenter implements MemoryRuntimePort {
  private readonly repository: MemoryRepositoryPort
  private readonly policy: MemoryAgentPolicyPort
  private readonly runtime: MemoryRuntimeContext
  private readonly rows: MemoryRowMutations
  private readonly vectorStore: VectorStoreManager
  private readonly embedding: EmbeddingPipeline
  private readonly workingMemory: WorkingMemoryService
  private readonly retrieval: RetrievalService
  private readonly reflection: ReflectionService
  private readonly persona: PersonaService
  private readonly conflict: ConflictService
  private readonly maintenance: MaintenanceService
  private readonly writeCoordinator: WriteCoordinator
  private readonly management: ManagementService
  private readonly diagnostics: MemoryDiagnosticsCollector

  constructor(deps: MemoryPresenterDeps) {
    this.diagnostics = new MemoryDiagnosticsCollector()
    const perfObserver = createCompositeMemoryPerfObserver([
      deps.perfObserver,
      this.diagnostics.createPerfObserverAdapter()
    ])
    this.repository = observeRepository(deps.repository, deps.perfObserver)
    this.policy = {
      resolveAgentConfig: deps.resolveAgentConfig,
      resolveAgentDefaultModel: deps.resolveAgentDefaultModel,
      isManagedAgent: deps.isManagedAgent,
      listManagedMemoryAgentIds: deps.listManagedMemoryAgentIds
    }
    const repository = this.repository
    const policy = this.policy
    const providerGateway = new MemoryProviderGateway({
      executeWithRateLimit: deps.executeWithRateLimit,
      getEmbeddings: deps.getEmbeddings,
      getDimensions: deps.getDimensions,
      generateText: deps.generateText,
      perfObserver,
      diagnostics: this.diagnostics
    })
    const vectorStoreFactory: MemoryVectorStoreFactoryPort = {
      createVectorStore: deps.createVectorStore,
      resetVectorStore: deps.resetVectorStore,
      markVectorStoreQuarantined: deps.markVectorStoreQuarantined
    }

    this.runtime = new MemoryRuntimeContext({
      policy,
      auditWriter: deps.auditRepository,
      changeSink: { onMemoryChanged: deps.onMemoryChanged },
      providerControl: providerGateway
    })
    this.rows = new MemoryRowMutations({
      repository,
      auditReader: deps.auditRepository
    })
    this.vectorStore = new VectorStoreManager({
      ctx: this.runtime,
      repository,
      policy,
      vectorStoreFactory,
      perfObserver,
      diagnostics: this.diagnostics
    })
    this.embedding = new EmbeddingPipeline({
      ctx: this.runtime,
      repository,
      policy,
      embeddingGateway: providerGateway,
      vectorStore: this.vectorStore,
      rows: this.rows,
      reindexEmbeddings: (agentId, force) => this.reindexEmbeddings(agentId, force),
      backfillEmbeddings: (agentId) => this.backfillEmbeddings(agentId),
      diagnostics: this.diagnostics
    })
    this.workingMemory = new WorkingMemoryService({ ctx: this.runtime, repository })

    this.retrieval = new RetrievalService({
      ctx: this.runtime,
      repository,
      policy,
      embeddingGateway: providerGateway,
      vectorStore: this.vectorStore,
      workingMemory: this.workingMemory,
      warmVectorStore: (agentId, embedding, options) =>
        this.embedding.warmVectorStore(agentId, embedding, options),
      warmEmbeddingConnection: (agentId, embedding) =>
        this.embedding.warmEmbeddingConnection(agentId, embedding),
      reindexEmbeddings: (agentId, force) => this.reindexEmbeddings(agentId, force),
      backfillEmbeddings: (agentId) => this.backfillEmbeddings(agentId),
      isReindexing: (agentId) => this.embedding.isReindexing(agentId),
      deletePrunableVectorsForMemoryIds: (agentId, embedding, dimensions, memoryIds) =>
        this.vectorStore.deletePrunableVectorsForMemoryIds(
          agentId,
          embedding,
          dimensions,
          memoryIds
        ),
      diagnostics: this.diagnostics
    })
    this.reflection = new ReflectionService({
      ctx: this.runtime,
      repository,
      textGeneration: providerGateway,
      provenance: this.rows,
      syncWorkingMemoryAfterMutation: (agentId) =>
        this.workingMemory.syncWorkingMemoryAfterMutation(agentId),
      triggerEmbedding: (agentId) => this.embedding.processPendingEmbeddings(agentId)
    })
    this.persona = new PersonaService({
      ctx: this.runtime,
      repository,
      textGeneration: providerGateway
    })

    // Late-bound to break the ConflictService <-> MaintenanceService workflow cycle. Constructors
    // must not call this port before the assignment below completes.
    let maintenanceService!: MaintenanceService
    this.conflict = new ConflictService({
      ctx: this.runtime,
      repository,
      textGeneration: providerGateway,
      scheduleConsolidation: (agentId) => maintenanceService.scheduleConsolidation(agentId),
      syncWorkingMemoryAfterMutation: (agentId) =>
        this.workingMemory.syncWorkingMemoryAfterMutation(agentId),
      triggerEmbedding: (agentId) => this.embedding.processPendingEmbeddings(agentId)
    })

    maintenanceService = new MaintenanceService({
      ctx: this.runtime,
      repository,
      policy,
      textGeneration: providerGateway,
      auditReader: deps.auditRepository,
      auditMaintenance: deps.auditRepository,
      rows: this.rows,
      queryNeighborsByMemoryId: (agentId, embedding, dimensions, memoryId, topK) =>
        this.vectorStore.queryNeighborsByMemoryId(agentId, embedding, dimensions, memoryId, topK),
      getReadyCertificateDimension: (agentId, embedding) =>
        this.vectorStore.getReadyCertificateDimension(agentId, embedding),
      deletePrunableVectorsForMemoryIds: (agentId, embedding, dimensions, memoryIds) =>
        this.vectorStore.deletePrunableVectorsForMemoryIds(
          agentId,
          embedding,
          dimensions,
          memoryIds
        ),
      syncWorkingMemoryAfterMutation: (agentId) =>
        this.workingMemory.syncWorkingMemoryAfterMutation(agentId),
      triggerEmbedding: (agentId) => this.embedding.processPendingEmbeddings(agentId),
      warmVectorStore: (agentId, embedding) => this.embedding.warmVectorStore(agentId, embedding),
      warmEmbeddingConnection: (agentId, embedding) =>
        this.embedding.warmEmbeddingConnection(agentId, embedding),
      maybeReflect: (agentId, model, budget) =>
        this.reflection.runMaintenanceReflectionPass(agentId, model, undefined, budget),
      maybeEvolvePersona: (agentId, model, budget) =>
        this.persona.runMaintenancePersonaPass(agentId, model, undefined, budget),
      runChallengeResolutionPass: (agentId, model, budget) =>
        this.conflict.runChallengeResolutionPass(agentId, model, budget),
      repairConflictIntegrity: (agentId) => {
        const result = this.conflict.repairConflictIntegrity(agentId)
        return Object.values(result).some((count) => count > 0)
      },
      runConsolidationPass: (agentId) => this.runConsolidationPass(agentId),
      diagnostics: this.diagnostics
    })
    this.maintenance = maintenanceService

    this.writeCoordinator = new WriteCoordinator({
      ctx: this.runtime,
      repository,
      policy,
      textGeneration: providerGateway,
      rows: this.rows,
      retrieveForDecision: (agentId, query, now) =>
        this.retrieval.retrieveForDecision(agentId, query, now),
      retrieveForDecisions: (agentId, candidates, now, queryVectors, pinnedIdsByCandidate) =>
        this.retrieval.retrieveForDecisions(
          agentId,
          candidates,
          now,
          queryVectors,
          pinnedIdsByCandidate
        ),
      markWorkingMemoryDirty: (agentId) => this.workingMemory.markWorkingMemoryDirty(agentId),
      triggerEmbedding: (agentId) => this.embedding.processPendingEmbeddings(agentId),
      scheduleConsolidation: (agentId) => this.maintenance.scheduleConsolidation(agentId),
      diagnostics: this.diagnostics
    })

    this.management = new ManagementService({
      ctx: this.runtime,
      repository,
      policy,
      auditReader: deps.auditRepository,
      rows: this.rows,
      deleteVectorsForDeletedMemory: (agentId, memoryIds, embedding) =>
        this.vectorStore.deleteVectorsForMemoryIdsOpening(agentId, memoryIds, {
          embeddingModel: embedding.embeddingModel,
          embeddingDim: embedding.embeddingDim
        }),
      resetAgentStore: (agentId) => this.vectorStore.resetAgentStore(agentId),
      isReindexing: (agentId) => this.embedding.isReindexing(agentId),
      reindexEmbeddings: (agentId, force) => this.reindexEmbeddings(agentId, force),
      syncWorkingMemoryAfterMutation: (agentId) =>
        this.workingMemory.syncWorkingMemoryAfterMutation(agentId),
      triggerEmbedding: (agentId) => this.embedding.processPendingEmbeddings(agentId),
      clearConsolidationCooldown: (agentId) => this.maintenance.clearCooldown(agentId),
      getRuntimeDiagnostics: (agentId) => this.diagnostics.snapshot(agentId)
    })
  }

  startBackgroundMaintenance(): void {
    this.maintenance.startBackgroundMaintenance()
  }

  stopBackgroundMaintenance(): void {
    this.maintenance.stopBackgroundMaintenance()
  }

  warmActiveAgents(): void {
    this.maintenance.warmActiveAgents()
  }

  isEnabled(agentId: string): boolean {
    return this.runtime.canReadAgentMemory(agentId)
  }

  canReindex(agentId: string): boolean {
    return this.runtime.canContinueAgentMemoryTask(agentId)
  }

  writeMemoriesSync(candidates: MemoryCandidate[], options: WriteMemoriesOptions): string[] {
    return this.writeCoordinator.writeMemoriesSync(candidates, options)
  }

  processPendingEmbeddings(agentId: string, limit = 50): Promise<void> {
    return this.embedding.processPendingEmbeddings(agentId, limit)
  }

  observeExtractionQueue(depth: number, oldestQueuedAt: number | null): void {
    if (this.runtime.isDisposed) return
    this.diagnostics.observeExtractionQueue(depth, oldestQueuedAt)
  }

  reindexEmbeddings(agentId: string, force = false): Promise<void> {
    return this.embedding.reindexEmbeddings(agentId, force)
  }

  isReindexing(agentId: string): boolean {
    return this.embedding.isReindexing(agentId)
  }

  backfillEmbeddings(agentId: string): Promise<void> {
    return this.embedding.backfillEmbeddings(agentId)
  }

  async extractAndStore(input: MemoryExtractionInput): Promise<MemoryExtractionResult> {
    return this.writeCoordinator.extractAndStore(input)
  }

  onAgentMemoryMaintenanceConfigChanged(agentId: string, delayMs?: number): void {
    const embedding = this.policy.resolveAgentConfig(agentId)?.memoryEmbedding
    const identityChanged = this.vectorStore.noteEmbeddingConfig(
      agentId,
      embedding?.providerId && embedding?.modelId
        ? { providerId: embedding.providerId, modelId: embedding.modelId }
        : null
    )
    if (identityChanged) this.runtime.invalidateAgentOperations(agentId)
    this.maintenance.onAgentMemoryMaintenanceConfigChanged(agentId, delayMs)
  }

  onBuiltinDeepChatMemoryMaintenanceConfigChanged(): void {
    const embedding = this.policy.resolveAgentConfig(BUILTIN_DEEPCHAT_AGENT_ID)?.memoryEmbedding
    const identityChanged = this.vectorStore.noteEmbeddingConfig(
      BUILTIN_DEEPCHAT_AGENT_ID,
      embedding?.providerId && embedding?.modelId
        ? { providerId: embedding.providerId, modelId: embedding.modelId }
        : null
    )
    if (identityChanged) this.runtime.invalidateAgentOperations(BUILTIN_DEEPCHAT_AGENT_ID)
    this.maintenance.onBuiltinDeepChatMemoryMaintenanceConfigChanged()
  }

  async runConsolidationPass(agentId: string, now: number = Date.now()): Promise<void> {
    return this.maintenance.runConsolidationPass(agentId, now)
  }

  archiveStale(agentId: string, now: number = Date.now()): number {
    return this.maintenance.archiveStale(agentId, now)
  }

  restoreMemory(agentId: string, memoryId: string): boolean {
    return this.management.restoreMemory(agentId, memoryId)
  }

  async forgetMemory(agentId: string, memoryId: string): Promise<boolean> {
    return this.management.forgetMemory(agentId, memoryId)
  }

  async archiveUserMemory(agentId: string, memoryId: string): Promise<boolean> {
    return this.management.archiveUserMemory(agentId, memoryId)
  }

  listConflicts(agentId: string): MemoryConflictPair[] {
    return this.conflict.listConflicts(agentId)
  }

  async resolveConflict(
    agentId: string,
    challengerId: string,
    outcome: MemoryConflictResolution,
    actorType: 'scheduler' | 'user' = 'user',
    model?: { providerId: string; modelId: string } | null
  ): Promise<boolean> {
    return this.conflict.resolveConflict(agentId, challengerId, outcome, actorType, model)
  }

  async rememberMemory(
    candidate: MemoryCandidate,
    options: WriteMemoriesOptions,
    model?: { providerId: string; modelId: string } | null
  ): Promise<MemoryWriteOutcome> {
    if (unicodeCodePointLength(candidate.content) > AGENT_MEMORY_MANUAL_CONTENT_MAX_CHARS) {
      return { action: 'noop', reason: 'content-too-large' }
    }
    return this.writeCoordinator.rememberMemory(candidate, options, model)
  }

  async recall(agentId: string, query: string, now = Date.now()): Promise<MemoryRecallItem[]> {
    return this.retrieval.recall(agentId, query, now)
  }

  async searchMemories(
    agentId: string,
    query: string,
    options: { limit?: number } = {}
  ): Promise<MemorySearchHit[]> {
    return this.retrieval.searchMemories(agentId, query, options)
  }

  async addUserMemory(
    agentId: string,
    input: {
      content: string
      kind?: 'episodic' | 'semantic'
      category?: string | null
      importance?: number
    },
    sessionId?: string | null
  ): Promise<MemoryWriteOutcome> {
    this.runtime.assertSafeAgentId(agentId)
    if (unicodeCodePointLength(input.content) > AGENT_MEMORY_MANUAL_CONTENT_MAX_CHARS) {
      return { action: 'noop', reason: 'content-too-large' }
    }
    return this.writeCoordinator.addUserMemory(agentId, input, sessionId)
  }

  updateMemory(
    agentId: string,
    memoryId: string,
    patch: {
      content?: string
      category?: string | null
      importance?: number
    }
  ): MemoryUpdateResult {
    return this.management.updateMemory(agentId, memoryId, patch)
  }

  async buildInjection(agentId: string, query: string): Promise<MemoryInjectionResult | null> {
    return this.retrieval.buildInjection(agentId, query)
  }

  recordInjectionAccess(
    agentId: string,
    memoryIds: string[],
    accessedAt: number = Date.now()
  ): void {
    if (!this.runtime.canReadAgentMemory(agentId)) return
    const uniqueIds = [...new Set(memoryIds.map((id) => id.trim()).filter(Boolean))]
    if (!uniqueIds.length) return
    const ownedIds = this.repository.listByIds(agentId, uniqueIds).map((row) => row.id)
    if (!ownedIds.length) return
    this.repository.recordAccessBatch(ownedIds, accessedAt)
  }

  refreshWorkingMemory(agentId: string): void {
    this.workingMemory.refreshWorkingMemory(agentId)
  }

  async maybeReflect(
    agentId: string,
    model: { providerId: string; modelId: string },
    sourceSession?: string | null
  ): Promise<MemoryReflectionResult | null> {
    return this.reflection.maybeReflect(agentId, model, sourceSession)
  }

  evolvePersona(agentId: string, content: string, sourceSession?: string | null): string | null {
    return this.persona.evolvePersona(agentId, content, sourceSession)
  }

  async maybeEvolvePersona(
    agentId: string,
    model: { providerId: string; modelId: string },
    sourceSession?: string | null
  ): Promise<MemoryPersonaDraftResult | null> {
    return this.persona.maybeEvolvePersona(agentId, model, sourceSession)
  }

  async approvePersonaDraft(agentId: string, draftId: string): Promise<boolean> {
    return this.persona.approvePersonaDraft(agentId, draftId)
  }

  async rejectPersonaDraft(agentId: string, draftId: string): Promise<boolean> {
    return this.persona.rejectPersonaDraft(agentId, draftId)
  }

  async setPersonaAnchor(agentId: string, versionId: string, anchored: boolean): Promise<boolean> {
    return this.persona.setPersonaAnchor(agentId, versionId, anchored)
  }

  listPersonaVersions(agentId: string): AgentMemoryRow[] {
    return this.persona.listPersonaVersions(agentId)
  }

  listPersonaDrafts(agentId: string): { row: AgentMemoryRow; needsReview: boolean }[] {
    return this.persona.listPersonaDrafts(agentId)
  }

  async rollbackPersona(agentId: string, versionId: string): Promise<boolean> {
    return this.persona.rollbackPersona(agentId, versionId)
  }

  /** @deprecated Use pageMemories for bounded management reads. */
  listMemories(agentId: string): AgentMemoryRow[] {
    return this.management.listMemories(agentId)
  }

  pageMemories(agentId: string, cursor: { createdAt: number; id: string } | null, limit: number) {
    return this.management.pageMemories(agentId, cursor, limit)
  }

  getByIds(agentId: string, memoryIds: string[]): AgentMemoryRow[] {
    return this.management.getByIds(agentId, memoryIds)
  }

  getManagementVisibleByIds(agentId: string, memoryIds: string[]): AgentMemoryRow[] {
    return this.management.getManagementVisibleByIds(agentId, memoryIds)
  }

  getLifecycle(agentId: string, memoryId: string): MemoryLifecycle | null {
    return this.management.getLifecycle(agentId, memoryId)
  }

  getArchiveCandidateLifecyclePreview(agentId: string): MemoryArchiveCandidateLifecyclePreview {
    return this.management.getArchiveCandidateLifecyclePreview(agentId)
  }

  getHealth(agentId: string): MemoryHealthDto {
    return this.management.getHealth(agentId)
  }

  async deleteMemory(agentId: string, memoryId: string): Promise<boolean> {
    return this.management.deleteMemory(agentId, memoryId)
  }

  async clearMemories(agentId: string): Promise<number> {
    return (await this.clearMemoriesWithCleanup(agentId)).removed
  }

  async clearMemoriesWithCleanup(agentId: string): Promise<MemoryClearResult> {
    try {
      const cleared = await this.management.clearMemories(agentId)
      this.diagnostics.cleanupAgent(agentId)
      return cleared
    } catch (error) {
      if (error instanceof VectorStoreQuarantineMarkerError) {
        this.diagnostics.cleanupAgent(agentId)
      }
      throw error
    }
  }

  async cleanupDeletedAgentResources(agentId: string): Promise<DeletedAgentMemoryCleanupResult> {
    if (this.runtime.isDisposed) return { cleanupPendingRestart: false }
    this.runtime.assertSafeAgentId(agentId)
    this.runtime.invalidateAgentOperations(agentId)
    this.maintenance.clearPrewarmTimer(agentId)
    let resetError: unknown
    let cleanupPendingRestart = false
    try {
      cleanupPendingRestart =
        (await this.vectorStore.retireAgentStore(agentId)) === 'pending-restart'
    } catch (error) {
      resetError = error
    } finally {
      this.maintenance.cleanupAgent(agentId)
      this.reflection.cleanupAgent(agentId)
      this.workingMemory.cleanupAgent(agentId)
      this.retrieval.cleanupAgent(agentId)
      if (cleanupPendingRestart || this.vectorStore.isQuarantined(agentId)) {
        this.embedding.abandonAgent(agentId)
      } else {
        await this.embedding.cleanupAgent(agentId)
      }
      await this.vectorStore.settleAgent(agentId)
      await this.persona.cleanupAgent(agentId)
      this.runtime.cleanupAgent(agentId)
      this.diagnostics.cleanupAgent(agentId)
    }
    if (resetError) throw resetError
    return { cleanupPendingRestart }
  }

  getStatus(agentId: string): MemoryStatus {
    return this.management.getStatus(agentId)
  }

  async dispose(): Promise<void> {
    this.runtime.markDisposed()
    this.runtime.abortProviderRequests()
    this.maintenance.prepareDispose()
    this.vectorStore.stopAdmission()
    const drain = (async () => {
      for (let i = 0; i < REINDEX_MAX_BATCHES; i += 1) {
        const inflight = [...this.maintenance.getInFlight(), ...this.embedding.getInFlight()]
        if (!inflight.length) break
        await Promise.allSettled(inflight)
      }
      this.maintenance.clearInFlight()
      await Promise.allSettled(this.vectorStore.getLockInFlight())
      await this.vectorStore.closeAllStores()
    })()
    void drain.catch(() => undefined)
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      drain,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 5_000)
        if (typeof timer.unref === 'function') timer.unref()
      })
    ])
    if (timer) clearTimeout(timer)
    this.embedding.clearAll()
    this.retrieval.clearAll()
    this.workingMemory.clearAll()
    this.runtime.clearRuntimeState()
    this.diagnostics.clear()
  }
}
