import { z } from 'zod'
import { JsonValueSchema } from '../contracts/common'
import {
  WORKFLOW_INVOCATION_STATUSES,
  WorkflowEffectEvidenceSchema,
  WorkflowEffectStateSchema,
  WorkflowInvocationStatusSchema,
  WorkflowResultDeliveryStateSchema,
  WorkflowRunStatusSchema,
  WorkflowTapeLinkReceiptSchema
} from './domain'
import { WorkflowInvocationErrorSchema, WorkflowRuntimeLimitsSchema } from './runtimeProtocol'
import { WorkflowRunBudgetSchema } from './serviceContracts'

const WorkflowProjectionIdSchema = z.string().min(1).max(256)
const WorkflowProjectionTimestampSchema = z.number().int().nonnegative()
const WorkflowProjectionHashSchema = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]+$/)
const WorkflowProjectionWorkspacePathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => !value.includes('\0'), 'Workspace path cannot contain NUL')

export const WORKFLOW_PROJECTION_SCHEMA_VERSION = 1 as const
export const WORKFLOW_VALUE_PREVIEW_MAX_BYTES = 16 * 1024
export const WORKFLOW_PROMPT_PREVIEW_MAX_BYTES = 4 * 1024

export const WorkflowValuePreviewSchema = z
  .object({
    text: z.string().max(WORKFLOW_VALUE_PREVIEW_MAX_BYTES),
    byteLength: z.number().int().nonnegative(),
    truncated: z.boolean()
  })
  .strict()

export const WorkflowPromptPreviewSchema = z
  .object({
    text: z.string().max(WORKFLOW_PROMPT_PREVIEW_MAX_BYTES),
    byteLength: z.number().int().nonnegative(),
    truncated: z.boolean()
  })
  .strict()

const WorkflowInvocationCountShape = Object.fromEntries(
  WORKFLOW_INVOCATION_STATUSES.map((status) => [status, z.number().int().nonnegative()])
) as Record<(typeof WORKFLOW_INVOCATION_STATUSES)[number], z.ZodNumber>

export const WorkflowInvocationCountsSchema = z.object(WorkflowInvocationCountShape).strict()

export const WorkflowRunSummarySchema = z
  .object({
    schemaVersion: z.literal(WORKFLOW_PROJECTION_SCHEMA_VERSION),
    id: WorkflowProjectionIdSchema,
    parentSessionId: WorkflowProjectionIdSchema,
    parentMessageId: WorkflowProjectionIdSchema.nullable(),
    namedWorkflowPath: z.string().max(4_096).nullable(),
    workspacePath: WorkflowProjectionWorkspacePathSchema.nullable(),
    capabilityScopeHash: WorkflowProjectionHashSchema,
    scriptHash: WorkflowProjectionHashSchema,
    runtimeApiVersion: z.number().int().positive(),
    status: WorkflowRunStatusSchema,
    phase: JsonValueSchema.nullable(),
    error: WorkflowInvocationErrorSchema.nullable(),
    usage: JsonValueSchema.nullable(),
    cancellationReason: z.string().max(8_192).nullable(),
    interruptionReason: z.string().max(8_192).nullable(),
    resultDeliveryState: WorkflowResultDeliveryStateSchema,
    resultDeliveryId: WorkflowProjectionIdSchema.nullable(),
    invocationCounts: WorkflowInvocationCountsSchema,
    createdAt: WorkflowProjectionTimestampSchema,
    startedAt: WorkflowProjectionTimestampSchema.nullable(),
    updatedAt: WorkflowProjectionTimestampSchema,
    completedAt: WorkflowProjectionTimestampSchema.nullable(),
    revision: z.number().int().nonnegative()
  })
  .strict()

export const WorkflowInvocationProjectionSchema = z
  .object({
    id: WorkflowProjectionIdSchema,
    runId: WorkflowProjectionIdSchema,
    seq: z.number().int().positive(),
    callPath: z.string().min(1).max(2_048),
    attempt: z.number().int().positive(),
    executionEpoch: z.number().int().positive(),
    key: z.string().min(1).max(256),
    label: z.string().max(512).nullable(),
    phase: z.string().max(256).nullable(),
    agentId: WorkflowProjectionIdSchema.nullable(),
    promptPreview: WorkflowPromptPreviewSchema,
    hasCustomSchema: z.boolean(),
    inputHash: WorkflowProjectionHashSchema,
    policyHash: WorkflowProjectionHashSchema,
    childCorrelationSlot: WorkflowProjectionIdSchema,
    childSessionId: WorkflowProjectionIdSchema.nullable(),
    status: WorkflowInvocationStatusSchema,
    timeoutDeadlineAt: WorkflowProjectionTimestampSchema.nullable(),
    resultPreview: WorkflowValuePreviewSchema.nullable(),
    error: WorkflowInvocationErrorSchema.nullable(),
    effectState: WorkflowEffectStateSchema,
    effectEvidence: WorkflowEffectEvidenceSchema.nullable(),
    usage: JsonValueSchema.nullable(),
    tapeLinkReceipt: WorkflowTapeLinkReceiptSchema.nullable(),
    invalidatedAt: WorkflowProjectionTimestampSchema.nullable(),
    invalidationReason: z.string().max(8_192).nullable(),
    createdAt: WorkflowProjectionTimestampSchema,
    startedAt: WorkflowProjectionTimestampSchema.nullable(),
    updatedAt: WorkflowProjectionTimestampSchema,
    completedAt: WorkflowProjectionTimestampSchema.nullable()
  })
  .strict()

export const WorkflowRunDetailSchema = WorkflowRunSummarySchema.extend({
  limits: WorkflowRuntimeLimitsSchema,
  allowedAgentIds: z.array(WorkflowProjectionIdSchema).min(1).max(32),
  budget: WorkflowRunBudgetSchema.nullable(),
  resultPreview: WorkflowValuePreviewSchema.nullable(),
  invalidatedFromSeq: z.number().int().positive().nullable(),
  invocations: z.array(WorkflowInvocationProjectionSchema)
}).strict()

export type WorkflowValuePreview = z.infer<typeof WorkflowValuePreviewSchema>
export type WorkflowPromptPreview = z.infer<typeof WorkflowPromptPreviewSchema>
export type WorkflowInvocationCounts = z.infer<typeof WorkflowInvocationCountsSchema>
export type WorkflowRunSummary = z.infer<typeof WorkflowRunSummarySchema>
export type WorkflowInvocationProjection = z.infer<typeof WorkflowInvocationProjectionSchema>
export type WorkflowRunDetail = z.infer<typeof WorkflowRunDetailSchema>
