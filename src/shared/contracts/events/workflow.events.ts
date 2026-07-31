import { z } from 'zod'
import { defineEventContract, JsonValueSchema } from '../common'
import {
  WorkflowInvocationProjectionSchema,
  WorkflowRunSummarySchema
} from '../../workflow/projection'

export const workflowRunChangedEvent = defineEventContract({
  name: 'workflow.run.changed',
  payload: z
    .object({
      schemaVersion: z.literal(1),
      run: WorkflowRunSummarySchema
    })
    .strict()
})

export const workflowInvocationChangedEvent = defineEventContract({
  name: 'workflow.invocation.changed',
  payload: z
    .object({
      schemaVersion: z.literal(1),
      parentSessionId: z.string().min(1).max(256),
      runId: z.string().min(1).max(256),
      invocation: WorkflowInvocationProjectionSchema
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.invocation.runId !== value.runId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['invocation', 'runId'],
          message: 'Workflow invocation event runId does not match its projection.'
        })
      }
    })
})

export const workflowLogEvent = defineEventContract({
  name: 'workflow.log',
  payload: z
    .object({
      schemaVersion: z.literal(1),
      parentSessionId: z.string().min(1).max(256),
      runId: z.string().min(1).max(256),
      value: JsonValueSchema,
      createdAt: z.number().int().nonnegative()
    })
    .strict()
})
