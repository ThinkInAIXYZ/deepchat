import type { JsonValue } from '@shared/contracts/json'
import type { LocalControlEffect } from '@shared/contracts/localControl'
import { hashApprovalArguments } from '@/approval'
import type { CliRouteCaller } from '@/routes/routeRegistry'
import { CliRequestError } from './errors'
import type { CliMutationGuard } from './mutationGuard'
import { resolveCliSurfaceEffect, type CliSurfaceEntry } from './surface'

const DEFAULT_AGENT_COMPUTE_LIMIT = 2
const DEFAULT_AGENT_COMPUTE_STARTS_PER_MINUTE = 20
const COMPUTE_WINDOW_MS = 60_000

export type CliPolicyAuditOutcome =
  | 'allowed'
  | 'denied'
  | 'approved'
  | 'approval-denied'
  | 'approval-timeout'
  | 'cancelled'
  | 'unavailable'
  | 'rate-limited'
  | 'misconfigured'

export type CliPolicyAuditRecord = Readonly<{
  timestamp: number
  principal: CliRouteCaller['principal']
  connectionId: string
  conversationId?: string
  operation: string
  effect: LocalControlEffect
  outcome: CliPolicyAuditOutcome
  requestId: string
  approvalRequestId?: string
  redactedArgumentsHash: string
}>

export type CliRequestPolicyInput = Readonly<{
  entry: CliSurfaceEntry
  input: unknown
  transportBinding?: JsonValue
  caller: CliRouteCaller
  requestId: string
  signal: AbortSignal
}>

export type CliRequestAdmission = Readonly<{
  release(): void
}>

export type CliRequestPolicyOptions = Readonly<{
  mutationGuard: CliMutationGuard
  audit(record: CliPolicyAuditRecord): void | Promise<void>
  agentComputeLimit?: number
  agentComputeStartsPerMinute?: number
  now?: () => number
}>

type EffectDecision = 'allow' | 'deny' | 'approval'

function resolveEffectDecision(
  effect: LocalControlEffect,
  caller: CliRouteCaller,
  agentPolicy: CliSurfaceEntry['agentPolicy']
): EffectDecision {
  if (caller.principal === 'human') {
    return effect === 'read' ||
      effect === 'compute' ||
      effect === 'local-maintenance' ||
      effect === 'preference-write'
      ? 'allow'
      : 'approval'
  }

  if (effect === 'read' || effect === 'compute') return 'allow'
  if (effect === 'local-maintenance' && agentPolicy === 'allow') return 'allow'
  if (
    (effect === 'preference-write' || effect === 'security-config' || effect === 'supply-chain') &&
    agentPolicy === 'approval'
  ) {
    return 'approval'
  }
  return 'deny'
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be positive`)
  return value
}

function emptyRelease(): CliRequestAdmission {
  return { release: () => undefined }
}

function auditProjection(entry: CliSurfaceEntry, input: unknown): JsonValue {
  return entry.auditProjection?.(input) ?? {}
}

export class CliRequestPolicy {
  private readonly now: () => number
  private readonly agentComputeLimit: number
  private readonly agentComputeStartsPerMinute: number
  private readonly activeAgentCompute = new Map<string, number>()
  private readonly agentComputeStarts = new Map<string, number[]>()
  private lastComputePruneAt = 0

  constructor(private readonly options: CliRequestPolicyOptions) {
    this.now = options.now ?? Date.now
    this.agentComputeLimit = positiveInteger(
      options.agentComputeLimit ?? DEFAULT_AGENT_COMPUTE_LIMIT,
      'agentComputeLimit'
    )
    this.agentComputeStartsPerMinute = positiveInteger(
      options.agentComputeStartsPerMinute ?? DEFAULT_AGENT_COMPUTE_STARTS_PER_MINUTE,
      'agentComputeStartsPerMinute'
    )
  }

  async authorize(input: CliRequestPolicyInput): Promise<CliRequestAdmission> {
    let effect: LocalControlEffect
    let agentInputAllowed = true
    try {
      effect = resolveCliSurfaceEffect(input.entry, input.input)
      if (input.caller.principal === 'agent') {
        agentInputAllowed = input.entry.agentInputAllowed?.(input.input) ?? true
      }
    } catch {
      throw new CliRequestError('internal_error', 'CLI effect policy is misconfigured', {
        httpStatus: 500
      })
    }
    const redactedArguments =
      input.transportBinding !== undefined
        ? {
            request: auditProjection(input.entry, input.input),
            transport: input.transportBinding
          }
        : auditProjection(input.entry, input.input)
    const approvalArguments =
      input.transportBinding !== undefined
        ? { params: input.input, transport: input.transportBinding }
        : input.input
    const redactedArgumentsHash = hashApprovalArguments({
      operation: input.entry.contract.name,
      arguments: redactedArguments
    })
    const audit = async (
      outcome: CliPolicyAuditOutcome,
      approvalRequestId?: string
    ): Promise<void> => {
      await this.options.audit({
        timestamp: this.now(),
        principal: input.caller.principal,
        connectionId: input.caller.connectionId,
        ...(input.caller.principal === 'agent'
          ? { conversationId: input.caller.conversationId }
          : {}),
        operation: input.entry.contract.name,
        effect,
        outcome,
        requestId: input.requestId,
        ...(approvalRequestId ? { approvalRequestId } : {}),
        redactedArgumentsHash
      })
    }

    if (
      !input.entry.callers.includes(input.caller.principal) ||
      !input.entry.scopes.every((scope) => input.caller.scopes.includes(scope)) ||
      !agentInputAllowed
    ) {
      await audit('denied')
      throw new CliRequestError('permission_denied', 'Caller lacks access to this operation', {
        httpStatus: 403
      })
    }

    const effectDecision = resolveEffectDecision(effect, input.caller, input.entry.agentPolicy)
    if (effectDecision === 'deny') {
      await audit('denied')
      throw new CliRequestError('permission_denied', 'Operation is denied for this caller', {
        httpStatus: 403
      })
    }

    if (effectDecision === 'approval') {
      if (input.entry.approval !== 'policy' || !input.entry.approvalDisplay) {
        await audit('misconfigured')
        throw new CliRequestError('internal_error', 'CLI approval policy is misconfigured', {
          httpStatus: 500
        })
      }
      let approvalRequestId: string
      try {
        const routeDisplayData = input.entry.approvalDisplay(input.input, input.caller)
        const approvalDisplayData =
          input.transportBinding !== undefined
            ? { request: routeDisplayData, transport: input.transportBinding }
            : routeDisplayData
        const approval = await this.options.mutationGuard.authorize({
          operation: input.entry.contract.name,
          effect,
          principal: input.caller.principal,
          connectionId: input.caller.connectionId,
          clientRequestId: input.requestId,
          arguments: approvalArguments,
          displayData: approvalDisplayData,
          signal: input.signal
        })
        approvalRequestId = approval.approvalRequestId
      } catch (error) {
        await audit(this.toApprovalAuditOutcome(error))
        throw error
      }
      await audit('approved', approvalRequestId)
    }

    let admission: CliRequestAdmission
    try {
      admission = this.admitCompute(input, effect)
    } catch (error) {
      if (error instanceof CliRequestError && error.code === 'rate_limited') {
        await audit('rate-limited')
      }
      throw error
    }
    try {
      if (effectDecision === 'allow') await audit('allowed')
      return admission
    } catch (error) {
      admission.release()
      throw error
    }
  }

  private admitCompute(
    input: CliRequestPolicyInput,
    effect: LocalControlEffect
  ): CliRequestAdmission {
    if (effect !== 'compute' || input.caller.principal !== 'agent') {
      return emptyRelease()
    }

    const quotaDomain = input.entry.programmaticOnly ? 'programmatic-tool' : 'general'
    const owner = `${quotaDomain}\0${input.caller.conversationId}`
    const active = this.activeAgentCompute.get(owner) ?? 0
    const now = this.now()
    this.pruneComputeStarts(now)
    const recentStarts = (this.agentComputeStarts.get(owner) ?? []).filter(
      (timestamp) => timestamp > now - COMPUTE_WINDOW_MS
    )
    if (
      active >= this.agentComputeLimit ||
      recentStarts.length >= this.agentComputeStartsPerMinute
    ) {
      if (recentStarts.length > 0) this.agentComputeStarts.set(owner, recentStarts)
      else this.agentComputeStarts.delete(owner)
      throw new CliRequestError('rate_limited', 'Agent compute capacity is full', {
        httpStatus: 429,
        retriable: true
      })
    }

    recentStarts.push(now)
    this.agentComputeStarts.set(owner, recentStarts)
    this.activeAgentCompute.set(owner, active + 1)
    let released = false
    return {
      release: () => {
        if (released) return
        released = true
        const remaining = Math.max(0, (this.activeAgentCompute.get(owner) ?? 1) - 1)
        if (remaining > 0) this.activeAgentCompute.set(owner, remaining)
        else this.activeAgentCompute.delete(owner)
      }
    }
  }

  private pruneComputeStarts(now: number): void {
    if (now - this.lastComputePruneAt < COMPUTE_WINDOW_MS) return
    this.lastComputePruneAt = now
    for (const [owner, starts] of this.agentComputeStarts) {
      if ((this.activeAgentCompute.get(owner) ?? 0) > 0) continue
      const recent = starts.filter((timestamp) => timestamp > now - COMPUTE_WINDOW_MS)
      if (recent.length > 0) this.agentComputeStarts.set(owner, recent)
      else this.agentComputeStarts.delete(owner)
    }
  }

  private toApprovalAuditOutcome(error: unknown): CliPolicyAuditOutcome {
    if (!(error instanceof CliRequestError)) return 'unavailable'
    switch (error.code) {
      case 'approval_denied':
        return 'approval-denied'
      case 'approval_timeout':
        return 'approval-timeout'
      case 'cancelled':
      case 'timeout':
        return 'cancelled'
      case 'rate_limited':
        return 'rate-limited'
      default:
        return 'unavailable'
    }
  }
}
