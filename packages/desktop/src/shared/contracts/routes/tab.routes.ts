import { z } from 'zod'
import { defineRouteContract } from '../common'
import { RectangleSchema } from '../domainSchemas'

const TabWatermarkTextsSchema = z
  .object({
    brand: z.string().optional(),
    time: z.string().optional(),
    tip: z.string().optional(),
    model: z.string().optional(),
    provider: z.string().optional()
  })
  .optional()

const TabWatermarkConfigSchema = z
  .object({
    isDark: z.boolean().optional(),
    version: z.string().optional(),
    texts: TabWatermarkTextsSchema
  })
  .optional()

export const tabCaptureCurrentAreaRoute = defineRouteContract({
  name: 'tab.captureCurrentArea',
  input: z.object({
    rect: RectangleSchema
  }),
  output: z.object({
    imageData: z.string().nullable()
  })
})

export const tabStitchImagesWithWatermarkRoute = defineRouteContract({
  name: 'tab.stitchImagesWithWatermark',
  input: z.object({
    images: z.array(z.string()),
    watermark: TabWatermarkConfigSchema
  }),
  output: z.object({
    imageData: z.string().nullable()
  })
})
