import { randomUUID } from 'node:crypto'
import type { DeepchatEventPayload } from '@shared/contracts/events'
import type { LocalControlEffect, LocalControlPrincipal } from '@shared/contracts/localControl'
import type { JsonValue } from '@shared/contracts/json'
import type { RendererRouteCaller } from '@/routes/routeRegistry'
import { ApprovalBroker, ApprovalCapacityError, type ApprovalDecision } from '@/approval'
import { CliRequestError } from './errors'

const CLI_APPROVAL_DOMAIN = 'cli-mutation'
const DEFAULT_APPROVAL_TIMEOUT_MS = 2 * 60_000

export type CliApprovalTarget = Readonly<{
  windowId: number
  webContentsId: number
}>

export type CliApprovalPresentationPort = Readonly<{
  getTarget(): Promise<CliApprovalTarget | null>
  present(
    target: CliApprovalTarget,
    payload: DeepchatEventPayload<'approvals.requested'>
  ): Promise<boolean>
  close(target: CliApprovalTarget, payload: DeepchatEventPayload<'approvals.closed'>): Promise<void>
}>

export type CliMutationApprovalInput = Readonly<{
  operation: string
  effect: LocalControlEffect
  principal: LocalControlPrincipal
  connectionId: string
  clientRequestId: string
  arguments: unknown
  displayData?: JsonValue
  signal: AbortSignal
  timeoutMs?: number
}>

export type CliMutationApproval = Readonly<{
  approvalRequestId: string
}>

type PendingTarget = Readonly<{
  scopeKey: string
  target: CliApprovalTarget
}>

function decisionCloseReason(
  decision: ApprovalDecision
): DeepchatEventPayload<'approvals.closed'>['reason'] {
  if (decision.allowed) return 'approved'
  return decision.reason
}

function signalReason(signal: AbortSignal): Error {
  return signal.reason instanceof CliRequestError
    ? signal.reason
    : new CliRequestError('cancelled', 'Request was cancelled')
}

function throwIfSignalAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signalReason(signal)
}

export class CliMutationGuard {
  private readonly pendingTargets = new Map<string, PendingTarget>()
  private readonly rendererUnavailableRequests = new Set<string>()

  constructor(
    private readonly approvals: ApprovalBroker,
    private readonly presentation: CliApprovalPresentationPort
  ) {}

  async authorize(input: CliMutationApprovalInput): Promise<CliMutationApproval> {
    throwIfSignalAborted(input.signal)
    const target = await this.presentation.getTarget()
    throwIfSignalAborted(input.signal)
    if (!target) {
      throw new CliRequestError('unavailable', 'No trusted renderer is available for approval', {
        httpStatus: 503,
        retriable: true
      })
    }

    const executionId = randomUUID()
    const scopeKey = `cli:${input.connectionId}`
    let approvalRequestId: string | undefined
    let closeReason: DeepchatEventPayload<'approvals.closed'>['reason'] = 'cancelled'

    try {
      const pending = this.approvals.create(
        {
          domain: CLI_APPROVAL_DOMAIN,
          scopeKey,
          operation: input.operation,
          effect: input.effect,
          bindingKey: executionId,
          arguments: input.arguments,
          ...(input.displayData !== undefined ? { redactedDisplayData: input.displayData } : {}),
          metadata: {
            targetWebContentsId: target.webContentsId,
            clientRequestId: input.clientRequestId
          }
        },
        {
          consumeOnApprove: true,
          signal: input.signal,
          timeoutMs: input.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS
        }
      )
      approvalRequestId = pending.requestId
      this.pendingTargets.set(pending.requestId, { scopeKey, target })

      let presented: boolean
      try {
        presented = await this.presentation.present(target, {
          requestId: pending.requestId,
          operation: input.operation,
          effect: input.effect,
          principal: input.principal,
          expiresAt: pending.expiresAt,
          ...(pending.redactedDisplayData !== undefined
            ? { displayData: pending.redactedDisplayData }
            : {})
        })
      } catch {
        presented = false
      }
      if (!presented) {
        closeReason = 'unavailable'
        this.approvals.resolve({
          requestId: pending.requestId,
          scopeKey,
          decision: 'cancelled'
        })
        throw new CliRequestError('unavailable', 'Approval renderer became unavailable', {
          httpStatus: 503,
          retriable: true
        })
      }

      const decision = await this.approvals.wait(pending.requestId, input.signal)
      closeReason = decisionCloseReason(decision)
      if (decision.allowed) {
        return { approvalRequestId: pending.requestId }
      }
      if (decision.reason === 'timeout') {
        throw new CliRequestError('approval_timeout', 'Approval request timed out', {
          httpStatus: 408,
          retriable: true
        })
      }
      if (
        decision.reason === 'cancelled' &&
        this.rendererUnavailableRequests.has(pending.requestId)
      ) {
        closeReason = 'unavailable'
        throw new CliRequestError('unavailable', 'Approval renderer became unavailable', {
          httpStatus: 503,
          retriable: true
        })
      }
      if (decision.reason === 'cancelled' && input.signal.aborted) {
        throw signalReason(input.signal)
      }
      if (decision.reason === 'cancelled') {
        throw new CliRequestError('cancelled', 'Approval request was cancelled', {
          retriable: true
        })
      }
      throw new CliRequestError('approval_denied', 'Approval request was denied', {
        httpStatus: 403
      })
    } catch (error) {
      if (input.signal.aborted && !(error instanceof CliRequestError)) {
        throw signalReason(input.signal)
      }
      if (error instanceof ApprovalCapacityError) {
        throw new CliRequestError('rate_limited', 'Too many pending approval requests', {
          httpStatus: 429,
          retriable: true
        })
      }
      throw error
    } finally {
      if (approvalRequestId) {
        this.pendingTargets.delete(approvalRequestId)
        this.rendererUnavailableRequests.delete(approvalRequestId)
        await this.presentation
          .close(target, { requestId: approvalRequestId, reason: closeReason })
          .catch(() => undefined)
      }
    }
  }

  resolve(
    input: { requestId: string; decision: 'approved' | 'denied' },
    caller: RendererRouteCaller
  ): boolean {
    const pending = this.pendingTargets.get(input.requestId)
    if (!pending || pending.target.webContentsId !== caller.webContentsId) return false
    return this.approvals.resolve({
      requestId: input.requestId,
      scopeKey: pending.scopeKey,
      decision: input.decision
    })
  }

  cancelRenderer(webContentsId: number): void {
    for (const [requestId, pending] of this.pendingTargets) {
      if (pending.target.webContentsId !== webContentsId) continue
      this.rendererUnavailableRequests.add(requestId)
      this.approvals.resolve({
        requestId,
        scopeKey: pending.scopeKey,
        decision: 'cancelled'
      })
    }
  }

  clear(): void {
    this.approvals.clearDomain(CLI_APPROVAL_DOMAIN)
    this.pendingTargets.clear()
    this.rendererUnavailableRequests.clear()
  }
}
