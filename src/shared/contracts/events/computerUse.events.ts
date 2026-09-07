import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'

const PreviewSurfaceSchema = z.enum(['native-overlay', 'renderer-canvas', 'none'])

export const computerUsePreviewFrameEvent = defineEventContract({
  name: 'computerUse.preview.frame',
  payload: z.object({
    sessionId: z.string().min(1),
    runId: z.string().min(1),
    epoch: z.number().int().nonnegative(),
    sequence: z.number().int().nonnegative(),
    width: z.number().int().positive().max(480),
    height: z.number().int().positive().max(300),
    mimeType: z.literal('image/jpeg'),
    data: z.custom<Uint8Array>(
      (value) => value instanceof Uint8Array && value.byteLength <= 512 * 1024
    ),
    timestamp: TimestampMsSchema
  })
})

export const computerUsePreviewSurfaceChangedEvent = defineEventContract({
  name: 'computerUse.preview.surface.changed',
  payload: z.object({
    windowId: z.number().int().positive(),
    sessionId: z.string().min(1),
    runId: z.string().min(1),
    epoch: z.number().int().nonnegative(),
    surface: PreviewSurfaceSchema,
    version: TimestampMsSchema
  })
})
