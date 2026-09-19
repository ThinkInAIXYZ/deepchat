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
    source: z.enum(['agent', 'user']),
    runId: z.string().min(1).optional(),
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

export const browserPreviewFrameEvent = defineEventContract({
  name: 'browser.preview.frame',
  payload: z.object({
    sessionId: z.string().min(1),
    runId: z.string().min(1),
    sequence: z.number().int().nonnegative(),
    width: z.number().int().positive().max(1920),
    height: z.number().int().positive().max(1200),
    mimeType: z.literal('image/jpeg'),
    data: z.custom<Uint8Array>(
      (value) => value instanceof Uint8Array && value.byteLength <= 512 * 1024
    ),
    timestamp: TimestampMsSchema
  })
})

export const browserPreviewActionEvent = defineEventContract({
  name: 'browser.preview.action',
  payload: z.object({
    action: z.enum(['activate', 'dismiss']),
    windowId: z.number().int().positive(),
    sessionId: z.string().min(1),
    runId: z.string().min(1)
  })
})

export const browserPreviewSurfaceChangedEvent = defineEventContract({
  name: 'browser.preview.surface.changed',
  payload: z.object({
    windowId: z.number().int().positive(),
    sessionId: z.string().min(1),
    runId: z.string().min(1),
    surface: z.enum(['native-overlay', 'renderer-canvas', 'none']),
    version: TimestampMsSchema
  })
})
