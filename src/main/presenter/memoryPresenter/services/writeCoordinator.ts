import logger from '@shared/logger'

import {
  ADD_DECISION,
  buildDecisionPrompt,
  parseDecision,
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
  MemoryCandidate,
  MemoryExtractionInput,
  MemoryExtractionResult,
  MemoryRecallItem,
  MemoryUpdateContext,
  MemoryWriteOutcome,
  WriteMemoriesOptions
} from '../types'
import { type MemoryModelRef, type MemoryRuntimeContext } from '../context'

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

export class WriteCoordinator {
  constructor(
    private readonly ctx: MemoryRuntimeContext,
    private readonly rows: MemoryRowMutations,
    private readonly ports: {
      retrieve: (
        agentId: string,
        query: string,
        now: number,
        recordAccessHits: boolean
      ) => Promise<MemoryRecallItem[]>
      syncWorkingMemoryAfterMutation: (agentId: string) => void
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
      const duplicate = this.ctx.deps.repository.getByProvenanceKey(options.agentId, provenanceKey)
      if (duplicate) {
        if (this.rows.absorbProvenanceHit(options.agentId, duplicate)) created.push(duplicate.id)
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
    return created
  }

  async extractAndStore(input: MemoryExtractionInput): Promise<MemoryExtractionResult> {
    if (!this.ctx.canWriteAgentMemory(input.agentId)) return { ok: true, createdIds: [] }
    if (this.ctx.isDisposed) return { ok: true, createdIds: [] }
    const span = input.spanText.trim()
    if (!span) return { ok: true, createdIds: [] }
    const model = this.ctx.resolveExtractionModel(input.agentId, input.model)
    try {
      let shouldExtract = true
      try {
        const triage = await this.ctx.deps.generateText(
          model.providerId,
          model.modelId,
          buildTriagePrompt(span)
        )
        shouldExtract = parseTriageDecision(triage)
      } catch (error) {
        logger.warn(`[Memory] triage skipped, extracting anyway: ${String(error)}`)
      }
      if (!this.ctx.canWriteAgentMemory(input.agentId)) return { ok: true, createdIds: [] }
      if (!shouldExtract) return { ok: true, createdIds: [] }

      const response = await this.ctx.deps.generateText(
        model.providerId,
        model.modelId,
        buildExtractionPrompt(span)
      )
      if (!this.ctx.canWriteAgentMemory(input.agentId)) return { ok: true, createdIds: [] }
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
      const createdIds: string[] = []
      const outcomes: MemoryWriteOutcome[] = []
      let touched = false
      for (const candidate of candidates) {
        const outcome = await this.coordinateWrite(input.agentId, candidate, model, options, now)
        outcomes.push(outcome)
        createdIds.push(...createdIdsFromOutcome(outcome))
        if (outcomeTouched(outcome)) touched = true
      }
      if (createdIds.length || touched) {
        this.ports.syncWorkingMemoryAfterMutation(input.agentId)
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
      return { ok: true, createdIds }
    } catch (error) {
      logger.warn(`[Memory] extraction failed: ${String(error)}`)
      return { ok: false }
    }
  }

  private async coordinateWrite(
    agentId: string,
    candidate: MemoryCandidate,
    model: MemoryModelRef,
    options: WriteMemoriesOptions,
    now: number
  ): Promise<MemoryWriteOutcome> {
    const normalized = normalizeMemoryCandidate(candidate)
    if (!normalized) return { action: 'noop', reason: 'empty' }
    const content = normalized.content
    if (!this.ctx.canWriteAgentMemory(agentId)) return { action: 'noop', reason: 'disposed' }

    const provenanceKey = buildMemoryProvenanceKey(agentId, normalized.kind, content)
    const duplicate = this.ctx.deps.repository.getByProvenanceKey(agentId, provenanceKey)
    if (duplicate) {
      const touched = this.rows.absorbProvenanceHit(agentId, duplicate)
      return touched
        ? { action: 'updated', id: duplicate.id }
        : { action: 'noop', reason: 'duplicate', id: duplicate.id }
    }

    let neighbors: MemoryRecallItem[] = []
    try {
      const hits = await this.ports.retrieve(agentId, content, now, false)
      neighbors = hits.slice(0, DECISION_NEIGHBOR_TOP_S)
    } catch (error) {
      logger.warn(`[Memory] decision neighbor recall failed, adding: ${String(error)}`)
    }
    if (!this.ctx.canWriteAgentMemory(agentId)) return { action: 'noop', reason: 'disposed' }
    if (!neighbors.length) {
      const id = this.rows.insertMemory(agentId, normalized, content, provenanceKey, options)
      return id ? { action: 'created', id } : { action: 'noop', reason: 'insert-skipped' }
    }

    let decision: MemoryDecision = ADD_DECISION
    try {
      const raw = await this.ctx.deps.generateText(
        model.providerId,
        model.modelId,
        buildDecisionPrompt(
          normalized,
          neighbors.map((neighbor) => ({ content: neighbor.content }))
        )
      )
      decision = parseDecision(raw, neighbors.length)
    } catch (error) {
      logger.warn(`[Memory] decision model failed, adding: ${String(error)}`)
    }
    if (!this.ctx.canWriteAgentMemory(agentId)) return { action: 'noop', reason: 'disposed' }

    const target = decision.targetIndex !== null ? neighbors[decision.targetIndex] : null
    switch (decision.decision) {
      case 'NOOP':
        return { action: 'noop', reason: 'decision-noop', id: target?.id }
      case 'UPDATE':
        if (target) {
          const targetRow = this.ctx.deps.repository.getById(target.id)
          if (targetRow) {
            const merged = decision.mergedContent ?? content
            const survivorId = this.rows.applyContentUpdate(
              agentId,
              targetRow,
              merged,
              now,
              normalized.category
            )
            this.rows.bumpConfidence(survivorId)
            this.ctx.deps.repository.updateStatus(survivorId, 'pending_embedding')
            return { action: 'updated', id: survivorId }
          }
        }
        break
      case 'SUPERSEDE':
        if (target) {
          const merged = decision.mergedContent ?? content
          const mergedKey = buildMemoryProvenanceKey(agentId, normalized.kind, merged)
          const newId = this.rows.insertMemory(agentId, normalized, merged, mergedKey, options)
          if (newId) {
            this.ctx.deps.repository.markSuperseded(target.id, newId)
            return { action: 'superseded', id: newId, supersededId: target.id, created: true }
          }
          const existing = this.ctx.deps.repository.getByProvenanceKey(agentId, mergedKey)
          if (existing && existing.id !== target.id) {
            this.rows.absorbProvenanceHit(agentId, existing)
            if (existing.category === null && normalized.category !== null) {
              this.ctx.deps.repository.updateContent(
                existing.id,
                existing.content,
                existing.provenance_key,
                now,
                normalized.category
              )
            }
            this.ctx.deps.repository.markSuperseded(target.id, existing.id)
            return {
              action: 'superseded',
              id: existing.id,
              supersededId: target.id,
              created: false
            }
          }
          return { action: 'noop', reason: 'supersede-collided', id: target.id }
        }
        break
      case 'CHALLENGE':
        if (target) {
          const challengerId = this.rows.insertConflictedMemory(
            agentId,
            normalized,
            content,
            provenanceKey,
            target.id,
            options
          )
          if (challengerId) {
            const currentTarget = this.ctx.deps.repository.getById(target.id)
            if (
              currentTarget &&
              currentTarget.agent_id === agentId &&
              currentTarget.status !== 'archived' &&
              currentTarget.superseded_by === null
            ) {
              this.ctx.deps.repository.markConflict(target.id, 'challenged')
              return { action: 'challenged', targetId: target.id, challengerId }
            }
            this.ctx.deps.repository.setConflictWith(challengerId, null)
            this.ctx.deps.repository.updateStatus(challengerId, 'pending_embedding')
            return { action: 'created', id: challengerId }
          }
          return { action: 'noop', reason: 'challenge-insert-skipped', id: target.id }
        }
        break
    }
    const id = this.rows.insertMemory(agentId, normalized, content, provenanceKey, options)
    return id ? { action: 'created', id } : { action: 'noop', reason: 'insert-skipped' }
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
    const outcome = resolvedModel
      ? await this.coordinateWrite(options.agentId, candidate, resolvedModel, options, Date.now())
      : this.directAddMemory(options.agentId, candidate, options)
    if (outcomeTouched(outcome)) {
      this.ports.syncWorkingMemoryAfterMutation(options.agentId)
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
    const duplicate = this.ctx.deps.repository.getByProvenanceKey(agentId, provenanceKey)
    if (duplicate) {
      const touched = this.rows.absorbProvenanceHit(agentId, duplicate)
      return touched
        ? { action: 'updated', id: duplicate.id }
        : { action: 'noop', reason: 'duplicate', id: duplicate.id }
    }
    const id = this.rows.insertMemory(agentId, normalized, content, provenanceKey, options)
    return id ? { action: 'created', id } : { action: 'noop', reason: 'insert-skipped' }
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
