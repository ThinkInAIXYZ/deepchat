import logger from '@shared/logger'
import { AGENT_MEMORY_AUTO_CONTENT_MAX_CHARS } from '@shared/types/agent-memory'
import { unicodeCodePointLength } from '@shared/lib/unicodeText'

import {
  ADD_DECISION,
  buildDecisionPrompt,
  parseDecisionResult,
  type MemoryDecision
} from '../core/decision'
import {
  DECISION_BATCH_MAX_BATCHES,
  parseBatchDecisionResults,
  partitionBatchDecisions,
  type BatchDecisionInput
} from '../core/batchDecision'
import { normalizeMemoryCandidate } from '../core/candidates'
import {
  buildExtractionPrompt,
  buildTriagePrompt,
  parseMemoryCandidates,
  parseTriageDecision
} from '../core/extraction'
import { buildMemoryProvenanceKey, normalizeForProvenanceV2 } from '../core/scoring'
import {
  DECISION_NEIGHBOR_TOP_S,
  DECISION_RETRY_MAX_CANDIDATES,
  MEMORY_CREATED_IDS_EVENT_LIMIT
} from '../runtimeConstants'
import type {
  AgentMemoryRow,
  MemoryCandidate,
  MemoryExtractionInput,
  MemoryExtractionResult,
  MemoryDecisionNeighborSet,
  MemoryDecisionQueryVectorSnapshot,
  MemoryRecallItem,
  NormalizedMemoryCandidate,
  MemoryUpdateContext,
  MemoryWriteOutcome,
  WriteMemoriesOptions
} from '../types'
import {
  type MemoryModelRef,
  type MemoryOperationFence,
  type MemoryRuntimeContext
} from '../context'
import type {
  MemoryAgentPolicyPort,
  MemoryEmbeddingRepositoryPort,
  MemoryMutationRepositoryPort,
  MemoryReadRepositoryPort,
  MemoryTextGenerationPort,
  MemoryTransactionPort,
  MemoryWriteMutationPort
} from '../ports'

function createdIdsFromOutcome(outcome: MemoryWriteOutcome): string[] {
  switch (outcome.action) {
    case 'created':
      return [outcome.id]
    case 'superseded':
      return outcome.created === false ? [] : [outcome.id]
    case 'challenged':
      return [outcome.challengerId]
    default:
      return []
  }
}

function chipCreatedIdsFromOutcomes(outcomes: MemoryWriteOutcome[]): string[] {
  const referencedIds = new Set<string>()
  for (const outcome of outcomes) {
    if (outcome.action === 'superseded') {
      referencedIds.add(outcome.supersededId)
    } else if (outcome.action === 'challenged') {
      referencedIds.add(outcome.targetId)
    }
  }

  return outcomes
    .filter((outcome): outcome is Extract<MemoryWriteOutcome, { action: 'created' }> => {
      return outcome.action === 'created' && !referencedIds.has(outcome.id)
    })
    .map((outcome) => outcome.id)
}

function outcomeTouched(outcome: MemoryWriteOutcome): boolean {
  return outcome.action !== 'noop'
}

function userAddAuditFromOutcome(outcome: MemoryWriteOutcome): {
  status: 'completed' | 'skipped'
  reason: string | null
  outputRefs: Record<string, unknown>
} {
  switch (outcome.action) {
    case 'created':
      return {
        status: 'completed',
        reason: null,
        outputRefs: { action: 'created', memoryId: outcome.id }
      }
    case 'updated':
      return {
        status: 'completed',
        reason: null,
        outputRefs: { action: 'updated', memoryId: outcome.id }
      }
    case 'superseded':
      return {
        status: 'completed',
        reason: null,
        outputRefs: {
          action: 'superseded',
          memoryId: outcome.id,
          supersededId: outcome.supersededId
        }
      }
    case 'challenged':
      return {
        status: 'completed',
        reason: 'challenged',
        outputRefs: {
          action: 'challenged',
          memoryId: outcome.challengerId,
          conflictWith: outcome.targetId
        }
      }
    case 'noop':
      return { status: 'skipped', reason: outcome.reason, outputRefs: { action: 'noop' } }
  }
}

function isLiveDecisionTarget(
  agentId: string,
  row: AgentMemoryRow | undefined
): row is AgentMemoryRow {
  return (
    !!row &&
    row.agent_id === agentId &&
    row.superseded_by === null &&
    row.status !== 'archived' &&
    row.status !== 'conflicted' &&
    row.conflict_state === null
  )
}

class DecisionRevisionConflictError extends Error {}
class DecisionInsertCollisionError extends Error {}

type CoordinateWriteResult = MemoryWriteOutcome | { action: 'retry' }

interface IndexedCandidate {
  candidateIndex: number
  candidate: NormalizedMemoryCandidate
}

interface PreparedCoordinateCandidate extends IndexedCandidate {
  provenanceKey: string
  decisionHeadId: string | null
  neighbors: MemoryRecallItem[]
  queryVector?: MemoryDecisionQueryVectorSnapshot
}

type PrepareCoordinateCandidateResult =
  | { prepared: PreparedCoordinateCandidate }
  | {
      candidateIndex: number
      candidate: NormalizedMemoryCandidate
      outcome: MemoryWriteOutcome
    }

interface BatchWriteResult {
  outcomes: MemoryWriteOutcome[]
  decisionBudgetFallbacks: number
  failed: boolean
}

interface CandidateApplyPolicy {
  isRetry: boolean
  allowInsert: boolean
  invalidDecisionFallback: 'add' | 'concurrent-update'
  retryConflict: boolean
}

function recallItemFromRow(row: AgentMemoryRow): MemoryRecallItem {
  return {
    id: row.id,
    decisionRevision: row.decision_revision,
    kind: row.kind,
    content: row.content,
    score: 1,
    importance: row.importance,
    sources: { fts: true },
    sourceSession: row.source_session,
    sourceEntryIds: null,
    breakdown: {
      similarity: 0,
      recency: row.last_accessed ?? row.created_at,
      importance: row.importance,
      confidence: row.confidence ?? 0,
      rrf: 1,
      final: 1
    }
  }
}

export class WriteCoordinator {
  private readonly ctx: MemoryRuntimeContext

  constructor(
    private readonly ports: {
      ctx: MemoryRuntimeContext
      repository: MemoryReadRepositoryPort &
        MemoryMutationRepositoryPort &
        MemoryEmbeddingRepositoryPort &
        MemoryTransactionPort
      policy: MemoryAgentPolicyPort
      textGeneration: MemoryTextGenerationPort
      rows: MemoryWriteMutationPort
      retrieveForDecision: (
        agentId: string,
        query: string,
        now: number
      ) => Promise<MemoryRecallItem[]>
      retrieveForDecisions: (
        agentId: string,
        candidates: readonly NormalizedMemoryCandidate[],
        now: number,
        queryVectors?: readonly (MemoryDecisionQueryVectorSnapshot | undefined)[],
        pinnedIdsByCandidate?: readonly (readonly string[] | undefined)[]
      ) => Promise<MemoryDecisionNeighborSet[]>
      markWorkingMemoryDirty: (agentId: string) => void
      triggerEmbedding: (agentId: string) => Promise<void>
      scheduleConsolidation: (agentId: string) => void
    }
  ) {
    this.ctx = ports.ctx
  }

  writeMemoriesSync(candidates: MemoryCandidate[], options: WriteMemoriesOptions): string[] {
    if (!candidates.length) return []
    const created: string[] = []
    for (const candidate of candidates) {
      const normalized = normalizeMemoryCandidate(candidate)
      if (!normalized) continue
      const content = normalized.content
      const provenanceKey = buildMemoryProvenanceKey(options.agentId, normalized.kind, content)
      const duplicate = this.ports.rows.resolveProvenance(options.agentId, normalized.kind, content)
      if (duplicate) {
        const hit = this.ports.rows.handleProvenanceHit(options.agentId, duplicate)
        if (hit.action === 'absorbed') {
          this.absorbArchivedProvenanceOwner(duplicate)
          created.push(duplicate.id)
        }
        continue
      }
      const id = this.ports.rows.insertMemory(
        options.agentId,
        normalized,
        content,
        provenanceKey,
        options
      )
      if (id) created.push(id)
    }
    if (created.length > 0) this.ctx.markDomainMutationCommitted(options.agentId)
    return created
  }

  async extractAndStore(input: MemoryExtractionInput): Promise<MemoryExtractionResult> {
    const span = input.spanText.trim()
    if (!span) return { ok: true, createdIds: [] }
    if (!this.ctx.canWriteAgentMemory(input.agentId)) return { ok: false }
    if (this.ctx.isDisposed) return { ok: false }
    const operationFence = this.ctx.captureOperationFence(input.agentId)
    const model = this.ctx.resolveExtractionModel(input.agentId, input.model)
    const createdIds: string[] = []
    const outcomes: MemoryWriteOutcome[] = []
    let touched = false
    try {
      let shouldExtract = true
      try {
        const triage = await this.ports.textGeneration.generateText(
          input.agentId,
          model.providerId,
          model.modelId,
          buildTriagePrompt(span),
          'extraction'
        )
        shouldExtract = parseTriageDecision(triage)
      } catch (error) {
        logger.warn(`[Memory] triage skipped, extracting anyway: ${String(error)}`)
      }
      if (!this.ctx.canContinueOperation(operationFence)) return { ok: false }
      if (!shouldExtract) return { ok: true, createdIds: [] }

      const response = await this.ports.textGeneration.generateText(
        input.agentId,
        model.providerId,
        model.modelId,
        buildExtractionPrompt(span),
        'extraction'
      )
      if (!this.ctx.canContinueOperation(operationFence)) return { ok: false }
      const parsed = parseMemoryCandidates(response)
      if (!parsed.ok) {
        logger.warn(`[Memory] extraction parse failed: ${parsed.reason}`)
        return { ok: false }
      }
      const candidateStats = this.prepareExtractionCandidates(parsed.candidates)
      const options: WriteMemoriesOptions = {
        agentId: input.agentId,
        sourceSession: input.sourceSession ?? null,
        sourceEntryIds: input.sourceEntryIds ?? null
      }
      const now = Date.now()
      const batch = await this.coordinateBatchWrites(
        input.agentId,
        candidateStats.candidates,
        model,
        options,
        now,
        operationFence
      )
      for (const outcome of batch.outcomes) {
        if (this.ctx.isOperationGenerationCurrent(operationFence)) {
          outcomes.push(outcome)
          createdIds.push(...createdIdsFromOutcome(outcome))
          if (outcomeTouched(outcome)) {
            this.ctx.markDomainMutationCommitted(input.agentId)
            this.ports.markWorkingMemoryDirty(input.agentId)
            touched = true
          }
        }
      }
      if (this.ctx.isOperationGenerationCurrent(operationFence)) {
        this.writeExtractionAudit(input, model, {
          parsedCount: parsed.candidates.length,
          acceptedCount: candidateStats.candidates.length,
          duplicateCandidateIndexes: candidateStats.duplicateCandidateIndexes,
          rejectedCandidates: candidateStats.rejectedCandidates,
          decisionBudgetFallbacks: batch.decisionBudgetFallbacks,
          failed: batch.failed
        })
      }
      // If a non-empty extraction is disabled mid-batch, keep the cursor for retry; any rows
      // already written are picked up by the next embedding/backfill drain.
      if (batch.failed) return { ok: false }
      if (!this.ctx.canContinueOperation(operationFence)) return { ok: false }
      return { ok: true, createdIds }
    } catch (error) {
      logger.warn(`[Memory] extraction failed: ${String(error)}`)
      return { ok: false }
    } finally {
      if (touched && this.ctx.isOperationGenerationCurrent(operationFence)) {
        this.finalizeCommittedExtraction(input, outcomes)
      }
    }
  }

  private prepareExtractionCandidates(candidates: readonly MemoryCandidate[]): {
    candidates: IndexedCandidate[]
    duplicateCandidateIndexes: number[]
    rejectedCandidates: Array<{ candidateIndex: number; reason: 'candidate-too-large' }>
  } {
    const accepted: IndexedCandidate[] = []
    const duplicateCandidateIndexes: number[] = []
    const rejectedCandidates: Array<{
      candidateIndex: number
      reason: 'candidate-too-large'
    }> = []
    const seen = new Set<string>()
    candidates.forEach((candidate, candidateIndex) => {
      const normalized = normalizeMemoryCandidate(candidate)
      if (!normalized) return
      if (unicodeCodePointLength(normalized.content) > AGENT_MEMORY_AUTO_CONTENT_MAX_CHARS) {
        rejectedCandidates.push({ candidateIndex, reason: 'candidate-too-large' })
        return
      }
      const key = `${normalized.kind}\0${normalizeForProvenanceV2(normalized.content)}`
      if (seen.has(key)) {
        duplicateCandidateIndexes.push(candidateIndex)
        return
      }
      seen.add(key)
      accepted.push({ candidateIndex, candidate: normalized })
    })
    return { candidates: accepted, duplicateCandidateIndexes, rejectedCandidates }
  }

  private writeExtractionAudit(
    input: MemoryExtractionInput,
    model: MemoryModelRef,
    summary: {
      parsedCount: number
      acceptedCount: number
      duplicateCandidateIndexes: number[]
      rejectedCandidates: Array<{ candidateIndex: number; reason: 'candidate-too-large' }>
      decisionBudgetFallbacks: number
      failed: boolean
    }
  ): void {
    this.ctx.writeAudit(input.agentId, {
      eventType: 'memory/extract',
      actorType: 'runtime',
      status: summary.failed ? 'failed' : 'completed',
      reason: summary.failed ? 'partial-apply-failed' : null,
      inputRefs: {
        parsedCount: summary.parsedCount,
        acceptedCount: summary.acceptedCount
      },
      outputRefs: {
        duplicateCandidateIndexes: summary.duplicateCandidateIndexes,
        rejectedCandidates: summary.rejectedCandidates,
        decisionBudgetFallbacks: summary.decisionBudgetFallbacks
      },
      model,
      sessionId: input.sourceSession ?? null
    })
  }

  private prepareCoordinateCandidate(
    agentId: string,
    indexed: IndexedCandidate
  ): PrepareCoordinateCandidateResult {
    const content = indexed.candidate.content
    const provenanceKey = buildMemoryProvenanceKey(agentId, indexed.candidate.kind, content)
    const duplicate = this.ports.rows.resolveProvenance(agentId, indexed.candidate.kind, content)
    let decisionHeadId: string | null = null
    if (duplicate) {
      const hit = this.ports.rows.handleProvenanceHit(agentId, duplicate, {
        allowDecisionForSuperseded: true
      })
      if (hit.action === 'absorbed') {
        return {
          candidateIndex: indexed.candidateIndex,
          candidate: indexed.candidate,
          outcome: { action: 'updated', id: duplicate.id }
        }
      }
      if (hit.action === 'noop') {
        return {
          candidateIndex: indexed.candidateIndex,
          candidate: indexed.candidate,
          outcome: { action: 'noop', reason: hit.reason, id: duplicate.id }
        }
      }
      const head = this.ports.rows.supersedeHead(agentId, duplicate)
      if (isLiveDecisionTarget(agentId, head)) decisionHeadId = head.id
    }
    return {
      prepared: {
        ...indexed,
        provenanceKey,
        decisionHeadId,
        neighbors: []
      }
    }
  }

  private applyImmediatePrepared(
    agentId: string,
    result: PrepareCoordinateCandidateResult,
    options: WriteMemoriesOptions,
    now: number,
    allowInsert: boolean
  ): MemoryWriteOutcome {
    if ('prepared' in result) throw new Error('Expected an immediate candidate result')
    return this.applyCurrentProvenanceOrInsert(agentId, result.candidate, options, now, allowInsert)
  }

  private applyCurrentProvenanceOrInsert(
    agentId: string,
    candidate: NormalizedMemoryCandidate,
    options: WriteMemoriesOptions,
    now: number,
    allowInsert: boolean
  ): MemoryWriteOutcome {
    let outcome: MemoryWriteOutcome = { action: 'noop', reason: 'concurrent-update' }
    this.ports.repository.runInTransaction(() => {
      const owner = this.ports.rows.resolveProvenance(agentId, candidate.kind, candidate.content)
      if (owner) {
        const hit = this.ports.rows.handleProvenanceHit(agentId, owner, {
          allowDecisionForSuperseded: true
        })
        if (hit.action === 'absorbed') {
          outcome = this.ports.repository.activateForEmbeddingIfRevision(
            agentId,
            owner.id,
            owner.decision_revision
          )
            ? { action: 'updated', id: owner.id }
            : { action: 'noop', reason: 'concurrent-update' }
          return
        }
        if (hit.action === 'noop') {
          outcome = { action: 'noop', reason: hit.reason, id: owner.id }
          return
        }
        outcome = this.reviveProvenanceOwner(agentId, owner, now, candidate.category)
        return
      }
      if (!allowInsert) return
      const provenanceKey = buildMemoryProvenanceKey(agentId, candidate.kind, candidate.content)
      const id = this.ports.rows.insertMemory(
        agentId,
        candidate,
        candidate.content,
        provenanceKey,
        options
      )
      outcome = id ? { action: 'created', id } : { action: 'noop', reason: 'insert-skipped' }
    })
    return outcome
  }

  private applyNoNeighborDecision(
    agentId: string,
    prepared: PreparedCoordinateCandidate,
    options: WriteMemoriesOptions,
    now: number,
    isRetry: boolean
  ): MemoryWriteOutcome {
    if (isRetry) return { action: 'noop', reason: 'concurrent-update' }
    return this.applyCurrentProvenanceOrInsert(agentId, prepared.candidate, options, now, true)
  }

  private applyPreparedCandidate(
    agentId: string,
    preparedResult: PrepareCoordinateCandidateResult,
    retrieved: PreparedCoordinateCandidate | undefined,
    parsed: { decision: MemoryDecision; valid: boolean } | undefined,
    options: WriteMemoriesOptions,
    now: number,
    policy: CandidateApplyPolicy
  ): CoordinateWriteResult {
    if (!('prepared' in preparedResult)) {
      return this.applyImmediatePrepared(agentId, preparedResult, options, now, policy.allowInsert)
    }
    const prepared = retrieved ?? preparedResult.prepared
    if (!prepared.neighbors.length) {
      return this.applyNoNeighborDecision(agentId, prepared, options, now, policy.isRetry)
    }
    if (!parsed?.valid && policy.invalidDecisionFallback === 'concurrent-update') {
      return { action: 'noop', reason: 'concurrent-update' }
    }
    const result = this.applyDecisionAttempt(
      agentId,
      prepared.candidate,
      prepared.neighbors,
      parsed?.valid ? parsed.decision : ADD_DECISION,
      options,
      now,
      prepared.provenanceKey
    )
    if (result.action === 'retry' && !policy.retryConflict) {
      return { action: 'noop', reason: 'concurrent-update' }
    }
    return result
  }

  private async retrievePreparedCandidates(
    agentId: string,
    prepared: readonly PreparedCoordinateCandidate[],
    now: number,
    queryVectors?: readonly (MemoryDecisionQueryVectorSnapshot | undefined)[]
  ): Promise<PreparedCoordinateCandidate[]> {
    if (!prepared.length) return []
    try {
      const sets = await this.ports.retrieveForDecisions(
        agentId,
        prepared.map((item) => item.candidate),
        now,
        queryVectors,
        prepared.map((item) => (item.decisionHeadId ? [item.decisionHeadId] : undefined))
      )
      return prepared.map((item, index) => ({
        ...item,
        neighbors: [...(sets[index]?.neighbors ?? [])].slice(0, DECISION_NEIGHBOR_TOP_S),
        queryVector: sets[index]?.queryVector
      }))
    } catch (error) {
      logger.warn(`[Memory] batch decision neighbor recall failed, adding: ${String(error)}`)
      return prepared.map((item) => ({ ...item, neighbors: [], queryVector: undefined }))
    }
  }

  private async requestBatchDecisions(
    agentId: string,
    model: MemoryModelRef,
    inputs: readonly BatchDecisionInput[],
    maxBatches: number,
    operationFence: MemoryOperationFence
  ): Promise<{
    decisions: Map<number, { decision: MemoryDecision; valid: boolean }>
    fallbackCandidateIndexes: Set<number>
  }> {
    const partitioned = partitionBatchDecisions(inputs)
    const decisions = new Map<number, { decision: MemoryDecision; valid: boolean }>()
    const fallbackCandidateIndexes = new Set(partitioned.fallbackCandidateIndexes)
    const partitions = partitioned.partitions.slice(0, maxBatches)
    for (const skipped of partitioned.partitions.slice(maxBatches)) {
      skipped.inputs.forEach((input) => fallbackCandidateIndexes.add(input.candidateIndex))
    }
    for (const partition of partitions) {
      if (!this.ctx.canContinueOperation(operationFence)) break
      try {
        const raw = await this.ports.textGeneration.generateText(
          agentId,
          model.providerId,
          model.modelId,
          partition.prompt,
          'decision'
        )
        if (!this.ctx.canContinueOperation(operationFence)) break
        for (const [candidateIndex, result] of parseBatchDecisionResults(raw, partition.inputs)) {
          decisions.set(candidateIndex, { decision: result.decision, valid: result.valid })
        }
      } catch (error) {
        if (!this.ctx.canContinueOperation(operationFence)) break
        logger.warn(`[Memory] batch decision model failed: ${String(error)}`)
      }
    }
    return { decisions, fallbackCandidateIndexes }
  }

  private async coordinateBatchWrites(
    agentId: string,
    candidates: readonly IndexedCandidate[],
    model: MemoryModelRef,
    options: WriteMemoriesOptions,
    now: number,
    operationFence: MemoryOperationFence
  ): Promise<BatchWriteResult> {
    if (!candidates.length) return { outcomes: [], decisionBudgetFallbacks: 0, failed: false }

    const preparation = candidates.map((candidate) =>
      this.prepareCoordinateCandidate(agentId, candidate)
    )
    const preparationByIndex = new Map(
      preparation.map((result) => [
        'prepared' in result ? result.prepared.candidateIndex : result.candidateIndex,
        result
      ])
    )
    const preparedInitial = await this.retrievePreparedCandidates(
      agentId,
      preparation.flatMap((result) => ('prepared' in result ? [result.prepared] : [])),
      now
    )
    const preparedByIndex = new Map(
      preparedInitial.map((prepared) => [prepared.candidateIndex, prepared])
    )
    const initialDecisionInputs: BatchDecisionInput[] = preparedInitial
      .filter((prepared) => prepared.neighbors.length > 0)
      .map((prepared) => ({
        candidateIndex: prepared.candidateIndex,
        candidate: prepared.candidate,
        neighbors: prepared.neighbors
      }))
    const initialBatch = await this.requestBatchDecisions(
      agentId,
      model,
      initialDecisionInputs,
      DECISION_BATCH_MAX_BATCHES,
      operationFence
    )

    const outcomesByIndex = new Map<number, MemoryWriteOutcome>()
    const retryCandidates: PreparedCoordinateCandidate[] = []
    let failed = false
    for (const candidate of candidates) {
      if (!this.ctx.canContinueOperation(operationFence)) break
      try {
        const preparedResult = preparationByIndex.get(candidate.candidateIndex)
        if (!preparedResult) continue
        const result = this.applyPreparedCandidate(
          agentId,
          preparedResult,
          preparedByIndex.get(candidate.candidateIndex),
          initialBatch.decisions.get(candidate.candidateIndex),
          options,
          now,
          {
            isRetry: false,
            allowInsert: true,
            invalidDecisionFallback: 'add',
            retryConflict: true
          }
        )
        if (result.action === 'retry') {
          const retryCandidate =
            preparedByIndex.get(candidate.candidateIndex) ??
            ('prepared' in preparedResult ? preparedResult.prepared : null)
          if (retryCandidate) retryCandidates.push(retryCandidate)
          else {
            outcomesByIndex.set(candidate.candidateIndex, {
              action: 'noop',
              reason: 'concurrent-update'
            })
          }
        } else outcomesByIndex.set(candidate.candidateIndex, result)
      } catch (error) {
        logger.warn(`[Memory] candidate apply failed: ${String(error)}`)
        failed = true
        break
      }
    }

    const retrySlice = retryCandidates.slice(0, DECISION_RETRY_MAX_CANDIDATES)
    for (const skipped of retryCandidates.slice(DECISION_RETRY_MAX_CANDIDATES)) {
      outcomesByIndex.set(skipped.candidateIndex, {
        action: 'noop',
        reason: 'concurrent-update'
      })
    }
    const currentEmbedding = this.ports.policy.resolveAgentConfig(agentId)?.memoryEmbedding
    const retryEligible = retrySlice.filter((candidate) => {
      const snapshot = candidate.queryVector
      const valid =
        !snapshot ||
        (snapshot.providerId === currentEmbedding?.providerId &&
          snapshot.modelId === currentEmbedding?.modelId &&
          snapshot.dimensions === snapshot.vector.length)
      if (!valid) {
        outcomesByIndex.set(candidate.candidateIndex, {
          action: 'noop',
          reason: 'concurrent-update'
        })
      }
      return valid
    })
    if (!failed && retryEligible.length && this.ctx.canContinueOperation(operationFence)) {
      const retryPreparation = retryEligible.map((candidate) =>
        this.prepareCoordinateCandidate(agentId, {
          candidateIndex: candidate.candidateIndex,
          candidate: candidate.candidate
        })
      )
      const retryPreparationByIndex = new Map(
        retryPreparation.map((result) => [
          'prepared' in result ? result.prepared.candidateIndex : result.candidateIndex,
          result
        ])
      )
      const retryPreparedBase = retryPreparation.flatMap((result) =>
        'prepared' in result ? [result.prepared] : []
      )
      const oldVectors = new Map(
        retryEligible.map((candidate) => [candidate.candidateIndex, candidate.queryVector])
      )
      const retryPrepared = await this.retrievePreparedCandidates(
        agentId,
        retryPreparedBase,
        now,
        retryPreparedBase.map((candidate) => oldVectors.get(candidate.candidateIndex))
      )
      const retryByIndex = new Map(retryPrepared.map((item) => [item.candidateIndex, item]))
      const retryInputs: BatchDecisionInput[] = retryPrepared
        .filter((candidate) => candidate.neighbors.length > 0)
        .map((candidate) => ({
          candidateIndex: candidate.candidateIndex,
          candidate: candidate.candidate,
          neighbors: candidate.neighbors
        }))
      const retryBatch = await this.requestBatchDecisions(
        agentId,
        model,
        retryInputs,
        1,
        operationFence
      )

      for (const original of retryEligible) {
        if (!this.ctx.canContinueOperation(operationFence)) break
        try {
          const preparedResult = retryPreparationByIndex.get(original.candidateIndex)
          if (!preparedResult) continue
          const retryResult = this.applyPreparedCandidate(
            agentId,
            preparedResult,
            retryByIndex.get(original.candidateIndex),
            retryBatch.decisions.get(original.candidateIndex),
            options,
            now,
            {
              isRetry: true,
              allowInsert: false,
              invalidDecisionFallback: 'concurrent-update',
              retryConflict: false
            }
          )
          outcomesByIndex.set(
            original.candidateIndex,
            retryResult.action === 'retry'
              ? { action: 'noop', reason: 'concurrent-update' }
              : retryResult
          )
        } catch (error) {
          logger.warn(`[Memory] candidate retry apply failed: ${String(error)}`)
          failed = true
          break
        }
      }
    }

    return {
      outcomes: candidates.flatMap((candidate) => {
        const outcome = outcomesByIndex.get(candidate.candidateIndex)
        return outcome ? [outcome] : []
      }),
      decisionBudgetFallbacks: initialBatch.fallbackCandidateIndexes.size,
      failed
    }
  }

  private finalizeCommittedExtraction(
    input: MemoryExtractionInput,
    outcomes: MemoryWriteOutcome[]
  ): void {
    const chipCreatedIds = chipCreatedIdsFromOutcomes(outcomes)
    const updateContext: MemoryUpdateContext = {}
    if (input.sourceSession) updateContext.sessionId = input.sourceSession
    if (chipCreatedIds.length > 0) {
      updateContext.createdIds = chipCreatedIds.slice(0, MEMORY_CREATED_IDS_EVENT_LIMIT)
    }
    this.ctx.emitChanged(
      input.agentId,
      'extract',
      Object.keys(updateContext).length > 0 ? updateContext : undefined
    )
    void this.ports.triggerEmbedding(input.agentId).catch((error) => {
      logger.warn(`[Memory] background embedding failed: ${String(error)}`)
    })
    this.ports.scheduleConsolidation(input.agentId)
  }

  private async coordinateWrite(
    agentId: string,
    candidate: MemoryCandidate,
    model: MemoryModelRef,
    options: WriteMemoriesOptions,
    now: number,
    operationFence: MemoryOperationFence
  ): Promise<MemoryWriteOutcome> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await this.coordinateWriteAttempt(
        agentId,
        candidate,
        model,
        options,
        now,
        operationFence,
        attempt > 0
      )
      if (result.action !== 'retry') return result
    }
    return { action: 'noop', reason: 'concurrent-update' }
  }

  private async coordinateWriteAttempt(
    agentId: string,
    candidate: MemoryCandidate,
    model: MemoryModelRef,
    options: WriteMemoriesOptions,
    now: number,
    operationFence: MemoryOperationFence,
    isRetry: boolean
  ): Promise<CoordinateWriteResult> {
    const normalized = normalizeMemoryCandidate(candidate)
    if (!normalized) return { action: 'noop', reason: 'empty' }
    const content = normalized.content
    if (!this.ctx.canContinueOperation(operationFence)) {
      return { action: 'noop', reason: 'disposed' }
    }

    const provenanceKey = buildMemoryProvenanceKey(agentId, normalized.kind, content)
    const duplicate = this.ports.rows.resolveProvenance(agentId, normalized.kind, content)
    let decisionHead: AgentMemoryRow | null = null
    if (duplicate) {
      const hit = this.ports.rows.handleProvenanceHit(agentId, duplicate, {
        allowDecisionForSuperseded: true
      })
      if (hit.action === 'absorbed') {
        this.absorbArchivedProvenanceOwner(duplicate)
        return { action: 'updated', id: duplicate.id }
      }
      if (hit.action === 'noop') return { action: 'noop', reason: hit.reason, id: duplicate.id }
      const head = this.ports.rows.supersedeHead(agentId, duplicate)
      if (isLiveDecisionTarget(agentId, head)) decisionHead = head
    }

    let neighbors: MemoryRecallItem[] = []
    try {
      const hits = await this.ports.retrieveForDecision(agentId, content, now)
      neighbors = hits.slice(0, DECISION_NEIGHBOR_TOP_S)
      const currentDecisionHead = decisionHead
        ? this.ports.repository.getById(decisionHead.id)
        : undefined
      if (
        isLiveDecisionTarget(agentId, currentDecisionHead) &&
        !neighbors.some((neighbor) => neighbor.id === currentDecisionHead.id)
      ) {
        neighbors.unshift(recallItemFromRow(currentDecisionHead))
        neighbors = neighbors.slice(0, DECISION_NEIGHBOR_TOP_S)
      }
    } catch (error) {
      logger.warn(`[Memory] decision neighbor recall failed, adding: ${String(error)}`)
    }
    if (!this.ctx.canContinueOperation(operationFence)) {
      return { action: 'noop', reason: 'disposed' }
    }
    if (!neighbors.length) {
      if (isRetry) return { action: 'noop', reason: 'concurrent-update' }
      return this.applyCurrentProvenanceOrInsert(agentId, normalized, options, now, true)
    }

    let decision: MemoryDecision = ADD_DECISION
    try {
      const raw = await this.ports.textGeneration.generateText(
        agentId,
        model.providerId,
        model.modelId,
        buildDecisionPrompt(
          normalized,
          neighbors.map((neighbor) => ({ content: neighbor.content }))
        ),
        'decision'
      )
      const parsed = parseDecisionResult(raw, neighbors.length)
      const valid =
        parsed.valid &&
        (parsed.decision.mergedContent === null ||
          unicodeCodePointLength(parsed.decision.mergedContent) <=
            AGENT_MEMORY_AUTO_CONTENT_MAX_CHARS)
      if (isRetry && !valid) {
        return { action: 'noop', reason: 'concurrent-update' }
      }
      decision = valid ? parsed.decision : ADD_DECISION
    } catch (error) {
      if (isRetry) {
        logger.warn(`[Memory] decision retry failed: ${String(error)}`)
        return { action: 'noop', reason: 'concurrent-update' }
      }
      logger.warn(`[Memory] decision model failed, adding: ${String(error)}`)
    }
    if (!this.ctx.canContinueOperation(operationFence)) {
      return { action: 'noop', reason: 'disposed' }
    }

    return this.applyDecisionAttempt(
      agentId,
      normalized,
      neighbors,
      decision,
      options,
      now,
      provenanceKey
    )
  }

  private applyDecisionAttempt(
    agentId: string,
    normalized: NormalizedMemoryCandidate,
    neighbors: readonly MemoryRecallItem[],
    decision: MemoryDecision,
    options: WriteMemoriesOptions,
    now: number,
    provenanceKey: string
  ): CoordinateWriteResult {
    const content = normalized.content
    const target = decision.targetIndex !== null ? neighbors[decision.targetIndex] : null
    switch (decision.decision) {
      case 'NOOP':
        return { action: 'noop', reason: 'decision-noop', id: target?.id }
      case 'UPDATE':
        if (target) {
          const targetRow = this.ports.repository.getById(target.id)
          if (isLiveDecisionTarget(agentId, targetRow)) {
            const merged = decision.mergedContent ?? content
            const mergedKey = buildMemoryProvenanceKey(agentId, targetRow.kind, merged)
            const owner = this.ports.rows.resolveProvenance(agentId, targetRow.kind, merged)
            if (owner && owner.id !== targetRow.id) {
              const folded = this.foldDecisionTargetIntoOwner(
                agentId,
                target,
                owner,
                now,
                normalized.category
              )
              if (folded.action !== 'superseded') return folded
              return { action: 'updated', id: folded.id }
            }
            const nextCategory =
              targetRow.kind === 'episodic' || targetRow.kind === 'semantic'
                ? (targetRow.category ?? normalized.category ?? null)
                : undefined
            try {
              this.ports.repository.runInTransaction(() => {
                const applied = this.ports.repository.updateDecisionContentIfRevision({
                  agentId,
                  id: targetRow.id,
                  expectedRevision: target.decisionRevision,
                  content: merged,
                  provenanceKey: mergedKey,
                  at: now,
                  category: nextCategory
                })
                if (!applied) throw new DecisionRevisionConflictError()
                this.ports.rows.bumpConfidence(targetRow.id)
              })
            } catch (error) {
              if (error instanceof DecisionRevisionConflictError) return { action: 'retry' }
              throw error
            }
            return { action: 'updated', id: targetRow.id }
          }
          return { action: 'retry' }
        }
        break
      case 'SUPERSEDE':
        if (target) {
          const targetRow = this.ports.repository.getById(target.id)
          if (!isLiveDecisionTarget(agentId, targetRow)) return { action: 'retry' }
          const merged = decision.mergedContent ?? content
          const mergedKey = buildMemoryProvenanceKey(agentId, normalized.kind, merged)
          const collisionOwner = this.ports.rows.resolveProvenance(agentId, normalized.kind, merged)
          if (collisionOwner && collisionOwner.id !== target.id) {
            return this.foldDecisionTargetIntoOwner(
              agentId,
              target,
              collisionOwner,
              now,
              normalized.category
            )
          }
          let newId: string | null = null
          try {
            this.ports.repository.runInTransaction(() => {
              newId = this.ports.rows.insertMemory(agentId, normalized, merged, mergedKey, options)
              if (!newId) throw new DecisionInsertCollisionError()
              if (
                !this.ports.repository.markSupersededIfRevision(
                  agentId,
                  target.id,
                  target.decisionRevision,
                  newId
                )
              ) {
                throw new DecisionRevisionConflictError()
              }
            })
          } catch (error) {
            if (error instanceof DecisionInsertCollisionError) {
              const owner = this.ports.rows.resolveProvenance(agentId, normalized.kind, merged)
              return owner && owner.id !== target.id
                ? this.foldDecisionTargetIntoOwner(agentId, target, owner, now, normalized.category)
                : { action: 'retry' }
            }
            if (error instanceof DecisionRevisionConflictError) return { action: 'retry' }
            throw error
          }
          if (newId) {
            return { action: 'superseded', id: newId, supersededId: target.id, created: true }
          }
          return { action: 'retry' }
        }
        break
      case 'CHALLENGE':
        if (target) {
          const collisionOwner = this.ports.rows.resolveProvenance(
            agentId,
            normalized.kind,
            content
          )
          if (collisionOwner && collisionOwner.id !== target.id) {
            return this.foldDecisionTargetIntoOwner(
              agentId,
              target,
              collisionOwner,
              now,
              normalized.category
            )
          }
          let challengerId: string | null = null
          try {
            this.ports.repository.runInTransaction(() => {
              challengerId = this.ports.rows.insertConflictedMemory(
                agentId,
                normalized,
                content,
                provenanceKey,
                target.id,
                options
              )
              if (!challengerId) throw new DecisionInsertCollisionError()
              if (
                !this.ports.repository.markConflictIfRevision(
                  agentId,
                  target.id,
                  target.decisionRevision,
                  'challenged'
                )
              ) {
                throw new DecisionRevisionConflictError()
              }
            })
          } catch (error) {
            if (error instanceof DecisionInsertCollisionError) {
              const owner = this.ports.rows.resolveProvenance(agentId, normalized.kind, content)
              return owner && owner.id !== target.id
                ? this.foldDecisionTargetIntoOwner(agentId, target, owner, now, normalized.category)
                : { action: 'retry' }
            }
            if (error instanceof DecisionRevisionConflictError) return { action: 'retry' }
            throw error
          }
          if (challengerId) {
            return { action: 'challenged', targetId: target.id, challengerId }
          }
          return { action: 'retry' }
        }
        break
    }
    return this.applyCurrentProvenanceOrInsert(agentId, normalized, options, now, true)
  }

  private foldDecisionTargetIntoOwner(
    agentId: string,
    target: MemoryRecallItem,
    owner: AgentMemoryRow,
    now: number,
    category: AgentMemoryRow['category']
  ): CoordinateWriteResult {
    const hit = this.ports.rows.handleProvenanceHit(agentId, owner, {
      allowDecisionForSuperseded: true
    })
    if (hit.action === 'noop' && hit.reason !== 'duplicate') {
      return { action: 'noop', reason: hit.reason, id: owner.id }
    }

    try {
      this.ports.repository.runInTransaction(() => {
        const ownerHead =
          hit.action === 'continue' ? this.ports.rows.supersedeHead(agentId, owner) : undefined
        if (
          !this.ports.repository.markSupersededIfRevision(
            agentId,
            target.id,
            target.decisionRevision,
            owner.id
          )
        ) {
          throw new DecisionRevisionConflictError()
        }
        if (hit.action === 'absorbed') {
          this.ports.repository.activateForEmbedding(owner.id)
        }
        if (hit.action === 'continue') {
          if (ownerHead?.id === target.id) {
            this.ports.repository.markSuperseded(owner.id, null)
            this.ports.repository.activateForEmbedding(owner.id)
          } else {
            this.ports.rows.reviveSupersededAfterDecision(agentId, owner)
          }
        }
        if (
          (owner.kind === 'episodic' || owner.kind === 'semantic') &&
          owner.category === null &&
          category !== null
        ) {
          this.ports.repository.updateContent(
            owner.id,
            owner.content,
            owner.provenance_key,
            now,
            category
          )
        }
      })
    } catch (error) {
      if (error instanceof DecisionRevisionConflictError) return { action: 'retry' }
      throw error
    }
    return { action: 'superseded', id: owner.id, supersededId: target.id, created: false }
  }

  async rememberMemory(
    candidate: MemoryCandidate,
    options: WriteMemoriesOptions,
    model?: MemoryModelRef | null
  ): Promise<MemoryWriteOutcome> {
    if (!this.ctx.canWriteAgentMemory(options.agentId)) {
      return { action: 'noop', reason: 'disposed' }
    }
    const resolvedModel = model ? this.ctx.resolveExtractionModel(options.agentId, model) : null
    const operationFence = this.ctx.captureOperationFence(options.agentId)
    const outcome = resolvedModel
      ? await this.coordinateWrite(
          options.agentId,
          candidate,
          resolvedModel,
          options,
          Date.now(),
          operationFence
        )
      : this.directAddMemory(options.agentId, candidate, options)
    if (outcomeTouched(outcome)) {
      this.ctx.markDomainMutationCommitted(options.agentId)
      this.ports.markWorkingMemoryDirty(options.agentId)
      this.ctx.emitChanged(options.agentId, 'extract')
      if (outcome.action !== 'challenged') {
        void this.ports.triggerEmbedding(options.agentId).catch((error) => {
          logger.warn(`[Memory] background embedding failed: ${String(error)}`)
        })
      }
      this.ports.scheduleConsolidation(options.agentId)
    }
    return outcome
  }

  private directAddMemory(
    agentId: string,
    candidate: MemoryCandidate,
    options: WriteMemoriesOptions
  ): MemoryWriteOutcome {
    const normalized = normalizeMemoryCandidate(candidate)
    if (!normalized) return { action: 'noop', reason: 'empty' }
    const content = normalized.content
    const provenanceKey = buildMemoryProvenanceKey(agentId, normalized.kind, content)
    const duplicate = this.ports.rows.resolveProvenance(agentId, normalized.kind, content)
    if (duplicate) {
      const hit = this.ports.rows.handleProvenanceHit(agentId, duplicate)
      if (hit.action === 'absorbed') {
        this.absorbArchivedProvenanceOwner(duplicate)
        return { action: 'updated', id: duplicate.id }
      }
      const reason = hit.action === 'noop' ? hit.reason : 'duplicate'
      return { action: 'noop', reason, id: duplicate.id }
    }
    const id = this.ports.rows.insertMemory(agentId, normalized, content, provenanceKey, options)
    return id ? { action: 'created', id } : { action: 'noop', reason: 'insert-skipped' }
  }

  private absorbArchivedProvenanceOwner(existing: AgentMemoryRow): void {
    this.ports.repository.runInTransaction(() => {
      this.ports.repository.activateForEmbedding(existing.id)
    })
  }

  private reviveProvenanceOwner(
    agentId: string,
    existing: AgentMemoryRow,
    now: number,
    category: AgentMemoryRow['category'],
    foldTargetId?: string
  ): MemoryWriteOutcome {
    this.ports.repository.runInTransaction(() => {
      if (existing.status === 'archived' && existing.superseded_by === null) {
        this.ports.repository.activateForEmbedding(existing.id)
      }
      this.ports.rows.reviveSupersededAfterDecision(agentId, existing)
      if (existing.category === null && category !== null) {
        this.ports.repository.updateContent(
          existing.id,
          existing.content,
          existing.provenance_key,
          now,
          category
        )
      }
      if (foldTargetId && foldTargetId !== existing.id) {
        this.ports.repository.markSuperseded(foldTargetId, existing.id)
      }
    })

    if (foldTargetId && foldTargetId !== existing.id) {
      return { action: 'superseded', id: existing.id, supersededId: foldTargetId, created: false }
    }
    return { action: 'updated', id: existing.id }
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
    this.ctx.assertSafeAgentId(agentId)
    if (!this.ctx.canWriteAgentMemory(agentId)) return { action: 'noop', reason: 'disposed' }
    const candidate: MemoryCandidate = {
      kind: input.kind ?? 'semantic',
      category: input.category,
      content: input.content,
      importance: input.importance
    }
    const configured = this.ports.policy.resolveAgentConfig(agentId)?.memoryExtractionModel
    const model =
      configured?.providerId && configured?.modelId
        ? { providerId: configured.providerId, modelId: configured.modelId }
        : null
    const outcome = await this.rememberMemory(
      candidate,
      { agentId, sourceSession: sessionId ?? null },
      model
    )
    if (!this.ctx.canWriteAgentMemory(agentId)) return outcome
    const audit = userAddAuditFromOutcome(outcome)
    this.ctx.writeAudit(agentId, {
      eventType: 'memory/add',
      actorType: 'user',
      status: audit.status,
      reason: audit.reason,
      inputRefs: {
        kind: candidate.kind,
        category: candidate.category ?? null,
        importance: candidate.importance ?? null
      },
      outputRefs: audit.outputRefs,
      model,
      sessionId: sessionId ?? null
    })
    return outcome
  }
}
