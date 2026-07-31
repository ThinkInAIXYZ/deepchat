import type { JsonValue } from '@shared/contracts/common'
import type {
  AgentSubagentToolPort,
  ConversationSessionInfo,
  CreateSubagentSessionInput
} from '@/tool/runtimePorts'
import type { AgentInvocationAdmissionPort } from '@/agent/invocationAdmission'
import type {
  WorkflowInvocation,
  WorkflowInvocationFailure,
  WorkflowRun,
  WorkflowTapeLinkReceipt
} from '@shared/workflow/domain'
import type { WorkflowUsage } from '@shared/workflow/serviceContracts'
import { awaitWithAbort } from '@/lib/awaitWithAbort'
import { ChildRuntimeTracker, type ChildTerminalState } from './childRuntimeTracker'
import type { WorkflowInvocationContextRegistry } from './invocationContextRegistry'
import { assertCurrentWorkflowRunScope, WorkflowCapabilityScopeChangedError } from './launchScope'
import type { WorkflowLaunchScopePort } from './service'
import { WorkflowStructuredOutputError } from './structuredOutput/errors'
import type {
  WorkflowPreparedStructuredOutput,
  WorkflowStructuredOutputLease,
  WorkflowStructuredOutputPort
} from './structuredOutput/contracts'

const CHILD_CANCELLATION_SETTLE_MS = 10_000
const RESULT_SUMMARY_MAX_LENGTH = 2_000
const STRUCTURED_OUTPUT_INSTRUCTION_MAX_LENGTH = 32 * 1024
const INVOCATION_ERROR_MESSAGE_MAX_LENGTH = 8_192

export const DEFAULT_WORKFLOW_RESULT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    text: {
      type: 'string'
    }
  },
  required: ['text'],
  additionalProperties: false
}) satisfies JsonValue

export interface WorkflowChildRepositoryPort {
  requireRun(runId: string): WorkflowRun
  requireInvocation(invocationId: string): WorkflowInvocation
  attachChildSession(invocationId: string, childSessionId: string, now?: number): WorkflowInvocation
  markInvocationAdmitted(invocationId: string, now?: number): WorkflowInvocation
  markInvocationRunning(invocationId: string, now?: number): WorkflowInvocation
  setInvocationWaiting(invocationId: string, now?: number): WorkflowInvocation
  recordInvocationTapeReceipt(
    invocationId: string,
    tapeLinkReceipt: JsonValue,
    now?: number
  ): WorkflowInvocation
  succeedInvocation(
    invocationId: string,
    result: JsonValue,
    tapeLinkReceipt: JsonValue,
    usage?: JsonValue | null,
    now?: number
  ): WorkflowInvocation
  failInvocation(
    invocationId: string,
    failure: WorkflowInvocationFailure,
    now?: number,
    usage?: JsonValue | null
  ): WorkflowInvocation
  recordTerminalInvocationUsage(
    invocationId: string,
    usage: JsonValue,
    now?: number
  ): WorkflowInvocation
}

export interface WorkflowChildSessionPort extends Pick<
  AgentSubagentToolPort,
  | 'createSubagentSession'
  | 'linkSubagentTape'
  | 'sendConversationMessage'
  | 'cancelConversation'
  | 'subscribeSessionRuntimeUpdates'
> {
  resolveSessionInfo(sessionId: string): Promise<ConversationSessionInfo | null>
  resolveAgentType(agentId: string): Promise<'deepchat' | 'acp' | null>
  findCorrelatedChild(
    parentSessionId: string,
    correlationSlot: string
  ): Promise<ConversationSessionInfo | null>
}

export interface WorkflowChildExecutorOptions {
  repository: WorkflowChildRepositoryPort
  sessions: WorkflowChildSessionPort
  admission: AgentInvocationAdmissionPort
  launchScope: WorkflowLaunchScopePort
  invocationContexts: WorkflowInvocationContextRegistry
  structuredOutput: WorkflowStructuredOutputPort
  onInvocationChanged?: (invocation: WorkflowInvocation) => void
  now?: () => number
}

export class WorkflowChildExecutor {
  private readonly now: () => number
  private readonly inFlightExecutions = new Map<string, Promise<WorkflowInvocation>>()

  constructor(private readonly options: WorkflowChildExecutorOptions) {
    this.now = options.now ?? Date.now
  }

  execute(invocationId: string, options?: { signal?: AbortSignal }): Promise<WorkflowInvocation> {
    const existing = this.inFlightExecutions.get(invocationId)
    if (existing) {
      return existing
    }

    const execution = this.executeOnce(invocationId, options)
    this.inFlightExecutions.set(invocationId, execution)
    const clearExecution = () => {
      if (this.inFlightExecutions.get(invocationId) === execution) {
        this.inFlightExecutions.delete(invocationId)
      }
    }
    void execution.then(clearExecution, clearExecution)
    return execution
  }

  private async executeOnce(
    invocationId: string,
    options?: { signal?: AbortSignal }
  ): Promise<WorkflowInvocation> {
    const initial = this.options.repository.requireInvocation(invocationId)
    if (isTerminalInvocation(initial)) {
      return initial
    }
    if (initial.status !== 'queued') {
      throw new Error(
        `Workflow invocation ${invocationId} cannot start from status ${initial.status}.`
      )
    }
    const run = this.options.repository.requireRun(initial.runId)
    const abortScope = createInvocationAbortScope(options?.signal, this.now)
    try {
      abortScope.signal.throwIfAborted()
      const preparedOutput = this.options.structuredOutput.prepare({
        schema: initial.request.options.schema ?? DEFAULT_WORKFLOW_RESULT_SCHEMA,
        maxResultBytes: resolveMaxResultBytes(initial, run)
      })
      const parent = await this.requireParent(run)
      const targetAgentId = initial.request.options.agentId ?? parent.agentId
      this.assertTargetAllowed(run, targetAgentId)
      const targetAgentType = await this.options.sessions.resolveAgentType(targetAgentId)
      if (targetAgentType !== 'deepchat') {
        throw new WorkflowChildConfigurationError(
          targetAgentType === 'acp' ? 'DIRECT_ACP_UNSUPPORTED' : 'TARGET_AGENT_UNAVAILABLE',
          targetAgentType === 'acp'
            ? 'Workflow children cannot target a direct ACP agent.'
            : `Workflow target agent is unavailable: ${targetAgentId}`
        )
      }
      return await this.options.admission.run(
        {
          ownerId: `workflow:${run.id}`,
          signal: abortScope.signal
        },
        async () =>
          await this.executeAdmitted({
            invocationId: initial.id,
            run,
            parent,
            targetAgentId,
            preparedOutput,
            signal: abortScope.signal,
            abortScope
          })
      )
    } catch (error) {
      if (error instanceof WorkflowInvocationOwnershipLostError) {
        throw error
      }
      const terminal = this.failActiveInvocation(initial.id, toInvocationFailure(error, abortScope))
      if (error instanceof WorkflowCapabilityScopeChangedError) {
        throw error
      }
      return terminal
    } finally {
      abortScope.dispose()
    }
  }

  private async executeAdmitted(input: {
    invocationId: string
    run: WorkflowRun
    parent: ConversationSessionInfo
    targetAgentId: string
    preparedOutput: WorkflowPreparedStructuredOutput
    signal: AbortSignal
    abortScope: InvocationAbortScope
  }): Promise<WorkflowInvocation> {
    const { invocationId, run, parent, targetAgentId, preparedOutput, signal, abortScope } = input
    signal.throwIfAborted()
    await assertCurrentWorkflowRunScope(this.options.launchScope, run)
    signal.throwIfAborted()
    let admitted: WorkflowInvocation
    try {
      admitted = this.options.repository.markInvocationAdmitted(invocationId, this.now())
    } catch (error) {
      if (this.options.repository.requireInvocation(invocationId).status !== 'queued') {
        throw new WorkflowInvocationOwnershipLostError(invocationId, { cause: error })
      }
      throw error
    }
    this.notifyInvocationChanged(admitted)
    abortScope.armTimeout(admitted.timeoutDeadlineAt)
    signal.throwIfAborted()

    let child: ConversationSessionInfo | null = null
    let tracker: ChildRuntimeTracker | null = null
    let outputLease: WorkflowStructuredOutputLease | null = null
    let releaseContext: (() => void) | null = null
    let contextMayRelease = true
    let shouldCancelChild = false
    let childAttached = false
    let childKnownStopped = false
    let invocationUsage: WorkflowUsage | null = null
    try {
      const resolvedChild = await this.resolveOrCreateChild(
        this.options.repository.requireInvocation(invocationId),
        run,
        parent,
        targetAgentId
      )
      child = resolvedChild.child
      shouldCancelChild = resolvedChild.created
      assertCorrelatedChild(
        child,
        this.options.repository.requireInvocation(invocationId),
        run,
        parent,
        targetAgentId
      )
      this.notifyInvocationChanged(
        this.options.repository.attachChildSession(invocationId, child.sessionId, this.now())
      )
      childAttached = true
      shouldCancelChild = true
      this.notifyInvocationChanged(
        this.options.repository.markInvocationRunning(invocationId, this.now())
      )

      releaseContext = this.options.invocationContexts.bind(child.sessionId, {
        runId: run.id,
        invocationId
      })
      contextMayRelease = false
      outputLease = preparedOutput.open({
        runId: run.id,
        invocationId,
        childSessionId: child.sessionId,
        providerId: child.providerId
      })
      void outputLease.result.catch(() => undefined)

      signal.throwIfAborted()
      const outputInstruction = requireStructuredOutputInstruction(outputLease.instruction)
      let handoff = buildWorkflowHandoff(
        this.options.repository.requireInvocation(invocationId),
        outputInstruction
      )
      let result: JsonValue
      while (true) {
        tracker = new ChildRuntimeTracker(
          child.sessionId,
          invocationId,
          this.options.repository,
          this.options.sessions.subscribeSessionRuntimeUpdates.bind(this.options.sessions),
          this.now,
          (invocation) => this.notifyInvocationChanged(invocation)
        )
        childKnownStopped = false
        await awaitWithAbort(
          this.options.sessions.sendConversationMessage(child.sessionId, handoff),
          signal
        )
        tracker.markStarted()
        const terminal = await awaitWithAbort(
          waitForChildTurn(tracker.terminal, outputLease.result),
          signal
        )
        childKnownStopped = true
        tracker.close()
        tracker = null
        invocationUsage = addUsage(invocationUsage, terminal.usage)
        if (terminal.status === 'error') {
          throw new WorkflowChildRuntimeError(
            summarizeText(terminal.responseMarkdown) || 'Workflow child session failed.'
          )
        }
        const correction = outputLease.completeTurn(terminal.answerMarkdown)
        if (correction) {
          handoff = buildWorkflowCorrectionHandoff(correction)
          continue
        }
        result = await awaitWithAbort(outputLease.result, signal)
        break
      }
      const receipt = await this.linkChildTape({
        run,
        invocation: this.options.repository.requireInvocation(invocationId),
        child,
        outcome: 'completed',
        resultSummary: summarizeJson(result)
      })
      this.options.repository.recordInvocationTapeReceipt(invocationId, receipt, this.now())
      const succeeded = this.options.repository.succeedInvocation(
        invocationId,
        result,
        receipt,
        invocationUsage,
        this.now()
      )
      contextMayRelease = true
      return succeeded
    } catch (error) {
      const failure = toInvocationFailure(error, abortScope)
      this.failActiveInvocation(invocationId, failure, invocationUsage)
      if (child && shouldCancelChild) {
        const childAlreadyStopped = childKnownStopped || tracker?.isTerminal === true
        if (childAlreadyStopped) {
          contextMayRelease = true
          if (childAttached) {
            await this.tryRecordFailureTape(run, invocationId, child, failure)
          }
        } else {
          const cancellation = await cancelChildWithinBound(this.options.sessions, child.sessionId)
          contextMayRelease = cancellation.stoppedWithinBound
          if (cancellation.stoppedWithinBound) {
            if (childAttached) {
              await this.tryRecordFailureTape(run, invocationId, child, failure)
            }
          } else if (!cancellation.completedWithinBound) {
            const releaseLateContext = releaseContext
            void cancellation.completion.then(async (stopped) => {
              if (!stopped) {
                return
              }
              if (childAttached) {
                await this.tryRecordFailureTape(run, invocationId, child!, failure)
              }
              releaseLateContext?.()
            })
          }
        }
      }
      return this.options.repository.requireInvocation(invocationId)
    } finally {
      outputLease?.close()
      tracker?.close()
      if (contextMayRelease) {
        releaseContext?.()
      }
    }
  }

  private notifyInvocationChanged(invocation: WorkflowInvocation): void {
    try {
      this.options.onInvocationChanged?.(invocation)
    } catch (error) {
      console.warn('[WorkflowChildExecutor] Failed to publish invocation update:', error)
    }
  }

  private async tryRecordFailureTape(
    run: WorkflowRun,
    invocationId: string,
    child: ConversationSessionInfo,
    failure: WorkflowInvocationFailure
  ): Promise<void> {
    const current = this.options.repository.requireInvocation(invocationId)
    if (current.tapeLinkReceipt) {
      return
    }
    const outcome = failure.status === 'failed' ? 'error' : 'cancelled'
    try {
      const receipt = await this.linkChildTape({
        run,
        invocation: current,
        child,
        outcome,
        resultSummary: failure.error.message
      })
      this.options.repository.recordInvocationTapeReceipt(invocationId, receipt, this.now())
    } catch (error) {
      // Failure remains durable and retryable even if lineage finalization needs recovery.
      console.warn(
        `[WorkflowChildExecutor] Failed to persist Tape lineage for invocation=${invocationId} child=${child.sessionId}:`,
        error
      )
    }
  }

  private async requireParent(run: WorkflowRun): Promise<ConversationSessionInfo> {
    const parent = await this.options.sessions.resolveSessionInfo(run.parentSessionId)
    if (!parent) {
      throw new WorkflowChildConfigurationError(
        'PARENT_SESSION_MISSING',
        `Workflow parent session does not exist: ${run.parentSessionId}`
      )
    }
    if (parent.agentType !== 'deepchat' || parent.sessionKind !== 'regular') {
      throw new WorkflowChildConfigurationError(
        'PARENT_SESSION_UNSUPPORTED',
        'Workflow runs require a regular DeepChat parent session.'
      )
    }
    return parent
  }

  private assertTargetAllowed(run: WorkflowRun, targetAgentId: string): void {
    if (!run.allowedAgentIds.includes(targetAgentId)) {
      throw new WorkflowChildConfigurationError(
        'TARGET_AGENT_NOT_ALLOWED',
        `Workflow target agent is outside the launch allowlist: ${targetAgentId}`
      )
    }
  }

  private async resolveOrCreateChild(
    invocation: WorkflowInvocation,
    run: WorkflowRun,
    parent: ConversationSessionInfo,
    targetAgentId: string
  ): Promise<{
    child: ConversationSessionInfo
    created: boolean
  }> {
    let child: ConversationSessionInfo | null
    let created = false
    if (invocation.childSessionId) {
      child = await this.options.sessions.resolveSessionInfo(invocation.childSessionId)
      if (!child) {
        throw new WorkflowChildConfigurationError(
          'WORKFLOW_CHILD_MISSING',
          `Persisted workflow child session is missing: ${invocation.childSessionId}`
        )
      }
    } else {
      child = await this.options.sessions.findCorrelatedChild(
        parent.sessionId,
        invocation.childCorrelationSlot
      )
      if (!child) {
        child = await this.options.sessions.createSubagentSession(
          buildChildCreationInput(invocation, run, parent, targetAgentId)
        )
        created = true
      }
    }
    if (!child) {
      throw new WorkflowChildConfigurationError(
        'WORKFLOW_CHILD_CREATE_FAILED',
        `Failed to create workflow child for ${invocation.callPath}.`
      )
    }
    return {
      child,
      created
    }
  }

  private async linkChildTape(input: {
    run: WorkflowRun
    invocation: WorkflowInvocation
    child: ConversationSessionInfo
    outcome: 'completed' | 'error' | 'cancelled'
    resultSummary: string | null
  }): Promise<WorkflowTapeLinkReceipt> {
    return await this.options.sessions.linkSubagentTape({
      parentSessionId: input.run.parentSessionId,
      childSessionId: input.child.sessionId,
      runId: input.run.id,
      taskId: input.invocation.id,
      slotId: input.invocation.childCorrelationSlot,
      taskTitle: input.invocation.request.options.label ?? input.invocation.request.options.key,
      outcome: input.outcome,
      resultSummary: input.resultSummary
    })
  }

  private failActiveInvocation(
    invocationId: string,
    failure: WorkflowInvocationFailure,
    usage: JsonValue | null = null
  ): WorkflowInvocation {
    const current = this.options.repository.requireInvocation(invocationId)
    if (isTerminalInvocation(current)) {
      return usage === null
        ? current
        : this.options.repository.recordTerminalInvocationUsage(invocationId, usage, this.now())
    }
    try {
      return this.options.repository.failInvocation(invocationId, failure, this.now(), usage)
    } catch (error) {
      const raced = this.options.repository.requireInvocation(invocationId)
      if (isTerminalInvocation(raced)) {
        return raced
      }
      throw error
    }
  }
}

function addUsage(accumulated: WorkflowUsage | null, next: WorkflowUsage): WorkflowUsage | null {
  if (Object.keys(next).length === 0) {
    return accumulated
  }
  const result: Record<string, number> = Object.assign(Object.create(null), accumulated)
  for (const [key, value] of Object.entries(next)) {
    const total = (result[key] ?? 0) + value
    if (!Number.isFinite(total) || total < 0 || total > Number.MAX_SAFE_INTEGER) {
      throw new WorkflowChildRuntimeError('Workflow child usage accounting overflowed.')
    }
    result[key] = total
  }
  return result as WorkflowUsage
}

interface InvocationAbortScope {
  signal: AbortSignal
  armTimeout(deadlineAt: number | null): void
  didTimeout(): boolean
  didCancel(): boolean
  dispose(): void
}

function createInvocationAbortScope(
  externalSignal: AbortSignal | undefined,
  now: () => number
): InvocationAbortScope {
  const controller = new AbortController()
  let timedOut = false
  let cancelled = false
  let timeoutArmed = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  const abortFromExternal = () => {
    if (controller.signal.aborted) {
      return
    }
    cancelled = true
    controller.abort(externalSignal?.reason)
  }
  externalSignal?.addEventListener('abort', abortFromExternal, { once: true })
  if (externalSignal?.aborted) {
    abortFromExternal()
  }

  const armTimeout = (deadlineAt: number | null) => {
    if (timeoutArmed) {
      throw new Error('Workflow invocation timeout is already armed.')
    }
    if (deadlineAt === null) {
      throw new Error('Admitted workflow invocation is missing its timeout deadline.')
    }
    timeoutArmed = true
    if (controller.signal.aborted) {
      return
    }
    const remaining = deadlineAt - now()
    const abortFromTimeout = () => {
      if (controller.signal.aborted) {
        return
      }
      timedOut = true
      controller.abort(new WorkflowInvocationTimeoutError())
    }
    if (remaining <= 0) {
      abortFromTimeout()
    } else {
      timeout = setTimeout(abortFromTimeout, remaining)
    }
  }

  return {
    signal: controller.signal,
    armTimeout,
    didTimeout: () => timedOut,
    didCancel: () => cancelled,
    dispose: () => {
      if (timeout !== undefined) {
        clearTimeout(timeout)
      }
      externalSignal?.removeEventListener('abort', abortFromExternal)
    }
  }
}

class WorkflowInvocationTimeoutError extends Error {
  constructor() {
    super('Workflow child invocation exceeded its host deadline.')
    this.name = 'WorkflowInvocationTimeoutError'
  }
}

class WorkflowInvocationOwnershipLostError extends Error {
  constructor(invocationId: string, options?: ErrorOptions) {
    super(`Workflow invocation ${invocationId} is already owned by another executor.`, options)
    this.name = 'WorkflowInvocationOwnershipLostError'
  }
}

class WorkflowChildRuntimeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowChildRuntimeError'
  }
}

class WorkflowChildConfigurationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'WorkflowChildConfigurationError'
  }
}

function toInvocationFailure(
  error: unknown,
  abortScope: Pick<InvocationAbortScope, 'didTimeout' | 'didCancel'>
): WorkflowInvocationFailure {
  if (abortScope.didTimeout() || error instanceof WorkflowInvocationTimeoutError) {
    return {
      status: 'timed_out',
      error: {
        code: 'INVOCATION_TIMEOUT',
        message: 'Workflow child invocation exceeded its host deadline.',
        retriable: true
      }
    }
  }
  if (abortScope.didCancel()) {
    return {
      status: 'cancelled',
      error: {
        code: 'INVOCATION_CANCELLED',
        message: 'Workflow child invocation was cancelled.',
        retriable: false
      }
    }
  }
  if (error instanceof WorkflowChildConfigurationError) {
    return {
      status: 'failed',
      error: {
        code: error.code,
        message: normalizeFailureMessage(error.message),
        retriable: false
      }
    }
  }
  if (error instanceof WorkflowCapabilityScopeChangedError) {
    return {
      status: 'failed',
      error: {
        code: 'WORKFLOW_CAPABILITY_SCOPE_CHANGED',
        message: normalizeFailureMessage(error.message),
        retriable: false
      }
    }
  }
  if (error instanceof WorkflowStructuredOutputError) {
    return {
      status: 'failed',
      error: {
        code: error.code,
        message: normalizeFailureMessage(error.message),
        retriable: error.retriable
      }
    }
  }
  return {
    status: 'failed',
    error: {
      code:
        error instanceof WorkflowChildRuntimeError
          ? 'CHILD_RUNTIME_FAILED'
          : 'CHILD_EXECUTION_FAILED',
      message: normalizeFailureMessage(error instanceof Error ? error.message : String(error)),
      retriable: true
    }
  }
}

function buildChildCreationInput(
  invocation: WorkflowInvocation,
  run: WorkflowRun,
  parent: ConversationSessionInfo,
  targetAgentId: string
): CreateSubagentSessionInput {
  return {
    parentSessionId: parent.sessionId,
    agentId: targetAgentId,
    parentAgentId: parent.agentId,
    slotId: invocation.childCorrelationSlot,
    displayName: invocation.request.options.label ?? invocation.request.options.key,
    targetAgentId: invocation.request.options.agentId ? targetAgentId : null,
    projectDir: run.workspacePath,
    providerId: parent.providerId,
    modelId: parent.modelId,
    permissionMode: parent.permissionMode,
    generationSettings: parent.generationSettings ?? undefined,
    disabledAgentTools: parent.disabledAgentTools,
    activeSkills: parent.activeSkills,
    workflowContext: {
      runId: run.id,
      invocationId: invocation.id,
      correlationSlot: invocation.childCorrelationSlot
    }
  }
}

function assertCorrelatedChild(
  child: ConversationSessionInfo,
  invocation: WorkflowInvocation,
  run: WorkflowRun,
  parent: ConversationSessionInfo,
  targetAgentId: string
): void {
  const workflow = child.subagentMeta?.workflow
  if (
    child.agentType !== 'deepchat' ||
    child.sessionKind !== 'subagent' ||
    child.parentSessionId !== parent.sessionId ||
    child.agentId !== targetAgentId ||
    child.subagentMeta?.slotId !== invocation.childCorrelationSlot ||
    workflow?.runId !== run.id ||
    workflow?.invocationId !== invocation.id ||
    workflow?.correlationSlot !== invocation.childCorrelationSlot
  ) {
    throw new WorkflowChildConfigurationError(
      'WORKFLOW_CHILD_CORRELATION_MISMATCH',
      `Correlated child session does not match workflow invocation ${invocation.id}.`
    )
  }
}

function resolveMaxResultBytes(invocation: WorkflowInvocation, run: WorkflowRun): number {
  return Math.min(
    invocation.request.options.maxOutputBytes ?? run.limits.maxResultBytes,
    run.limits.maxResultBytes
  )
}

function buildWorkflowHandoff(
  invocation: WorkflowInvocation,
  structuredOutputInstruction: string
): string {
  return [
    '# Workflow Invocation',
    '',
    `Logical path: ${invocation.callPath}`,
    `Task: ${invocation.request.prompt}`,
    '',
    'Output contract:',
    structuredOutputInstruction
  ].join('\n')
}

function buildWorkflowCorrectionHandoff(feedback: string): string {
  return ['# Workflow Output Correction', '', feedback].join('\n')
}

async function waitForChildTurn(
  terminal: Promise<ChildTerminalState>,
  outputResult: Promise<JsonValue>
): Promise<ChildTerminalState> {
  return await Promise.race([
    terminal,
    outputResult.then(
      async () => await terminal,
      (error) => Promise.reject(error)
    )
  ])
}

async function cancelChildWithinBound(
  sessions: Pick<WorkflowChildSessionPort, 'cancelConversation'>,
  childSessionId: string
): Promise<{
  stoppedWithinBound: boolean
  completedWithinBound: boolean
  completion: Promise<boolean>
}> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const cancellation = sessions.cancelConversation(childSessionId).then(
    () => true,
    () => false
  )
  try {
    const outcome = await Promise.race([
      cancellation.then((stopped) => ({ completedWithinBound: true, stopped })),
      new Promise<{ completedWithinBound: false; stopped: false }>((resolve) => {
        timeout = setTimeout(
          () => resolve({ completedWithinBound: false, stopped: false }),
          CHILD_CANCELLATION_SETTLE_MS
        )
      })
    ])
    return {
      stoppedWithinBound: outcome.stopped,
      completedWithinBound: outcome.completedWithinBound,
      completion: cancellation
    }
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout)
    }
  }
}

function isTerminalInvocation(invocation: WorkflowInvocation): boolean {
  return ['succeeded', 'failed', 'timed_out', 'cancelled', 'interrupted'].includes(
    invocation.status
  )
}

function summarizeJson(value: JsonValue): string {
  return summarizeText(JSON.stringify(value)) ?? 'Completed.'
}

function summarizeText(value: string): string | null {
  const normalized = value.trim()
  if (!normalized) {
    return null
  }
  return normalized.length <= RESULT_SUMMARY_MAX_LENGTH
    ? normalized
    : `${normalized.slice(0, RESULT_SUMMARY_MAX_LENGTH - 3)}...`
}

function requireStructuredOutputInstruction(value: string): string {
  const normalized = value.trim()
  if (
    !normalized ||
    Buffer.byteLength(normalized, 'utf8') > STRUCTURED_OUTPUT_INSTRUCTION_MAX_LENGTH
  ) {
    throw new Error(
      `Workflow structured-output instruction must contain 1-${STRUCTURED_OUTPUT_INSTRUCTION_MAX_LENGTH} bytes.`
    )
  }
  return normalized
}

function normalizeFailureMessage(value: string): string {
  const normalized = value.trim() || 'Workflow child execution failed.'
  return normalized.slice(0, INVOCATION_ERROR_MESSAGE_MAX_LENGTH)
}
