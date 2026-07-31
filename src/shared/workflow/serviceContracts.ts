import { z } from 'zod'
import { JsonValueSchema } from '../contracts/common'
import {
  WORKFLOW_RUNTIME_DEFAULT_LIMITS,
  WORKFLOW_RUNTIME_MAX_SCRIPT_BYTES,
  WorkflowRuntimeLimitsSchema
} from './runtimeProtocol'

const WorkflowStoredIdSchema = z.string().trim().min(1).max(256)
const WorkflowNamedPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .refine((value) => !value.includes('\0'), 'Workflow path cannot contain NUL')
const WorkflowHashSchema = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]+$/)
const WorkflowRuntimeLimitOverridesSchema = z
  .object(WorkflowRuntimeLimitsSchema.shape)
  .partial()
  .strict()

export const WorkflowRunBudgetSchema = z
  .object({
    maxTotalTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    maxExecutionMs: z
      .number()
      .int()
      .min(1_000)
      .max(7 * 24 * 60 * 60 * 1_000)
      .optional()
  })
  .strict()
  .refine((budget) => Object.keys(budget).length > 0, 'Workflow budget cannot be empty')

export type WorkflowRunBudget = z.infer<typeof WorkflowRunBudgetSchema>

const WorkflowUsageKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z][A-Za-z0-9]*$/)
  .refine(
    (key) => !Object.prototype.hasOwnProperty.call(Object.prototype, key),
    'Prototype-sensitive usage keys are unavailable'
  )

export const WorkflowUsageSchema = z.record(
  WorkflowUsageKeySchema,
  z.number().nonnegative().max(Number.MAX_SAFE_INTEGER)
)

export type WorkflowUsage = z.infer<typeof WorkflowUsageSchema>

export const WorkflowLaunchDraftSchema = z
  .object({
    parentSessionId: WorkflowStoredIdSchema,
    parentMessageId: WorkflowStoredIdSchema.nullable().optional(),
    namedWorkflowPath: WorkflowNamedPathSchema.nullable().optional(),
    workspacePath: z
      .string()
      .min(1)
      .max(4_096)
      .refine((value) => !value.includes('\0'), 'Workspace path cannot contain NUL')
      .nullable(),
    capabilityScopeHash: WorkflowHashSchema,
    capabilities: z.array(z.string().trim().min(1).max(256)).min(1).max(16),
    scriptSource: z.string().min(1).max(WORKFLOW_RUNTIME_MAX_SCRIPT_BYTES),
    input: JsonValueSchema,
    limits: WorkflowRuntimeLimitOverridesSchema.optional(),
    allowedAgentIds: z.array(WorkflowStoredIdSchema).min(1).max(32),
    budget: WorkflowRunBudgetSchema.nullable().optional()
  })
  .strict()

export type WorkflowLaunchDraft = z.input<typeof WorkflowLaunchDraftSchema>

export const WorkflowLaunchIntentSchema = WorkflowLaunchDraftSchema.omit({
  workspacePath: true,
  capabilityScopeHash: true,
  capabilities: true
}).strict()

export type WorkflowLaunchIntent = z.input<typeof WorkflowLaunchIntentSchema>

export const WorkflowLaunchRequestSchema = WorkflowLaunchDraftSchema.omit({
  limits: true,
  parentMessageId: true,
  namedWorkflowPath: true,
  budget: true
})
  .extend({
    parentMessageId: WorkflowStoredIdSchema.nullable(),
    namedWorkflowPath: WorkflowNamedPathSchema.nullable(),
    limits: WorkflowRuntimeLimitsSchema,
    budget: WorkflowRunBudgetSchema.nullable()
  })
  .strict()

export type WorkflowLaunchRequest = z.infer<typeof WorkflowLaunchRequestSchema>

export const WorkflowLaunchApprovalSchema = z
  .object({
    approvalId: z.string().uuid(),
    sourceHash: WorkflowHashSchema,
    scopeHash: WorkflowHashSchema,
    expiresAt: z.number().int().nonnegative(),
    summary: z
      .object({
        workspacePath: z.string().max(4_096).nullable(),
        capabilityScopeHash: WorkflowHashSchema,
        allowedAgentIds: z.array(WorkflowStoredIdSchema).min(1).max(32),
        maxInvocations: z.number().int().positive(),
        maxPendingInvocations: z.number().int().positive(),
        budget: WorkflowRunBudgetSchema.nullable(),
        capabilities: z.array(z.string().min(1).max(256)).max(16)
      })
      .strict()
  })
  .strict()

export type WorkflowLaunchApproval = z.infer<typeof WorkflowLaunchApprovalSchema>

export function resolveWorkflowLaunchRequest(draft: WorkflowLaunchDraft): WorkflowLaunchRequest {
  const parsed = WorkflowLaunchDraftSchema.parse(draft)
  const limits = WorkflowRuntimeLimitsSchema.parse({
    ...WORKFLOW_RUNTIME_DEFAULT_LIMITS,
    ...parsed.limits
  })
  return WorkflowLaunchRequestSchema.parse({
    ...parsed,
    parentMessageId: parsed.parentMessageId ?? null,
    namedWorkflowPath: parsed.namedWorkflowPath ?? null,
    budget: parsed.budget ?? null,
    allowedAgentIds: [...new Set(parsed.allowedAgentIds)].sort(),
    limits
  })
}
