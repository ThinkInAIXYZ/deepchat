import { randomUUID } from 'node:crypto'
import {
  AgentInvocationAdmissionAbortedError,
  AgentInvocationAdmissionClosedError,
  AgentInvocationAdmissionQueueFullError,
  type AgentInvocationPermit
} from '@/agent/invocationAdmission'
import type { JsonValue } from '@shared/contracts/common'
import type {
  WorkflowExecutionSnapshot,
  WorkflowInvocation,
  WorkflowRun,
  WorkflowRunStatus
} from '@shared/workflow/domain'
import { isWorkflowExecutionSnapshotUnavailable } from '@shared/workflow/domain'
import type { WorkflowInvocationCounts } from '@shared/workflow/projection'
import type { WorkflowSynthesisReceipt } from '@shared/workflow/resultDelivery'
import {
  WORKFLOW_RUNTIME_API_VERSION,
  WORKFLOW_RUNTIME_PROTOCOL_VERSION,
  type WorkflowGuestAgentRequest,
  type WorkflowInvocationError,
  type WorkflowInvocationOutcome,
  type WorkflowRuntimeCommand,
  type WorkflowRuntimeEvent
} from '@shared/workflow/runtimeProtocol'
import {
  WORKFLOW_DEFAULT_EXECUTION_TIMEOUT_MS,
  WorkflowRunBudgetSchema,
  WorkflowLaunchIntentSchema,
  WorkflowUsageSchema,
  type WorkflowLaunchApproval,
  type WorkflowLaunchIntent,
  type WorkflowRunBudget,
  type WorkflowUsage
} from '@shared/workflow/serviceContracts'
import { WorkflowLaunchApprovalRegistry } from './launchApproval'
import { assertCurrentWorkflowRunScope, WorkflowCapabilityScopeChangedError } from './launchScope'
import type { WorkflowRepository } from './repository'
import type { WorkflowRunAdmissionPort } from './runAdmission'
import {
  WorkflowUtilityProcessHost,
  type WorkflowUtilityProcessHostOptions
} from './runtime/workflowUtilityProcessHost'
import logger from '@shared/logger'
import { canonicalizeWorkflowExecutionSnapshot } from './domain/executionSnapshot'

const DEFAULT_CANCEL_GRACE_MS = 10_000
const STOP_SETTLE_MS = 12_000
const MAX_STARTUP_RESULT_DELIVERIES = 500
const MAX_QUEUED_RUN_SCAN = 500

const ACTIVE_RUN_STATUSES = new Set<WorkflowRunStatus>([
  'running',
  'waiting_interaction',
  'cancelling'
])
const TERMINAL_RUN_STATUSES = new Set<WorkflowRunStatus>([
  'succeeded',
  'failed',
  'cancelled',
  'interrupted'
])
const ACTIVE_INVOCATION_STATUSES = new Set<WorkflowInvocation['status']>([
  'queued',
  'admitted',
  'running',
  'waiting_interaction'
])

class WorkflowExecutionSnapshotUnavailableError extends Error {
  constructor() {
    super('Workflow launch-time model settings are unavailable for this legacy run.')
    this.name = 'WorkflowExecutionSnapshotUnavailableError'
  }
}

export interface WorkflowChildExecutionPort {
  execute(invocationId: string, options?: { signal?: AbortSignal }): Promise<WorkflowInvocation>
}

export interface WorkflowScopeRequest {
  parentSessionId: string
  parentMessageId: string | null
  allowedAgentIds: string[]
}

export interface WorkflowCapabilityScopeResolution {
  workspacePath: string | null
  allowedAgentIds: string[]
  capabilityScopeHash: string
  capabilities: string[]
}

export interface WorkflowLaunchScopePort {
  resolve(
    input: WorkflowScopeRequest
  ): Promise<WorkflowCapabilityScopeResolution & { executionSnapshot: WorkflowExecutionSnapshot }>
  resolveCapabilityScope(input: WorkflowScopeRequest): Promise<WorkflowCapabilityScopeResolution>
}

export interface WorkflowUtilityHostPort {
  start(command: Extract<WorkflowRuntimeCommand, { type: 'START' }>): Promise<unknown>
  settleInvocation(requestId: string, outcome: WorkflowInvocationOutcome): void
  cancel(reason: string): void
  shutdown(): void
  kill(): void
}

export type WorkflowUtilityHostFactory = (
  options: WorkflowUtilityProcessHostOptions
) => WorkflowUtilityHostPort

export interface WorkflowResultDeliveryPort {
  deliver(run: WorkflowRun): boolean
  recoverPending(limit?: number): {
    attempted: number
    delivered: number
    failed: number
  }
  synthesize(run: WorkflowRun): Promise<WorkflowSynthesisReceipt>
}

export type WorkflowServiceUpdate =
  | {
      type: 'run_changed'
      runId: string
      parentSessionId: string
      status: WorkflowRunStatus
      revision: number
      updatedAt: number
    }
  | {
      type: 'invocation_changed'
      runId: string
      parentSessionId: string
      invocation: WorkflowInvocation
    }
  | {
      type: 'log'
      runId: string
      value: JsonValue
      createdAt: number
    }

export interface WorkflowServiceOptions {
  repository: WorkflowRepository
  childExecutor: WorkflowChildExecutionPort
  runAdmission: WorkflowRunAdmissionPort
  launchScope: WorkflowLaunchScopePort
  resultDelivery: WorkflowResultDeliveryPort
  approvals?: WorkflowLaunchApprovalRegistry
  hostFactory?: WorkflowUtilityHostFactory
  onUpdate?: (update: WorkflowServiceUpdate) => void
  now?: () => number
  idFactory?: () => string
  cancelGraceMs?: number
}

export interface WorkflowLaunchPreparationConstraints {
  expectedWorkspacePath: string | null
}

type RunStartMode = 'launch' | 'resume'

interface ScheduledRun {
  controller: AbortController
  mode: RunStartMode
  promise: Promise<void>
}

interface ActiveRunExecution {
  runId: string
  controller: AbortController
  host: WorkflowUtilityHostPort
  invocationTasks: Map<string, Promise<void>>
  done: Deferred<void>
  terminalizing: boolean
  exited: boolean
  cancellationReason: string | null
  cancellationTimer: ReturnType<typeof setTimeout> | null
  executionTimer: ReturnType<typeof setTimeout> | null
}

export class WorkflowService {
  private readonly approvals: WorkflowLaunchApprovalRegistry
  private readonly hostFactory: WorkflowUtilityHostFactory
  private readonly now: () => number
  private readonly idFactory: () => string
  private readonly cancelGraceMs: number
  private readonly scheduled = new Map<string, ScheduledRun>()
  private readonly active = new Map<string, ActiveRunExecution>()
  private started = false
  private stopping = false
  private pumpingQueuedRuns = false
  private stopPromise: Promise<void> | null = null

  constructor(private readonly options: WorkflowServiceOptions) {
    this.now = options.now ?? Date.now
    this.approvals = options.approvals ?? new WorkflowLaunchApprovalRegistry(this.now)
    this.hostFactory =
      options.hostFactory ?? ((hostOptions) => new WorkflowUtilityProcessHost(hostOptions))
    this.idFactory = options.idFactory ?? randomUUID
    this.cancelGraceMs = options.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS
    if (!Number.isInteger(this.cancelGraceMs) || this.cancelGraceMs < 100) {
      throw new Error('Workflow cancellation grace must be at least 100ms.')
    }
  }

  start(): void {
    if (this.started) {
      return
    }
    if (this.stopping) {
      throw new Error('Workflow service has already been stopped.')
    }
    try {
      this.options.repository.reconcileInterruptedRuns(
        'DeepChat restarted while the workflow utility process was active.',
        this.now()
      )
    } catch (error) {
      logger.warn('[WorkflowService] Failed to reconcile interrupted workflow runs', { error })
    }
    this.started = true
    try {
      this.options.resultDelivery.recoverPending(MAX_STARTUP_RESULT_DELIVERIES)
    } catch (error) {
      logger.warn('[WorkflowService] Failed to recover workflow result deliveries', { error })
    }
    this.pumpQueuedRuns()
  }

  async prepareLaunch(
    intent: WorkflowLaunchIntent,
    constraints?: WorkflowLaunchPreparationConstraints
  ): Promise<WorkflowLaunchApproval> {
    this.requireAvailable()
    const parsedIntent = WorkflowLaunchIntentSchema.parse(intent)
    const requestedAgentIds = [...new Set(parsedIntent.allowedAgentIds)].sort()
    const resolved = await this.resolveLaunchScope({
      parentSessionId: parsedIntent.parentSessionId,
      parentMessageId: parsedIntent.parentMessageId ?? null,
      allowedAgentIds: requestedAgentIds
    })
    this.requireAvailable()
    if (constraints && resolved.workspacePath !== constraints.expectedWorkspacePath) {
      throw new Error('Workflow parent workspace changed while preparing the saved source.')
    }
    return this.approvals.prepare({
      ...parsedIntent,
      workspacePath: resolved.workspacePath,
      allowedAgentIds: resolved.allowedAgentIds,
      capabilityScopeHash: resolved.capabilityScopeHash,
      capabilities: resolved.capabilities,
      executionSnapshot: resolved.executionSnapshot
    })
  }

  getLaunchApproval(approvalId: string, expectedParentSessionId?: string): WorkflowLaunchApproval {
    this.requireAvailable()
    return this.approvals.get(approvalId, expectedParentSessionId)
  }

  async launch(approvalId: string, expectedParentSessionId?: string): Promise<WorkflowRun> {
    this.requireStarted()
    const request = this.approvals.consume(approvalId, expectedParentSessionId)
    const resolved = await this.resolveLaunchScope({
      parentSessionId: request.parentSessionId,
      parentMessageId: request.parentMessageId,
      allowedAgentIds: request.allowedAgentIds
    })
    this.requireStarted()
    if (resolved.workspacePath !== request.workspacePath) {
      throw new Error('Workflow parent workspace changed after launch approval.')
    }
    if (resolved.capabilityScopeHash !== request.capabilityScopeHash) {
      throw new Error('Workflow effective capability scope changed after launch approval.')
    }
    if (
      canonicalizeWorkflowExecutionSnapshot(resolved.executionSnapshot).sha256 !==
      canonicalizeWorkflowExecutionSnapshot(request.executionSnapshot).sha256
    ) {
      throw new Error('Workflow model or generation settings changed after launch approval.')
    }
    const run = this.options.repository.createRun({
      id: this.idFactory(),
      parentSessionId: request.parentSessionId,
      parentMessageId: request.parentMessageId,
      namedWorkflowPath: request.namedWorkflowPath,
      workspacePath: request.workspacePath,
      capabilityScopeHash: request.capabilityScopeHash,
      executionSnapshot: request.executionSnapshot,
      scriptSource: request.scriptSource,
      input: request.input,
      limits: request.limits,
      allowedAgentIds: request.allowedAgentIds,
      budget: request.budget,
      now: this.now()
    })
    this.emitRun(run.id)
    this.pumpQueuedRuns()
    return run
  }

  getRun(runId: string): WorkflowRun {
    return this.options.repository.requireRun(runId)
  }

  listRuns(parentSessionId: string, limit = 100): WorkflowRun[] {
    return this.options.repository.listRunsByParent(parentSessionId, limit)
  }

  listInvocations(runId: string): WorkflowInvocation[] {
    this.options.repository.requireRun(runId)
    return this.options.repository.listInvocations(runId)
  }

  getInvocationCounts(runIds: readonly string[]): Map<string, WorkflowInvocationCounts> {
    return this.options.repository.getInvocationCounts(runIds)
  }

  async synthesize(runId: string): Promise<WorkflowSynthesisReceipt> {
    this.requireStarted()
    const run = this.options.repository.requireRun(runId)
    if (run.status !== 'succeeded') {
      throw new Error(`Workflow run ${run.id} has no successful result to synthesize.`)
    }
    return await this.options.resultDelivery.synthesize(run)
  }

  cancel(runId: string, reason = 'Workflow cancelled by the user.'): WorkflowRun {
    this.requireAvailable()
    const cancellationReason = normalizeCancellationReason(reason)
    const run = this.options.repository.requireRun(runId)
    const scheduled = this.scheduled.get(runId)
    const execution = this.active.get(runId)
    if (run.status === 'queued') {
      if (scheduled) {
        scheduled.controller.abort(cancellationReason)
      }
      if (execution) {
        execution.cancellationReason = cancellationReason
        execution.controller.abort(cancellationReason)
      }
      try {
        this.reconcileCancelledRun(runId, cancellationReason)
        this.emitRun(runId)
      } finally {
        if (execution) {
          this.killExecutionHost(execution)
        }
      }
      return this.options.repository.requireRun(runId)
    }
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      if (scheduled) {
        scheduled.controller.abort(cancellationReason)
      }
      return run
    }

    if (!execution) {
      scheduled?.controller.abort(cancellationReason)
      this.reconcileCancelledRun(runId, cancellationReason)
      this.emitRun(runId)
      return this.options.repository.requireRun(runId)
    }

    if (run.status !== 'cancelling') {
      this.options.repository.setRunCancelling(runId, cancellationReason, this.now())
    }
    execution.cancellationReason = cancellationReason
    execution.controller.abort(cancellationReason)
    try {
      execution.host.cancel(cancellationReason)
    } catch {
      this.forceCancellation(execution)
      return this.options.repository.requireRun(runId)
    }
    if (!execution.cancellationTimer) {
      execution.cancellationTimer = setTimeout(
        () => this.forceCancellation(execution),
        this.cancelGraceMs
      )
    }
    this.emitRun(runId)
    return this.options.repository.requireRun(runId)
  }

  resume(runId: string): WorkflowRun {
    this.requireStarted()
    const run = this.options.repository.requireRun(runId)
    if (run.status === 'queued' && run.startedAt !== null) {
      this.pumpQueuedRuns()
      return run
    }
    if (run.status !== 'failed' && run.status !== 'interrupted') {
      throw new Error(`Workflow run ${runId} cannot be resumed from status ${run.status}.`)
    }
    const queued = this.options.repository.queueRunResume(run.id, this.now())
    this.emitRun(run.id)
    this.pumpQueuedRuns()
    return queued
  }

  retryInvocation(input: {
    runId: string
    invocationId: string
    fromHere?: boolean
    confirmEffects?: boolean
  }): WorkflowRun {
    this.requireStarted()
    const run = this.options.repository.requireRun(input.runId)
    if (run.status !== 'failed' && run.status !== 'interrupted') {
      throw new Error(`Workflow run ${run.id} must be failed or interrupted before retry.`)
    }
    const invocation = this.options.repository.requireInvocation(input.invocationId)
    if (invocation.runId !== run.id) {
      throw new Error(`Workflow invocation ${invocation.id} does not belong to run ${run.id}.`)
    }
    const latestInvocation = this.options.repository.findLatestAttempt(run.id, invocation.callPath)
    if (latestInvocation?.id !== invocation.id) {
      throw new Error(
        `Workflow invocation ${invocation.id} is not the latest attempt for ${invocation.callPath}.`
      )
    }
    const affectedInvocations = input.fromHere
      ? this.options.repository
          .listInvocations(run.id)
          .filter((candidate) => candidate.seq >= invocation.seq)
      : [invocation]
    const riskyInvocation = affectedInvocations.find(
      (candidate) => candidate.effectState === 'write' || candidate.effectState === 'unknown'
    )
    if (riskyInvocation && input.confirmEffects !== true) {
      throw new WorkflowEffectConfirmationRequiredError(riskyInvocation)
    }
    const reason = input.fromHere
      ? `Explicit retry from invocation ${invocation.id}.`
      : `Explicit retry of invocation ${invocation.id}.`
    if (input.fromHere) {
      this.options.repository.invalidateFrom(run.id, invocation.seq, reason, this.now())
    } else {
      this.options.repository.invalidateInvocation(run.id, invocation.id, reason, this.now())
    }
    for (const affected of affectedInvocations) {
      this.emitInvocation(this.options.repository.requireInvocation(affected.id))
    }
    const queued = this.options.repository.queueRunResume(run.id, this.now())
    this.emitRun(run.id)
    this.pumpQueuedRuns()
    return queued
  }

  stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise
    }
    this.stopping = true
    this.stopPromise = this.stopOnce()
    return this.stopPromise
  }

  private async stopOnce(): Promise<void> {
    this.approvals.close()
    const scheduledTasks = [...this.scheduled.values()].map(({ promise }) => promise)
    const childTasks = [...this.active.values()].flatMap((execution) => [
      ...execution.invocationTasks.values()
    ])
    for (const scheduled of this.scheduled.values()) {
      scheduled.controller.abort('Workflow service is stopping.')
    }
    for (const execution of this.active.values()) {
      execution.controller.abort('Workflow service is stopping.')
      try {
        if (ACTIVE_RUN_STATUSES.has(this.options.repository.requireRun(execution.runId).status)) {
          this.reconcileInterruptedRun(
            execution.runId,
            'DeepChat stopped while the workflow was active.'
          )
          this.emitRun(execution.runId)
        }
      } catch (error) {
        console.error(
          `[WorkflowService] Failed to persist shutdown interruption for run=${execution.runId}:`,
          error
        )
      } finally {
        this.killExecutionHost(execution)
      }
    }
    const [runsSettled, childrenSettled] = await Promise.all([
      settleWithin(scheduledTasks, STOP_SETTLE_MS),
      settleWithin(childTasks, STOP_SETTLE_MS)
    ])
    if (!runsSettled) {
      console.warn('Workflow utility processes did not exit before service shutdown.')
    }
    if (!childrenSettled) {
      console.warn('Workflow child invocations did not settle before service shutdown.')
    }
  }

  private schedule(run: WorkflowRun, mode: RunStartMode): void {
    if (this.scheduled.has(run.id)) {
      return
    }
    const controller = new AbortController()
    const scheduled: ScheduledRun = {
      controller,
      mode,
      promise: Promise.resolve()
    }
    const promise = this.runScheduled(run.id, scheduled)
    scheduled.promise = promise
    this.scheduled.set(run.id, scheduled)
    void promise
      .finally(() => {
        if (this.scheduled.get(run.id) !== scheduled) {
          return
        }
        this.scheduled.delete(run.id)
        this.pumpQueuedRuns()
      })
      .catch((error) => {
        console.error(`[WorkflowService] Scheduled run cleanup failed for run=${run.id}:`, error)
      })
  }

  private pumpQueuedRuns(): void {
    if (
      !this.started ||
      this.stopping ||
      this.pumpingQueuedRuns ||
      this.options.runAdmission.availableSchedulingSlots() <= 0
    ) {
      return
    }
    this.pumpingQueuedRuns = true
    try {
      const runIds = this.options.repository.listQueuedRunIds(MAX_QUEUED_RUN_SCAN)
      let availableSlots = this.options.runAdmission.availableSchedulingSlots()
      for (const runId of runIds) {
        if (availableSlots <= 0) {
          break
        }
        if (this.scheduled.has(runId)) {
          continue
        }
        try {
          const run = this.options.repository.getRun(runId)
          if (!run || run.status !== 'queued') {
            continue
          }
          this.schedule(run, run.startedAt === null ? 'launch' : 'resume')
          availableSlots -= 1
        } catch (error) {
          logger.warn('[WorkflowService] Skipping malformed queued workflow run', {
            runId,
            error
          })
        }
      }
    } catch (error) {
      logger.warn('[WorkflowService] Failed to scan queued workflow runs', { error })
    } finally {
      this.pumpingQueuedRuns = false
    }
  }

  private async runScheduled(runId: string, scheduled: ScheduledRun): Promise<void> {
    let permit: AgentInvocationPermit | null = null
    try {
      const run = this.options.repository.requireRun(runId)
      if (isWorkflowExecutionSnapshotUnavailable(run.executionSnapshot)) {
        throw new WorkflowExecutionSnapshotUnavailableError()
      }
      permit = await this.options.runAdmission.acquire({
        ownerId: run.parentSessionId,
        signal: scheduled.controller.signal
      })
      scheduled.controller.signal.throwIfAborted()
      await this.executeRun(runId, scheduled.mode, scheduled.controller)
    } catch (error) {
      this.handleScheduleFailure(runId, error)
    } finally {
      permit?.release()
    }
  }

  private async executeRun(
    runId: string,
    mode: RunStartMode,
    controller: AbortController
  ): Promise<void> {
    controller.signal.throwIfAborted()
    const persistedRun = this.options.repository.requireRun(runId)
    await assertCurrentWorkflowRunScope(this.options.launchScope, persistedRun)
    controller.signal.throwIfAborted()
    const run =
      mode === 'launch'
        ? this.options.repository.startRun(runId, this.now())
        : this.options.repository.resumeRun(runId, this.now())
    let execution: ActiveRunExecution | null = null
    try {
      const done = deferred<void>()
      const host = this.hostFactory({
        runId,
        onEvent: (event) => {
          if (execution) {
            this.handleHostEvent(execution, event)
          }
        },
        onExit: (event) => {
          if (execution) {
            this.handleHostExit(execution, event)
          }
        }
      })
      execution = {
        runId,
        controller,
        host,
        invocationTasks: new Map(),
        done,
        terminalizing: false,
        exited: false,
        cancellationReason: null,
        cancellationTimer: null,
        executionTimer: null
      }
      this.active.set(runId, execution)
      this.armExecutionBudget(execution, run)
      this.emitRun(runId)
      await host.start({
        type: 'START',
        protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
        runtimeApiVersion: WORKFLOW_RUNTIME_API_VERSION,
        runId,
        source: run.scriptSource,
        input: run.input,
        limits: run.limits
      })
      await done.promise
    } catch (error) {
      if (execution && !execution.exited) {
        execution.controller.abort(error)
        try {
          this.failActiveRun(execution, {
            code: 'WORKFLOW_HOST_START_FAILED',
            message: normalizeErrorMessage(error),
            retriable: true
          })
        } finally {
          this.killExecutionHost(execution)
          await execution.done.promise
        }
      } else if (!execution) {
        const current = this.options.repository.requireRun(runId)
        if (ACTIVE_RUN_STATUSES.has(current.status)) {
          this.options.repository.failRun(
            runId,
            {
              code: 'WORKFLOW_HOST_CREATE_FAILED',
              message: normalizeErrorMessage(error),
              retriable: true
            },
            this.now()
          )
          this.emitRun(runId)
        }
      }
    } finally {
      if (execution) {
        this.clearExecutionTimers(execution)
        if (this.active.get(runId) === execution) {
          this.active.delete(runId)
        }
      }
    }
  }

  private handleHostEvent(execution: ActiveRunExecution, event: WorkflowRuntimeEvent): void {
    if (execution.exited || event.type === 'READY') {
      return
    }
    if (execution.terminalizing) {
      return
    }

    switch (event.type) {
      case 'INVOKE_AGENT': {
        if (execution.invocationTasks.has(event.requestId)) {
          this.failProtocol(
            execution,
            `Workflow utility reused invocation request ${event.requestId}.`
          )
          return
        }
        const task = this.handleInvocation(execution, event.requestId, event.request)
        execution.invocationTasks.set(event.requestId, task)
        void task.then(() => {
          if (execution.invocationTasks.get(event.requestId) === task) {
            execution.invocationTasks.delete(event.requestId)
          }
          this.emitRun(execution.runId)
        })
        return
      }
      case 'PHASE':
        this.options.repository.updatePhase(
          execution.runId,
          {
            key: event.key,
            ...(event.label ? { label: event.label } : {}),
            ...(event.detail === undefined ? {} : { detail: event.detail })
          },
          this.now()
        )
        this.emitRun(execution.runId)
        return
      case 'LOG':
        this.emitUpdate({
          type: 'log',
          runId: execution.runId,
          value: event.value,
          createdAt: this.now()
        })
        return
      case 'COMPLETE':
        execution.terminalizing = true
        this.runFinalizer(execution, this.finalizeSuccess(execution, event.value))
        return
      case 'FAILED':
        execution.terminalizing = true
        this.runFinalizer(execution, this.finalizeFailure(execution, event.error))
        return
    }
  }

  private async handleInvocation(
    execution: ActiveRunExecution,
    requestId: string,
    request: WorkflowGuestAgentRequest
  ): Promise<void> {
    let outcome: WorkflowInvocationOutcome
    try {
      outcome = await this.resolveInvocation(execution, request)
    } catch (error) {
      if (
        error instanceof WorkflowCapabilityScopeChangedError &&
        !execution.exited &&
        !execution.terminalizing
      ) {
        execution.terminalizing = true
        this.runFinalizer(
          execution,
          this.finalizeFailure(execution, {
            code: 'WORKFLOW_CAPABILITY_SCOPE_CHANGED',
            message: normalizeErrorMessage(error),
            retriable: false
          })
        )
      }
      outcome = {
        status: 'error',
        error: toServiceInvocationError(error)
      }
    }
    if (!execution.exited) {
      try {
        execution.host.settleInvocation(requestId, outcome)
      } catch (error) {
        if (!execution.exited) {
          this.failProtocol(
            execution,
            `Workflow invocation settlement failed: ${normalizeErrorMessage(error)}`
          )
        }
      }
    }
  }

  private async resolveInvocation(
    execution: ActiveRunExecution,
    request: WorkflowGuestAgentRequest
  ): Promise<WorkflowInvocationOutcome> {
    if (execution.controller.signal.aborted) {
      return {
        status: 'error',
        error: {
          code: 'WORKFLOW_RUN_STOPPED',
          message: normalizeAbortReason(execution.controller.signal.reason),
          retriable: true
        }
      }
    }
    await assertCurrentWorkflowRunScope(
      this.options.launchScope,
      this.options.repository.requireRun(execution.runId)
    )
    if (execution.controller.signal.aborted) {
      return {
        status: 'error',
        error: {
          code: 'WORKFLOW_RUN_STOPPED',
          message: normalizeAbortReason(execution.controller.signal.reason),
          retriable: true
        }
      }
    }
    const replay = this.options.repository.findReplayOutcome(execution.runId, request)
    if (replay) {
      return invocationOutcome(replay)
    }

    const latest = this.options.repository.findLatestAttempt(execution.runId, request.callPath)
    if (latest && ACTIVE_INVOCATION_STATUSES.has(latest.status)) {
      return {
        status: 'error',
        error: {
          code: 'WORKFLOW_INVOCATION_ALREADY_ACTIVE',
          message: `Invocation path ${request.callPath} already has active attempt ${latest.id}.`,
          retriable: false
        }
      }
    }
    const budgetError = this.checkTokenBudget(execution.runId)
    if (budgetError) {
      return { status: 'error', error: budgetError }
    }
    if (
      latest &&
      latest.invalidatedAt === null &&
      (latest.status === 'interrupted' || latest.status === 'cancelled') &&
      (latest.effectState === 'write' || latest.effectState === 'unknown')
    ) {
      return {
        status: 'error',
        error: {
          code: 'WORKFLOW_RETRY_CONFIRMATION_REQUIRED',
          message: `Invocation ${latest.id} may have external effects and requires explicit retry confirmation.`,
          retriable: true
        }
      }
    }

    const invocation = this.options.repository.createInvocation({
      id: this.idFactory(),
      runId: execution.runId,
      request,
      now: this.now()
    })
    this.emitInvocation(invocation)
    this.emitRun(execution.runId)
    const terminal = await this.options.childExecutor.execute(invocation.id, {
      signal: execution.controller.signal
    })
    return invocationOutcome(terminal)
  }

  private async finalizeSuccess(execution: ActiveRunExecution, result: JsonValue): Promise<void> {
    await Promise.allSettled(execution.invocationTasks.values())
    if (execution.exited) {
      return
    }
    try {
      const run = this.options.repository.requireRun(execution.runId)
      if (!ACTIVE_RUN_STATUSES.has(run.status)) {
        this.shutdownExecutionHost(execution)
        return
      }
      const completedRun = this.options.repository.succeedRun(
        execution.runId,
        result,
        this.idFactory(),
        aggregateRunUsage(this.options.repository.listInvocations(execution.runId)),
        this.now()
      )
      this.emitRun(execution.runId)
      this.tryDeliverResult(completedRun)
      this.shutdownExecutionHost(execution)
    } catch (error) {
      await this.finalizeFailure(execution, {
        code: 'WORKFLOW_COMPLETION_FAILED',
        message: normalizeErrorMessage(error),
        retriable: true
      })
    }
  }

  private async finalizeFailure(
    execution: ActiveRunExecution,
    error: WorkflowInvocationError
  ): Promise<void> {
    execution.controller.abort(error.message)
    await Promise.allSettled(execution.invocationTasks.values())
    if (execution.exited) {
      return
    }
    const run = this.options.repository.requireRun(execution.runId)
    if (run.status === 'cancelling' || execution.cancellationReason) {
      this.reconcileCancelledRun(execution.runId, execution.cancellationReason ?? error.message)
    } else if (ACTIVE_RUN_STATUSES.has(run.status)) {
      this.options.repository.failRun(execution.runId, error, this.now())
    }
    this.emitRun(execution.runId)
    this.shutdownExecutionHost(execution)
  }

  private handleHostExit(
    execution: ActiveRunExecution,
    event: { runId: string; code: number; expected: boolean }
  ): void {
    if (execution.exited) {
      return
    }
    execution.exited = true
    execution.controller.abort(`Workflow utility exited with code ${event.code}.`)
    try {
      const run = this.options.repository.requireRun(execution.runId)
      if (ACTIVE_RUN_STATUSES.has(run.status)) {
        if (run.status === 'cancelling' || execution.cancellationReason) {
          this.reconcileCancelledRun(
            execution.runId,
            execution.cancellationReason ?? 'Workflow cancellation stopped its utility process.'
          )
        } else {
          const qualifier = event.expected ? 'before reaching a terminal state' : 'unexpectedly'
          this.reconcileInterruptedRun(
            execution.runId,
            `Workflow utility exited ${qualifier} with code ${event.code}.`
          )
        }
        this.emitRun(execution.runId)
      }
    } catch (error) {
      console.error(
        `[WorkflowService] Failed to reconcile utility exit for run=${execution.runId}:`,
        error
      )
    } finally {
      execution.done.resolve()
    }
  }

  private armExecutionBudget(execution: ActiveRunExecution, run: WorkflowRun): void {
    const budget = parseBudget(run)
    const maxExecutionMs = budget?.maxExecutionMs ?? WORKFLOW_DEFAULT_EXECUTION_TIMEOUT_MS
    execution.executionTimer = setTimeout(() => {
      if (execution.exited || execution.terminalizing) {
        return
      }
      execution.terminalizing = true
      try {
        execution.host.cancel('Workflow execution wall-clock budget exhausted.')
      } catch (error) {
        console.warn(
          `[WorkflowService] Failed to signal execution timeout for run=${execution.runId}:`,
          error
        )
      }
      this.runFinalizer(
        execution,
        this.finalizeFailure(execution, {
          code: 'WORKFLOW_EXECUTION_BUDGET_EXCEEDED',
          message: `Workflow execution exceeded ${maxExecutionMs}ms.`,
          retriable: true
        })
      )
    }, maxExecutionMs)
  }

  private checkTokenBudget(runId: string): WorkflowInvocationError | null {
    const run = this.options.repository.requireRun(runId)
    const budget = parseBudget(run)
    if (!budget?.maxTotalTokens) {
      return null
    }
    const totalTokens = this.options.repository.getTotalTokenUsage(runId)
    return totalTokens >= budget.maxTotalTokens
      ? {
          code: 'WORKFLOW_TOKEN_BUDGET_EXCEEDED',
          message: `Workflow token budget is exhausted (${totalTokens}/${budget.maxTotalTokens}).`,
          retriable: false
        }
      : null
  }

  private failProtocol(execution: ActiveRunExecution, message: string): void {
    if (execution.exited || execution.terminalizing) {
      return
    }
    execution.terminalizing = true
    this.runFinalizer(
      execution,
      this.finalizeFailure(execution, {
        code: 'WORKFLOW_PROTOCOL_ERROR',
        message,
        retriable: false
      })
    )
  }

  private failActiveRun(execution: ActiveRunExecution, error: WorkflowInvocationError): void {
    const run = this.options.repository.requireRun(execution.runId)
    if (run.status === 'cancelling' || execution.cancellationReason) {
      this.reconcileCancelledRun(execution.runId, execution.cancellationReason ?? error.message)
    } else if (ACTIVE_RUN_STATUSES.has(run.status)) {
      this.options.repository.failRun(execution.runId, error, this.now())
    }
    this.emitRun(execution.runId)
  }

  private forceCancellation(execution: ActiveRunExecution): void {
    if (execution.exited) {
      return
    }
    try {
      this.reconcileCancelledRun(
        execution.runId,
        execution.cancellationReason ?? 'Workflow cancellation grace period expired.'
      )
      this.emitRun(execution.runId)
    } catch (error) {
      console.error(
        `[WorkflowService] Failed to persist forced cancellation for run=${execution.runId}:`,
        error
      )
    } finally {
      this.killExecutionHost(execution)
    }
  }

  private handleScheduleFailure(runId: string, error: unknown): void {
    const run = this.options.repository.getRun(runId)
    if (!run || TERMINAL_RUN_STATUSES.has(run.status) || this.stopping) {
      return
    }
    if (error instanceof AgentInvocationAdmissionAbortedError) {
      return
    }
    if (error instanceof WorkflowCapabilityScopeChangedError) {
      if (run.status === 'queued' || ACTIVE_RUN_STATUSES.has(run.status)) {
        this.options.repository.failRun(
          runId,
          {
            code: 'WORKFLOW_CAPABILITY_SCOPE_CHANGED',
            message: normalizeErrorMessage(error),
            retriable: false
          },
          this.now()
        )
        this.emitRun(runId)
      }
      return
    }
    if (error instanceof WorkflowExecutionSnapshotUnavailableError) {
      if (run.status === 'queued' || ACTIVE_RUN_STATUSES.has(run.status)) {
        this.options.repository.failRun(
          runId,
          {
            code: 'WORKFLOW_EXECUTION_SNAPSHOT_UNAVAILABLE',
            message: normalizeErrorMessage(error),
            retriable: false
          },
          this.now()
        )
        this.emitRun(runId)
      }
      return
    }
    if (error instanceof AgentInvocationAdmissionQueueFullError) {
      logger.warn('[WorkflowService] Utility admission filled before a queued run was acquired', {
        runId,
        error
      })
      return
    }
    if (error instanceof AgentInvocationAdmissionClosedError) {
      if (run.status === 'queued') {
        this.options.repository.failRun(
          runId,
          {
            code: 'WORKFLOW_RUN_QUEUE_UNAVAILABLE',
            message: normalizeErrorMessage(error),
            retriable: true
          },
          this.now()
        )
        this.emitRun(runId)
      }
      return
    }
    if (run.status === 'queued') {
      this.options.repository.failRun(
        runId,
        {
          code: 'WORKFLOW_START_FAILED',
          message: normalizeErrorMessage(error),
          retriable: true
        },
        this.now()
      )
      this.emitRun(runId)
    } else if (ACTIVE_RUN_STATUSES.has(run.status)) {
      this.reconcileInterruptedRun(
        runId,
        `Workflow scheduling failed after activation: ${normalizeErrorMessage(error)}`
      )
      this.emitRun(runId)
    }
  }

  private clearExecutionTimers(execution: ActiveRunExecution): void {
    if (execution.cancellationTimer) {
      clearTimeout(execution.cancellationTimer)
      execution.cancellationTimer = null
    }
    if (execution.executionTimer) {
      clearTimeout(execution.executionTimer)
      execution.executionTimer = null
    }
  }

  private reconcileCancelledRun(runId: string, reason: string): void {
    const activeInvocationIds = this.listActiveInvocationIds(runId)
    this.options.repository.reconcileCancelledRun(runId, reason, this.now())
    this.emitInvocations(activeInvocationIds)
  }

  private reconcileInterruptedRun(runId: string, reason: string): void {
    const activeInvocationIds = this.listActiveInvocationIds(runId)
    this.options.repository.reconcileInterruptedRun(runId, reason, this.now())
    this.emitInvocations(activeInvocationIds)
  }

  private listActiveInvocationIds(runId: string): string[] {
    return this.options.repository
      .listInvocations(runId)
      .filter((invocation) => ACTIVE_INVOCATION_STATUSES.has(invocation.status))
      .map((invocation) => invocation.id)
  }

  private emitInvocations(invocationIds: readonly string[]): void {
    if (invocationIds.length === 0) {
      return
    }
    const invocations = invocationIds.map((invocationId) =>
      this.options.repository.requireInvocation(invocationId)
    )
    const run = this.options.repository.requireRun(invocations[0].runId)
    for (const invocation of invocations) {
      this.emitInvocation(invocation, run.parentSessionId)
    }
  }

  private emitRun(runId: string): void {
    const run = this.options.repository.requireRun(runId)
    this.emitUpdate({
      type: 'run_changed',
      runId: run.id,
      parentSessionId: run.parentSessionId,
      status: run.status,
      revision: run.revision,
      updatedAt: run.updatedAt
    })
  }

  private emitInvocation(invocation: WorkflowInvocation, parentSessionId?: string): void {
    const resolvedParentSessionId =
      parentSessionId ?? this.options.repository.requireRun(invocation.runId).parentSessionId
    this.emitUpdate({
      type: 'invocation_changed',
      runId: invocation.runId,
      parentSessionId: resolvedParentSessionId,
      invocation
    })
  }

  private emitUpdate(update: WorkflowServiceUpdate): void {
    try {
      this.options.onUpdate?.(update)
    } catch (error) {
      console.warn('[WorkflowService] Failed to publish workflow update:', error)
    }
  }

  private async resolveLaunchScope(input: {
    parentSessionId: string
    parentMessageId: string | null
    allowedAgentIds: string[]
  }): Promise<{
    workspacePath: string | null
    allowedAgentIds: string[]
    capabilityScopeHash: string
    capabilities: string[]
    executionSnapshot: WorkflowExecutionSnapshot
  }> {
    const requestedAgentIds = [...new Set(input.allowedAgentIds)].sort()
    const resolved = await this.options.launchScope.resolve({
      ...input,
      allowedAgentIds: requestedAgentIds
    })
    const resolvedAgentIds = [...new Set(resolved.allowedAgentIds)].sort()
    const executionSnapshot = canonicalizeWorkflowExecutionSnapshot(
      resolved.executionSnapshot
    ).snapshot
    if (isWorkflowExecutionSnapshotUnavailable(executionSnapshot)) {
      throw new WorkflowExecutionSnapshotUnavailableError()
    }
    if (
      resolvedAgentIds.length !== requestedAgentIds.length ||
      resolvedAgentIds.some((agentId, index) => agentId !== requestedAgentIds[index])
    ) {
      throw new Error('Workflow launch scope changed the requested target-agent allowlist.')
    }
    return {
      workspacePath: resolved.workspacePath,
      allowedAgentIds: resolvedAgentIds,
      capabilityScopeHash: resolved.capabilityScopeHash,
      capabilities: [...resolved.capabilities],
      executionSnapshot
    }
  }

  private runFinalizer(execution: ActiveRunExecution, finalizer: Promise<void>): void {
    void finalizer.catch((error) => {
      if (execution.exited) {
        return
      }
      execution.controller.abort(error)
      try {
        const run = this.options.repository.requireRun(execution.runId)
        if (ACTIVE_RUN_STATUSES.has(run.status)) {
          this.reconcileInterruptedRun(
            execution.runId,
            `Workflow terminal reconciliation failed: ${normalizeErrorMessage(error)}`
          )
          this.emitRun(execution.runId)
        }
      } catch (reconciliationError) {
        console.error(
          `[WorkflowService] Failed to persist terminal state for run=${execution.runId}:`,
          reconciliationError
        )
      }
      this.killExecutionHost(execution)
    })
  }

  private tryDeliverResult(run: WorkflowRun): void {
    try {
      if (this.options.resultDelivery.deliver(run)) {
        this.emitRun(run.id)
      }
    } catch (error) {
      logger.warn('[WorkflowService] Workflow succeeded but parent result delivery is pending', {
        runId: run.id,
        parentSessionId: run.parentSessionId,
        error
      })
    }
  }

  private shutdownExecutionHost(execution: ActiveRunExecution): void {
    try {
      execution.host.shutdown()
    } catch (error) {
      console.warn(
        `[WorkflowService] Graceful utility shutdown failed for run=${execution.runId}:`,
        error
      )
      this.killExecutionHost(execution)
    }
  }

  private killExecutionHost(execution: ActiveRunExecution): void {
    try {
      execution.host.kill()
    } catch (error) {
      console.error(`[WorkflowService] Failed to kill utility for run=${execution.runId}:`, error)
      if (!execution.exited) {
        execution.exited = true
        execution.done.resolve()
      }
    }
  }

  private requireAvailable(): void {
    if (this.stopping) {
      throw new Error('Workflow service is stopping.')
    }
  }

  private requireStarted(): void {
    this.requireAvailable()
    if (!this.started) {
      throw new Error('Workflow service has not started.')
    }
  }
}

export class WorkflowEffectConfirmationRequiredError extends Error {
  readonly invocationId: string
  readonly effectState: WorkflowInvocation['effectState']

  constructor(invocation: WorkflowInvocation) {
    super(
      `Workflow invocation ${invocation.id} has ${invocation.effectState} effects and requires confirmation.`
    )
    this.name = 'WorkflowEffectConfirmationRequiredError'
    this.invocationId = invocation.id
    this.effectState = invocation.effectState
  }
}

function invocationOutcome(invocation: WorkflowInvocation): WorkflowInvocationOutcome {
  if (invocation.status === 'succeeded') {
    return {
      status: 'success',
      value: invocation.result
    }
  }
  if (invocation.error) {
    return {
      status: 'error',
      error: invocation.error
    }
  }
  return {
    status: 'error',
    error: {
      code: 'WORKFLOW_INVOCATION_INCOMPLETE',
      message: `Workflow invocation ${invocation.id} stopped in status ${invocation.status}.`,
      retriable: true
    }
  }
}

function aggregateRunUsage(invocations: WorkflowInvocation[]): WorkflowUsage | null {
  const aggregate: Record<string, number> = Object.create(null)
  let totalTokens = 0
  let hasTokenAccounting = false
  let hasUsage = false
  for (const invocation of invocations) {
    if (invocation.usage === null) {
      continue
    }
    const parsed = WorkflowUsageSchema.safeParse(invocation.usage)
    if (!parsed.success) {
      throw new Error(`Workflow invocation ${invocation.id} has invalid usage accounting.`)
    }
    if (Object.keys(parsed.data).length === 0) {
      continue
    }
    hasUsage = true
    if (
      parsed.data.totalTokens !== undefined ||
      parsed.data.inputTokens !== undefined ||
      parsed.data.outputTokens !== undefined
    ) {
      totalTokens = addBoundedUsage(
        totalTokens,
        readTotalTokens(parsed.data),
        'Workflow total token accounting overflowed.'
      )
      hasTokenAccounting = true
    }
    for (const [key, value] of Object.entries(parsed.data)) {
      aggregate[key] = addBoundedUsage(
        aggregate[key] ?? 0,
        value,
        'Workflow usage accounting overflowed.'
      )
    }
  }
  if (hasTokenAccounting) {
    aggregate.totalTokens = totalTokens
  }
  return hasUsage ? WorkflowUsageSchema.parse(aggregate) : null
}

function readTotalTokens(usage: WorkflowUsage): number {
  if (usage.totalTokens !== undefined) {
    if (!Number.isSafeInteger(usage.totalTokens)) {
      throw new Error('Workflow total token accounting must be a non-negative safe integer.')
    }
    return usage.totalTokens
  }
  const total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
  if (
    !Number.isSafeInteger(usage.inputTokens ?? 0) ||
    !Number.isSafeInteger(usage.outputTokens ?? 0) ||
    !Number.isSafeInteger(total)
  ) {
    throw new Error('Workflow token usage accounting overflowed.')
  }
  return total
}

function addBoundedUsage(left: number, right: number, message: string): number {
  const total = left + right
  if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER) {
    throw new Error(message)
  }
  return total
}

function parseBudget(run: WorkflowRun): WorkflowRunBudget | null {
  return run.budget === null ? null : WorkflowRunBudgetSchema.parse(run.budget)
}

function toServiceInvocationError(error: unknown): WorkflowInvocationError {
  if (error instanceof WorkflowEffectConfirmationRequiredError) {
    return {
      code: 'WORKFLOW_RETRY_CONFIRMATION_REQUIRED',
      message: error.message,
      retriable: true
    }
  }
  if (error instanceof WorkflowCapabilityScopeChangedError) {
    return {
      code: 'WORKFLOW_CAPABILITY_SCOPE_CHANGED',
      message: normalizeErrorMessage(error),
      retriable: false
    }
  }
  return {
    code: 'WORKFLOW_INVOCATION_DISPATCH_FAILED',
    message: normalizeErrorMessage(error),
    retriable: true
  }
}

function normalizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return (message.trim() || 'Unknown workflow error.').slice(0, 8_192)
}

function normalizeCancellationReason(reason: string): string {
  return (reason.trim() || 'Workflow cancelled by the user.').slice(0, 2_048)
}

function normalizeAbortReason(reason: unknown): string {
  return reason === undefined
    ? 'Workflow run stopped before the invocation could start.'
    : normalizeErrorMessage(reason)
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

async function settleWithin(tasks: Promise<unknown>[], timeoutMs: number): Promise<boolean> {
  if (tasks.length === 0) {
    return true
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      Promise.allSettled(tasks).then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs)
      })
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}
