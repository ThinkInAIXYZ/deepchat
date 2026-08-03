import { nanoid } from 'nanoid'
import { AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT } from '@shared/types/agent-memory'
import type { MemoryCommandResult } from '@shared/contracts/routes/memory.routes'

import {
  normalizeMemoryDirective,
  type AgentMemoryDirectiveRow,
  type ExplicitMemoryDirectiveSource,
  type MemoryDirectiveCommandResult,
  type MemoryDirectiveInput,
  type MemoryDirectiveListOptions
} from '../domain/directives'
import type { MemoryRuntimeContext } from '../context'
import type { MemoryDirectiveRepositoryPort } from '../ports'
import { memoryCommandApplied, memoryCommandRejected } from '../domain/commandResult'

const DIRECTIVE_ID_PREFIX = 'directive-'
export const ACTIVE_DIRECTIVE_READ_LIMIT = AGENT_MEMORY_ACTIVE_DIRECTIVE_MAX_COUNT
export const DIRECTIVE_MANAGEMENT_READ_LIMIT = 200

export class DirectiveService {
  constructor(
    private readonly ports: {
      ctx: MemoryRuntimeContext
      repository: MemoryDirectiveRepositoryPort
    }
  ) {}

  listDirectives(
    agentId: string,
    options: MemoryDirectiveListOptions = {}
  ): AgentMemoryDirectiveRow[] {
    this.ports.ctx.assertSafeAgentId(agentId)
    if (!this.ports.ctx.isManagedAgent(agentId)) return []
    return this.ports.repository.listDirectives(agentId, {
      statuses: options.statuses,
      limit: Math.min(
        DIRECTIVE_MANAGEMENT_READ_LIMIT,
        Math.max(0, Math.floor(options.limit ?? DIRECTIVE_MANAGEMENT_READ_LIMIT))
      )
    })
  }

  listActiveDirectives(agentId: string): AgentMemoryDirectiveRow[] {
    this.ports.ctx.assertSafeAgentId(agentId)
    if (!this.ports.ctx.canReadDirectivePlane(agentId)) return []
    return this.ports.repository.listActiveDirectives(agentId, ACTIVE_DIRECTIVE_READ_LIMIT)
  }

  listActiveSuppressionTopics(agentId: string): string[] {
    return this.listActiveDirectives(agentId).flatMap((row) =>
      row.kind === 'suppress_topic' && row.normalized_topic ? [row.normalized_topic] : []
    )
  }

  createExplicitDirective(
    agentId: string,
    input: MemoryDirectiveInput,
    source: ExplicitMemoryDirectiveSource = 'manual'
  ): AgentMemoryDirectiveRow | null {
    const result = this.createExplicitDirectiveResult(agentId, input, source)
    return result.action === 'applied' ? result.directive : null
  }

  createExplicitDirectiveResult(
    agentId: string,
    input: MemoryDirectiveInput,
    source: ExplicitMemoryDirectiveSource = 'manual'
  ): MemoryDirectiveCommandResult {
    this.ports.ctx.assertSafeAgentId(agentId)
    if (!this.ports.ctx.canManageAgentMemory(agentId)) {
      return { action: 'rejected', directive: null, reason: 'unavailable' }
    }
    const normalized = normalizeMemoryDirective(input)
    const now = this.ports.ctx.now()
    const result = this.ports.repository.upsertExplicitDirective({
      agentId,
      id: `${DIRECTIVE_ID_PREFIX}${nanoid(12)}`,
      ...normalized,
      source,
      status: 'active',
      createdAt: now,
      updatedAt: now
    })
    if (result.action === 'capacity') {
      return { action: 'rejected', directive: null, reason: 'capacity' }
    }
    if (result.action === 'unchanged') {
      return { action: 'applied', directive: result.row }
    }

    this.ports.ctx.markDomainMutationCommitted(agentId)
    this.ports.ctx.writeAudit(agentId, {
      eventType: 'memory/directive_create',
      actorType: 'user',
      status: 'completed',
      outputRefs: {
        directiveId: result.row.id,
        kind: result.row.kind,
        status: result.row.status,
        source: result.row.source
      },
      createdAt: now
    })
    this.ports.ctx.emitChanged(agentId, 'directive-create', { directiveId: result.row.id })
    return { action: 'applied', directive: result.row }
  }

  suggestDirective(agentId: string, input: MemoryDirectiveInput): AgentMemoryDirectiveRow | null {
    this.ports.ctx.assertSafeAgentId(agentId)
    if (!this.ports.ctx.canWriteAgentMemory(agentId)) return null
    const normalized = normalizeMemoryDirective(input)
    const now = this.ports.ctx.now()
    const result = this.ports.repository.insertDerivedDirectiveDraft({
      agentId,
      id: `${DIRECTIVE_ID_PREFIX}${nanoid(12)}`,
      ...normalized,
      source: 'derived_suggestion',
      status: 'draft',
      createdAt: now,
      updatedAt: now
    })
    if (!result.inserted) return null

    this.ports.ctx.markDomainMutationCommitted(agentId)
    this.ports.ctx.writeAudit(agentId, {
      eventType: 'memory/directive_suggest',
      actorType: 'runtime',
      status: 'completed',
      outputRefs: {
        directiveId: result.row.id,
        kind: result.row.kind,
        status: result.row.status,
        source: result.row.source
      },
      createdAt: now
    })
    this.ports.ctx.emitChanged(agentId, 'directive-suggest', { directiveId: result.row.id })
    return result.row
  }

  approveDirective(agentId: string, directiveId: string): AgentMemoryDirectiveRow | null {
    const result = this.approveDirectiveResult(agentId, directiveId)
    return result.action === 'applied' ? result.directive : null
  }

  approveDirectiveResult(agentId: string, directiveId: string): MemoryDirectiveCommandResult {
    return this.transitionDraftResult(agentId, directiveId, 'active')
  }

  rejectDirective(agentId: string, directiveId: string): AgentMemoryDirectiveRow | null {
    const result = this.rejectDirectiveResult(agentId, directiveId)
    return result.action === 'applied' ? result.directive : null
  }

  rejectDirectiveResult(agentId: string, directiveId: string): MemoryDirectiveCommandResult {
    return this.transitionDraftResult(agentId, directiveId, 'rejected')
  }

  private transitionDraftResult(
    agentId: string,
    directiveId: string,
    status: 'active' | 'rejected'
  ): MemoryDirectiveCommandResult {
    this.ports.ctx.assertSafeAgentId(agentId)
    if (!this.ports.ctx.canManageAgentMemory(agentId)) {
      return { action: 'rejected', directive: null, reason: 'unavailable' }
    }
    const id = directiveId.trim()
    if (!id) return { action: 'rejected', directive: null, reason: 'not-found' }
    const now = this.ports.ctx.now()
    const transition = this.ports.repository.transitionDirective(agentId, id, 'draft', status, now)
    if (transition.action !== 'transitioned') {
      return {
        action: 'rejected',
        directive: null,
        reason: transition.action
      }
    }
    const row = transition.row

    this.ports.ctx.markDomainMutationCommitted(agentId)
    this.ports.ctx.writeAudit(agentId, {
      eventType: status === 'active' ? 'memory/directive_approve' : 'memory/directive_reject',
      actorType: 'user',
      status: 'completed',
      inputRefs: { directiveId: id },
      outputRefs: { directiveId: id, kind: row.kind, status },
      createdAt: now
    })
    this.ports.ctx.emitChanged(
      agentId,
      status === 'active' ? 'directive-approve' : 'directive-reject',
      { directiveId: id }
    )
    return { action: 'applied', directive: row }
  }

  deleteDirective(agentId: string, directiveId: string): boolean {
    return this.deleteDirectiveResult(agentId, directiveId).action === 'applied'
  }

  deleteDirectiveResult(agentId: string, directiveId: string): MemoryCommandResult {
    this.ports.ctx.assertSafeAgentId(agentId)
    if (!this.ports.ctx.canManageAgentMemory(agentId)) return memoryCommandRejected('unavailable')
    const id = directiveId.trim()
    if (!id) return memoryCommandRejected('not-found')
    const row = this.ports.repository.deleteDirective(agentId, id)
    if (!row) return memoryCommandRejected('not-found')
    const now = this.ports.ctx.now()

    this.ports.ctx.markDomainMutationCommitted(agentId)
    this.ports.ctx.writeAudit(agentId, {
      eventType: 'memory/directive_delete',
      actorType: 'user',
      status: 'completed',
      inputRefs: { directiveId: id },
      outputRefs: { directiveId: id, kind: row.kind, status: row.status },
      createdAt: now
    })
    this.ports.ctx.emitChanged(agentId, 'directive-delete', { directiveId: id })
    return memoryCommandApplied()
  }

  getCounts(agentId: string) {
    this.ports.ctx.assertSafeAgentId(agentId)
    if (!this.ports.ctx.isManagedAgent(agentId)) {
      return { draft: 0, active: 0, rejected: 0 }
    }
    return this.ports.repository.countDirectivesByStatus(agentId)
  }
}
