import { z } from 'zod'
import { JsonValueSchema, type JsonValue } from '../contracts/common'
import {
  WorkflowGuestAgentRequestSchema,
  WorkflowInvocationErrorSchema,
  WorkflowRuntimeLimitsSchema,
  type WorkflowGuestAgentRequest,
  type WorkflowRuntimeLimits
} from './runtimeProtocol'

export const WORKFLOW_RUN_STATUSES = [
  'queued',
  'running',
  'waiting_interaction',
  'cancelling',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted'
] as const

export const WORKFLOW_INVOCATION_STATUSES = [
  'queued',
  'admitted',
  'running',
  'waiting_interaction',
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
  'interrupted'
] as const

export const WORKFLOW_EFFECT_STATES = ['none', 'read', 'unknown', 'write'] as const
export const WORKFLOW_RESULT_DELIVERY_STATES = ['not_ready', 'pending', 'delivered'] as const
export const WORKFLOW_STORED_METADATA_MAX_BYTES = 64 * 1024
export const WORKFLOW_STORED_EVIDENCE_MAX_BYTES = 256 * 1024
export const WORKFLOW_STORED_JSON_MAX_BYTES = 8 * 1024 * 1024

export const WorkflowRunStatusSchema = z.enum(WORKFLOW_RUN_STATUSES)
export const WorkflowInvocationStatusSchema = z.enum(WORKFLOW_INVOCATION_STATUSES)
export const WorkflowEffectStateSchema = z.enum(WORKFLOW_EFFECT_STATES)
export const WorkflowResultDeliveryStateSchema = z.enum(WORKFLOW_RESULT_DELIVERY_STATES)

export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>
export type WorkflowInvocationStatus = z.infer<typeof WorkflowInvocationStatusSchema>
export type WorkflowEffectState = z.infer<typeof WorkflowEffectStateSchema>
export type WorkflowResultDeliveryState = z.infer<typeof WorkflowResultDeliveryStateSchema>

const StoredIdSchema = z.string().min(1).max(256)
const HashSchema = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]+$/)
const WorkspacePathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => !value.includes('\0'), 'Workspace path cannot contain NUL')
const TimestampSchema = z.number().int().nonnegative()

export const WorkflowTapeLinkReceiptSchema = z
  .object({
    linkEntry: z
      .object({
        sessionId: StoredIdSchema,
        entryId: z.number().int().positive()
      })
      .strict(),
    childSessionId: StoredIdSchema,
    childHeadEntryId: z.number().int().nonnegative(),
    childEntryCount: z.number().int().nonnegative(),
    outcome: z.enum(['completed', 'error', 'cancelled'])
  })
  .strict()
  .refine((receipt) => receipt.childEntryCount <= receipt.childHeadEntryId, {
    path: ['childEntryCount'],
    message: 'Child Tape entry count cannot exceed its frozen head'
  })

export type WorkflowTapeLinkReceipt = z.infer<typeof WorkflowTapeLinkReceiptSchema>

export const WorkflowEffectEvidenceSchema = z
  .object({
    toolId: z.string().trim().min(1).max(256),
    toolCallId: z.string().trim().min(1).max(256).optional(),
    source: z.enum(['builtin', 'mcp', 'plugin', 'shell', 'unknown']),
    basis: z.enum(['reviewed_contract', 'conservative_fallback']),
    classification: z.enum(['read', 'unknown', 'write']),
    reason: z.string().trim().min(1).max(1_024)
  })
  .strict()
  .superRefine((evidence, context) => {
    if (
      evidence.classification === 'read' &&
      (evidence.source !== 'builtin' || evidence.basis !== 'reviewed_contract')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['classification'],
        message: 'Read-only recovery requires a reviewed built-in tool contract'
      })
    }
    if (evidence.source === 'shell' && evidence.classification !== 'write') {
      context.addIssue({
        code: 'custom',
        path: ['classification'],
        message: 'Shell execution must be conservatively classified as write'
      })
    }
  })

export type WorkflowEffectEvidence = z.infer<typeof WorkflowEffectEvidenceSchema>

export const WorkflowRunSchema = z
  .object({
    id: StoredIdSchema,
    parentSessionId: StoredIdSchema,
    parentMessageId: StoredIdSchema.nullable(),
    namedWorkflowPath: z.string().max(4_096).nullable(),
    workspacePath: WorkspacePathSchema.nullable(),
    capabilityScopeHash: HashSchema,
    scriptSource: z.string().min(1),
    scriptHash: HashSchema,
    input: JsonValueSchema,
    runtimeApiVersion: z.number().int().positive(),
    limits: WorkflowRuntimeLimitsSchema,
    allowedAgentIds: z.array(StoredIdSchema).min(1).max(32),
    policyHash: HashSchema,
    budget: JsonValueSchema.nullable(),
    status: WorkflowRunStatusSchema,
    executionEpoch: z.number().int().positive(),
    nextInvocationSeq: z.number().int().positive(),
    phase: JsonValueSchema.nullable(),
    result: JsonValueSchema.nullable(),
    error: WorkflowInvocationErrorSchema.nullable(),
    usage: JsonValueSchema.nullable(),
    cancellationReason: z.string().max(8_192).nullable(),
    interruptionReason: z.string().max(8_192).nullable(),
    invalidatedFromSeq: z.number().int().positive().nullable(),
    resultDeliveryState: WorkflowResultDeliveryStateSchema,
    resultDeliveryId: StoredIdSchema.nullable(),
    createdAt: TimestampSchema,
    startedAt: TimestampSchema.nullable(),
    updatedAt: TimestampSchema,
    completedAt: TimestampSchema.nullable(),
    revision: z.number().int().nonnegative()
  })
  .strict()
  .superRefine((run, context) => {
    const terminal = ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(run.status)
    if (terminal !== (run.completedAt !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Terminal workflow runs must have a completion timestamp'
      })
    }
    if (run.status === 'succeeded') {
      if (run.resultDeliveryState === 'not_ready' || run.resultDeliveryId === null) {
        context.addIssue({
          code: 'custom',
          path: ['resultDeliveryState'],
          message: 'Succeeded workflow runs must have a durable pending or delivered result'
        })
      }
    } else if (run.resultDeliveryState !== 'not_ready' || run.resultDeliveryId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['resultDeliveryState'],
        message: 'Only succeeded workflow runs may expose a result delivery'
      })
    }
    const requiresError = run.status === 'failed' || run.status === 'interrupted'
    if (requiresError !== (run.error !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'Only failed or interrupted workflow runs may expose a terminal error'
      })
    }
  })

export type WorkflowRun = z.infer<typeof WorkflowRunSchema>

export const WorkflowInvocationSchema = z
  .object({
    id: StoredIdSchema,
    runId: StoredIdSchema,
    seq: z.number().int().positive(),
    callPath: z.string().min(1).max(2_048),
    attempt: z.number().int().positive(),
    executionEpoch: z.number().int().positive(),
    request: WorkflowGuestAgentRequestSchema,
    inputHash: HashSchema,
    policyHash: HashSchema,
    childCorrelationSlot: StoredIdSchema,
    childSessionId: StoredIdSchema.nullable(),
    status: WorkflowInvocationStatusSchema,
    timeoutDeadlineAt: TimestampSchema.nullable(),
    result: JsonValueSchema.nullable(),
    error: WorkflowInvocationErrorSchema.nullable(),
    effectState: WorkflowEffectStateSchema,
    effectEvidence: WorkflowEffectEvidenceSchema.nullable(),
    usage: JsonValueSchema.nullable(),
    tapeLinkReceipt: WorkflowTapeLinkReceiptSchema.nullable(),
    invalidatedAt: TimestampSchema.nullable(),
    invalidationReason: z.string().max(8_192).nullable(),
    createdAt: TimestampSchema,
    startedAt: TimestampSchema.nullable(),
    updatedAt: TimestampSchema,
    completedAt: TimestampSchema.nullable()
  })
  .strict()
  .superRefine((invocation, context) => {
    const terminal = ['succeeded', 'failed', 'timed_out', 'cancelled', 'interrupted'].includes(
      invocation.status
    )
    if (terminal !== (invocation.completedAt !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Terminal workflow invocations must have a completion timestamp'
      })
    }
    if (invocation.status === 'succeeded') {
      if (
        invocation.childSessionId === null ||
        invocation.tapeLinkReceipt === null ||
        invocation.tapeLinkReceipt.childSessionId !== invocation.childSessionId ||
        invocation.tapeLinkReceipt.outcome !== 'completed'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['tapeLinkReceipt'],
          message: 'Succeeded workflow invocations require a matching completed Tape receipt'
        })
      }
    }
    const requiresError = ['failed', 'timed_out', 'cancelled', 'interrupted'].includes(
      invocation.status
    )
    if (requiresError !== (invocation.error !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'Workflow invocation error must match its terminal failure state'
      })
    }
    if (
      (invocation.effectState === 'none') !== (invocation.effectEvidence === null) ||
      (invocation.effectEvidence !== null &&
        invocation.effectEvidence.classification !== invocation.effectState)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['effectEvidence'],
        message: 'Workflow effect evidence must match the monotonic effect state'
      })
    }
  })

export type WorkflowInvocation = z.infer<typeof WorkflowInvocationSchema>

export interface WorkflowRunCreateInput {
  id: string
  parentSessionId: string
  parentMessageId?: string | null
  namedWorkflowPath?: string | null
  workspacePath: string | null
  capabilityScopeHash: string
  scriptSource: string
  input: JsonValue
  limits: WorkflowRuntimeLimits
  allowedAgentIds: string[]
  budget?: JsonValue | null
  now?: number
}

export interface WorkflowInvocationCreateInput {
  id: string
  runId: string
  request: WorkflowGuestAgentRequest
  now?: number
}

export const WorkflowInvocationFailureSchema = z
  .object({
    status: z.enum(['failed', 'timed_out', 'cancelled', 'interrupted']),
    error: WorkflowInvocationErrorSchema
  })
  .strict()

export type WorkflowInvocationFailure = z.infer<typeof WorkflowInvocationFailureSchema>
