import logger from '@shared/logger'
import { AGENT_MEMORY_AUTO_CONTENT_MAX_CHARS } from '@shared/types/agent-memory'
import { unicodeCodePointLength } from '@shared/lib/unicodeText'

import { ADD_DECISION, type MemoryDecision } from '../core/decision'
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
import type { ClaimOwnership } from '../domain/types'
import { isLiveDecisionTarget } from '../domain/stateModel'
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

class DecisionRevisionConflictError extends Error {}
class DecisionInsertCollisionError extends Error {}
class DecisionForgottenClaimError extends Error {}

type CoordinateWriteResult = MemoryWriteOutcome | { action: 'retry' }

interface IndexedCandidate {
  candidateIndex: number
  candidate: NormalizedMemoryCandidate
}

// Everything a single write shares across preparation, decision, and apply. `options.scope`
// is already normalized; `beforeMutation` is the caller's dispatch-commit boundary and must run
// outside any store transaction.
interface WriteContext {
  agentId: string
  scope: MemoryScope
  options: WriteMemoriesOptions
  now: number
  beforeMutation?: () => void
}

interface PreparedCoordinateCandidate extends IndexedCandidate {
  decisionHeadId: string | null
  neighbors: MemoryRecallItem[]
  queryVector?: MemoryDecisionQueryVectorSnapshot
}

// A candidate whose provenance already decided its fate: it never reaches recall or the
// decision model.
interface ImmediateCandidate extends IndexedCandidate {
  settled: Exclude<ClaimOwnership, { state: 'unowned' | 'superseded' }> | { state: 'forgotten' }
}

type PrepareCoordinateCandidateResult =
  | { prepared: PreparedCoordinateCandidate }
  | { immediate: ImmediateCandidate }

interface BatchWriteResult {
  outcomes: MemoryWriteOutcome[]
  decisionBudgetFallbacks: number
  failed: boolean
  error?: unknown
  llmCalls: number
  casRetries: number
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

function createWriteContext(
  options: WriteMemoriesOptions,
  now: number,
  beforeMutation?: () => void
): WriteContext {
  const scope = normalizeMemoryScope(options.scope)
  return { agentId: options.agentId, scope, options: { ...options, scope }, now, beforeMutation }
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
      const ownership = this.ports.rows.resolveClaimOwnership(
        options.agentId,
        normalized.kind,
        content,
        scope,
        { allowSuperseded: false }
      )
      if (ownership.state !== 'unowned') {
        if (ownership.state === 'archived') {
          if (
            this.absorbArchivedProvenanceOwner(
              options.agentId,
              ownership.owner,
              normalized.temporal
            )
          ) {
            created.push(ownership.owner.id)
            touched = true
          }
        } else if (
          ownership.state === 'duplicate' &&
          this.ports.rows.enrichEquivalentClaimTemporalMetadata(
            options.agentId,
            ownership.owner,
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
      const writeContext = createWriteContext(
        {
          agentId: input.agentId,
          scope: input.scope,
          sourceSession: input.sourceSession ?? null,
          sourceEntryIds: input.sourceEntryIds ?? null
        },
        now
      )
      const batch = await this.coordinateBatchWrites(
        writeContext,
        candidateStats.candidates,
        model,
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
    ctx: WriteContext,
    indexed: IndexedCandidate
  ): PrepareCoordinateCandidateResult {
    const { agentId, scope } = ctx
    const { kind, content } = indexed.candidate
    const ownership = this.ports.rows.resolveClaimOwnership(agentId, kind, content, scope, {
      allowSuperseded: true,
      beforeMutation: ctx.beforeMutation
    })
    switch (ownership.state) {
      case 'unowned':
        // A forgotten claim never reaches recall or the decision model. insertMemory still checks
        // the tombstone inside its own transaction; this only saves the provider round trips.
        if (
          this.ports.repository.hasTombstoneForClaim({
            agentId,
            kind,
            content,
            provenanceKey: buildScopedMemoryProvenanceKey(agentId, kind, content, scope),
            scope
          })
        ) {
          return { immediate: { ...indexed, settled: { state: 'forgotten' } } }
        }
        return { prepared: { ...indexed, decisionHeadId: null, neighbors: [] } }
      case 'superseded':
        return {
          prepared: { ...indexed, decisionHeadId: ownership.head?.id ?? null, neighbors: [] }
        }
      default:
        return { immediate: { ...indexed, settled: ownership } }
    }
  }

  // Only an archived owner or an enrichable duplicate touch the store; the other settled states
  // are conservative no-ops, so the dispatch boundary is committed by the row helpers themselves
  // right before they write.
  private applyImmediate(ctx: WriteContext, immediate: ImmediateCandidate): MemoryWriteOutcome {
    const { settled, candidate } = immediate
    switch (settled.state) {
      case 'archived':
        return this.absorbArchivedProvenanceOwner(
          ctx.agentId,
          settled.owner,
          candidate.temporal,
          ctx.beforeMutation
        )
          ? { action: 'updated', id: settled.owner.id }
          : { action: 'noop', reason: 'concurrent-update', id: settled.owner.id }
      case 'duplicate':
        return this.ports.rows.enrichEquivalentClaimTemporalMetadata(
          ctx.agentId,
          settled.owner,
          candidate.temporal,
          ctx.beforeMutation
        )
          ? { action: 'updated', id: settled.owner.id }
          : { action: 'noop', reason: 'duplicate', id: settled.owner.id }
      case 'suppressed':
        return { action: 'noop', reason: settled.reason, id: settled.owner.id }
      case 'challenged':
        return { action: 'noop', reason: 'conflict', id: settled.head.id }
      case 'forgotten':
        return { action: 'noop', reason: 'forgotten' }
    }
  }

  // Re-resolves ownership inside the transaction because provider round trips separate the
  // prepared snapshot from this write. Callers commit the dispatch boundary before entering.
  private applyCurrentProvenanceOrInsert(
    ctx: WriteContext,
    candidate: NormalizedMemoryCandidate
  ): MemoryWriteOutcome {
    const { agentId, scope, options, now } = ctx
    let outcome: MemoryWriteOutcome = { action: 'noop', reason: 'concurrent-update' }
    this.ports.repository.runInTransaction(() => {
      const ownership = this.ports.rows.resolveClaimOwnership(
        agentId,
        candidate.kind,
        candidate.content,
        scope,
        { allowSuperseded: true }
      )
      switch (ownership.state) {
        case 'archived': {
          const owner = ownership.owner
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
        case 'duplicate':
          outcome = this.ports.rows.enrichEquivalentClaimTemporalMetadata(
            agentId,
            ownership.owner,
            candidate.temporal
          )
            ? { action: 'updated', id: ownership.owner.id }
            : { action: 'noop', reason: 'duplicate', id: ownership.owner.id }
          return
        case 'suppressed':
          outcome = { action: 'noop', reason: ownership.reason, id: ownership.owner.id }
          return
        case 'challenged':
          outcome = { action: 'noop', reason: 'conflict', id: ownership.head.id }
          return
        case 'superseded':
          outcome = this.reviveProvenanceOwner(
            agentId,
            ownership.owner,
            now,
            candidate.category,
            candidate.temporal
          )
          return
        case 'unowned':
          break
      }
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

  // A prepared candidate is past every local gate; recall and the decision model above have no
  // side effects, so the dispatch boundary commits here, right before the first store write.
  // Retries stay conservative: no insert, no fallback ADD, no second retry.
  private applyPreparedCandidate(
    ctx: WriteContext,
    prepared: PreparedCoordinateCandidate,
    parsed: { decision: MemoryDecision; valid: boolean } | undefined,
    isRetry: boolean
  ): CoordinateWriteResult {
    ctx.beforeMutation?.()
    if (!prepared.neighbors.length) {
      if (isRetry) return { action: 'noop', reason: 'concurrent-update' }
      return this.applyCurrentProvenanceOrInsert(ctx, prepared.candidate)
    }
    if (!parsed?.valid && isRetry) return { action: 'noop', reason: 'concurrent-update' }
    const result = this.applyDecisionAttempt(
      ctx,
      prepared.candidate,
      prepared.neighbors,
      parsed?.valid ? parsed.decision : ADD_DECISION
    )
    if (result.action === 'retry' && isRetry) return { action: 'noop', reason: 'concurrent-update' }
    return result
  }

  private async retrievePreparedCandidates(
    ctx: WriteContext,
    prepared: readonly PreparedCoordinateCandidate[],
    queryVectors?: readonly (MemoryDecisionQueryVectorSnapshot | undefined)[]
  ): Promise<PreparedCoordinateCandidate[]> {
    if (!prepared.length) return []
    try {
      const sets = await this.ports.retrieveForDecisions(
        ctx.agentId,
        prepared.map((item) => item.candidate),
        ctx.now,
        queryVectors,
        prepared.map((item) => (item.decisionHeadId ? [item.decisionHeadId] : undefined)),
        [ctx.scope]
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

  // The single decision kernel for extraction batches and one-off remembers alike: settle
  // provenance-decided candidates synchronously, recall neighbors and ask the decision model once
  // for the rest, apply, then give CAS losers one bounded retry that reuses their query vectors.
  private async coordinateBatchWrites(
    ctx: WriteContext,
    candidates: readonly IndexedCandidate[],
    model: MemoryModelRef,
    operationFence: MemoryOperationFence
  ): Promise<BatchWriteResult> {
    const result: BatchWriteResult = {
      outcomes: [],
      decisionBudgetFallbacks: 0,
      failed: false,
      llmCalls: 0,
      casRetries: 0
    }
    if (!candidates.length) return result
    const outcomesByIndex = new Map<number, MemoryWriteOutcome>()
    const fail = (error: unknown, stage: string): void => {
      logger.warn(`[Memory] candidate ${stage} failed: ${String(error)}`)
      result.failed = true
      result.error = error
    }

    // Settle immediate candidates before any provider round trip can age their owner snapshot.
    const toPrepare: PreparedCoordinateCandidate[] = []
    for (const indexed of candidates) {
      if (!this.ctx.canContinueOperation(operationFence)) break
      try {
        const preparation = this.prepareCoordinateCandidate(ctx, indexed)
        if ('prepared' in preparation) toPrepare.push(preparation.prepared)
        else
          outcomesByIndex.set(
            indexed.candidateIndex,
            this.applyImmediate(ctx, preparation.immediate)
          )
      } catch (error) {
        fail(error, 'preparation')
        break
      }
    }

    const retryCandidates: PreparedCoordinateCandidate[] = []
    if (!result.failed && toPrepare.length) {
      const prepared = await this.retrievePreparedCandidates(ctx, toPrepare)
      const initialBatch = await this.requestBatchDecisions(
        ctx.agentId,
        model,
        prepared
          .filter((item) => item.neighbors.length > 0)
          .map((item) => toBatchDecisionInput(item, ctx.now)),
        DECISION_BATCH_MAX_BATCHES,
        operationFence
      )
      result.llmCalls += initialBatch.calls
      result.decisionBudgetFallbacks = initialBatch.fallbackCandidateIndexes.size
      for (const item of prepared) {
        if (!this.ctx.canContinueOperation(operationFence)) break
        try {
          const applied = this.applyPreparedCandidate(
            ctx,
            item,
            initialBatch.decisions.get(item.candidateIndex),
            false
          )
          if (applied.action === 'retry') retryCandidates.push(item)
          else outcomesByIndex.set(item.candidateIndex, applied)
        } catch (error) {
          fail(error, 'apply')
          break
        }
      }
    }

    // CAS losers get one more round, bounded in count and only while the embedding identity that
    // produced their query vectors is still current; everyone else settles as concurrent-update.
    const retrySlice = retryCandidates.slice(0, DECISION_RETRY_MAX_CANDIDATES)
    for (const skipped of retryCandidates.slice(DECISION_RETRY_MAX_CANDIDATES)) {
      outcomesByIndex.set(skipped.candidateIndex, { action: 'noop', reason: 'concurrent-update' })
    }
    const currentEmbedding = this.ports.policy.resolveAgentConfig(ctx.agentId)?.memoryEmbedding
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
    if (!result.failed && retryEligible.length && this.ctx.canContinueOperation(operationFence)) {
      const oldVectors = new Map(
        retryEligible.map((candidate) => [candidate.candidateIndex, candidate.queryVector])
      )
      const retryBase: PreparedCoordinateCandidate[] = []
      for (const candidate of retryEligible) {
        const preparation = this.prepareCoordinateCandidate(ctx, {
          candidateIndex: candidate.candidateIndex,
          candidate: candidate.candidate
        })
        if ('prepared' in preparation) retryBase.push(preparation.prepared)
        else {
          outcomesByIndex.set(
            candidate.candidateIndex,
            this.applyImmediate(ctx, preparation.immediate)
          )
        }
      }
      const retryPrepared = await this.retrievePreparedCandidates(
        ctx,
        retryBase,
        retryBase.map((candidate) => oldVectors.get(candidate.candidateIndex))
      )
      const retryBatch = await this.requestBatchDecisions(
        ctx.agentId,
        model,
        retryPrepared
          .filter((candidate) => candidate.neighbors.length > 0)
          .map((candidate) => toBatchDecisionInput(candidate, ctx.now)),
        1,
        operationFence
      )
      result.llmCalls += retryBatch.calls
      for (const item of retryPrepared) {
        if (!this.ctx.canContinueOperation(operationFence)) break
        try {
          result.casRetries += 1
          const applied = this.applyPreparedCandidate(
            ctx,
            item,
            retryBatch.decisions.get(item.candidateIndex),
            true
          )
          outcomesByIndex.set(
            item.candidateIndex,
            applied.action === 'retry' ? { action: 'noop', reason: 'concurrent-update' } : applied
          )
        } catch (error) {
          fail(error, 'retry apply')
          break
        }
      }
    }

    result.outcomes = candidates.flatMap((candidate) => {
      const outcome = outcomesByIndex.get(candidate.candidateIndex)
      return outcome ? [outcome] : []
    })
    return result
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

  private applyDecisionAttempt(
    ctx: WriteContext,
    normalized: NormalizedMemoryCandidate,
    neighbors: readonly MemoryRecallItem[],
    decision: MemoryDecision
  ): CoordinateWriteResult {
    const { agentId, scope, options, now } = ctx
    const content = normalized.content
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
    return this.applyCurrentProvenanceOrInsert(ctx, normalized)
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
    const ownership = this.ports.rows.classifyClaimOwner(agentId, owner, {
      allowSuperseded: true
    })
    if (ownership.state === 'suppressed') {
      return { action: 'noop', reason: ownership.reason, id: owner.id }
    }
    const ownerIsSuperseded = ownership.state === 'superseded' || ownership.state === 'challenged'
    // Only a live chain head can coincide with the (live) decision target.
    const ownerHeadIsTarget = ownership.state === 'superseded' && ownership.head?.id === target.id

    try {
      this.ports.repository.runInTransaction(() => {
        let ownerRevision = owner.decision_revision
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
        if (ownership.state === 'archived') {
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
        if (ownerIsSuperseded) {
          if (ownerHeadIsTarget) {
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
    const normalized = normalizeMemoryCandidate(candidate)
    if (!normalized) return { action: 'noop', reason: 'empty' }
    const ctx = createWriteContext(options, this.ctx.now(), beforeMutation)
    const operationFence = this.ctx.captureOperationFence(ctx.agentId)
    const explicitlyRelearned =
      tombstoneRelease === 'explicit-user-action' ? this.tryExplicitRelearn(ctx, normalized) : null
    const resolvedModel =
      explicitlyRelearned || !model ? null : this.ctx.resolveExtractionModel(ctx.agentId, model)
    let outcome: MemoryWriteOutcome
    if (explicitlyRelearned) {
      outcome = explicitlyRelearned
    } else if (resolvedModel) {
      // A single remember is a one-candidate batch. Apply failures are not partial here, so the
      // caller's fail-closed contract (for example a journal commit that cannot persist) surfaces.
      const batch = await this.coordinateBatchWrites(
        ctx,
        [{ candidateIndex: 0, candidate: normalized }],
        resolvedModel,
        operationFence
      )
      if (batch.failed) throw batch.error
      outcome = batch.outcomes[0] ?? { action: 'noop', reason: 'disposed' }
    } else {
      outcome = this.directAddMemory(ctx, normalized)
    }
    if (!this.ctx.canContinueOperation(operationFence)) {
      return { action: 'noop', reason: 'disposed' }
    }
    if (outcomeTouched(outcome)) {
      this.ctx.markDomainMutationCommitted(ctx.agentId)
      this.ports.markWorkingMemoryDirty(ctx.agentId)
      this.ctx.emitChanged(ctx.agentId, 'extract')
      if (outcome.action !== 'challenged') {
        void this.ports.triggerEmbedding(ctx.agentId).catch((error) => {
          logger.warn(`[Memory] background embedding failed: ${String(error)}`)
        })
      }
      this.ports.scheduleConsolidation(ctx.agentId)
    }
    return outcome
  }

  private tryExplicitRelearn(
    ctx: WriteContext,
    normalized: NormalizedMemoryCandidate
  ): MemoryWriteOutcome | null {
    const { agentId, scope, options, now } = ctx
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
    ctx.beforeMutation?.()
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

  // No decision model: dedupe by provenance, respect tombstones, otherwise insert.
  private directAddMemory(
    ctx: WriteContext,
    normalized: NormalizedMemoryCandidate
  ): MemoryWriteOutcome {
    const { agentId, scope, options, now } = ctx
    const content = normalized.content
    const ownership = this.ports.rows.resolveClaimOwnership(
      agentId,
      normalized.kind,
      content,
      scope,
      {
        allowSuperseded: false,
        beforeMutation: ctx.beforeMutation
      }
    )
    switch (ownership.state) {
      case 'archived':
        return this.absorbArchivedProvenanceOwner(
          agentId,
          ownership.owner,
          normalized.temporal,
          ctx.beforeMutation
        )
          ? { action: 'updated', id: ownership.owner.id }
          : { action: 'noop', reason: 'concurrent-update', id: ownership.owner.id }
      case 'duplicate':
        return this.ports.rows.enrichEquivalentClaimTemporalMetadata(
          agentId,
          ownership.owner,
          normalized.temporal,
          ctx.beforeMutation
        )
          ? { action: 'updated', id: ownership.owner.id }
          : { action: 'noop', reason: 'duplicate', id: ownership.owner.id }
      case 'suppressed':
        return { action: 'noop', reason: ownership.reason, id: ownership.owner.id }
      case 'challenged':
      case 'superseded':
        // Unreachable without allowSuperseded; a superseded chain stays a conservative no-op here.
        return { action: 'noop', reason: 'duplicate', id: ownership.owner.id }
      case 'unowned':
        break
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
    ctx.beforeMutation?.()
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
