import logger from '@shared/logger'

import {
  ADD_DECISION,
  buildDecisionPrompt,
  parseDecisionResult,
  type MemoryDecision
} from '../core/decision'
import { normalizeMemoryCandidate } from '../core/candidates'
import {
  buildExtractionPrompt,
  buildTriagePrompt,
  parseMemoryCandidates,
  parseTriageDecision
} from '../core/extraction'
import { buildMemoryProvenanceKey } from '../core/scoring'
import { DECISION_NEIGHBOR_TOP_S, MEMORY_CREATED_IDS_EVENT_LIMIT } from '../runtimeConstants'
import type { MemoryRowMutations } from './rowMutations'
import type {
  AgentMemoryRow,
  MemoryCandidate,
  MemoryExtractionInput,
  MemoryExtractionResult,
  MemoryRecallItem,
  MemoryUpdateContext,
  MemoryWriteOutcome,
  WriteMemoriesOptions
} from '../types'
import {
  type MemoryModelRef,
  type MemoryOperationFence,
  type MemoryRuntimeContext
} from '../context'

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
  constructor(
    private readonly ctx: MemoryRuntimeContext,
    private readonly rows: MemoryRowMutations,
    private readonly ports: {
      retrieveForDecision: (
        agentId: string,
        query: string,
        now: number
      ) => Promise<MemoryRecallItem[]>
      markWorkingMemoryDirty: (agentId: string) => void
      flushWorkingMemoryIfDirty: (agentId: string) => void
      triggerEmbedding: (agentId: string) => Promise<void>
      scheduleConsolidation: (agentId: string) => void
    }
  ) {}

  writeMemoriesSync(candidates: MemoryCandidate[], options: WriteMemoriesOptions): string[] {
    if (!candidates.length) return []
    const created: string[] = []
    for (const candidate of candidates) {
      const normalized = normalizeMemoryCandidate(candidate)
      if (!normalized) continue
      const content = normalized.content
      const provenanceKey = buildMemoryProvenanceKey(options.agentId, normalized.kind, content)
      const duplicate = this.ctx.resolveProvenance(options.agentId, normalized.kind, content)
      if (duplicate) {
        const hit = this.rows.handleProvenanceHit(options.agentId, duplicate)
        if (hit.action === 'absorbed') {
          this.absorbArchivedProvenanceOwner(duplicate)
          created.push(duplicate.id)
        }
        continue
      }
      const id = this.rows.insertMemory(
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
        const triage = await this.ctx.provider.generateText(
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

      const response = await this.ctx.provider.generateText(
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
      const candidates = parsed.candidates
      const options: WriteMemoriesOptions = {
        agentId: input.agentId,
        sourceSession: input.sourceSession ?? null,
        sourceEntryIds: input.sourceEntryIds ?? null
      }
      const now = Date.now()
      for (const candidate of candidates) {
        const outcome = await this.coordinateWrite(
          input.agentId,
          candidate,
          model,
          options,
          now,
          operationFence
        )
        if (this.ctx.isOperationGenerationCurrent(operationFence)) {
          outcomes.push(outcome)
          createdIds.push(...createdIdsFromOutcome(outcome))
          if (outcomeTouched(outcome)) {
            this.ctx.markDomainMutationCommitted(input.agentId)
            this.ports.markWorkingMemoryDirty(input.agentId)
            touched = true
          }
        }
        // If a non-empty extraction is disabled mid-batch, keep the cursor for retry; any rows
        // already written are picked up by the next embedding/backfill drain.
        if (!this.ctx.canContinueOperation(operationFence)) return { ok: false }
      }
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

  private finalizeCommittedExtraction(
    input: MemoryExtractionInput,
    outcomes: MemoryWriteOutcome[]
  ): void {
    try {
      this.ports.flushWorkingMemoryIfDirty(input.agentId)
    } catch (error) {
      logger.warn(`[Memory] working memory finalization failed: ${String(error)}`)
    }
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
    const duplicate = this.ctx.resolveProvenance(agentId, normalized.kind, content)
    let decisionHead: AgentMemoryRow | null = null
    let supersededDuplicate: AgentMemoryRow | null = null
    if (duplicate) {
      const hit = this.rows.handleProvenanceHit(agentId, duplicate, {
        allowDecisionForSuperseded: true
      })
      if (hit.action === 'absorbed') {
        this.absorbArchivedProvenanceOwner(duplicate)
        return { action: 'updated', id: duplicate.id }
      }
      if (hit.action === 'noop') return { action: 'noop', reason: hit.reason, id: duplicate.id }
      supersededDuplicate = duplicate
      const head = this.rows.supersedeHead(agentId, duplicate)
      if (isLiveDecisionTarget(agentId, head)) decisionHead = head
    }

    let neighbors: MemoryRecallItem[] = []
    try {
      const hits = await this.ports.retrieveForDecision(agentId, content, now)
      neighbors = hits.slice(0, DECISION_NEIGHBOR_TOP_S)
      if (decisionHead && !neighbors.some((neighbor) => neighbor.id === decisionHead.id)) {
        neighbors.unshift(recallItemFromRow(decisionHead))
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
      if (supersededDuplicate) {
        return this.reviveProvenanceOwner(agentId, supersededDuplicate, now, normalized.category)
      }
      const id = this.rows.insertMemory(agentId, normalized, content, provenanceKey, options)
      return id ? { action: 'created', id } : { action: 'noop', reason: 'insert-skipped' }
    }

    let decision: MemoryDecision = ADD_DECISION
    try {
      const raw = await this.ctx.provider.generateText(
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
      if (isRetry && !parsed.valid) {
        return { action: 'noop', reason: 'concurrent-update' }
      }
      decision = parsed.decision
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

    const target = decision.targetIndex !== null ? neighbors[decision.targetIndex] : null
    switch (decision.decision) {
      case 'NOOP':
        return { action: 'noop', reason: 'decision-noop', id: target?.id }
      case 'UPDATE':
        if (target) {
          const targetRow = this.ctx.deps.repository.getById(target.id)
          if (isLiveDecisionTarget(agentId, targetRow)) {
            const merged = decision.mergedContent ?? content
            const mergedKey = buildMemoryProvenanceKey(agentId, targetRow.kind, merged)
            const owner = this.ctx.resolveProvenance(agentId, targetRow.kind, merged)
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
              this.ctx.deps.repository.runInTransaction(() => {
                const applied = this.ctx.deps.repository.updateDecisionContentIfRevision({
                  agentId,
                  id: targetRow.id,
                  expectedRevision: target.decisionRevision,
                  content: merged,
                  provenanceKey: mergedKey,
                  at: now,
                  category: nextCategory
                })
                if (!applied) throw new DecisionRevisionConflictError()
                this.rows.bumpConfidence(targetRow.id)
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
          const targetRow = this.ctx.deps.repository.getById(target.id)
          if (!isLiveDecisionTarget(agentId, targetRow)) return { action: 'retry' }
          const merged = decision.mergedContent ?? content
          const mergedKey = buildMemoryProvenanceKey(agentId, normalized.kind, merged)
          const collisionOwner = this.ctx.resolveProvenance(agentId, normalized.kind, merged)
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
            this.ctx.deps.repository.runInTransaction(() => {
              newId = this.rows.insertMemory(agentId, normalized, merged, mergedKey, options)
              if (!newId) throw new DecisionInsertCollisionError()
              if (
                !this.ctx.deps.repository.markSupersededIfRevision(
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
              const owner = this.ctx.resolveProvenance(agentId, normalized.kind, merged)
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
          const collisionOwner = this.ctx.resolveProvenance(agentId, normalized.kind, content)
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
            this.ctx.deps.repository.runInTransaction(() => {
              challengerId = this.rows.insertConflictedMemory(
                agentId,
                normalized,
                content,
                provenanceKey,
                target.id,
                options
              )
              if (!challengerId) throw new DecisionInsertCollisionError()
              if (
                !this.ctx.deps.repository.markConflictIfRevision(
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
              const owner = this.ctx.resolveProvenance(agentId, normalized.kind, content)
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
    const id = this.rows.insertMemory(agentId, normalized, content, provenanceKey, options)
    if (!id && supersededDuplicate) {
      return this.reviveProvenanceOwner(agentId, supersededDuplicate, now, normalized.category)
    }
    return id ? { action: 'created', id } : { action: 'noop', reason: 'insert-skipped' }
  }

  private foldDecisionTargetIntoOwner(
    agentId: string,
    target: MemoryRecallItem,
    owner: AgentMemoryRow,
    now: number,
    category: AgentMemoryRow['category']
  ): CoordinateWriteResult {
    const hit = this.rows.handleProvenanceHit(agentId, owner, {
      allowDecisionForSuperseded: true
    })
    if (hit.action === 'noop' && hit.reason !== 'duplicate') {
      return { action: 'noop', reason: hit.reason, id: owner.id }
    }

    try {
      this.ctx.deps.repository.runInTransaction(() => {
        const ownerHead =
          hit.action === 'continue' ? this.rows.supersedeHead(agentId, owner) : undefined
        if (
          !this.ctx.deps.repository.markSupersededIfRevision(
            agentId,
            target.id,
            target.decisionRevision,
            owner.id
          )
        ) {
          throw new DecisionRevisionConflictError()
        }
        if (hit.action === 'absorbed') {
          this.ctx.deps.repository.activateForEmbedding(owner.id)
        }
        if (hit.action === 'continue') {
          if (ownerHead?.id === target.id) {
            this.ctx.deps.repository.markSuperseded(owner.id, null)
            this.ctx.deps.repository.activateForEmbedding(owner.id)
          } else {
            this.rows.reviveSupersededAfterDecision(agentId, owner)
          }
        }
        if (
          (owner.kind === 'episodic' || owner.kind === 'semantic') &&
          owner.category === null &&
          category !== null
        ) {
          this.ctx.deps.repository.updateContent(
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
      this.ports.flushWorkingMemoryIfDirty(options.agentId)
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
    const duplicate = this.ctx.resolveProvenance(agentId, normalized.kind, content)
    if (duplicate) {
      const hit = this.rows.handleProvenanceHit(agentId, duplicate)
      if (hit.action === 'absorbed') {
        this.absorbArchivedProvenanceOwner(duplicate)
        return { action: 'updated', id: duplicate.id }
      }
      const reason = hit.action === 'noop' ? hit.reason : 'duplicate'
      return { action: 'noop', reason, id: duplicate.id }
    }
    const id = this.rows.insertMemory(agentId, normalized, content, provenanceKey, options)
    return id ? { action: 'created', id } : { action: 'noop', reason: 'insert-skipped' }
  }

  private absorbArchivedProvenanceOwner(existing: AgentMemoryRow): void {
    this.ctx.deps.repository.runInTransaction(() => {
      this.ctx.deps.repository.activateForEmbedding(existing.id)
    })
  }

  private reviveProvenanceOwner(
    agentId: string,
    existing: AgentMemoryRow,
    now: number,
    category: AgentMemoryRow['category'],
    foldTargetId?: string
  ): MemoryWriteOutcome {
    this.ctx.deps.repository.runInTransaction(() => {
      if (existing.status === 'archived' && existing.superseded_by === null) {
        this.ctx.deps.repository.activateForEmbedding(existing.id)
      }
      this.rows.reviveSupersededAfterDecision(agentId, existing)
      if (existing.category === null && category !== null) {
        this.ctx.deps.repository.updateContent(
          existing.id,
          existing.content,
          existing.provenance_key,
          now,
          category
        )
      }
      if (foldTargetId && foldTargetId !== existing.id) {
        this.ctx.deps.repository.markSuperseded(foldTargetId, existing.id)
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
    const configured = this.ctx.deps.resolveAgentConfig(agentId)?.memoryExtractionModel
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
