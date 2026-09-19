import { z } from 'zod'
import { JsonValueSchema, TimestampMsSchema, defineEventContract } from '../common.js'
import {
  LocalControlEffectSchema,
  LocalControlMethodSchema,
  LocalControlPrincipalSchema
} from '../localControl.js'
import { ApprovalRequestIdSchema } from '../routes/approvals.routes.js'

export const approvalRequestedEvent = defineEventContract({
  name: 'approvals.requested',
  payload: z
    .object({
      requestId: ApprovalRequestIdSchema,
      operation: LocalControlMethodSchema,
      effect: LocalControlEffectSchema,
      principal: LocalControlPrincipalSchema,
      expiresAt: TimestampMsSchema,
      displayData: JsonValueSchema.optional()
    })
    .strict()
})

export const approvalClosedEvent = defineEventContract({
  name: 'approvals.closed',
  payload: z
    .object({
      requestId: ApprovalRequestIdSchema,
      reason: z.enum(['approved', 'denied', 'cancelled', 'timeout', 'unavailable'])
    })
    .strict()
})
