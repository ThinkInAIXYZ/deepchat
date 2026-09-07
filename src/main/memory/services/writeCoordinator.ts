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
  evaluateNormalizedMemoryTemporalPolicy,
  memoryTemporalMetadataEquals,
  reconcileEquivalentClaimTemporalMetadata,
  resolveMergedClaimTemporalMetadata,
  temporalMetadataFromRow
} from '../core/temporal'
import {
  buildExtractionPrompt,
  buildTriagePrompt,
  parseMemoryCandidates,
  parseTriageDecision
} from '../core/extraction'
import { buildScopedMemoryProvenanceKey, normalizeForProvenanceV2 } from '../core/scoring'
import { AGENT_MEMORY_AGENT_SCOPE, normalizeMemoryScope, rowsShareMemoryScope } from '../core/scope'
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
  MemoryScope,
  MemoryTemporalMetadata,
  NormalizedMemoryCandidate,
  MemoryUpdateContext,
  MemoryWriteOutcome,
  WriteMemoriesOptions
} from '../types'
import type { MemoryDirectiveInput } from '../domain/directives'
import {
  type MemoryModelRef,
  type MemoryOperationFence,
  type MemoryRuntimeContext
} from '../context'
import type {
  MemoryAgentPolicyPort,
  MemoryEmbeddingRepositoryPort,
  MemoryLifecycleRepositoryPort,
  MemoryLineageRepositoryPort,
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
        outputRefs: {
          action: 'created',
          memoryId: outcome.id,
          ...(outcome.reauthorized ? { reauthorized: true } : {})
        }
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
    row.lifecycle_state === 'active' &&
    row.conflict_state === null
  )
}

function isChallengedDecisionHead(agentId: string, row: AgentMemoryRow | undefined): boolean {
  return (
    !!row &&
    row.agent_id === agentId &&
    row.lifecycle_state === 'active' &&
    row.superseded_by === null &&
    row.conflict_state === 'challenged'
  )
}

class DecisionRevisionConflictError extends Error {}
class DecisionInsertCollisionError extends Error {}
class DecisionForgottenClaimError extends Error {}

type CoordinateWriteResult = MemoryWriteOutcome | { action: 'retry' }

interface IndexedCandidate {
  candidateIndex: number
  candidate: NormalizedMemoryCandidate
}

interface PreparedCoordinateCandidate extends IndexedCandidate {
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
  llmCalls: number
  casRetries: number
}

interface CandidateApplyPolicy {
  isRetry: boolean
  allowInsert: boolean
  invalidDecisionFallback: 'add' | 'concurrent-update'
  retryConflict: boolean
}

type TombstoneReleasePolicy = 'preserve' | 'explicit-user-action'

function resolveContentMergeTemporalMetadata(
  existing: AgentMemoryRow,
  incoming: NormalizedMemoryCandidate,
  mergedContent: string
): MemoryTemporalMetadata {
  const normalizedMergedContent = normalizeForProvenanceV2(mergedContent)
  return resolveMergedClaimTemporalMetadata(temporalMetadataFromRow(existing), incoming.temporal, {
    existing: normalizedMergedContent === normalizeForProvenanceV2(existing.content),
    incoming: normalizedMergedContent === normalizeForProvenanceV2(incoming.content)
  })
}

function recallItemFromRow(row: AgentMemoryRow): MemoryRecallItem {
  const temporal = temporalMetadataFromRow(row)
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
    temporal,
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

function temporalDecisionAnnotation(
  temporal: MemoryTemporalMetadata,
  now: number
): string | undefined {
  return evaluateNormalizedMemoryTemporalPolicy(temporal, now, 'evidence').annotation ?? undefined
}

function toBatchDecisionInput(
  prepared: PreparedCoordinateCandidate,
  now: number
): BatchDecisionInput {
  return {
    candidateIndex: prepared.candidateIndex,
    candidate: prepared.candidate,
    candidateTemporalAnnotation: temporalDecisionAnnotation(prepared.candidate.temporal, now),
    neighbors: prepared.neighbors.map((neighbor) => ({
      content: neighbor.content,
      temporalAnnotation:
        neighbor.temporalAnnotation ??
        (neighbor.temporal ? temporalDecisionAnnotation(neighbor.temporal, now) : undefined)
    }))
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
        MemoryLifecycleRepositoryPort &
        MemoryLineageRepositoryPort &
        MemoryTransactionPort
      policy: MemoryAgentPolicyPort
      textGeneration: MemoryTextGenerationPort
      rows: MemoryWriteMutationPort
      retrieveForDecision: (
        agentId: string,
        query: string,
        now: number,
        scopeFilter?: readonly MemoryScope[]
      ) => Promise<MemoryRecallItem[]>
      retrieveForDecisions: (
        agentId: string,
        candidates: readonly NormalizedMemoryCandidate[],
        now: number,
        queryVectors?: readonly (MemoryDecisionQueryVectorSnapshot | undefined)[],
        pinnedIdsByCandidate?: readonly (readonly string[] | undefined)[],
        scopeFilter?: readonly MemoryScope[]
      ) => Promise<MemoryDecisionNeighborSet[]>
      markWorkingMemoryDirty: (agentId: string) => void
      triggerEmbedding: (agentId: string) => Promise<void>
      scheduleConsolidation: (agentId: string) => void
      suggestDirective: (agentId: string, input: MemoryDirectiveInput) => void
      diagnostics?: {
        recordExtraction(
          agentId: string,
          sample: {
            outcome: 'completed' | 'cancelled' | 'failed'
            llmCalls: number
            casRetries: number
          }
        ): void
      }
    }
  ) {
    this.ctx = ports.ctx
  }

  writeMemoriesSync(candidates: MemoryCandidate[], options: WriteMemoriesOptions): string[] {
    if (!candidates.length || !this.ctx.canWriteAgentMemory(options.agentId)) return []
    const created: string[] = []
    let touched = false
    const now = this.ctx.now()
    const scope = normalizeMemoryScope(options.scope)
    const normalizedOptions = { ...options, scope }
    for (const candidate of candidates) {
      const normalized = normalizeMemoryCandidate(candidate)
      if (!normalized) continue
      const content = normalized.content
      const duplicate = this.ports.rows.resolveProvenance(
        options.agentId,
        normalized.kind,
        content,
        scope
      )
      if (duplicate) {
        const hit = this.ports.rows.handleProvenanceHit(options.agentId, duplicate)
        if (hit.action === 'absorbed') {
          if (this.absorbArchivedProvenanceOwner(options.agentId, duplicate, normalized.temporal)) {
            created.push(duplicate.id)
            touched = true
          }
        } else if (
          hit.action === 'noop' &&
          hit.reason === 'duplicate' &&
          this.ports.rows.enrichEquivalentClaimTemporalMetadata(
            options.agentId,
            duplicate,
            normalized.temporal
          )
        ) {
          touched = true
        }
        continue
      }
      const insert = this.ports.rows.insertMemory(
        options.agentId,
        normalized,
        content,
        normalizedOptions,
        now
      )
      if (insert.action === 'inserted') {
        created.push(insert.id)
        touched = true
      }
    }
    if (touched) this.ctx.markDomainMutationCommitted(options.agentId)
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
    let extractionOutcome: 'completed' | 'cancelled' | 'failed' = 'failed'
    let llmCalls = 0
    let casRetries = 0
    try {
      let shouldExtract = true
      try {
        llmCalls += 1
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
      if (!this.ctx.canContinueOperation(operationFence)) {
        extractionOutcome = 'cancelled'
        return { ok: false }
      }
      if (!shouldExtract) {
        extractionOutcome = 'completed'
        return { ok: true, createdIds: [] }
      }

      const now = this.ctx.now()
      const timeZone = this.ctx.timeZone()
      llmCalls += 1
      const response = await this.ports.textGeneration.generateText(
        input.agentId,
        model.providerId,
        model.modelId,
        buildExtractionPrompt(span, { now, timeZone }),
        'extraction'
      )
      if (!this.ctx.canContinueOperation(operationFence)) {
        extractionOutcome = 'cancelled'
        return { ok: false }
      }
      const parsed = parseMemoryCandidates(response)
      if (!parsed.ok) {
        logger.warn(`[Memory] extraction parse failed: ${parsed.reason}`)
        return { ok: false }
      }
      const candidateStats = this.prepareExtractionCandidates(parsed.candidates)
      const options: WriteMemoriesOptions = {
        agentId: input.agentId,
        scope: normalizeMemoryScope(input.scope),
        sourceSession: input.sourceSession ?? null,
        sourceEntryIds: input.sourceEntryIds ?? null
      }
      const batch = await this.coordinateBatchWrites(
        input.agentId,
        candidateStats.candidates,
        model,
        options,
        now,
        operationFence
      )
      llmCalls += batch.llmCalls
      casRetries += batch.casRetries
      if (!this.ctx.canContinueOperation(operationFence)) {
        extractionOutcome = 'cancelled'
        return { ok: false }
      }
      for (const outcome of batch.outcomes) {
        outcomes.push(outcome)
        createdIds.push(...createdIdsFromOutcome(outcome))
        if (outcomeTouched(outcome)) {
          this.ctx.markDomainMutationCommitted(input.agentId)
          this.ports.markWorkingMemoryDirty(input.agentId)
          touched = true
        }
      }
      if (!batch.failed) {
        for (const suggestion of parsed.directiveSuggestions) {
          if (!this.ctx.canContinueOperation(operationFence)) {
            extractionOutcome = 'cancelled'
            break
          }
          this.ports.suggestDirective(input.agentId, suggestion)
        }
      }
      this.writeExtractionAudit(input, model, {
        parsedCount: parsed.candidates.length,
        acceptedCount: candidateStats.candidates.length,
        directiveSuggestionCount: parsed.directiveSuggestions.length,
        duplicateCandidateIndexes: candidateStats.duplicateCandidateIndexes,
        rejectedCandidates: candidateStats.rejectedCandidates,
        decisionBudgetFallbacks: batch.decisionBudgetFallbacks,
        failed: batch.failed
      })
      // If a non-empty extraction is disabled mid-batch, keep the cursor for retry; any rows
      // already written are picked up by the next embedding/backfill drain.
      if (batch.failed) return { ok: false }
      if (!this.ctx.canContinueOperation(operationFence)) {
        extractionOutcome = 'cancelled'
        return { ok: false }
      }
      extractionOutcome = 'completed'
      return { ok: true, createdIds }
    } catch (error) {
      logger.warn(`[Memory] extraction failed: ${String(error)}`)
      return { ok: false }
    } finally {
      this.ports.diagnostics?.recordExtraction(input.agentId, {
        outcome: extractionOutcome,
        llmCalls,
        casRetries
      })
      if (touched && this.ctx.canContinueOperation(operationFence)) {
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
    const acceptedIndexByKey = new Map<string, number>()
    candidates.forEach((candidate, candidateIndex) => {
      const normalized = normalizeMemoryCandidate(candidate)
      if (!normalized) return
      if (unicodeCodePointLength(normalized.content) > AGENT_MEMORY_AUTO_CONTENT_MAX_CHARS) {
        rejectedCandidates.push({ candidateIndex, reason: 'candidate-too-large' })
        return
      }
      const key = `${normalized.kind}\0${normalizeForProvenanceV2(normalized.content)}`
      const acceptedIndex = acceptedIndexByKey.get(key)
      if (acceptedIndex !== undefined) {
        duplicateCandidateIndexes.push(candidateIndex)
        const existing = accepted[acceptedIndex]
        accepted[acceptedIndex] = {
          ...existing,
          candidate: {
            ...existing.candidate,
            temporal: reconcileEquivalentClaimTemporalMetadata(
              existing.candidate.temporal,
              normalized.temporal
            )
          }
        }
        return
      }
      acceptedIndexByKey.set(key, accepted.length)
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
      directiveSuggestionCount: number
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
        acceptedCount: summary.acceptedCount,
        directiveSuggestionCount: summary.directiveSuggestionCount
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
    indexed: IndexedCandidate,
    scope: MemoryScope
  ): PrepareCoordinateCandidateResult {
    const content = indexed.candidate.content
    const duplicate = this.ports.rows.resolveProvenance(
      agentId,
      indexed.candidate.kind,
      content,
      scope
    )
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
      if (isChallengedDecisionHead(agentId, head)) {
        return {
          candidateIndex: indexed.candidateIndex,
          candidate: indexed.candidate,
          outcome: { action: 'noop', reason: 'conflict', id: head.id }
        }
      }
      if (isLiveDecisionTarget(agentId, head)) decisionHeadId = head.id
    }
    return {
      prepared: {
        ...indexed,
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
    const scope = normalizeMemoryScope(options.scope)
    let outcome: MemoryWriteOutcome = { action: 'noop', reason: 'concurrent-update' }
    this.ports.repository.runInTransaction(() => {
      const owner = this.ports.rows.resolveProvenance(
        agentId,
        candidate.kind,
        candidate.content,
        scope
      )
      if (owner) {
        const hit = this.ports.rows.handleProvenanceHit(agentId, owner, {
          allowDecisionForSuperseded: true
        })
        if (hit.action === 'absorbed') {
          const restored = this.ports.repository.restoreArchivedMemory({
            agentId,
            id: owner.id,
            expectedRevision: owner.decision_revision
          })
          if (restored) {
            const current = this.ports.repository.getById(owner.id)
            if (current) {
              this.ports.rows.enrichEquivalentClaimTemporalMetadata(
                agentId,
                current,
                candidate.temporal
              )
            }
          }
          outcome = restored
            ? { action: 'updated', id: owner.id }
            : { action: 'noop', reason: 'concurrent-update' }
          return
        }
        if (hit.action === 'noop') {
          outcome =
            hit.reason === 'duplicate' &&
            this.ports.rows.enrichEquivalentClaimTemporalMetadata(
              agentId,
              owner,
              candidate.temporal
            )
              ? { action: 'updated', id: owner.id }
              : { action: 'noop', reason: hit.reason, id: owner.id }
          return
        }
        const head = this.ports.rows.supersedeHead(agentId, owner)
        if (isChallengedDecisionHead(agentId, head)) {
          outcome = { action: 'noop', reason: 'conflict', id: head.id }
          return
        }
        outcome = this.reviveProvenanceOwner(
          agentId,
          owner,
          now,
          candidate.category,
          candidate.temporal
        )
        return
      }
      if (!allowInsert) return
      const insert = this.ports.rows.insertMemory(
        agentId,
        candidate,
        candidate.content,
        options,
        now
      )
      outcome =
        insert.action === 'inserted'
          ? { action: 'created', id: insert.id }
          : {
              action: 'noop',
              reason: insert.reason === 'forgotten' ? 'forgotten' : 'insert-skipped'
            }
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
      now
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
    scope: MemoryScope,
    queryVectors?: readonly (MemoryDecisionQueryVectorSnapshot | undefined)[]
  ): Promise<PreparedCoordinateCandidate[]> {
    if (!prepared.length) return []
    try {
      const sets = await this.ports.retrieveForDecisions(
        agentId,
        prepared.map((item) => item.candidate),
        now,
        queryVectors,
        prepared.map((item) => (item.decisionHeadId ? [item.decisionHeadId] : undefined)),
        [scope]
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
    calls: number
  }> {
    const partitioned = partitionBatchDecisions(inputs)
    const decisions = new Map<number, { decision: MemoryDecision; valid: boolean }>()
    const fallbackCandidateIndexes = new Set(partitioned.fallbackCandidateIndexes)
    let calls = 0
    const partitions = partitioned.partitions.slice(0, maxBatches)
    for (const skipped of partitioned.partitions.slice(maxBatches)) {
      skipped.inputs.forEach((input) => fallbackCandidateIndexes.add(input.candidateIndex))
    }
    for (const partition of partitions) {
      if (!this.ctx.canContinueOperation(operationFence)) break
      try {
        calls += 1
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
    return { decisions, fallbackCandidateIndexes, calls }
  }

  private async coordinateBatchWrites(
    agentId: string,
    candidates: readonly IndexedCandidate[],
    model: MemoryModelRef,
    options: WriteMemoriesOptions,
    now: number,
    operationFence: MemoryOperationFence
  ): Promise<BatchWriteResult> {
    if (!candidates.length) {
      return { outcomes: [], decisionBudgetFallbacks: 0, failed: false, llmCalls: 0, casRetries: 0 }
    }

    const scope = normalizeMemoryScope(options.scope)
    const preparation = candidates.map((candidate) =>
      this.prepareCoordinateCandidate(agentId, candidate, scope)
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
      now,
      scope
    )
    const preparedByIndex = new Map(
      preparedInitial.map((prepared) => [prepared.candidateIndex, prepared])
    )
    const initialDecisionInputs: BatchDecisionInput[] = preparedInitial
      .filter((prepared) => prepared.neighbors.length > 0)
      .map((prepared) => toBatchDecisionInput(prepared, now))
    const initialBatch = await this.requestBatchDecisions(
      agentId,
      model,
      initialDecisionInputs,
      DECISION_BATCH_MAX_BATCHES,
      operationFence
    )

    const outcomesByIndex = new Map<number, MemoryWriteOutcome>()
    const retryCandidates: PreparedCoordinateCandidate[] = []
    let decisionCalls = initialBatch.calls
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
    let casRetries = 0
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
        this.prepareCoordinateCandidate(
          agentId,
          {
            candidateIndex: candidate.candidateIndex,
            candidate: candidate.candidate
          },
          scope
        )
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
        scope,
        retryPreparedBase.map((candidate) => oldVectors.get(candidate.candidateIndex))
      )
      const retryByIndex = new Map(retryPrepared.map((item) => [item.candidateIndex, item]))
      const retryInputs: BatchDecisionInput[] = retryPrepared
        .filter((candidate) => candidate.neighbors.length > 0)
        .map((candidate) => toBatchDecisionInput(candidate, now))
      const retryBatch = await this.requestBatchDecisions(
        agentId,
        model,
        retryInputs,
        1,
        operationFence
      )
      decisionCalls += retryBatch.calls

      for (const original of retryEligible) {
        if (!this.ctx.canContinueOperation(operationFence)) break
        try {
          const preparedResult = retryPreparationByIndex.get(original.candidateIndex)
          if (!preparedResult) continue
          casRetries += 1
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
      failed,
      llmCalls: decisionCalls,
      casRetries
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
    operationFence: MemoryOperationFence,
    beforeMutation?: () => void
  ): Promise<MemoryWriteOutcome> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await this.coordinateWriteAttempt(
        agentId,
        candidate,
        model,
        options,
        now,
        operationFence,
        attempt > 0,
        beforeMutation
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
    isRetry: boolean,
    beforeMutation?: () => void
  ): Promise<CoordinateWriteResult> {
    const normalized = normalizeMemoryCandidate(candidate)
    if (!normalized) return { action: 'noop', reason: 'empty' }
    const content = normalized.content
    const scope = normalizeMemoryScope(options.scope)
    if (!this.ctx.canContinueOperation(operationFence)) {
      return { action: 'noop', reason: 'disposed' }
    }

    const duplicate = this.ports.rows.resolveProvenance(
      agentId,
      normalized.kind,
      content,
      scope,
      beforeMutation
    )
    let decisionHead: AgentMemoryRow | null = null
    if (duplicate) {
      const hit = this.ports.rows.handleProvenanceHit(agentId, duplicate, {
        allowDecisionForSuperseded: true
      })
      if (hit.action === 'absorbed') {
        return this.absorbArchivedProvenanceOwner(
          agentId,
          duplicate,
          normalized.temporal,
          beforeMutation
        )
          ? { action: 'updated', id: duplicate.id }
          : { action: 'noop', reason: 'concurrent-update', id: duplicate.id }
      }
      if (hit.action === 'noop') {
        if (
          hit.reason === 'duplicate' &&
          this.ports.rows.enrichEquivalentClaimTemporalMetadata(
            agentId,
            duplicate,
            normalized.temporal,
            beforeMutation
          )
        ) {
          return { action: 'updated', id: duplicate.id }
        }
        return { action: 'noop', reason: hit.reason, id: duplicate.id }
      }
      const head = this.ports.rows.supersedeHead(agentId, duplicate)
      if (isChallengedDecisionHead(agentId, head)) {
        return { action: 'noop', reason: 'conflict', id: head.id }
      }
      if (isLiveDecisionTarget(agentId, head)) decisionHead = head
    }

    if (
      !duplicate &&
      this.ports.repository.hasTombstoneForClaim({
        agentId,
        kind: normalized.kind,
        content,
        provenanceKey: buildScopedMemoryProvenanceKey(agentId, normalized.kind, content, scope),
        scope
      })
    ) {
      return { action: 'noop', reason: 'forgotten' }
    }

    beforeMutation?.()
    let neighbors: MemoryRecallItem[] = []
    try {
      const hits = await this.ports.retrieveForDecision(agentId, content, now, [scope])
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
          neighbors.map((neighbor) => ({
            content: neighbor.content,
            temporalAnnotation:
              neighbor.temporalAnnotation ??
              (neighbor.temporal ? temporalDecisionAnnotation(neighbor.temporal, now) : undefined)
          })),
          {
            candidateTemporalAnnotation: temporalDecisionAnnotation(normalized.temporal, now)
          }
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

    return this.applyDecisionAttempt(agentId, normalized, neighbors, decision, options, now)
  }

  private applyDecisionAttempt(
    agentId: string,
    normalized: NormalizedMemoryCandidate,
    neighbors: readonly MemoryRecallItem[],
    decision: MemoryDecision,
    options: WriteMemoriesOptions,
    now: number
  ): CoordinateWriteResult {
    const content = normalized.content
    const scope = normalizeMemoryScope(options.scope)
    const target = decision.targetIndex !== null ? neighbors[decision.targetIndex] : null
    switch (decision.decision) {
      case 'NOOP':
        return { action: 'noop', reason: 'decision-noop', id: target?.id }
      case 'UPDATE':
        if (target) {
          const targetRow = this.ports.repository.getById(target.id)
          if (
            isLiveDecisionTarget(agentId, targetRow) &&
            rowsShareMemoryScope(targetRow, {
              scope_type: scope.type,
              scope_id: scope.type === 'agent' ? null : scope.id
            })
          ) {
            const merged = decision.mergedContent ?? content
            const mergedTemporal = resolveContentMergeTemporalMetadata(
              targetRow,
              normalized,
              merged
            )
            const mergedKey = buildScopedMemoryProvenanceKey(agentId, targetRow.kind, merged, scope)
            const owner = this.ports.rows.resolveProvenance(agentId, targetRow.kind, merged, scope)
            if (owner && owner.id !== targetRow.id) {
              const folded = this.foldDecisionTargetIntoOwner(
                agentId,
                target,
                owner,
                now,
                normalized.category,
                mergedTemporal
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
                const applied = this.ports.repository.updateUserContentAndInvalidateEmbedding({
                  agentId,
                  id: targetRow.id,
                  expectedRevision: target.decisionRevision,
                  content: merged,
                  provenanceKey: mergedKey,
                  at: now,
                  category: nextCategory,
                  temporal: mergedTemporal
                })
                if (applied.action === 'suppressed') {
                  if (applied.reason === 'forgotten') throw new DecisionForgottenClaimError()
                  throw new DecisionRevisionConflictError()
                }
                this.ports.rows.bumpConfidence(targetRow.id)
              })
            } catch (error) {
              if (error instanceof DecisionForgottenClaimError) {
                return { action: 'noop', reason: 'forgotten' }
              }
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
          if (
            !isLiveDecisionTarget(agentId, targetRow) ||
            !rowsShareMemoryScope(targetRow, {
              scope_type: scope.type,
              scope_id: scope.type === 'agent' ? null : scope.id
            })
          )
            return { action: 'retry' }
          const merged = decision.mergedContent ?? content
          const mergedTemporal = resolveContentMergeTemporalMetadata(targetRow, normalized, merged)
          const mergedCandidate = { ...normalized, temporal: mergedTemporal }
          const collisionOwner = this.ports.rows.resolveProvenance(
            agentId,
            normalized.kind,
            merged,
            scope
          )
          if (collisionOwner && collisionOwner.id !== target.id) {
            return this.foldDecisionTargetIntoOwner(
              agentId,
              target,
              collisionOwner,
              now,
              normalized.category,
              mergedTemporal
            )
          }
          let newId: string | null = null
          try {
            this.ports.repository.runInTransaction(() => {
              const insert = this.ports.rows.insertMemory(
                agentId,
                mergedCandidate,
                merged,
                options,
                now
              )
              if (insert.action === 'suppressed') {
                if (insert.reason === 'forgotten') throw new DecisionForgottenClaimError()
                throw new DecisionInsertCollisionError()
              }
              newId = insert.id
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
              this.ports.repository.insertDerivations([
                {
                  agentId,
                  parentMemoryId: target.id,
                  childMemoryId: newId,
                  derivationKind: 'supersede',
                  createdAt: now
                }
              ])
            })
          } catch (error) {
            if (error instanceof DecisionForgottenClaimError) {
              return { action: 'noop', reason: 'forgotten' }
            }
            if (error instanceof DecisionInsertCollisionError) {
              const owner = this.ports.rows.resolveProvenance(
                agentId,
                normalized.kind,
                merged,
                scope
              )
              return owner && owner.id !== target.id
                ? this.foldDecisionTargetIntoOwner(
                    agentId,
                    target,
                    owner,
                    now,
                    normalized.category,
                    mergedTemporal
                  )
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
            content,
            scope
          )
          if (collisionOwner && collisionOwner.id !== target.id) {
            return this.foldDecisionTargetIntoOwner(
              agentId,
              target,
              collisionOwner,
              now,
              normalized.category,
              normalized.temporal
            )
          }
          let challengerId: string | null = null
          try {
            this.ports.repository.runInTransaction(() => {
              const insert = this.ports.rows.insertConflictedMemory(
                agentId,
                normalized,
                content,
                target.id,
                options,
                now
              )
              if (insert.action === 'suppressed') {
                if (insert.reason === 'forgotten') throw new DecisionForgottenClaimError()
                throw new DecisionInsertCollisionError()
              }
              challengerId = insert.id
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
            if (error instanceof DecisionForgottenClaimError) {
              return { action: 'noop', reason: 'forgotten' }
            }
            if (error instanceof DecisionInsertCollisionError) {
              const owner = this.ports.rows.resolveProvenance(
                agentId,
                normalized.kind,
                content,
                scope
              )
              return owner && owner.id !== target.id
                ? this.foldDecisionTargetIntoOwner(
                    agentId,
                    target,
                    owner,
                    now,
                    normalized.category,
                    normalized.temporal
                  )
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
    category: AgentMemoryRow['category'],
    incomingTemporal: MemoryTemporalMetadata
  ): CoordinateWriteResult {
    const currentTarget = this.ports.repository.getById(target.id)
    if (
      !isLiveDecisionTarget(agentId, currentTarget) ||
      !rowsShareMemoryScope(currentTarget, owner)
    ) {
      return { action: 'retry' }
    }
    const hit = this.ports.rows.handleProvenanceHit(agentId, owner, {
      allowDecisionForSuperseded: true
    })
    if (hit.action === 'noop' && hit.reason !== 'duplicate') {
      return { action: 'noop', reason: hit.reason, id: owner.id }
    }

    try {
      this.ports.repository.runInTransaction(() => {
        let ownerRevision = owner.decision_revision
        const ownerHead =
          hit.action === 'continue' ? this.ports.rows.supersedeHead(agentId, owner) : undefined
        let retiredHeadId: string | null = null
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
          if (
            !this.ports.repository.restoreArchivedMemory({
              agentId,
              id: owner.id,
              expectedRevision: owner.decision_revision
            })
          ) {
            throw new DecisionRevisionConflictError()
          }
          ownerRevision += 1
        }
        if (hit.action === 'continue') {
          if (ownerHead?.id === target.id) {
            if (
              !this.ports.repository.reviveSupersededMemory({
                agentId,
                id: owner.id,
                expectedRevision: owner.decision_revision
              })
            ) {
              throw new DecisionRevisionConflictError()
            }
          } else {
            const revival = this.ports.rows.reviveSupersededAfterDecision(agentId, owner)
            if (!revival.applied) {
              throw new DecisionRevisionConflictError()
            }
            retiredHeadId = revival.retiredHeadId
          }
          ownerRevision += 1
        }
        const currentTemporal = temporalMetadataFromRow(owner)
        const nextTemporal = reconcileEquivalentClaimTemporalMetadata(
          currentTemporal,
          incomingTemporal
        )
        const shouldUpdateTemporal = !memoryTemporalMetadataEquals(currentTemporal, nextTemporal)
        const shouldUpdateCategory =
          (owner.kind === 'episodic' || owner.kind === 'semantic') &&
          owner.category === null &&
          category !== null
        if (shouldUpdateCategory || shouldUpdateTemporal) {
          if (
            !this.ports.repository.updateUserMetadataIfRevision({
              agentId,
              id: owner.id,
              expectedRevision: ownerRevision,
              ...(shouldUpdateCategory ? { category } : {}),
              ...(shouldUpdateTemporal ? { temporal: nextTemporal } : {}),
              lastAccessedAt: now
            })
          ) {
            throw new DecisionRevisionConflictError()
          }
        }
        this.ports.repository.insertDerivations(
          [target.id, retiredHeadId]
            .filter((parentMemoryId): parentMemoryId is string => parentMemoryId !== null)
            .map((parentMemoryId) => ({
              agentId,
              parentMemoryId,
              childMemoryId: owner.id,
              derivationKind: 'supersede' as const,
              createdAt: now
            }))
        )
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
    model?: MemoryModelRef | null,
    beforeMutation?: () => void
  ): Promise<MemoryWriteOutcome> {
    // Runtime/model writes are not user authorization. They use the same tombstone-preserving
    // contract as extraction, maintenance, and replay.
    return this.rememberMemoryWithPolicy(candidate, options, model, 'preserve', beforeMutation)
  }

  private async rememberMemoryWithPolicy(
    candidate: MemoryCandidate,
    options: WriteMemoriesOptions,
    model: MemoryModelRef | null | undefined,
    tombstoneRelease: TombstoneReleasePolicy,
    beforeMutation?: () => void
  ): Promise<MemoryWriteOutcome> {
    if (!this.ctx.canWriteAgentMemory(options.agentId)) {
      return { action: 'noop', reason: 'disposed' }
    }
    const normalizedOptions: WriteMemoriesOptions = {
      ...options,
      scope: normalizeMemoryScope(options.scope)
    }
    const operationFence = this.ctx.captureOperationFence(options.agentId)
    const now = this.ctx.now()
    const explicitlyRelearned =
      tombstoneRelease === 'explicit-user-action'
        ? this.tryExplicitRelearn(
            options.agentId,
            candidate,
            normalizedOptions,
            now,
            beforeMutation
          )
        : null
    const resolvedModel =
      explicitlyRelearned || !model ? null : this.ctx.resolveExtractionModel(options.agentId, model)
    const outcome =
      explicitlyRelearned ??
      (resolvedModel
        ? await this.coordinateWrite(
            options.agentId,
            candidate,
            resolvedModel,
            normalizedOptions,
            now,
            operationFence,
            beforeMutation
          )
        : this.directAddMemory(options.agentId, candidate, normalizedOptions, now, beforeMutation))
    if (!this.ctx.canContinueOperation(operationFence)) {
      return { action: 'noop', reason: 'disposed' }
    }
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

  private tryExplicitRelearn(
    agentId: string,
    candidate: MemoryCandidate,
    options: WriteMemoriesOptions,
    now: number,
    beforeMutation?: () => void
  ): MemoryWriteOutcome | null {
    const normalized = normalizeMemoryCandidate(candidate)
    if (!normalized) return null
    const scope = normalizeMemoryScope(options.scope)
    if (
      !this.ports.repository.hasTombstoneForClaim({
        agentId,
        kind: normalized.kind,
        content: normalized.content,
        provenanceKey: buildScopedMemoryProvenanceKey(
          agentId,
          normalized.kind,
          normalized.content,
          scope
        ),
        scope
      })
    ) {
      return null
    }
    beforeMutation?.()
    const result = this.ports.rows.reauthorizeForgottenMemory(
      agentId,
      normalized,
      normalized.content,
      options,
      now
    )
    return result.action === 'inserted'
      ? { action: 'created', id: result.id, reauthorized: true }
      : null
  }

  private directAddMemory(
    agentId: string,
    candidate: MemoryCandidate,
    options: WriteMemoriesOptions,
    now: number,
    beforeMutation?: () => void
  ): MemoryWriteOutcome {
    const normalized = normalizeMemoryCandidate(candidate)
    if (!normalized) return { action: 'noop', reason: 'empty' }
    const content = normalized.content
    const scope = normalizeMemoryScope(options.scope)
    const duplicate = this.ports.rows.resolveProvenance(
      agentId,
      normalized.kind,
      content,
      scope,
      beforeMutation
    )
    if (duplicate) {
      const hit = this.ports.rows.handleProvenanceHit(agentId, duplicate)
      if (hit.action === 'absorbed') {
        return this.absorbArchivedProvenanceOwner(
          agentId,
          duplicate,
          normalized.temporal,
          beforeMutation
        )
          ? { action: 'updated', id: duplicate.id }
          : { action: 'noop', reason: 'concurrent-update', id: duplicate.id }
      }
      if (
        hit.action === 'noop' &&
        hit.reason === 'duplicate' &&
        this.ports.rows.enrichEquivalentClaimTemporalMetadata(
          agentId,
          duplicate,
          normalized.temporal,
          beforeMutation
        )
      ) {
        return { action: 'updated', id: duplicate.id }
      }
      const reason = hit.action === 'noop' ? hit.reason : 'duplicate'
      return { action: 'noop', reason, id: duplicate.id }
    }
    if (
      this.ports.repository.hasTombstoneForClaim({
        agentId,
        kind: normalized.kind,
        content,
        provenanceKey: buildScopedMemoryProvenanceKey(agentId, normalized.kind, content, scope),
        scope
      })
    ) {
      return { action: 'noop', reason: 'forgotten' }
    }
    beforeMutation?.()
    const insert = this.ports.rows.insertMemory(agentId, normalized, content, options, now)
    return insert.action === 'inserted'
      ? { action: 'created', id: insert.id }
      : {
          action: 'noop',
          reason: insert.reason === 'forgotten' ? 'forgotten' : 'insert-skipped'
        }
  }

  private absorbArchivedProvenanceOwner(
    agentId: string,
    existing: AgentMemoryRow,
    temporal: MemoryTemporalMetadata,
    beforeMutation?: () => void
  ): boolean {
    let restored = false
    beforeMutation?.()
    this.ports.repository.runInTransaction(() => {
      restored = this.ports.repository.restoreArchivedMemory({
        agentId,
        id: existing.id,
        expectedRevision: existing.decision_revision
      })
      if (!restored) return
      const current = this.ports.repository.getById(existing.id)
      if (current) {
        this.ports.rows.enrichEquivalentClaimTemporalMetadata(agentId, current, temporal)
      }
    })
    return restored
  }

  private reviveProvenanceOwner(
    agentId: string,
    existing: AgentMemoryRow,
    now: number,
    category: AgentMemoryRow['category'],
    temporal: MemoryTemporalMetadata
  ): MemoryWriteOutcome {
    let transitionApplied = true
    let retiredHeadId: string | null = null
    this.ports.repository.runInTransaction(() => {
      let expectedRevision = existing.decision_revision
      if (existing.lifecycle_state === 'archived' && existing.superseded_by === null) {
        transitionApplied = this.ports.repository.restoreArchivedMemory({
          agentId,
          id: existing.id,
          expectedRevision: existing.decision_revision
        })
        if (transitionApplied) expectedRevision += 1
      }
      if (existing.superseded_by !== null) {
        const revival = this.ports.rows.reviveSupersededAfterDecision(agentId, existing)
        transitionApplied = revival.applied
        retiredHeadId = revival.retiredHeadId
        if (transitionApplied) expectedRevision += 1
      }
      if (!transitionApplied) return
      const currentTemporal = temporalMetadataFromRow(existing)
      const nextTemporal = reconcileEquivalentClaimTemporalMetadata(currentTemporal, temporal)
      const shouldUpdateTemporal = !memoryTemporalMetadataEquals(currentTemporal, nextTemporal)
      const shouldUpdateCategory = existing.category === null && category !== null
      if (shouldUpdateCategory || shouldUpdateTemporal) {
        transitionApplied = this.ports.repository.updateUserMetadataIfRevision({
          agentId,
          id: existing.id,
          expectedRevision,
          ...(shouldUpdateCategory ? { category } : {}),
          ...(shouldUpdateTemporal ? { temporal: nextTemporal } : {}),
          lastAccessedAt: now
        })
      }
      if (transitionApplied && retiredHeadId !== null) {
        this.ports.repository.insertDerivations([
          {
            agentId,
            parentMemoryId: retiredHeadId,
            childMemoryId: existing.id,
            derivationKind: 'supersede',
            createdAt: now
          }
        ])
      }
    })

    if (!transitionApplied) return { action: 'noop', reason: 'concurrent-update', id: existing.id }

    return { action: 'updated', id: existing.id }
  }

  async addUserMemory(
    agentId: string,
    input: {
      content: string
      kind?: 'episodic' | 'semantic'
      category?: string | null
      importance?: number
      scope?: MemoryScope
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
    const scope = normalizeMemoryScope(input.scope ?? AGENT_MEMORY_AGENT_SCOPE)
    const outcome = await this.rememberMemoryWithPolicy(
      candidate,
      {
        agentId,
        sourceSession: sessionId ?? null,
        scope
      },
      model,
      'explicit-user-action'
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
        importance: candidate.importance ?? null,
        scopeType: scope.type,
        scopeId: scope.type === 'agent' ? null : scope.id
      },
      outputRefs: audit.outputRefs,
      model,
      sessionId: sessionId ?? null
    })
    return outcome
  }
}
