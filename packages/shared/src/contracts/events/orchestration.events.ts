import { z } from 'zod'
import { defineEventContract } from '../common.js'
import { LiveDelegationSummarySchema } from '../../orchestration/liveDelegation.js'

export const liveDelegationChangedEvent = defineEventContract({
  name: 'orchestration.liveDelegation.changed',
  payload: z
    .object({
      schemaVersion: z.literal(1),
      parentSessionId: z.string().trim().min(1).max(256),
      delegation: LiveDelegationSummarySchema
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.delegation.parentSessionId !== value.parentSessionId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['delegation', 'parentSessionId'],
          message: 'Live delegation event parent does not match its projection.'
        })
      }
    })
})
