import { createHash, randomUUID } from 'node:crypto'
import type {
  WorkflowLaunchApproval,
  WorkflowLaunchDraft,
  WorkflowLaunchRequest
} from '@shared/workflow/serviceContracts'
import {
  WorkflowLaunchApprovalSchema,
  resolveWorkflowLaunchRequest
} from '@shared/workflow/serviceContracts'
import { WORKFLOW_RUNTIME_MAX_SCRIPT_BYTES } from '@shared/workflow/runtimeProtocol'
import { canonicalizeWorkflowJson } from './domain/json'
import { canonicalizeWorkflowExecutionSnapshot } from './domain/executionSnapshot'
import { validateWorkflowSource } from './runtime/workflowSourceValidator'
import { deriveWorkflowSourceOutlineFromAst } from './runtime/workflowSourceOutline'

const DEFAULT_APPROVAL_TTL_MS = 5 * 60 * 1_000
const DEFAULT_MAX_PENDING_APPROVALS = 128
const DEFAULT_MAX_PENDING_APPROVAL_BYTES = 16 * 1024 * 1024

interface PendingWorkflowApproval {
  approval: WorkflowLaunchApproval
  request: WorkflowLaunchRequest
  byteLength: number
}

export class WorkflowLaunchApprovalExpiredError extends Error {
  constructor() {
    super('Workflow launch approval is missing, expired, or already consumed.')
    this.name = 'WorkflowLaunchApprovalExpiredError'
  }
}

export class WorkflowLaunchApprovalScopeError extends Error {
  constructor() {
    super('Workflow launch approval does not belong to the expected parent session.')
    this.name = 'WorkflowLaunchApprovalScopeError'
  }
}

export class WorkflowLaunchApprovalSourceError extends Error {
  constructor() {
    super('Workflow launch approval does not match the displayed source snapshot.')
    this.name = 'WorkflowLaunchApprovalSourceError'
  }
}

export class WorkflowLaunchApprovalRegistry {
  private readonly pending = new Map<string, PendingWorkflowApproval>()
  private pendingBytes = 0

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = DEFAULT_APPROVAL_TTL_MS,
    private readonly maxPending = DEFAULT_MAX_PENDING_APPROVALS,
    private readonly maxPendingBytes = DEFAULT_MAX_PENDING_APPROVAL_BYTES
  ) {
    if (!Number.isInteger(ttlMs) || ttlMs < 1_000) {
      throw new Error('Workflow launch approval TTL must be at least one second.')
    }
    if (!Number.isInteger(maxPending) || maxPending < 1) {
      throw new Error('Workflow pending approval limit must be a positive integer.')
    }
    if (!Number.isInteger(maxPendingBytes) || maxPendingBytes < 1) {
      throw new Error('Workflow pending approval byte limit must be a positive integer.')
    }
  }

  prepare(draft: WorkflowLaunchDraft): WorkflowLaunchApproval {
    this.prune()
    if (this.pending.size >= this.maxPending) {
      throw new Error(`Workflow launch approval queue is full (${this.maxPending} pending).`)
    }
    const request = resolveWorkflowLaunchRequest(draft)
    const sourceBytes = Buffer.byteLength(request.scriptSource, 'utf8')
    if (
      sourceBytes > WORKFLOW_RUNTIME_MAX_SCRIPT_BYTES ||
      sourceBytes > request.limits.maxScriptBytes
    ) {
      throw new Error(`Workflow source exceeds its ${request.limits.maxScriptBytes}-byte limit.`)
    }
    const sourceAst = validateWorkflowSource(request.scriptSource)
    const outline = deriveWorkflowSourceOutlineFromAst(sourceAst)
    const sourceHash = createHash('sha256').update(request.scriptSource, 'utf8').digest('hex')
    const canonicalInput = canonicalizeWorkflowJson(request.input, {
      maxBytes: request.limits.maxInputBytes
    })
    const executionSnapshot = canonicalizeWorkflowExecutionSnapshot(request.executionSnapshot)
    const normalizedRequest: WorkflowLaunchRequest = {
      ...request,
      executionSnapshot: executionSnapshot.snapshot
    }
    const outlineBytes = Buffer.byteLength(JSON.stringify(outline), 'utf8')
    const approvalBytes =
      sourceBytes + canonicalInput.byteLength + executionSnapshot.byteLength + outlineBytes
    if (
      approvalBytes > this.maxPendingBytes ||
      this.pendingBytes + approvalBytes > this.maxPendingBytes
    ) {
      throw new Error(
        `Workflow launch approvals exceed the ${this.maxPendingBytes}-byte pending limit.`
      )
    }
    const scopeHash = canonicalizeWorkflowJson(
      {
        sourceHash,
        parentSessionId: request.parentSessionId,
        parentMessageId: request.parentMessageId,
        namedWorkflowPath: request.namedWorkflowPath,
        workspacePath: request.workspacePath,
        capabilityScopeHash: request.capabilityScopeHash,
        executionSnapshotHash: executionSnapshot.sha256,
        inputHash: canonicalInput.sha256,
        allowedAgentIds: request.allowedAgentIds,
        limits: request.limits,
        budget: request.budget
      },
      { maxBytes: 128 * 1024 }
    ).sha256
    const approval = WorkflowLaunchApprovalSchema.parse({
      approvalId: randomUUID(),
      sourceHash,
      scopeHash,
      expiresAt: this.now() + this.ttlMs,
      summary: {
        workspacePath: request.workspacePath,
        capabilityScopeHash: request.capabilityScopeHash,
        executionSnapshotHash: executionSnapshot.sha256,
        allowedAgentIds: request.allowedAgentIds,
        maxInvocations: request.limits.maxInvocations,
        maxPendingInvocations: request.limits.maxPendingInvocations,
        budget: request.budget,
        capabilities: request.capabilities,
        outline
      }
    })
    this.pending.set(approval.approvalId, {
      approval,
      request: normalizedRequest,
      byteLength: approvalBytes
    })
    this.pendingBytes += approvalBytes
    return approval
  }

  get(approvalId: string, expectedParentSessionId?: string): WorkflowLaunchApproval {
    this.prune()
    const pending = this.pending.get(approvalId)
    if (!pending) {
      throw new WorkflowLaunchApprovalExpiredError()
    }
    this.assertExpectedParent(pending, expectedParentSessionId)
    return WorkflowLaunchApprovalSchema.parse(pending.approval)
  }

  validateSource(
    approvalId: string,
    expectedParentSessionId: string,
    scriptSource: string
  ): WorkflowLaunchApproval {
    this.prune()
    const pending = this.pending.get(approvalId)
    if (!pending) {
      throw new WorkflowLaunchApprovalExpiredError()
    }
    this.assertExpectedParent(pending, expectedParentSessionId)
    if (pending.request.scriptSource !== scriptSource) {
      throw new WorkflowLaunchApprovalSourceError()
    }
    return WorkflowLaunchApprovalSchema.parse(pending.approval)
  }

  consume(approvalId: string, expectedParentSessionId?: string): WorkflowLaunchRequest {
    this.prune()
    const pending = this.pending.get(approvalId)
    if (!pending) {
      throw new WorkflowLaunchApprovalExpiredError()
    }
    this.assertExpectedParent(pending, expectedParentSessionId)
    this.deletePending(approvalId, pending)
    return pending.request
  }

  revoke(approvalId: string, expectedParentSessionId: string): boolean {
    this.prune()
    const pending = this.pending.get(approvalId)
    if (!pending) {
      return false
    }
    this.assertExpectedParent(pending, expectedParentSessionId)
    return this.deletePending(approvalId, pending)
  }

  close(): void {
    this.pending.clear()
    this.pendingBytes = 0
  }

  private prune(): void {
    const now = this.now()
    for (const [approvalId, pending] of this.pending) {
      if (pending.approval.expiresAt <= now) {
        this.deletePending(approvalId, pending)
      }
    }
  }

  private deletePending(approvalId: string, pending: PendingWorkflowApproval): boolean {
    if (!this.pending.delete(approvalId)) {
      return false
    }
    this.pendingBytes -= pending.byteLength
    if (this.pendingBytes < 0) {
      throw new Error('Workflow launch approval byte accounting underflowed.')
    }
    return true
  }

  private assertExpectedParent(
    pending: PendingWorkflowApproval,
    expectedParentSessionId: string | undefined
  ): void {
    if (
      expectedParentSessionId !== undefined &&
      pending.request.parentSessionId !== expectedParentSessionId
    ) {
      throw new WorkflowLaunchApprovalScopeError()
    }
  }
}
