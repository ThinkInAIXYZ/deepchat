import { z } from 'zod'
import { defineRouteContract } from '../common'
import { WorkflowRunDetailSchema, WorkflowRunSummarySchema } from '../../workflow/projection'
import {
  WorkflowLaunchApprovalSchema,
  WorkflowLaunchIntentSchema
} from '../../workflow/serviceContracts'
import { WorkflowSynthesisReceiptSchema } from '../../workflow/resultDelivery'
import {
  WORKFLOW_SAVED_MAX_SOURCE_BYTES,
  WorkflowSavedArgsTextSchema,
  WorkflowSavedCatalogSchema,
  WorkflowSavedDocumentSchema,
  WorkflowSavedNameSchema,
  WorkflowSavedSourceHashSchema
} from '../../workflow/savedWorkflow'
import {
  SessionOrchestrationModeSchema,
  WorkflowCapabilitySchema
} from '../../workflow/orchestrationMode'

const WorkflowRouteIdSchema = z.string().trim().min(1).max(256)
const WorkflowRunRefSchema = z
  .object({
    parentSessionId: WorkflowRouteIdSchema,
    runId: WorkflowRouteIdSchema
  })
  .strict()

const WorkflowCapabilityTargetSchema = z.union([
  z
    .object({
      parentSessionId: WorkflowRouteIdSchema
    })
    .strict(),
  z
    .object({
      agentId: WorkflowRouteIdSchema
    })
    .strict()
])

export const workflowGetCapabilityRoute = defineRouteContract({
  name: 'workflow.getCapability',
  input: WorkflowCapabilityTargetSchema,
  output: z
    .object({
      capability: WorkflowCapabilitySchema
    })
    .strict()
})

export const workflowSetModeRoute = defineRouteContract({
  name: 'workflow.setMode',
  input: z
    .object({
      parentSessionId: WorkflowRouteIdSchema,
      mode: SessionOrchestrationModeSchema
    })
    .strict(),
  output: z
    .object({
      applied: z.boolean(),
      mode: SessionOrchestrationModeSchema,
      capability: WorkflowCapabilitySchema
    })
    .strict()
})

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

export const workflowSynthesizeRoute = defineRouteContract({
  name: 'workflow.synthesize',
  input: WorkflowRunRefSchema,
  output: z
    .object({
      receipt: WorkflowSynthesisReceiptSchema
    })
    .strict()
})

export const workflowSavedListRoute = defineRouteContract({
  name: 'workflow.saved.list',
  input: z
    .object({
      parentSessionId: WorkflowRouteIdSchema
    })
    .strict(),
  output: WorkflowSavedCatalogSchema
})

export const workflowSavedReadRoute = defineRouteContract({
  name: 'workflow.saved.read',
  input: z
    .object({
      parentSessionId: WorkflowRouteIdSchema,
      name: WorkflowSavedNameSchema
    })
    .strict(),
  output: z
    .object({
      workflow: WorkflowSavedDocumentSchema
    })
    .strict()
})

export const workflowSavedSaveRoute = defineRouteContract({
  name: 'workflow.saved.save',
  input: z
    .object({
      parentSessionId: WorkflowRouteIdSchema,
      name: WorkflowSavedNameSchema,
      source: z.string().min(1).max(WORKFLOW_SAVED_MAX_SOURCE_BYTES),
      expectedSourceHash: WorkflowSavedSourceHashSchema.nullable()
    })
    .strict(),
  output: z
    .object({
      workflow: WorkflowSavedDocumentSchema
    })
    .strict()
})

export const workflowSavedPrepareLaunchRoute = defineRouteContract({
  name: 'workflow.saved.prepareLaunch',
  input: z
    .object({
      parentSessionId: WorkflowRouteIdSchema,
      name: WorkflowSavedNameSchema,
      argsText: WorkflowSavedArgsTextSchema,
      expectedSourceHash: WorkflowSavedSourceHashSchema,
      allowedAgentIds: z.array(WorkflowRouteIdSchema).min(1).max(32).optional()
    })
    .strict(),
  output: z
    .object({
      approval: WorkflowLaunchApprovalSchema
    })
    .strict()
})
