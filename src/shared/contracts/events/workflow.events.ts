import { z } from 'zod'
import { defineEventContract, JsonValueSchema } from '../common'
import { WorkflowRunSummarySchema } from '../../workflow/projection'

export const workflowRunChangedEvent = defineEventContract({
  name: 'workflow.run.changed',
  payload: z
    .object({
      schemaVersion: z.literal(1),
      run: WorkflowRunSummarySchema
    })
    .strict()
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
