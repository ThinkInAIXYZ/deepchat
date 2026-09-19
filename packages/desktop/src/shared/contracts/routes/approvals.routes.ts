import { z } from 'zod'
import { defineRouteContract } from '../contract'

export const ApprovalRequestIdSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)

export const approvalsResolveRoute = defineRouteContract({
  name: 'approvals.resolve',
  input: z
    .object({
      requestId: ApprovalRequestIdSchema,
      decision: z.enum(['approved', 'denied'])
    })
    .strict(),
  output: z.object({ accepted: z.boolean() }).strict()
})
