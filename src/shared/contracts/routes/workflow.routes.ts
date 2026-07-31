import { z } from 'zod'
import { defineRouteContract } from '../common'
import { WorkflowRunDetailSchema, WorkflowRunSummarySchema } from '../../workflow/projection'
import {
  WorkflowLaunchApprovalSchema,
  WorkflowLaunchIntentSchema
} from '../../workflow/serviceContracts'

const WorkflowRouteIdSchema = z.string().trim().min(1).max(256)
const WorkflowRunRefSchema = z
  .object({
    parentSessionId: WorkflowRouteIdSchema,
    runId: WorkflowRouteIdSchema
  })
  .strict()

export const workflowPrepareLaunchRoute = defineRouteContract({
  name: 'workflow.prepareLaunch',
  input: WorkflowLaunchIntentSchema,
  output: z
    .object({
      approval: WorkflowLaunchApprovalSchema
    })
    .strict()
})

export const workflowLaunchRoute = defineRouteContract({
  name: 'workflow.launch',
  input: z
    .object({
      parentSessionId: WorkflowRouteIdSchema,
      approvalId: z.string().uuid()
    })
    .strict(),
  output: z
    .object({
      run: WorkflowRunSummarySchema
    })
    .strict()
})

export const workflowListRoute = defineRouteContract({
  name: 'workflow.list',
  input: z
    .object({
      parentSessionId: WorkflowRouteIdSchema,
      limit: z.number().int().min(1).max(200).default(100)
    })
    .strict(),
  output: z
    .object({
      runs: z.array(WorkflowRunSummarySchema)
    })
    .strict()
})

export const workflowInspectRoute = defineRouteContract({
  name: 'workflow.inspect',
  input: WorkflowRunRefSchema,
  output: z
    .object({
      run: WorkflowRunDetailSchema
    })
    .strict()
})

export const workflowCancelRoute = defineRouteContract({
  name: 'workflow.cancel',
  input: WorkflowRunRefSchema.extend({
    reason: z.string().trim().min(1).max(8_192).optional()
  }).strict(),
  output: z
    .object({
      run: WorkflowRunSummarySchema
    })
    .strict()
})

export const workflowResumeRoute = defineRouteContract({
  name: 'workflow.resume',
  input: WorkflowRunRefSchema,
  output: z
    .object({
      run: WorkflowRunSummarySchema
    })
    .strict()
})

export const workflowRetryRoute = defineRouteContract({
  name: 'workflow.retry',
  input: WorkflowRunRefSchema.extend({
    invocationId: WorkflowRouteIdSchema,
    fromHere: z.boolean().default(false),
    confirmEffects: z.boolean().default(false)
  }).strict(),
  output: z
    .object({
      run: WorkflowRunSummarySchema
    })
    .strict()
})
