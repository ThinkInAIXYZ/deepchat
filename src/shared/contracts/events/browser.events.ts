import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'
import { YoBrowserStatusSchema } from '../domainSchemas'

const BrowserStatusChangeReasonSchema = z.enum([
  'created',
  'updated',
  'closed',
  'focused',
  'visibility'
])

export const browserOpenRequestedEvent = defineEventContract({
  name: 'browser.open.requested',
  payload: z.object({
    sessionId: z.string(),
    windowId: z.number().int(),
    url: z.string(),
    version: TimestampMsSchema
  })
})

export const browserStatusChangedEvent = defineEventContract({
  name: 'browser.status.changed',
  payload: z.object({
    sessionId: z.string(),
    reason: BrowserStatusChangeReasonSchema,
    windowId: z.number().int().nullable().optional(),
    visible: z.boolean().optional(),
    status: YoBrowserStatusSchema.nullable(),
    version: TimestampMsSchema
  })
})
