import logger from '@shared/logger'
import { unicodeCodePointLength } from '@shared/lib/unicodeText'
import {
  AGENT_MEMORY_AUTO_CONTENT_MAX_CHARS,
  isAgentMemoryCategory
} from '@shared/types/agent-memory'
import { normalizeMemoryCandidate } from '../core/candidates'
import {
  ADD_DECISION,
  buildDecisionPrompt,
  parseDecision,
  type MemoryDecision
} from '../core/decision'
import { estimateTokens } from '../core/injectionPort'
import { MaintenanceBudget } from '../core/maintenanceBudget'
import {
  buildScopedMemoryProvenanceKey,
  distanceToSimilarity,
  normalizeForProvenanceV2
} from '../core/scoring'
import { memoryScopeFromRow, rowsShareMemoryScope } from '../core/scope'
import {
  evaluateNormalizedMemoryTemporalPolicy,
  resolveMergedClaimTemporalMetadata,
  temporalMetadataFromRow
} from '../core/temporal'
import {
  embeddingFingerprint,
  isUniqueConstraintError,
  type MemoryModelRef,
  type MemoryOperationFence,
  type MemoryRuntimeContext
} from '../context'
import type {
  MemoryAgentPolicyPort,
  MemoryDirtyRepositoryPort,
  MemoryEmbeddingRepositoryPort,
  MemoryLifecycleRepositoryPort,
  MemoryLineageRepositoryPort,
  MemoryMaintenanceRowMutationPort,
  MemoryMutationRepositoryPort,
  MemoryReadRepositoryPort,
  MemoryTextGenerationPort,
  MemoryTransactionPort
} from '../ports'
import {
  CONSOLIDATION_DIRTY_SEED_LIMIT,
  CONSOLIDATION_MERGE_SIMILARITY,
  DECISION_NEIGHBOR_TOP_S,
  MAINTENANCE_MAX_INPUT_TOKENS,
  SCOPE_VECTOR_OVERSAMPLE_MULTIPLIER
} from '../runtimeConstants'
import type { AgentMemoryRow, MemoryDirtySeed, MemoryMaintenanceStepResult } from '../types'

class MaintenanceRevisionConflictError extends Error {}
class MaintenanceClaimSuppressedError extends Error {}

export function isLiveDirtyConsolidationRow(
  agentId: string,
  row: AgentMemoryRow | undefined
): row is AgentMemoryRow {
  return (
    !!row &&
    row.agent_id === agentId &&
    (row.kind === 'episodic' || row.kind === 'semantic' || row.kind === 'reflection') &&
    row.lifecycle_state === 'active' &&
    row.superseded_by === null
  )
}

export class MergeService {
  private readonly ctx: MemoryRuntimeContext

  constructor(
    private readonly ports: {
      ctx: MemoryRuntimeContext
      repository: MemoryReadRepositoryPort &
        MemoryMutationRepositoryPort &
        MemoryEmbeddingRepositoryPort &
        MemoryLifecycleRepositoryPort &
        MemoryLineageRepositoryPort &
        MemoryDirtyRepositoryPort &
        MemoryTransactionPort
      policy: MemoryAgentPolicyPort
      textGeneration: MemoryTextGenerationPort
      rows: MemoryMaintenanceRowMutationPort
      queryNeighborsByMemoryId: (
        agentId: string,
        embedding: MemoryModelRef,
        dimensions: number,
        memoryId: string,
        topK: number
      ) => Promise<Array<{ memoryId: string; distance: number }>>
      syncWorkingMemoryAfterMutation: (agentId: string) => void
      triggerEmbedding: (agentId: string) => Promise<void>
      warmVectorStore: (agentId: string, embedding: MemoryModelRef) => Promise<void>
    }
  ) {
    this.ctx = ports.ctx
  }
  async mergeNearDuplicates(
    agentId: string,
    now: number,
    model: MemoryModelRef,
    operationFence: MemoryOperationFence,
    budget: MaintenanceBudget
  ): Promise<MemoryMaintenanceStepResult> {
    const result: MemoryMaintenanceStepResult = { touched: false, calls: 0, failures: 0 }
    try {
      const queuedSeeds = this.ports.repository.listDirtySeeds(
        agentId,
        CONSOLIDATION_DIRTY_SEED_LIMIT
      )
      if (!queuedSeeds.length) return result
      const terminalSeeds = queuedSeeds.filter((seed) => this.isTerminalDirtySeed(agentId, seed))
      if (terminalSeeds.length) {
        this.ports.repository.settleDirtySeeds(agentId, terminalSeeds)
      }
      const terminalMemoryIds = new Set(terminalSeeds.map((seed) => seed.memoryId))
      const dirtySeeds = queuedSeeds.filter((seed) => !terminalMemoryIds.has(seed.memoryId))
      if (!dirtySeeds.length) return result

      const embedding = this.ports.policy.resolveAgentConfig(agentId)?.memoryEmbedding
      if (!embedding?.providerId || !embedding?.modelId) return result
      const currentEmbedding = { providerId: embedding.providerId, modelId: embedding.modelId }
      const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
      const dimensions = this.ports.repository.getCurrentEmbeddingDimension(agentId, fingerprint)
      if (dimensions === null) {
        this.ports.repository.deferDirtySeeds(agentId, dirtySeeds, now)
        return result
      }
      await this.ports.warmVectorStore(agentId, currentEmbedding)
      if (!this.ctx.canContinueOperation(operationFence)) return result

      const seedsByMemoryId = new Map(dirtySeeds.map((seed) => [seed.memoryId, seed]))
      const settledSeeds = new Map<string, MemoryDirtySeed>()
      const deferredSeeds = new Map<string, MemoryDirtySeed>()
      const processedMemoryIds = new Set<string>()
      const settleSeed = (seed: MemoryDirtySeed): void => {
        deferredSeeds.delete(seed.memoryId)
        settledSeeds.set(seed.memoryId, seed)
      }
      const settleSeedForMemory = (memoryId: string): void => {
        const seed = seedsByMemoryId.get(memoryId)
        if (seed) settleSeed(seed)
      }
      const deferSeed = (seed: MemoryDirtySeed): void => {
        if (!settledSeeds.has(seed.memoryId)) deferredSeeds.set(seed.memoryId, seed)
      }

      for (const seed of dirtySeeds) {
        // A fenced pass must not issue another decision request after its
        // in-flight one was aborted.
        if (!this.ctx.canContinueOperation(operationFence)) return result
        if (budget.snapshot().inputTokens >= MAINTENANCE_MAX_INPUT_TOKENS) break
        if (processedMemoryIds.has(seed.memoryId)) {
          settleSeed(seed)
          continue
        }
        const source = this.ports.repository.getById(seed.memoryId)
        if (!isLiveDirtyConsolidationRow(agentId, source)) {
          settleSeed(seed)
          continue
        }
        if (source.decision_revision !== seed.claimRevision) {
          settleSeed(seed)
          continue
        }
        if (!this.isCurrentEmbeddedConsolidationRow(agentId, source, dimensions, fingerprint)) {
          deferSeed(seed)
          continue
        }

        let matches: Array<{ memoryId: string; distance: number }> = []
        try {
          matches = await this.ports.queryNeighborsByMemoryId(
            agentId,
            currentEmbedding,
            dimensions,
            source.id,
            DECISION_NEIGHBOR_TOP_S * SCOPE_VECTOR_OVERSAMPLE_MULTIPLIER
          )
        } catch {
          deferSeed(seed)
          continue
        }
        if (!this.ctx.canContinueOperation(operationFence)) return result
        let neighbor: AgentMemoryRow | null = null
        for (const match of matches) {
          if (match.memoryId === source.id || processedMemoryIds.has(match.memoryId)) continue
          if (distanceToSimilarity(match.distance) < CONSOLIDATION_MERGE_SIMILARITY) continue
          const neighborRow = this.ports.repository.getById(match.memoryId)
          if (
            !this.isCurrentEmbeddedConsolidationRow(
              agentId,
              neighborRow,
              dimensions,
              fingerprint
            ) ||
            !rowsShareMemoryScope(source, neighborRow)
          )
            continue
          neighbor = neighborRow
          break
        }
        if (!neighbor) {
          settleSeed(seed)
          continue
        }

        const sourceSnapshot = { ...source }
        const neighborSnapshot = { ...neighbor }
        const promptCandidate = normalizeMemoryCandidate({
          kind: sourceSnapshot.kind === 'episodic' ? 'episodic' : 'semantic',
          category: sourceSnapshot.category,
          content: sourceSnapshot.content,
          importance: sourceSnapshot.importance,
          temporal: temporalMetadataFromRow(sourceSnapshot)
        })
        if (!promptCandidate) {
          settleSeed(seed)
          continue
        }
        const estimatedPromptTokens =
          estimateTokens(sourceSnapshot.content) + estimateTokens(neighborSnapshot.content) + 256
        if (estimatedPromptTokens > MAINTENANCE_MAX_INPUT_TOKENS) {
          settleSeed(seed)
          continue
        }
        if (estimatedPromptTokens > MAINTENANCE_MAX_INPUT_TOKENS - budget.snapshot().inputTokens)
          break
        const prompt = buildDecisionPrompt(
          promptCandidate,
          [
            {
              content: neighborSnapshot.content,
              temporalAnnotation:
                evaluateNormalizedMemoryTemporalPolicy(
                  temporalMetadataFromRow(neighborSnapshot),
                  now,
                  'evidence'
                ).annotation ?? undefined
            }
          ],
          {
            candidateTemporalAnnotation:
              evaluateNormalizedMemoryTemporalPolicy(promptCandidate.temporal, now, 'evidence')
                .annotation ?? undefined
          }
        )
        const promptTokens = estimateTokens(prompt)
        if (promptTokens > MAINTENANCE_MAX_INPUT_TOKENS) {
          settleSeed(seed)
          continue
        }
        if (promptTokens > MAINTENANCE_MAX_INPUT_TOKENS - budget.snapshot().inputTokens) break
        if (!budget.reserve('merge', promptTokens)) break
        result.calls += 1
        let decision: MemoryDecision = ADD_DECISION
        try {
          const raw = await this.ports.textGeneration.generateText(
            agentId,
            model.providerId,
            model.modelId,
            prompt,
            'maintenance'
          )
          decision = parseDecision(raw, 1)
        } catch (error) {
          result.failures += 1
          logger.warn(`[Memory] consolidation decision failed: ${String(error)}`)
          deferSeed(seed)
          continue
        }
        if (!this.ctx.canContinueOperation(operationFence)) return result

        if (
          decision.mergedContent !== null &&
          unicodeCodePointLength(decision.mergedContent) > AGENT_MEMORY_AUTO_CONTENT_MAX_CHARS
        ) {
          decision = ADD_DECISION
        }
        processedMemoryIds.add(sourceSnapshot.id)
        processedMemoryIds.add(neighborSnapshot.id)
        settleSeed(seed)
        settleSeedForMemory(neighborSnapshot.id)
        if (decision.decision === 'UPDATE' || decision.decision === 'SUPERSEDE') {
          const [primary, secondary] =
            sourceSnapshot.created_at >= neighborSnapshot.created_at
              ? [sourceSnapshot, neighborSnapshot]
              : [neighborSnapshot, sourceSnapshot]
          const mergedContent = decision.mergedContent ?? primary.content
          const applied = this.applyMaintenanceMerge(
            agentId,
            primary,
            secondary,
            mergedContent,
            now
          )
          if (applied) {
            result.touched = true
          }
        }
        this.ports.repository.setLastConsolidatedAt(source.id, now)
      }
      if (!this.ctx.canContinueOperation(operationFence)) return result
      this.ports.repository.runInTransaction(() => {
        this.ports.repository.settleDirtySeeds(agentId, [...settledSeeds.values()])
        this.ports.repository.deferDirtySeeds(agentId, [...deferredSeeds.values()], now)
      })
      return result
    } catch (error) {
      logger.warn(`[Memory] consolidation merge scan aborted for ${agentId}: ${String(error)}`)
      return result
    }
  }

  private applyMaintenanceMerge(
    agentId: string,
    primary: AgentMemoryRow,
    secondary: AgentMemoryRow,
    mergedContent: string,
    now: number
  ): boolean {
    if (!rowsShareMemoryScope(primary, secondary)) return false
    const scope = memoryScopeFromRow(primary)
    const owner = this.ports.rows.resolveProvenance(agentId, primary.kind, mergedContent, scope)
    if (owner && owner.id !== primary.id && owner.id !== secondary.id) {
      this.ports.repository.setLastConsolidatedAt(primary.id, now)
      this.ports.repository.setLastConsolidatedAt(secondary.id, now)
      return false
    }

    const survivor = owner?.id === secondary.id ? secondary : primary
    const retired = survivor.id === primary.id ? secondary : primary
    const otherCategory = isAgentMemoryCategory(retired.category) ? retired.category : null
    const nextCategory =
      survivor.kind === 'episodic' || survivor.kind === 'semantic'
        ? (survivor.category ?? otherCategory)
        : undefined
    const provenanceKey = buildScopedMemoryProvenanceKey(
      agentId,
      survivor.kind,
      mergedContent,
      scope
    )
    const normalizedMergedContent = normalizeForProvenanceV2(mergedContent)
    const nextTemporal = resolveMergedClaimTemporalMetadata(
      temporalMetadataFromRow(survivor),
      temporalMetadataFromRow(retired),
      {
        existing: normalizedMergedContent === normalizeForProvenanceV2(survivor.content),
        incoming: normalizedMergedContent === normalizeForProvenanceV2(retired.content)
      }
    )

    try {
      this.ports.repository.runInTransaction(() => {
        const contentApplied = this.ports.repository.updateUserContentAndInvalidateEmbedding({
          agentId,
          id: survivor.id,
          expectedRevision: survivor.decision_revision,
          content: mergedContent,
          provenanceKey,
          at: now,
          category: nextCategory,
          importance: Math.max(survivor.importance, retired.importance),
          temporal: nextTemporal
        })
        if (contentApplied.action === 'suppressed') {
          throw new MaintenanceClaimSuppressedError()
        }
        if (
          !this.ports.repository.markSupersededIfRevision(
            agentId,
            retired.id,
            retired.decision_revision,
            survivor.id
          )
        ) {
          throw new MaintenanceRevisionConflictError()
        }
        this.ports.rows.bumpConfidence(survivor.id)
        this.ports.repository.insertDerivations([
          {
            agentId,
            parentMemoryId: retired.id,
            childMemoryId: survivor.id,
            derivationKind: 'merge',
            createdAt: now
          }
        ])
      })
    } catch (error) {
      if (
        error instanceof MaintenanceRevisionConflictError ||
        error instanceof MaintenanceClaimSuppressedError ||
        isUniqueConstraintError(error)
      ) {
        return false
      }
      throw error
    }

    this.ctx.markDomainMutationCommitted(agentId)
    this.ports.syncWorkingMemoryAfterMutation(agentId)
    void this.ports.triggerEmbedding(agentId).catch((error) => {
      logger.warn(`[Memory] background embedding failed: ${String(error)}`)
    })
    this.ctx.emitChanged(agentId, 'extract')
    return true
  }

  private isLiveConsolidationNeighbor(
    agentId: string,
    row: AgentMemoryRow | undefined
  ): row is AgentMemoryRow {
    return (
      !!row &&
      row.agent_id === agentId &&
      !row.superseded_by &&
      row.kind !== 'persona' &&
      row.kind !== 'working' &&
      row.lifecycle_state === 'active'
    )
  }

  private isCurrentEmbeddedConsolidationRow(
    agentId: string,
    row: AgentMemoryRow | undefined,
    dimensions: number,
    fingerprint: string
  ): row is AgentMemoryRow {
    return (
      this.isLiveConsolidationNeighbor(agentId, row) &&
      row.lifecycle_state === 'active' &&
      row.embedding_state === 'ready' &&
      row.embedding_dim === dimensions &&
      row.embedding_model === fingerprint
    )
  }

  private isTerminalDirtySeed(agentId: string, seed: MemoryDirtySeed): boolean {
    return !isLiveDirtyConsolidationRow(agentId, this.ports.repository.getById(seed.memoryId))
  }
}
