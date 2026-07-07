import {
  appendMemorySection,
  appendMemorySectionWithManifest,
  buildMemorySection,
  type MemoryInjectionPayload,
  type MemoryInjectionPort,
  type MemoryInjectionResult,
  type MemoryRuntimePort
} from './injection'
import { isSafeAgentId, type AgentMemoryRow, type IMemoryVectorStore } from './types'
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
  MemoryLifecycle
} from '@shared/contracts/routes/memory.routes'
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
import { EmbeddingPipeline } from './infra/embeddingPipeline'
import { WorkingMemoryService } from './services/workingMemoryService'
import { RetrievalService } from './services/retrievalService'
import { ReflectionService } from './services/reflectionService'
import { PersonaService } from './services/personaService'
import { ConflictService } from './services/conflictService'
import { MaintenanceService } from './services/maintenanceService'
import { WriteCoordinator } from './services/writeCoordinator'
import { ManagementService } from './services/managementService'

export { appendMemorySection, appendMemorySectionWithManifest, buildMemorySection, isSafeAgentId }
export type {
  MemoryInjectionPayload,
  MemoryInjectionPort,
  MemoryInjectionResult,
  MemoryRuntimePort
}

export class MemoryPresenter implements MemoryRuntimePort {
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

  constructor(deps: MemoryPresenterDeps) {
    let retrievalService: RetrievalService | null = null
    this.runtime = new MemoryRuntimeContext(deps, (agentId) => {
      retrievalService?.invalidateKeywordStats(agentId)
    })
    this.rows = new MemoryRowMutations(this.runtime)
    this.vectorStore = new VectorStoreManager(this.runtime)
    this.embedding = new EmbeddingPipeline(this.runtime, this.vectorStore, this.rows, {
      reindexEmbeddings: (agentId, force) => this.reindexEmbeddings(agentId, force),
      backfillEmbeddings: (agentId) => this.backfillEmbeddings(agentId)
    })
    this.workingMemory = new WorkingMemoryService(this.runtime)

    this.retrieval = new RetrievalService(this.runtime, this.vectorStore, this.workingMemory, {
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
        )
    })
    retrievalService = this.retrieval

    this.reflection = new ReflectionService(this.runtime, {
      syncWorkingMemoryAfterMutation: (agentId) =>
        this.workingMemory.syncWorkingMemoryAfterMutation(agentId),
      triggerEmbedding: (agentId) => this.embedding.processPendingEmbeddings(agentId)
    })
    this.persona = new PersonaService(this.runtime)

    // Late-bound to break the ConflictService <-> MaintenanceService workflow cycle. Constructors
    // must not call this port before the assignment below completes.
    let maintenanceService!: MaintenanceService
    this.conflict = new ConflictService(this.runtime, {
      scheduleConsolidation: (agentId) => maintenanceService.scheduleConsolidation(agentId),
      syncWorkingMemoryAfterMutation: (agentId) =>
        this.workingMemory.syncWorkingMemoryAfterMutation(agentId),
      triggerEmbedding: (agentId) => this.embedding.processPendingEmbeddings(agentId)
    })

    maintenanceService = new MaintenanceService(this.runtime, this.rows, {
      queryNeighborsByMemoryId: (agentId, embedding, dimensions, memoryId, topK) =>
        this.vectorStore.queryNeighborsByMemoryId(agentId, embedding, dimensions, memoryId, topK),
      getWarmVectorStoreDimension: (agentId, embedding) =>
        this.vectorStore.getWarmVectorStoreDimension(agentId, embedding),
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
      maybeReflect: (agentId, model) =>
        this.reflection.runMaintenanceReflectionPass(agentId, model),
      maybeEvolvePersona: (agentId, model) =>
        this.persona.runMaintenancePersonaPass(agentId, model),
      runChallengeResolutionPass: (agentId, model) =>
        this.conflict.runChallengeResolutionPass(agentId, model),
      runConsolidationPass: (agentId) => this.runConsolidationPass(agentId)
    })
    this.maintenance = maintenanceService

    this.writeCoordinator = new WriteCoordinator(this.runtime, this.rows, {
      retrieveForDecision: (agentId, query, now) =>
        this.retrieval.retrieveForDecision(agentId, query, now),
      syncWorkingMemoryAfterMutation: (agentId) =>
        this.workingMemory.syncWorkingMemoryAfterMutation(agentId),
      triggerEmbedding: (agentId) => this.embedding.processPendingEmbeddings(agentId),
      scheduleConsolidation: (agentId) => this.maintenance.scheduleConsolidation(agentId)
    })

    this.management = new ManagementService(this.runtime, {
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
      clearConsolidationCooldown: (agentId) => this.maintenance.clearCooldown(agentId)
    })

    this.retainRuntimeCompatAccessorsForTests()
  }

  // Legacy facade-oracle tests intentionally probe these private runtime accessors via casts.
  // Keep this method until those tests move to explicit service-level test helpers.
  private retainRuntimeCompatAccessorsForTests(): void {
    void this.vectorStoreReady
    void this.vectorStores
    void this.vectorStoreIdentities
    void this.vectorStoreLocks
    void this.vectorStoreWarmups
    void this.vectorStoreDimensionFailures
    void this.embeddingWarmups
    void this.embeddingDrains
    void this.reindexing
    void this.backfilling
    void this.consolidationTimers
    void this.lastConsolidationAt
    void this.reflectionAttemptWatermark
    void this.personaAttemptWatermark
    void this.personaLocks
    void this.workingRefreshInFlight
    void this.warmEmbeddingConnection
    void this.clearVectorStoreReady
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

  private get vectorStoreReady(): Map<string, string> {
    return this.vectorStore.getMutableRuntimeStateForTests().vectorStoreReady
  }

  private get vectorStores(): Map<string, Promise<IMemoryVectorStore>> {
    return this.vectorStore.getMutableRuntimeStateForTests().vectorStores
  }

  private get vectorStoreIdentities(): Map<string, string> {
    return this.vectorStore.getMutableRuntimeStateForTests().vectorStoreIdentities
  }

  private get vectorStoreLocks(): Map<string, Promise<unknown>> {
    return this.vectorStore.getMutableRuntimeStateForTests().vectorStoreLocks
  }

  private get vectorStoreWarmups(): Map<string, Promise<void>> {
    return this.embedding.getMutableRuntimeStateForTests().vectorStoreWarmups
  }

  private get vectorStoreDimensionFailures(): Map<string, number> {
    return this.embedding.getMutableRuntimeStateForTests().vectorStoreDimensionFailures
  }

  private get embeddingWarmups(): Map<string, Promise<void>> {
    return this.embedding.getMutableRuntimeStateForTests().embeddingWarmups
  }

  private get embeddingDrains(): Map<string, Promise<unknown>> {
    return this.embedding.getMutableRuntimeStateForTests().embeddingDrains
  }

  private get reindexing(): Map<string, Promise<void>> {
    return this.embedding.getMutableRuntimeStateForTests().reindexing
  }

  private get backfilling(): Map<string, Promise<void>> {
    return this.embedding.getMutableRuntimeStateForTests().backfilling
  }

  private get consolidationTimers(): Map<string, NodeJS.Timeout> {
    return this.maintenance.getMutableRuntimeStateForTests().consolidationTimers
  }

  private get lastConsolidationAt(): Map<string, number> {
    return this.maintenance.getMutableRuntimeStateForTests().lastConsolidationAt
  }

  private get reflectionAttemptWatermark(): Map<string, number> {
    return this.reflection.getMutableRuntimeStateForTests().reflectionAttemptWatermark
  }

  private get personaAttemptWatermark(): Map<string, number> {
    return this.persona.getMutableRuntimeStateForTests().personaAttemptWatermark
  }

  private get personaLocks(): Map<string, Promise<unknown>> {
    return this.persona.getMutableRuntimeStateForTests().personaLocks
  }

  private get workingRefreshInFlight(): Set<string> {
    return this.workingMemory.getMutableRuntimeStateForTests().workingRefreshInFlight
  }

  private warmEmbeddingConnection(
    agentId: string,
    embedding: { providerId: string; modelId: string }
  ): void {
    this.embedding.warmEmbeddingConnection(agentId, embedding)
  }

  private clearVectorStoreReady(agentId: string): void {
    this.vectorStore.clearReady(agentId)
  }

  isEnabled(agentId: string): boolean {
    return this.runtime.isEnabled(agentId)
  }

  canReindex(agentId: string): boolean {
    return this.runtime.canContinueAgentMemoryTask(agentId)
  }

  writeMemoriesSync(candidates: MemoryCandidate[], options: WriteMemoriesOptions): string[] {
    const ids = this.writeCoordinator.writeMemoriesSync(candidates, options)
    if (ids.length > 0) this.retrieval.invalidateKeywordStats(options.agentId)
    return ids
  }

  processPendingEmbeddings(agentId: string, limit = 50): Promise<void> {
    return this.embedding.processPendingEmbeddings(agentId, limit)
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
    this.maintenance.onAgentMemoryMaintenanceConfigChanged(agentId, delayMs)
  }

  onBuiltinDeepChatMemoryMaintenanceConfigChanged(): void {
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
    return this.writeCoordinator.addUserMemory(agentId, input, sessionId)
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
    const ownedIds = this.runtime.deps.repository.listByIds(agentId, uniqueIds).map((row) => row.id)
    if (!ownedIds.length) return
    this.runtime.deps.repository.recordAccessBatch(ownedIds, accessedAt)
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

  listMemories(agentId: string): AgentMemoryRow[] {
    return this.management.listMemories(agentId)
  }

  getByIds(agentId: string, memoryIds: string[]): AgentMemoryRow[] {
    return this.management.getByIds(agentId, memoryIds)
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
    return this.management.clearMemories(agentId)
  }

  async cleanupDeletedAgentResources(agentId: string): Promise<void> {
    if (this.runtime.isDisposed) return
    this.runtime.assertSafeAgentId(agentId)
    this.maintenance.clearPrewarmTimer(agentId)
    let resetError: unknown
    try {
      await this.vectorStore.resetAgentStore(agentId)
    } catch (error) {
      resetError = error
    } finally {
      this.maintenance.cleanupAgent(agentId)
      this.reflection.cleanupAgent(agentId)
      this.workingMemory.cleanupAgent(agentId)
      this.retrieval.cleanupAgent(agentId)
      await this.embedding.cleanupAgent(agentId)
      await this.vectorStore.closeAgentStore(agentId)
      await this.vectorStore.settleAgent(agentId)
      await this.persona.cleanupAgent(agentId)
    }
    if (resetError) throw resetError
  }

  getStatus(agentId: string): MemoryStatus {
    return this.management.getStatus(agentId)
  }

  async dispose(): Promise<void> {
    this.runtime.markDisposed()
    this.maintenance.prepareDispose()
    for (let i = 0; i < REINDEX_MAX_BATCHES; i += 1) {
      const inflight = [...this.maintenance.getInFlight(), ...this.embedding.getInFlight()]
      if (!inflight.length) break
      await Promise.allSettled(inflight)
    }
    this.maintenance.clearInFlight()
    await Promise.allSettled(this.vectorStore.getLockInFlight())
    await this.vectorStore.closeAllStores()
    this.embedding.clearAll()
    this.retrieval.clearAll()
  }
}
