import type { JsonValue } from '@shared/contracts/common'
import {
  WORKFLOW_INVOCATION_STATUSES,
  type WorkflowInvocation,
  type WorkflowRun
} from '@shared/workflow/domain'
import {
  WORKFLOW_PROJECTION_SCHEMA_VERSION,
  WORKFLOW_PROMPT_PREVIEW_MAX_BYTES,
  WORKFLOW_VALUE_PREVIEW_MAX_BYTES,
  WorkflowInvocationProjectionSchema,
  WorkflowRunDetailSchema,
  WorkflowRunSummarySchema,
  type WorkflowInvocationCounts,
  type WorkflowInvocationProjection,
  type WorkflowRunDetail,
  type WorkflowRunSummary,
  type WorkflowValuePreview,
  type WorkflowWaitingInteractionProjection
} from '@shared/workflow/projection'
import { WorkflowRunBudgetSchema } from '@shared/workflow/serviceContracts'
import type { WorkflowSourceOutline } from '@shared/workflow/outline'
import {
  createPartialWorkflowSourceOutline,
  deriveWorkflowSourceOutline
} from './runtime/workflowSourceOutline'

export function projectWorkflowRunSummary(
  run: WorkflowRun,
  invocations: readonly WorkflowInvocation[]
): WorkflowRunSummary {
  const invocationCounts = createInvocationCounts()
  for (const invocation of invocations) {
    invocationCounts[invocation.status] += 1
  }
  return projectWorkflowRunSummaryWithCounts(run, invocationCounts)
}

export function projectWorkflowRunSummaryWithCounts(
  run: WorkflowRun,
  invocationCounts: WorkflowInvocationCounts
): WorkflowRunSummary {
  return WorkflowRunSummarySchema.parse({
    schemaVersion: WORKFLOW_PROJECTION_SCHEMA_VERSION,
    id: run.id,
    parentSessionId: run.parentSessionId,
    parentMessageId: run.parentMessageId,
    namedWorkflowPath: run.namedWorkflowPath,
    workspacePath: run.workspacePath,
    capabilityScopeHash: run.capabilityScopeHash,
    scriptHash: run.scriptHash,
    runtimeApiVersion: run.runtimeApiVersion,
    status: run.status,
    phase: run.phase,
    error: run.error,
    usage: run.usage,
    cancellationReason: run.cancellationReason,
    interruptionReason: run.interruptionReason,
    resultDeliveryState: run.resultDeliveryState,
    resultDeliveryId: run.resultDeliveryId,
    invocationCounts,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt,
    revision: run.revision
  })
}

export function projectWorkflowRunDetail(
  run: WorkflowRun,
  invocations: readonly WorkflowInvocation[],
  waitingInteractions: ReadonlyMap<
    string,
    readonly WorkflowWaitingInteractionProjection[]
  > = new Map()
): WorkflowRunDetail {
  return WorkflowRunDetailSchema.parse({
    ...projectWorkflowRunSummary(run, invocations),
    limits: run.limits,
    allowedAgentIds: run.allowedAgentIds,
    budget: run.budget === null ? null : WorkflowRunBudgetSchema.parse(run.budget),
    outline: projectWorkflowSourceOutline(run.scriptSource),
    resultPreview: run.result === null ? null : createJsonPreview(run.result),
    invalidatedFromSeq: run.invalidatedFromSeq,
    invocations: invocations.map((invocation) =>
      projectWorkflowInvocation(invocation, waitingInteractions.get(invocation.id))
    )
  })
}

export function projectWorkflowInvocation(
  invocation: WorkflowInvocation,
  waitingInteractions: readonly WorkflowWaitingInteractionProjection[] = []
): WorkflowInvocationProjection {
  return WorkflowInvocationProjectionSchema.parse({
    id: invocation.id,
    runId: invocation.runId,
    seq: invocation.seq,
    callPath: invocation.callPath,
    attempt: invocation.attempt,
    executionEpoch: invocation.executionEpoch,
    key: invocation.request.options.key,
    label: invocation.request.options.label ?? null,
    phase: invocation.request.options.phase ?? null,
    agentId: invocation.request.options.agentId ?? null,
    promptPreview: createTextPreview(invocation.request.prompt, WORKFLOW_PROMPT_PREVIEW_MAX_BYTES),
    hasCustomSchema: invocation.request.options.schema !== undefined,
    inputHash: invocation.inputHash,
    policyHash: invocation.policyHash,
    childCorrelationSlot: invocation.childCorrelationSlot,
    childSessionId: invocation.childSessionId,
    status: invocation.status,
    timeoutDeadlineAt: invocation.timeoutDeadlineAt,
    resultPreview: invocation.result === null ? null : createJsonPreview(invocation.result),
    error: invocation.error,
    effectState: invocation.effectState,
    effectEvidence: invocation.effectEvidence,
    usage: invocation.usage,
    tapeLinkReceipt: invocation.tapeLinkReceipt,
    invalidatedAt: invocation.invalidatedAt,
    invalidationReason: invocation.invalidationReason,
    waitingInteractions,
    createdAt: invocation.createdAt,
    startedAt: invocation.startedAt,
    updatedAt: invocation.updatedAt,
    completedAt: invocation.completedAt
  })
}

function projectWorkflowSourceOutline(scriptSource: string): WorkflowSourceOutline {
  try {
    return deriveWorkflowSourceOutline(scriptSource)
  } catch {
    return createPartialWorkflowSourceOutline()
  }
}

function createInvocationCounts(): WorkflowInvocationCounts {
  return Object.fromEntries(
    WORKFLOW_INVOCATION_STATUSES.map((status) => [status, 0])
  ) as WorkflowInvocationCounts
}

function createJsonPreview(value: JsonValue): WorkflowValuePreview {
  return createTextPreview(JSON.stringify(value), WORKFLOW_VALUE_PREVIEW_MAX_BYTES)
}

function createTextPreview(
  value: string,
  maxBytes: number
): {
  text: string
  byteLength: number
  truncated: boolean
} {
  const encoded = Buffer.from(value, 'utf8')
  if (encoded.byteLength <= maxBytes) {
    return {
      text: value,
      byteLength: encoded.byteLength,
      truncated: false
    }
  }

  return {
    text: encoded
      .subarray(0, maxBytes)
      .toString('utf8')
      .replace(/\uFFFD$/u, ''),
    byteLength: encoded.byteLength,
    truncated: true
  }
}
