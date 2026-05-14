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

export const browserActivityChangedEvent = defineEventContract({
  name: 'browser.activity.changed',
  payload: z.object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    windowId: z.number().int().nullable(),
    pageId: z.string().optional(),
    kind: z.enum(['navigation', 'vision', 'pointer', 'scroll', 'keyboard']),
    action: z.enum([
      'navigate',
      'reload',
      'screenshot',
      'dom',
      'runtime',
      'mouse_move',
      'mouse_click',
      'mouse_wheel',
      'key'
    ]),
    phase: z.enum(['started', 'completed', 'failed']),
    point: z
      .object({
        x: z.number(),
        y: z.number()
      })
      .optional(),
    rect: z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number()
      })
      .optional(),
    direction: z.enum(['up', 'down', 'left', 'right']).optional(),
    timestamp: TimestampMsSchema
  })
})
